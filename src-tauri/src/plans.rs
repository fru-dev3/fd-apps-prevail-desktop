// Step 3 of the plans, desktop side: thin, validated passthroughs to the
// engine for Today, the weekly review, jobs and specialists, open decisions,
// metric proposals and the chief of staff's settings. The engine owns every
// file these touch; nothing here writes the vault itself.

use crate::engine::run_engine_json;

fn ok_id(s: &str) -> Result<&str, String> {
    if !s.is_empty() && s.len() <= 160 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.' | '/')) && !s.contains("..") {
        Ok(s)
    } else {
        Err(format!("invalid id: {s}"))
    }
}

fn one_of<'a>(s: &'a str, allowed: &[&str]) -> Result<&'a str, String> {
    if allowed.contains(&s) { Ok(s) } else { Err(format!("unknown action: {s}")) }
}

async fn blocking(args: Vec<String>) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let a: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_engine_json(&a)
    })
    .await
    .map_err(|e| format!("engine task failed: {e}"))?
}

fn v(xs: &[&str]) -> Vec<String> { xs.iter().map(|s| s.to_string()).collect() }

/// The Today card (composed once a day; refresh recomposes, keeping the taps).
#[tauri::command]
pub(crate) async fn engine_today(vault: String, refresh: Option<bool>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "today", "show"]);
    if refresh == Some(true) { a.push("--refresh".into()); }
    blocking(a).await
}

/// One tap on a Today item: done, move, not-important, right, right-list.
#[tauri::command]
pub(crate) async fn engine_today_tap(vault: String, key: String, action: String) -> Result<serde_json::Value, String> {
    let act = one_of(&action, &["done", "move", "not-important", "right", "right-list"])?.to_string();
    let k = if action == "right-list" && key.is_empty() { "list".to_string() } else { ok_id(&key)?.to_string() };
    blocking(v(&["--vault", &vault, "today", "tap", &k, &act])).await
}

/// This week's review card.
#[tauri::command]
pub(crate) async fn engine_review(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "review", "week"])).await
}

/// The weekly 1-5 check-in.
#[tauri::command]
pub(crate) async fn engine_review_checkin(vault: String, calm: u8, note: Option<String>) -> Result<serde_json::Value, String> {
    if !(1..=5).contains(&calm) { return Err("calm is 1 to 5".into()); }
    let c = calm.to_string();
    let mut a = v(&["--vault", &vault, "review", "checkin", &c]);
    if let Some(n) = note.filter(|n| !n.trim().is_empty()) { a.push("--note".into()); a.push(n.chars().take(280).collect()); }
    blocking(a).await
}

/// Yes or Not now on a Compass line heard in chat.
#[tauri::command]
pub(crate) async fn engine_review_candidate(vault: String, key: String, answer: String) -> Result<serde_json::Value, String> {
    let ans = one_of(&answer, &["yes", "no"])?.to_string();
    if key.len() > 200 || key.contains('\n') { return Err("invalid key".into()); }
    blocking(vec!["--vault".into(), vault, "review".into(), "candidate".into(), key, ans]).await
}

#[tauri::command]
pub(crate) async fn engine_specialists(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "specialists", "list"])).await
}

/// One specialist with its notebooks (or, with a domain, its notes and notebook there).
#[tauri::command]
pub(crate) async fn engine_specialist_show(vault: String, id: String, domain: Option<String>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "specialists", "show", ok_id(&id)?]);
    if let Some(d) = domain.filter(|d| !d.is_empty()) { a.push("--domain".into()); a.push(ok_id(&d)?.to_string()); }
    blocking(a).await
}

#[tauri::command]
pub(crate) async fn engine_jobs(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "job", "list"])).await
}

#[tauri::command]
pub(crate) async fn engine_job_show(vault: String, id: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "job", "show", ok_id(&id)?])).await
}

/// Start (the user's yes) or stop a job.
#[tauri::command]
pub(crate) async fn engine_job_action(vault: String, id: String, action: String) -> Result<serde_json::Value, String> {
    let act = one_of(&action, &["start", "stop"])?.to_string();
    blocking(v(&["--vault", &vault, "job", &act, ok_id(&id)?])).await
}

/// Undo one filed write of a job.
#[tauri::command]
pub(crate) async fn engine_job_undo(vault: String, id: String, n: u32) -> Result<serde_json::Value, String> {
    let n = n.to_string();
    blocking(v(&["--vault", &vault, "job", "undo", ok_id(&id)?, &n])).await
}

