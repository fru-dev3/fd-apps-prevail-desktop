// Projects and structure suggestions. The engine owns both (`prevail projects
// create|set`, `prevail suggest structure|accept|dismiss`); these commands are
// thin, argument-checked bridges. Projects are listed through `entities_list`
// with kind "project", like any entity. Every write here is desktop only.
use crate::entities_bridge::{json, valid_id, write_json};

fn valid_slug(s: &str) -> bool {
    !s.is_empty() && s.len() <= 120 && !s.starts_with('-') && s.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.') && !s.contains("..")
}

// A free-text value (a name, an outcome) as one argument: never a flag, never
// more than a line.
fn text(flag: &str, v: &str) -> Result<Option<String>, String> {
    let v = v.trim();
    if v.is_empty() {
        return Ok(None);
    }
    if v.starts_with('-') || v.len() > 400 || v.contains('\n') {
        return Err(format!("not a valid {flag}: {v}"));
    }
    Ok(Some(v.to_string()))
}

fn date(v: &str) -> Result<String, String> {
    let v = v.trim();
    let ok = v.is_empty() || (v.len() == 10 && v.chars().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() }));
    if ok { Ok(v.to_string()) } else { Err(format!("not a date: {v}")) }
}

const STATUSES: &[&str] = &["active", "paused", "done", "archived"];

pub(crate) fn create_args(vault: &str, name: &str, outcome: Option<&str>, target: Option<&str>, domains: &[String], from_intent: Option<&str>) -> Result<Vec<String>, String> {
    let name = text("name", name)?.ok_or("a project needs a name")?;
    let mut args: Vec<String> = vec!["projects".into(), "create".into(), "--name".into(), name];
    if let Some(o) = text("outcome", outcome.unwrap_or(""))? {
        args.extend(["--outcome".into(), o]);
    }
    let t = date(target.unwrap_or(""))?;
    if !t.is_empty() {
        args.extend(["--target".into(), t]);
    }
    for d in domains.iter().map(|d| d.trim()).filter(|d| !d.is_empty()) {
        if !valid_slug(d) {
            return Err(format!("not a domain: {d}"));
        }
        args.extend(["--domain".into(), d.into()]);
    }
    if let Some(i) = from_intent.map(str::trim).filter(|i| !i.is_empty()) {
        if !valid_slug(i) {
            return Err(format!("not an Intent project: {i}"));
        }
        args.extend(["--from-intent".into(), i.into()]);
    }
    args.extend(["--vault".into(), vault.into()]);
    Ok(args)
}

// `prevail projects create --name N [--outcome O] [--target D] [--domain d]...
// [--from-intent id] --vault V --json` -> the project.
#[tauri::command]
pub async fn engine_projects_create(vault: String, name: String, outcome: Option<String>, target: Option<String>, domains: Option<Vec<String>>, from_intent: Option<String>) -> Result<serde_json::Value, String> {
    write_json(create_args(&vault, &name, outcome.as_deref(), target.as_deref(), &domains.unwrap_or_default(), from_intent.as_deref())?).await
}

// Only the fields given are sent; an empty target or outcome clears it.
pub(crate) fn set_args(vault: &str, id: &str, status: Option<&str>, outcome: Option<&str>, target: Option<&str>, domains: Option<&[String]>) -> Result<Vec<String>, String> {
    if !valid_id(id) || !id.starts_with("project/") {
        return Err(format!("not a project id: {id}"));
    }
    let mut args: Vec<String> = vec!["projects".into(), "set".into(), id.trim().into()];
    if let Some(s) = status.map(str::trim) {
        if !STATUSES.contains(&s) {
            return Err(format!("not a project status: {s}"));
        }
        args.extend(["--status".into(), s.into()]);
    }
    if let Some(o) = outcome {
        args.extend(["--outcome".into(), text("outcome", o)?.unwrap_or_default()]);
    }
    if let Some(t) = target {
        args.extend(["--target".into(), date(t)?]);
    }
    if let Some(ds) = domains {
        let ds: Vec<&str> = ds.iter().map(|d| d.trim()).filter(|d| !d.is_empty()).collect();
        if let Some(bad) = ds.iter().find(|d| !valid_slug(d)) {
            return Err(format!("not a domain: {bad}"));
        }
        args.extend(["--domains".into(), ds.join(",")]);
    }
    args.extend(["--vault".into(), vault.into()]);
    Ok(args)
}

