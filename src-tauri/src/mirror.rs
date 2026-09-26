// Mirror: findings about the user drawn from their own prompts, the raw
// play-by-play of every sitting, and a project's restart brief. The engine
// owns all of it (`prevail mirror ...`, `prevail projects restart|diff`);
// these commands are thin bridges. Engine calls block, so each runs on the
// blocking pool.

async fn json(args: Vec<String>) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        crate::engine::run_engine_json(&refs)
    })
    .await
    .map_err(|e| format!("intent task failed: {e}"))?
}

async fn raw(args: Vec<String>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        crate::engine::run_engine_raw(&refs)
    })
    .await
    .map_err(|e| format!("intent task failed: {e}"))?
}

fn opt(args: &mut Vec<String>, flag: &str, v: Option<&str>) {
    if let Some(v) = v.map(str::trim).filter(|v| !v.is_empty()) {
        args.push(flag.into());
        args.push(v.to_string());
    }
}

#[tauri::command]
pub async fn mirror_findings(vault: String) -> Result<serde_json::Value, String> {
    json(vec!["intent".into(), "findings".into(), "--vault".into(), vault]).await
}

pub(crate) fn verdict_args(vault: &str, finding_id: &str, verdict: &str, item: Option<&str>, rule: Option<&str>) -> Result<Vec<String>, String> {
    if !matches!(verdict, "true" | "not_really" | "later" | "resume" | "let_go") {
        return Err(format!("unknown verdict: {verdict}"));
    }
    let mut args: Vec<String> = vec!["intent".into(), "verdict".into(), finding_id.into(), verdict.into()];
    opt(&mut args, "--item", item);
    opt(&mut args, "--rule", rule);
    args.push("--vault".into());
    args.push(vault.into());
    Ok(args)
}

#[tauri::command]
pub async fn mirror_verdict(
    vault: String,
    finding_id: String,
    verdict: String,
    item: Option<String>,
    rule: Option<String>,
) -> Result<serde_json::Value, String> {
    json(verdict_args(&vault, &finding_id, &verdict, item.as_deref(), rule.as_deref())?).await
}

// A period key is a plain date (YYYY-MM-DD); anything else never reaches the engine.
pub(crate) fn date_key(v: &str) -> Result<String, String> {
    let v = v.trim();
    let ok = v.len() == 10
        && v.chars().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() });
    if ok { Ok(v.to_string()) } else { Err(format!("expected a date like 2026-09-14, got \"{v}\"")) }
}

fn tz_arg(args: &mut Vec<String>, tz: Option<i32>) {
    if let Some(t) = tz.filter(|t| (-900..=900).contains(t)) {
        args.push("--tz".into());
        args.push(t.to_string());
    }
}

// The period flag: a week (its Monday, or any day in it) or one day.
fn period_flag(args: &mut Vec<String>, kind: &str, key: &str) -> Result<(), String> {
    let flag = match kind { "week" => "--week", "day" => "--day", _ => return Err(format!("unknown period: {kind}")) };
    args.push(flag.into());
    args.push(date_key(key)?);
    Ok(())
}

pub(crate) fn periods_args(vault: &str, tz: Option<i32>) -> Vec<String> {
    let mut args: Vec<String> = vec!["intent".into(), "periods".into(), "--vault".into(), vault.into()];
    tz_arg(&mut args, tz);
    args
}

#[tauri::command]
pub async fn mirror_periods(vault: String, tz: Option<i32>) -> Result<serde_json::Value, String> {
    json(periods_args(&vault, tz)).await
}

pub(crate) fn period_args(vault: &str, kind: &str, key: &str, tz: Option<i32>, fresh: bool) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = vec!["intent".into(), "findings".into()];
    period_flag(&mut args, kind, key)?;
    args.push("--vault".into());
    args.push(vault.into());
    tz_arg(&mut args, tz);
    if fresh {
        args.push("--fresh".into());
    }
    Ok(args)
}

