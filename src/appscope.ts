// Apps as chat scopes, the light half (no components): the access log and an
// app's own threads from the engine, trusted sources, @-references and what a
// reply's tool steps say about the apps it used. The engine owns the data.
//   prevail apps access-log [--app] [--domain] [--entity] [--thread] --json
//   prevail apps threads <id> --json            -> [{ slug, title, updated, turns }]
//   prevail apps add-source --kind K --url U --name N --json
//   prevail apps accounts <id> --json            -> [{ id, label?, default, via }]
import { invoke } from "./bridge";
import { useInvokeQuery } from "./query";
import type { ChatStep } from "./types";
import type { MirrorApp, MirrorTool, RuntimeId } from "./appsmirror-model";
import { RUNTIME_LABEL } from "./appsmirror-model";

export type AccessKind = "read" | "write" | "blocked";
export type AccessOutcome = "ran" | "queued" | "denied" | "declined";
export interface AccessLine {
  ts: number;
  tool: string;
  access: AccessKind;
  outcome: AccessOutcome;
  thread?: string;
  domain?: string;
  entity?: string;
  summary: string;
  app: string;
  // The Google account a Google tool call ran as (engine 0.4.4 and later).
  account?: string;
}
export interface AccessFilter { app?: string; domain?: string; entity?: string; thread?: string; limit?: number }

// The args every access-log read sends, so every caller shares one cache key.
export function accessLogArgs(vault: string, f: AccessFilter): Record<string, unknown> {
  return { vault, app: f.app ?? null, domain: f.domain ?? null, entity: f.entity ?? null, thread: f.thread ?? null, limit: f.limit ?? 200 };
}
export function asAccessLines(r: unknown): AccessLine[] {
  const list = Array.isArray(r) ? r : [];
  return list.filter((l): l is AccessLine => !!l && typeof l.ts === "number" && typeof l.tool === "string").sort((a, b) => b.ts - a.ts);
}

// Google apps (Gmail, Drive, Calendar) can read across every Google account
// the user signed into, through the google_workspace connector (--google-account).
export interface GoogleAccount { id: string; label?: string; default: boolean; via: "gws" | "claude" }
export const GOOGLE_APP_RE = /gmail|google[ -]?(drive|calendar)|^(drive|calendar)$/i;
export const isGoogleApp = (app: { id: string; name: string }) => GOOGLE_APP_RE.test(app.id) || GOOGLE_APP_RE.test(app.name);
export function asGoogleAccounts(r: unknown): GoogleAccount[] {
  return (Array.isArray(r) ? r : []).filter((a): a is GoogleAccount => !!a && typeof a.id === "string" && !!a.id.trim());
}
// The accounts a Google app can use; empty for any other app.
export function useGoogleAccounts(vault: string, app: { id: string; name: string }): GoogleAccount[] {
  const q = useInvokeQuery<unknown>("engine_apps_accounts", isGoogleApp(app) ? { vault, id: app.id } : null);
  return asGoogleAccounts(q.data);
}
export const appAccountPref = (id: string) => `prevail.app.${id}.googleAccount`;
// What the Account picker shows and a turn sends: the remembered choice while it
// still names a signed-in account (or "all"); else every account when there are
// several, the one when there is one, nothing when there are none.
export function effectiveGoogleAccount(saved: string, accounts: GoogleAccount[]): string | null {
  if (accounts.length === 0) return null;
  if (saved === "all" && accounts.length > 1) return "all";
  if (accounts.some((a) => a.id === saved)) return saved;
  return accounts.length > 1 ? "all" : accounts[0]!.id;
}

export type AppThread = { slug: string; title: string; updated: number; turns: number };
export async function loadAppThreads(vaultPath: string, id: string): Promise<AppThread[]> {
  const r = await invoke<AppThread[]>("engine_apps_threads", { vault: vaultPath, id }).catch(() => null);
  return (Array.isArray(r) ? r : []).filter((t) => t && typeof t.slug === "string").sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
}
// The thread key an app's own conversations are saved under.
export const appScopeKey = (id: string) => `_app-${id}`;
export const APP_ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

