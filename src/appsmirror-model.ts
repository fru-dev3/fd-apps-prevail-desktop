// Apps mirror: shapes and pure helpers for the connectors the user already
// signed into in their AI runtimes. The engine (`prevail apps ...`) owns the
// data; this module only groups, labels and decides what the UI may offer.

export type ToolKind = "read" | "write" | "send" | "money";
export interface MirrorTool {
  name: string;
  full_name: string;
  kind: ToolKind;
  sync_allowed: boolean;
  chat_default: boolean;
}
export type Schedule = "daily" | "weekly" | "manual";
export interface Recipe {
  prompt: string;
  domains: string[];
  schedule: Schedule;
  read_tools: string[];
  model?: string;
  updated_at?: number;
}
export type RuntimeId = "claude" | "codex" | "gemini" | "agy";
export type MirrorStatus = "connected" | "needs_auth" | "disabled" | "error";
export interface MirrorApp {
  id: string;
  name: string;
  runtime: RuntimeId;
  server: string;
  url?: string;
  command?: string;
  status: MirrorStatus;
  status_detail?: string;
  signin_hint: string;
  syncable: boolean;
  tools?: MirrorTool[];
  tools_checked_at?: number;
  domains: string[];
  recipe?: Recipe | null;
  last_sync?: number | null;
  last_error?: string | null;
  records_last_sync?: number;
}
export interface RuntimeInfo {
  runtime: RuntimeId;
  installed: boolean;
  version?: string;
  syncable: boolean;
  signin_hint: string;
  error?: string;
  count: number;
}
export interface MirrorList {
  generated_at: number;
  runtimes: RuntimeInfo[];
  apps: MirrorApp[];
  error?: string;
}
export interface SyncResult { ok: boolean; id: string; records: number; files: number; error?: string }
export interface ArchiveResult {
  candidates: { id: string; reason: string }[];
  moved: { id: string; from: string; to: string }[];
  error?: string;
}

export const RUNTIME_ORDER: RuntimeId[] = ["claude", "codex", "gemini", "agy"];
export const RUNTIME_LABEL: Record<RuntimeId, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  agy: "Antigravity",
};
// The vendor key the shared ProviderMark knows each runtime by.
export const RUNTIME_MARK: Record<RuntimeId, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  agy: "antigravity",
};

export const CLAUDE_CONNECTORS_URL = "https://claude.ai/settings/connectors";

export interface RuntimeGroup {
  runtime: RuntimeId;
  label: string;
  info: RuntimeInfo | null;
  apps: MirrorApp[];
}

const STATUS_RANK: Record<MirrorStatus, number> = { connected: 0, needs_auth: 1, error: 2, disabled: 3 };

// One group per known runtime, in a fixed order, plus any runtime the engine
// reports that this build does not know yet (so nothing is silently dropped).
// Inside a group: connected first, then needs sign-in, errors, disabled; then
// by name.
export function groupByRuntime(list: MirrorList | null): RuntimeGroup[] {
  const runtimes = list?.runtimes ?? [];
  const apps = list?.apps ?? [];
  const ids: string[] = [...RUNTIME_ORDER];
  for (const r of runtimes) if (!ids.includes(r.runtime)) ids.push(r.runtime);
  for (const a of apps) if (!ids.includes(a.runtime)) ids.push(a.runtime);
  return ids.map((id) => {
    const rid = id as RuntimeId;
    const mine = apps
      .filter((a) => a.runtime === rid)
      .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name));
    return {
      runtime: rid,
      label: RUNTIME_LABEL[rid] ?? id.charAt(0).toUpperCase() + id.slice(1),
      info: runtimes.find((r) => r.runtime === rid) ?? null,
      apps: mine,
    };
  });
}

export type Tone = "ok" | "warn" | "muted" | "err";
export const STATUS_META: Record<MirrorStatus, { label: string; tone: Tone }> = {
  connected: { label: "Connected", tone: "ok" },
  needs_auth: { label: "Needs sign-in", tone: "warn" },
  disabled: { label: "Disabled", tone: "muted" },
  error: { label: "Error", tone: "err" },
};
export function statusMeta(s: MirrorStatus | string): { label: string; tone: Tone } {
  return STATUS_META[s as MirrorStatus] ?? { label: "Unknown", tone: "muted" };
}