// `prevail projects set <id> [--status s] [--outcome o] [--target d] [--domains a,b] --vault V --json`
#[tauri::command]
pub async fn engine_projects_set(vault: String, id: String, status: Option<String>, outcome: Option<String>, target: Option<String>, domains: Option<Vec<String>>) -> Result<serde_json::Value, String> {
    write_json(set_args(&vault, &id, status.as_deref(), outcome.as_deref(), target.as_deref(), domains.as_deref())?).await
}

// `prevail suggest structure --vault V --json` -> [{ id, kind, title, reason, evidence, confidence }]. A read.
#[tauri::command]
pub async fn engine_suggest_structure(vault: String) -> Result<serde_json::Value, String> {
    json(vec!["suggest".into(), "structure".into(), "--vault".into(), vault]).await
}

// A suggestion id is the engine's own token; it never poses as a flag.
fn valid_suggestion(id: &str) -> bool {
    !id.is_empty() && id.len() <= 200 && !id.starts_with('-') && id.chars().all(|c| c.is_alphanumeric() || "-_.:/".contains(c))
}

pub(crate) fn decide_args(vault: &str, verb: &str, id: &str, forever: bool) -> Result<Vec<String>, String> {
    let id = id.trim();
    if !valid_suggestion(id) {
        return Err(format!("not a suggestion id: {id}"));
    }
    let mut args: Vec<String> = vec!["suggest".into(), verb.into(), id.into()];
    if forever {
        args.push("--forever".into());
    }
    args.extend(["--vault".into(), vault.into()]);
    Ok(args)
}

// `prevail suggest accept <id> --vault V --json` -> what it did.
#[tauri::command]
pub async fn engine_suggest_accept(vault: String, id: String) -> Result<serde_json::Value, String> {
    write_json(decide_args(&vault, "accept", &id, false)?).await
}

// `prevail suggest dismiss <id> [--forever] --vault V --json`: "Not now" (30 days) or "Never".
#[tauri::command]
pub async fn engine_suggest_dismiss(vault: String, id: String, forever: Option<bool>) -> Result<serde_json::Value, String> {
    write_json(decide_args(&vault, "dismiss", &id, forever.unwrap_or(false))?).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_args_carry_every_field_and_reject_crafted_values() {
        assert_eq!(
            create_args("/v", "Foo Trip", Some("Back home rested"), Some("2026-12-01"), &["travel".into()], Some("foo-trip")).unwrap(),
            vec!["projects", "create", "--name", "Foo Trip", "--outcome", "Back home rested", "--target", "2026-12-01", "--domain", "travel", "--from-intent", "foo-trip", "--vault", "/v"]
        );
        assert_eq!(create_args("/v", "Foo", None, None, &[], None).unwrap(), vec!["projects", "create", "--name", "Foo", "--vault", "/v"]);
        assert!(create_args("/v", "  ", None, None, &[], None).is_err());
        assert!(create_args("/v", "--vault", None, None, &[], None).is_err());
        assert!(create_args("/v", "Foo", None, Some("next week"), &[], None).is_err());
        assert!(create_args("/v", "Foo", None, None, &["../x".into()], None).is_err());
        assert!(create_args("/v", "Foo", None, None, &[], Some("-x")).is_err());
    }

    #[test]
    fn set_args_send_only_what_changed() {
        assert_eq!(set_args("/v", "project/foo", Some("paused"), None, None, None).unwrap(), vec!["projects", "set", "project/foo", "--status", "paused", "--vault", "/v"]);
        assert_eq!(
            set_args("/v", "project/foo", None, Some(""), Some(""), Some(&["a".into(), "b".into()])).unwrap(),
            vec!["projects", "set", "project/foo", "--outcome", "", "--target", "", "--domains", "a,b", "--vault", "/v"]
        );
        assert!(set_args("/v", "person/foo", Some("done"), None, None, None).is_err());
        assert!(set_args("/v", "project/foo", Some("deleted"), None, None, None).is_err());
        assert!(set_args("/v", "project/foo", None, None, None, Some(&["--x".into()])).is_err());
    }

    #[test]
    fn decide_args_take_the_id_and_forever() {
        assert_eq!(decide_args("/v", "accept", "domain:foo-craft", false).unwrap(), vec!["suggest", "accept", "domain:foo-craft", "--vault", "/v"]);
        assert_eq!(decide_args("/v", "dismiss", "archive_domain:foo", true).unwrap(), vec!["suggest", "dismiss", "archive_domain:foo", "--forever", "--vault", "/v"]);
        assert!(decide_args("/v", "accept", "--vault", false).is_err());
        assert!(decide_args("/v", "accept", "a b", false).is_err());
    }
}
