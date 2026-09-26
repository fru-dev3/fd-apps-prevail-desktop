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
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .dns_resolver(std::sync::Arc::new(PublicOnlyResolver))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !is_public_https(attempt.url()) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .ok()?;
    for path in icon_paths(host) {
        if let Some(uri) = fetch_icon(&client, &format!("https://{host}{path}")).await {
            return Some(uri);
        }
    }
    // Many sites serve no /favicon.ico and declare their icon in the page head
    // instead, often on an asset host of their own (a CDN, a static domain).
    // Read the home page (size-capped) and follow the declared icon over https
    // to a named public host. The resolver refuses private addresses, so a page
    // cannot point the fetch into the local network.
    let resp = client.get(format!("https://{host}/")).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body = resp.bytes().await.ok()?;
    let html = String::from_utf8_lossy(&body[..body.len().min(512 * 1024)]).to_string();
    for href in icon_hrefs(&html) {
        let Some(url) = resolve_icon_url(host, &href) else { continue };
        if let Some(uri) = fetch_icon(&client, &url).await {
            return Some(uri);
        }
    }
    None
}

/// Products whose site answers /favicon.ico and its home page with a sign-in
/// wall rather than an icon. Each maps to the path of the icon the product
/// itself serves, tried before /favicon.ico.
const PRODUCT_ICON_PATHS: &[(&str, &str)] = &[
    ("calendar.google.com", "/googlecalendar/images/favicons_2020q4/calendar_31.ico"),
];

fn icon_paths(host: &str) -> Vec<&'static str> {
    PRODUCT_ICON_PATHS
        .iter()
        .filter(|(h, _)| *h == host)
        .map(|(_, p)| *p)
        .chain(std::iter::once("/favicon.ico"))
        .collect()
}

async fn fetch_icon(client: &reqwest::Client, url: &str) -> Option<String> {
    let resp = client.get(url).send().await.ok()?;
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
    if bytes.len() < 120 || bytes.len() > 512 * 1024 {
        return None;
    }
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{ct};base64,{b64}"))
}

/// Icon links declared in a page, best first: apple-touch-icon (large, square)
/// then any other rel containing "icon". SVG is skipped (it can carry script).
fn icon_hrefs(html: &str) -> Vec<String> {
    let lower = html.to_ascii_lowercase();
    let mut touch = Vec::new();
    let mut other = Vec::new();
    let mut from = 0;
    while let Some(i) = lower[from..].find("<link") {
        let start = from + i;
        let Some(len) = lower[start..].find('>') else { break };
        let tag = &html[start..start + len];
        let tag_l = &lower[start..start + len];
        from = start + len;
        let (Some(rel), Some(href)) = (attr(tag, tag_l, "rel"), attr(tag, tag_l, "href")) else { continue };
        let rel = rel.to_ascii_lowercase();
        if !rel.split_whitespace().any(|r| r == "icon" || r == "apple-touch-icon" || r == "apple-touch-icon-precomposed") {
            continue;
        }
        if href.to_ascii_lowercase().split('?').next().unwrap_or("").ends_with(".svg") {
            continue;
        }
        if rel.contains("apple-touch-icon") { touch.push(href) } else { other.push(href) }
    }
    touch.into_iter().chain(other).collect()
}

fn attr(tag: &str, tag_l: &str, name: &str) -> Option<String> {
    let mut from = 0;
    while let Some(i) = tag_l[from..].find(name) {
        let at = from + i;
        from = at + name.len();
        let before_ok = at == 0 || tag_l.as_bytes()[at - 1].is_ascii_whitespace();
        let rest = tag_l[from..].trim_start();
        if !before_ok || !rest.starts_with('=') {
            continue;
        }
        let off = tag_l.len() - rest.len() + 1;
        let val = tag[off..].trim_start();
        let (q, body) = match val.chars().next()? {
            '"' => ('"', &val[1..]),
            '\'' => ('\'', &val[1..]),
            _ => (' ', val),
        };
        let end = body.find(q).unwrap_or(body.len());
        let v = body[..end].trim();
        return if v.is_empty() { None } else { Some(v.to_string()) };
    }
    None
}

/// Resolve a declared icon href against the site. Only https URLs on a named
/// host (no IP literal, no explicit port) are allowed; the host may differ from
/// the site, since icons often live on the site's own asset host.
fn resolve_icon_url(host: &str, href: &str) -> Option<String> {
    let h = href.trim();
    let url = if let Some(rest) = h.strip_prefix("https://") {
        format!("https://{rest}")
    } else if let Some(rest) = h.strip_prefix("//") {
        format!("https://{rest}")
    } else if h.starts_with('/') {
        format!("https://{host}{h}")
    } else if h.contains(':') {
        return None;
    } else {
        format!("https://{host}/{h}")
    };
    let parsed = reqwest::Url::parse(&url).ok()?;
    if is_public_https(&parsed) { Some(url) } else { None }
}

/// An https URL on a named host with the default port. IP literals are refused
/// here because they skip DNS, and so would skip the resolver's address check.
fn is_public_https(url: &reqwest::Url) -> bool {
    if url.scheme() != "https" || url.port().is_some() {
        return false;
    }
    let Some(d) = url.host_str() else { return false };
    let d = d.to_ascii_lowercase();
    is_plain_hostname(&d)
        && d.contains('.')
        && !d.ends_with(".local")
        && !d.ends_with(".internal")
        && d.parse::<std::net::IpAddr>().is_err()
        && !d.chars().all(|c| c.is_ascii_digit() || c == '.')
}

