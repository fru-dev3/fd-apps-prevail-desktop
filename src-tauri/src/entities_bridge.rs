// Entities: the people, places, companies/products and things the owner talks
// about. The engine owns all of it (`prevail entities ...`, entities.ts); these
// commands are thin bridges. Engine calls block, so each runs on the blocking
// pool.

async fn json(args: Vec<String>) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        crate::engine::run_engine_json(&refs)
    })
    .await
    .map_err(|e| format!("entities task failed: {e}"))?
}

async fn json_stdin(args: Vec<String>, body: String) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        crate::engine::run_engine_json_stdin(&refs, &body)
    })
    .await
    .map_err(|e| format!("entities task failed: {e}"))?
}

fn opt(args: &mut Vec<String>, flag: &str, v: Option<&str>) {
    if let Some(v) = v.map(str::trim).filter(|v| !v.is_empty()) {
        args.push(flag.into());
        args.push(v.to_string());
    }
}

const KINDS: &[&str] = &["person", "place", "org", "thing"];

// An entity id is <kind>/<name or slug>. Anything else never reaches the
// engine, so a crafted id cannot smuggle a flag into the argument list.
pub(crate) fn valid_id(id: &str) -> bool {
    let id = id.trim();
    match id.split_once('/') {
        Some((kind, rest)) => KINDS.contains(&kind) && !rest.trim().is_empty() && !rest.starts_with('-') && id.len() <= 300,
        None => false,
    }
}

fn check_kind(kind: Option<&str>) -> Result<(), String> {
    match kind.map(str::trim).filter(|k| !k.is_empty()) {
        Some(k) if !KINDS.contains(&k) => Err(format!("unknown entity kind: {k}")),
        _ => Ok(()),
    }
}

pub(crate) fn list_args(vault: &str, q: Option<&str>, kind: Option<&str>, saved: bool, limit: Option<u32>) -> Result<Vec<String>, String> {
    check_kind(kind)?;
    let mut args: Vec<String> = vec!["entities".into(), "list".into(), "--vault".into(), vault.into()];
    opt(&mut args, "--q", q);
    opt(&mut args, "--kind", kind);
    if saved {
        args.push("--saved".into());
    }
    args.push("--limit".into());
    args.push(limit.unwrap_or(2000).clamp(1, 5000).to_string());
    Ok(args)
}

pub(crate) fn id_args(sub: &str, vault: &str, id: &str) -> Result<Vec<String>, String> {
    if !valid_id(id) {
        return Err(format!("not an entity id: {id}"));
    }
    Ok(vec!["entities".into(), sub.into(), id.trim().into(), "--vault".into(), vault.into()])
}

#[tauri::command]
pub async fn entities_list(
    vault: String,
    q: Option<String>,
    kind: Option<String>,
    saved: Option<bool>,
    limit: Option<u32>,
) -> Result<serde_json::Value, String> {
    json(list_args(&vault, q.as_deref(), kind.as_deref(), saved.unwrap_or(false), limit)?).await
}

#[tauri::command]
pub async fn entities_show(vault: String, id: String) -> Result<serde_json::Value, String> {
    json(id_args("show", &vault, &id)?).await
}

#[tauri::command]
pub async fn entities_save(vault: String, id: String, name: Option<String>) -> Result<serde_json::Value, String> {
    let mut args = id_args("save", &vault, &id)?;
    opt(&mut args, "--name", name.as_deref());
    json(args).await
}

#[tauri::command]
pub async fn entities_note(vault: String, id: String, text: String, name: Option<String>) -> Result<serde_json::Value, String> {
    let mut args = id_args("note", &vault, &id)?;
    args.push("--text".into());
    args.push("-".into());
    opt(&mut args, "--name", name.as_deref());
    json_stdin(args, text).await
}

#[tauri::command]
pub async fn entities_refresh(vault: String) -> Result<serde_json::Value, String> {
    json(vec!["entities".into(), "refresh".into(), "--vault".into(), vault]).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_must_name_a_kind() {
        assert!(valid_id("person/Sam Rivera"));
        assert!(valid_id("org/acme"));
        assert!(!valid_id("sam"));
        assert!(!valid_id("planet/mars"));
        assert!(!valid_id("person/--vault"));
        assert!(!valid_id("person/"));
    }

    #[test]
    fn builds_engine_args() {
        assert_eq!(
            list_args("/v", Some("sam"), Some("person"), true, None).unwrap(),
            vec!["entities", "list", "--vault", "/v", "--q", "sam", "--kind", "person", "--saved", "--limit", "2000"]
        );
        assert!(list_args("/v", None, Some("planet"), false, None).is_err());
        assert_eq!(id_args("show", "/v", "place/Maple St").unwrap(), vec!["entities", "show", "place/Maple St", "--vault", "/v"]);
        assert!(id_args("save", "/v", "--vault").is_err());
    }
}
