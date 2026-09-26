// App favicons — fetch a site's real favicon ONCE, cache it to disk as a
// base64 data: URI, and hand it to the UI. This gives almost every app its
// actual logo (simple-icons dropped many brands like Canva) WITHOUT bundling a
// huge icon set and WITHOUT the CSP allowing external images (a data: URI is
// already permitted). Privacy: it only fires on demand, caches locally, and is
// suppressed entirely in Bunker Mode (nothing leaves the device there).

use std::io::Write;
use std::path::PathBuf;

// Where cached favicons live: ~/.prevail/favicons/<safe-host>.datauri
fn cache_dir() -> PathBuf {
    let base = std::env::var("PREVAIL_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".prevail")
        });
    base.join("favicons")
}

fn safe_host(host: &str) -> String {
    host.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' })
        .collect()
}

/// A bare DNS name: letters, digits, dots and dashes, nothing else. The host is
/// pasted into `https://{host}/favicon.ico`, so a `?`, `#`, `@` or `:` would
/// let a caller aim the fetch at another path or port (e.g. `127.0.0.1:8443?`
/// fetches that service's root). Combined with returning any body as a data:
/// URI, that read a private service over the phone bridge.
fn is_plain_hostname(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && !host.starts_with('.')
        && !host.starts_with('-')
        && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

/// Only an image may come back as an icon; anything else (an HTML page, a JSON
/// API response) is dropped rather than handed to the caller.
fn is_image_type(ct: &str) -> bool {
    ct.trim().to_ascii_lowercase().starts_with("image/")
}

/// Return a base64 data: URI for `host`'s favicon, or "" when unavailable.
/// Cached on disk after the first fetch. Empty in Bunker Mode (offline-only),
/// or when the host is missing / the fetch fails — the UI then shows the letter
/// mark. Never errors in a way that breaks the row; worst case is "".
#[tauri::command]
pub async fn app_favicon(host: String) -> Result<String, String> {
    let host = host.trim().to_lowercase();
    if !is_plain_hostname(&host) {
        return Ok(String::new());
    }
    let dir = cache_dir();
    let file = dir.join(format!("{}.datauri", safe_host(&host)));
    // Cache hit — return immediately (works offline, incl. Bunker Mode).
    if let Ok(cached) = std::fs::read_to_string(&file) {
        return Ok(cached);
    }
    // No network in Bunker Mode: return empty so the UI falls back to the letter.
    if crate::bunker::bunker_enabled() {
        return Ok(String::new());
    }
    let uri = fetch_favicon(&host).await.unwrap_or_default();
    if !uri.is_empty() {
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(mut f) = std::fs::File::create(&file) {
            let _ = f.write_all(uri.as_bytes());
        }
    }
    Ok(uri)
}

// Fetch the app's own /favicon.ico. This used to go through Google's s2
// favicon service, which meant every connected app's hostname was reported to
// Google - a third party the user never chose - from a product whose promise
// is that nothing leaves the machine that you didn't send. Asking the app's
// own host reveals nothing it doesn't already know. Async. Returns a base64
// data: URI or None.
async fn fetch_favicon(host: &str) -> Option<String> {
    let url = format!("https://{host}/favicon.ico");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .ok()?;
    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let ct = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    if !is_image_type(&ct) {
        return None;
    }
    let bytes = resp.bytes().await.ok()?;
    // Google returns a tiny generic globe (~ a few hundred bytes) for unknown
    // domains; treat a suspiciously small payload as "no real favicon" so the UI
    // shows the letter mark instead of a meaningless globe.
    if bytes.len() < 120 {
        return None;
    }
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{ct};base64,{b64}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_bare_hostname_is_fetched() {
        assert!(is_plain_hostname("canva.com"));
        assert!(is_plain_hostname("app.hubspot.com"));
        for bad in ["", "127.0.0.1:8443?", "internal#", "user@evil.com", "a/b", "a b", ".x", "x?y=1", "[::1]"] {
            assert!(!is_plain_hostname(bad), "{bad:?} must not be fetched");
        }
    }

    #[test]
    fn only_an_image_comes_back() {
        assert!(is_image_type("image/x-icon"));
        assert!(is_image_type("IMAGE/png"));
        assert!(!is_image_type("text/html; charset=utf-8"));
        assert!(!is_image_type("application/json"));
    }
}
