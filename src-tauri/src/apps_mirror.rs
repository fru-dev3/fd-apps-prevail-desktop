// Apps mirror: the MCP connectors the user already signed into in their AI
// runtimes (Claude connectors, Codex, Gemini CLI, Antigravity), listed live by
// the engine (`prevail apps ...`). Prevail does not hold these credentials; it
// mirrors what each runtime has and runs a per-app sync recipe through that
// runtime to feed life domains.
//
// Every command here is a thin, blocking engine call moved off the UI thread.
// The argument lists are built by pure functions so they can be unit tested
// without spawning the engine. `run_engine_json` appends `--json` itself.

use crate::engine::run_engine_json;

/// An app id is passed as a positional argument. Refuse anything that could be
/// read as a flag or carries whitespace/control characters.
fn valid_id(id: &str) -> Result<&str, String> {
    let id = id.trim();
    if id.is_empty() {
        return Err("app id is required".into());
    }
    if id.starts_with('-') || id.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(format!("invalid app id: {id}"));
    }
    Ok(id)
}

fn valid_schedule(s: &str) -> Result<&str, String> {
    match s {
        "daily" | "weekly" | "manual" => Ok(s),
        other => Err(format!("invalid schedule: {other}")),
    }
}

/// Join a list for a comma-separated flag, dropping blanks and stray commas.
fn csv(items: &[String]) -> String {
    items
        .iter()
        .map(|s| s.trim().replace(',', ""))
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(",")
}

pub(crate) fn list_args(vault: &str) -> Vec<String> {
    vec!["apps".into(), "list".into(), "--vault".into(), vault.into()]
}

pub(crate) fn refresh_args(vault: &str, tools: bool) -> Vec<String> {
    let mut a: Vec<String> = vec!["apps".into(), "refresh".into()];
    if tools {
        a.push("--tools".into());
    }
    a.push("--vault".into());
    a.push(vault.into());
    a
}

pub(crate) fn tools_args(vault: &str, id: &str) -> Result<Vec<String>, String> {
    let id = valid_id(id)?;
    Ok(vec!["apps".into(), "tools".into(), id.into(), "--vault".into(), vault.into()])
}

pub(crate) fn recipe_draft_args(vault: &str, id: &str, model: Option<&str>) -> Result<Vec<String>, String> {
    let id = valid_id(id)?;
    let mut a: Vec<String> = vec!["apps".into(), "recipe".into(), "draft".into(), id.into()];
    if let Some(m) = model.map(str::trim).filter(|m| !m.is_empty()) {
        a.push("--model".into());
        a.push(m.into());
    }
    a.push("--vault".into());
    a.push(vault.into());
    Ok(a)
}

pub(crate) fn recipe_save_args(
    vault: &str,
    id: &str,
    prompt: &str,
    domains: &[String],
    schedule: &str,
    read_tools: &[String],
) -> Result<Vec<String>, String> {
    let id = valid_id(id)?;
    let schedule = valid_schedule(schedule)?;
    // The engine reads a flag's value as the next argument, so a prompt that
    // starts with "-" still lands as the value, never as a flag of its own.
    Ok(vec![
        "apps".into(),
        "recipe".into(),
        "save".into(),
        id.into(),
        "--prompt".into(),
        prompt.into(),
        "--domains".into(),
        csv(domains),
        "--schedule".into(),
        schedule.into(),
        "--read-tools".into(),
        csv(read_tools),
        "--vault".into(),
        vault.into(),
    ])
}

pub(crate) fn sync_args(vault: &str, id: &str) -> Result<Vec<String>, String> {
    let id = valid_id(id)?;
    Ok(vec!["apps".into(), "sync".into(), id.into(), "--vault".into(), vault.into()])
}

pub(crate) fn archive_args(vault: &str, apply: bool) -> Vec<String> {
    vec![
        "apps".into(),
        "archive".into(),
        if apply { "--apply".into() } else { "--dry-run".into() },
        "--vault".into(),
        vault.into(),
    ]
}

fn need_vault(vault: &str) -> Result<(), String> {
    if vault.trim().is_empty() {
        Err("no vault selected".into())
    } else {
        Ok(())
    }
}

async fn run(args: Vec<String>) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        run_engine_json(&refs)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Cached mirror of every runtime's connectors. Read only.
#[tauri::command]
pub async fn apps_mirror_list(vault: String) -> Result<serde_json::Value, String> {
    need_vault(&vault)?;
    run(list_args(&vault)).await
}

