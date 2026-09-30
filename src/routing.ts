// General-to-domain routing (engine: `prevail route`).
//
// Every user message in General asks the engine which of the vault's domains
// it is about. At or above the threshold the thread is tagged with those
// domains: it then shows up in each domain's thread list as a linked entry
// (same file, never moved or copied) and the turn carries that domain's
// context. Below the threshold the domain is only suggested.
//
// Privacy: the engine sends only the message text to the routing provider.
// Nothing here logs the text; a correction is recorded in the vault's own
// decision log by the engine.

import { invoke } from "./bridge";
import { buildIdealStatePreamble } from "./helpers2";
import { titleCase } from "./format";
import { PREF, getPref } from "./storage";
import type { ChatMessage, DomainContextBundle, MessageRoute } from "./types";

export interface RouteHit {
  slug: string;
  confidence: number;
}

export interface RouteCandidate {
  slug: string;
  score: number;
}

export interface RouteResult {
  domains: RouteHit[];
  reason: string;
  source: string;
  // Generous filing: the home domain, the other domains it concerns, and when
  // nothing clears the low bar, `unfiled` with the top candidates.
  primary?: string | null;
  secondary?: string[];
  candidates?: RouteCandidate[];
  unfiled?: boolean;
  /** False when the filing did not change (or nothing was asked). */
  changed?: boolean;
  /** False when this turn was not a re-check turn: nothing was asked. */
  checked?: boolean;
}

export const ROUTE_THRESHOLD_DEFAULT = 0.75;
/** How long a send waits for routing before the turn goes out without it. */
export const ROUTE_WAIT_MS = 1_500;
/** Hard cap on one routing call; a late answer still tags the thread. */
export const ROUTE_TIMEOUT_MS = 25_000;

export function routingEnabled(): boolean {
  return getPref(PREF.routeDomains, "1") === "1";
}

export function routeThreshold(): number {
  const n = Number(getPref(PREF.routeThreshold, String(ROUTE_THRESHOLD_DEFAULT)));
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : ROUTE_THRESHOLD_DEFAULT;
}

/** Thread id the engine keys corrections by: the file stem. */
export function threadIdOf(path: string | null | undefined): string | null {
  if (!path) return null;
  const stem = path.split("/").pop()?.replace(/\.md$/, "") ?? "";
  return stem || null;
}

/** Ask the engine. Never throws; null means "no answer, stay in General". */
export async function routeText(vault: string, text: string, thread: string | null, timeoutMs = ROUTE_TIMEOUT_MS, current: string[] = [], turn?: number): Promise<RouteResult | null> {
  const call = invoke<RouteResult>("engine_route", { vault, text, thread, current, turn: turn ?? null })
    .then((r) => (r && Array.isArray(r.domains) ? r : null))
    .catch(() => null);
  const timeout = new Promise<null>((r) => window.setTimeout(() => r(null), timeoutMs));
  return Promise.race([call, timeout]);
}

/** Split an answer into tagged (>= threshold) and suggested (below). */
export function splitRoute(res: RouteResult | null, threshold: number, known?: Set<string>): MessageRoute {
  const hits = (res?.domains ?? []).filter((h) => !known || known.has(h.slug));
  return {
    tagged: hits.filter((h) => h.confidence >= threshold).map((h) => h.slug),
    suggested: hits.filter((h) => h.confidence < threshold).slice(0, 1),
  };
}

/** Domains a thread is tagged with, across all its messages, first seen first. */
export function threadRoutes(messages: ChatMessage[]): string[] {
  const out: string[] = [];
  for (const m of messages) for (const d of m.domainRoute?.tagged ?? []) if (!out.includes(d)) out.push(d);
  return out;
}

// Per-turn routes ride in the thread's frontmatter as `route_turns`, a compact
// "index:slug|slug;index:" string, so chips survive a reload without touching
// the transcript body.
export function encodeRouteTurns(messages: ChatMessage[]): string {
  const parts: string[] = [];
  messages.forEach((m, i) => {
    if (m.role === "user" && m.domainRoute && !m.domainRoute.pending) parts.push(`${i}:${m.domainRoute.tagged.join("|")}`);
  });
  return parts.join(";");
}

export function decodeRouteTurns(s: string | null | undefined): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const part of (s ?? "").split(";")) {
    const [i, list] = part.split(":");
    const n = Number(i);
    if (!part.includes(":") || !Number.isInteger(n) || n < 0) continue;
    out.set(n, (list ?? "").split("|").map((x) => x.trim()).filter(Boolean));
  }
  return out;
}

/**
 * Context for the domains a turn was routed to: each domain's ideal state,
 * long-term memory and current state, through the same preamble builder the
 * domain chat uses.
 */
