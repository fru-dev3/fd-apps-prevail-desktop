// Desktop bridge for the Domain Loops runner.
use serde_json::Value;
//
// The loop-running logic lives in the engine (daemon-loops.ts) so there is a
// single source of truth. This command just triggers one pass on demand from
// the UI ("Run loops now"): it shells to the bundled engine with
// `--vault <path> daemon --loops --once`, which advances every due loop and
// rewrites their actions. The long-running background daemon is the same engine
// command without `--once`.
use crate::engine;

#[tauri::command]
pub(crate) async fn loops_run_once(
    vault: String,
    provider: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut args: Vec<String> = vec![
            "--vault".into(),
            vault,
            "daemon".into(),
            "--loops".into(),
            "--once".into(),
        ];
        if let Some(p) = provider {
            if !p.trim().is_empty() {
                args.push("--cli".into());
                args.push(p);
            }
        }
        if let Some(m) = model {
            if !m.trim().is_empty() {
                args.push("--model".into());
                args.push(m);
            }
        }
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        engine::run_engine_raw(&refs)
    })
    .await
    .map_err(|e| format!("loops task failed: {e}"))?
}

/// Mint a single-use approval token bound to (domain, action). The UI calls this
/// at the moment the user approves, then passes the token to loop_execute_action.
/// (C1/O16 — backend-verified approval, not UI trust.)
#[tauri::command(async)]
pub(crate) fn loop_request_approval(domain: String, action: String) -> String {
    let _serial = crate::vaultio::serial();
    crate::approval::mint(&crate::approval::action_payload(&domain, &action))
}

/// Execute ONE user-approved loop action for real, via the engine agent's tools
/// and connectors (`daemon --loops --exec`). Returns the agent's report of what
/// it did. Requires a valid single-use `approval` token bound to this exact
/// (domain, action) — minted by loop_request_approval — so a UI bug or injected
/// invoke can't drive a consequential action without real approval (C1/O16).
#[tauri::command]
pub(crate) async fn loop_execute_action(
    vault: String,
    domain: String,
    action: String,
    approval: String,
    provider: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    // Single authorization checkpoint (C1): the broker verifies the approval token
    // is valid, single-use, and bound to this exact (domain, action).
    crate::broker::authorize_action(&domain, &action, &approval)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut args: Vec<String> = vec![
            "--vault".into(),
            vault,
            "daemon".into(),
            "--loops".into(),
            "--exec".into(),
            "--domain".into(),
            domain,
            "--action".into(),
            action,
        ];
        if let Some(p) = provider {
            if !p.trim().is_empty() {
                args.push("--cli".into());
                args.push(p);
            }
        }
        if let Some(m) = model {
            if !m.trim().is_empty() {
                args.push("--model".into());
                args.push(m);
            }
        }
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        engine::run_engine_raw(&refs)
    })
    .await
    .map_err(|e| format!("loop exec task failed: {e}"))?
}

/// Drop one queued pending approval from a domain's `_loops_runtime.json`
/// (matched by loop id + exact text). Used by the cross-domain Decision Inbox to
/// dismiss/clear an item after it's been approved or declined. Re-reads fresh before writing so a
/// concurrent daemon pass isn't clobbered. No-op (Ok) if nothing matches.
#[tauri::command(async)]
pub(crate) fn loop_pending_drop(
    vault: String,
    domain: String,
    loop_id: String,
    text: String,
) -> Result<(), String> {
    let _serial = crate::vaultio::serial();
    let path = crate::paths::domain_dir_pub(&vault, &domain).join("_loops_runtime.json");
    let raw = match crate::read_to_string_retry(&path) {
        Ok(s) => s,
        Err(_) => return Ok(()), // no runtime yet → nothing to drop
    };
    let mut doc: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if let Some(entry) = doc.get_mut("loops").and_then(|l| l.get_mut(&loop_id)) {
        if let Some(pending) = entry.get_mut("pending").and_then(|p| p.as_array_mut()) {
            pending.retain(|p| p.get("text").and_then(|v| v.as_str()) != Some(text.as_str()));
        }
    }
    let body = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    crate::vaultio::write_atomic(&path, &body).map_err(|e| e.to_string())
}
