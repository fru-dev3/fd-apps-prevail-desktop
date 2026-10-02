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

async fn blocking_stdin(args: Vec<String>, body: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let a: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        crate::engine::run_engine_json_stdin(&a, &body)
    })
    .await
    .map_err(|e| format!("engine task failed: {e}"))?
}

/// Save the user's version of a specialist (the engine validates, keeps the
/// prior file as a dated version and refuses a ceiling raise unless confirmed).
#[tauri::command]
pub(crate) async fn engine_specialist_save(vault: String, id: String, edit: serde_json::Value, confirm_raise: Option<bool>) -> Result<serde_json::Value, String> {
    if !edit.is_object() { return Err("edit must be an object".into()); }
    let mut a = v(&["--vault", &vault, "specialists", "save", ok_id(&id)?, "--file", "-"]);
    if confirm_raise == Some(true) { a.push("--confirm-raise".into()); }
    blocking_stdin(a, edit.to_string()).await
}

/// A domain's instructions for a specialist (tighten-only, enforced by the engine).
#[tauri::command]
pub(crate) async fn engine_specialist_domain_save(vault: String, id: String, domain: String, edit: serde_json::Value) -> Result<serde_json::Value, String> {
    if !edit.is_object() { return Err("edit must be an object".into()); }
    let a = v(&["--vault", &vault, "specialists", "domain-save", ok_id(&id)?, "--domain", ok_id(&domain)?, "--file", "-"]);
    blocking_stdin(a, edit.to_string()).await
}

/// Back to the built-in: the override moves aside, never deleted.
#[tauri::command]
pub(crate) async fn engine_specialist_reset(vault: String, id: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "specialists", "reset", ok_id(&id)?])).await
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

// ── Specialists Phase 2: playbooks ──

/// Every playbook in its group (running, yours, drafts, built-in).
#[tauri::command]
pub(crate) async fn engine_playbook_rows(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "playbook", "rows", "--json"])).await
}

/// One playbook: its steps as rows, what triggers it, its run history.
#[tauri::command]
pub(crate) async fn engine_playbook_show(vault: String, id: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "playbook", "show", ok_playbook(&id)?, "--json"])).await
}

/// Save a job as a playbook (a draft unless adopt).
#[tauri::command]
pub(crate) async fn engine_playbook_save(vault: String, job_id: String, name: Option<String>, adopt: Option<bool>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "playbook", "save", ok_id(&job_id)?, "--json"]);
    if let Some(n) = name.filter(|n| !n.trim().is_empty()) {
        if n.starts_with('-') || n.chars().any(|c| c.is_control()) { return Err("invalid name".into()); }
        a.push("--name".into()); a.push(n.chars().take(80).collect());
    }
    if adopt == Some(true) { a.push("--adopt".into()); }
    blocking(a).await
}

/// A draft becomes one of yours.
#[tauri::command]
pub(crate) async fn engine_playbook_adopt(vault: String, id: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "playbook", "adopt", ok_playbook(&id)?, "--json"])).await
}

/// Run a playbook now (in a domain, for one that names none). Waits for the run.
#[tauri::command]
pub(crate) async fn engine_playbook_run(vault: String, id: String, domain: Option<String>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "run-playbook", ok_playbook(&id)?, "--json"]);
    if let Some(d) = domain.filter(|d| !d.is_empty()) { a.push("--domain".into()); a.push(ok_playbook(&d)?.to_string()); }
    blocking(a).await
}

// ── Specialists Phase 3: standing work ──

/// Answer one action the Operator named, from the job card: allow (runs in
/// its own process, behind the broker again) or deny. The same queue the
/// Inbox reads.
#[tauri::command]
pub(crate) async fn engine_job_act(vault: String, id: String, n: u32, answer: String) -> Result<serde_json::Value, String> {
    let flag = match one_of(&answer, &["allow", "deny"])? { "allow" => "--approve", _ => "--deny" };
    let n = n.to_string();
    blocking(v(&["--vault", &vault, "job", "act", ok_id(&id)?, &n, flag, "--json"])).await
}

