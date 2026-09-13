// WebUI bridge server — serve the SAME frontend bundle to a browser and
// proxy its IPC to the running desktop window. No duplicate UI: the browser
// loads the embedded assets, and every invoke()/event flows over HTTP+SSE to
// the host window, which executes commands via the real Tauri runtime
// (webview-proxy). Reach it remotely via Tailscale/Cloudflare.
//
// Flow:
//   browser  --POST /api/invoke {cmd,args}-->  this server
//   server   --emit "webui:invoke" {id,cmd,args}-->  host window
//   host     runs invoke(cmd,args), then  invoke("webui_resolve",{id,...})
//   server   <--resolve--  unblocks the request, responds {data|error}
//   events:  host forwards Tauri events via invoke("webui_event",{event,payload})
//            -> broadcast to all /api/events SSE clients.

use std::collections::HashMap;
use std::io::Read;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Emitter;

// Deny-by-default allowlist of commands a REMOTE web client may invoke. Only
// the read + chat + thread-persistence surface needed to USE Prevail — never
// secrets (provider_key_*), arbitrary file I/O (read/write_text_file, read_file),
// destructive/admin ops (app_uninstall, webui_start/stop, *_vault_*, ingestion_*,
// telegram_*), or the host→server callbacks (webui_resolve/event).
const WEBUI_ALLOWED: &[&str] = &[
    // vault / domains / skills (read)
    "scan_vault", "engine_domains", "domain_context", "read_domain_prompts", "scan_skills", "skill_create", "read_skill",
    // vault bootstrap — let the browser inherit the desktop's current vault
    // (skip onboarding) and seed the bundled sample if the user asks. These
    // read/return paths only; they don't expose arbitrary file I/O. (B5/B6)
    "bootstrap_vault", "import_sample_vault",
    // chat
    "chat_send", "engine_chat", "abort_sessions", "detect_clis",
    // threads
    "list_threads", "load_thread", "save_thread", "rename_thread", "delete_thread", "save_session",
    // memory / profile (read)
    "read_user_md", "read_memory_md",
    // self-learning ledger
    "intent_append", "intents_read", "journal_append", "usage_append", "usage_summary",
    // usage analytics — domain-scoped roll-up for the per-domain Usage tab (read)
    "usage_summary_domain",
    // demo/production mode — read-only over the web so the browser shows the
    // demo badge. Switching mode (a write) stays desktop-only.
    "engine_appmode_get",
    "decision_append", "decisions_read", "decision_feedback",
    // proactive surface + per-domain tasks/goals (read vault + model + checklist)
    "domain_surface", "tasks_read", "tasks_set", "tasks_add",
    // scores (read)
    "engine_score", "engine_score_all", "engine_score_history", "engine_manifest_get",
    // benchmark (read)
    "benchmark_runs", "benchmark_run_detail", "benchmark_questions", "benchmark_matrix",
    // status
    "webui_status",
    // cross-device UI settings (theme/palette) — read + write so the browser
    // both inherits the desktop look and can change it. Not secrets.
    "ui_settings_get", "ui_settings_set",
    // cross-device UI prefs (pins, model picks, per-domain toggles)
    "ui_prefs_get", "ui_prefs_set",
    // Bunker Mode: read-only status for the ribbon/card. bunker_set is
    // deliberately NOT exposed — a remote browser must never be able to
    // disable the local-only trust guarantee.
    "bunker_status",
    // Phone voice: transcribe a recording the browser uploaded to
    // /api/upload-audio (the command only accepts files in that staging dir,
    // never a path the client picks), and file the transcript as a voice note
    // in the current domain. Both run on this Mac, never a cloud service.
    "transcribe_audio", "voice_note_capture",

    // ── Read-only surfaces the phone needs to be the same app ─────────────
    // Every entry below RETURNS data and changes nothing. Without them the
    // phone rendered empty or broken panels on screens the desktop fills in,
    // which is what "not all the features are there on mobile" was.
    // Work: the board, its counts, insights, spark, calendar and the approval
    // queues. Reading what needs attention is safe; APPROVING is deliberately
    // not here, so an act that leaves this Mac still takes the Mac.
    "tasks_read_all", "work_count", "engine_recommendations", "spark_archive_read",
    "decisions_pending", "engine_gws_pending_list", "engine_acts_pending",
    // Context: ideals, omega, their version history, and the alignment read.
    "read_ideal_state", "read_domain_ideal", "read_omega",
    "ideal_state_versions", "omega_versions", "engine_alignment",
    // Intents + prompt capture (the self-learning ledger, read side).
    "intents_read_all", "intents_distilled_read", "capture_prompts_read", "capture_status",
    // Apps / connectors: the list, its logos, per-domain import counts, and the
    // read-only audit trail. app_favicon fetches one host's /favicon.ico so app
    // rows carry real brand marks instead of letter tiles.
    "engine_apps_list", "app_favicon", "ingestion_connector_catalog", "ingestion_connector_logos",
    "ingestion_domain_stats", "ingestion_list_artifacts", "ingestion_status",
    "ingestion_audit_tail", "ingestion_mcp_list", "mcp_install_status",
    // Daemons + activity: status readouts and the activity feed.
    "distill_status", "taskgen_status", "skillgen_status", "intent_daemon_status",
    "reminders_daemon_status", "headless_learn_status", "activity_read",
    "engine_skills_report", "telegram_bridge_status", "hooks_read",
    // Usage + retrospect analytics (the same numbers the desktop shows).
    "usage_entries", "retrospect_rollup",
    // Settings the phone displays read-only: which machine this is, whether the
    // vault lock and the two egress guardrails are on, the auto-council setting,
    // the Google profiles' connection health, and the live model catalog.
    // provider_key_exists answers a BOOLEAN ("is a key set for this vendor") and
    // never returns key material; provider_key_get/set/del stay desktop-only.
    "machine_role_get", "vault_lock_status", "email_policy_get", "egress_guard_get",
    "get_auto_council", "google_profiles", "engine_discover_models", "provider_key_exists",
    "ingestion_cli_providers", "ingestion_cli_probe",
    // An app's own description, and the connectors a runtime advertises. Both
    // read; both are what the Apps detail pane shows.
    "engine_app_get_soul", "discover_runtime_connectors", "engine_app_skills",
    // The rest of what an app's detail tabs READ: its context bundle, the files
    // it has pulled, which apps are due a sync, and which of your runtimes
    // already carry it as a connector. Everything that CHANGES an app stays
    // desktop-only - adding, removing, running a skill, setting its schedule,
    // domains, runtime or soul, and every gateway command that holds a key.
    "app_context", "app_data_files", "engine_apps_sync_due", "harness_connections_scan",
];

/// Commands that read a file by path. They are allowed over the web ONLY when
/// the path resolves inside the Mac's active vault, which is checked here at
/// the boundary rather than trusted from the client. Without the check these
/// would be an arbitrary-read hole (a phone asking for ~/.ssh/id_rsa); without
/// allowing them at all, notes, loops, domain files and imported documents are
/// blank on the phone.
const WEBUI_VAULT_SCOPED_READ: &[&str] = &["read_file", "read_text_file"];

/// Commands that WRITE a file by path. A vault-wide write would be an
/// escalation, not a convenience: the vault holds `_loops.json` automations and
/// skill bodies that this Mac later executes on its own, so a phone able to
/// write anywhere in it could schedule work rather than just record it. These
/// are therefore pinned to exact vault-relative files the phone genuinely
/// edits, nothing else.
const WEBUI_VAULT_SCOPED_WRITE: &[&str] = &["write_text_file"];
/// The only paths a web client may write, relative to the vault root.
const WEBUI_WRITABLE_VAULT_FILES: &[&str] = &["build/notes.json"];

/// True when `args.path` points inside the active vault. The existing part of
/// the path is canonicalized, so `..` is rejected outright and a symlink that
/// leaves the vault is refused rather than followed. A path that does not exist
/// yet still resolves (its nearest real ancestor is what gets checked), so a
/// domain without a `_loops.json` reads as "no such file" rather than as a
/// permission error.
fn vault_scoped_read_ok(args: &serde_json::Value) -> bool {
    vault_path_arg(args).is_some()
}

