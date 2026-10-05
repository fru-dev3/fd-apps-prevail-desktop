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

/// A machine label and an SSH target: one word each, never a flag.
fn machine_args(label: &str, target: &str) -> Result<(String, String), String> {
    let l = ok_id(label)?.to_string();
    let t = ok_label(target)?.to_string();
    if t.contains(char::is_whitespace) { return Err("invalid ssh target".into()); }
    Ok((l, t))
}

/// One prompt into the queue (`body`: `{ text, surface, machine?, agentKind?, hold? }`);
/// with `hold` its tasks are parked in the backlog (routed, never started).
/// The text goes over stdin, so a long dictated prompt never meets argv limits.
#[tauri::command]
pub(crate) async fn engine_work_add(vault: String, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let s = |k: &str| body.get(k).and_then(|t| t.as_str()).unwrap_or("").to_string();
    let text = s("text");
    if text.trim().is_empty() { return Err("empty prompt".into()); }
    if text.len() > 20_000 { return Err("prompt too long".into()); }
    let surface = s("surface");
    let mut a = v(&["--vault", &vault, "work", "add", "--file", "-", "--surface", one_of(if surface.is_empty() { "desktop" } else { &surface }, &["desktop", "phone", "cli"])?]);
    let machine = s("machine");
    if !machine.is_empty() { a.push("--machine".into()); a.push(ok_id(&machine)?.to_string()); }
    let kind = s("agentKind");
    if !kind.is_empty() { a.push("--agent".into()); a.push(ok_id(&kind)?.to_string()); }
    if body.get("hold").and_then(|h| h.as_bool()) == Some(true) { a.push("--hold".into()); }
    blocking_stdin(a, text).await
}

/// The queue (open prompts), or with `all` every prompt for the backlog.
#[tauri::command]
pub(crate) async fn engine_work_list(vault: String, all: Option<bool>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "work", "list"]);
    if all == Some(true) { a.push("--view".into()); a.push("backlog".into()); }
    blocking(a).await
}

#[tauri::command]
pub(crate) async fn engine_work_show(vault: String, id: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "work", "show", ok_id(&id)?])).await
}

/// Re-route a task: a new destination (`kind:id`), machine or agent kind, or Undo the route.
#[tauri::command]
pub(crate) async fn engine_work_route(vault: String, id: String, dest: Option<String>, machine: Option<String>, agent_kind: Option<String>, undo: Option<bool>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "work", "route", ok_id(&id)?]);
    if undo == Some(true) {
        a.push("--undo".into());
    } else {
        if let Some(t) = dest.filter(|t| !t.is_empty()) { a.push("--dest".into()); a.push(ok_id(&t)?.to_string()); }
        if let Some(m) = machine.filter(|m| !m.is_empty()) { a.push("--machine".into()); a.push(ok_id(&m)?.to_string()); }
        if let Some(k) = agent_kind.filter(|k| !k.is_empty()) { a.push("--agent".into()); a.push(ok_id(&k)?.to_string()); }
        if a.len() == 5 { return Err("nothing to change".into()); }
    }
    blocking(a).await
}

/// Pause, continue, start, stop; keep, close or reopen a Herdr tab; take a
/// task over on this Mac (continue-here: the user already said yes to taking
/// a live lease); accept or decline suggestion `n` (1-based).
#[tauri::command]
pub(crate) async fn engine_work_action(vault: String, id: String, action: String, n: Option<u32>) -> Result<serde_json::Value, String> {
    let act = one_of(&action, &["pause", "continue", "start", "stop", "keep", "close", "reopen", "continue-here", "accept", "decline"])?;
    let id = ok_id(&id)?;
    let a = match act {
        "keep" | "close" | "reopen" => v(&["--vault", &vault, "work", "answer", id, act]),
        "continue-here" => v(&["--vault", &vault, "work", "continue", id, "--yes"]),
        "accept" | "decline" => {
            let n = n.filter(|n| *n >= 1).ok_or("which suggestion?")?.to_string();
            v(&["--vault", &vault, "work", act, id, &n])
        }
        _ => v(&["--vault", &vault, "work", act, id]),
    };
    blocking(a).await
}

/// The user's answer to a task's question: yes or no (start, a Herdr
/// workspace, a machine), or keep / close / reopen. A yes to the workspace
/// question may name an existing workspace.
#[tauri::command]
pub(crate) async fn engine_work_answer(vault: String, id: String, answer: String, workspace: Option<String>) -> Result<serde_json::Value, String> {
    let ans = one_of(&answer, &["yes", "no", "keep", "close", "reopen"])?.to_string();
    let mut a = vec!["--vault".into(), vault, "work".into(), "answer".into(), ok_id(&id)?.to_string(), ans];
    if let Some(w) = workspace.filter(|w| !w.is_empty()) { a.push("--workspace".into()); a.push(ok_label(&w)?.to_string()); }
    blocking(a).await
}

/// Work mode settings: read them (no arguments), turn Herdr on or off, or set
/// how many tasks run at once (`max_running`, 1 to 20).
#[tauri::command]
pub(crate) async fn engine_work_settings(vault: String, herdr: Option<bool>, max_running: Option<u32>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "work", "settings"]);
    if let Some(h) = herdr { a.push("--herdr".into()); a.push(if h { "on" } else { "off" }.into()); }
    if let Some(n) = max_running {
        if !(1..=20).contains(&n) { return Err("max running is 1 to 20".into()); }
        a.push("--max-running".into()); a.push(n.to_string());
    }
    blocking(a).await
}

/// Move a task in the queue: before or after another task, or to an index
/// (0 is first). Reordering changes which queued task starts next.
#[tauri::command]
pub(crate) async fn engine_work_reorder(vault: String, id: String, before: Option<String>, after: Option<String>, to: Option<u32>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "work", "reorder", ok_id(&id)?]);
    if let Some(b) = before.filter(|b| !b.is_empty()) {
        a.push("--before".into()); a.push(ok_id(&b)?.to_string());
    } else if let Some(b) = after.filter(|b| !b.is_empty()) {
        a.push("--after".into()); a.push(ok_id(&b)?.to_string());
    } else if let Some(n) = to {
        a.push("--to".into()); a.push(n.to_string());
    } else {
        return Err("say where the task goes".into());
    }
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
    let (l, t) = machine_args(&label, &target)?;
    blocking(vec!["--vault".into(), vault, "work".into(), "machine-add".into(), "--label".into(), l, "--target".into(), t, "--yes".into()]).await
}

/// Open Terminal on this Mac running `herdr machine add` for that Mac, so the
/// user can approve the remote Herdr's update there (the engine builds the argv).
#[tauri::command]
pub(crate) async fn engine_work_machine_approve(vault: String, label: String, target: String) -> Result<serde_json::Value, String> {
    let (l, t) = machine_args(&label, &target)?;
    blocking(vec!["--vault".into(), vault, "work".into(), "machine-approve".into(), "--label".into(), l, "--target".into(), t, "--yes".into()]).await
}

/// The Herdr workspaces open on a machine, for the "which workspace?" question.
/// The engine may not list them yet; the card then offers only Create and Not now.
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

    #[test]
    fn machine_args_are_one_word_each() {
        assert!(machine_args("mini-foo", "foo@mini-foo").is_ok());
        assert!(machine_args("mini-foo", "foo bar").is_err());
        assert!(machine_args("mini-foo", "-oProxyCommand=x").is_err());
    }
}
