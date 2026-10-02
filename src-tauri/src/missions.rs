// Missions (missions-plan.md), desktop side: thin, validated passthroughs to
// `prevail missions ...`. The engine owns every file a mission touches; nothing
// here writes the vault itself. Reads may run from the phone (webui.rs); every
// write stays on the Mac.

use crate::engine::{run_engine_json, run_engine_json_stdin};

fn ok_slug(s: &str) -> Result<&str, String> {
    let ok = !s.is_empty() && s.len() <= 80 && !s.starts_with('-')
        && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if ok { Ok(s) } else { Err(format!("invalid mission: {s}")) }
}

fn ok_ref(s: &str) -> Result<&str, String> {
    let ok = !s.is_empty() && s.len() <= 160 && !s.starts_with('-') && !s.contains("..")
        && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.' | '/'));
    if ok { Ok(s) } else { Err(format!("invalid id: {s}")) }
}

fn one_of<'a>(s: &'a str, allowed: &[&str]) -> Result<&'a str, String> {
    if allowed.contains(&s) { Ok(s) } else { Err(format!("unknown: {s}")) }
}

/// Free text the user typed: one line, bounded, never read as a flag.
fn text(s: &str, max: usize) -> Result<String, String> {
    let t: String = s.replace(['\n', '\r'], " ").trim().chars().take(max).collect();
    if t.starts_with('-') { return Err("text may not start with a dash".into()); }
    Ok(t)
}

fn v(xs: &[&str]) -> Vec<String> { xs.iter().map(|s| s.to_string()).collect() }

async fn blocking(args: Vec<String>) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let a: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_engine_json(&a)
    })
    .await
    .map_err(|e| format!("engine task failed: {e}"))?
}

fn base(vault: &str, sub: &str) -> Vec<String> { v(&["--vault", vault, "missions", sub]) }

#[tauri::command]
pub(crate) async fn engine_missions_list(vault: String, status: Option<String>) -> Result<serde_json::Value, String> {
    let mut a = base(&vault, "list");
    if let Some(s) = status { a.push("--status".into()); a.push(one_of(&s, &["active", "paused", "completed", "archived", "all"])?.to_string()); }
    blocking(a).await
}

/// One mission with its progress, milestones and links; `part` reads its tasks or close-out receipts instead.
#[tauri::command]
pub(crate) async fn engine_missions_show(vault: String, slug: String, part: Option<String>) -> Result<serde_json::Value, String> {
    let sub = one_of(part.as_deref().unwrap_or("show"), &["show", "tasks", "filed"])?.to_string();
    let mut a = base(&vault, &sub);
    a.push(ok_slug(&slug)?.into());
    blocking(a).await
}

pub(crate) fn create_args(vault: &str, name: &str, outcome: Option<&str>, target: Option<&str>, owner: Option<&str>, consult: &[String], inform: &[String], apps: &[String], specialists: &[String], budget_usd: Option<f64>, milestones: &[String], from_prompt_project: Option<&str>) -> Result<Vec<String>, String> {
    let mut a = base(vault, "create");
    a.push("--name".into()); a.push(text(name, 120)?);
    if let Some(o) = outcome.filter(|s| !s.trim().is_empty()) { a.push("--outcome".into()); a.push(text(o, 300)?); }
    if let Some(t) = target.filter(|s| !s.trim().is_empty()) { a.push("--target".into()); a.push(ok_ref(t)?.into()); }
    if let Some(o) = owner.filter(|s| !s.is_empty()) { a.push("--owner".into()); a.push(ok_ref(o)?.into()); }
    for (flag, list) in [("--consult", consult), ("--inform", inform), ("--app", apps), ("--specialist", specialists)] {
        for x in list { a.push(flag.into()); a.push(ok_ref(x)?.into()); }
    }
    if let Some(b) = budget_usd { if !(b.is_finite() && b >= 0.0) { return Err("budget must be a positive number".into()); } a.push("--budget-usd".into()); a.push(format!("{b}")); }
    for m in milestones.iter().filter(|m| !m.trim().is_empty()) { a.push("--milestone".into()); a.push(text(m, 160)?); }
    if let Some(p) = from_prompt_project.filter(|s| !s.is_empty()) { a.push("--from-prompt-project".into()); a.push(ok_ref(p)?.into()); }
    Ok(a)
}