/// The same containment check, plus: the file must be one of the few the phone
/// is allowed to write.
fn vault_scoped_write_ok(args: &serde_json::Value) -> bool {
    let Some((root, target)) = vault_path_arg(args) else { return false };
    WEBUI_WRITABLE_VAULT_FILES.iter().any(|rel| root.join(rel) == target)
}

/// Resolve `args.path` against the vault, returning (vault root, resolved path)
/// only when the result is inside the vault.
fn vault_path_arg(args: &serde_json::Value) -> Option<(std::path::PathBuf, std::path::PathBuf)> {
    let raw = args.get("path").and_then(|v| v.as_str())?;
    let vault = crate::appcmds::bootstrap_vault()?;
    let root = std::fs::canonicalize(&vault).ok()?;
    let target = resolve_existing_prefix(std::path::Path::new(raw))?;
    if path_inside(&root, &target) { Some((root, target)) } else { None }
}

/// Canonicalize as much of `p` as exists and re-append the rest. Any `..`
/// component makes this refuse outright, which is what keeps re-appending the
/// non-existent tail sound.
fn resolve_existing_prefix(p: &std::path::Path) -> Option<std::path::PathBuf> {
    use std::path::Component;
    if !p.is_absolute() || p.components().any(|c| matches!(c, Component::ParentDir)) {
        return None;
    }
    let mut base = p;
    let mut tail: Vec<&std::ffi::OsStr> = Vec::new();
    loop {
        if let Ok(real) = std::fs::canonicalize(base) {
            let mut out = real;
            for t in tail.iter().rev() {
                out.push(t);
            }
            return Some(out);
        }
        tail.push(base.file_name()?);
        base = base.parent()?;
    }
}

/// Containment test on already-canonical paths. Compares whole components, so
/// "/vault-evil" is not treated as living inside "/vault".
fn path_inside(root: &std::path::Path, target: &std::path::Path) -> bool {
    let mut r = root.components();
    let mut t = target.components();
    loop {
        match (r.next(), t.next()) {
            (None, _) => return true,          // ran out of root → target is deeper
            (Some(_), None) => return false,   // target is shorter than root
            (Some(a), Some(b)) if a == b => continue,
            _ => return false,
        }
    }
}

#[derive(Default)]
pub struct WebuiState {
    inner: Mutex<Inner>,
}
#[derive(Default)]
struct Inner {
    running: bool,
    port: u16,
    user: String,
    pass: String,
    // Remote-devices mode: bound to every interface instead of loopback, so a
    // phone on the same Wi-Fi (or the tailnet) can reach it with zero setup.
    remote: bool,
    // The addresses other devices can use, each empty when unavailable: the
    // primary LAN IPv4 and the Tailscale IPv4.
    lan_host: String,
    ts_host: String,
    // The "Share over the internet" tunnel, shared with the request thread so
    // its hostname passes the Host check the moment it exists.
    tunnel: Arc<Mutex<Tunnel>>,
    // The outstanding QR pairing code, shared with the request thread. At most
    // one exists at a time: minting replaces, scanning consumes.
    pair: Arc<Mutex<Option<PairCode>>>,
    // One entry per signed-in device. Each holds its OWN bearer token, which
    // is what makes "disconnect this phone" mean anything: revoking one does
    // not touch the others.
    sessions: Arc<Mutex<Vec<Session>>>,
    next_id: Arc<AtomicU64>,
    pending: Arc<Mutex<HashMap<u64, Sender<InvokeOut>>>>,
    sse: Arc<Mutex<Vec<Sender<String>>>>,
    stop: Option<Arc<std::net::TcpListener>>, // kept to unblock accept on stop
}

// How long a QR pairing code stays good. Scanning a code that is on the screen
// in front of you takes seconds, so this is deliberately short: the window in
// which a photograph of the screen (or a glance across a room) is still worth
// anything is two minutes, not ten. The Phone screen mints a fresh code
// whenever the old one lapses, so the QR on screen is always scannable.
const PAIR_TTL: Duration = Duration::from_secs(120);

// A one-shot credential carried in the QR code, so a phone never has to type
// the password on a touch keyboard. It is NOT the password: it is a random
// 32-byte value that buys exactly one session token and is destroyed on use,
// which is why it is safe to put in a QR code that someone might photograph.
// It rides in the URL fragment, which browsers never send to a server, so it
// stays out of request logs and out of the Cloudflare tunnel.
struct PairCode {
    code: String,
    expires: Instant,
}

impl PairCode {
    fn live(&self) -> bool {
        Instant::now() < self.expires
    }
}

/// A signed-in device. The token never leaves the Mac in this struct: it is
/// skipped on the way to the UI, which addresses a device by its short id.
#[derive(Clone, Serialize)]
pub struct Session {
    pub id: String,
    #[serde(skip)]
    pub token: String,
    /// Something a person can recognise, read off the User-Agent.
    pub label: String,
    pub ip: String,
    pub first_seen_ms: u64,
    pub last_seen_ms: u64,
    /// How it got in: "qr" or "password".
    pub via: String,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// A short, human name for a device from its User-Agent. Not exact science,
/// and it does not need to be: it only has to let someone tell their phone
/// from their laptop in a list of two or three.
pub(crate) fn device_label(ua: &str) -> String {
    let u = ua.to_ascii_lowercase();
    let device = if u.contains("ipad") { "iPad" }
        else if u.contains("iphone") { "iPhone" }
        else if u.contains("android") { "Android phone" }
        else if u.contains("mac os") || u.contains("macintosh") { "Mac" }
        else if u.contains("windows") { "Windows PC" }
        else if u.contains("linux") { "Linux" }
        else { "Device" };
    // Chrome and Edge both claim Safari, and Edge claims Chrome, so test the
    // most specific first.
    let browser = if u.contains("edg/") { Some("Edge") }
        else if u.contains("crios") || u.contains("chrome") { Some("Chrome") }
        else if u.contains("firefox") || u.contains("fxios") { Some("Firefox") }
        else if u.contains("safari") { Some("Safari") }
        else { None };
    match browser {
        Some(b) => format!("{device} ({b})"),
        None => device.to_string(),
    }
}

// A Cloudflare quick tunnel (`cloudflared tunnel --url ...`): a public https
// address that forwards to the bridge on loopback. No account, no DNS, no
// router setup, and https is what lets a phone browser use its microphone
// (getUserMedia needs a secure context; plain http://192.168.x.x cannot).
// The hostname is random and changes every time the tunnel starts.
#[derive(Default)]
struct Tunnel {
    state: TunnelState,
    url: String,
    host: String,
    error: String,
    pid: Option<u32>,
}

#[derive(Default, Clone, Copy, PartialEq, Eq)]
enum TunnelState {
    #[default]
    Off,
    Starting,
    On,
    Error,
}

impl TunnelState {
    fn as_str(self) -> &'static str {
        match self {
            TunnelState::Off => "off",
            TunnelState::Starting => "starting",
            TunnelState::On => "on",
            TunnelState::Error => "error",
        }
    }
}

#[derive(Clone, Serialize)]
pub struct WebuiStatus {
    pub running: bool,
    pub port: u16,
    pub user: String,
    pub remote: bool,
    // The address to put in the QR: the tunnel when it is up (works from
    // anywhere, https), else the LAN address, else Tailscale. Empty when the
    // bridge is loopback-only and no tunnel is running.
    pub remote_url: String,
    // True when remote_url is a Tailscale (100.64/10) address, i.e. traffic
    // is WireGuard-encrypted end to end.
    pub via_tailscale: bool,
    // Every way in, each empty when unavailable.
    pub lan_url: String,
    pub tailscale_url: String,
    pub tunnel_url: String,
    // "off" | "starting" | "on" | "error", plus the last cloudflared line on error.
    pub tunnel_state: String,
    pub tunnel_error: String,
    // Whether `cloudflared` is installed (brew install cloudflared).
    pub cloudflared_installed: bool,
    /// Every device signed in right now, newest first.
    pub devices: Vec<Session>,
    /// True when Bunker Mode is on, which keeps the bridge on loopback: a
    /// phone on the network is another way off this device, and Bunker's
    /// whole promise is that nothing leaves it.
    pub bunker_blocking: bool,
    // True while a QR pairing code is outstanding. Goes false the moment a
    // phone uses it, which is how the pairing card knows to show a fresh code
    // (and that the phone got in).
    pub pair_ready: bool,
}

