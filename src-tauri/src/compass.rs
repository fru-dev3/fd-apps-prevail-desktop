// The chief of staff and the Compass, as vault files under build/.
//
// build/chief-of-staff.md holds the name the user gave their chief of staff
// (frontmatter `name:`), so the sidebar's General row can carry it. The
// engine owns the format (`prevail chief show|set-name`); this only reads it.
//
// build/compass.md is the Compass (grammar in src/compassmodel.ts and the
// engine's src/compass.ts). The page parses and edits it; a write keeps the
// prior text in build/compass.versions/<ISO time>.md (the same folder and
// naming as the engine) and appends one ledger line per change to
// build/_meta/compass/ledger.jsonl. Drafting a first Compass from the vault is
// the engine's job (`prevail compass bootstrap`).

use std::fs;
use std::io::Write;
use std::path::PathBuf;

fn compass_file(vault: &str) -> PathBuf {
    crate::paths::build_root(vault).join("compass.md")
}
fn versions_dir(vault: &str) -> PathBuf {
    crate::paths::build_root(vault).join("compass.versions")
}
fn ledger_file(vault: &str) -> PathBuf {
    crate::paths::build_root(vault).join("_meta").join("compass").join("ledger.jsonl")
}

#[tauri::command(async)]
pub(crate) fn compass_read(vault: String) -> Result<String, String> {
    let p = compass_file(&vault);
    if !p.exists() {
        return Ok(String::new());
    }
    crate::read_to_string_retry(&p).map_err(|e| format!("read compass.md: {e}"))
}

/// Write the Compass; the prior text becomes a version, each change a ledger line.
#[tauri::command(async)]
pub(crate) fn compass_write(vault: String, body: String, changes: Vec<serde_json::Value>) -> Result<(), String> {
    let _serial = crate::vaultio::serial();
    let p = compass_file(&vault);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir build: {e}"))?;
    }
    if let Ok(existing) = crate::read_to_string_retry(&p) {
        crate::idealstate::keep_version(&versions_dir(&vault), &existing, &body)?;
    }
    crate::vaultio::write_atomic(&p, &body).map_err(|e| format!("write compass.md: {e}"))?;
    if !changes.is_empty() {
        let lf = ledger_file(&vault);
        if let Some(parent) = lf.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir compass meta: {e}"))?;
        }
        let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        let mut out = String::new();
        for c in changes {
            let mut line = serde_json::json!({ "ts": ts });
            if let (Some(obj), Some(src)) = (line.as_object_mut(), c.as_object()) {
                for (k, v) in src {
                    obj.insert(k.clone(), v.clone());
                }
            }
            out.push_str(&line.to_string());
            out.push('\n');
        }
        let mut f = fs::OpenOptions::new().create(true).append(true).open(&lf).map_err(|e| format!("open ledger: {e}"))?;
        f.write_all(out.as_bytes()).map_err(|e| format!("append ledger: {e}"))?;
    }
    Ok(())
}

/// The Compass's earlier texts, newest first: { name, path }.
#[tauri::command(async)]
pub(crate) fn compass_versions(vault: String) -> Result<Vec<serde_json::Value>, String> {
    let mut names: Vec<String> = Vec::new();
    if let Ok(it) = crate::read_dir_retry(&versions_dir(&vault)) {
        for e in it.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if let Some(stem) = n.strip_suffix(".md") {
                names.push(stem.to_string());
            }
        }
    }
    names.sort();
    names.reverse();
    let dir = versions_dir(&vault);
    Ok(names.into_iter().map(|n| serde_json::json!({ "name": n, "path": dir.join(format!("{n}.md")).to_string_lossy() })).collect())
}

/// One earlier text, by its name from compass_versions (nothing outside that folder).
#[tauri::command(async)]
pub(crate) fn compass_version_read(vault: String, name: String) -> Result<String, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("not a version name".into());
    }
    crate::read_to_string_retry(versions_dir(&vault).join(format!("{name}.md"))).map_err(|e| format!("read version: {e}"))
}

/// The ledger, newest first, at most 300 lines.
#[tauri::command(async)]
pub(crate) fn compass_ledger(vault: String) -> Result<Vec<serde_json::Value>, String> {
    let text = crate::read_to_string_retry(ledger_file(&vault)).unwrap_or_default();
    let mut out: Vec<serde_json::Value> = text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    out.reverse();
    out.truncate(300);
    Ok(out)
}

/// Draft proposed lines from the vault, each with a quote from the user's notes (engine).
#[tauri::command]
/// With chain: only the mission statement, vision and objectives, and proposed links (the Compass chain).
pub(crate) async fn engine_compass_bootstrap(vault: String, chain: Option<bool>) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        if chain == Some(true) { crate::engine::run_engine_json(&["compass", "bootstrap", "--chain", "--vault", &vault, "--json"]) }
        else { crate::engine::run_engine_json(&["compass", "bootstrap", "--vault", &vault, "--json"]) }
    })
        .await
        .map_err(|e| format!("compass task failed: {e}"))?
}

#[tauri::command(async)]
pub(crate) fn chief_of_staff_read(vault: String) -> Result<String, String> {
    let p = crate::paths::build_root(&vault).join("chief-of-staff.md");
    if !p.exists() {
        return Ok(String::new());
    }
    crate::read_to_string_retry(&p).map_err(|e| format!("read chief-of-staff.md: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_chief_of_staff_file_or_nothing() {
        let dir = std::env::temp_dir().join(format!("prevail-cos-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("build")).unwrap();
        let v = dir.to_string_lossy().to_string();
        assert_eq!(chief_of_staff_read(v.clone()).unwrap(), "");
        std::fs::write(dir.join("build").join("chief-of-staff.md"), "---\nname: Foo\n---\n").unwrap();
        assert!(chief_of_staff_read(v).unwrap().contains("name: Foo"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn compass_writes_keep_versions_and_a_ledger() {
        let dir = std::env::temp_dir().join(format!("prevail-compass-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("build")).unwrap();
        let v = dir.to_string_lossy().to_string();
        assert_eq!(compass_read(v.clone()).unwrap(), "");
        compass_write(v.clone(), "# Compass\n\n## Values\n- Foo ~id:v-foo ~status:proposed\n".into(), vec![]).unwrap();
        assert!(compass_versions(v.clone()).unwrap().is_empty());
        let change = serde_json::json!({ "id": "v-foo", "from": "proposed", "to": "confirmed", "reason": "yes", "by": "user" });
        compass_write(v.clone(), "# Compass\n\n## Values\n- Foo ~id:v-foo\n".into(), vec![change]).unwrap();
        assert!(compass_read(v.clone()).unwrap().contains("- Foo ~id:v-foo\n"));
        let versions = compass_versions(v.clone()).unwrap();
        assert_eq!(versions.len(), 1);
        let name = versions[0]["name"].as_str().unwrap().to_string();
        assert!(compass_version_read(v.clone(), name).unwrap().contains("~status:proposed"));
        assert!(compass_version_read(v.clone(), "../x".into()).is_err());
        let ledger = compass_ledger(v.clone()).unwrap();
        assert_eq!(ledger.len(), 1);
        assert_eq!(ledger[0]["to"], "confirmed");
        assert!(ledger[0]["ts"].as_u64().unwrap() > 0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
