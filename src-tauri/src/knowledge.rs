// Knowledge sources: what Prevail reads when it briefs and updates the owner
// (an MCP server, a site or feed, a folder on this Mac, a database). The
// engine owns the model, the probes and every read-only limit
// (`prevail sources add|list|check|remove|use`); these are thin bridges that
// only keep a value from posing as a flag. A password or token never passes
// through here: the page stores it with app_secret_set (Keychain) and the
// engine reads it from there.

use serde_json::Value;

async fn engine_json(args: Vec<String>) -> Result<Value, String> {
    let v = tokio::task::spawn_blocking(move || {
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        crate::engine::run_engine_json(&refs)
    })
    .await
    .map_err(|e| format!("sources task failed: {e}"))??;
    if let Some(e) = v.get("error").and_then(|e| e.as_str()) {
        return Err(e.to_string());
    }
    Ok(v)
}

const KINDS: &[&str] = &["mcp", "web", "folder", "database"];

fn no_flag(label: &str, v: &str) -> Result<String, String> {
    let v = v.trim();
    if v.starts_with('-') || v.contains('\0') { return Err(format!("not a valid {label}: {v}")); }
    Ok(v.to_string())
}

fn slug_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 80 && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') && !s.starts_with('-')
}

fn list_flag(flag: &str, v: Option<Vec<String>>, args: &mut Vec<String>) -> Result<(), String> {
    if let Some(items) = v {
        let mut clean: Vec<String> = Vec::new();
        for i in items.iter().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            if !slug_ok(i) { return Err(format!("not a valid name: {i}")); }
            if !clean.iter().any(|x| x == i) { clean.push(i.to_string()); }
        }
        args.push(flag.into());
        args.push(if clean.is_empty() { "none".into() } else { clean.join(",") });
    }
    Ok(())
}

fn on_off(flag: &str, v: Option<bool>, args: &mut Vec<String>) {
    if let Some(b) = v {
        args.push(flag.into());
        args.push(if b { "on" } else { "off" }.into());
    }
}

fn base(vault: &str, sub: &str) -> Vec<String> {
    vec!["--vault".into(), vault.into(), "sources".into(), sub.into()]
}

fn check_id(id: &str) -> Result<String, String> {
    if crate::appscope::valid_app_id(id) { Ok(id.to_string()) } else { Err(format!("not a source id: {id}")) }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn add_args(vault: &str, text: Option<String>, kind: Option<String>, location: Option<String>, name: Option<String>, briefings: Option<bool>, general: Option<bool>, domains: Option<Vec<String>>, projects: Option<Vec<String>>) -> Result<Vec<String>, String> {
    let mut args = base(vault, "add");
    let text = text.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    let location = location.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    if text.is_none() && location.is_none() { return Err("paste a link, a folder path or a database location".into()); }
    if let Some(t) = text {
        if t.len() > 2000 { return Err("that is too long; paste the link or path".into()); }
        args.push(no_flag("description", &t)?);
    }
    if let Some(k) = kind.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
        if !KINDS.contains(&k.as_str()) { return Err(format!("unknown source kind: {k}")); }
        args.push("--kind".into());
        args.push(k);
    }
    if let Some(l) = location { args.push("--location".into()); args.push(no_flag("location", &l)?); }
    if let Some(n) = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()) { args.push("--name".into()); args.push(no_flag("name", &n)?); }
    on_off("--briefings", briefings, &mut args);
    on_off("--general", general, &mut args);
    list_flag("--domains", domains, &mut args)?;
    list_flag("--projects", projects, &mut args)?;
    args.push("--json".into());
    Ok(args)
}