// The machine's Tailscale IPv4, if the Tailscale app or CLI is installed and
// connected. Tried first when remote mode is on: binding to that one address
// keeps the bridge off the public interface while making it reachable from
// every device on the user's tailnet, with transport encryption for free.
fn tailscale_ipv4() -> Option<String> {
    let candidates = [
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        "tailscale",
    ];
    for bin in candidates {
        let out = std::process::Command::new(bin).args(["ip", "-4"]).output();
        if let Ok(o) = out {
            if o.status.success() {
                let s = String::from_utf8_lossy(&o.stdout);
                if let Some(ip) = s.lines().map(str::trim).find(|l| is_tailscale_ip(l)) {
                    return Some(ip.to_string());
                }
            }
        }
    }
    None
}

fn parse_ipv4(s: &str) -> Option<[u8; 4]> {
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    let mut out = [0u8; 4];
    for (i, p) in parts.iter().enumerate() {
        out[i] = p.parse::<u8>().ok()?;
    }
    Some(out)
}

// 100.64.0.0/10, the CGNAT range Tailscale hands out.
fn is_tailscale_ip(s: &str) -> bool {
    matches!(parse_ipv4(s), Some([100, b, _, _]) if (64..=127).contains(&b))
}

// RFC 1918 private ranges: what a phone on the same Wi-Fi would use.
fn is_private_lan_ip(s: &str) -> bool {
    match parse_ipv4(s) {
        Some([10, _, _, _]) => true,
        Some([172, b, _, _]) => (16..=31).contains(&b),
        Some([192, 168, _, _]) => true,
        _ => false,
    }
}

#[derive(Clone)]
struct InvokeOut {
    ok: bool,
    data: serde_json::Value,
    error: String,
}

// 32 random bytes from the OS CSPRNG, hex-encoded. Falls back to a SHA256 of
// high-res time only if /dev/urandom is unreadable (extremely unlikely on macOS).
fn random_token() -> String {
    use std::io::Read;
    let mut buf = [0u8; 32];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        if f.read_exact(&mut buf).is_ok() {
            return buf.iter().map(|b| format!("{b:02x}")).collect();
        }
    }
    let mut h = Sha256::new();
    h.update(format!("{:?}", std::time::SystemTime::now()).as_bytes());
    format!("{:x}", h.finalize())
}

// How long a signed-in device stays signed in without being heard from. Long
// enough that a phone used every few days never asks again; short enough that
// a token on a device that was lost or replaced expires on its own.
const SESSION_IDLE_MAX_MS: u64 = 30 * 24 * 60 * 60 * 1000;

fn session_live(last_seen_ms: u64, now_ms: u64) -> bool {
    now_ms.saturating_sub(last_seen_ms) <= SESSION_IDLE_MAX_MS
}

// Constant-time string comparison (avoids timing oracles on the token).
fn ct_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

#[derive(Deserialize)]
struct InvokeReq {
    cmd: String,
    #[serde(default)]
    args: serde_json::Value,
}

impl WebuiState {
    pub fn status(&self) -> WebuiStatus {
        let i = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let url_for = |host: &str| if i.running && i.remote && !host.is_empty() { format!("http://{host}:{}", i.port) } else { String::new() };
        let lan_url = url_for(&i.lan_host);
        let tailscale_url = url_for(&i.ts_host);
        let (tunnel_url, tunnel_state, tunnel_error) = {
            let t = i.tunnel.lock().unwrap_or_else(|e| e.into_inner());
            let url = if t.state == TunnelState::On { t.url.clone() } else { String::new() };
            (url, t.state.as_str().to_string(), t.error.clone())
        };
        let pair_ready = { i.pair.lock().unwrap_or_else(|e| e.into_inner()).as_ref().is_some_and(PairCode::live) };
        let remote_url = [&tunnel_url, &lan_url, &tailscale_url].into_iter().find(|u| !u.is_empty()).cloned().unwrap_or_default();
        let via_tailscale = !remote_url.is_empty() && remote_url == tailscale_url;
        WebuiStatus {
            running: i.running,
            port: i.port,
            user: i.user.clone(),
            remote: i.remote,
            remote_url,
            via_tailscale,
            lan_url,
            tailscale_url,
            tunnel_url,
            tunnel_state,
            tunnel_error,
            cloudflared_installed: cloudflared_bin().is_some(),
            bunker_blocking: crate::bunker::bunker_enabled(),
            devices: {
                let mut d = i.sessions.lock().unwrap_or_else(|e| e.into_inner()).clone();
                d.sort_by(|a, b| b.last_seen_ms.cmp(&a.last_seen_ms));
                d
            },
            pair_ready,
        }
    }

    /// Mint a fresh QR pairing code, replacing any outstanding one, and return
    /// the URL to put in the QR: the phone address with the code in the
    /// fragment. Desktop-only by design.
    pub fn mint_pair_code(&self) -> Result<String, String> {
        let status = self.status();
        if !status.running {
            return Err("turn on phone access first".into());
        }
        let base = if status.remote_url.is_empty() {
            return Err("no phone address yet: turn on \"Reachable from other devices\" or share over the internet".into());
        } else {
            status.remote_url
        };
        let code = random_token();
        {
            let i = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            let mut p = i.pair.lock().unwrap_or_else(|e| e.into_inner());
            *p = Some(PairCode { code: code.clone(), expires: Instant::now() + PAIR_TTL });
        }
        Ok(format!("{base}/#p={code}"))
    }

    /// Sign one device out. Its very next request fails the token check.
    pub fn revoke_device(&self, id: &str) {
        let i = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        i.sessions.lock().unwrap_or_else(|e| e.into_inner()).retain(|s| s.id != id);
    }