export const ACCESS_LABEL: Record<AccessKind, string> = { read: "Read", write: "Write", blocked: "Blocked" };
export const OUTCOME_LABEL: Record<AccessOutcome, string> = { ran: "Ran", queued: "Waiting for you", denied: "Denied", declined: "Declined" };

// Only connectors used through Claude reach the gate hook that writes the log.
export function activityRecorded(runtime: RuntimeId | string | undefined): boolean {
  return !runtime || runtime === "claude";
}

// ── Trusted sources ─────────────────────────────────────────────────────────
export type SourceKind = "mcp-remote" | "web" | "links";
export const SOURCE_KINDS: { id: SourceKind; label: string; hint: string; placeholder: string }[] = [
  { id: "mcp-remote", label: "MCP address", hint: "A remote MCP server. Its tools are read only.", placeholder: "https://example.com/mcp" },
  { id: "web", label: "Site", hint: "A site with an llms.txt or openapi.json. Documented GET endpoints only.", placeholder: "https://example.com" },
  { id: "links", label: "Links", hint: "Pages the agent may read. One address per line.", placeholder: "https://example.com/page" },
];
export const SOURCE_KIND_LABEL: Record<SourceKind, string> = { "mcp-remote": "MCP address", web: "Site", links: "Links" };
export function isWebSource(a: Pick<MirrorApp, "integration">): boolean {
  return a.integration === "web" || a.integration === "links";
}
// Suggested sources, one click to add. Public addresses only. The engine
// slugs the name into the app id ("context-fru-dev").
export const SUGGESTED_SOURCES: { name: string; kind: SourceKind; url: string; blurb: string }[] = [
  { name: "Context (fru.dev)", kind: "mcp-remote", url: "https://context.fru.dev/mcp", blurb: "Public data sites behind context.fru.dev: list them, search them, query one." },
];
export function slugifyId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
export function parseUrls(text: string): string[] {
  return Array.from(new Set(text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean).map((u) => (/^[a-z]+:\/\//i.test(u) ? u : `https://${u}`))));
}
// What `apps add-source` returns: the app, and what the engine found when it
// looked at the source. A failed probe still adds it, with status "error".
export type SourceProbe = {
  ok: boolean;
  checked_at?: number;
  error?: string;
  server?: { name?: string; version?: string; protocol?: string };
  tools?: { name: string; kind: string; read_only_hint: boolean }[];
  llms_txt?: boolean;
  openapi?: boolean;
  urls?: { url: string; status: number | null; ok: boolean }[];
};
export type AddSourceResult = { app: MirrorApp; probe: SourceProbe; adopted: boolean };
// A source whose folder synced from another Mac, not yet trusted on this one.
export type UntrustedSource = { id: string; name: string; integration: SourceKind; urls: string[] };

// ── @-references ────────────────────────────────────────────────────────────
export type RefKind = "app" | "entity" | "domain";
export type ChatRef = { kind: RefKind; id: string; label: string };
export function addRef(list: ChatRef[], r: ChatRef): ChatRef[] {
  return list.some((x) => x.kind === r.kind && x.id === r.id) ? list : [...list, r];
}
// What send passes to engine_chat: chips become --app / --entity / --ref-domain.
export function refsToChatArgs(refs: ChatRef[]): { apps: string[]; entities: string[]; refDomains: string[] } {
  const pick = (k: RefKind) => Array.from(new Set(refs.filter((r) => r.kind === k).map((r) => r.id)));
  return { apps: pick("app").filter((id) => APP_ID_RE.test(id)), entities: pick("entity"), refDomains: pick("domain") };
}

// ── What a reply did with apps ──────────────────────────────────────────────
export type AppUse = { app: string; name: string; reads: number; writes: number; blocked?: number; other: number; thread?: string };
const norm = (s: string) => s.toLowerCase().replace(/[_\-\s]+/g, " ").trim();
// A step's label ends with the tool name, spaced ("Claude ai Gmail search
// threads"); the app's tool list says whether that tool reads or writes.
function toolFor(label: string, tools: MirrorTool[] | undefined): MirrorTool | null {
  const l = norm(label);
  let best: MirrorTool | null = null;
  for (const t of tools ?? []) {
    const n = norm(t.name);
    if (n && l.endsWith(n) && (!best || n.length > norm(best.name).length)) best = t;
  }
  return best;
}
export function appUses(steps: ChatStep[] | undefined, apps: MirrorApp[], extra: { id: string; name: string }[] = []): AppUse[] {
  const out = new Map<string, AppUse>();
  for (const s of steps ?? []) {
    if (!s.app) continue;
    const m = apps.find((a) => a.id === s.app);
    const u = out.get(s.app) ?? { app: s.app, name: m?.name ?? extra.find((x) => x.id === s.app)?.name ?? s.app, reads: 0, writes: 0, other: 0, thread: s.thread };
    // The engine's access class when the step carries one; an older engine's
    // steps are matched by label against the app's tool list.
    const kind = s.access ?? toolFor(s.label, m?.tools)?.kind;
    if (!kind) u.other++;
    else if (kind === "read") u.reads++;
    else if (kind === "blocked") u.blocked = (u.blocked ?? 0) + 1;
    else u.writes++;
    if (!u.thread && s.thread) u.thread = s.thread;
    out.set(s.app, u);
  }
  return [...out.values()];
}
const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
export function appUseLabel(u: AppUse): string {
  const parts = [u.reads ? n(u.reads, "read", "reads") : "", u.writes ? n(u.writes, "write", "writes") : "", u.blocked ? `${u.blocked} blocked` : "", u.other ? n(u.other, "call", "calls") : ""].filter(Boolean);
  return `Used ${u.name} · ${parts.join(", ")}`;
}
// An app tool step's label: "Gmail · Search threads" from the app's name and
// the tool's short name; the engine's own label when either is missing.
export function appStepLabel(appName: string | undefined, tool: string | undefined, fallback: string): string {
  const words = (tool ?? "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-\s]+/g, " ").trim().toLowerCase();
  return appName && words ? `${appName} · ${words[0].toUpperCase()}${words.slice(1)}` : fallback;
}
export function runtimeName(r: string): string {
  if (r === "antigravity") return "Antigravity";
  return RUNTIME_LABEL[r as RuntimeId] ?? (r ? r[0].toUpperCase() + r.slice(1) : r);
}

// ── Opening an app from anywhere ────────────────────────────────────────────
// The Apps page reads which tab to show (and a thread filter for Activity)
// from here, set before the usual mirror-select handoff.
export const APP_FOCUS_KEY = "prevail.apps.focus";
export type AppFocus = { id: string; tab: "chat" | "activity" | "tools" | "connection"; thread?: string };
export function openApp(focus: AppFocus) {
  try {
    sessionStorage.setItem("prevail.apps.mirror.select", focus.id);
    sessionStorage.setItem(APP_FOCUS_KEY, JSON.stringify(focus));
  } catch { /* storage off */ }
  window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "apps" }));
  window.dispatchEvent(new CustomEvent("prevail:mirror-select", { detail: focus.id }));
  window.dispatchEvent(new CustomEvent("prevail:app-focus", { detail: focus }));
}
export function takeAppFocus(id: string): AppFocus | null {
  try {
    const raw = sessionStorage.getItem(APP_FOCUS_KEY);
    if (!raw) return null;
    const f = JSON.parse(raw) as AppFocus;
    if (f?.id !== id) return null;
    sessionStorage.removeItem(APP_FOCUS_KEY);
    return f;
  } catch { return null; }
}
