// Live app focus (apps plan A2): while Prevail runs, sample which app is in
// front and whether the user is idle, with no permission at all
// (`lsappinfo` for the frontmost bundle id, `ioreg` for HID idle time). Minutes
// per app per day go to ~/.prevail/cache/app-focus-live.json; the engine's
// `apps scan` turns them into app.focus events (Screen Time wins when Prevail
// can read it). Bundle ids only: never window titles or screen contents. The
// user can turn it off (source "live-focus" in Sources), checked at each flush.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

const SAMPLE_SECS: u64 = 60;
const FLUSH_EVERY: u32 = 5; // samples
const IDLE_LIMIT_SECS: u64 = 120;
const KEEP_DAYS: usize = 35;

pub(crate) type Days = BTreeMap<String, BTreeMap<String, u64>>;

/// `lsappinfo info -only bundleid <asn>` prints `"CFBundleIdentifier"="com.example.App"`.
pub(crate) fn parse_bundle(out: &str) -> Option<String> {
    let v = out.split('=').nth(1)?.trim().trim_matches('"').to_string();
    let ok = v.split('.').count() >= 2 && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_');
    if ok { Some(v) } else { None }
}

/// `ioreg -c IOHIDSystem -d 4 -r -k HIDIdleTime` carries `"HIDIdleTime" = <nanoseconds>`.
pub(crate) fn parse_idle_secs(out: &str) -> Option<u64> {
    let line = out.lines().find(|l| l.contains("\"HIDIdleTime\""))?;
    let n: u64 = line.split('=').nth(1)?.trim().parse().ok()?;
    Some(n / 1_000_000_000)
}

/// `date +%z` prints `-0500`; seconds east of UTC.
pub(crate) fn parse_offset(out: &str) -> i64 {
    let s = out.trim();
    if s.len() != 5 { return 0; }
    let sign = if s.starts_with('-') { -1 } else { 1 };
    let h: i64 = s[1..3].parse().unwrap_or(0);
    let m: i64 = s[3..5].parse().unwrap_or(0);
    sign * (h * 3600 + m * 60)
}

fn run(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    if !out.status.success() { return None; }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn frontmost() -> Option<String> {
    let asn = run("/usr/bin/lsappinfo", &["front"])?;
    let asn = asn.trim();
    if asn.is_empty() { return None; }
    parse_bundle(&run("/usr/bin/lsappinfo", &["info", "-only", "bundleid", asn])?)
}

fn idle_secs() -> u64 {
    run("/usr/sbin/ioreg", &["-c", "IOHIDSystem", "-d", "4", "-r", "-k", "HIDIdleTime"]).and_then(|o| parse_idle_secs(&o)).unwrap_or(0)
}

fn cache_file() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".prevail").join("cache").join("app-focus-live.json"))
}

/// Add samples into the file's days, keep the last KEEP_DAYS days.
pub(crate) fn merge(existing: Option<&str>, add: &Days) -> Days {
    let mut days: Days = existing
        .and_then(|t| serde_json::from_str::<serde_json::Value>(t).ok())
        .and_then(|v| v.get("days").cloned())
        .and_then(|d| serde_json::from_value::<Days>(d).ok())
        .unwrap_or_default();
    for (day, apps) in add {
        let e = days.entry(day.clone()).or_default();
        for (b, s) in apps { *e.entry(b.clone()).or_insert(0) += s; }
    }
    while days.len() > KEEP_DAYS {
        let first = days.keys().next().cloned();
        if let Some(k) = first { days.remove(&k); } else { break; }
    }
    days
}

/// Is live focus allowed on this Mac? The user's answer in build/_meta/consent.json; on by default.
pub(crate) fn allowed(vault: Option<&str>) -> bool {
    let Some(v) = vault else { return true };
    let p = std::path::Path::new(v).join("build").join("_meta").join("consent.json");
    let Ok(t) = std::fs::read_to_string(p) else { return true };
    let Ok(j) = serde_json::from_str::<serde_json::Value>(&t) else { return true };
    j.pointer("/sources/live-focus/on").and_then(|b| b.as_bool()).unwrap_or(true)
}

