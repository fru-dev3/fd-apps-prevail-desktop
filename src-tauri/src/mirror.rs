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
    .map_err(|e| format!("mirror task failed: {e}"))?
}

async fn raw(args: Vec<String>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        crate::engine::run_engine_raw(&refs)
    })
    .await
    .map_err(|e| format!("mirror task failed: {e}"))?
}

fn opt(args: &mut Vec<String>, flag: &str, v: Option<&str>) {
    if let Some(v) = v.map(str::trim).filter(|v| !v.is_empty()) {
        args.push(flag.into());
        args.push(v.to_string());
    }
}

#[tauri::command]
pub async fn mirror_findings(vault: String) -> Result<serde_json::Value, String> {
    json(vec!["mirror".into(), "findings".into(), "--vault".into(), vault]).await
}

pub(crate) fn verdict_args(vault: &str, finding_id: &str, verdict: &str, item: Option<&str>, rule: Option<&str>) -> Result<Vec<String>, String> {
    if !matches!(verdict, "true" | "not_really" | "later" | "resume" | "let_go") {
        return Err(format!("unknown verdict: {verdict}"));
    }
    let mut args: Vec<String> = vec!["mirror".into(), "verdict".into(), finding_id.into(), verdict.into()];
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

pub(crate) fn history_args(
    vault: &str,
    q: Option<&str>,
    tool: Option<&str>,
    project: Option<&str>,
    before: Option<i64>,
    limit: Option<u32>,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["mirror".into(), "history".into(), "--vault".into(), vault.into()];
    opt(&mut args, "--q", q);
    opt(&mut args, "--tool", tool);
    opt(&mut args, "--project", project);
    if let Some(b) = before {
        args.push("--before".into());
        args.push(b.to_string());
    }
    args.push("--limit".into());
    args.push(limit.unwrap_or(200).clamp(1, 2000).to_string());
    args
}

#[tauri::command]
pub async fn mirror_history(
    vault: String,
    q: Option<String>,
    tool: Option<String>,
    project: Option<String>,
    before: Option<i64>,
    limit: Option<u32>,
) -> Result<serde_json::Value, String> {
    json(history_args(&vault, q.as_deref(), tool.as_deref(), project.as_deref(), before, limit)).await
}

#[tauri::command]
pub async fn mirror_refresh(vault: String, model: Option<String>) -> Result<serde_json::Value, String> {
    let mut args: Vec<String> = vec!["mirror".into(), "refresh".into(), "--vault".into(), vault];
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
            vec!["mirror", "verdict", "repeated_rules:x", "true", "--item", "i1", "--rule", "Use pnpm", "--vault", "/v"]
        );
        assert_eq!(verdict_args("/v", "f", "later", None, Some(" ")).unwrap(), vec!["mirror", "verdict", "f", "later", "--vault", "/v"]);
        assert!(verdict_args("/v", "f", "rm -rf", None, None).is_err());
    }

    #[test]
    fn history_args_paginate() {
        assert_eq!(
            history_args("/v", Some("tests"), None, Some("acme"), Some(1700), None),
            vec!["mirror", "history", "--vault", "/v", "--q", "tests", "--project", "acme", "--before", "1700", "--limit", "200"]
        );
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
