// Usage accounting — a thin client over the engine, which OWNS the ledger
// (<vault>/_meta/usage.jsonl), the pricing table, and the aggregation. The
// desktop records each turn through `prevail usage record` and reads roll-ups
// through `prevail usage summary`, so CLI / TUI / Telegram / desktop all report
// identical numbers from one source. Extracted from lib.rs.
//
// `day` is a pre-formatted local YYYY-MM-DD supplied by the frontend so the
// backend needs no timezone/date math.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::engine;
use crate::read_to_string_retry;

#[derive(Serialize, Deserialize)]
pub(crate) struct UsageRecord {
    pub ts: i64,         // epoch ms when the turn closed
    pub day: String,     // local YYYY-MM-DD (frontend-formatted)
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub thread: Option<String>,
    pub cli: String,
    #[serde(default)]
    pub surface: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub input_tokens: Option<u64>,
    #[serde(default)]
    pub output_tokens: Option<u64>,
    #[serde(default)]
    pub cost_usd: Option<f64>,
    pub ok: bool,
    /// "estimated" when the counts are a character estimate (the engine's
    /// chat usage event says so); the engine then records them as estimates.
    #[serde(default)]
    pub token_source: Option<String>,
}

// Translate a desktop UsageRecord into the engine's `usage record` stdin input
// (camelCase RecordUsageInput). The engine computes day + cost from its own
// pricing table, so we pass tokens, not cost.
pub(crate) fn usage_record_payload(r: &UsageRecord) -> serde_json::Value {
    serde_json::json!({
        "session": r.thread.clone().unwrap_or_else(|| "desktop".into()),
        "domain": r.domain,
        "surface": r.surface.clone().unwrap_or_else(|| "chat".into()),
        "cli": r.cli,
        "model": r.model,
        "inputTokens": r.input_tokens.unwrap_or(0),
        "outputTokens": r.output_tokens.unwrap_or(0),
        "billed": false,
        "ts": r.ts,
        "tokenSource": r.token_source,
    })
}

#[tauri::command(async)]
pub(crate) fn usage_append(vault: String, record: UsageRecord) -> Result<(), String> {
    let _serial = crate::vaultio::serial();
    migrate_legacy_usage(&vault);
    let payload = usage_record_payload(&record).to_string();
    engine::run_engine_json_stdin(&["--vault", &vault, "usage", "record"], &payload)?;
    Ok(())
}

#[derive(Serialize, Default, Clone)]
pub(crate) struct UsageBucket {
    pub key: String,
    pub turns: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
}

#[derive(Serialize, Default)]
pub(crate) struct UsageSummary {
    pub total_turns: u64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cost_usd: f64,
    pub by_cli: Vec<UsageBucket>,
    pub by_model: Vec<UsageBucket>,
    pub by_domain: Vec<UsageBucket>,
    pub by_day: Vec<UsageBucket>,
}

// The engine's bucket shape (calls/est_cost_usd) — mapped to the desktop's
// (turns/cost_usd) so the existing frontend dashboard is untouched.
#[derive(Deserialize, Default)]
pub(crate) struct EngBucket {
    pub key: String,
    pub calls: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub est_cost_usd: f64,
}
#[derive(Deserialize, Default)]
pub(crate) struct EngSummary {
    pub total: EngBucket,
    pub by_day: Vec<EngBucket>,
    pub by_cli: Vec<EngBucket>,
    pub by_model: Vec<EngBucket>,
    pub by_domain: Vec<EngBucket>,
}

impl From<EngBucket> for UsageBucket {
    fn from(e: EngBucket) -> Self {
        UsageBucket {
            key: e.key,
            turns: e.calls,
            input_tokens: e.input_tokens,
            output_tokens: e.output_tokens,
            cost_usd: e.est_cost_usd,
        }
    }
}

pub(crate) fn map_eng_summary(e: EngSummary) -> UsageSummary {
    UsageSummary {
        total_turns: e.total.calls,
        total_input_tokens: e.total.input_tokens,
        total_output_tokens: e.total.output_tokens,
        total_cost_usd: e.total.est_cost_usd,
        by_cli: e.by_cli.into_iter().map(Into::into).collect(),
        by_model: e.by_model.into_iter().map(Into::into).collect(),
        by_domain: e.by_domain.into_iter().map(Into::into).collect(),
        by_day: e.by_day.into_iter().map(Into::into).collect(),
    }
}

// Read a roll-up from the engine, optionally scoped to one domain.
fn usage_summary_inner(vault: &str, domain: Option<&str>) -> Result<UsageSummary, String> {
    migrate_legacy_usage(vault);
    let mut args: Vec<&str> = vec!["--vault", vault, "usage", "summary"];
    if let Some(d) = domain {
        args.push("--domain");
        args.push(d);
    }
    let v = engine::run_engine_json(&args)?;
    let eng: EngSummary =
        serde_json::from_value(v).map_err(|e| format!("parse usage summary: {e}"))?;
    Ok(map_eng_summary(eng))
}

/// Raw usage entries (bounded personal volume) so the desktop can build a rich
/// multi-dimension dashboard client-side. Returns the engine's `usage entries`
/// JSON verbatim.
#[tauri::command(async)]
pub(crate) fn usage_entries(vault: String) -> Result<serde_json::Value, String> {
    let out = engine::run_engine_json(&["--vault", &vault, "usage", "entries", "--json"])?;
    Ok(out)
}

