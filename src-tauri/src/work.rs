// Work mode, desktop side: thin, validated passthroughs to `prevail work ...`.
// The engine owns the queue (build/_meta/work/), the router, the jobs and the
// Herdr bridge; nothing here writes the vault itself.

use crate::plans::{blocking, blocking_stdin, ok_id, one_of, v};

/// A free-text label (a Herdr workspace, an SSH target): one line, never a flag.
fn ok_label(s: &str) -> Result<&str, String> {
    if !s.trim().is_empty() && s.len() <= 120 && !s.starts_with('-') && !s.chars().any(|c| c.is_control()) {
        Ok(s)
    } else {
        Err(format!("invalid label: {s}"))
    }
}

/// One prompt into the queue. The body (`{ text, surface, machine?, herdr? }`)
/// goes over stdin, so a long dictated prompt never meets argv limits.
#[tauri::command]
pub(crate) async fn engine_work_add(vault: String, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let text = body.get("text").and_then(|t| t.as_str()).unwrap_or("");
    if text.trim().is_empty() { return Err("empty prompt".into()); }
    if text.len() > 20_000 { return Err("prompt too long".into()); }
    blocking_stdin(v(&["--vault", &vault, "work", "add", "--file", "-"]), body.to_string()).await
}

/// The queue (open prompts), or with `all` every prompt for the backlog.
#[tauri::command]
pub(crate) async fn engine_work_list(vault: String, all: Option<bool>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "work", "list"]);
    if all == Some(true) { a.push("--all".into()); }
    blocking(a).await
}

#[tauri::command]
pub(crate) async fn engine_work_show(vault: String, id: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "work", "show", ok_id(&id)?])).await
}

/// Re-route a task: a new destination (`kind:id`), machine or agent kind, or Undo the route.
#[tauri::command]
pub(crate) async fn engine_work_route(vault: String, id: String, to: Option<String>, machine: Option<String>, agent_kind: Option<String>, undo: Option<bool>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "work", "route", ok_id(&id)?]);
    if undo == Some(true) {
        a.push("--undo".into());
    } else {
        if let Some(t) = to.filter(|t| !t.is_empty()) { a.push("--to".into()); a.push(ok_id(&t)?.to_string()); }
        if let Some(m) = machine.filter(|m| !m.is_empty()) { a.push("--machine".into()); a.push(ok_id(&m)?.to_string()); }
        if let Some(k) = agent_kind.filter(|k| !k.is_empty()) { a.push("--agent".into()); a.push(ok_id(&k)?.to_string()); }
        if a.len() == 5 { return Err("nothing to change".into()); }
    }
    blocking(a).await
}

/// Pause, continue, start, stop; keep, close or reopen a Herdr tab; take a
/// task over on this Mac; accept or decline suggestion `n`.
#[tauri::command]
pub(crate) async fn engine_work_action(vault: String, id: String, action: String, n: Option<u32>) -> Result<serde_json::Value, String> {
    let act = one_of(&action, &["pause", "continue", "start", "stop", "keep", "close", "reopen", "continue-here", "accept", "decline"])?.to_string();
    let mut a = v(&["--vault", &vault, "work", &act, ok_id(&id)?]);
    if act == "accept" || act == "decline" {
        a.push(n.ok_or("which suggestion?")?.to_string());
    }
    blocking(a).await
}

/// The user's answer to a task's question: yes / no to start, a Herdr
/// workspace (existing label or `create`), keep / close.
#[tauri::command]
pub(crate) async fn engine_work_answer(vault: String, id: String, answer: String) -> Result<serde_json::Value, String> {
    let ans = ok_label(&answer)?.to_string();
    blocking(vec!["--vault".into(), vault, "work".into(), "answer".into(), ok_id(&id)?.to_string(), ans]).await
}

/// Work mode settings: read them (no arguments), or turn Herdr on or off and
/// set the default machine.
#[tauri::command]
pub(crate) async fn engine_work_settings(vault: String, herdr: Option<bool>, machine: Option<String>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "work", "settings"]);
    if let Some(h) = herdr { a.push("--herdr".into()); a.push(if h { "on" } else { "off" }.into()); }
    if let Some(m) = machine.filter(|m| !m.is_empty()) { a.push("--machine".into()); a.push(ok_id(&m)?.to_string()); }
    blocking(a).await
}

/// The Macs work can go to (this one first) and the agent kinds Herdr runs.
#[tauri::command]
pub(crate) async fn engine_work_machines(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "work", "machines"])).await
}

/// Connect a Mac to Herdr: runs only on the user's confirm, with the SSH target they typed.
#[tauri::command]
pub(crate) async fn engine_work_machine_add(vault: String, label: String, target: String) -> Result<serde_json::Value, String> {
    let l = ok_id(&label)?.to_string();
    let t = ok_label(&target)?.to_string();
    if t.contains(char::is_whitespace) { return Err("invalid ssh target".into()); }
    blocking(vec!["--vault".into(), vault, "work".into(), "machine-add".into(), "--label".into(), l, t, "--yes".into()]).await
}

/// The Herdr workspaces open on a machine, for the "which workspace?" question.
#[tauri::command]
pub(crate) async fn engine_work_herdr_workspaces(vault: String, machine: Option<String>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "work", "workspaces"]);
    if let Some(m) = machine.filter(|m| !m.is_empty()) { a.push("--machine".into()); a.push(ok_id(&m)?.to_string()); }
    blocking(a).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_are_one_line_and_never_a_flag() {
        assert!(ok_label("foo workspace").is_ok());
        assert!(ok_label("--yes").is_err());
        assert!(ok_label("foo\nbar").is_err());
        assert!(ok_label("  ").is_err());
    }
}
