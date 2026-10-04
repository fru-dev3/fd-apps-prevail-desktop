// Apps as chat scopes, and trusted sources. The engine owns the data
// (`prevail apps access-log`, `apps threads`, `apps remove-source`); these are
// thin bridges. Sources are added and checked as knowledge sources
// (knowledge.rs, `prevail sources`).

use serde_json::{json, Value};

async fn engine_json(args: Vec<String>) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        crate::engine::run_engine_json(&refs)
    })
    .await
    .map_err(|e| format!("apps task failed: {e}"))?
}

// An app id as the engine accepts it: ^[a-z0-9][a-z0-9-]{0,80}$.
pub(crate) fn valid_app_id(id: &str) -> bool {
    crate::threads::clean_app(Some(id)).as_deref() == Some(id)
}

fn check_app(id: &str) -> Result<(), String> {
    if valid_app_id(id) { Ok(()) } else { Err(format!("not an app id: {id}")) }
}

fn push_opt(args: &mut Vec<String>, flag: &str, v: Option<String>) {
    if let Some(v) = v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty() && !s.starts_with('-')) {
        args.push(flag.into());
        args.push(v);
    }
}

pub(crate) fn access_log_args(vault: &str, app: Option<String>, domain: Option<String>, entity: Option<String>, thread: Option<String>, limit: Option<u32>) -> Result<Vec<String>, String> {
    if let Some(a) = app.as_deref().filter(|s| !s.is_empty()) { check_app(a)?; }
    if let Some(e) = entity.as_deref().filter(|s| !s.is_empty()) {
        if !crate::entities_bridge::valid_id(e) { return Err(format!("not an entity id: {e}")); }
    }
    let mut args: Vec<String> = vec!["apps".into(), "access-log".into()];
    push_opt(&mut args, "--app", app);
    push_opt(&mut args, "--domain", domain);
    push_opt(&mut args, "--entity", entity);
    push_opt(&mut args, "--thread", thread);
    if let Some(n) = limit.filter(|n| *n > 0) {
        args.push("--limit".into());
        args.push(n.min(1000).to_string());
    }
    args.extend(["--vault".into(), vault.to_string(), "--json".into()]);
    Ok(args)
}

// The access log, newest first: every MCP call an app saw through Claude,
// reads included, redacted by the engine.
#[tauri::command]
pub async fn engine_apps_access_log(vault: String, app: Option<String>, domain: Option<String>, entity: Option<String>, thread: Option<String>, limit: Option<u32>) -> Result<Value, String> {
    engine_json(access_log_args(&vault, app, domain, entity, thread, limit)?).await
}

// An app's own conversations, newest first: [{ slug, title, updated, turns }].
#[tauri::command]
pub async fn engine_apps_threads(vault: String, id: String) -> Result<Value, String> {
    check_app(&id)?;
    engine_json(vec!["apps".into(), "threads".into(), id, "--vault".into(), vault, "--json".into()]).await
}

// A Google app's accounts: [{ id, label?, default, via: "gws" | "claude" }].
// The emails stay on this Mac; the engine never logs them.
pub(crate) fn accounts_args(vault: &str, id: &str) -> Result<Vec<String>, String> {
    check_app(id)?;
    Ok(vec!["apps".into(), "accounts".into(), id.into(), "--vault".into(), vault.into(), "--json".into()])
}

#[tauri::command]
pub async fn engine_apps_accounts(vault: String, id: String) -> Result<Value, String> {
    engine_json(accounts_args(&vault, &id)?).await
}

// The kinds a trusted source folder may carry (knowledge sources); they are
// added through `sources add` (knowledge.rs), never here.
const SOURCE_KINDS: &[&str] = &["mcp-remote", "web", "links", "folder", "database"];

// Archive a trusted source: its folder moves to data/apps/_archive, never
// deleted. -> { ok, archived: { id, from, to } }.
#[tauri::command]
pub async fn engine_apps_remove_source(vault: String, id: String) -> Result<Value, String> {
    check_app(&id)?;
    let v = engine_json(vec!["apps".into(), "remove-source".into(), id, "--vault".into(), vault, "--json".into()]).await?;
    if let Some(e) = v.get("error").and_then(|e| e.as_str()) { return Err(e.to_string()); }
    Ok(v)
}

