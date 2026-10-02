// Step 6 of the plans, desktop side: thin, validated passthroughs to the
// engine for custom specialists and packs (Specialists Phase 4), the
// lifetime and household Compass (Goals G5), family metrics and the phone
// glance (Metrics M6), and imports and the stated stack (Apps A5). The engine
// owns every file these touch and enforces every limit; nothing here writes
// the vault itself.

use crate::plans::{blocking, blocking_stdin, ok_id, one_of, v};

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

/// The packs per vertical, with what of each is already in the vault.
#[tauri::command]
pub(crate) async fn engine_packs(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "packs", "list"])).await
}

/// Install a pack, or one part of it (specialists, compass, metrics).
#[tauri::command]
pub(crate) async fn engine_pack_install(vault: String, id: String, only: Option<String>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "packs", "install", ok_id(&id)?]);
    if let Some(o) = only.filter(|o| !o.is_empty()) { a.push("--only".into()); a.push(one_of(&o, &["specialists", "compass", "metrics"])?.to_string()); }
    blocking(a).await
}

/// Take a pack's specialists out (their files move aside, never deleted).
#[tauri::command]
pub(crate) async fn engine_pack_uninstall(vault: String, id: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "packs", "uninstall", ok_id(&id)?])).await
}