// Sign-in help for an app that is not connected. Claude connectors are managed
// on claude.ai, so that is a link; the other runtimes sign in from their CLI,
// so that is a command to copy.
export function signinAction(app: MirrorApp): { kind: "link"; href: string } | { kind: "command"; command: string } | null {
  if (app.status === "connected") return null;
  if (app.runtime === "claude") return { kind: "link", href: CLAUDE_CONNECTORS_URL };
  const hint = (app.signin_hint || "").trim();
  if (!hint) return null;
  if (/^https?:\/\//i.test(hint)) return { kind: "link", href: hint };
  return { kind: "command", command: hint };
}

export type ToolBadge = { label: "Read" | "Write" | "Blocked"; tone: Tone; reason: string };
// Read tools can feed a sync. Write tools stay available in chat but never run
// unattended. Send and money tools are blocked from sync outright.
export function toolBadge(t: MirrorTool): ToolBadge {
  if (t.kind === "send") return { label: "Blocked", tone: "err", reason: "Sends on your behalf. Never used by sync; mail stays draft-only." };
  if (t.kind === "money") return { label: "Blocked", tone: "err", reason: "Moves money. Never used by sync." };
  if (t.kind === "write") return { label: "Write", tone: "warn", reason: "Changes data in the app. Not used by sync." };
  return { label: "Read", tone: "ok", reason: "Reads only. Can feed a sync." };
}
// Only read tools the engine marks sync_allowed may be picked for a recipe.
// send / money are excluded even if a stale engine marked them allowed.
export function syncableTools(app: MirrorApp): MirrorTool[] {
  return (app.tools ?? []).filter((t) => t.sync_allowed && t.kind !== "send" && t.kind !== "money");
}

// Why Sync now is unavailable, or null when it can run.
export function syncBlockedReason(app: MirrorApp): string | null {
  if (!app.syncable) return `Listed from ${RUNTIME_LABEL[app.runtime] ?? app.runtime}. Syncing through this runtime is not supported yet.`;
  if (app.status !== "connected") return "Sign in to this connector first.";
  if (!app.recipe || !app.recipe.prompt.trim()) return "Save a sync recipe first.";
  if (!app.recipe.domains.length) return "Pick at least one domain for the recipe.";
  return null;
}

// The site a connector belongs to, for its favicon. MCP endpoints usually live
// on a subdomain (mcp.example.com, api.example.com) whose favicon is missing,
// so fall back to the registrable domain.
export function faviconHost(url?: string): string | null {
  if (!url) return null;
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (!host || /^[\d.]+$/.test(host) || host === "localhost" || !host.includes(".")) return null;
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  const keep = tld.length === 2 && ["co", "com", "net", "org", "ac", "gov"].includes(sld) ? 3 : 2;
  return parts.slice(-keep).join(".");
}

export interface RecipeDraft {
  prompt: string;
  domains: string[];
  schedule: Schedule;
  read_tools: string[];
}
export function emptyDraft(app: MirrorApp): RecipeDraft {
  const r = app.recipe;
  return {
    prompt: r?.prompt ?? "",
    domains: r?.domains ?? [...app.domains],
    schedule: r?.schedule ?? "manual",
    read_tools: r?.read_tools ?? [],
  };
}
// The exact arguments Save sends. Read tools are limited to ones this app may
// sync with, so a stale pick never reaches the engine.
export function recipeSavePayload(vault: string, app: MirrorApp, d: RecipeDraft) {
  const allowed = new Set(syncableTools(app).map((t) => t.name));
  const hasTools = (app.tools ?? []).length > 0;
  return {
    vault,
    id: app.id,
    prompt: d.prompt.trim(),
    domains: Array.from(new Set(d.domains.map((x) => x.trim()).filter(Boolean))),
    schedule: d.schedule,
    readTools: d.read_tools.filter((t) => !hasTools || allowed.has(t)),
  };
}