#[tauri::command]
pub async fn mirror_period(vault: String, kind: String, key: String, tz: Option<i32>, fresh: Option<bool>) -> Result<serde_json::Value, String> {
    json(period_args(&vault, &kind, &key, tz, fresh.unwrap_or(false))?).await
}

// The model-written parts of a week (its line, day lines, its letter once it
// is over). Runs a model, so it stays off the WebUI allowlist.
pub(crate) fn generate_args(vault: &str, week: &str, tz: Option<i32>, fresh: bool) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = vec!["intent".into(), "generate".into()];
    period_flag(&mut args, "week", week)?;
    args.push("--vault".into());
    args.push(vault.into());
    tz_arg(&mut args, tz);
    if fresh {
        args.push("--fresh".into());
    }
    Ok(args)
}

#[tauri::command]
pub async fn mirror_generate(vault: String, week: String, tz: Option<i32>, fresh: Option<bool>) -> Result<serde_json::Value, String> {
    json(generate_args(&vault, &week, tz, fresh.unwrap_or(false))?).await
}

// A recommendation as a ready-to-paste instruction for an agent (plain text).
#[tauri::command]
pub async fn intent_instruction(vault: String, index: u32) -> Result<String, String> {
    raw(vec!["intent".into(), "instruction".into(), index.to_string(), "--vault".into(), vault]).await
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn history_args(
    vault: &str,
    q: Option<&str>,
    tool: Option<&str>,
    project: Option<&str>,
    before: Option<i64>,
    limit: Option<u32>,
    period: Option<(&str, &str)>,
    tz: Option<i32>,
) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = vec!["intent".into(), "history".into(), "--vault".into(), vault.into()];
    opt(&mut args, "--q", q);
    opt(&mut args, "--tool", tool);
    opt(&mut args, "--project", project);
    if let Some((kind, key)) = period {
        period_flag(&mut args, kind, key)?;
    }
    tz_arg(&mut args, tz);
    if let Some(b) = before {
        args.push("--before".into());
        args.push(b.to_string());
    }
    args.push("--limit".into());
    args.push(limit.unwrap_or(200).clamp(1, 2000).to_string());
    Ok(args)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mirror_history(
    vault: String,
    q: Option<String>,
    tool: Option<String>,
    project: Option<String>,
    before: Option<i64>,
    limit: Option<u32>,
    week: Option<String>,
    day: Option<String>,
    tz: Option<i32>,
) -> Result<serde_json::Value, String> {
    let period = match (week.as_deref().filter(|w| !w.is_empty()), day.as_deref().filter(|d| !d.is_empty())) {
        (_, Some(d)) => Some(("day", d)),
        (Some(w), None) => Some(("week", w)),
        _ => None,
    };
    json(history_args(&vault, q.as_deref(), tool.as_deref(), project.as_deref(), before, limit, period, tz)?).await
}

#[tauri::command]
pub async fn mirror_refresh(vault: String, model: Option<String>) -> Result<serde_json::Value, String> {
    let mut args: Vec<String> = vec!["intent".into(), "refresh".into(), "--vault".into(), vault];
    opt(&mut args, "--model", model.as_deref());
    json(args).await
}

#[tauri::command]
pub async fn projects_restart(vault: String, slug: String) -> Result<serde_json::Value, String> {
    json(vec!["projects".into(), "restart".into(), slug, "--vault".into(), vault]).await
}

pub(crate) fn restart_text_args(
    vault: &str,
    slug: &str,
    format: &str,
    exclude: Option<&[String]>,
    with_prompts: bool,
) -> Result<Vec<String>, String> {
    if !matches!(format, "handoff" | "intent" | "raw") {
        return Err(format!("unknown format: {format}"));
    }
    let mut args: Vec<String> = vec!["projects".into(), "restart".into(), slug.into(), "--format".into(), format.into()];
    if let Some(ex) = exclude.filter(|e| !e.is_empty()) {
        args.push("--exclude".into());
        args.push(serde_json::to_string(ex).map_err(|e| e.to_string())?);
    }
    if with_prompts {
        args.push("--with-prompts".into());
    }
    args.push("--vault".into());
    args.push(vault.into());
    Ok(args)
}

#[tauri::command]
pub async fn projects_restart_text(
    vault: String,
    slug: String,
    format: String,
    exclude: Option<Vec<String>>,
    with_prompts: Option<bool>,
) -> Result<String, String> {
    raw(restart_text_args(&vault, &slug, &format, exclude.as_deref(), with_prompts.unwrap_or(false))?).await
}

#[tauri::command]
pub async fn projects_diff(vault: String, slug: String, against: String) -> Result<serde_json::Value, String> {
    if against.trim().is_empty() {
        return Err("pick a folder to check".into());
    }
    json(vec!["projects".into(), "diff".into(), slug, "--against".into(), against, "--vault".into(), vault]).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verdict_args_carry_item_and_rule() {
        assert_eq!(
            verdict_args("/v", "repeated_rules:x", "true", Some("i1"), Some("Use pnpm")).unwrap(),
            vec!["intent", "verdict", "repeated_rules:x", "true", "--item", "i1", "--rule", "Use pnpm", "--vault", "/v"]
        );
        assert_eq!(verdict_args("/v", "f", "later", None, Some(" ")).unwrap(), vec!["intent", "verdict", "f", "later", "--vault", "/v"]);
        assert!(verdict_args("/v", "f", "rm -rf", None, None).is_err());
    }

    #[test]
    fn history_args_paginate() {
        assert_eq!(
            history_args("/v", Some("tests"), None, Some("acme"), Some(1700), None, None, None).unwrap(),
            vec!["intent", "history", "--vault", "/v", "--q", "tests", "--project", "acme", "--before", "1700", "--limit", "200"]
        );
        assert_eq!(
            history_args("/v", None, None, None, None, Some(50), Some(("day", "2026-09-15")), Some(300)).unwrap(),
            vec!["intent", "history", "--vault", "/v", "--day", "2026-09-15", "--tz", "300", "--limit", "50"]
        );
        assert!(history_args("/v", None, None, None, None, None, Some(("week", "--vault=/etc")), None).is_err());
    }

    #[test]
    fn period_args_take_only_dates() {
        assert_eq!(
            period_args("/v", "week", "2026-09-14", Some(-60), false).unwrap(),
            vec!["intent", "findings", "--week", "2026-09-14", "--vault", "/v", "--tz", "-60"]
        );
        assert_eq!(period_args("/v", "day", " 2026-09-15 ", None, true).unwrap(), vec!["intent", "findings", "--day", "2026-09-15", "--vault", "/v", "--fresh"]);
        assert!(period_args("/v", "month", "2026-09-01", None, false).is_err());
        assert!(period_args("/v", "day", "2026-9-1", None, false).is_err());
        assert!(period_args("/v", "day", "2026-09-1x", None, false).is_err());
        assert_eq!(generate_args("/v", "2026-09-14", Some(9999), false).unwrap(), vec!["intent", "generate", "--week", "2026-09-14", "--vault", "/v"]);
        assert_eq!(periods_args("/v", Some(300)), vec!["intent", "periods", "--vault", "/v", "--tz", "300"]);
    }

    #[test]
    fn restart_text_args_exclude_as_json() {
        let ex = vec!["a \"b\"".to_string()];
        assert_eq!(
            restart_text_args("/v", "acme", "handoff", Some(&ex), false).unwrap(),
            vec!["projects", "restart", "acme", "--format", "handoff", "--exclude", "[\"a \\\"b\\\"\"]", "--vault", "/v"]
        );
        assert!(restart_text_args("/v", "acme", "pdf", None, false).is_err());
    }
}