/// Every AI tool's usage this month, read by the engine from the tools' own
/// local records on every machine (tokens, API-equivalent cost, what the
/// tool reported, what is paid). `month` is YYYY-MM; omitted = this month.
#[tauri::command(async)]
pub(crate) fn engine_ai_usage(vault: String, month: Option<String>) -> Result<serde_json::Value, String> {
    let mut args: Vec<&str> = vec!["--vault", &vault, "ai", "usage", "--json"];
    let m = month.unwrap_or_default();
    if !m.is_empty() {
        if !(m.len() == 7 && m.as_bytes()[4] == b'-' && m.chars().filter(|c| c.is_ascii_digit()).count() == 6) {
            return Err(format!("month must be YYYY-MM: {m}"));
        }
        args.push("--month");
        args.push(&m);
    }
    engine::run_engine_json(&args)
}

/// Metrics (engine `prevail metrics`): this week at a glance, every metric
/// with its tier, coverage and sources, or the rhythm plot's dots. The engine
/// reads the per-host events and the vault's own files and computes them.
#[tauri::command(async)]
pub(crate) fn engine_metrics(vault: String, view: String, week: Option<String>) -> Result<serde_json::Value, String> {
    let sub = match view.as_str() {
        "glance" | "list" | "rhythm" | "sources" => view.as_str(),
        _ => return Err(format!("unknown metrics view: {view}")),
    };
    let mut args: Vec<&str> = vec!["--vault", &vault, "metrics", sub, "--json"];
    let w = week.unwrap_or_default();
    if sub == "glance" && !w.is_empty() {
        if !(w.len() == 10 && w.as_bytes()[4] == b'-' && w.as_bytes()[7] == b'-') {
            return Err(format!("week must be YYYY-MM-DD: {w}"));
        }
        args.push("--week");
        args.push(&w);
    }
    engine::run_engine_json(&args)
}

#[tauri::command(async)]
pub(crate) fn usage_summary(vault: String) -> Result<UsageSummary, String> {
    usage_summary_inner(&vault, None)
}

/// Domain-scoped roll-up for the per-domain Usage tab.
#[tauri::command(async)]
pub(crate) fn usage_summary_domain(vault: String, domain: String) -> Result<UsageSummary, String> {
    usage_summary_inner(&vault, Some(&domain))
}

/// X4 (budgets): real month-to-date spend for the budget meter, optionally scoped
/// to one domain. Sums the by-day cost buckets whose day is in the current
/// calendar month. The cap itself is a user pref on the frontend; this is the
/// live "spent" side that was previously only an estimate. Fills the gap the
/// budget UI was calling a nonexistent command for.
#[tauri::command(async)]
pub(crate) fn engine_budget_status(
    vault: String,
    domain: Option<String>,
) -> Result<serde_json::Value, String> {
    let summary = usage_summary_inner(&vault, domain.as_deref())?;
    let month_prefix = &crate::tasks::today_ymd()[..7]; // "YYYY-MM"
    let spent: f64 = summary
        .by_day
        .iter()
        .filter(|b| b.key.starts_with(month_prefix))
        .map(|b| b.cost_usd)
        .sum();
    Ok(serde_json::json!({
        "spent_usd": spent,
        "month": month_prefix,
        "total_cost_usd": summary.total_cost_usd,
    }))
}

// One-time migration: fold a legacy desktop ledger (<vault>/usage/usage.ndjson)
// into the engine ledger (<vault>/_meta/usage.jsonl) so existing users keep
// their history. Guarded by a marker file; best-effort and idempotent. The two
// ledgers were historically disjoint (desktop turns vs engine turns), so a
// straight append cannot double-count.
pub(crate) fn migrate_legacy_usage(vault: &str) {
    let legacy = Path::new(vault).join("usage").join("usage.ndjson");
    let marker = Path::new(vault).join("usage").join(".migrated-to-engine");
    if marker.exists() || !legacy.exists() {
        return;
    }
    let Ok(raw) = read_to_string_retry(&legacy) else { return };
    let mut out = String::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(r) = serde_json::from_str::<UsageRecord>(line) else { continue };
        let entry = serde_json::json!({
            "ts": r.ts,
            "day": r.day,
            "session": r.thread.clone().unwrap_or_else(|| "desktop".into()),
            "domain": r.domain,
            "surface": "chat",
            "cli": r.cli,
            "model": r.model.clone().unwrap_or_default(),
            "input_tokens": r.input_tokens.unwrap_or(0),
            "output_tokens": r.output_tokens.unwrap_or(0),
            "token_source": "reported",
            "est_cost_usd": r.cost_usd.unwrap_or(0.0),
            "billed": false,
        });
        out.push_str(&entry.to_string());
        out.push('\n');
    }
    let meta = crate::paths::build_root(vault).join("_meta");
    if fs::create_dir_all(&meta).is_err() {
        return;
    }
    let engine_ledger = meta.join("usage.jsonl");
    use std::io::Write;
    if let Ok(mut f) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&engine_ledger)
    {
        let _ = f.write_all(out.as_bytes());
        // Write the marker only after a successful append.
        let _ = fs::write(&marker, "migrated\n");
    }
}