export async function buildRoutedContext(vault: string, domains: string[]): Promise<string> {
  if (domains.length === 0) return "";
  const blocks = await Promise.all(domains.map(async (d) => {
    const [ideal, memory, ctx] = await Promise.all([
      invoke<string>("read_domain_ideal", { vault, domain: d }).catch(() => ""),
      invoke<string>("read_memory_md", { vault, domain: d }).catch(() => ""),
      invoke<DomainContextBundle>("domain_context", { vault, domain: d }).catch(() => null),
    ]);
    const label = titleCase(d);
    const ideal2 = typeof ideal === "string" && ideal.trim()
      ? buildIdealStatePreamble(ideal).replace("# THE USER'S IDEAL STATE", `# ${label.toUpperCase()}: IDEAL STATE`)
      : "";
    const mem = typeof memory === "string" && memory.trim() ? `--- Long-term memory (${label}) ---\n${memory.trim().slice(0, 3000)}\n\n` : "";
    const state = ctx?.state?.trim() ? `--- ${label}/state.md ---\n${ctx.state.trim().slice(0, 3000)}\n\n` : "";
    return ideal2 || mem || state ? `${ideal2}${mem}${state}` : "";
  }));
  const body = blocks.filter(Boolean).join("");
  if (!body) return "";
  const names = domains.map(titleCase).join(", ");
  return `This conversation is about the user's ${names} domain${domains.length === 1 ? "" : "s"}. Use this context:\n\n${body}`;
}

/** Record the user's correction so routing learns from it. Fire and forget. */
export function correctRoute(vault: string, thread: string | null, domains: string[], from: string[], text: string): void {
  if (!thread) return;
  void invoke("engine_route_correct", { vault, thread, domains, from, text }).catch(() => {});
}

// ---- Filing: every conversation has a home domain, generously ----------
//
// A thread's filing rides in its `routed:` frontmatter, home first, then the
// other domains it is filed in. The file itself never moves.

export interface Filing {
  home: string | null;
  also: string[];
  /** Only while unfiled: the engine's top picks, one click to file. */
  candidates?: RouteCandidate[];
}

export function filingOf(routed: string[] | null | undefined): Filing | null {
  const r = (routed ?? []).filter(Boolean);
  return r.length ? { home: r[0], also: r.slice(1) } : null;
}

export function routedOf(f: Filing | null | undefined): string[] {
  if (!f?.home) return [];
  return [f.home, ...f.also.filter((d) => d !== f.home)];
}

/**
 * Fold a route answer into a thread's filing. A home, once set, never changes
 * here; new secondary domains are only added (the engine already leaves out
 * any the user removed). Returns `prev` itself when nothing changed.
 */
export function mergeRoute(prev: Filing | null, res: RouteResult | null, known?: Set<string>, threshold = routeThreshold()): Filing | null {
  // Nothing asked, nothing changed, or routing failed: keep what is there.
  if (!res || res.checked === false || res.changed === false || res.source === "none") return prev;
  const ok = (d: string | null | undefined): d is string => !!d && (!known || known.has(d));
  const tagged = splitRoute(res, threshold, known).tagged;
  const primary = res.primary !== undefined ? (ok(res.primary) ? res.primary : null) : tagged[0] ?? null;
  const secondary = (res.secondary ?? tagged.slice(1)).filter(ok);
  if (!prev?.home) {
    if (primary) return { home: primary, also: secondary.filter((d) => d !== primary) };
    if (res.unfiled) return { home: null, also: [], candidates: (res.candidates ?? []).filter((c) => ok(c.slug)).slice(0, 3) };
    return prev;
  }
  const add = secondary.filter((d) => d !== prev.home && !prev.also.includes(d));
  return add.length ? { home: prev.home, also: [...prev.also, ...add] } : prev;
}

/**
 * Save a filing the user chose: the thread's `routed:` line only (the body is
 * never touched), and the correction goes to the engine so routing learns.
 */
export async function saveFiling(vault: string, thread: string, next: Filing | null, prev: Filing | null, text = ""): Promise<void> {
  await invoke("thread_set_filing", { vault, thread, routed: routedOf(next) });
  correctRoute(vault, threadIdOf(thread) ?? thread, routedOf(next), routedOf(prev), text);
}

export interface FilePlanRow {
  thread: string;
  title: string;
  current_home: string | null;
  primary: string | null;
  secondary: string[];
  candidates: RouteCandidate[];
  unfiled: boolean;
}

export interface FilePlan {
  rows: FilePlanRow[];
  skipped: number;
}

/** The engine's filing plan for conversations never filed. Never throws. */
export async function readFilePlan(vault: string, limit = 50): Promise<FilePlan> {
  const r = await invoke<unknown>("engine_file_plan", { vault, limit }).catch(() => null);
  const obj = (r && typeof r === "object" ? r : {}) as { rows?: unknown; plan?: unknown; skipped?: unknown };
  const list = Array.isArray(r) ? r : Array.isArray(obj.rows) ? obj.rows : Array.isArray(obj.plan) ? obj.plan : [];
  const rows = (list as Partial<FilePlanRow>[]).filter((x) => x && typeof x.thread === "string").map((x) => ({
    thread: x.thread as string,
    title: x.title || "Untitled",
    current_home: x.current_home ?? null,
    primary: x.primary ?? null,
    secondary: Array.isArray(x.secondary) ? x.secondary : [],
    candidates: Array.isArray(x.candidates) ? x.candidates : [],
    unfiled: !!x.unfiled,
  }));
  return { rows, skipped: typeof obj.skipped === "number" ? obj.skipped : 0 };
}
