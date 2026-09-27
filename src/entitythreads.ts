// Entity chat, the light half (no chat panel): the conversations about one
// entity from the engine (`entities threads`), and a thread slug to its file.
// `updated` is epoch milliseconds.
import { invoke } from "./bridge";
import type { ThreadMeta } from "./types";

export type EntityThread = { slug: string; domain?: string | null; title: string; updated: number; turns: number };

/** The conversations about one entity, newest first. */
export async function loadEntityThreads(vaultPath: string, id: string): Promise<EntityThread[]> {
  const r = await invoke<EntityThread[] | { threads?: EntityThread[] }>("engine_entity_threads", { vault: vaultPath, id }).catch(() => null);
  const list = Array.isArray(r) ? r : Array.isArray(r?.threads) ? r!.threads! : [];
  return list.filter((t) => t && typeof t.slug === "string").sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
}

/** A thread slug to the file the chat opens, looked up the way the rail lists it. */
export async function resolveThreadPath(vaultPath: string, t: EntityThread): Promise<string | null> {
  const dom = t.domain && t.domain !== "general" ? t.domain : null;
  const list = await invoke<ThreadMeta[]>("list_threads", { vault: vaultPath, domain: dom }).catch(() => []);
  const hit = (Array.isArray(list) ? list : []).find((m) => m.slug === t.slug || m.path.endsWith(`/${t.slug}.md`));
  return hit?.path ?? null;
}

