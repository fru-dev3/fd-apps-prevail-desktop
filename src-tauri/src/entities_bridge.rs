// Entities: the people, places, companies/products and things the owner talks
// about. The engine owns all of it (`prevail entities ...`, entities.ts); these
// commands are thin bridges. Engine calls block, so each runs on the blocking
// pool.

pub(crate) async fn json(args: Vec<String>) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        crate::engine::run_engine_json(&refs)
    })
    .await
    .map_err(|e| format!("entities task failed: {e}"))?
}

// A write's answer: the engine may say `{ error }` and still exit 0, which
// must reach the UI as a failure with the engine's own words.
pub(crate) async fn write_json(args: Vec<String>) -> Result<serde_json::Value, String> {
    let v = json(args).await?;
    if let Some(e) = v.get("error").and_then(|e| e.as_str()) {
        return Err(e.to_string());
    }
    Ok(v)
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

// Projects are entities too (project/<slug>), with their own folder and chat.
// Events (event/<slug>) are the Activities kind kept as entity pages.
const KINDS: &[&str] = &["person", "place", "org", "thing", "project", "event"];

// An entity id is <kind>/<name or slug>. Anything else never reaches the
// engine, so a crafted id cannot smuggle a flag into the argument list.
pub(crate) fn valid_id(id: &str) -> bool {
    let id = id.trim();
    match id.split_once('/') {
        // mission/<slug>: an @ mission in chat (the engine adds a brief of it).
        // app/<id>: a product's app record (the engine resolves it to its product).
        Some((kind, rest)) => (KINDS.contains(&kind) || kind == "mission" || kind == "app") && !rest.trim().is_empty() && !rest.starts_with('-') && id.len() <= 300,
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

// Entity chat. The conversations about one entity, newest first:
// `prevail entities threads <id> --vault V --json` -> [{ slug, domain, title, updated, turns }].
#[tauri::command]
pub async fn engine_entity_threads(vault: String, id: String) -> Result<serde_json::Value, String> {
    let mut args = id_args("threads", &vault, &id)?;
    args.push("--json".into());
    json(args).await
}

// Append a dated paragraph to the entity page's "Your notes":
// `prevail entities note <id> --append --text - --vault V --json` -> { ok }.
// The text goes on stdin so a reply that starts with "-" is never read as a flag.
#[tauri::command]
pub async fn engine_entity_note_append(vault: String, id: String, text: String) -> Result<serde_json::Value, String> {
    if text.trim().is_empty() {
        return Err("nothing to add".into());
    }
    let mut args = id_args("note", &vault, &id)?;
    args.push("--append".into());
    args.push("--text".into());
    args.push("-".into());
    args.push("--json".into());
    json_stdin(args, text).await
}

#[tauri::command]
pub async fn entities_refresh(vault: String) -> Result<serde_json::Value, String> {
    json(vec!["entities".into(), "refresh".into(), "--vault".into(), vault]).await
}

// De-duplication. Pending pairs (a read):
// `prevail entities duplicates --vault V --json` -> [{ pair, a, b, confidence, reason }].
#[tauri::command]
pub async fn engine_entities_duplicates(vault: String) -> Result<serde_json::Value, String> {
    json(vec!["entities".into(), "duplicates".into(), "--vault".into(), vault]).await
}

// Two ids for a pair command, both checked so neither can pose as a flag.
pub(crate) fn pair_args(sub: &str, vault: &str, a: &str, b: &str) -> Result<Vec<String>, String> {
    for id in [a, b] {
        if !valid_id(id) {
            return Err(format!("not an entity id: {id}"));
        }
    }
    if a.trim() == b.trim() {
        return Err("an entity cannot be merged with itself".into());
    }
    Ok(vec!["entities".into(), sub.into(), a.trim().into(), b.trim().into(), "--vault".into(), vault.into()])
}

// `prevail entities merge <keepId> <mergeId>` -> { ok, id }. Writes the vault.
#[tauri::command]
pub async fn engine_entities_merge(vault: String, keep: String, merge: String) -> Result<serde_json::Value, String> {
    write_json(pair_args("merge", &vault, &keep, &merge)?).await
}

// `prevail entities not-same <idA> <idB>` -> { ok }. Writes merges.json.
#[tauri::command]
pub async fn engine_entities_not_same(vault: String, a: String, b: String) -> Result<serde_json::Value, String> {
    write_json(pair_args("not-same", &vault, &a, &b)?).await
}

// Folders and pictures. Each entity is a folder with entity.md, an optional
// picture.<ext> and the owner's files/. A picture or file comes either as a
// path the owner picked, or as bytes (a drop, or an org's logo as a data:
// URI), which land in a private temp folder first so the engine always copies
// from a real file.
const PICTURE_MAX: usize = 5 * 1024 * 1024;
const FILE_MAX: usize = 50 * 1024 * 1024;

fn safe_file_name(name: &str) -> Option<String> {
    let n = std::path::Path::new(name.trim()).file_name()?.to_string_lossy().to_string();
    let n: String = n.chars().filter(|c| !c.is_control() && *c != '/' && *c != '\\').collect();
    if n.is_empty() || n.starts_with('.') || n.starts_with('-') || n.len() > 200 {
        return None;
    }
    Some(n)
}

// "data:image/png;base64,...." -> (bytes, "png").
pub(crate) fn decode_data_uri(uri: &str) -> Result<(Vec<u8>, &'static str), String> {
    use base64::Engine as _;
    let (head, body) = uri.split_once(',').ok_or("not a data: URI")?;
    let mime = head.strip_prefix("data:").and_then(|h| h.strip_suffix(";base64")).ok_or("not a base64 data: URI")?;
    let ext = match mime {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/x-icon" | "image/vnd.microsoft.icon" => "png",
        _ => return Err(format!("not a picture type: {mime}")),
    };
    let bytes = base64::engine::general_purpose::STANDARD.decode(body.trim().as_bytes()).map_err(|e| format!("bad picture data: {e}"))?;
    Ok((bytes, ext))
}

// Pictures and files are plain files: the vault's encryption covers text
// only, so they are never written into an encrypted vault.
const ENCRYPTED_NOTE: &str = "Pictures and files aren't encrypted yet, so they're off for encrypted vaults.";
fn refuse_if_encrypted(vault: &str) -> Result<(), String> {
    if std::path::Path::new(vault).join(".prevail-encrypted").exists() {
        return Err(ENCRYPTED_NOTE.into());
    }
    Ok(())
}

struct TempFile(std::path::PathBuf);
impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn stage(bytes: &[u8], name: &str, max: usize) -> Result<(TempFile, String), String> {
    if bytes.is_empty() || bytes.len() > max {
        return Err(format!("file must be between 1 byte and {} MB", max / (1024 * 1024)));
    }
    let dir = std::env::temp_dir().join(format!("prevail-entity-{}-{}", std::process::id(), uuid_like()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok((TempFile(dir), path.to_string_lossy().to_string()))
}

fn uuid_like() -> String {
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{n:x}")
}

// `prevail entities set-picture <id> --file <path>` -> { ok, path }.
// `file` is a picked path; `data_uri` is dropped bytes or a fetched logo.
#[tauri::command]
pub async fn engine_entities_set_picture(vault: String, id: String, file: Option<String>, data_uri: Option<String>) -> Result<serde_json::Value, String> {
    refuse_if_encrypted(&vault)?;
    let mut args = id_args("set-picture", &vault, &id)?;
    let _guard;
    let path = match (file.filter(|f| !f.trim().is_empty()), data_uri) {
        (Some(f), _) => f,
        (None, Some(uri)) => {
            let (bytes, ext) = decode_data_uri(&uri)?;
            let (g, p) = stage(&bytes, &format!("picture.{ext}"), PICTURE_MAX)?;
            _guard = g;
            p
        }
        _ => return Err("no picture given".into()),
    };
    args.push("--file".into());
    args.push(path);
    write_json(args).await
}

// `prevail entities rename <id> --name <n>` -> the detail. The engine writes
// the name in Title Case and keeps the old one as an alias.
#[tauri::command]
pub async fn engine_entities_rename(vault: String, id: String, name: String) -> Result<serde_json::Value, String> {
    let name = name.trim().to_string();
    if name.is_empty() || name.starts_with('-') || name.chars().count() > 120 || name.contains('\n') {
        return Err("not a name".into());
    }
    let mut args = id_args("rename", &vault, &id)?;
    args.push("--name".into());
    args.push(name);
    write_json(args).await
}

// `prevail entities set-website <id> --url <u>` -> { ok }. An empty url clears it.
#[tauri::command]
pub async fn engine_entities_set_website(vault: String, id: String, url: String) -> Result<serde_json::Value, String> {
    let url = url.trim().to_string();
    if url.starts_with('-') || url.len() > 300 || url.chars().any(char::is_whitespace) {
        return Err("not a website".into());
    }
    let mut args = id_args("set-website", &vault, &id)?;
    args.push("--url".into());
    args.push(url);
    write_json(args).await
}

// `prevail entities files <id>` -> [{ name, size, mtime }] (a read).
#[tauri::command]
pub async fn engine_entities_files(vault: String, id: String) -> Result<serde_json::Value, String> {
    json(id_args("files", &vault, &id)?).await
}

// `prevail entities add-file <id> --file <path>` -> { ok, name }.
// `file` is a picked path; `name` + `data` (base64) is a dropped file.
#[tauri::command]
pub async fn engine_entities_add_file(vault: String, id: String, file: Option<String>, name: Option<String>, data: Option<String>) -> Result<serde_json::Value, String> {
    use base64::Engine as _;
    refuse_if_encrypted(&vault)?;
    let mut args = id_args("add-file", &vault, &id)?;
    let _guard;
    let path = match (file.filter(|f| !f.trim().is_empty()), name, data) {
        (Some(f), _, _) => f,
        (None, Some(n), Some(d)) => {
            let n = safe_file_name(&n).ok_or("not a file name")?;
            let bytes = base64::engine::general_purpose::STANDARD.decode(d.trim().as_bytes()).map_err(|e| format!("bad file data: {e}"))?;
            let (g, p) = stage(&bytes, &n, FILE_MAX)?;
            _guard = g;
            p
        }
        _ => return Err("no file given".into()),
    };
    args.push("--file".into());
    args.push(path);
    write_json(args).await
}

// An entity's picture (or an image in its files/) for display, as a data:
// URI. Only images inside the vault's data/entities folder are ever read.
#[tauri::command]
pub async fn engine_entity_picture(vault: String, path: String) -> Result<String, String> {
    use base64::Engine as _;
    let root = std::fs::canonicalize(std::path::Path::new(&vault).join("data").join("entities")).map_err(|e| e.to_string())?;
    let p = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let in_files = p.parent().and_then(|d| d.file_name()).map(|d| d == "files").unwrap_or(false);
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name.as_str(), ""));
    let mime = match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        _ => return Err("not an entity picture".into()),
    };
    if !(stem == "picture" || in_files) || !p.starts_with(&root) {
        return Err("not an entity picture".into());
    }
    let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
    if bytes.len() > PICTURE_MAX {
        return Err("picture too large".into());
    }
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

// ── Entities and Activities (ia.ts in the engine) ───────────────────────────
// Products, links both ways, a thing's or an event's fields, the calendar
// strip, an event to a project, the calendar question and new objects by
// talking. Every id is checked before it reaches the engine.

const FIELDS: &[&str] = &["date", "end", "time", "people", "project", "calendar", "purchased", "warranty", "value", "maker", "place"];
const DRAFT_KINDS: &[&str] = &["person", "place", "org", "thing", "event"];

fn plain(v: &str, max: usize) -> Result<String, String> {
    let v = v.trim();
    if v.starts_with('-') || v.len() > max || v.chars().any(|c| c.is_control()) {
        return Err("not a plain value".into());
    }
    Ok(v.to_string())
}

// A calendar strip row: event/<slug>, calendar:<id>, milestone:<slug>:<id> or hold:<slug>:<id>.
pub(crate) fn valid_row(id: &str) -> bool {
    let id = id.trim();
    if valid_id(id) {
        return true;
    }
    match id.split_once(':') {
        Some((k, rest)) => ["calendar", "milestone", "hold"].contains(&k) && !rest.is_empty() && !rest.starts_with('-') && id.len() <= 400 && !id.chars().any(|c| c.is_control() || c.is_whitespace()),
        None => false,
    }
}

pub(crate) fn field_args(vault: &str, id: &str, field: &str, value: &str) -> Result<Vec<String>, String> {
    if !FIELDS.contains(&field) {
        return Err(format!("unknown field: {field}"));
    }
    let mut a = id_args("set", vault, id)?;
    a.extend(["--field".into(), field.into(), "--value".into()]);
    // An empty value clears the field; a value never poses as a flag.
    a.push(if value.trim().is_empty() { String::new() } else { plain(value, 300)? });
    Ok(a)
}

#[tauri::command]
pub async fn ia_products(vault: String) -> Result<serde_json::Value, String> {
    json(vec!["entities".into(), "products".into(), "--vault".into(), vault]).await
}

#[tauri::command]
pub async fn ia_links(vault: String, id: String) -> Result<serde_json::Value, String> {
    json(id_args("links", &vault, &id)?).await
}

#[tauri::command]
pub async fn ia_link(vault: String, a: String, b: String, remove: Option<bool>) -> Result<serde_json::Value, String> {
    for id in [&a, &b] {
        if !valid_id(id) {
            return Err(format!("not an id: {id}"));
        }
    }
    let sub = if remove.unwrap_or(false) { "unlink" } else { "link" };
    write_json(vec!["entities".into(), sub.into(), a.trim().into(), b.trim().into(), "--vault".into(), vault]).await
}

#[tauri::command]
pub async fn ia_set_field(vault: String, id: String, field: String, value: String, name: Option<String>) -> Result<serde_json::Value, String> {
    let mut a = field_args(&vault, &id, &field, &value)?;
    if let Some(n) = name.as_deref() {
        opt(&mut a, "--name", Some(&plain(n, 120)?));
    }
    write_json(a).await
}

#[tauri::command]
pub async fn ia_service(vault: String, id: String, what: String, date: Option<String>, cost: Option<String>) -> Result<serde_json::Value, String> {
    let mut a = id_args("service", &vault, &id)?;
    a.extend(["--what".into(), plain(&what, 200)?]);
    if let Some(d) = date.as_deref().filter(|d| !d.trim().is_empty()) { a.extend(["--date".into(), plain(d, 10)?]); }
    if let Some(c) = cost.as_deref().filter(|c| !c.trim().is_empty()) { a.extend(["--cost".into(), plain(c, 20)?]); }
    write_json(a).await
}

#[tauri::command]
pub async fn ia_events(vault: String, from: Option<String>, to: Option<String>) -> Result<serde_json::Value, String> {
    let mut a: Vec<String> = vec!["entities".into(), "events".into(), "--vault".into(), vault];
    if let Some(f) = from.as_deref().filter(|f| !f.trim().is_empty()) { a.extend(["--from".into(), plain(f, 10)?]); }
    if let Some(t) = to.as_deref().filter(|t| !t.trim().is_empty()) { a.extend(["--to".into(), plain(t, 10)?]); }
    json(a).await
}

// Opening a strip row gives it a page (once); an event id comes back as it is.
#[tauri::command]
pub async fn ia_event_adopt(vault: String, row: String) -> Result<serde_json::Value, String> {
    if !valid_row(&row) {
        return Err(format!("not an event: {row}"));
    }
    write_json(vec!["entities".into(), "event-adopt".into(), row.trim().into(), "--vault".into(), vault]).await
}

// The calendar question. "ask" only marks it; "yes" is the user's own click
// and the only way an event reaches their calendar; "no" declines.
#[tauri::command]
pub async fn ia_event_calendar(vault: String, id: String, answer: String) -> Result<serde_json::Value, String> {
    let mut a = id_args("event-calendar", &vault, &id)?;
    match answer.as_str() {
        "yes" => a.push("--yes".into()),
        "no" => a.push("--no".into()),
        "ask" => {}
        _ => return Err("answer is ask, yes or no".into()),
    }
    write_json(a).await
}

#[tauri::command]
pub async fn ia_event_project(vault: String, id: String, project: Option<String>) -> Result<serde_json::Value, String> {
    let mut a = id_args("event-project", &vault, &id)?;
    if let Some(p) = project.as_deref().filter(|p| !p.trim().is_empty()) {
        if !valid_id(p) {
            return Err(format!("not a project: {p}"));
        }
        a.extend(["--project".into(), p.trim().into()]);
    }
    write_json(a).await
}

// One turn of "new <kind>" by talking: never creates.
#[tauri::command]
pub async fn ia_draft(vault: String, kind: String, turns: serde_json::Value, draft: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    if !DRAFT_KINDS.contains(&kind.as_str()) {
        return Err(format!("unknown kind: {kind}"));
    }
    let list = turns.as_array().ok_or("turns must be a list")?;
    if list.len() > 40 {
        return Err("too many turns".into());
    }
    let body = serde_json::json!({ "turns": list, "draft": draft.unwrap_or(serde_json::json!({})) }).to_string();
    if body.len() > 64_000 {
        return Err("the conversation is too long".into());
    }
    json_stdin(vec!["entities".into(), "draft".into(), "--kind".into(), kind, "--vault".into(), vault], body).await
}

// Save what the conversation drafted: only on the user's go.
#[tauri::command]
pub async fn ia_create(vault: String, kind: String, draft: serde_json::Value) -> Result<serde_json::Value, String> {
    if !DRAFT_KINDS.contains(&kind.as_str()) {
        return Err(format!("unknown kind: {kind}"));
    }
    if !draft.is_object() {
        return Err("the draft must be an object".into());
    }
    let body = serde_json::json!({ "draft": draft }).to_string();
    if body.len() > 32_000 {
        return Err("the draft is too long".into());
    }
    let v = json_stdin(vec!["entities".into(), "create".into(), "--kind".into(), kind, "--vault".into(), vault], body).await?;
    if let Some(e) = v.get("error").and_then(|e| e.as_str()) {
        return Err(e.to_string());
    }
    Ok(v)
}

#[cfg(test)]
mod tests_ia {
    use super::*;

    #[test]
    fn strip_rows_and_ids_are_checked() {
        assert!(valid_row("event/christmas"));
        assert!(valid_row("calendar:abc123"));
        assert!(valid_row("milestone:plan-foo:ms-1"));
        assert!(!valid_row("calendar:-x"));
        assert!(!valid_row("calendar:a b"));
        assert!(!valid_row("planet:mars"));
        assert!(valid_id("app/foo-bank"));
        assert!(valid_id("event/foo"));
    }

    #[test]
    fn field_args_name_a_known_field_and_never_a_flag() {
        assert_eq!(
            field_args("/v", "thing/foo-watch", "warranty", "2027-03-01").unwrap(),
            vec!["entities", "set", "thing/foo-watch", "--vault", "/v", "--field", "warranty", "--value", "2027-03-01"]
        );
        assert_eq!(field_args("/v", "event/foo", "place", "").unwrap().last().unwrap(), "");
        assert!(field_args("/v", "thing/foo", "colour", "red").is_err());
        assert!(field_args("/v", "thing/foo", "maker", "--vault").is_err());
    }
}

#[cfg(test)]
mod tests_folders {
    use super::*;

    #[test]
    fn data_uris_decode_to_picture_types_only() {
        let (b, ext) = decode_data_uri("data:image/png;base64,aGk=").unwrap();
        assert_eq!((b.as_slice(), ext), (&b"hi"[..], "png"));
        assert!(decode_data_uri("data:text/html;base64,aGk=").is_err());
        assert!(decode_data_uri("aGk=").is_err());
    }

    #[test]
    fn dropped_file_names_stay_plain() {
        assert_eq!(safe_file_name("notes.pdf").as_deref(), Some("notes.pdf"));
        assert_eq!(safe_file_name("../../etc/passwd").as_deref(), Some("passwd"));
        assert!(safe_file_name(".hidden").is_none());
        assert!(safe_file_name("--vault").is_none());
        assert!(safe_file_name("").is_none());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pair_args_check_both_ids() {
        assert_eq!(
            pair_args("merge", "/v", "person/foo-bar", "person/foo").unwrap(),
            vec!["entities", "merge", "person/foo-bar", "person/foo", "--vault", "/v"]
        );
        assert!(pair_args("not-same", "/v", "person/foo", "--vault").is_err());
        assert!(pair_args("merge", "/v", "person/foo", "person/foo").is_err());
    }

    #[test]
    fn entity_chat_args_carry_the_id_and_reject_a_crafted_one() {
        let a = id_args("threads", "/v", "person/foo").unwrap();
        assert_eq!(a, vec!["entities", "threads", "person/foo", "--vault", "/v"]);
        assert!(id_args("note", "/v", "--vault").is_err());
        assert!(id_args("note", "/v", "person/-x").is_err());
    }

    #[test]
    fn ids_must_name_a_kind() {
        assert!(valid_id("person/Sam Rivera"));
        assert!(valid_id("org/acme"));
        assert!(!valid_id("sam"));
        assert!(valid_id("mission/paint-the-shed"));
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