    /// Sign every device out, and drop any pairing code with them so the act
    /// of revoking cannot be immediately undone by a code still on screen.
    pub fn revoke_all_devices(&self) {
        let i = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        i.sessions.lock().unwrap_or_else(|e| e.into_inner()).clear();
        *i.pair.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    /// Drop any outstanding pairing code (the card closed, or the user asked).
    pub fn clear_pair_code(&self) {
        let i = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let mut p = i.pair.lock().unwrap_or_else(|e| e.into_inner());
        *p = None;
    }

    pub fn stop(&self) {
        let tunnel = {
            let mut i = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            i.running = false;
            i.stop = None; // dropping the listener Arc lets the accept loop error out
            // A code minted for a server that is gone must not survive to let
            // someone in after it comes back.
            *i.pair.lock().unwrap_or_else(|e| e.into_inner()) = None;
            i.sessions.lock().unwrap_or_else(|e| e.into_inner()).clear();
            i.tunnel.clone()
        };
        // Nothing to forward to once the bridge is down.
        stop_tunnel(&tunnel);
    }

    /// Kill the tunnel process, if any. Called on the stop toggle and on app
    /// exit: cloudflared is a separate process and would otherwise keep the
    /// public hostname pointed at a dead port.
    pub fn stop_tunnel(&self) {
        let tunnel = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).tunnel.clone() };
        stop_tunnel(&tunnel);
    }


    // Resolve a pending browser invoke with the host window's result.
    fn resolve(&self, id: u64, out: InvokeOut) {
        let pending = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).pending.clone() };
        let tx = pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
        if let Some(tx) = tx {
            let _ = tx.send(out);
        }
    }

    // Broadcast a host event to every connected SSE client.
    pub fn broadcast(&self, event: &str, payload: &serde_json::Value) {
        let sse = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).sse.clone() };
        let frame = format!(
            "data: {}\n\n",
            serde_json::json!({ "event": event, "payload": payload })
        );
        let mut clients = sse.lock().unwrap_or_else(|e| e.into_inner());
        clients.retain(|tx| tx.send(frame.clone()).is_ok());
    }

    pub fn start(&self, app: tauri::AppHandle, port: u16, user: String, pass: String, remote: bool) -> Result<(), String> {
        self.stop();
        // Random per-session token (NOT derived from the password). Login
        // exchanges user/pass for this token; it never leaves the device except
        // to the authenticated client.
        // Loopback only by default. In remote-devices mode, bind every
        // interface so a phone on the same Wi-Fi reaches it with nothing
        // installed, and a Tailscale peer reaches it too. (Binding only the
        // Tailscale address, as before, silently left the LAN out: a phone
        // without Tailscale got connection refused.) What keeps this safe is
        // not the bind address but the Host check in handle(), the login, and
        // the random bearer token; the Host check is widened to match, so the
        // DNS-rebinding defense stays intact.
        // Bunker Mode overrides the request: loopback only, whatever the
        // toggle says. Enforced HERE, at the bind, rather than by hiding a
        // button, so it holds however the start was triggered.
        let remote = remote && !crate::bunker::bunker_enabled();
        let (bind_host, lan_host, ts_host): (String, String, String) = if remote {
            ("0.0.0.0".to_string(), lan_ipv4().unwrap_or_default(), tailscale_ipv4().unwrap_or_default())
        } else {
            ("127.0.0.1".to_string(), String::new(), String::new())
        };
        let listener = std::net::TcpListener::bind((bind_host.as_str(), port)).map_err(|e| format!("bind {bind_host}:{port}: {e}"))?;
        let server = tiny_http::Server::from_listener(listener.try_clone().map_err(|e| e.to_string())?, None)
            .map_err(|e| e.to_string())?;
        {
            let mut i = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            i.running = true;
            i.port = port;
            i.user = user.clone();
            i.pass = pass.clone();
            i.remote = remote;
            i.lan_host = lan_host.clone();
            i.ts_host = ts_host.clone();
            i.stop = Some(Arc::new(listener));
        }
        let allow_remote = remote;
        let advertised_hosts = [lan_host, ts_host];
        let next_id = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).next_id.clone() };
        let pending = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).pending.clone() };
        let sse = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).sse.clone() };
        let tunnel = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).tunnel.clone() };
        let pair = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).pair.clone() };
        let sessions = { self.inner.lock().unwrap_or_else(|e| e.into_inner()).sessions.clone() };
        // A restart invalidates every device: tokens are per-run, and a list
        // of phones that cannot actually talk to us is a lie on screen.
        sessions.lock().unwrap_or_else(|e| e.into_inner()).clear();
        // Failed-login throttle (M1): count + window-start, shared across
        // requests. Blocks brute force even if a DNS-rebind gets same-origin.
        let login_fail: Arc<Mutex<(u32, Instant)>> = Arc::new(Mutex::new((0, Instant::now())));
        let bound_port = port;

        // One thread PER REQUEST. tiny_http's incoming_requests() is sequential,
        // and two of our responses are long-lived: the SSE stream never ends,
        // and a proxied invoke waits on the host window for up to five minutes.
        // Handling them on the accept loop meant a single connected phone
        // wedged the whole bridge — every later request connected and then got
        // nothing, which is exactly what a second phone (or a reloaded tab) hit.
        // It is also what multiple devices need in order to work at all.
        let server = Arc::new(server);
        let inflight = Arc::new(AtomicU64::new(0));
        std::thread::spawn(move || {
            loop {
                let req = match server.recv() {
                    Ok(r) => r,
                    Err(_) => break, // listener dropped on stop()
                };
                // A cap so a misbehaving client cannot spawn threads without
                // bound. Well above any real number of phones plus their
                // event streams.
                if inflight.load(Ordering::SeqCst) >= 64 {
                    let _ = req.respond(json_response(503, &serde_json::json!({ "error": "too many requests in flight" })));
                    continue;
                }
                inflight.fetch_add(1, Ordering::SeqCst);
                let (app, user, pass) = (app.clone(), user.clone(), pass.clone());
                let (next_id, pending, sse, login_fail) = (next_id.clone(), pending.clone(), sse.clone(), login_fail.clone());
                let (tunnel, pair, sessions) = (tunnel.clone(), pair.clone(), sessions.clone());
                let advertised_hosts = advertised_hosts.clone();
                let inflight_done = inflight.clone();
                std::thread::spawn(move || {
                    let tunnel_host = { tunnel.lock().unwrap_or_else(|e| e.into_inner()).host.clone() };
                    handle(&app, req, &user, &pass, &next_id, &pending, &sse, &login_fail, bound_port, allow_remote, &advertised_hosts, &tunnel_host, &pair, &sessions);
                    inflight_done.fetch_sub(1, Ordering::SeqCst);
                });
            }
        });
        Ok(())
    }
}

/// Start a Cloudflare quick tunnel to the running bridge and wait (up to
/// ~25 s) for its public https address. Restarts an existing tunnel. A free
/// function over the shared tunnel record so the Tauri command can run it on
/// a blocking thread without holding the app state.
fn start_tunnel_blocking(tunnel: Arc<Mutex<Tunnel>>, (port, running): (u16, bool)) -> Result<(), String> {
    if !running {
        return Err("turn on the WebUI first".into());
    }
    if crate::bunker::bunker_enabled() {
        return Err("Bunker Mode is on, so nothing may leave this Mac. Turn it off in Privacy to share over the internet.".into());
    }
    let bin = cloudflared_bin().ok_or_else(|| "cloudflared is not installed. In Terminal: brew install cloudflared".to_string())?;
    stop_tunnel(&tunnel);

    let mut child = std::process::Command::new(bin)
        .args(["tunnel", "--no-autoupdate", "--url"])
        .arg(format!("http://127.0.0.1:{port}"))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("start cloudflared: {e}"))?;
    let pid = child.id();
    {
        let mut t = tunnel.lock().unwrap_or_else(|e| e.into_inner());
        *t = Tunnel { state: TunnelState::Starting, pid: Some(pid), ..Default::default() };
    }
    crate::children::register_child("webui-tunnel", pid);

    // cloudflared prints its progress (and the assigned hostname) on
    // stderr. Drain it for the life of the process so the pipe never fills,
    // and flip the state when the URL shows up or the process dies.
    let stderr = child.stderr.take();
    let t2 = tunnel.clone();
    std::thread::spawn(move || {
        use std::io::BufRead;
        let mut last_line = String::new();
        if let Some(err) = stderr {
            for line in std::io::BufReader::new(err).lines().map_while(Result::ok) {
                let trimmed = line.trim();
                if trimmed.is_empty() { continue; }
                last_line = trimmed.to_string();
                if let Some(url) = extract_tunnel_url(trimmed) {
                    let mut t = t2.lock().unwrap_or_else(|e| e.into_inner());
                    if t.pid == Some(pid) {
                        t.host = url.trim_start_matches("https://").to_ascii_lowercase();
                        t.url = url;
                        t.state = TunnelState::On;
                        t.error.clear();
                    }
                }
            }
        }
        let _ = child.wait();
        crate::children::unregister_child("webui-tunnel");
        let mut t = t2.lock().unwrap_or_else(|e| e.into_inner());
        // A deliberate stop already reset the record; only an unexpected
        // exit (no internet, Cloudflare refused) is an error.
        if t.pid == Some(pid) {
            t.pid = None;
            t.url.clear();
            t.host.clear();
            t.state = TunnelState::Error;
            t.error = if last_line.is_empty() { "cloudflared exited".into() } else { tidy_cloudflared_line(&last_line) };
        }
    });

    // Quick tunnels usually answer within a few seconds; give slow links
    // room but never hang the settings screen.
    let deadline = Instant::now() + Duration::from_secs(25);
    loop {
        {
            let t = tunnel.lock().unwrap_or_else(|e| e.into_inner());
            match t.state {
                TunnelState::On => return Ok(()),
                TunnelState::Error => return Err(t.error.clone()),
                _ => {}
            }
        }
        if Instant::now() > deadline {
            stop_tunnel(&tunnel);
            return Err("cloudflared did not hand out an address in time. Check the internet connection and try again.".into());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn cloudflared_bin() -> Option<std::path::PathBuf> {
    crate::voice::find_bin(&["cloudflared"])
}

/// The public address in a cloudflared log line, e.g.
/// `... |  https://witty-otter-cat.trycloudflare.com  |`. Only the
/// trycloudflare.com host is accepted: that is the one hostname a quick
/// tunnel can have, so a stray URL in some other log line never becomes an
/// allowed Host.
pub(crate) fn extract_tunnel_url(line: &str) -> Option<String> {
    let start = line.find("https://")?;
    let rest = &line[start + "https://".len()..];
    let end = rest.find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '.')).unwrap_or(rest.len());
    let host = &rest[..end];
    if host.ends_with(".trycloudflare.com") && host.len() > ".trycloudflare.com".len() {
        Some(format!("https://{host}"))
    } else {
        None
    }
}