fn flush(pending: &mut Days) {
    if pending.is_empty() { return; }
    let Some(p) = cache_file() else { return };
    if let Some(dir) = p.parent() { let _ = std::fs::create_dir_all(dir); }
    let existing = std::fs::read_to_string(&p).ok();
    let days = merge(existing.as_deref(), pending);
    let body = serde_json::json!({ "v": 1, "days": days }).to_string();
    let tmp = p.with_extension("json.tmp");
    if std::fs::write(&tmp, body).is_ok() { let _ = std::fs::rename(&tmp, &p); }
    pending.clear();
}

/// Start the sampler thread (once, at app start). macOS only.
pub(crate) fn start() {
    if !cfg!(target_os = "macos") { return; }
    std::thread::Builder::new().name("prevail-focus".into()).spawn(|| {
        let mut pending: Days = BTreeMap::new();
        let mut n: u32 = 0;
        let mut offset = run("/bin/date", &["+%z"]).map(|o| parse_offset(&o)).unwrap_or(0);
        loop {
            std::thread::sleep(Duration::from_secs(SAMPLE_SECS));
            if idle_secs() < IDLE_LIMIT_SECS {
                if let Some(b) = frontmost() {
                    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
                    let (y, mo, d, _, _, _) = crate::secs_to_ymdhms(now + offset);
                    *pending.entry(format!("{y:04}-{mo:02}-{d:02}")).or_default().entry(b).or_insert(0) += SAMPLE_SECS;
                }
            }
            n += 1;
            if n % FLUSH_EVERY == 0 {
                let vault = crate::engine::engine_config_vault();
                if allowed(vault.as_deref()) { flush(&mut pending); } else { pending.clear(); }
                offset = run("/bin/date", &["+%z"]).map(|o| parse_offset(&o)).unwrap_or(offset);
            }
        }
    }).ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_tools_output() {
        assert_eq!(parse_bundle("\"CFBundleIdentifier\"=\"com.example.FooApp\"\n"), Some("com.example.FooApp".into()));
        assert_eq!(parse_bundle("\"CFBundleIdentifier\"=[ NULL ]"), None);
        assert_eq!(parse_idle_secs("  |   \"HIDIdleTime\" = 6247053250\n"), Some(6));
        assert_eq!(parse_offset("-0500\n"), -18000);
        assert_eq!(parse_offset("+0530"), 19800);
    }

    #[test]
    fn merges_and_keeps_recent_days() {
        let mut add: Days = BTreeMap::new();
        add.entry("2026-09-30".into()).or_default().insert("com.example.A".into(), 60);
        let d = merge(Some(r#"{"v":1,"days":{"2026-09-30":{"com.example.A":120}}}"#), &add);
        assert_eq!(d["2026-09-30"]["com.example.A"], 180);
        let mut many: Days = BTreeMap::new();
        for i in 1..=40 { many.entry(format!("2026-08-{i:02}")).or_default().insert("a.b.c".into(), 1); }
        assert_eq!(merge(None, &many).len(), KEEP_DAYS);
    }

    #[test]
    fn consent_off_stops_it() {
        let dir = std::env::temp_dir().join(format!("prevail-focus-{}", std::process::id()));
        let meta = dir.join("build").join("_meta");
        std::fs::create_dir_all(&meta).unwrap();
        assert!(allowed(Some(dir.to_str().unwrap())));
        std::fs::write(meta.join("consent.json"), r#"{"sources":{"live-focus":{"on":false}}}"#).unwrap();
        assert!(!allowed(Some(dir.to_str().unwrap())));
        let _ = std::fs::remove_dir_all(dir);
    }
}
