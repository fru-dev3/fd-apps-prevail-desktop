// The chief of staff and the Compass, as vault files under build/.
//
// build/chief-of-staff.md holds the name the user gave their chief of staff
// (frontmatter `name:`), so the sidebar's General row can carry it. The
// engine owns the format (`prevail chief show|set-name`); this only reads it.

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
}
