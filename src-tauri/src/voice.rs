// Voice on the Mac: the phone records, the Mac transcribes. The WebUI (phone
// shell) posts the recording to /api/upload-audio, then invokes
// `transcribe_audio` with the returned path; the Tauri window passes base64
// straight through invoke. Transcription never leaves the machine: it runs a
// local whisper.cpp binary (brew install whisper-cpp + a ggml model) or, when
// that is absent, `hear` (brew install hear), which drives Apple's Speech
// framework with on-device recognition forced. No cloud, no third party.
//
// Uploads land in a private temp dir and are deleted after transcription.
// A remote client may only point `transcribe_audio` at files INSIDE that dir,
// so the WebUI can never make the Mac read an arbitrary path.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::engine;

/// Hard cap on one recording: a minute of speech is well under 1 MB in any
/// MediaRecorder codec, so 10 MB leaves room for long notes without letting a
/// client fill the temp dir.
pub(crate) const MAX_UPLOAD_BYTES: usize = 10 * 1024 * 1024;

/// Where uploads are staged: <tmp>/prevail-voice, created on demand.
pub(crate) fn upload_dir() -> PathBuf {
    std::env::temp_dir().join("prevail-voice")
}

/// The file extension for a recorder MIME type (`audio/webm;codecs=opus` ->
/// `webm`). Only the formats MediaRecorder actually emits plus wav; anything
/// else is refused so the temp dir only ever holds audio.
pub(crate) fn ext_for_mime(content_type: &str) -> Option<&'static str> {
    let base = content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    match base.as_str() {
        "audio/webm" | "video/webm" => Some("webm"),
        "audio/mp4" | "video/mp4" | "audio/x-m4a" | "audio/m4a" | "audio/aac" => Some("mp4"),
        "audio/ogg" | "application/ogg" => Some("ogg"),
        "audio/wav" | "audio/x-wav" | "audio/wave" => Some("wav"),
        "audio/mpeg" | "audio/mp3" => Some("mp3"),
        _ => None,
    }
}

pub(crate) fn ext_ok(ext: &str) -> bool {
    matches!(ext, "webm" | "mp4" | "m4a" | "ogg" | "wav" | "mp3")
}

/// Pre-flight for an upload: the declared length (Content-Length, when the
/// client sends one) must fit the cap and the type must be audio we know.
/// Returns the extension to store under, or (http status, message).
pub(crate) fn check_upload(declared_len: Option<usize>, content_type: &str) -> Result<&'static str, (u16, String)> {
    if let Some(n) = declared_len {
        if n > MAX_UPLOAD_BYTES {
            return Err((413, format!("recording is larger than {} MB", MAX_UPLOAD_BYTES / (1024 * 1024))));
        }
        if n == 0 {
            return Err((400, "empty recording".into()));
        }
    }
    ext_for_mime(content_type).ok_or_else(|| (415, format!("unsupported audio type: {content_type}")))
}

/// True only for a plain file directly inside the upload dir: no traversal, no
/// symlink tricks (the parent is compared after canonicalising both sides).
pub(crate) fn is_upload_path(p: &Path) -> bool {
    let Some(name) = p.file_name().and_then(|n| n.to_str()) else { return false };
    if name.starts_with('.') || name.contains("..") {
        return false;
    }
    let Some(parent) = p.parent() else { return false };
    let dir = upload_dir();
    let same_dir = parent == dir
        || match (parent.canonicalize(), dir.canonicalize()) {
            (Ok(a), Ok(b)) => a == b,
            _ => false,
        };
    same_dir && p.extension().and_then(|e| e.to_str()).map(ext_ok).unwrap_or(false)
}

/// Write bytes into the upload dir under a random name. Returns the path.
pub(crate) fn store_upload(bytes: &[u8], ext: &str) -> Result<PathBuf, String> {
    if !ext_ok(ext) {
        return Err(format!("unsupported audio type: {ext}"));
    }
    if bytes.is_empty() {
        return Err("empty recording".into());
    }
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Err(format!("recording is larger than {} MB", MAX_UPLOAD_BYTES / (1024 * 1024)));
    }
    let dir = upload_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir upload dir: {e}"))?;
    let nonce: u64 = rand::random();
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let p = dir.join(format!("rec-{secs}-{nonce:016x}.{ext}"));
    fs::write(&p, bytes).map_err(|e| format!("write recording: {e}"))?;
    Ok(p)
}

// ── Local backends ────────────────────────────────────────────────────

