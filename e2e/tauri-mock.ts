// Fake Tauri IPC for the smoke ring: window.__TAURI_INTERNALS__ is defined
// BEFORE the app loads, so bridge.ts takes the desktop path and every invoke
// resolves from the fixture table below. Unknown commands resolve null (the
// app's callers uniformly .catch or tolerate empties). Every call is recorded
// on window.__invokeLog so tests can assert what a button actually invoked.
import type { Page } from "@playwright/test";

export const FIXTURES: Record<string, unknown> = {
  // boot / shell
  vault_status: { configured: true, path: "/tmp/smoke-vault", locked: false },
  // Boot spine: production mode + config.json vault is THE source of truth.
  engine_appmode_get: { mode: "production" },
  engine_config_vault: "/tmp/smoke-vault",
  vault_exists: true,
  bootstrap_vault: "/tmp/smoke-vault",
  engine_vault_status: { encrypted: false, unlocked: true },
  engine_vault_migrate_v4: { ok: true },
  bunker_status: { enabled: false, network_blocked: false, web_blocked: false, cloud_blocked: false, local_available: true },
  vault_lock_status: { enabled: true },
  machine_role_get: "hub",
  email_policy_get: { policy: "draft-others" },
  egress_guard_get: { mode: "on" },
  life_readiness: { life_readiness: 62, domains: [{ name: "career", score: 70 }, { name: "health", score: 54 }] },
  engine_score_all: { life_readiness: 62, computed_at: "2026-09-11", domains: [{ domain: "career", score: 70 }, { domain: "health", score: 54 }] },
  // scan_vault is THE domain loader (engine_domains was a wrong guess).
  scan_vault: [
    { name: "career", path: "/tmp/smoke-vault/career", has_state: true, state_preview: null },
    { name: "health", path: "/tmp/smoke-vault/health", has_state: true, state_preview: null },
  ],
  detect_clis: [{ id: "claude", label: "Claude Code", available: true, versions: [] }],
  engine_apps_list: [
    { id: "posthog", title: "PostHog", status: "authorized", domains: ["career"], integration: "mcp" },
    { id: "google-personal", title: "Google", status: "authorized", domains: ["health"], integration: "manual", account: { label: "personal", address: "me@example.com" } },
  ],
  // Needs You
  decisions_pending: [],
  engine_gws_pending_list: [
    { id: "gws_smoke1", domain: "career", summary: "Gmail: send", args: ["gmail", "+send", "--to", "x@y.com"], ts: Date.now() - 60000 },
  ],
  engine_acts_pending: [
    { id: "act_smoke1", domain: "business", summary: "PayPal: create_invoice", tool: "mcp__claude_ai_PayPal__create_invoice", argsJson: "{\"recipient_email\":\"client@corp.com\"}", categories: ["salary or compensation details"], ts: Date.now() - 30000 },
  ],
  loop_request_approval: "smoke-approval-token",
  engine_acts_approve: { ok: true },
  engine_acts_deny: { ok: true },
  engine_acts_rules: [{ tool: "mcp__claude_ai_Foo__list_items", domain: "career", ts: Date.now() - 86400000 }],
  engine_acts_rule_revoke: { ok: true },
  // Waiting for you: the one polled source for the status marks.
  engine_waiting: {
    total: 2,
    items: [
      { kind: "act", id: "act_smoke1", domain: "career", summary: "PayPal: create_invoice", since: Date.now() - 30000 },
      { kind: "gws", id: "gws_smoke1", domain: "career", summary: "Gmail: send", since: Date.now() - 60000 },
    ],
  },
  engine_schedule_list: [],
  engine_schedule_thread_add: { id: "s_foo", name: "Send the foo report", cron: "0 8 * * *", enabled: true, last_run: null, thread: { domain: "general", session: "foo-thread" }, prompt: "Send the foo report" },
  engine_gws_approve: { ok: true, output: "done" },
  // apps panel: the connectors mirrored from the AI runtimes
  apps_mirror_list: {
    generated_at: 1783000000,
    runtimes: [{ runtime: "claude", installed: true, syncable: true, signin_hint: "", count: 2 }],
    apps: [
      { id: "claude:foo", name: "Foo", runtime: "claude", server: "foo", status: "connected", signin_hint: "", syncable: true, domains: ["career"] },
      { id: "claude:bar", name: "Bar", runtime: "claude", server: "bar", status: "needs_auth", signin_hint: "Sign in to Bar in Claude", syncable: true, domains: [] },
    ],
  },
  harness_connections_scan: { connections: [{ harness: "claude", name: "PostHog", health: "healthy" }] },
  ingestion_connector_catalog: { apps: [] },
  ingestion_connector_logos: {},
  discover_runtime_connectors: [],
  engine_list_archived: [],
  list_threads: [],
  intents_read_all: [
    { kind: "intent", ts: 1783200000000, message: "What's my net worth?", cli: "claude", model: "opus", domain: "wealth", surface: "chat", host: "mbp" },
    { kind: "intent", ts: 1783100000000, message: "What's my net worth?", cli: "claude", model: "opus", domain: "wealth", surface: "chat", host: "mbp" },
    { kind: "intent", ts: 1783000000000, message: "Plan my week", cli: "codex", model: "gpt", domain: "career", surface: "council", host: "mini" },
  ],
  capture_prompts_read: [],
  intents_distilled_read: { generated_ts: 1783200000, source_count: 3, intents: [{ title: "Track net worth", goal: "Know my finances", domains: ["wealth"], prompt_ts: [1783200000000, 1783100000000] }] },
  read_domain_ideal: "# Wealth\nFinancial security with a 6-month runway.",
  engine_ai_usage: {
    month: "2026-10", hosts: ["foo-laptop", "bar-hub"], price_snapshot: "2026-10-02",
    total: { tokens: 125_000_000, usd_api: 84.5 },
    by_tool: [
      { key: "claude", tokens: 120_000_000, usd_api: 80.25, usd_reported: 79.1, sessions: 40, paid_monthly: 20, value_multiple: 4 },
      { key: "codex", tokens: 5_000_000, usd_api: 4.25, usd_reported: 0, sessions: 6 },
      { key: "wispr", tokens: 0, usd_api: 0, usd_reported: 0, sessions: 0, prompts: 31 },
    ],
    paid_monthly: 20, value_multiple: 4.2,
  },
  usage_entries: [
    { ts: 1783200000000, day: "2026-07-05", session: "s1", domain: "career", surface: "chat", cli: "claude", model: "opus", input_tokens: 1200, output_tokens: 800, est_cost_usd: 0.12, host: "mbp" },
    { ts: 1783120000000, day: "2026-07-04", session: "s2", domain: "wealth", surface: "council", cli: "codex", model: "gpt", input_tokens: 400, output_tokens: 600, est_cost_usd: 0.03, host: "mini" },
    { ts: 1783040000000, day: "2026-07-03", session: "s3", domain: "career", surface: "benchmark", cli: "claude", model: "sonnet", input_tokens: 900, output_tokens: 300, est_cost_usd: 0.05, host: "mbp" },
  ],
};

