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

// ── Step 4: the stack (apps plan A2 to A4) and the sources (metrics plan M3) ──

/// The stack view: every app with usage, cost, value, health, verdict, and the cards.
#[tauri::command]
pub(crate) async fn engine_apps_stack(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "apps", "stack"])).await
}

/// Answer a stack card: keep, snooze, done, review, fix, archive (moves the folder) or cancel-steps (drafts a checklist).
#[tauri::command]
pub(crate) async fn engine_apps_card(vault: String, key: String, answer: String) -> Result<serde_json::Value, String> {
    if !(key.len() == 12 && key.chars().all(|c| c.is_ascii_hexdigit())) { return Err(format!("invalid card key: {key}")); }
    let ans = one_of(&answer, &["keep", "snooze", "done", "review", "fix", "archive", "cancel-steps"])?.to_string();
    blocking(vec!["--vault".into(), vault, "apps".into(), "card".into(), key, ans]).await
}

/// A signal that matched no app: map it to an app (a rule on the record) or ignore it.
#[tauri::command]
pub(crate) async fn engine_apps_map(vault: String, kind: String, value: String, target: String) -> Result<serde_json::Value, String> {
    let k = one_of(&kind, &["bundle", "domain", "merchant", "sender", "binary"])?.to_string();
    let ok_value = !value.trim().is_empty() && value.len() <= 200 && !value.starts_with('-') && value.chars().all(|c| !c.is_control());
    if !ok_value { return Err("invalid signal value".into()); }
    let t = if target == "ignore" { "ignore".to_string() } else { ok_id(&target)?.to_string() };
    blocking(vec!["--vault".into(), vault, "apps".into(), "map".into(), k, value, t]).await
}

/// Signals that matched no app (domains, apps, recurring merchants).
#[tauri::command]
pub(crate) async fn engine_apps_unknown(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "apps", "unknown"])).await
}

/// Run every connection probe on this Mac now.
#[tauri::command]
pub(crate) async fn engine_apps_doctor(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "apps", "doctor"])).await
}

/// Draft an offboarding checklist for one app (nothing is cancelled or sent).
#[tauri::command]
pub(crate) async fn engine_apps_offboard(vault: String, id: String) -> Result<serde_json::Value, String> {
    blocking(vec!["--vault".into(), vault, "apps".into(), "offboard".into(), ok_id(&id)?.to_string()]).await
}

/// Every source with this Mac's consent and its last sync.
#[tauri::command]
pub(crate) async fn engine_sources(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "sources", "list"])).await
}

/// Turn one source on or off on this Mac.
#[tauri::command]
pub(crate) async fn engine_source_consent(vault: String, id: String, on: bool) -> Result<serde_json::Value, String> {
    blocking(vec!["--vault".into(), vault, "sources".into(), "consent".into(), ok_id(&id)?.to_string(), if on { "on" } else { "off" }.into()]).await
}

/// Read one source now (it still checks consent).
#[tauri::command]
pub(crate) async fn engine_source_sync(vault: String, id: String) -> Result<serde_json::Value, String> {
    blocking(vec!["--vault".into(), vault, "sources".into(), "sync".into(), ok_id(&id)?.to_string()]).await
}

// ── Metrics M4: the asked measures and hypotheses on the review card ──

fn small_int(s: &str, max: u32) -> Result<String, String> {
    match s.parse::<u32>() { Ok(n) if n <= max => Ok(n.to_string()), _ => Err(format!("must be a whole number from 0 to {max}: {s}")) }
}

/// One answer on the weekly review card: the quarterly ladder (now, in five
/// years, 0 to 10), the monthly WHO-5 (five items, 0 to 5), WHO-5 on or off,
/// or a hypothesis yes or no.
#[tauri::command]
pub(crate) async fn engine_review_answer(vault: String, kind: String, values: Vec<String>) -> Result<serde_json::Value, String> {
    let mut a = vec!["--vault".to_string(), vault, "review".into()];
    match one_of(&kind, &["ladder", "who5", "who5-toggle", "hypothesis"])? {
        "ladder" => {
            if values.len() != 2 { return Err("the ladder takes two answers".into()); }
            a.push("ladder".into());
            for v in &values { a.push(small_int(v, 10)?); }
        }
        "who5" => {
            if values.len() != 5 { return Err("WHO-5 takes five answers".into()); }
            a.push("who5".into());
            for v in &values { a.push(small_int(v, 5)?); }
        }
        "who5-toggle" => {
            a.push("who5".into());
            a.push(one_of(values.first().map(|s| s.as_str()).unwrap_or(""), &["on", "off"])?.to_string());
        }
        _ => {
            if values.len() != 2 { return Err("a hypothesis takes its key and yes or no".into()); }
            a.push("hypothesis".into());
            a.push(ok_id(&values[0])?.to_string());
            a.push(one_of(&values[1], &["yes", "no"])?.to_string());
        }
    }
    blocking(a).await
}

/// Whether the optional monthly WHO-5 is on (build/_meta/metrics/asked.json, written by the engine).
#[tauri::command]
pub(crate) async fn metrics_who5_state(vault: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let p = crate::paths::build_root(&vault).join("_meta").join("metrics").join("asked.json");
        std::fs::read_to_string(p).ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
            .and_then(|v| v.get("who5").and_then(|b| b.as_bool()))
            .unwrap_or(false)
    }).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod step4_tests {
    use super::*;
    #[test]
    fn answers_are_bounded() {
        assert_eq!(small_int("10", 10).unwrap(), "10");
        assert!(small_int("11", 10).is_err());
        assert!(small_int("-1", 5).is_err());
        assert!(small_int("2.5", 5).is_err());
    }
}