/// cloudflared log lines are `2026-09-12T10:00:00Z ERR message key=value`;
/// keep the message, drop the timestamp and level for the settings screen.
fn tidy_cloudflared_line(line: &str) -> String {
    let mut parts = line.splitn(3, ' ');
    let ts = parts.next().unwrap_or("");
    let level = parts.next().unwrap_or("");
    let looks_structured = ts.contains('T') && level.chars().all(|c| c.is_ascii_uppercase()) && !level.is_empty();
    if looks_structured {
        parts.next().unwrap_or(line).to_string()
    } else {
        line.to_string()
    }
}

fn stop_tunnel(tunnel: &Arc<Mutex<Tunnel>>) {
    let pid = {
        let mut t = tunnel.lock().unwrap_or_else(|e| e.into_inner());
        let pid = t.pid.take();
        *t = Tunnel::default();
        pid
    };
    if let Some(pid) = pid {
        #[cfg(unix)]
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
        crate::children::unregister_child("webui-tunnel");
    }
}

// Best-effort primary LAN IPv4 (for the advertised URL when Tailscale is not
// installed). Reads `ipconfig getifaddr` on the usual interfaces; None if the
// machine has no private address.
fn lan_ipv4() -> Option<String> {
    for iface in ["en0", "en1", "en2", "en3"] {
        if let Ok(o) = std::process::Command::new("ipconfig").args(["getifaddr", iface]).output() {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if is_private_lan_ip(&s) {
                return Some(s);
            }
        }
    }
    None
}