/// A public internet address. Loopback, private, link-local, CGNAT (which
/// includes Tailscale), multicast and unspecified ranges are refused.
fn is_public_ip(ip: std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            !(v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4.is_unspecified()
                || v4.is_multicast()
                || o[0] == 0
                || (o[0] == 100 && (o[1] & 0xc0) == 64)
                || (o[0] == 198 && (o[1] & 0xfe) == 18)
                || o[0] >= 240)
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_ip(IpAddr::V4(v4));
            }
            let seg = v6.segments();
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (seg[0] & 0xfe00) == 0xfc00
                || (seg[0] & 0xffc0) == 0xfe80
                || seg[0] == 0x2001 && seg[1] == 0x0db8)
        }
    }
}

/// DNS for favicon fetches: the system resolver, with every non-public address
/// dropped. A name that only resolves privately fails to connect. This covers
/// the site, its declared icon host and every redirect hop.
struct PublicOnlyResolver;

impl reqwest::dns::Resolve for PublicOnlyResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let addrs: Vec<std::net::SocketAddr> = tokio::net::lookup_host((host.as_str(), 0))
                .await?
                .filter(|a| is_public_ip(a.ip()))
                .collect();
            if addrs.is_empty() {
                return Err("no public address".into());
            }
            Ok(Box::new(addrs.into_iter()) as reqwest::dns::Addrs)
        })
    }
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
    fn declared_icons_are_found_best_first() {
        let html = r#"<head><link rel="stylesheet" href="/a.css"><link rel="icon" href="/fav.png"><LINK REL='apple-touch-icon' HREF='/touch.png'><link rel="icon" href="/logo.svg"></head>"#;
        assert_eq!(icon_hrefs(html), vec!["/touch.png".to_string(), "/fav.png".to_string()]);
    }

    #[test]
    fn declared_icons_resolve_to_public_https() {
        assert_eq!(resolve_icon_url("foo.example", "/i.png").as_deref(), Some("https://foo.example/i.png"));
        assert_eq!(resolve_icon_url("foo.example", "i.png").as_deref(), Some("https://foo.example/i.png"));
        assert_eq!(resolve_icon_url("www.foo.example", "https://cdn.foo.example/i.png").as_deref(), Some("https://cdn.foo.example/i.png"));
        assert_eq!(resolve_icon_url("foo.example", "//static.foo.example/i.png").as_deref(), Some("https://static.foo.example/i.png"));
        // An asset host of the site's own (a CDN or static domain) is followed.
        assert_eq!(resolve_icon_url("cal.foo.example", "https://assets.foostatic.example/f.ico?v=1").as_deref(), Some("https://assets.foostatic.example/f.ico?v=1"));
        for bad in [
            "http://foo.example/i.png",
            "https://127.0.0.1/i.png",
            "https://10.0.0.8/i.png",
            "https://[::1]/i.png",
            "https://localhost/i.png",
            "https://printer.local/i.png",
            "data:image/png;base64,AA",
            "https://foo.example:8443/i.png",
            "https://user@foo.example@evil/i.png",
        ] {
            assert!(resolve_icon_url("foo.example", bad).is_none(), "{bad} must not be fetched");
        }
    }

    #[test]
    fn only_public_addresses_are_dialed() {
        for ok in ["93.184.216.34", "142.250.72.14", "2606:4700::1111"] {
            assert!(is_public_ip(ok.parse().unwrap()), "{ok} is public");
        }
        for bad in [
            "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.10", "169.254.169.254", "100.83.1.2",
            "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:192.168.1.1", "::ffff:127.0.0.1",
        ] {
            assert!(!is_public_ip(bad.parse().unwrap()), "{bad} must not be dialed");
        }
    }

    #[tokio::test]
    async fn the_resolver_drops_private_answers() {
        use reqwest::dns::Resolve;
        use std::str::FromStr;
        let r = PublicOnlyResolver.resolve(reqwest::dns::Name::from_str("localhost").unwrap()).await;
        assert!(r.is_err(), "localhost must not resolve for a favicon fetch");
    }

    // Live check against real sites; run with `cargo test --lib -- --ignored favicon`.
    #[tokio::test]
    #[ignore]
    async fn live_icons_on_other_asset_hosts() {
        for host in ["calendar.google.com", "privacy.com"] {
            let uri = fetch_favicon(host).await.unwrap_or_default();
            assert!(uri.starts_with("data:image/"), "{host} has no icon");
        }
    }

    #[test]
    fn product_icon_paths_come_before_the_default() {
        assert_eq!(icon_paths("calendar.google.com"), vec!["/googlecalendar/images/favicons_2020q4/calendar_31.ico", "/favicon.ico"]);
        assert_eq!(icon_paths("foo.example"), vec!["/favicon.ico"]);
    }

    #[test]
    fn only_an_image_comes_back() {
        assert!(is_image_type("image/x-icon"));
        assert!(is_image_type("IMAGE/png"));
        assert!(!is_image_type("text/html; charset=utf-8"));
        assert!(!is_image_type("application/json"));
    }
}
