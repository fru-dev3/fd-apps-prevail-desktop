// Sources: where chats get context (the vault, Obsidian vaults, local folders,
// websites). The engine owns the list, the indexes and retrieval
// (`prevail sources ...`, prevail-cli src/sources.ts); these commands shell it
// and a small scheduler keeps due sources fresh while the app runs.
//
// Every command runs on a blocking worker: a website refresh reads dozens of
// sites and must never stall the UI thread.

use std::time::Duration;

use tauri::Emitter;

use crate::engine::{run_engine_json, vault_root};

async fn blocking<F>(f: F) -> Result<serde_json::Value, String>
where
    F: FnOnce() -> Result<serde_json::Value, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// Every source with its status (last indexed, items, next refresh).
#[tauri::command]
pub async fn sources_list(vault: String) -> Result<serde_json::Value, String> {
    blocking(move || run_engine_json(&["sources", "list", "--vault", &vault])).await
}

/// Register a source. kind: prevail | obsidian | folder | website.
#[tauri::command]
pub async fn sources_add(
    vault: String,
    kind: String,
    location: String,
    name: Option<String>,
    domain: Option<String>,
) -> Result<serde_json::Value, String> {
    blocking(move || {
        let mut args: Vec<String> = vec![
            "sources".into(), "add".into(), "--type".into(), kind, "--location".into(), location, "--vault".into(), vault,
        ];
        if let Some(n) = name.filter(|s| !s.trim().is_empty()) { args.push("--name".into()); args.push(n); }
        if let Some(d) = domain.filter(|s| !s.trim().is_empty()) { args.push("--domain".into()); args.push(d); }
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_engine_json(&refs)
    })
    .await
}

/// Drop a source from the list (its files are never touched).
#[tauri::command]
pub async fn sources_remove(vault: String, id: String) -> Result<serde_json::Value, String> {
    blocking(move || run_engine_json(&["sources", "remove", &id, "--vault", &vault])).await
}

#[tauri::command]
pub async fn sources_set_enabled(vault: String, id: String, enabled: bool) -> Result<serde_json::Value, String> {
    blocking(move || {
        let sub = if enabled { "enable" } else { "disable" };
        run_engine_json(&["sources", sub, &id, "--vault", &vault])
    })
    .await
}

/// Index now. `ids` limits the pass; `force` re-reads everything (still with
/// conditional requests); `due` only touches what is due.
#[tauri::command]
pub async fn sources_refresh(
    app: tauri::AppHandle,
    vault: String,
    ids: Option<Vec<String>>,
    force: Option<bool>,
    due: Option<bool>,
) -> Result<serde_json::Value, String> {
    let out = blocking(move || {
        let mut args: Vec<String> = vec!["sources".into(), "refresh".into()];
        for id in ids.unwrap_or_default() { args.push(id); }
        if force.unwrap_or(false) { args.push("--force".into()); }
        if due.unwrap_or(false) { args.push("--due".into()); }
        args.push("--vault".into());
        args.push(vault);
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_engine_json(&refs)
    })
    .await;
    let _ = app.emit("prevail:sources-changed", ());
    out
}

/// Retrieve cited excerpts for one message: { ok, context, hits }. Read-only,
/// no network (websites answer from their last indexed copy).
#[tauri::command]
pub async fn sources_context(vault: String, query: String) -> Result<serde_json::Value, String> {
    blocking(move || run_engine_json(&["sources", "context", "--query", &query, "--vault", &vault])).await
}

/// Keep due sources fresh while the app is open: a first pass shortly after
/// launch, then every 15 minutes. Each source decides whether it is due (a
/// website by its own sites' reported schedules), so a pass with nothing due
/// costs a directory stat, not a crawl.
pub fn start_scheduler(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(90)).await;
        loop {
            if let Some(v) = vault_root() {
                let res = tauri::async_runtime::spawn_blocking(move || {
                    run_engine_json(&["sources", "refresh", "--due", "--vault", &v])
                })
                .await;
                let refreshed = matches!(&res, Ok(Ok(val)) if val.get("refreshed").and_then(|r| r.as_array()).map(|a| !a.is_empty()).unwrap_or(false));
                if refreshed {
                    let _ = app.emit("prevail:sources-changed", ());
                }
            }
            tokio::time::sleep(Duration::from_secs(15 * 60)).await;
        }
    });
}