// Trusted sources whose folder synced in from another Mac but that this Mac
// has not trusted yet: the manifest says trusted, the per-machine allowlist
// (build/_meta/apps/trusted.json, never synced) does not list it. `apps list`
// leaves these out, so they are found here. Reads only.
pub(crate) fn untrusted_sources(vault: &str) -> Vec<Value> {
    let allow: serde_json::Map<String, Value> = std::fs::read_to_string(std::path::Path::new(vault).join("build/_meta/apps/trusted.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    let Ok(rd) = std::fs::read_dir(crate::paths::data_root(vault).join("apps")) else { return Vec::new() };
    let mut out: Vec<Value> = Vec::new();
    for e in rd.flatten() {
        let id = e.file_name().to_string_lossy().to_string();
        if !valid_app_id(&id) || allow.contains_key(&id) { continue; }
        let Some(m) = std::fs::read_to_string(e.path().join("manifest.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else { continue };
        let kind = m.get("integration").and_then(|k| k.as_str()).unwrap_or("");
        if m.get("trusted").and_then(|t| t.as_bool()) != Some(true) || !SOURCE_KINDS.contains(&kind) { continue; }
        let urls: Vec<String> = m.get("urls").and_then(|u| u.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
        let name = m.get("name").and_then(|n| n.as_str()).filter(|n| !n.trim().is_empty()).unwrap_or(&id).to_string();
        out.push(json!({ "id": id, "name": name, "integration": kind, "urls": urls }));
    }
    out.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    out
}

#[tauri::command]
pub async fn apps_untrusted_sources(vault: String) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || Value::Array(untrusted_sources(&vault))).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_ids_match_the_engine_rule() {
        assert!(valid_app_id("gmail"));
        assert!(valid_app_id("foo-2"));
        for bad in ["", "-x", "Foo", "a/b", "a b", "claude:foo", "_app-x"] {
            assert!(!valid_app_id(bad), "{bad}");
        }
    }

    #[test]
    fn access_log_args_filter_and_refuse_flags() {
        let a = access_log_args("/v", Some("gmail".into()), None, Some("person/foo".into()), Some("t1".into()), Some(50)).unwrap();
        assert_eq!(a, ["apps", "access-log", "--app", "gmail", "--entity", "person/foo", "--thread", "t1", "--limit", "50", "--vault", "/v", "--json"]);
        assert!(access_log_args("/v", Some("--x".into()), None, None, None, None).is_err());
        let d = access_log_args("/v", None, Some("--rm".into()), None, None, None).unwrap();
        assert!(!d.contains(&"--rm".to_string()), "a flag-shaped value is dropped");
    }

    #[test]
    fn accounts_args_shape() {
        assert_eq!(accounts_args("/v", "gmail").unwrap(), ["apps", "accounts", "gmail", "--vault", "/v", "--json"]);
        assert!(accounts_args("/v", "--x").is_err());
    }

    #[test]
    fn chat_refs_become_flags() {
        let a = crate::engine::chat_ref_args(
            Some("person/foo".into()),
            Some(vec!["gmail".into(), "gmail".into()]),
            Some(vec!["person/foo".into(), "org/bar".into()]),
            Some(vec!["Health".into()]),
            Some("foo-mail".into()),
        ).unwrap();
        assert_eq!(a, ["--scope-app", "foo-mail", "--app", "gmail", "--entity", "person/foo", "--entity", "org/bar", "--ref-domain", "health"]);
        assert!(crate::engine::chat_ref_args(None, Some(vec!["--x".into()]), None, None, None).is_err());
        assert!(crate::engine::chat_ref_args(None, None, Some(vec!["nope".into()]), None, None).is_err());
        assert!(crate::engine::chat_ref_args(None, None, None, Some(vec!["../x".into()]), None).is_err());
        assert!(crate::engine::chat_ref_args(None, None, None, None, Some("Bad".into())).is_err());
    }

    #[test]
    fn untrusted_sources_are_the_synced_ones_this_mac_lacks() {
        let v = std::env::temp_dir().join(format!("prevail-untrusted-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&v);
        let apps = v.join("data/apps");
        for (id, man) in [
            ("foo-src", r#"{"name":"Foo","integration":"mcp-remote","urls":["https://foo.example/mcp"],"trusted":true}"#),
            ("bar-src", r#"{"name":"Bar","integration":"web","urls":["https://bar.example"],"trusted":true}"#),
            ("baz", r#"{"name":"Baz","integration":"manual"}"#),
        ] {
            std::fs::create_dir_all(apps.join(id)).unwrap();
            std::fs::write(apps.join(id).join("manifest.json"), man).unwrap();
        }
        std::fs::create_dir_all(v.join("build/_meta/apps")).unwrap();
        std::fs::write(v.join("build/_meta/apps/trusted.json"), r#"{"bar-src":{"integration":"web"}}"#).unwrap();
        let got = untrusted_sources(&v.to_string_lossy());
        assert_eq!(got.len(), 1);
        assert_eq!(got[0]["id"], "foo-src");
        assert_eq!(got[0]["urls"][0], "https://foo.example/mcp");
        let _ = std::fs::remove_dir_all(&v);
    }
}
