// Ideal State (the user's constitution at <vault>/ideal-state.md), the user
// profile (<vault>/user.md), and distilled long-term memory (<vault>/<domain>/
// _memory.md). Read/write commands + version history. Extracted from lib.rs.

use std::fs;
use std::path::PathBuf;

use crate::engine;
use crate::paths::domain_dir;
use crate::{read_dir_retry, read_to_string_retry, secs_to_ymdhms};

// Canonical layout keeps root-config (ideal-state.md, omega.md, user/profile.md)
// under <vault>/build/. Read prefers build/<f>, falling back to the legacy root
// <vault>/<f>; write goes to build/ when it exists (else root). Keeps the root
// clean (PREVAIL.md + data/ + build/ only) while staying back-compatible.
pub(crate) fn config_read_path(vault: &str, f: &str) -> PathBuf {
    let in_build = crate::paths::build_root(vault).join(f);
    if in_build.exists() {
        return in_build;
    }
    PathBuf::from(vault).join(f)
}
pub(crate) fn config_write_path(vault: &str, f: &str) -> PathBuf {
    crate::paths::build_root(vault).join(f)
}

// User-level context — a single `<vault>/user.md` that captures who
// the user is, persistent preferences, recurring details. Mirrors the
// OpenClaw / Hermes user-profile pattern. Read/write via these calls.
#[tauri::command]
pub(crate) fn read_user_md(vault: String) -> Result<String, String> {
    // The canonical user-profile file is `_profile.md`, which config_read_path
    // routes into build/ (build/_profile.md). profile.md / user.md are honored
    // only as legacy read fallbacks for older vaults.
    for name in ["_profile.md", "profile.md", "user.md"] {
        let p = config_read_path(&vault, name);
        if p.exists() {
            return read_to_string_retry(&p).map_err(|e| e.to_string());
        }
    }
    Ok(String::new())
}
#[tauri::command]
pub(crate) fn write_user_md(vault: String, body: String) -> Result<(), String> {
    // Write the canonical build/_profile.md (config_write_path is build-rooted).
    let p = config_write_path(&vault, "_profile.md");
    if let Some(parent) = p.parent() { let _ = fs::create_dir_all(parent); }
    crate::vaultio::write_atomic(&p, &body).map_err(|e| format!("write _profile.md: {e}"))
}

// The user's Ideal State — their constitution. A single `<vault>/ideal-state.md`
// that captures the operating vision and values the whole system optimizes for.
// It is the HIGHEST-PRECEDENCE context, injected ahead of everything in chat,
// council, suggestions, surface, and every background daemon (see
// `ideal_state_preamble`). Editable in Settings; supersedes the old Pro Profile.
// When the file is absent, `read_ideal_state` returns this starter template so a
// fresh vault opens with a sensible, editable default.
pub(crate) const DEFAULT_IDEAL_STATE: &str = include_str!("default_ideal_state.md");

#[tauri::command]
pub(crate) fn read_ideal_state(vault: String) -> Result<String, String> {
    let p = config_read_path(&vault, "ideal-state.md");
    if !p.exists() {
        return Ok(DEFAULT_IDEAL_STATE.to_string());
    }
    read_to_string_retry(&p).map_err(|e| e.to_string())
}
// Versions of the constitution live next to it, in build/ideal-state.versions/,
// one file per version named by its ISO time (2026-09-27T14-05-03Z.md). build/
// syncs between Macs (only build/_meta and build/_scan are left out), so the
// history travels with the vault. Older snapshots written to
// build/_meta/ideal-state-versions/ are still listed.
pub(crate) fn ideal_versions_dir(vault: &str) -> PathBuf {
    config_write_path(vault, "ideal-state.versions")
}
fn legacy_versions_dir(vault: &str) -> PathBuf {
    crate::paths::build_root(vault).join("_meta").join("ideal-state-versions")
}