// `latencyMs` delays every non-plugin answer, standing in for the engine's
// per-call subprocess cost (the perf budgets run with 150 ms).
export async function mockTauri(page: Page, overrides: Record<string, unknown> = {}, opts: { latencyMs?: number } = {}): Promise<void> {
  const fixtures = { ...FIXTURES, ...overrides };
  await page.addInitScript(([fx, latency]: [Record<string, unknown>, number]) => {
    // A configured vault is the app's boot gate (first-launch onboarding
    // otherwise): the desktop reads it from localStorage.
    localStorage.setItem("prevail.desktop.vaultPath", "/tmp/smoke-vault");
    localStorage.setItem("prevail.onboarding.seen", "1");
    localStorage.setItem("prevail.onboarding.encryptOffered", "1");
    // The sidebar's sections start collapsed for a new user; the ring opens
    // them (once, so a test's own toggles stick) unless a test asks for the
    // fresh state with the __fresh_sidebar fixture.
    if (!fx.__fresh_sidebar) (window as unknown as { __sidebarOpen?: string[] }).__sidebarOpen = ["work", "activities", "kind.projects", "domains"];
    const log: Array<{ cmd: string; args: unknown }> = [];
    (window as unknown as Record<string, unknown>).__invokeLog = log;
    // The live fixture table, so a test can change what a command answers
    // mid-flow (a status that flips after an action) via page.evaluate.
    (window as unknown as Record<string, unknown>).__fixtures = fx;
    let cb = 0;
    // Event listeners, so a test can play an engine stream: window.__emit(
    // "engine-chat:line", payload) calls every handler listening for it.
    const cbs: Record<number, (v: unknown) => void> = {};
    const listeners: Record<string, number[]> = {};
    (window as unknown as Record<string, unknown>).__emit = (event: string, payload: unknown) => {
      for (const id of listeners[event] ?? []) cbs[id]?.({ event, id, payload });
    };
    // The event plugin's unlisten path reaches this internal directly.
    (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      transformCallback: (fn?: (v: unknown) => void) => { const id = ++cb; if (fn) cbs[id] = fn; return id; },
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      invoke: (cmd: string, args: unknown) => {
        log.push({ cmd, args });
        // Tauri plugin internals: event listeners return an id, everything
        // else falls through to fixtures.
        // A fixture wins, so a test can answer a plugin call (a file picker).
        const later = (v: unknown) => (latency > 0 ? new Promise((r) => setTimeout(() => r(v), latency)) : Promise.resolve(v));
        if (cmd in fx) {
          const v = fx[cmd];
          return later(typeof v === "function" ? (v as (a: unknown) => unknown)(args) : v);
        }
        if (cmd === "plugin:event|listen") {
          const a = args as { event?: string; handler?: number };
          if (a?.event && typeof a.handler === "number") (listeners[a.event] ??= []).push(a.handler);
          return Promise.resolve(a?.handler ?? ++cb);
        }
        if (cmd.startsWith("plugin:event|")) return Promise.resolve(++cb);
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);
        return later(null);
      },
    };
  }, [fixtures, opts.latencyMs ?? 0] as [Record<string, unknown>, number]);
}

export async function invokedCommands(page: Page): Promise<string[]> {
  return page.evaluate(() => ((window as unknown as { __invokeLog: Array<{ cmd: string }> }).__invokeLog ?? []).map((e) => e.cmd));
}