/// First binary among `names` found on PATH or in the usual Homebrew /
/// user-local dirs (the app's own PATH is minimal when launched from Finder).
/// Shared with webui.rs, which locates cloudflared the same way.
pub(crate) fn find_bin(names: &[&str]) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"] {
        dirs.push(PathBuf::from(d));
    }
    if let Ok(home) = std::env::var("HOME") {
        dirs.push(PathBuf::from(&home).join(".local").join("bin"));
        dirs.push(PathBuf::from(&home).join(".prevail").join("bin"));
    }
    for name in names {
        for d in &dirs {
            let p = d.join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// A ggml whisper model: PREVAIL_WHISPER_MODEL wins, else the first
/// ggml-*.bin in the places brew / the whisper.cpp download script put them.
fn whisper_model() -> Option<PathBuf> {
    if let Ok(m) = std::env::var("PREVAIL_WHISPER_MODEL") {
        let p = PathBuf::from(m);
        if p.is_file() {
            return Some(p);
        }
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let dirs = [
        format!("{home}/.prevail/models"),
        format!("{home}/.cache/whisper"),
        format!("{home}/.local/share/whisper-cpp/models"),
        "/opt/homebrew/share/whisper-cpp/models".to_string(),
        "/opt/homebrew/opt/whisper-cpp/share/whisper-cpp/models".to_string(),
        "/usr/local/share/whisper-cpp/models".to_string(),
    ];
    for d in dirs {
        let Ok(it) = fs::read_dir(&d) else { continue };
        let mut found: Vec<PathBuf> = it
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                let n = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                n.starts_with("ggml-") && n.ends_with(".bin")
            })
            .collect();
        // Stable pick across runs: smallest name first (ggml-base before
        // ggml-large), which also tends to be the fastest model.
        found.sort();
        if let Some(p) = found.into_iter().next() {
            return Some(p);
        }
    }
    None
}

/// whisper.cpp wants 16 kHz mono PCM; Apple's AVFoundation (behind `hear`)
/// can't open webm/ogg at all. ffmpeg bridges both when it is installed.
fn to_wav(src: &Path) -> Result<PathBuf, String> {
    let ffmpeg = find_bin(&["ffmpeg"]).ok_or_else(|| "ffmpeg is not installed (brew install ffmpeg)".to_string())?;
    let out = src.with_extension("wav");
    let st = std::process::Command::new(ffmpeg)
        .args(["-y", "-loglevel", "error", "-i"])
        .arg(src)
        .args(["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"])
        .arg(&out)
        .output()
        .map_err(|e| format!("run ffmpeg: {e}"))?;
    if !st.status.success() {
        return Err(format!("ffmpeg: {}", String::from_utf8_lossy(&st.stderr).trim()));
    }
    Ok(out)
}

fn run_whisper(bin: &Path, model: &Path, wav: &Path) -> Result<String, String> {
    let out = std::process::Command::new(bin)
        .arg("-m").arg(model)
        .arg("-f").arg(wav)
        .args(["--no-timestamps", "--no-prints", "-l", "auto"])
        .output()
        .map_err(|e| format!("run whisper: {e}"))?;
    if !out.status.success() {
        return Err(format!("whisper: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(clean_transcript(&String::from_utf8_lossy(&out.stdout)))
}

fn run_hear(bin: &Path, audio: &Path) -> Result<String, String> {
    // -d forces on-device recognition (never Apple's servers); -i reads a file.
    let out = std::process::Command::new(bin)
        .args(["-d", "-i"])
        .arg(audio)
        .output()
        .map_err(|e| format!("run hear: {e}"))?;
    if !out.status.success() {
        return Err(format!("hear: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(clean_transcript(&String::from_utf8_lossy(&out.stdout)))
}

/// Collapse a CLI transcript into one paragraph: whisper prints one segment per
/// line, `hear` may echo progress lines; blank lines and [BLANK_AUDIO] markers
/// carry nothing the user said.
pub(crate) fn clean_transcript(raw: &str) -> String {
    raw.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('[') )
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Serialize, Clone)]
pub struct Transcript {
    pub text: String,
    /// Which local engine produced it ("whisper.cpp" | "apple-speech").
    pub backend: String,
}

fn transcribe_file(src: &Path) -> Result<Transcript, String> {
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let mut scratch: Vec<PathBuf> = Vec::new();
    let result = (|| {
        if let (Some(bin), Some(model)) = (find_bin(&["whisper-cli", "whisper-cpp", "whisper"]), whisper_model()) {
            let wav = if ext == "wav" { src.to_path_buf() } else { let w = to_wav(src)?; scratch.push(w.clone()); w };
            return run_whisper(&bin, &model, &wav).map(|text| Transcript { text, backend: "whisper.cpp".into() });
        }
        if let Some(bin) = find_bin(&["hear"]) {
            let audio = if matches!(ext.as_str(), "mp4" | "m4a" | "wav" | "mp3") {
                src.to_path_buf()
            } else {
                let w = to_wav(src)?;
                scratch.push(w.clone());
                w
            };
            return run_hear(&bin, &audio).map(|text| Transcript { text, backend: "apple-speech".into() });
        }
        Err("No local transcriber on this Mac. Install one: `brew install whisper-cpp` plus a ggml model in ~/.prevail/models, or `brew install hear` for Apple's on-device speech.".into())
    })();
    for p in scratch {
        let _ = fs::remove_file(p);
    }
    result
}

/// Transcribe a recording on this Mac. Exactly one of `path` (a file the WebUI
/// uploaded to /api/upload-audio) or `base64` + `ext` (the Tauri window) is
/// given. The recording is deleted afterwards either way.
#[tauri::command]
pub(crate) async fn transcribe_audio(path: Option<String>, base64: Option<String>, ext: Option<String>) -> Result<Transcript, String> {
    let src: PathBuf = match (path, base64) {
        (Some(p), _) => {
            let p = PathBuf::from(p);
            // Deny-by-default: only our own staged uploads, never a vault or
            // system file a remote client names.
            if !is_upload_path(&p) || !p.is_file() {
                return Err("not an uploaded recording".into());
            }
            p
        }
        (None, Some(b64)) => {
            use ::base64::Engine as _;
            let ext = ext.unwrap_or_else(|| "webm".into()).to_ascii_lowercase();
            let ext: &'static str = match ext.as_str() {
                "webm" => "webm", "mp4" | "m4a" => "mp4", "ogg" => "ogg", "wav" => "wav", "mp3" => "mp3",
                other => return Err(format!("unsupported audio type: {other}")),
            };
            // Base64 inflates 4/3, so bound the encoded size before decoding.
            if b64.len() > MAX_UPLOAD_BYTES * 4 / 3 + 4 {
                return Err(format!("recording is larger than {} MB", MAX_UPLOAD_BYTES / (1024 * 1024)));
            }
            let bytes = ::base64::engine::general_purpose::STANDARD.decode(b64.trim()).map_err(|e| format!("decode audio: {e}"))?;
            store_upload(&bytes, ext)?
        }
        (None, None) => return Err("nothing to transcribe".into()),
    };
    // Spawning whisper/ffmpeg blocks for seconds; keep it off the async pool.
    let out = tauri::async_runtime::spawn_blocking(move || {
        let r = transcribe_file(&src);
        let _ = fs::remove_file(&src);
        r
    })
    .await
    .map_err(|e| format!("transcribe task: {e}"))?;
    out
}

/// File a transcript into the current domain as a voice note: one line in the
/// domain journal (memory/journal.md) and an entry in the shared Notes store
/// (build/notes.json, the same document Quick Capture writes) tagged
/// source "voice". Returns the note id. Exposed to the WebUI because the
/// generic read/write_text_file path Quick Capture uses is desktop-only.
#[tauri::command]
pub(crate) fn voice_note_capture(vault: String, domain: Option<String>, text: String) -> Result<String, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("nothing to save".into());
    }
    let domain = domain.filter(|d| !d.is_empty());
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    let (y, m, d, hh, mm, _ss) = crate::secs_to_ymdhms(now.as_secs() as i64);
    let stamp = format!("{y:04}-{m:02}-{d:02} {hh:02}:{mm:02}");
    // Journal line first: it is the per-domain record and the cheaper write
    // (journal_append resolves the domain dir safely, unsafe names fall back
    // to the vault root).
    crate::intents::journal_append(vault.clone(), domain.clone(), format!("- {stamp} [voice] {text}"))?;

    let dir = PathBuf::from(&vault).join("build");
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir build: {e}"))?;
    let p = dir.join("notes.json");
    let mut list: Vec<serde_json::Value> = crate::read_to_string_retry(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let id = format!("n_{:x}_{:x}", now.as_millis(), rand::random::<u32>());
    let title = match &domain {
        Some(d) => format!("Voice note ({d})"),
        None => "Voice note".to_string(),
    };
    list.insert(0, serde_json::json!({
        "id": id,
        "title": title,
        "body": text,
        "updated": now.as_millis() as u64,
        "source": "voice",
        "domain": domain,
    }));
    let json = serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?;
    fs::write(&p, engine::maybe_encrypt(&p, &json)).map_err(|e| format!("write notes: {e}"))?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upload_cap_and_types() {
        assert_eq!(check_upload(Some(1024), "audio/webm;codecs=opus"), Ok("webm"));
        assert_eq!(check_upload(Some(1024), "audio/mp4"), Ok("mp4"));
        assert_eq!(check_upload(None, "audio/wav"), Ok("wav"));
        // One byte over the cap is refused with 413 before any body is read.
        assert_eq!(check_upload(Some(MAX_UPLOAD_BYTES + 1), "audio/webm").map_err(|e| e.0), Err(413));
        assert_eq!(check_upload(Some(MAX_UPLOAD_BYTES), "audio/webm"), Ok("webm"));
        assert_eq!(check_upload(Some(0), "audio/webm").map_err(|e| e.0), Err(400));
        assert_eq!(check_upload(Some(10), "text/html").map_err(|e| e.0), Err(415));
        assert_eq!(check_upload(Some(10), "").map_err(|e| e.0), Err(415));
    }

    #[test]
    fn store_upload_rejects_oversize_and_stages_in_upload_dir() {
        assert!(store_upload(&vec![0u8; MAX_UPLOAD_BYTES + 1], "webm").is_err());
        assert!(store_upload(&[], "webm").is_err());
        assert!(store_upload(&[1, 2, 3], "exe").is_err());
        let p = store_upload(&[1, 2, 3], "webm").expect("stored");
        assert!(is_upload_path(&p));
        assert!(p.starts_with(upload_dir()));
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn only_staged_uploads_are_transcribable() {
        assert!(!is_upload_path(Path::new("/etc/passwd")));
        assert!(!is_upload_path(&upload_dir().join("../../etc/passwd")));
        assert!(!is_upload_path(&upload_dir().join("notes.json")));
        assert!(!is_upload_path(&upload_dir().join(".hidden.webm")));
        assert!(is_upload_path(&upload_dir().join("rec-1-abc.webm")));
    }

    #[test]
    fn transcript_is_one_clean_paragraph() {
        assert_eq!(clean_transcript(" Book the dentist.\n\n[BLANK_AUDIO]\n for   Tuesday \n"), "Book the dentist. for Tuesday");
    }

    /// The real pipeline, end to end, on synthesized speech: `say` makes the
    /// audio, ffmpeg encodes it the way a phone would (opus in webm), and the
    /// same transcribe_file the command calls has to read words back out. This
    /// is what catches a wrong whisper/hear flag, which no amount of unit
    /// testing around it would.
    ///
    /// It SKIPS (rather than fails) when the machine has no transcriber or no
    /// ffmpeg, so CI and a fresh checkout stay green; installing whisper-cpp
    /// plus a model, which is what voice needs anyway, turns it on.
    #[test]
    fn speech_goes_in_and_words_come_out() {
        let have_engine = (find_bin(&["whisper-cli", "whisper-cpp", "whisper"]).is_some() && whisper_model().is_some())
            || find_bin(&["hear"]).is_some();
        if !have_engine || find_bin(&["ffmpeg"]).is_none() || find_bin(&["say"]).is_none() {
            eprintln!("skipping: no local transcriber, ffmpeg or say on this machine");
            return;
        }
        let dir = std::env::temp_dir().join(format!("prevail-voice-test-{:x}", rand::random::<u64>()));
        fs::create_dir_all(&dir).expect("mkdir");
        let aiff = dir.join("src.aiff");
        let webm = dir.join("phone.webm");
        let ok = std::process::Command::new("say")
            .arg("-o").arg(&aiff).arg("Book the dentist for Tuesday morning")
            .status().map(|s| s.success()).unwrap_or(false);
        assert!(ok, "`say` could not synthesize the test audio");
        let ok = std::process::Command::new(find_bin(&["ffmpeg"]).unwrap())
            .args(["-y", "-loglevel", "error", "-i"]).arg(&aiff)
            .args(["-c:a", "libopus"]).arg(&webm)
            .status().map(|s| s.success()).unwrap_or(false);
        assert!(ok, "ffmpeg could not encode the phone-format recording");

        let out = transcribe_file(&webm).expect("transcription failed");
        let text = out.text.to_ascii_lowercase();
        let _ = fs::remove_dir_all(&dir);
        assert!(text.contains("dentist"), "transcript lost the words: {:?} (backend {})", out.text, out.backend);
    }
}