/// Playbook runs the user did not start (a loop's clock, a radar event), until seen.
#[tauri::command]
pub(crate) async fn engine_playbook_inbox(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "playbook", "inbox", "--json"])).await
}

#[tauri::command]
pub(crate) async fn engine_playbook_seen(vault: String, run_id: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "playbook", "seen", ok_playbook(&run_id)?, "--json"])).await
}

/// Put a playbook on a schedule (daily, weekly, monthly) or a radar event in a domain or mission.
#[tauri::command]
pub(crate) async fn engine_playbook_trigger(vault: String, id: String, domain: String, cadence: Option<String>, on: Option<String>, off: Option<bool>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "playbook", "trigger", ok_playbook(&id)?, "--domain", ok_id(&domain)?, "--json"]);
    if let Some(c) = cadence.filter(|c| !c.is_empty()) { a.push("--cadence".into()); a.push(one_of(&c, &["daily", "weekly", "monthly"])?.to_string()); }
    if let Some(o) = on.filter(|o| !o.is_empty()) {
        let ok = o.len() <= 80 && !o.starts_with('-') && o.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | ' ' | '-' | '.'));
        if !ok { return Err("invalid event".into()); }
        a.push("--on".into()); a.push(o);
    }
    if off == Some(true) { a.push("--off".into()); }
    blocking(a).await
}

// ── Goals G4: initiatives (the plan's paths) ──

/// A goal's initiatives: the Compass lines, the weekly check and what was left out.
#[tauri::command]
pub(crate) async fn engine_initiatives(vault: String, goal: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "compass", "paths", ok_playbook(&goal)?, "--json"])).await
}

/// Propose initiatives for a goal (one model call, then the code screen). Takes a minute or two.
#[tauri::command]
pub(crate) async fn engine_initiatives_generate(vault: String, goal: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "compass", "paths", ok_playbook(&goal)?, "--generate", "--json"])).await
}

/// Choose an initiative (or try it as a trial): commit date, expectations, its playbooks installed.
#[tauri::command]
pub(crate) async fn engine_initiative_choose(vault: String, id: String, until: Option<String>, trial: Option<bool>) -> Result<serde_json::Value, String> {
    let act = if trial == Some(true) { "trial" } else { "choose" };
    let mut a = v(&["--vault", &vault, "compass", "path", act, ok_playbook(&id)?, "--json"]);
    if let Some(u) = until.filter(|u| !u.is_empty()) {
        if u.len() != 10 || !u.chars().all(|c| c.is_ascii_digit() || c == '-') { return Err("until is YYYY-MM-DD".into()); }
        a.push("--until".into()); a.push(u);
    }
    blocking(a).await
}

/// Retire (or turn down) an initiative, with the reason; its loops stop.
#[tauri::command]
pub(crate) async fn engine_initiative_retire(vault: String, id: String, because: String) -> Result<serde_json::Value, String> {
    let b: String = because.chars().filter(|c| !c.is_control()).take(200).collect();
    if b.trim().is_empty() || b.starts_with('-') { return Err("a reason is needed".into()); }
    blocking(vec!["--vault".into(), vault, "compass".into(), "path".into(), "retire".into(), ok_playbook(&id)?.to_string(), "--because".into(), b, "--json".into()]).await
}

// ── Goals G1b: the Compass chain ──

/// The chain as a tree: every node with its parents and children, and what is not linked per level.
#[tauri::command]
pub(crate) async fn engine_compass_tree(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "compass", "tree", "--json"])).await
}

/// Proposed links (goal to objective, task to initiative), each with the quote that suggested it.
#[tauri::command]
pub(crate) async fn engine_compass_links(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "compass", "links", "--json"])).await
}