#[tauri::command]
pub(crate) fn write_ideal_state(vault: String, body: String) -> Result<(), String> {
    let p = config_write_path(&vault, "ideal-state.md");
    if let Some(parent) = p.parent() { let _ = fs::create_dir_all(parent); }
    // The constitution is never silently overwritten: every save that changes
    // it first keeps the prior full text as a dated version, so nothing is
    // ever lost. A restore is just another save.
    if let Ok(existing) = read_to_string_retry(config_read_path(&vault, "ideal-state.md")) {
        if existing.trim() != body.trim() && !existing.trim().is_empty() {
            let vdir = ideal_versions_dir(&vault);
            fs::create_dir_all(&vdir).map_err(|e| format!("mkdir versions: {e}"))?;
            let secs = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            let (y, mo, d, h, mi, s) = secs_to_ymdhms(secs);
            let mut vp = vdir.join(format!("{y:04}-{mo:02}-{d:02}T{h:02}-{mi:02}-{s:02}Z.md"));
            let mut n = 1;
            while vp.exists() {
                vp = vdir.join(format!("{y:04}-{mo:02}-{d:02}T{h:02}-{mi:02}-{s:02}Z-{n}.md"));
                n += 1;
            }
            crate::vaultio::write_atomic(&vp, &existing).map_err(|e| format!("write version: {e}"))?;
        }
    }
    crate::vaultio::write_atomic(&p, &body).map_err(|e| format!("write ideal-state.md: {e}"))
}

/// Dated versions of the constitution, newest first: { name, path, ts }.
#[tauri::command]
pub(crate) fn ideal_state_versions(vault: String) -> Result<Vec<serde_json::Value>, String> {
    let mut out: Vec<(String, serde_json::Value)> = Vec::new();
    for vdir in [ideal_versions_dir(&vault), legacy_versions_dir(&vault)] {
        if let Ok(it) = read_dir_retry(&vdir) {
            for e in it.flatten() {
                let p = e.path();
                if p.extension().and_then(|s| s.to_str()) != Some("md") { continue; }
                let name = p.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
                let ts = fs::metadata(&p).and_then(|m| m.modified()).ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
                // Sort key: the name's digits (both naming styles are YYYY MM DD h m s).
                let key: String = name.chars().filter(|c| c.is_ascii_digit()).collect();
                out.push((key, serde_json::json!({ "name": name, "path": p.to_string_lossy(), "ts": ts })));
            }
        }
    }
    out.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(out.into_iter().map(|(_, v)| v).collect())
}

/// Read one version's text by the path the list returned (only files in the
/// versions folders are readable this way).
#[tauri::command]
pub(crate) fn ideal_state_version_read(vault: String, path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    let ok = [ideal_versions_dir(&vault), legacy_versions_dir(&vault)].iter().any(|d| p.parent() == Some(d.as_path()));
    if !ok || p.extension().and_then(|s| s.to_str()) != Some("md") {
        return Err("not a version of ideal-state.md".into());
    }
    read_to_string_retry(&p).map_err(|e| e.to_string())
}

#[cfg(test)]
mod version_tests {
    use super::*;

