// The vault's entity pages, shared by every chip, the chat directive and the
// Entities view. One engine call (`entities_list`) fills it; anything that
// saves or edits an entity fires `prevail:entities-changed` and it reloads.
// Chips read it synchronously so a transcript never waits on the engine.
import { useSyncExternalStore } from "react";
import { invoke } from "./bridge";

export type EntityKindName = "person" | "place" | "org" | "thing";

export interface EntitySummary {
  id: string;
  name: string;
  kind: EntityKindName;
  aliases: string[];
  mention_count: number;
  conversations: number;
  last_ts: number;
  saved: boolean;
  has_page: boolean;
  domain?: string;
}

export interface EntityList { generated_ts: number; total: number; entities: EntitySummary[] }

// Mirrors the engine's slugify (entities.ts) so a chip's name maps to the
// same id the engine files it under.
export function slugifyName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

interface State { vault: string | null; list: EntityList | null; byId: Map<string, EntitySummary>; bySlug: Map<string, EntitySummary> }

let state: State = { vault: null, list: null, byId: new Map(), bySlug: new Map() };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function emit() { for (const l of listeners) l(); }

function index(list: EntityList | null): State {
  const byId = new Map<string, EntitySummary>();
  const bySlug = new Map<string, EntitySummary>();
  for (const e of list?.entities ?? []) {
    byId.set(e.id, e);
    const slug = e.id.slice(e.id.indexOf("/") + 1);
    const prev = bySlug.get(`${e.kind}:${slug}`);
    if (!prev) bySlug.set(`${e.kind}:${slug}`, e);
    for (const a of e.aliases) {
      const k = `${e.kind}:${slugifyName(a)}`;
      if (!bySlug.has(k)) bySlug.set(k, e);
    }
  }
  return { vault: state.vault, list, byId, bySlug };
}

export function loadEntities(vault: string, force = false): Promise<void> {
  if (!vault) return Promise.resolve();
  if (!force && state.vault === vault && state.list) return Promise.resolve();
  if (inflight && !force) return inflight;
  state = { ...state, vault };
  inflight = invoke<EntityList>("entities_list", { vault, limit: 5000 })
    .then((list) => { if (state.vault === vault) { state = index(list); emit(); } })
    .catch(() => { /* engine missing or old: chips just show no vault dot */ })
    .finally(() => { inflight = null; });
  return inflight;
}

export function setEntityVault(vault: string | null) {
  if (!vault || vault === state.vault) return;
  state = { vault, list: null, byId: new Map(), bySlug: new Map() };
  void loadEntities(vault);
}

if (typeof window !== "undefined") {
  window.addEventListener("prevail:entities-changed", () => { if (state.vault) void loadEntities(state.vault, true); });
}

export function lookupEntity(kind: string, value: string): EntitySummary | null {
  return state.bySlug.get(`${kind}:${slugifyName(value)}`) ?? null;
}

export function entitySnapshot(): State { return state; }

function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

export function useEntityStore(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

// The owner's own pages, for the chat directive: saved ones first, then the
// rest of the vault-backed pages, most discussed first.
export function savedEntitiesForDirective(cap = 40): { name: string; id: string }[] {
  const pages = (state.list?.entities ?? []).filter((e) => e.has_page);
  pages.sort((a, b) => Number(b.saved) - Number(a.saved) || b.conversations - a.conversations);
  return pages.slice(0, cap).map((e) => ({ name: e.name, id: e.id }));
}

// Test seam: install a list without the engine.
export function __setEntityListForTest(vault: string | null, list: EntityList | null) {
  state = { ...index(list), vault };
  emit();
}