/// Accept or turn down a proposed link, or link a goal to an objective directly.
#[tauri::command]
pub(crate) async fn engine_compass_link(vault: String, action: String, id: String, to: Option<String>) -> Result<serde_json::Value, String> {
    let act = one_of(&action, &["accept", "decline", "link"])?.to_string();
    if act == "link" {
        let t = to.ok_or("an objective is needed")?;
        return blocking(v(&["--vault", &vault, "compass", "link", ok_playbook(&id)?, ok_playbook(&t)?, "--json"])).await;
    }
    blocking(v(&["--vault", &vault, "compass", "link", &act, ok_playbook(&id)?, "--json"])).await
}

/// The quarterly initiative review (keep, switch or drop), written as a page in General.
#[tauri::command]
pub(crate) async fn engine_initiatives_review(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "compass", "paths", "review", "--json"])).await
}

// ── Metrics M5: stories and experiments ──

fn ok_period(p: &str, len: usize) -> Result<&str, String> {
    if p.len() == len && p.chars().all(|c| c.is_ascii_digit() || c == '-') { Ok(p) } else { Err(format!("invalid period: {p}")) }
}

/// Your Year, a month's recap, the patterns across metrics, or the experiments.
#[tauri::command]
pub(crate) async fn engine_story(vault: String, kind: String, period: Option<String>) -> Result<serde_json::Value, String> {
    let k = one_of(&kind, &["year", "recap", "patterns", "experiments"])?.to_string();
    let mut a = v(&["--vault", &vault, "metrics", &k, "--json"]);
    if let Some(p) = period.filter(|p| !p.is_empty()) {
        if k == "year" { a.push("--year".into()); a.push(ok_period(&p, 4)?.to_string()); }
        if k == "recap" { a.push("--month".into()); a.push(ok_period(&p, 7)?.to_string()); }
    }
    blocking(a).await
}

/// Write Your Year (one self-contained page) or a month's recap into General's reviews.
#[tauri::command]
pub(crate) async fn engine_story_write(vault: String, kind: String, period: Option<String>) -> Result<serde_json::Value, String> {
    let k = one_of(&kind, &["year", "recap"])?.to_string();
    let mut a = v(&["--vault", &vault, "metrics", &k, "--write", "--json"]);
    if let Some(p) = period.filter(|p| !p.is_empty()) {
        if k == "year" { a.push("--year".into()); a.push(ok_period(&p, 4)?.to_string()); } else { a.push("--month".into()); a.push(ok_period(&p, 7)?.to_string()); }
    }
    blocking(a).await
}

/// An n-of-1 experiment: propose one from a pattern, start, stop or score it.
#[tauri::command]
pub(crate) async fn engine_experiment(vault: String, action: String, id: Option<String>, key: Option<String>) -> Result<serde_json::Value, String> {
    let act = one_of(&action, &["propose", "start", "stop", "score"])?.to_string();
    let mut a = v(&["--vault", &vault, "metrics", "experiment", &act]);
    if act == "propose" {
        let k = key.unwrap_or_default();
        if k.is_empty() || k.len() > 120 || !k.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '>' | '@')) { return Err("invalid pattern key".into()); }
        a.push(k);
    } else {
        a.push(ok_playbook(&id.unwrap_or_default())?.to_string());
    }
    a.push("--json".into());
    blocking(a).await
}

// ── Today T5: time ──

/// This week's calendar by value, next week against capacity, holds and drafted declines.
#[tauri::command]
pub(crate) async fn engine_time(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "time", "review", "--json"])).await
}

/// A protected block: approve (a tentative hold on your own calendar) or decline.
#[tauri::command]
pub(crate) async fn engine_time_hold(vault: String, id: String, action: String) -> Result<serde_json::Value, String> {
    let act = one_of(&action, &["approve", "decline"])?.to_string();
    blocking(v(&["--vault", &vault, "time", "hold", &act, ok_playbook(&id)?, "--json"])).await
}

// ── Today T6: tell the chief of staff anything ──

