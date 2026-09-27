// "Waiting for you": one shared, polled read of everything that is held until
// the user answers (connector acts, Google writes, loop approvals, blocked
// tasks). Every surface that shows the status (thread rows, domain rows, the
// Work board, the Home count, the in-chat approval card) reads this one store,
// so they all agree and all clear together.
//
// Refresh: every POLL_MS while anything is subscribed, and at once on
// ACTS_CHANGED (any approve / always / deny / dismiss, from a card or the
// Inbox) and on the existing task / loop change events.
import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "./bridge";
import { threadIdOf } from "./routing";

export type WaitingKind = "act" | "gws" | "loop" | "task";
// Ids: an act's own id, a gws write's id, "<domain>:<loopId>:<idx>" for a loop
// approval and "task:<id>" for a blocked task (the Inbox uses the same ids).
export type WaitingItem = { kind: WaitingKind; id: string; domain: string; summary: string; since: number; thread?: string };
export type WaitingResult = { total: number; items: WaitingItem[] };

// A connector write the gate held (engine `acts pending-list`).
export type PendingAct = {
  id: string;
  domain: string;
  summary: string;
  tool: string;
  argsJson?: string;
  categories?: string[];
  ts?: number;
  actionClass?: string;
  alwaysEligible?: boolean;
  thread?: string;
};

export const ACTS_CHANGED = "prevail:acts-changed";
export const POLL_MS = 10_000;

// The gate appends this stable marker to its deny reason when it queues an act.
const MARKER_RE = /\[prevail-act:([A-Za-z0-9_.:-]+)\]/g;

/** Every held-act id named in these texts, in order, without repeats. */
export function extractActIds(...texts: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(MARKER_RE)) {
      const id = m[1];
      if (id && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

/** Hide the machine marker from text shown to a person. */
export function stripActMarkers(text: string): string {
  return text.replace(/\s*\[prevail-act:[A-Za-z0-9_.:-]+\]/g, "");
}

/** `since` may arrive in seconds or milliseconds; always hand back ms. */
export function sinceMs(n: number | undefined | null): number {
  if (!n || !Number.isFinite(n)) return 0;
  return n < 1e12 ? n * 1000 : n;
}

export function announceActsChanged(): void {
  try { window.dispatchEvent(new Event(ACTS_CHANGED)); } catch { /* no window */ }
}

// ── act -> thread links ───────────────────────────────────────────────────
// A marker seen in a thread ties that act to the thread on this Mac, so the
// thread row can say it is waiting even when the engine could not record the
// thread itself (an older engine, or a brand-new thread with no slug yet).
const LINKS_KEY = "prevail.acts.threadLinks";
const LINKS_MAX = 200;
function readLinks(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LINKS_KEY) || "{}") as Record<string, string>; } catch { return {}; }
}
export function linkActsToThread(ids: string[], threadPath: string | null | undefined): void {
  if (!threadPath || ids.length === 0) return;
  const cur = readLinks();
  let changed = false;
  for (const id of ids) if (cur[id] !== threadPath) { cur[id] = threadPath; changed = true; }
  if (!changed) return;
  const keys = Object.keys(cur);
  if (keys.length > LINKS_MAX) for (const k of keys.slice(0, keys.length - LINKS_MAX)) delete cur[k];
  try { localStorage.setItem(LINKS_KEY, JSON.stringify(cur)); } catch { /* storage off */ }
  emit();
}
export function threadLinkedToAct(id: string): string | null {
  return readLinks()[id] ?? null;
}

// ── the store ─────────────────────────────────────────────────────────────
type State = { vault: string | null; waiting: WaitingResult; acts: PendingAct[] | null; version: number };
const EMPTY: WaitingResult = { total: 0, items: [] };
let state: State = { vault: null, waiting: EMPTY, acts: null, version: 0 };
const listeners = new Set<() => void>();
let subscribers = 0;
let timer: number | null = null;
let inflight = false;

function emit() {
  state = { ...state, version: state.version + 1 };
  for (const l of listeners) l();
}

function normalize(raw: unknown): WaitingResult {
  const r = (raw ?? {}) as Partial<WaitingResult>;
  const items = Array.isArray(r.items) ? r.items.filter((i) => i && typeof i.id === "string") : [];
  return { total: typeof r.total === "number" ? r.total : items.length, items };
}