/// Start a mission: the user's yes (a [Start] tap, the [+] form or an accepted suggestion).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn engine_missions_create(vault: String, name: String, outcome: Option<String>, target: Option<String>, owner: Option<String>, consult: Option<Vec<String>>, inform: Option<Vec<String>>, apps: Option<Vec<String>>, specialists: Option<Vec<String>>, budget_usd: Option<f64>, milestones: Option<Vec<String>>, from_prompt_project: Option<String>) -> Result<serde_json::Value, String> {
    let a = create_args(&vault, &name, outcome.as_deref(), target.as_deref(), owner.as_deref(), &consult.unwrap_or_default(), &inform.unwrap_or_default(), &apps.unwrap_or_default(), &specialists.unwrap_or_default(), budget_usd, &milestones.unwrap_or_default(), from_prompt_project.as_deref())?;
    blocking(a).await
}

/// Edit a field on the Setup tab.
#[tauri::command]
pub(crate) async fn engine_missions_set(vault: String, slug: String, field: String, value: String) -> Result<serde_json::Value, String> {
    let f = one_of(&field, &["name", "outcome", "why", "target", "cadence", "ceiling", "notes", "local-only", "budget-usd", "hours-wk", "nudges"])?.to_string();
    let mut a = base(&vault, "set");
    a.push(ok_slug(&slug)?.into());
    a.push(format!("--{f}"));
    a.push(match f.as_str() {
        "ceiling" => one_of(&value, &["read", "write-vault", "draft", "act-ask", "act"])?.to_string(),
        "local-only" => one_of(&value, &["true", "false"])?.to_string(),
        "target" => ok_ref(&value)?.to_string(),
        "budget-usd" | "hours-wk" | "nudges" => { value.trim().parse::<f64>().map_err(|_| format!("{f} must be a number"))?; value.trim().to_string() }
        _ => text(&value, 2000)?,
    });
    blocking(a).await
}

/// Bring something in (or let it go): a domain with its role, an app, a specialist, a person.
#[tauri::command]
pub(crate) async fn engine_missions_attach(vault: String, slug: String, kind: String, value: String, detach: Option<bool>) -> Result<serde_json::Value, String> {
    let k = one_of(&kind, &["domain", "app", "specialist", "person", "entity", "prompt-project"])?.to_string();
    let mut a = base(&vault, if detach == Some(true) { "detach" } else { "attach" });
    a.push(ok_slug(&slug)?.into());
    a.push(format!("--{k}"));
    a.push(ok_ref(&value)?.into());
    blocking(a).await
}

#[tauri::command]
pub(crate) async fn engine_missions_milestone(vault: String, slug: String, op: String, title: Option<String>, id: Option<String>, due: Option<String>) -> Result<serde_json::Value, String> {
    let mut a = base(&vault, "milestone");
    a.push(ok_slug(&slug)?.into());
    a.push(one_of(&op, &["add", "done", "undone", "move"])?.into());
    if let Some(t) = title.filter(|s| !s.trim().is_empty()) { a.push("--title".into()); a.push(text(&t, 160)?); }
    if let Some(i) = id.filter(|s| !s.is_empty()) { a.push("--id".into()); a.push(ok_ref(&i)?.into()); }
    if let Some(d) = due.filter(|s| !s.is_empty()) { a.push("--due".into()); a.push(ok_ref(&d)?.into()); }
    blocking(a).await
}

/// A budget line, or a spend the user records (money is only ever recorded here, never moved).
#[tauri::command]
pub(crate) async fn engine_missions_budget(vault: String, slug: String, op: String, line: String, usd: f64, what: Option<String>) -> Result<serde_json::Value, String> {
    if !(usd.is_finite() && usd >= 0.0) { return Err("usd must be a positive number".into()); }
    let mut a = base(&vault, "budget");
    a.push(ok_slug(&slug)?.into());
    a.push(one_of(&op, &["set-line", "spend"])?.into());
    a.push("--line".into()); a.push(text(&line, 60)?);
    a.push("--usd".into()); a.push(format!("{usd}"));
    if let Some(w) = what.filter(|s| !s.trim().is_empty()) { a.push("--what".into()); a.push(text(&w, 200)?); }
    blocking(a).await
}