/// File anything said (a task, a promise, a decision, a note...) where it belongs, with a receipt.
#[tauri::command]
pub(crate) async fn engine_tell(vault: String, text: String, surface: Option<String>, domain: Option<String>, mission: Option<String>) -> Result<serde_json::Value, String> {
    let t: String = text.chars().filter(|c| !c.is_control() || *c == ' ').take(600).collect();
    if t.trim().is_empty() { return Err("tell me something to file".into()); }
    let s = one_of(surface.as_deref().unwrap_or("desktop"), &["desktop", "phone"])?.to_string();
    let mut a = vec!["--vault".to_string(), vault, "tell".into(), "--text".into(), t, "--surface".into(), s, "--json".into()];
    if let Some(d) = domain.filter(|d| !d.is_empty()) { a.push("--domain".into()); a.push(ok_playbook(&d)?.to_string()); }
    if let Some(m) = mission.filter(|m| !m.is_empty()) { a.push("--mission".into()); a.push(ok_playbook(&m)?.to_string()); }
    blocking(a).await
}

#[tauri::command]
pub(crate) async fn engine_tell_undo(vault: String, id: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "tell", "undo", ok_playbook(&id)?, "--json"])).await
}

#[tauri::command]
pub(crate) async fn engine_told(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "tell", "list", "--json"])).await
}

/// Every open loop across the vault.
#[tauri::command]
pub(crate) async fn engine_forgetting(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "forgetting", "--json"])).await
}

/// Playbook ids and domain slugs: a plain slug, nothing else.
fn ok_playbook(s: &str) -> Result<&str, String> {
    let mut c = s.chars();
    let first_ok = c.next().map(|f| f.is_ascii_alphanumeric()).unwrap_or(false);
    if first_ok && s.len() <= 81 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') { Ok(s) } else { Err(format!("invalid id: {s}")) }
}

#[cfg(test)]
mod playbook_tests {
    use super::*;
    #[test]
    fn playbook_ids_are_slugs() {
        assert!(ok_playbook("renewal-review").is_ok());
        assert!(ok_playbook("foo_2").is_ok());
        assert!(ok_playbook("../x").is_err());
        assert!(ok_playbook("-x").is_err());
        assert!(ok_playbook("a/b").is_err());
        assert!(ok_playbook("").is_err());
    }
}

// ── Today T4: decisions found and recommended ──

/// Get an open decision a recommendation (the Steward, or the council for a big one). Takes minutes.
#[tauri::command]
pub(crate) async fn engine_decision_recommend(vault: String, target: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "decide", "recommend", ok_id(&target)?])).await
}

/// Open decision records from tasks phrased as decisions.
#[tauri::command]
pub(crate) async fn engine_decisions_scan(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "decide", "scan"])).await
}

/// A Compass conflict as a decision.
#[tauri::command]
pub(crate) async fn engine_decision_from_conflict(vault: String, key: String) -> Result<serde_json::Value, String> {
    let ok = !key.is_empty() && key.len() <= 200 && !key.starts_with('-') && key.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '_' | '|' | '.' | '-'));
    if !ok { return Err(format!("invalid conflict key: {key}")); }
    blocking(vec!["--vault".into(), vault, "decide".into(), "from-conflict".into(), key]).await
}

/// Open a decision record (the Yes on a decision offer in chat).
#[tauri::command]
pub(crate) async fn engine_decision_open(vault: String, question: String, domain: String, due: Option<String>) -> Result<serde_json::Value, String> {
    let q: String = question.replace(['\n', '\r'], " ").trim().chars().take(200).collect();
    if q.is_empty() || q.starts_with('-') { return Err("invalid question".into()); }
    let mut a = vec!["--vault".into(), vault, "decide".into(), "open".into(), q, "--domain".into(), ok_id(&domain)?.to_string()];
    if let Some(d) = due.filter(|d| !d.is_empty()) {
        if !(d.len() == 10 && d.chars().all(|c| c.is_ascii_digit() || c == '-')) { return Err("due is YYYY-MM-DD".into()); }
        a.push("--due".into()); a.push(d);
    }
    blocking(a).await
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

// ── Goals G3: alignment, conflicts and the non-negotiables ──

/// A conflict key from the engine (`presence:g-a-p1|g-b-p1`): plain characters only.
fn ok_conflict_key(s: &str) -> Result<&str, String> {
    if !s.is_empty() && s.len() <= 200 && !s.starts_with('-') && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '_' | '|' | '.' | '-')) {
        Ok(s)
    } else {
        Err(format!("invalid conflict key: {s}"))
    }
}

