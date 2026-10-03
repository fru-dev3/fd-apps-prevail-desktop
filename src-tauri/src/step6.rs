// Step 6 of the plans, desktop side: thin, validated passthroughs to the
// engine for custom specialists (Specialists Phase 4), the lifetime Compass
// (Goals G5), a number logged by hand (Metrics M6), and imports and the stated stack (Apps A5). The engine
// owns every file these touch and enforces every limit; nothing here writes
// the vault itself.

use crate::plans::{blocking, blocking_stdin, ok_id, v};

/// One turn of the New specialist conversation: the engine drafts, code checks.
#[tauri::command]
pub(crate) async fn engine_specialist_draft(vault: String, turns: serde_json::Value, draft: serde_json::Value) -> Result<serde_json::Value, String> {
    if !turns.is_array() || !draft.is_object() { return Err("turns is a list and draft an object".into()); }
    let body = serde_json::json!({ "turns": turns, "draft": draft }).to_string();
    if body.len() > 64_000 { return Err("the conversation is too long".into()); }
    blocking_stdin(v(&["--vault", &vault, "specialists", "draft", "--file", "-"]), body).await
}

/// Make the specialist on the user's go (the engine checks every field again).
#[tauri::command]
pub(crate) async fn engine_specialist_create(vault: String, draft: serde_json::Value, confirm_raise: Option<bool>) -> Result<serde_json::Value, String> {
    if !draft.is_object() { return Err("draft must be an object".into()); }
    let mut a = v(&["--vault", &vault, "specialists", "create", "--file", "-"]);
    if confirm_raise == Some(true) { a.push("--confirm-raise".into()); }
    blocking_stdin(a, draft.to_string()).await
}

// ── Goals G5: over a lifetime ───────────────────────

/// Every value and role over the years (from the Compass versions and ledger).
#[tauri::command]
pub(crate) async fn engine_compass_history(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "compass", "history"])).await
}

/// The yearly review page; draft lets a model sketch the odyssey lives from the notes (quotes checked in code).
#[tauri::command]
pub(crate) async fn engine_compass_yearly(vault: String, draft: Option<bool>, write: Option<bool>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "compass", "yearly"]);
    if draft == Some(true) { a.push("--draft".into()); }
    if write == Some(true) { a.push("--write".into()); }
    blocking(a).await
}

/// Every saved yearly review, newest first, with its text.
#[tauri::command]
pub(crate) async fn engine_compass_yearly_list(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "compass", "yearly", "list"])).await
}

/// Save the user's edit of one yearly review (the engine keeps the text before).
#[tauri::command]
pub(crate) async fn engine_compass_yearly_save(vault: String, year: u32, text: String) -> Result<serde_json::Value, String> {
    if !(1900..=3000).contains(&year) { return Err("a year like 2026".into()); }
    if text.len() > 200_000 { return Err("the review is too long".into()); }
    let y = year.to_string();
    blocking_stdin(v(&["--vault", &vault, "compass", "yearly", "save", "--year", &y, "--file", "-"]), text).await
}

/// Fresh starts on today (new year, birthday, a new quarter, a move or a new job).
#[tauri::command]
pub(crate) async fn engine_compass_fresh(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "compass", "fresh"])).await
}

/// The confirmed Compass as a constitution any AI can read (build/exports/).
#[tauri::command]
pub(crate) async fn engine_compass_export(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "compass", "export"])).await
}

// ── Metrics M6: a number logged by hand ───────────────────────────────────

/// Log one number for an asked metric.
#[tauri::command]
pub(crate) async fn engine_metrics_say(vault: String, id: String, value: f64) -> Result<serde_json::Value, String> {
    if !value.is_finite() || value < 0.0 || value > 1e7 { return Err("a number between 0 and 10,000,000".into()); }
    let n = format!("{value}");
    blocking(v(&["--vault", &vault, "metrics", "say", ok_id(&id)?, &n])).await
}

// ── Apps A5: imports and the stated stack ─────────────────────────────────

#[tauri::command]
pub(crate) async fn engine_apps_imports(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "apps", "imports", "status"])).await
}

#[tauri::command]
pub(crate) async fn engine_apps_imports_run(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "apps", "imports", "run"])).await
}

/// The quarterly export reminder (off unless the user turns it on).
#[tauri::command]
pub(crate) async fn engine_apps_imports_reminder(vault: String, on: bool) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "apps", "imports", "reminder", if on { "on" } else { "off" }])).await
}

/// The said vs used diff for tool-stack.md (the one waiting, or computed now).
#[tauri::command]
pub(crate) async fn engine_apps_stack_diff(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "apps", "stack-diff", "show"])).await
}

/// Accept the diff: the engine keeps the prior file and updates the stated stack.
#[tauri::command]
pub(crate) async fn engine_apps_stack_diff_accept(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "apps", "stack-diff", "accept"])).await
}
