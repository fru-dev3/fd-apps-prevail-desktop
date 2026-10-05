// One store for companies: on open, the engine folds the old app and company
// page trees into data/entities/products (`prevail migrate products --auto`).
// The Rust command only calls the engine when old trees are on disk, and the
// engine decides whether this Mac may run it (the hub goes first). Quiet
// unless it moved something or failed.
export type ProductsMigration = {
  ok: boolean; ran: boolean; skipped?: string; errors?: string[];
  counts?: { liveMoved?: number; pagesMoved?: number; archivedMoved?: number; archivedMerged?: number; doubles?: number };
};

export async function migrateProductsOnOpen(
  vault: string,
  invoke: <T>(cmd: string, args: Record<string, unknown>) => Promise<T>,
  notify: { success: (m: string) => void; error: (m: string) => void },
): Promise<ProductsMigration | null> {
  let r: ProductsMigration;
  try { r = await invoke<ProductsMigration>("engine_products_migrate", { vault }); }
  catch (e) { notify.error(`Could not move apps into Products: ${String(e)}`); return null; }
  if (!r) return null;
  if (!r.ok || (r.errors?.length ?? 0) > 0) { notify.error(`Could not move apps into Products: ${r?.errors?.[0] ?? "unknown error"}`); return r ?? null; }
  if (r.ran) {
    const c = r.counts ?? {};
    const n = (c.liveMoved ?? 0) + (c.pagesMoved ?? 0) + (c.archivedMoved ?? 0) + (c.archivedMerged ?? 0);
    notify.success(n > 0 ? `Moved ${n} apps and company pages into Products, one list.` : "Products are one list now.");
    window.dispatchEvent(new CustomEvent("prevail:entities-changed"));
  }
  return r;
}