/// The weekly roll-up: matters vs lived, attention per value, conflicts, rules, Needs you (model: also run the model pass).
#[tauri::command]
pub(crate) async fn engine_compass_align(vault: String, model: Option<bool>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "compass", "align"]);
    if model == Some(true) { a.push("--model".into()); }
    blocking(a).await
}

/// Each confirmed non-negotiable's state, checked in code.
#[tauri::command]
pub(crate) async fn engine_compass_rules(vault: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "compass", "rules"])).await
}

/// Accept a conflict as a tension, mark it resolved, or reopen it.
#[tauri::command]
pub(crate) async fn engine_compass_conflict(vault: String, key: String, answer: String) -> Result<serde_json::Value, String> {
    let ans = one_of(&answer, &["accept", "resolved", "reopen"])?.to_string();
    let k = ok_conflict_key(&key)?.to_string();
    blocking(vec!["--vault".into(), vault, "compass".into(), "conflict".into(), k, ans]).await
}

#[cfg(test)]
mod g3_tests {
    use super::*;
    #[test]
    fn conflict_keys_are_validated() {
        assert!(ok_conflict_key("presence:g-a-p1|g-b-p1").is_ok());
        assert!(ok_conflict_key("model:g-3511ed|g-bdebdb").is_ok());
        assert!(ok_conflict_key("--evil").is_err());
        assert!(ok_conflict_key("a b").is_err());
        assert!(ok_conflict_key("../x/y").is_err());
        assert!(one_of("accept", &["accept", "resolved", "reopen"]).is_ok());
        assert!(one_of("delete", &["accept", "resolved", "reopen"]).is_err());
    }
}

// ── Today T2 and T3: commitments, the radar, routines ──

/// Open commitments and waiting-fors (list), or the promises waiting for the review (proposals).
#[tauri::command]
pub(crate) async fn engine_commitments(vault: String, view: Option<String>) -> Result<serde_json::Value, String> {
    let sub = one_of(view.as_deref().unwrap_or("list"), &["list", "proposals"])?.to_string();
    blocking(v(&["--vault", &vault, "commitments", &sub])).await
}

/// Yes (files it) or Not now on a promise found in mail or notes.
#[tauri::command]
pub(crate) async fn engine_commitment_answer(vault: String, src: String, yes: bool, domain: Option<String>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "commitments", "answer", ok_id(&src)?, if yes { "yes" } else { "no" }]);
    if let Some(d) = domain.filter(|d| !d.is_empty()) { a.push("--domain".into()); a.push(ok_id(&d)?.to_string()); }
    blocking(a).await
}

/// Undo a commitment or waiting-for that was filed (takes out exactly its line).
#[tauri::command]
pub(crate) async fn engine_commitment_undo(vault: String, id: String) -> Result<serde_json::Value, String> {
    blocking(v(&["--vault", &vault, "commitments", "undo", ok_id(&id)?])).await
}

/// The radar: everything falling behind, with evidence (refresh recomputes).
#[tauri::command]
pub(crate) async fn engine_radar(vault: String, refresh: Option<bool>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "radar", "show"]);
    if refresh == Some(true) { a.push("--refresh".into()); }
    blocking(a).await
}

/// Routine candidates from the domains (bootstrap: add them to the Compass as proposed lines).
#[tauri::command]
pub(crate) async fn engine_routines(vault: String, bootstrap: Option<bool>) -> Result<serde_json::Value, String> {
    let mut a = v(&["--vault", &vault, "radar", "routines"]);
    if bootstrap == Some(true) { a.push("bootstrap".into()); }
    blocking(a).await
}