/// Re-read every runtime's connector list (and optionally each app's tools).
#[tauri::command]
pub async fn apps_mirror_refresh(vault: String, tools: Option<bool>) -> Result<serde_json::Value, String> {
    need_vault(&vault)?;
    run(refresh_args(&vault, tools.unwrap_or(false))).await
}

/// One app's tool list, classified read / write / send / money.
#[tauri::command]
pub async fn apps_mirror_tools(vault: String, id: String) -> Result<serde_json::Value, String> {
    need_vault(&vault)?;
    run(tools_args(&vault, &id)?).await
}

/// Ask a model to draft a sync recipe for one app.
#[tauri::command]
pub async fn apps_mirror_recipe_draft(vault: String, id: String, model: Option<String>) -> Result<serde_json::Value, String> {
    need_vault(&vault)?;
    run(recipe_draft_args(&vault, &id, model.as_deref())?).await
}

/// Save one app's sync recipe.
#[tauri::command]
pub async fn apps_mirror_recipe_save(
    vault: String,
    id: String,
    prompt: String,
    domains: Vec<String>,
    schedule: String,
    read_tools: Vec<String>,
) -> Result<serde_json::Value, String> {
    need_vault(&vault)?;
    run(recipe_save_args(&vault, &id, &prompt, &domains, &schedule, &read_tools)?).await
}

/// Run one app's recipe now.
#[tauri::command]
pub async fn apps_mirror_sync(vault: String, id: String) -> Result<serde_json::Value, String> {
    need_vault(&vault)?;
    run(sync_args(&vault, &id)?).await
}

/// List (dry run) or move (apply) vault app folders nothing uses any more.
#[tauri::command]
pub async fn apps_mirror_archive(vault: String, apply: bool) -> Result<serde_json::Value, String> {
    need_vault(&vault)?;
    run(archive_args(&vault, apply)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn list_and_refresh_pass_the_vault() {
        assert_eq!(list_args("/v"), s(&["apps", "list", "--vault", "/v"]));
        assert_eq!(refresh_args("/v", false), s(&["apps", "refresh", "--vault", "/v"]));
        assert_eq!(refresh_args("/v", true), s(&["apps", "refresh", "--tools", "--vault", "/v"]));
    }

    #[test]
    fn ids_that_look_like_flags_are_refused() {
        assert!(tools_args("/v", "--apply").is_err());
        assert!(sync_args("/v", "").is_err());
        assert!(sync_args("/v", "foo bar").is_err());
        assert_eq!(sync_args("/v", " acme-notes ").unwrap(), s(&["apps", "sync", "acme-notes", "--vault", "/v"]));
    }

    #[test]
    fn draft_adds_model_only_when_given() {
        assert_eq!(
            recipe_draft_args("/v", "bar-mail", None).unwrap(),
            s(&["apps", "recipe", "draft", "bar-mail", "--vault", "/v"])
        );
        assert_eq!(
            recipe_draft_args("/v", "bar-mail", Some("  ")).unwrap(),
            s(&["apps", "recipe", "draft", "bar-mail", "--vault", "/v"])
        );
        assert_eq!(
            recipe_draft_args("/v", "bar-mail", Some("fast")).unwrap(),
            s(&["apps", "recipe", "draft", "bar-mail", "--model", "fast", "--vault", "/v"])
        );
    }

    #[test]
    fn save_joins_lists_and_guards_the_prompt() {
        let a = recipe_save_args(
            "/v",
            "foo-rides",
            "-list trips from last week",
            &s(&["travel", " money ", ""]),
            "weekly",
            &s(&["list_trips", "get,trip"]),
        )
        .unwrap();
        assert_eq!(
            a,
            s(&[
                "apps",
                "recipe",
                "save",
                "foo-rides",
                "--prompt",
                "-list trips from last week",
                "--domains",
                "travel,money",
                "--schedule",
                "weekly",
                "--read-tools",
                "list_trips,gettrip",
                "--vault",
                "/v",
            ])
        );
        assert!(recipe_save_args("/v", "foo-rides", "p", &[], "hourly", &[]).is_err());
    }

    #[test]
    fn archive_is_dry_run_unless_applied() {
        assert_eq!(archive_args("/v", false)[2], "--dry-run");
        assert_eq!(archive_args("/v", true)[2], "--apply");
    }

    #[test]
    fn a_blank_vault_is_refused() {
        assert!(need_vault(" ").is_err());
        assert!(need_vault("/v").is_ok());
    }
}