/// Adjust a job before it runs: owner, the domains it reads and tells, the team, the effort.
#[tauri::command]
pub(crate) async fn engine_job_adjust(vault: String, id: String, owner: Option<String>, consulted: Option<Vec<String>>, informed: Option<Vec<String>>, team: Option<Vec<Vec<String>>>, effort: Option<String>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "job", "adjust", ok_id(&id)?]);
    if let Some(o) = owner { a.push("--owner".into()); a.push(ok_id(&o)?.to_string()); }
    for (flag, list) in [("--consulted", consulted), ("--informed", informed)] {
        if let Some(l) = list {
            for d in &l { ok_id(d)?; }
            a.push(flag.into());
            a.push(if l.is_empty() { ",".into() } else { l.join(",") });
        }
    }
    if let Some(t) = team {
        for s in t.iter().flatten() { ok_id(s)?; }
        a.push("--team".into());
        a.push(t.iter().map(|s| s.join("+")).collect::<Vec<_>>().join(">"));
    }
    if let Some(e) = effort { a.push("--effort".into()); a.push(one_of(&e, &["quick", "standard", "deep"])?.to_string()); }
    blocking(a).await
}

/// Open decisions (all: decided ones too).
#[tauri::command]
pub(crate) async fn engine_decisions(vault: String, all: Option<bool>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "decide", "list"]);
    if all == Some(true) { a.push("--all".into()); }
    blocking(a).await
}

/// gut, decide or retro on one decision (domain/slug).
#[tauri::command]
pub(crate) async fn engine_decision_action(vault: String, target: String, action: String, text: String, why: Option<String>, right: Option<String>) -> Result<serde_json::Value, String> {
    let act = one_of(&action, &["gut", "decide", "retro"])?.to_string();
    let mut a = vec!["--vault".into(), vault, "decide".into(), act, ok_id(&target)?.to_string(), text.chars().take(400).collect::<String>()];
    if let Some(w) = why.filter(|w| !w.trim().is_empty()) { a.push("--why".into()); a.push(w.chars().take(400).collect()); }
    if let Some(r) = right { a.push("--right".into()); a.push(one_of(&r, &["gut", "recommendation", "both", "neither"])?.to_string()); }
    blocking(a).await
}

/// Metric proposals, ranked (or the change-point insights).
#[tauri::command]
pub(crate) async fn engine_metric_proposals(vault: String, view: Option<String>) -> Result<serde_json::Value, String> {
    let sub = one_of(view.as_deref().unwrap_or("proposals"), &["proposals", "insights", "acceptance"])?.to_string();
    blocking(v(&["--vault", &vault, "metrics", &sub])).await
}

/// Track, Not useful or Edit on a metric proposal.
#[tauri::command]
pub(crate) async fn engine_metric_answer(vault: String, key: String, answer: String, title: Option<String>, serves: Option<String>, never: Option<String>) -> Result<serde_json::Value, String> {
    let ans = one_of(&answer, &["track", "dismiss", "edit"])?.to_string();
    let mut a = v(&["--vault", &vault, "metrics", "answer", ok_id(&key)?, &ans]);
    if let Some(t) = title.filter(|t| !t.trim().is_empty()) { a.push("--title".into()); a.push(t.chars().take(80).collect()); }
    if let Some(s) = serves.filter(|s| !s.is_empty()) { a.push("--serves".into()); a.push(ok_id(&s)?.to_string()); }
    if let Some(n) = never.filter(|n| !n.trim().is_empty()) { a.push("--never".into()); a.push(n.chars().take(80).collect()); }
    blocking(a).await
}

/// The chief of staff's name, handoff mode, limits or never-read domains.
#[tauri::command]
pub(crate) async fn engine_chief_set(vault: String, key: String, value: String) -> Result<serde_json::Value, String> {
    let k = one_of(&key, &["name", "handoff", "usd", "minutes", "never"])?.to_string();
    let val: String = value.chars().take(400).collect();
    if k == "name" {
        return blocking(vec!["--vault".into(), vault, "chief".into(), "set-name".into(), val]).await;
    }
    blocking(vec!["--vault".into(), vault, "chief".into(), "set".into(), k, val]).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_and_actions_are_validated() {
        assert!(ok_id("2026-10-02-0814-find-foo").is_ok());
        assert!(ok_id("task:money:m2").is_ok());
        assert!(ok_id("home/keep-or-sell").is_ok());
        assert!(ok_id("../etc").is_err());
        assert!(ok_id("a b").is_err());
        assert!(ok_id("").is_err());
        assert!(one_of("start", &["start", "stop"]).is_ok());
        assert!(one_of("rm", &["start", "stop"]).is_err());
    }
}
