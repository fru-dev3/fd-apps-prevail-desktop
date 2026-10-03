// System Activity reader for the Automation tab. The engine (daemon-loops,
// briefings, sync) appends one JSON line per autonomous event to
// <vault>/_meta/activity.<host>.jsonl (resolved via runtime_path, mirroring the cli).
// This command reads that ledger, parses it tolerantly, and returns the most
// recent events newest-first so the desktop can render the feed.
use serde_json::Value;

use crate::paths::runtime_path;
use crate::read_to_string_retry;

/// The activity ledgers to merge: each machine's own `activity.<host>.jsonl`
/// (synced between Macs) plus the older shared `activity.jsonl`. Archives
/// (rotated heads) are left out of the live feed.
fn activity_files(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if n.starts_with("activity") && n.ends_with(".jsonl") && !n.contains("archive") {
                out.push(e.path());
            }
        }
    }
    out.sort();
    out
}

#[tauri::command]
pub(crate) async fn activity_read(vault: String, limit: Option<usize>) -> Result<Vec<Value>, String> {
    let mut events: Vec<Value> = Vec::new();
    for path in activity_files(&runtime_path(&vault, "_meta")) {
        let raw = match read_to_string_retry(path.to_str().unwrap_or_default()) {
            Ok(s) => s,
            Err(_) => continue,
        };
        events.extend(
            raw.lines()
                .filter(|l| !l.trim().is_empty())
                .filter_map(|l| serde_json::from_str::<Value>(l).ok())
                .filter(|v| v.get("ts").and_then(|t| t.as_i64()).is_some()),
        );
    }
    // Newest first.
    events.sort_by(|a, b| {
        let ta = a.get("ts").and_then(|t| t.as_i64()).unwrap_or(0);
        let tb = b.get("ts").and_then(|t| t.as_i64()).unwrap_or(0);
        tb.cmp(&ta)
    });
    events.truncate(limit.unwrap_or(200).max(1));
    Ok(events)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_every_hosts_stream_and_skips_archives() {
        let v = std::env::temp_dir().join(format!("prevail-activity-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&v);
        let m = v.join("build").join("_meta");
        std::fs::create_dir_all(&m).unwrap();
        std::fs::write(m.join("activity.jsonl"), "{\"ts\":1,\"title\":\"old\"}\n").unwrap();
        std::fs::write(m.join("activity.foo-hub.jsonl"), "{\"ts\":3,\"title\":\"hub\"}\n").unwrap();
        std::fs::write(m.join("activity.bar-laptop.jsonl"), "{\"ts\":2,\"title\":\"laptop\"}\n").unwrap();
        std::fs::write(m.join("activity.foo-hub.archive.jsonl"), "{\"ts\":0,\"title\":\"archived\"}\n").unwrap();
        let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let ev = rt.block_on(activity_read(v.to_string_lossy().to_string(), Some(10))).unwrap();
        let titles: Vec<&str> = ev.iter().map(|e| e["title"].as_str().unwrap()).collect();
        assert_eq!(titles, vec!["hub", "laptop", "old"]);
        let _ = std::fs::remove_dir_all(&v);
    }
}
