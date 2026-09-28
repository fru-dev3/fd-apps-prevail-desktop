// Linking: where a conversation's knowledge lands besides its own domain.
// The engine owns all of it (`prevail updates`, `entities set-relation`,
// `config set autosave`); these commands are thin, argument-checked bridges.
use crate::entities_bridge::{json, valid_id, write_json};

// A domain slug as the engine names its folders. Anything else never reaches
// the engine, so a crafted value cannot pose as a flag.
fn valid_slug(s: &str) -> bool {
    !s.is_empty() && s.len() <= 120 && !s.starts_with('-') && s.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.') && !s.contains("..")
}

pub(crate) fn updates_args(vault: &str, domain: Option<&str>, entity: Option<&str>, since: Option<&str>, limit: Option<u32>) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = vec!["updates".into()];
    if let Some(d) = domain.map(str::trim).filter(|d| !d.is_empty()) {
        if !valid_slug(d) {
            return Err(format!("not a domain: {d}"));
        }
        args.push("--domain".into());
        args.push(d.into());
    }
    if let Some(e) = entity.map(str::trim).filter(|e| !e.is_empty()) {
        if !valid_id(e) {
            return Err(format!("not an entity id: {e}"));
        }
        args.push("--entity".into());
        args.push(e.into());
    }
    if let Some(s) = since.map(str::trim).filter(|s| !s.is_empty()) {
        if s.starts_with('-') || s.len() > 40 {
            return Err(format!("not a date: {s}"));
        }
        args.push("--since".into());
        args.push(s.into());
    }
    args.push("--limit".into());
    args.push(limit.unwrap_or(50).clamp(1, 500).to_string());
    args.push("--vault".into());
    args.push(vault.into());
    Ok(args)
}

// What other conversations noted for a domain or an entity, newest first:
// `prevail updates [--domain d] [--entity id] [--since ISO] [--limit N] --vault V --json`
// -> [{ ts, from_domain, thread, fact, entities?, target }]. A read.
#[tauri::command]
pub async fn engine_updates(vault: String, domain: Option<String>, entity: Option<String>, since: Option<String>, limit: Option<u32>) -> Result<serde_json::Value, String> {
    json(updates_args(&vault, domain.as_deref(), entity.as_deref(), since.as_deref(), limit)?).await
}

pub(crate) fn relation_args(vault: &str, id: &str, relation: &str) -> Result<Vec<String>, String> {
    if !matches!(relation, "yours" | "reference") {
        return Err(format!("not a relation: {relation}"));
    }
    let mut args = crate::entities_bridge::id_args("set-relation", vault, id)?;
    args.insert(3, relation.into());
    Ok(args)
}

// "This is mine" / "Just a reference". Writes data/entities/relations.json:
// `prevail entities set-relation <id> yours|reference --vault V --json` -> { ok }.
#[tauri::command]
pub async fn engine_entities_set_relation(vault: String, id: String, relation: String) -> Result<serde_json::Value, String> {
    write_json(relation_args(&vault, &id, relation.trim())?).await
}

const AUTOSAVE: &[&str] = &["off", "yours", "all"];

// Which entities get a page as you chat. Engine config (~/.prevail/config.json,
// field `autosave`); "yours" when unset.
#[tauri::command]
pub async fn engine_config_autosave_get() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let home = std::env::var("HOME").map_err(|_| "no HOME".to_string())?;
        let raw = std::fs::read_to_string(std::path::Path::new(&home).join(".prevail").join("config.json")).unwrap_or_default();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();
        Ok(v.get("autosave").and_then(|x| x.as_str()).filter(|x| AUTOSAVE.contains(x)).unwrap_or("yours").to_string())
    })
    .await
    .map_err(|e| format!("config task failed: {e}"))?
}

// `prevail config set autosave off|yours|all`. A write, desktop only.
#[tauri::command]
pub async fn engine_config_autosave_set(value: String) -> Result<String, String> {
    let v = value.trim().to_string();
    if !AUTOSAVE.contains(&v.as_str()) {
        return Err(format!("not an autosave mode: {v}"));
    }
    tokio::task::spawn_blocking(move || crate::engine::run_engine_raw(&["config", "set", "autosave", v.as_str()]).map(|_| v))
        .await
        .map_err(|e| format!("config task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updates_args_carry_the_target_and_reject_crafted_values() {
        assert_eq!(
            updates_args("/v", Some("insurance"), None, None, None).unwrap(),
            vec!["updates", "--domain", "insurance", "--limit", "50", "--vault", "/v"]
        );
        assert_eq!(
            updates_args("/v", None, Some("place/foo-way"), Some("2026-09-01"), Some(9)).unwrap(),
            vec!["updates", "--entity", "place/foo-way", "--since", "2026-09-01", "--limit", "9", "--vault", "/v"]
        );
        assert!(updates_args("/v", Some("--vault"), None, None, None).is_err());
        assert!(updates_args("/v", Some("../x"), None, None, None).is_err());
        assert!(updates_args("/v", None, Some("--vault"), None, None).is_err());
        assert!(updates_args("/v", None, None, Some("-x"), None).is_err());
    }

    #[test]
    fn relation_args_take_only_the_two_relations() {
        assert_eq!(
            relation_args("/v", "person/foo", "yours").unwrap(),
            vec!["entities", "set-relation", "person/foo", "yours", "--vault", "/v"]
        );
        assert!(relation_args("/v", "person/foo", "mine").is_err());
        assert!(relation_args("/v", "--vault", "reference").is_err());
    }
}
