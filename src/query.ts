// One small shared data cache for backend reads (stale-while-revalidate).
//
//   const { data, refresh } = useEngineQuery(`scan_skills:${vault}`, () => invoke("scan_skills", { vault }), { invalidateOn: [...] });
//
// - A key seen before renders its cached value at once; if older than
//   `staleMs` it is re-fetched in the background and the page re-renders only
//   when the answer arrives.
// - Concurrent fetches of one key share a single in-flight call.
// - `invalidateOn` names window events (prevail:tasks-changed, ...). When one
//   fires, every entry that listed it is marked stale; mounted readers refetch
//   at once, unmounted ones on their next mount.
// - `cachedInvoke` is the same thing for code that is not a component (and for
//   warming the cache ahead of a click).
// The cache lives for the window's lifetime; switching vault changes the keys.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { invoke } from "./bridge";

type Entry = {
  data?: unknown;
  error?: unknown;
  has: boolean;
  at: number; // when data last arrived
  inflight?: Promise<unknown>;
  started: number; // fetches started, so an older answer never overwrites a newer one
  applied: number;
  // Invalidated by an event: only a fetch started after `staleUpTo` clears it,
  // so an answer already in flight when the change happened does not count.
  stale: boolean;
  staleUpTo: number;
  events: Set<string>;
  subs: Set<() => void>;
};

const cache = new Map<string, Entry>();
const watched = new Set<string>();

function entry(key: string): Entry {
  let e = cache.get(key);
  if (!e) {
    e = { has: false, at: 0, started: 0, applied: 0, stale: false, staleUpTo: 0, events: new Set(), subs: new Set() };
    cache.set(key, e);
  }
  return e;
}

function notify(e: Entry) {
  for (const s of e.subs) s();
}

function markStale(e: Entry) {
  e.stale = true;
  e.staleUpTo = e.started;
  notify(e); // mounted readers refetch
}

function watch(events: readonly string[] | undefined, e: Entry) {
  if (!events) return;
  for (const ev of events) {
    e.events.add(ev);
    if (watched.has(ev) || typeof window === "undefined") continue;
    watched.add(ev);
    window.addEventListener(ev, () => {
      for (const x of cache.values()) {
        if (x.events.has(ev)) markStale(x);
      }
    });
  }
}

/**
 * Fetch `key` unless a fresh copy is cached; identical concurrent calls share
 * one request. `force` always starts a new request (after a change, an older
 * in-flight answer may predate it); an older answer then never overwrites it.
 */
export function cachedInvoke<T>(key: string, fetcher: () => Promise<T>, opts: { staleMs?: number; invalidateOn?: readonly string[]; force?: boolean } = {}): Promise<T> {
  const e = entry(key);
  watch(opts.invalidateOn, e);
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  if (!opts.force && e.has && !e.stale && Date.now() - e.at < staleMs) return Promise.resolve(e.data as T);
  if (e.inflight && !opts.force) return e.inflight as Promise<T>;
  const id = ++e.started;
  const p = fetcher().then(
    (data) => {
      if (id < e.applied) return e.data as T;
      e.applied = id;
      e.data = data;
      e.error = undefined;
      e.has = true;
      e.at = Date.now();
      if (id > e.staleUpTo) e.stale = false;
      return data;
    },
    (err) => {
      if (id < e.applied) return e.data as T;
      e.error = err;
      // A failed refetch settles the entry too (its last good data stays on
      // screen), so a failing command is not retried in a loop.
      if (id > e.staleUpTo) e.stale = false;
      throw err;
    },
  ).finally(() => {
    if (e.inflight === p) e.inflight = undefined;
    notify(e);
  });
  e.inflight = p;
  return p;
}

/** Drop freshness for keys starting with `prefix` (all keys when omitted). */
export function invalidateQueries(prefix = ""): void {
  for (const [k, e] of cache) {
    if (k.startsWith(prefix)) markStale(e);
  }
}

/** The cached value for a key, if any (no fetch). */
export function peekQuery<T>(key: string): T | undefined {
  return cache.get(key)?.data as T | undefined;
}

/** Seed or overwrite a key (an optimistic edit, or a write that returns the new value). */
export function setQueryData<T>(key: string, data: T | ((cur: T | undefined) => T)): void {
  const e = entry(key);
  e.data = typeof data === "function" ? (data as (cur: T | undefined) => T)(e.data as T | undefined) : data;
  e.has = true;
  e.at = Date.now();
  notify(e);
}

// 0: every mount revalidates (the old always-fetch behaviour), but paints the
// cached copy first. A caller may allow a window with staleMs.
export const DEFAULT_STALE_MS = 0;

