// Ingestion: the storage sandbox for imported artifacts, the Keychain helper,
// and the command-line connectors (tier D: read-only pulls from CLIs the user
// already signed into). Runtime MCP connectors are mirrored by apps_mirror.rs
// and the browser lane lives in the engine.
//
// All artifacts land in the storage sandbox (see `storage.rs`).
// Public Tauri commands are exposed via the public functions at the
// bottom of this file and wired into `lib.rs::invoke_handler!`.

pub mod storage;
pub mod keychain;
// Tier C (headed Playwright browser automation) RETIRED: the browser lane now
// lives entirely in the prevail-cli engine (connectors browser-learn / browser-
// replay), surfaced by ConnectorRunPanel. One engine-owned browser path.
pub mod tier_d_cli;

use serde::Serialize;
use std::sync::Mutex;

// ─────────────────────────────────────────────────────────────────────
// Shared types

// ─────────────────────────────────────────────────────────────────────
// Orchestrator state — shared across Tauri commands

/// Container for any state a tier needs to keep between commands
/// (live subprocesses, etc.). Wrapped in Mutex because Tauri commands
/// can be called from multiple threads.
pub struct OrchestratorState {
    pub tier_d: Mutex<tier_d_cli::CliRunner>,
}

impl Default for OrchestratorState {
    fn default() -> Self {
        Self {
            tier_d: Mutex::new(tier_d_cli::CliRunner::new()),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────
// Tauri commands — re-exported via lib.rs

// SECURITY: there is intentionally NO `ingestion_keychain_get` Tauri command.
// Exposing a generic "read any Keychain secret by service+account" to the JS
// layer would be a broad exfiltration primitive if the renderer were ever
// compromised. Rust-internal callers use `keychain::get(...)` directly; the
// frontend only ever learns whether a secret EXISTS (see `provider_key_exists`),
// never its value.

/// A single artifact entry as surfaced to the UI.
#[derive(serde::Serialize, Clone, Debug)]
pub struct ArtifactEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub mtime: u64,
    pub meta: Option<storage::ArtifactMeta>,
}

/// List artifacts that have landed in a domain's imports/ folder.
/// Returns newest-first. Reads the sidecar `<file>.meta.json` if it
/// exists; otherwise returns the entry with `meta = None` (handles
/// files dropped in by the user directly).
#[tauri::command]
pub fn ingestion_list_artifacts(domain: String) -> Result<Vec<ArtifactEntry>, String> {
    let dir = match storage::imports_dir(&domain) {
        Ok(d) => d,
        Err(_) => return Ok(vec![]),
    };
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut entries: Vec<ArtifactEntry> = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| format!("read imports: {e}"))?.flatten() {
        let p = entry.path();
        let name = match p.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        // Skip the sidecar files themselves; only show artifacts.
        if name.ends_with(".meta.json") {
            continue;
        }
        let md = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let size = md.len();
        let mtime = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        // Sidecar path: <name>.<ext>.meta.json
        let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("bin");
        let meta_path = p.with_extension(format!("{ext}.meta.json"));
        let meta = std::fs::read_to_string(&meta_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<storage::ArtifactMeta>(&raw).ok());

        entries.push(ArtifactEntry {
            path: p.to_string_lossy().to_string(),
            name,
            size,
            mtime,
            meta,
        });
    }
    entries.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    Ok(entries)
}

// ── Tier D — CLI connectors ──────────────────────────────────────────

/// Load the bundled, allowlisted CLI providers. The JS surface can only
/// reference these by id; it never supplies a binary or args itself.
fn load_cli_providers(app: &tauri::AppHandle) -> Result<Vec<tier_d_cli::CliProvider>, String> {
    use tauri::Manager;
    let resource = app
        .path()
        .resolve(
            "resources/connectors/cli_providers.json",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("resolve cli_providers.json: {e}"))?;
    if !resource.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(&resource).map_err(|e| format!("read cli_providers.json: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("parse cli_providers.json: {e}"))
}

#[tauri::command]
pub fn ingestion_cli_providers(app: tauri::AppHandle) -> Result<Vec<tier_d_cli::CliProvider>, String> {
    load_cli_providers(&app)
}

/// Is the provider's CLI installed + on PATH? Runs its read-only version probe.
#[tauri::command]
pub fn ingestion_cli_probe(
    app: tauri::AppHandle,
    state: tauri::State<'_, OrchestratorState>,
    provider_id: String,
) -> Result<bool, String> {
    let providers = load_cli_providers(&app)?;
    let provider = providers
        .into_iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| format!("unknown CLI provider: {provider_id}"))?;
    let mut runner = state.tier_d.lock().map_err(|e| e.to_string())?;
    Ok(runner.probe(&provider))
}

/// Summary returned to the UI after a successful CLI pull.
#[derive(Serialize, Clone)]
pub struct CliRunSummary {
    pub provider: String,
    pub app: String,
    pub domain: String,
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

/// Run a provider's read-only command and ingest its stdout as an artifact.
#[tauri::command]
pub fn ingestion_cli_run(
    app: tauri::AppHandle,
    state: tauri::State<'_, OrchestratorState>,
    provider_id: String,
) -> Result<CliRunSummary, String> {
    use tauri::Emitter;
    crate::bunker::guard_cloud()?; // a CLI fetch may reach the network

    let providers = load_cli_providers(&app)?;
    let provider = providers
        .into_iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| format!("unknown CLI provider: {provider_id}"))?;

    let out = {
        let mut runner = state.tier_d.lock().map_err(|e| e.to_string())?;
        runner.run(&provider)?
    };

    // Stage the captured stdout in a temp file, then move it through the
    // single artifact sink (SHA-256 + sidecar) like every other tier.
    let tmp = std::env::temp_dir().join(format!("prevail-cli-{}-{}.out", provider.id, std::process::id()));
    std::fs::write(&tmp, &out.stdout).map_err(|e| format!("stage cli output: {e}"))?;
    let clean = format!("{}-{}.txt", provider.app, provider.id);
    let (dest, meta) = storage::ingest_artifact(&tmp, &provider.domain, "tier_d_cli", &provider.app, &clean)?;

    let _ = app.emit(
        "ingestion:artifact",
        serde_json::json!({
            "tier_id": "tier_d_cli",
            "domain": meta.domain,
            "source": meta.source,
            "path": dest.to_string_lossy(),
            "sha256": meta.sha256,
            "size": meta.size,
            "original": meta.original_name,
            "ts": meta.ts,
        }),
    );

    Ok(CliRunSummary {
        provider: provider.id,
        app: provider.app,
        domain: provider.domain,
        path: dest.to_string_lossy().to_string(),
        bytes: meta.size,
        sha256: meta.sha256,
    })
}

/// Per-domain quick stats — number of imports, total size. Used by
/// the sidebar to show a tiny "3 imports" badge per domain.
#[derive(serde::Serialize, Clone, Debug)]
pub struct DomainStats {
    pub domain: String,
    pub imports: usize,
    pub bytes: u64,
}

#[tauri::command]
pub fn ingestion_domain_stats(domain: String) -> Result<DomainStats, String> {
    let dir = match storage::imports_dir(&domain) {
        Ok(d) => d,
        Err(_) => return Ok(DomainStats { domain, imports: 0, bytes: 0 }),
    };
    let mut imports = 0usize;
    let mut bytes = 0u64;
    if dir.exists() {
        for entry in std::fs::read_dir(&dir).map_err(|e| format!("read imports: {e}"))?.flatten() {
            let name = match entry.file_name().to_str() {
                Some(n) => n.to_string(),
                None => continue,
            };
            if name.ends_with(".meta.json") { continue; }
            imports += 1;
            if let Ok(md) = entry.metadata() {
                bytes += md.len();
            }
        }
    }
    Ok(DomainStats { domain, imports, bytes })
}

/// Append a single JSON-line audit record describing an ingest event.
/// Independent of `ingest_artifact` so callers can audit non-file
/// events (e.g. a tier failing to start).
fn append_audit_log(record: &serde_json::Value) -> Result<(), String> {
    use std::io::Write;
    let path = storage::app_support_root()?.join("ingestion.log");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("open audit log: {e}"))?;
    let line = serde_json::to_string(record).map_err(|e| format!("serialize: {e}"))?;
    writeln!(f, "{line}").map_err(|e| format!("write audit: {e}"))?;
    Ok(())
}

/// Delete artifacts (and their .meta.json sidecars) older than the
/// cutoff. Skips files modified within the window. Returns the count
/// removed. Every deletion is appended to the audit log.
#[tauri::command]
pub fn ingestion_vacuum_imports(domain: String, older_than_days: u64) -> Result<usize, String> {
    let dir = storage::imports_dir(&domain)?;
    if !dir.exists() {
        return Ok(0);
    }
    let now = std::time::SystemTime::now();
    let cutoff = now
        .checked_sub(std::time::Duration::from_secs(older_than_days * 24 * 60 * 60))
        .ok_or_else(|| "invalid cutoff".to_string())?;
    let mut removed = 0usize;
    for entry in std::fs::read_dir(&dir).map_err(|e| format!("read dir: {e}"))?.flatten() {
        let p = entry.path();
        // Skip sidecars on this pass; they get deleted alongside their
        // owning artifact below.
        let name = match p.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if name.ends_with(".meta.json") {
            continue;
        }
        let mtime = match entry.metadata().and_then(|m| m.modified()) {
            Ok(t) => t,
            Err(_) => continue,
        };
        if mtime > cutoff {
            continue;
        }
        let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("bin");
        let sidecar = p.with_extension(format!("{ext}.meta.json"));
        let _ = std::fs::remove_file(&p);
        let _ = std::fs::remove_file(&sidecar);
        removed += 1;
        let _ = append_audit_log(&serde_json::json!({
            "type": "vacuum",
            "domain": domain,
            "path": p.to_string_lossy(),
            "older_than_days": older_than_days,
            "ts": now
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
        }));
    }
    Ok(removed)
}

/// Used by storage::ingest_artifact via re-export so storage doesn't
/// need to know about the audit log structure. Keeps the inversion:
/// storage owns the path, the engine owns the audit shape.
pub(crate) fn audit_ingest_event(
    tier_id: &str,
    source: &str,
    domain: &str,
    sha256: &str,
    size: u64,
    path: &str,
) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    append_audit_log(&serde_json::json!({
        "type": "ingest",
        "tier_id": tier_id,
        "source": source,
        "domain": domain,
        "sha256": sha256,
        "size": size,
        "path": path,
        "ts": now,
    }))
}
