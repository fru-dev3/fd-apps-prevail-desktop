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

export interface RouteResult {
  domains: RouteHit[];
  reason: string;
  source: string;
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
export async function routeText(vault: string, text: string, thread: string | null, timeoutMs = ROUTE_TIMEOUT_MS): Promise<RouteResult | null> {
  const call = invoke<RouteResult>("engine_route", { vault, text, thread })
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
