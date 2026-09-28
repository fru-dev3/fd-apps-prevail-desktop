// Opt-in timing layer. PREVAIL_PERF=1 turns it on; otherwise every call here
// is one cached bool check and nothing is recorded.
//
// Two kinds of sample:
//   "main"   how long a command held the main thread (the invoke handler).
//            A sync command holds it for its whole run, which is the window
//            freeze; an async command only for its dispatch.
//   "engine" wall time of one engine subprocess (spawn + run + exit).
//
// Each sample is appended to ~/.prevail/perf.log (machine-local, never the
// vault). A summary table (count, total, p50, max per name) is printed to
// stderr and appended to the log when the app exits.

use std::collections::BTreeMap;
use std::io::Write;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

pub(crate) fn enabled() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| std::env::var("PREVAIL_PERF").map(|v| v == "1").unwrap_or(false))
}

fn samples() -> &'static Mutex<BTreeMap<String, Vec<f64>>> {
    static S: OnceLock<Mutex<BTreeMap<String, Vec<f64>>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn log_path() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(|h| std::path::Path::new(&h).join(".prevail").join("perf.log"))
}

fn append_log(text: &str) {
    let Some(p) = log_path() else { return };
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
        let _ = f.write_all(text.as_bytes());
    }
}

/// Record one sample. `kind` is "main" or "engine"; `name` the command or the
/// engine subcommand.
pub(crate) fn record(kind: &str, name: &str, d: Duration) {
    if !enabled() {
        return;
    }
    let ms = d.as_secs_f64() * 1000.0;
    let key = format!("{kind} {name}");
    if let Ok(mut m) = samples().lock() {
        m.entry(key.clone()).or_default().push(ms);
    }
    append_log(&format!("{ms:9.1} ms  {key}\n"));
}

/// The summary table over everything recorded so far, slowest total first.
pub(crate) fn summary() -> String {
    let m = match samples().lock() {
        Ok(m) => m.clone(),
        Err(_) => return String::new(),
    };
    let mut rows: Vec<(String, usize, f64, f64, f64)> = m
        .into_iter()
        .map(|(k, mut v)| {
            v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let total: f64 = v.iter().sum();
            (k, v.len(), total, v[v.len() / 2], *v.last().unwrap_or(&0.0))
        })
        .collect();
    rows.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    let mut out = String::from("prevail perf summary (ms)\n  count    total      p50      max  name\n");
    for (k, n, total, p50, max) in rows {
        out.push_str(&format!("{n:7} {total:8.1} {p50:8.1} {max:8.1}  {k}\n"));
    }
    out
}

pub(crate) fn print_summary() {
    if !enabled() {
        return;
    }
    let s = summary();
    eprint!("{s}");
    append_log(&s);
}

#[cfg(test)]
mod tests {
    /// Commands allowed to stay sync (they run on the main thread, which
    /// freezes the window while they run). Only pure in-memory work belongs
    /// here: no file, process, network or engine access.
    const SYNC_ALLOWED: &[&str] = &[
        "autonomy_classify",       // a pure table lookup
        "webui_status",            // reads the bridge's in-memory state
        "webui_resolve",           // hands a result to a waiting web request
        "webui_event",             // queues an event for web clients, in order
        "webui_pair_code",         // mints a random code in memory
        "webui_pair_clear",        // clears it
        "webui_device_revoke",     // drops one in-memory session
        "webui_device_revoke_all", // drops them all
        "abort_sessions",          // signals registered child pids, no waiting
        "notify_user",             // hands a notification to the OS plugin
    ];

    /// Every #[tauri::command] must run off the main thread (`async fn` or
    /// `#[tauri::command(async)]`) unless it is on SYNC_ALLOWED.
    #[test]
    fn no_sync_commands_outside_the_allowlist() {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut offenders = Vec::new();
        let mut seen_allowed = Vec::new();
        for e in walkdir::WalkDir::new(&src).into_iter().flatten() {
            if e.path().extension().and_then(|x| x.to_str()) != Some("rs") {
                continue;
            }
            let text = std::fs::read_to_string(e.path()).unwrap();
            let lines: Vec<&str> = text.lines().collect();
            for (i, l) in lines.iter().enumerate() {
                let t = l.trim();
                if !t.starts_with("#[tauri::command") {
                    continue;
                }
                let attr_async = t.contains("async");
                let sig = lines[i + 1..].iter().find(|x| x.contains("fn ")).expect("fn after command attr");
                let name = sig.split("fn ").nth(1).unwrap().split(|c: char| !c.is_alphanumeric() && c != '_').next().unwrap();
                let fn_async = sig.contains("async fn");
                if attr_async || fn_async {
                    continue;
                }
                if SYNC_ALLOWED.contains(&name) {
                    seen_allowed.push(name.to_string());
                } else {
                    offenders.push(format!("{}: {name}", e.path().display()));
                }
            }
        }
        assert!(offenders.is_empty(), "sync #[tauri::command] freezes the window; make it async:\n{}", offenders.join("\n"));
        // Keep the allowlist honest: every entry must still exist and be sync.
        for a in SYNC_ALLOWED {
            assert!(seen_allowed.iter().any(|s| s == a), "stale SYNC_ALLOWED entry: {a}");
        }
    }

    #[test]
    fn serial_lane_is_reentrant_on_one_thread() {
        let _a = crate::vaultio::serial();
        let _b = crate::vaultio::serial(); // would deadlock if not re-entrant
    }
}