export async function refreshWaiting(): Promise<void> {
  const vault = state.vault;
  if (!vault || inflight) return;
  inflight = true;
  try {
    const [w, a] = await Promise.all([
      invoke<WaitingResult>("engine_waiting", { vault }).catch(() => null),
      invoke<PendingAct[]>("engine_acts_pending", { vault }).catch(() => null),
    ]);
    if (state.vault !== vault) return;
    state = { ...state, waiting: w ? normalize(w) : state.waiting, acts: Array.isArray(a) ? a : (a === null ? state.acts ?? [] : []) };
    emit();
  } finally {
    inflight = false;
  }
}

const onEvent = () => { void refreshWaiting(); };

function start(vault: string) {
  if (state.vault !== vault) {
    state = { vault, waiting: EMPTY, acts: null, version: state.version + 1 };
  }
  subscribers++;
  if (subscribers === 1) {
    window.addEventListener(ACTS_CHANGED, onEvent);
    window.addEventListener("prevail:tasks-changed", onEvent);
    window.addEventListener("prevail:loops-advanced", onEvent);
    timer = window.setInterval(onEvent, POLL_MS);
  }
  void refreshWaiting();
}
function stop() {
  subscribers = Math.max(0, subscribers - 1);
  if (subscribers === 0) {
    window.removeEventListener(ACTS_CHANGED, onEvent);
    window.removeEventListener("prevail:tasks-changed", onEvent);
    window.removeEventListener("prevail:loops-advanced", onEvent);
    if (timer) window.clearInterval(timer);
    timer = null;
  }
}

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
const snapshot = () => state;

/** The shared waiting store. Pass the vault; an empty vault reads nothing. */
export function useWaitingState(vaultPath: string | null | undefined): State {
  useEffect(() => {
    if (!vaultPath) return;
    start(vaultPath);
    return () => stop();
  }, [vaultPath]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function useWaiting(vaultPath: string | null | undefined): WaitingResult {
  return useWaitingState(vaultPath).waiting;
}

// ── derived views ─────────────────────────────────────────────────────────

/** Items per domain (lowercase key); "general" collects the domainless ones. */
export function waitingByDomain(items: WaitingItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const d = (it.domain || "general").toLowerCase();
    out[d] = (out[d] ?? 0) + 1;
  }
  return out;
}

/** Task ids on the board that are waiting on the user (item ids are "task:<id>"). */
export function waitingTaskIds(items: WaitingItem[]): Set<string> {
  return new Set(items.filter((i) => i.kind === "task").map((i) => i.id.replace(/^task:/, "")));
}

/**
 * Thread paths with something waiting: an item that names the thread (by slug
 * or path), or a still-pending act whose marker was seen in that thread.
 */
export function waitingThreadPaths(
  items: WaitingItem[],
  acts: PendingAct[] | null,
  threads: Array<{ path: string; slug?: string }>,
): Set<string> {
  const out = new Set<string>();
  const bySlug = new Map<string, string>();
  for (const t of threads) {
    bySlug.set(t.path, t.path);
    const slug = t.slug || threadIdOf(t.path);
    if (slug) bySlug.set(slug, t.path);
  }
  const pendingIds = new Set<string>([...items.map((i) => i.id), ...(acts ?? []).map((a) => a.id)]);
  for (const it of items) {
    if (it.thread) {
      const p = bySlug.get(it.thread) ?? bySlug.get(threadIdOf(it.thread) ?? "");
      if (p) out.add(p);
    }
  }
  for (const a of acts ?? []) {
    if (a.thread) {
      const p = bySlug.get(a.thread) ?? bySlug.get(threadIdOf(a.thread) ?? "");
      if (p) out.add(p);
    }
  }
  const links = readLinks();
  for (const [id, path] of Object.entries(links)) if (pendingIds.has(id)) out.add(path);
  return out;
}

/** Pending acts that belong to a thread (engine-recorded or seen locally). */
export function pendingActsForThread(acts: PendingAct[] | null, threadPath: string | null | undefined): PendingAct[] {
  if (!acts || !threadPath) return [];
  const slug = threadIdOf(threadPath);
  const links = readLinks();
  return acts.filter((a) => (a.thread && (a.thread === slug || a.thread === threadPath)) || links[a.id] === threadPath);
}