/// pause | resume | archive | reopen (a new target on reopen).
#[tauri::command]
pub(crate) async fn engine_missions_state(vault: String, slug: String, action: String, target: Option<String>) -> Result<serde_json::Value, String> {
    let act = one_of(&action, &["pause", "resume", "archive", "reopen"])?.to_string();
    let mut a = base(&vault, &act);
    a.push(ok_slug(&slug)?.into());
    if let Some(t) = target.filter(|s| !s.is_empty()) { a.push("--target".into()); a.push(ok_ref(&t)?.into()); }
    blocking(a).await
}

#[tauri::command]
pub(crate) async fn engine_missions_log(vault: String, slug: String, line: String) -> Result<serde_json::Value, String> {
    let mut a = base(&vault, "log");
    a.push(ok_slug(&slug)?.into());
    a.push("--text".into()); a.push(text(&line, 400)?);
    blocking(a).await
}

/// The close-out draft: every line the mission would file, each ticked.
#[tauri::command]
pub(crate) async fn engine_missions_closeout_plan(vault: String, slug: String, result: Option<String>, note: Option<String>) -> Result<serde_json::Value, String> {
    let mut a = base(&vault, "complete");
    a.push(ok_slug(&slug)?.into());
    a.push("--plan-only".into());
    if let Some(r) = result { a.push("--result".into()); a.push(one_of(&r, &["met", "partly", "not-met", "changed"])?.into()); }
    if let Some(n) = note.filter(|s| !s.trim().is_empty()) { a.push("--note".into()); a.push(text(&n, 200)?); }
    blocking(a).await
}

/// File what the user kept (the plan they saw, on stdin) and complete the mission.
#[tauri::command]
pub(crate) async fn engine_missions_closeout_apply(vault: String, slug: String, plan: serde_json::Value) -> Result<serde_json::Value, String> {
    let s = ok_slug(&slug)?.to_string();
    if plan.get("slug").and_then(|x| x.as_str()) != Some(s.as_str()) { return Err("the plan is for another mission".into()); }
    let body = plan.to_string();
    tokio::task::spawn_blocking(move || run_engine_json_stdin(&["--vault", &vault, "missions", "complete", &s, "--apply", "-"], &body))
        .await
        .map_err(|e| format!("engine task failed: {e}"))?
}

/// Undo one close-out line (within 7 days).
#[tauri::command]
pub(crate) async fn engine_missions_undo(vault: String, slug: String, n: u32) -> Result<serde_json::Value, String> {
    let n = n.to_string();
    blocking(v(&["--vault", &vault, "missions", "undo", ok_slug(&slug)?, &n])).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_and_text_never_pose_as_flags() {
        assert!(ok_slug("learn-the-cello").is_ok());
        assert!(ok_slug("--vault").is_err());
        assert!(ok_slug("../x").is_err());
        assert!(ok_slug("Learn").is_err());
        assert!(text("--json", 10).is_err());
        assert_eq!(text("two\nlines", 20).unwrap(), "two lines");
        assert!(ok_ref("person/tutor-example").is_ok());
        assert!(ok_ref("-x").is_err());
    }

    #[test]
    fn create_args_carry_roles_and_only_what_was_asked() {
        let a = create_args("/v", "Paint the shed", Some("Shed painted"), None, Some("homestead"), &["money".into()], &[], &["paint-shop".into()], &["researcher".into()], Some(200.0), &["Buy paint".into()], None).unwrap();
        assert_eq!(a, vec!["--vault", "/v", "missions", "create", "--name", "Paint the shed", "--outcome", "Shed painted", "--owner", "homestead", "--consult", "money", "--app", "paint-shop", "--specialist", "researcher", "--budget-usd", "200", "--milestone", "Buy paint"]);
        assert!(create_args("/v", "x", None, None, Some("--evil"), &[], &[], &[], &[], None, &[], None).is_err());
    }
}
