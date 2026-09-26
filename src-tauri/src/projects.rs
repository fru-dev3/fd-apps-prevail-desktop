// Projects: the user's whole prompt history grouped by what they were
// building, each with a replay brief a future model can rebuild it from. The
// engine owns all of it (`prevail projects ...`, prompt-projects.ts); these
// commands are thin bridges so Retrospect can show it and the intent daemon
// can keep it fresh. Engine calls block, so each runs on the blocking pool.

fn engine_blocking_json(args: Vec<String>) -> impl std::future::Future<Output = Result<serde_json::Value, String>> {
    async move {
        tokio::task::spawn_blocking(move || {
            let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
            crate::engine::run_engine_json(&refs)
        })
        .await
        .map_err(|e| format!("projects task failed: {e}"))?
    }
}

/// The projects index (projects, timeline stats, recommendations). An empty
/// shell before the first build.
#[tauri::command]
pub async fn projects_index(vault: String) -> Result<serde_json::Value, String> {
    engine_blocking_json(vec!["projects".into(), "list".into(), "--vault".into(), vault]).await
}

/// Build or refresh the projects. Incremental: only projects with new prompts
/// get a new brief. `rebrief` rewrites every brief (a new model shipped),
/// `model` picks it (default: the engine's most capable claude model).
#[tauri::command]
pub async fn projects_build(
    vault: String,
    rebrief: Option<bool>,
    model: Option<String>,
    only: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    engine_blocking_json(build_args(&vault, rebrief.unwrap_or(false), model.as_deref(), only.as_deref())).await
}

pub(crate) fn build_args(vault: &str, rebrief: bool, model: Option<&str>, only: Option<&[String]>) -> Vec<String> {
    let mut args: Vec<String> = vec!["projects".into(), "build".into(), "--vault".into(), vault.to_string()];
    if rebrief {
        args.push("--rebrief".into());
    }
    if let Some(m) = model.filter(|m| !m.trim().is_empty()) {
        args.push("--model".into());
        args.push(m.trim().to_string());
    }
    if let Some(o) = only.filter(|o| !o.is_empty()) {
        args.push("--only".into());
        args.push(o.join(","));
    }
    args
}

/// The replay prompt for one project: the brief, and with `with_prompts` the
/// full verbatim prompt history appended.
#[tauri::command]
pub async fn projects_replay(vault: String, slug: String, with_prompts: Option<bool>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let mut args: Vec<&str> = vec!["projects", "replay", &slug, "--vault", &vault];
        if with_prompts.unwrap_or(false) {
            args.push("--with-prompts");
        }
        crate::engine::run_engine_raw(&args)
    })
    .await
    .map_err(|e| format!("replay task failed: {e}"))?
}

/// Retrospect's rollup from the engine: the same cleaned, all-harness corpus
/// the projects are built from, bucketed by period with per-project counts.
pub(crate) fn timeline(vault: &str, vantage: &str, tz_offset_minutes: i64) -> Result<serde_json::Value, String> {
    let tz = tz_offset_minutes.to_string();
    crate::engine::run_engine_json(&["projects", "timeline", "--vault", vault, "--vantage", vantage, "--tz", &tz])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_args_carry_only_what_was_asked() {
        assert_eq!(build_args("/v", false, None, None), vec!["projects", "build", "--vault", "/v"]);
        assert_eq!(
            build_args("/v", true, Some(" claude-fable-5-1 "), Some(&["a".to_string(), "b".to_string()])),
            vec!["projects", "build", "--vault", "/v", "--rebrief", "--model", "claude-fable-5-1", "--only", "a,b"]
        );
        assert_eq!(build_args("/v", false, Some("  "), Some(&[])), vec!["projects", "build", "--vault", "/v"]);
    }
}
