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
const KINDS: &[&str] = &["person", "place", "org", "thing", "project"];

// An entity id is <kind>/<name or slug>. Anything else never reaches the
// engine, so a crafted id cannot smuggle a flag into the argument list.
pub(crate) fn valid_id(id: &str) -> bool {
    let id = id.trim();
    match id.split_once('/') {
        // mission/<slug>: an @ mission in chat (the engine adds a brief of it).
        Some((kind, rest)) => (KINDS.contains(&kind) || kind == "mission") && !rest.trim().is_empty() && !rest.starts_with('-') && id.len() <= 300,
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