pub(crate) fn use_args(vault: &str, id: &str, briefings: Option<bool>, general: Option<bool>, domains: Option<Vec<String>>, projects: Option<Vec<String>>) -> Result<Vec<String>, String> {
    let mut args = base(vault, "use");
    args.push(check_id(id)?);
    on_off("--briefings", briefings, &mut args);
    on_off("--general", general, &mut args);
    list_flag("--domains", domains, &mut args)?;
    list_flag("--projects", projects, &mut args)?;
    args.push("--json".into());
    Ok(args)
}

/// Every knowledge source: [{ id, name, kind, location, scope, status, found, ... }].
#[tauri::command]
pub async fn engine_knowledge_sources(vault: String) -> Result<Value, String> {
    let mut a = base(&vault, "list");
    a.push("--json".into());
    engine_json(a).await
}

/// Add (or check again) a source from a pasted link, path or sentence.
/// -> { source, probe, adopted, found, detected? }
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn engine_knowledge_add(vault: String, text: Option<String>, kind: Option<String>, location: Option<String>, name: Option<String>, briefings: Option<bool>, general: Option<bool>, domains: Option<Vec<String>>, projects: Option<Vec<String>>) -> Result<Value, String> {
    engine_json(add_args(&vault, text, kind, location, name, briefings, general, domains, projects)?).await
}

/// Look at a source again (and trust it on this Mac when it came from another).
#[tauri::command]
pub async fn engine_knowledge_check(vault: String, id: String) -> Result<Value, String> {
    let mut a = base(&vault, "check");
    a.push(check_id(&id)?);
    a.push("--json".into());
    engine_json(a).await
}

/// Change what a source is used for.
#[tauri::command]
pub async fn engine_knowledge_use(vault: String, id: String, briefings: Option<bool>, general: Option<bool>, domains: Option<Vec<String>>, projects: Option<Vec<String>>) -> Result<Value, String> {
    engine_json(use_args(&vault, &id, briefings, general, domains, projects)?).await
}

/// Archive a source (its folder moves to data/apps/_archive; never deleted).
#[tauri::command]
pub async fn engine_knowledge_remove(vault: String, id: String) -> Result<Value, String> {
    let mut a = base(&vault, "remove");
    a.push(check_id(&id)?);
    a.push("--json".into());
    engine_json(a).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_args_shape_and_refusals() {
        let a = add_args("/v", Some("https://foo.example.com/ for wealth".into()), None, None, None, None, None, None, None).unwrap();
        assert_eq!(a, ["--vault", "/v", "sources", "add", "https://foo.example.com/ for wealth", "--json"]);
        let f = add_args("/v", None, Some("folder".into()), Some("/tmp/foo".into()), Some("Foo".into()), Some(false), Some(true), Some(vec!["wealth".into(), "wealth".into()]), Some(vec![])).unwrap();
        assert_eq!(f, ["--vault", "/v", "sources", "add", "--kind", "folder", "--location", "/tmp/foo", "--name", "Foo", "--briefings", "off", "--general", "on", "--domains", "wealth", "--projects", "none", "--json"]);
        assert!(add_args("/v", None, None, None, None, None, None, None, None).is_err());
        assert!(add_args("/v", Some("--rm".into()), None, None, None, None, None, None, None).is_err());
        assert!(add_args("/v", None, Some("turso".into()), Some("/x".into()), None, None, None, None, None).is_err());
        assert!(add_args("/v", None, None, Some("-x".into()), None, None, None, None, None).is_err());
        assert!(add_args("/v", Some("x".into()), None, None, None, None, None, Some(vec!["Bad Name".into()]), None).is_err());
    }

    #[test]
    fn use_args_shape() {
        let a = use_args("/v", "foo-db", Some(true), None, Some(vec!["wealth".into(), "tax".into()]), None).unwrap();
        assert_eq!(a, ["--vault", "/v", "sources", "use", "foo-db", "--briefings", "on", "--domains", "wealth,tax", "--json"]);
        assert!(use_args("/v", "--x", None, None, None, None).is_err());
        assert!(use_args("/v", "Foo", None, None, None, None).is_err());
    }
}