#[allow(clippy::too_many_arguments)]
fn handle(
    app: &tauri::AppHandle,
    mut req: tiny_http::Request,
    user: &str,
    pass: &str,
    next_id: &Arc<AtomicU64>,
    pending: &Arc<Mutex<HashMap<u64, Sender<InvokeOut>>>>,
    sse: &Arc<Mutex<Vec<Sender<String>>>>,
    login_fail: &Arc<Mutex<(u32, Instant)>>,
    bound_port: u16,
    allow_remote: bool,
    advertised_hosts: &[String; 2],
    tunnel_host: &str,
    pair: &Arc<Mutex<Option<PairCode>>>,
    sessions: &Arc<Mutex<Vec<Session>>>,
) {
    let method = req.method().clone();
    let url = req.url().to_string();
    let path = url.split('?').next().unwrap_or("/").to_string();

    // DNS-rebinding defense (M1): a webpage the user visits can rebind its OWN
    // hostname to this bridge's address and become same-origin. Reject any
    // request whose Host header is not an address we legitimately serve on
    // (loopback; in remote mode also the advertised addresses, any Tailscale
    // or RFC 1918 address, and *.ts.net MagicDNS names; and the exact
    // trycloudflare.com hostname while a tunnel is up), so a rebound attacker
    // hostname can't drive the API even though the socket is reachable.
    {
        let host = req.headers().iter()
            .find(|h| h.field.equiv("Host"))
            .map(|h| h.value.as_str().to_string())
            .unwrap_or_default();
        let hostname = host.split(':').next().unwrap_or("").to_ascii_lowercase();
        let ok_host = host_allowed(&hostname, allow_remote, advertised_hosts, tunnel_host);
        // If a port is present it must match ours (defense in depth). The
        // tunnel arrives without one (https on 443, cloudflared forwards the
        // original Host), which the None arm accepts.
        let ok_port = match host.rsplit(':').next().and_then(|p| p.parse::<u16>().ok()) {
            Some(p) => p == bound_port,
            None => true,
        };
        if !ok_host || !ok_port {
            let _ = req.respond(json_response(403, &serde_json::json!({ "error": "forbidden host" })));
            return;
        }
    }

    // Header bearer OR ?token= query (EventSource cannot set headers). Each
    // signed-in device has its OWN token, so this walks the session list; a
    // revoked device simply stops matching and gets a 401 on its next request.
    let offered: String = req.headers().iter()
        .find(|h| h.field.equiv("Authorization"))
        .map(|h| h.value.as_str().to_string())
        .filter(|v| !v.is_empty())
        .or_else(|| url.split('?').nth(1).and_then(|q| q.split('&').find_map(|kv| kv.strip_prefix("token=").map(str::to_string))))
        .unwrap_or_default();
    let authed = || -> bool {
        if offered.is_empty() { return false; }
        let mut list = sessions.lock().unwrap_or_else(|e| e.into_inner());
        let now = now_ms();
        // A device that has not been heard from in a month is signed out on its
        // own, so a phone lost months ago does not stay a key to this Mac.
        list.retain(|s| session_live(s.last_seen_ms, now));
        for sess in list.iter_mut() {
            if ct_eq(&offered, &sess.token) {
                sess.last_seen_ms = now;
                return true;
            }
        }
        false
    };

    // ── Login ──
    if path == "/api/login" && method == tiny_http::Method::Post {
        // Exponential-ish lockout (M1): after 5 failures in a 5-minute window,
        // reject further attempts until the window rolls. Stops offline-speed
        // password guessing against the loopback bridge.
        {
            let mut g = login_fail.lock().unwrap_or_else(|e| e.into_inner());
            if g.1.elapsed() > Duration::from_secs(300) { *g = (0, Instant::now()); }
            if g.0 >= 5 {
                let _ = req.respond(json_response(429, &serde_json::json!({ "error": "too many attempts, wait a few minutes" })));
                return;
            }
        }
        let mut body = String::new();
        let _ = req.as_reader().read_to_string(&mut body);
        let creds: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::json!({}));
        // Constant-time on both fields so login can't be probed via timing.
        let ok = ct_eq(creds.get("user").and_then(|v| v.as_str()).unwrap_or(""), user)
            && ct_eq(creds.get("pass").and_then(|v| v.as_str()).unwrap_or(""), pass);
        {
            let mut g = login_fail.lock().unwrap_or_else(|e| e.into_inner());
            if ok { *g = (0, Instant::now()); } else { g.0 += 1; }
        }
        let (code, payload) = if ok {
            (200, serde_json::json!({ "token": open_session(sessions, &req, "password") }))
        } else {
            (401, serde_json::json!({ "error": "invalid credentials" }))
        };
        let _ = req.respond(json_response(code, &payload));
        return;
    }

    // ── QR pairing ── trade the one-shot code from the QR for a session token,
    // so a phone never types the password. Unauthenticated by necessity: this
    // IS the way in. What keeps it safe is that the code is 32 random bytes,
    // lives at most ten minutes, is destroyed the instant it is used, and only
    // ever existed on the Mac's own screen. Failed attempts share the login
    // lockout, so it cannot be ground down by guessing either.
    if path == "/api/pair" && method == tiny_http::Method::Post {
        {
            let mut g = login_fail.lock().unwrap_or_else(|e| e.into_inner());
            if g.1.elapsed() > Duration::from_secs(300) { *g = (0, Instant::now()); }
            if g.0 >= 5 {
                let _ = req.respond(json_response(429, &serde_json::json!({ "error": "too many attempts, wait a few minutes" })));
                return;
            }
        }
        let mut body = String::new();
        let _ = req.as_reader().read_to_string(&mut body);
        let offered = serde_json::from_str::<serde_json::Value>(&body).ok()
            .and_then(|v| v.get("code").and_then(|c| c.as_str()).map(str::to_string))
            .unwrap_or_default();
        // Take the code out first: a spent or expired code must not survive
        // this request. check_pair hands back the one that should be kept.
        let held = { pair.lock().unwrap_or_else(|e| e.into_inner()).take() };
        let (keep, ok) = check_pair(held, &offered);
        if let Some(p) = keep {
            *pair.lock().unwrap_or_else(|e| e.into_inner()) = Some(p);
        }
        {
            let mut g = login_fail.lock().unwrap_or_else(|e| e.into_inner());
            if ok { *g = (0, Instant::now()); } else { g.0 += 1; }
        }
        let (code, payload) = if ok {
            (200, serde_json::json!({ "token": open_session(sessions, &req, "qr") }))
        } else {
            (401, serde_json::json!({ "error": "this code has expired, show a new one on your Mac" }))
        };
        let _ = req.respond(json_response(code, &payload));
        return;
    }

    // Everything below requires auth.
    if path.starts_with("/api/") && !authed() {
        let _ = req.respond(json_response(401, &serde_json::json!({ "error": "unauthorized" })));
        return;
    }

    // ── Invoke proxy ──
    if path == "/api/invoke" && method == tiny_http::Method::Post {
        let mut body = String::new();
        let _ = req.as_reader().read_to_string(&mut body);
        let parsed: Result<InvokeReq, _> = serde_json::from_str(&body);
        let r = match parsed {
            Ok(r) => r,
            Err(e) => { let _ = req.respond(json_response(400, &serde_json::json!({ "error": format!("bad request: {e}") }))); return; }
        };
        // Deny-by-default: only allowlisted commands may be proxied from the web.
        // The vault-scoped readers are allowed only for a path inside the vault.
        let allowed = if WEBUI_VAULT_SCOPED_READ.contains(&r.cmd.as_str()) {
            vault_scoped_read_ok(&r.args)
        } else if WEBUI_VAULT_SCOPED_WRITE.contains(&r.cmd.as_str()) {
            vault_scoped_write_ok(&r.args)
        } else {
            WEBUI_ALLOWED.contains(&r.cmd.as_str())
        };
        if !allowed {
            let _ = req.respond(json_response(403, &serde_json::json!({ "error": format!("command '{}' is not permitted over the WebUI", r.cmd) })));
            return;
        }
        let id = next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx): (Sender<InvokeOut>, Receiver<InvokeOut>) = channel();
        pending.lock().unwrap_or_else(|e| e.into_inner()).insert(id, tx);
        let _ = app.emit_to("main", "webui:invoke", serde_json::json!({ "id": id, "cmd": r.cmd, "args": r.args }));
        let out = rx.recv_timeout(Duration::from_secs(310)).unwrap_or(InvokeOut { ok: false, data: serde_json::Value::Null, error: "host timeout".into() });
        pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
        let payload = if out.ok { serde_json::json!({ "data": out.data }) } else { serde_json::json!({ "error": out.error }) };
        let _ = req.respond(json_response(200, &payload));
        return;
    }

    // ── Voice upload (phone → Mac) ── the raw recording, staged to a temp file
    // for `transcribe_audio`. Same auth as /api/invoke (checked above). The cap
    // is enforced twice: on Content-Length before the body is read, and on the
    // bytes actually received (a client can lie about the header).
    if path == "/api/upload-audio" && method == tiny_http::Method::Post {
        let content_type = req.headers().iter()
            .find(|h| h.field.equiv("Content-Type"))
            .map(|h| h.value.as_str().to_string())
            .unwrap_or_default();
        let ext = match crate::voice::check_upload(req.body_length(), &content_type) {
            Ok(e) => e,
            Err((code, msg)) => { let _ = req.respond(json_response(code, &serde_json::json!({ "error": msg }))); return; }
        };
        let mut bytes: Vec<u8> = Vec::new();
        let _ = req.as_reader().take(crate::voice::MAX_UPLOAD_BYTES as u64 + 1).read_to_end(&mut bytes);
        if bytes.len() > crate::voice::MAX_UPLOAD_BYTES {
            let _ = req.respond(json_response(413, &serde_json::json!({ "error": "recording is larger than 10 MB" })));
            return;
        }
        let (code, payload) = match crate::voice::store_upload(&bytes, ext) {
            Ok(p) => (200, serde_json::json!({ "path": p.to_string_lossy() })),
            Err(e) => (400, serde_json::json!({ "error": e })),
        };
        let _ = req.respond(json_response(code, &payload));
        return;
    }

    // ── Emit (browser → host) ── disabled: a remote client must not be able to
    // fire arbitrary Tauri events into the host. The web app drives everything
    // through allowlisted /api/invoke instead.
    if path == "/api/emit" {
        let _ = req.respond(json_response(403, &serde_json::json!({ "error": "emit is not permitted over the WebUI" })));
        return;
    }

    // ── SSE events ──
    // The stream owns its socket. tiny_http's Response::with_data(reader, None)
    // buffers the whole body before anything reaches the wire, so a stream that
    // never ends sent NOTHING — not even the headers. Every live update on a
    // phone (a chat reply streaming in, a finished benchmark, an approval
    // landing) died there: the turn ran on the Mac and the phone sat on
    // "Thinking…" forever. Taking the writer and flushing each frame is what
    // makes the events actually arrive.
    if path == "/api/events" {
        let (tx, rx) = channel::<String>();
        sse.lock().unwrap_or_else(|e| e.into_inner()).push(tx);
        let mut w = req.into_writer();
        let head = "HTTP/1.1 200 OK\r\n\
                    Content-Type: text/event-stream\r\n\
                    Cache-Control: no-cache, no-transform\r\n\
                    Connection: close\r\n\
                    X-Accel-Buffering: no\r\n\
                    \r\n";
        if w.write_all(head.as_bytes()).is_err() || w.flush().is_err() {
            return;
        }
        // A first comment frame proves the stream is live to the client (and to
        // any proxy in between) before a single event exists.
        if w.write_all(b": open\n\n").is_err() || w.flush().is_err() {
            return;
        }
        loop {
            let frame = match rx.recv_timeout(Duration::from_secs(20)) {
                Ok(f) => f,
                // Keepalive: proxies and phone radios drop an idle connection.
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => ": keepalive\n\n".to_string(),
                // The sender was dropped (the bridge stopped): close cleanly.
                Err(_) => break,
            };
            // A write error means the phone went away. The broadcast side
            // reaps the sender when its channel closes, which happens as this
            // receiver drops on return.
            if w.write_all(frame.as_bytes()).is_err() || w.flush().is_err() {
                break;
            }
        }
        return;
    }


    // ── Static assets (the embedded frontend bundle) ──
    let asset_path = if path == "/" { "index.html".to_string() } else { path.trim_start_matches('/').to_string() };
    match app.asset_resolver().get(format!("/{asset_path}")) {
        Some(asset) => {
            let resp = tiny_http::Response::from_data(asset.bytes).with_header(header("Content-Type", &asset.mime_type));
            let _ = req.respond(resp);
        }
        None => {
            // SPA fallback → index.html.
            if let Some(idx) = app.asset_resolver().get("/index.html".into()) {
                let _ = req.respond(tiny_http::Response::from_data(idx.bytes).with_header(header("Content-Type", "text/html")));
            } else {
                let _ = req.respond(json_response(404, &serde_json::json!({ "error": "not found" })));
            }
        }
    }
}

/// Register a newly signed-in device and hand back its private bearer token.
fn open_session(sessions: &Arc<Mutex<Vec<Session>>>, req: &tiny_http::Request, via: &str) -> String {
    let ua = req.headers().iter().find(|h| h.field.equiv("User-Agent")).map(|h| h.value.as_str().to_string()).unwrap_or_default();
    let ip = req.remote_addr().map(|a| a.ip().to_string()).unwrap_or_default();
    let token = random_token();
    let now = now_ms();
    let sess = Session {
        id: format!("d_{:x}", rand::random::<u64>()),
        token: token.clone(),
        label: device_label(&ua),
        ip,
        first_seen_ms: now,
        last_seen_ms: now,
        via: via.to_string(),
    };
    let mut list = sessions.lock().unwrap_or_else(|e| e.into_inner());
    // Cap the list so a script cannot grow it without bound; oldest-seen goes.
    if list.len() >= 32 {
        list.sort_by(|a, b| b.last_seen_ms.cmp(&a.last_seen_ms));
        list.truncate(31);
    }
    list.push(sess);
    token
}

