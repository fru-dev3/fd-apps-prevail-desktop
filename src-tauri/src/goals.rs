// Goals: each domain keeps its own in source/goals.md (General's in the
// General domain folder). The desktop parses and writes the list; these
// commands only read the files and write one back.
//
// Format (a plain markdown list, the same inline-field style memory/tasks.md
// uses; anything else in the file is kept as is):
//
//   - [ ] Run a half marathon ~id:g-3f2a ~status:active ~due:2026-12-31 ~progress:40
//     why: Feel strong again.
//   - [x] Ship the foo ~id:g-9c1d ~status:done
//
// `[x]` means done. `~status:` is active, done or archived. `~due:` is
// YYYY-MM-DD. `~progress:` is 0 to 100. The indented `why:` line belongs to
// the goal above it.
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize)]
pub struct GoalsFile {
    pub domain: String,
    pub path: String,
    pub body: String,
}

fn goals_path(vault: &str, domain: &str) -> Result<PathBuf, String> {
    if !(crate::paths::is_general(domain) || crate::paths::is_safe_domain(domain)) {
        return Err(format!("not a domain: {domain}"));
    }
    let d = if crate::paths::is_general(domain) { "general" } else { domain };
    Ok(crate::paths::domain_dir(vault, &Some(d.to_string())).join("source").join("goals.md"))
}

/// Every domain's goals file (General first). A domain with none is left out.
#[tauri::command]
pub fn goals_files_read(vault: String) -> Result<Vec<GoalsFile>, String> {
    let mut names: Vec<String> = vec!["general".into()];
    if let Ok(ds) = crate::vault::scan_vault_impl(vault.clone()) {
        for d in ds {
            if !d.name.starts_with('_') && !d.name.starts_with('.') && d.name != "general" {
                names.push(d.name);
            }
        }
    }
    let mut out = Vec::new();
    for n in names {
        let p = goals_path(&vault, &n)?;
        if let Ok(body) = crate::read_to_string_retry(&p) {
            out.push(GoalsFile { domain: n, path: p.to_string_lossy().to_string(), body });
        }
    }
    Ok(out)
}

/// Write one domain's goals file (creating source/ when needed).
#[tauri::command]
pub fn goals_file_write(vault: String, domain: String, body: String) -> Result<String, String> {
    let p = goals_path(&vault, &domain)?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    }
    fs::write(&p, body).map_err(|e| format!("write {}: {e}", p.display()))?;
    Ok(p.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn goals_live_in_the_domain_source_folder_and_round_trip() {
        let v = std::env::temp_dir().join(format!("prevail-goals-{}", std::process::id()));
        let _ = fs::remove_dir_all(&v);
        fs::create_dir_all(v.join("data/domains/health")).unwrap();
        let vs = v.to_string_lossy().to_string();
        let p = goals_file_write(vs.clone(), "health".into(), "- [ ] Foo ~id:g-1 ~status:active\n".into()).unwrap();
        assert!(p.ends_with("data/domains/health/source/goals.md"), "{p}");
        let g = goals_file_write(vs.clone(), "".into(), "- [ ] Bar ~id:g-2\n".into()).unwrap();
        assert!(g.ends_with("data/domains/general/source/goals.md"), "{g}");
        let all = goals_files_read(vs.clone()).unwrap();
        assert!(all.iter().any(|f| f.domain == "health" && f.body.contains("Foo")));
        assert!(all.iter().any(|f| f.domain == "general" && f.body.contains("Bar")));
        assert!(goals_file_write(vs, "../x".into(), "".into()).is_err());
        let _ = fs::remove_dir_all(&v);
    }
}
