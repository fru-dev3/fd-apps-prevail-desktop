// The stack (apps plan A2 to A4) and the sources (metrics plan M3): the shapes
// `prevail apps stack --json` and `prevail sources list --json` return, and
// the small pure helpers the Apps page and the Sources screen share.

export interface AppUsage {
  id: string;
  active_days: { d7: number; d30: number; d90: number };
  minutes_30d: number;
  device_minutes_30d: Record<string, number>;
  web_visits_30d: number;
  ai_sessions_30d: number;
  last_used?: string;
  first_seen?: string;
  trend: "up" | "down" | "flat" | "new";
  signals: { kind: string; value: string }[];
  hosts: string[];
}
export type HealthClass = "ok" | "auth_expired" | "ineligible" | "vendor_down" | "missing" | "degraded" | "unknown_shape" | "capture_gap";
export type Verdict = "keep" | "review" | "cancel";
export interface StackApp {
  id: string; name: string; kind: string; category: string; lifecycle: string;
  usage: AppUsage | null; monthly: number | null; cost_source?: string; cost_confidence?: number;
  renewal?: { next: string; period: string }; trial?: { ends: string }; price_up?: { from: number; to: number; date: string };
  value_multiple?: number; api_equivalent_month?: number;
  health: HealthClass | null; health_detail?: string; verdict: Verdict; why: string[];
  cost_per_active_day?: number; first_seen?: string;
}
export interface StackCard { key: string; kind: string; app: string; title: string; why: string; actions: string[]; urgent: boolean; due?: string }
export interface Stack {
  ts: number; usage_since?: string | null; month_total: number; in_use: number; apps: StackApp[];
  categories: { id: string; title: string; count: number }[];
  archived_seen: string[]; unknown: number; fda: { host: string; state: string }[];
  ai: { paid_monthly: number | null; api_equivalent: number; value_multiple: number | null };
  cards?: StackCard[];
}
export interface UnknownSignal { kind: string; value: string; days: number; last: string; n: number; suggestion?: string; freq?: string }
export interface HealthCheck { app: string; check: string; status: HealthClass; detail: string; fix?: string; version?: string }
export interface HealthRow { app: string; status: HealthClass; checks: HealthCheck[]; last_ok?: string; first_fail?: string; checked: string; changed?: string }

export interface SourceRow {
  id: string; title: string; wave: 1 | 2 | 3 | 4; reads: string; never: string; defaultOn: boolean;
  localOnly?: boolean; localModel?: boolean; fda?: boolean; connect?: string; emits: string[];
  on: boolean; decided: boolean; state: string; note?: string; last_sync?: string; events?: number;
}

export const money = (x: number) => `$${x >= 100 ? Math.round(x).toLocaleString("en-US") : x.toFixed(2)}`;

/** The page subtitle: what the stack costs and how much of it is in use. */
export function stackSubtitle(s: Stack | null): string {
  if (!s) return "Every app and service you use, what it costs and whether it works.";
  return `${money(s.month_total)} a month known · ${s.in_use} in use`;
}

/** Category title for an app: the engine's own names where it gave them. */
export const CATEGORY_TITLE: Record<string, string> = { ai: "AI tools", "ai-coding": "AI tools", dev: "Dev", notes: "Notes", design: "Design", content: "Content", chat: "Chat", meetings: "Meetings", music: "Music", video: "Video", storage: "Storage", productivity: "Productivity", network: "Network", security: "Security", social: "Social", shopping: "Shopping", travel: "Travel", fitness: "Fitness", money: "Money", platform: "Platform", audio: "Audio" };
export const categoryTitle = (c: string) => CATEGORY_TITLE[c] ?? (c ? c.replace(/-/g, " ").replace(/^./, (x) => x.toUpperCase()) : "Other");

export const HEALTH_LABEL: Record<HealthClass, string> = {
  ok: "Working", auth_expired: "Needs sign-in", ineligible: "Not available", vendor_down: "Service down", missing: "Not installed",
  degraded: "Degraded", unknown_shape: "Unreadable", capture_gap: "Not captured",
};
/** Tone of a health class: good, warn or bad (the dot color). */
export function healthTone(h: HealthClass | null): "good" | "warn" | "bad" | "none" {
  if (!h) return "none";
  if (h === "ok") return "good";
  if (h === "degraded" || h === "missing") return "warn";
  return "bad";
}

export const VERDICT_LABEL: Record<Verdict, string> = { keep: "Keep", review: "Review", cancel: "Cancel?" };

/** Share of 30 days the app was used, 0..1, for the bar. */
export const activeShare = (u: AppUsage | null) => Math.max(0, Math.min(1, (u?.active_days.d30 ?? 0) / 30));

export const ACTION_LABEL: Record<string, string> = { keep: "Keep", snooze: "Snooze 30 days", "cancel-steps": "Draft cancel steps", archive: "Archive", fix: "Mark fixed", review: "Review later", done: "Done" };

/** The list of apps in one spine selection. */
export function appsIn(s: Stack | null, sel: string): StackApp[] {
  if (!s) return [];
  if (sel === "all") return s.apps;
  if (sel.startsWith("cat:")) return s.apps.filter((a) => categoryTitle(a.category).toLowerCase().replace(/[^a-z0-9]+/g, "-") === sel.slice(4));
  return [];
}

/** Hosts where Screen Time needs Full Disk Access. */
export const needsFda = (s: Stack | null) => (s?.fda ?? []).filter((f) => f.state === "needs-fda").map((f) => f.host);

/** Turning a source on asks first when it reads something new or sensitive (waves 3 and 4). */
export const needsConfirm = (s: SourceRow, turningOn: boolean) => turningOn && s.wave >= 3;

export const WAVE_LABEL: Record<number, string> = { 1: "Already on your Macs", 2: "Connected, synced", 3: "Needs a connection", 4: "On this Mac, opt-in" };

/** A source's state in plain words. */
export function sourceState(s: SourceRow): string {
  if (!s.on) return "Off";
  const map: Record<string, string> = { ok: "Working", "needs-fda": "Needs Full Disk Access", "needs-connection": "Needs a connection", "auth-failed": "Sign-in failed", "needs-local-model": "Needs a local model", absent: "Nothing to read here", "unknown-shape": "Unreadable", failed: "Failed", "not synced yet": "Not synced yet" };
  return map[s.state] ?? s.state;
}