/// Decide a pairing attempt, pure so it can be tested. Takes the code that was
/// outstanding (already removed from the shared slot) and what the client
/// offered; returns the code to put BACK, and whether to let the client in.
///
/// The rules that matter:
/// - A correct, live code is accepted and never comes back: one scan only.
/// - A wrong guess is rejected but the real code is put back, so a stranger
///   guessing cannot knock the user's own QR out from under them.
/// - An expired code is rejected and discarded whatever was offered.
fn check_pair(held: Option<PairCode>, offered: &str) -> (Option<PairCode>, bool) {
    match held {
        Some(p) if !p.live() => (None, false),
        Some(p) if !offered.is_empty() && ct_eq(offered, &p.code) => (None, true),
        Some(p) => (Some(p), false),
        None => (None, false),
    }
}

/// The Host-header policy, pure so it can be tested: loopback always; in
/// remote mode the advertised addresses plus any Tailscale / RFC 1918 address
/// and *.ts.net names; the tunnel hostname (exact match) whenever one is up,
/// independent of remote mode, since the tunnel arrives on loopback.
fn host_allowed(hostname: &str, allow_remote: bool, advertised_hosts: &[String; 2], tunnel_host: &str) -> bool {
    let ok_local = hostname == "127.0.0.1" || hostname == "localhost" || hostname == "[::1]" || hostname == "::1";
    let ok_remote = allow_remote
        && (advertised_hosts.iter().any(|h| !h.is_empty() && hostname == h.to_ascii_lowercase())
            || is_tailscale_ip(hostname)
            || is_private_lan_ip(hostname)
            || hostname.ends_with(".ts.net"));
    let ok_tunnel = !tunnel_host.is_empty() && hostname == tunnel_host;
    ok_local || ok_remote || ok_tunnel
}

fn header(k: &str, v: &str) -> tiny_http::Header {
    tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap()
}
fn json_response(code: u16, v: &serde_json::Value) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    tiny_http::Response::from_string(v.to_string()).with_status_code(code).with_header(header("Content-Type", "application/json"))
}

// ── Tauri commands ──