export type QueryResult<T> = {
  data: T | undefined;
  error: unknown;
  /** True until the first answer for this key (cached or fresh) exists. */
  loading: boolean;
  /** A fetch is running (first load or background refresh). */
  fetching: boolean;
  /** Re-fetch now, ignoring freshness. */
  refresh: () => Promise<void>;
};

/**
 * Read `key` through the shared cache. `key` null = disabled (no fetch).
 * The fetcher is read from a ref, so an inline arrow is fine.
 */
export function useEngineQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts: { staleMs?: number; invalidateOn?: readonly string[] } = {},
): QueryResult<T> {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const subscribe = useCallback((cb: () => void) => {
    if (!key) return () => {};
    const e = entry(key);
    e.subs.add(cb);
    return () => { e.subs.delete(cb); };
  }, [key]);
  // Snapshot = the entry's own fields; a new object only when they change.
  const snapRef = useRef<{ key: string | null; data: unknown; error: unknown; has: boolean; inflight: boolean; stale: boolean } | null>(null);
  const getSnapshot = useCallback(() => {
    const e = key ? cache.get(key) : undefined;
    const next = { key, data: e?.data, error: e?.error, has: !!e?.has, inflight: !!e?.inflight, stale: !!e?.stale };
    const prev = snapRef.current;
    if (prev && prev.key === next.key && prev.data === next.data && prev.error === next.error && prev.has === next.has && prev.inflight === next.inflight && prev.stale === next.stale) return prev;
    snapRef.current = next;
    return next;
  }, [key]);
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const run = useCallback((force: boolean) => {
    if (!key) return Promise.resolve();
    return cachedInvoke(key, () => fetcherRef.current(), { ...optsRef.current, force }).then(() => {}, () => {});
  }, [key]);

  // Fetch on mount / key change unless a fresh copy is cached.
  useEffect(() => {
    if (!key) return;
    const e = entry(key);
    watch(optsRef.current.invalidateOn, e);
    if (!e.inflight && (!e.has || e.stale || Date.now() - e.at >= (optsRef.current.staleMs ?? DEFAULT_STALE_MS))) void run(false);
  }, [key, run]);
  // And again when an invalidating event marks it stale while mounted (once
  // any answer already in flight has landed).
  useEffect(() => {
    if (key && snap.stale && !snap.inflight) void run(true);
  }, [key, snap.stale, snap.inflight, run]);

  const refresh = useCallback(() => run(true), [run]);
  return { data: snap.data as T | undefined, error: snap.error, loading: !!key && !snap.has, fetching: snap.inflight, refresh };
}

/** Forget everything (tests, and a vault switch if a caller wants a clean slate). */
export function clearQueryCache(): void {
  cache.clear();
}

/** The cache key for one backend command + its arguments. */
export function invokeKey(cmd: string, args?: Record<string, unknown>): string {
  return `${cmd}:${JSON.stringify(args ?? {})}`;
}

/** `invoke` through the cache: de-duplicated, and warm for the next reader. */
export function invokeCached<T>(cmd: string, args?: Record<string, unknown>, opts: { staleMs?: number; invalidateOn?: readonly string[]; force?: boolean } = {}): Promise<T> {
  return cachedInvoke(invokeKey(cmd, args), () => invoke<T>(cmd, args), opts);
}

/**
 * useInvokeQuery plus a setter that writes through the cache, for pages that
 * edit their list in place (optimistic toggles, removals): the edit shows now
 * and is what the next visit paints.
 */
export function useInvokeState<T>(cmd: string, args: Record<string, unknown> | null, opts: { staleMs?: number; invalidateOn?: readonly string[] } = {}): QueryResult<T> & { set: (v: T | ((cur: T | undefined) => T)) => void } {
  const q = useInvokeQuery<T>(cmd, args, opts);
  const key = args ? invokeKey(cmd, args) : null;
  const set = useCallback((v: T | ((cur: T | undefined) => T)) => { if (key) setQueryData<T>(key, v); }, [key]);
  return { ...q, set };
}

/** useEngineQuery for one backend command. `args` null = disabled (no fetch). */
export function useInvokeQuery<T>(cmd: string, args: Record<string, unknown> | null, opts: { staleMs?: number; invalidateOn?: readonly string[] } = {}): QueryResult<T> {
  const key = args ? invokeKey(cmd, args) : null;
  const argsRef = useRef(args);
  argsRef.current = args;
  return useEngineQuery<T>(key, () => invoke<T>(cmd, argsRef.current ?? undefined), opts);
}

/** The cached answer for one command, to seed a page's own state on mount. */
export function peekInvoke<T>(cmd: string, args?: Record<string, unknown>): T | undefined {
  return peekQuery<T>(invokeKey(cmd, args));
}

/** Whether a command has answered before (its answer may be null or empty). */
export function hasInvoke(cmd: string, args?: Record<string, unknown>): boolean {
  return !!cache.get(invokeKey(cmd, args))?.has;
}