    #[test]
    fn every_save_keeps_the_previous_text_as_a_version() {
        let v = std::env::temp_dir().join(format!("prevail-ideal-{}", std::process::id()));
        let _ = fs::remove_dir_all(&v);
        fs::create_dir_all(v.join("build")).unwrap();
        let vs = v.to_string_lossy().to_string();
        write_ideal_state(vs.clone(), "# One\n".into()).unwrap();
        write_ideal_state(vs.clone(), "# Two\n".into()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        write_ideal_state(vs.clone(), "# Three\n".into()).unwrap();
        let list = ideal_state_versions(vs.clone()).unwrap();
        assert_eq!(list.len(), 2, "the two earlier texts are kept");
        let dir = ideal_versions_dir(&vs);
        assert!(dir.ends_with("build/ideal-state.versions"));
        let texts: Vec<String> = list.iter().map(|x| ideal_state_version_read(vs.clone(), x["path"].as_str().unwrap().into()).unwrap()).collect();
        assert!(texts.contains(&"# One\n".to_string()) && texts.contains(&"# Two\n".to_string()));
        assert_eq!(read_ideal_state(vs.clone()).unwrap(), "# Three\n");
        assert!(ideal_state_version_read(vs.clone(), v.join("build/ideal-state.md").to_string_lossy().into()).is_err());
        let _ = fs::remove_dir_all(&v);
    }
}

// M6: per-domain Ideal State — a `<domain>/ideal-state.md` that targets ONE
// domain, layered under the global ideal-state.md (which still wins conflicts).
// The engine injects it whenever the chat's cwd is that domain (cli-bridge
// findDomainIdeal). domain_dir resolves the v3 (domains/<d>) or legacy layout.
#[tauri::command]
pub(crate) fn read_domain_ideal(vault: String, domain: Option<String>) -> Result<String, String> {
    let p = domain_dir(&vault, &domain).join("ideal-state.md");
    if !p.exists() {
        return Ok(String::new());
    }
    let raw = read_to_string_retry(&p).map_err(|e| e.to_string())?;
    Ok(engine::maybe_decrypt(&p, raw))
}
#[tauri::command]
pub(crate) fn write_domain_ideal(vault: String, domain: Option<String>, body: String) -> Result<(), String> {
    let dir = domain_dir(&vault, &domain);
    let _ = fs::create_dir_all(&dir);
    let p = dir.join("ideal-state.md");
    crate::vaultio::write_atomic(&p, &body).map_err(|e| format!("write domain ideal: {e}"))
}

// Distilled long-term memory for a domain (vault root for General), written
// by the distill daemon. Prepended to prompts like user.md. Empty if none yet.
#[tauri::command]
pub(crate) async fn read_memory_md(vault: String, domain: Option<String>) -> Result<String, String> {
    let p = crate::paths::v4_content_path(&domain_dir(&vault, &domain), "memory/memory.md", "_memory.md");
    if !p.exists() {
        return Ok(String::new());
    }
    read_to_string_retry(&p).map_err(|e| e.to_string())
}

/// X10: pin a fact into the domain's layered memory. Appends a dated bullet under
/// a "Pinned by you" section of `_memory.md` so it grounds every future answer
/// in that domain, alongside the daemon-distilled memory. User-authored, so it is
/// never overwritten by distillation (which manages its own section).
#[tauri::command]
pub(crate) fn append_memory_md(vault: String, domain: Option<String>, note: String) -> Result<(), String> {
    let note = note.trim();
    if note.is_empty() {
        return Err("nothing to pin".into());
    }
    let dir = domain_dir(&vault, &domain);
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir domain: {e}"))?;
    let p = crate::paths::v4_content_path(&dir, "memory/memory.md", "_memory.md");
    let existing = if p.exists() { read_to_string_retry(&p).unwrap_or_default() } else { String::new() };
    const HEADER: &str = "## Pinned by you";
    let date = crate::tasks::today_ymd();
    // One-line bullets; collapse newlines so the entry stays a single item.
    let entry = format!("- {} ({})", note.replace('\n', " "), date);
    let next = if existing.contains(HEADER) {
        // Insert the new bullet right after the header line.
        let mut out = String::with_capacity(existing.len() + entry.len() + 1);
        let mut inserted = false;
        for line in existing.lines() {
            out.push_str(line);
            out.push('\n');
            if !inserted && line.trim() == HEADER {
                out.push_str(&entry);
                out.push('\n');
                inserted = true;
            }
        }
        out
    } else {
        let sep = if existing.is_empty() || existing.ends_with('\n') { "" } else { "\n" };
        format!("{existing}{sep}\n{HEADER}\n{entry}\n")
    };
    crate::vaultio::write_atomic(&p, &next).map_err(|e| format!("write _memory.md: {e}"))
}