#[tauri::command]
pub fn webui_start(app: tauri::AppHandle, state: tauri::State<'_, WebuiState>, port: u16, user: String, pass: String, remote: Option<bool>) -> Result<WebuiStatus, String> {
    state.start(app, port, user, pass, remote.unwrap_or(false))?;
    Ok(state.status())
}
#[tauri::command]
pub fn webui_stop(state: tauri::State<'_, WebuiState>) -> Result<WebuiStatus, String> {
    state.stop();
    Ok(state.status())
}
#[tauri::command]
pub fn webui_status(state: tauri::State<'_, WebuiState>) -> WebuiStatus {
    state.status()
}
// Share over the internet: desktop-only (deliberately NOT in WEBUI_ALLOWED; a
// remote client must never be able to expose this Mac further). Blocks for
// up to ~25 s waiting on cloudflared, so it runs off the main thread.
#[tauri::command]
pub async fn webui_tunnel_start(state: tauri::State<'_, WebuiState>) -> Result<WebuiStatus, String> {
    let st: &WebuiState = &state;
    // The state lives for the whole app; the blocking wait only needs the
    // Arc-shared tunnel record, which start_tunnel clones out of it.
    let inner_tunnel = { st.inner.lock().unwrap_or_else(|e| e.into_inner()).tunnel.clone() };
    let port_running = { let i = st.inner.lock().unwrap_or_else(|e| e.into_inner()); (i.port, i.running) };
    tauri::async_runtime::spawn_blocking(move || start_tunnel_blocking(inner_tunnel, port_running))
        .await
        .map_err(|e| format!("tunnel task: {e}"))??;
    Ok(state.status())
}
#[tauri::command]
pub fn webui_tunnel_stop(state: tauri::State<'_, WebuiState>) -> WebuiStatus {
    state.stop_tunnel();
    state.status()
}
// Mint the QR pairing code. Desktop-only and deliberately NOT in
// WEBUI_ALLOWED: a phone that is already in must not be able to mint a
// credential that lets another device in.
#[tauri::command]
pub fn webui_pair_code(state: tauri::State<'_, WebuiState>) -> Result<String, String> {
    state.mint_pair_code()
}
#[tauri::command]
pub fn webui_pair_clear(state: tauri::State<'_, WebuiState>) {
    state.clear_pair_code();
}
// Disconnect one device, or all of them. Desktop-only and deliberately NOT in
// WEBUI_ALLOWED: a phone must not be able to kick another phone off, nor
// itself into a state the Mac did not ask for.
#[tauri::command]
pub fn webui_device_revoke(state: tauri::State<'_, WebuiState>, id: String) -> WebuiStatus {
    state.revoke_device(&id);
    state.status()
}
#[tauri::command]
pub fn webui_device_revoke_all(state: tauri::State<'_, WebuiState>) -> WebuiStatus {
    state.revoke_all_devices();
    state.status()
}
// Host window → server: deliver the result of a proxied invoke.
#[tauri::command]
pub fn webui_resolve(state: tauri::State<'_, WebuiState>, id: u64, ok: bool, #[allow(unused)] data: Option<serde_json::Value>, error: Option<String>) {
    state.resolve(id, InvokeOut { ok, data: data.unwrap_or(serde_json::Value::Null), error: error.unwrap_or_default() });
}
// Host window → server: forward a Tauri event to web clients.
#[tauri::command]
pub fn webui_event(state: tauri::State<'_, WebuiState>, event: String, payload: serde_json::Value) {
    state.broadcast(&event, &payload);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hosts(lan: &str, ts: &str) -> [String; 2] {
        [lan.to_string(), ts.to_string()]
    }

    #[test]
    fn tunnel_url_is_taken_only_from_a_trycloudflare_line() {
        let line = "2026-09-12T10:00:00Z INF |  https://witty-otter-cat.trycloudflare.com                                  |";
        assert_eq!(extract_tunnel_url(line).as_deref(), Some("https://witty-otter-cat.trycloudflare.com"));
        // Cloudflare's own docs links and any other https URL in the log are not a tunnel.
        assert_eq!(extract_tunnel_url("INF Requesting new quick Tunnel on trycloudflare.com..."), None);
        assert_eq!(extract_tunnel_url("INF see https://developers.cloudflare.com/cloudflare-one/ for docs"), None);
        assert_eq!(extract_tunnel_url("https://evil.example.com/?x=https://a.trycloudflare.com"), None);
        assert_eq!(extract_tunnel_url("https://.trycloudflare.com"), None);
        assert_eq!(extract_tunnel_url(""), None);
    }

    #[test]
    fn cloudflared_error_lines_lose_their_timestamp_and_level() {
        assert_eq!(tidy_cloudflared_line("2026-09-12T10:00:00Z ERR failed to request quick Tunnel error=\"dial tcp: no route\""), "failed to request quick Tunnel error=\"dial tcp: no route\"");
        assert_eq!(tidy_cloudflared_line("plain message"), "plain message");
    }

    fn code(s: &str, ttl_secs: u64) -> PairCode {
        PairCode { code: s.to_string(), expires: Instant::now() + Duration::from_secs(ttl_secs) }
    }

    #[test]
    fn a_scanned_code_works_once_and_a_guess_never_burns_it() {
        // The real code gets exactly one session, and is gone afterwards.
        let (keep, ok) = check_pair(Some(code("abc123", 60)), "abc123");
        assert!(ok);
        assert!(keep.is_none(), "a spent code must not survive");

        // A wrong guess is refused, but the user's own QR keeps working.
        let (keep, ok) = check_pair(Some(code("abc123", 60)), "wrong");
        assert!(!ok);
        assert_eq!(keep.map(|p| p.code).as_deref(), Some("abc123"));

        // So does an empty probe.
        let (keep, ok) = check_pair(Some(code("abc123", 60)), "");
        assert!(!ok);
        assert_eq!(keep.map(|p| p.code).as_deref(), Some("abc123"));

        // An expired code is refused and discarded, even if quoted correctly.
        let expired = PairCode { code: "abc123".into(), expires: Instant::now() - Duration::from_secs(1) };
        let (keep, ok) = check_pair(Some(expired), "abc123");
        assert!(!ok);
        assert!(keep.is_none());

        // Nothing outstanding: nothing to accept.
        assert_eq!(check_pair(None, "abc123").1, false);
    }

    #[test]
    fn a_pairing_code_is_short_lived() {
        // Two minutes, not ten: the window in which a photograph of the screen
        // is worth anything is what this bounds.
        assert!(PAIR_TTL <= Duration::from_secs(180), "pair codes must expire quickly");
        assert!(PAIR_TTL >= Duration::from_secs(60), "but long enough to actually scan");
    }

    #[test]
    fn a_device_that_goes_quiet_for_a_month_is_signed_out() {
        let now = 1_800_000_000_000u64;
        assert!(session_live(now, now), "a device heard from right now is live");
        assert!(session_live(now - 29 * 24 * 60 * 60 * 1000, now), "29 days is still live");
        assert!(!session_live(now - 31 * 24 * 60 * 60 * 1000, now), "31 days is signed out");
        // A clock that jumped backwards must not sign everyone out.
        assert!(session_live(now + 5_000, now));
    }

    #[test]
    fn a_vault_scoped_read_cannot_escape_the_vault() {
        // Whole-component containment: a sibling directory whose name merely
        // starts with the vault's name is outside it.
        let root = std::path::Path::new("/Users/x/Vault");
        assert!(path_inside(root, std::path::Path::new("/Users/x/Vault")));
        assert!(path_inside(root, std::path::Path::new("/Users/x/Vault/data/notes.md")));
        assert!(!path_inside(root, std::path::Path::new("/Users/x/Vault-evil/secrets")));
        assert!(!path_inside(root, std::path::Path::new("/Users/x/.ssh/id_rsa")));
        assert!(!path_inside(root, std::path::Path::new("/Users/x")));
        assert!(!path_inside(root, std::path::Path::new("/")));
    }

    #[test]
    fn a_path_that_does_not_exist_yet_still_resolves_inside_the_vault() {
        // A domain with no _loops.json must read as "no such file", not as a
        // permission error, so the containment check resolves the existing
        // prefix and re-appends the rest.
        let tmp = std::env::temp_dir();
        let real = std::fs::canonicalize(&tmp).expect("temp dir");
        let missing = tmp.join("prevail-does-not-exist-xyz/child.json");
        let resolved = resolve_existing_prefix(&missing).expect("resolves");
        assert!(path_inside(&real, &resolved));
        // `..` is refused outright rather than normalized.
        assert!(resolve_existing_prefix(std::path::Path::new("/tmp/../etc/passwd")).is_none());
        // So is a relative path.
        assert!(resolve_existing_prefix(std::path::Path::new("notes.json")).is_none());
    }

    #[test]
    fn a_vault_scoped_read_needs_a_real_path_argument() {
        // No path, a non-string path, or a path that does not exist: refused
        // before the command is ever proxied.
        assert!(!vault_scoped_read_ok(&serde_json::json!({})));
        assert!(!vault_scoped_read_ok(&serde_json::json!({ "path": 7 })));
        assert!(!vault_scoped_read_ok(&serde_json::json!({ "path": "relative/path.md" })));
        assert!(!vault_scoped_read_ok(&serde_json::json!({ "path": "/etc/../etc/passwd" })));
    }

    #[test]
    fn the_web_allowlist_never_exposes_secrets_or_arbitrary_writes() {
        // A regression guard with teeth: these must never appear in the list,
        // however it is edited. Reading or setting the bridge password from a
        // phone would hand over every future session; arbitrary file I/O would
        // make a session a shell.
        for banned in [
            "webui_secret_get", "webui_secret_set", "webui_start", "webui_stop",
            "webui_tunnel_start", "webui_pair_code", "webui_device_revoke",
            "provider_key_get", "provider_key_set", "provider_key_del",
            "write_text_file", "write_file", "open_in_terminal", "app_uninstall",
            "bunker_set", "vault_lock_set", "engine_acts_approve", "engine_gws_approve",
            "engine_agent_run", "read_file", "read_text_file",
            "engine_app_add", "engine_app_remove", "engine_app_run_skill",
            "engine_app_set_domains", "engine_app_set_schedule", "engine_app_set_soul",
            "engine_app_set_runtime", "engine_app_set_enabled", "engine_app_sync",
            "composio_set_key", "composio_connect_app", "nango_set_key", "nango_connect",
            "google_scaffold", "open_in_finder",
        ] {
            assert!(!WEBUI_ALLOWED.contains(&banned), "{banned} must not be web-invokable");
        }
        // The two file readers are reachable only through the vault-scoped gate,
        // and the one writer only for an explicit, non-executable data file.
        assert_eq!(WEBUI_VAULT_SCOPED_READ, &["read_file", "read_text_file"]);
        assert_eq!(WEBUI_VAULT_SCOPED_WRITE, &["write_text_file"]);
        assert!(!WEBUI_ALLOWED.contains(&"write_text_file"));
        for f in WEBUI_WRITABLE_VAULT_FILES {
            // Nothing this Mac later EXECUTES may be web-writable: not a loop
            // definition, not a skill body, not a manifest.
            assert!(!f.contains("_loops"), "{f} would let a phone schedule work");
            assert!(!f.to_lowercase().contains("skill"), "{f} would let a phone plant a skill");
            assert!(f.ends_with(".json"), "{f} should be a plain data file");
        }
        // And the allowlist itself has no duplicates, so an entry is never
        // "removed" while a forgotten copy keeps it alive.
        let mut seen = std::collections::HashSet::new();
        for c in WEBUI_ALLOWED {
            assert!(seen.insert(*c), "{c} is listed twice");
        }
    }

    #[test]
    fn devices_get_a_name_you_could_recognise() {
        let iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
        assert_eq!(device_label(iphone), "iPhone (Safari)");
        let android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
        assert_eq!(device_label(android), "Android phone (Chrome)");
        // Chrome and Edge both claim Safari; the most specific must win.
        let edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0";
        assert_eq!(device_label(edge), "Windows PC (Edge)");
        let mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
        assert_eq!(device_label(mac), "Mac (Safari)");
        assert_eq!(device_label(""), "Device");
    }

    #[test]
    fn host_check_loopback_lan_tailscale_tunnel() {
        let h = hosts("192.168.1.20", "100.101.102.103");
        // Loopback always passes, remote or not.
        assert!(host_allowed("127.0.0.1", false, &hosts("", ""), ""));
        assert!(host_allowed("localhost", false, &hosts("", ""), ""));
        // LAN / Tailscale / MagicDNS only in remote mode.
        assert!(!host_allowed("192.168.1.20", false, &h, ""));
        assert!(host_allowed("192.168.1.20", true, &h, ""));
        assert!(host_allowed("10.0.0.80", true, &h, ""));
        assert!(host_allowed("100.101.102.103", true, &h, ""));
        assert!(host_allowed("mini.tail1234.ts.net", true, &h, ""));
        // A public hostname (DNS rebinding) never passes.
        assert!(!host_allowed("evil.example.com", true, &h, ""));
        assert!(!host_allowed("8.8.8.8", true, &h, ""));
        // The tunnel hostname passes exactly, even with remote mode off, and
        // only that hostname.
        assert!(host_allowed("witty-otter-cat.trycloudflare.com", false, &hosts("", ""), "witty-otter-cat.trycloudflare.com"));
        assert!(!host_allowed("other.trycloudflare.com", false, &hosts("", ""), "witty-otter-cat.trycloudflare.com"));
        assert!(!host_allowed("witty-otter-cat.trycloudflare.com", false, &hosts("", ""), ""));
        // An empty advertised host never matches an empty Host header.
        assert!(!host_allowed("", true, &hosts("", ""), ""));
    }
}
