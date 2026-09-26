// Entities: every person, place, company/product and thing the owner has
// talked about, grouped by kind, most discussed first. A row opens the entity
// card. Reached from the sidebar (Entities) and from Intent.
import { useEffect, useMemo, useState } from "react";
import { BookUser, Loader2, RefreshCw, Search } from "lucide-react";
import { invoke } from "./bridge";
import { KindBadge } from "./entitycard";
import { loadEntities, useEntityStore, type EntityKindName, type EntitySummary } from "./entitystore";
import { useIsPhone } from "./useisphone";

const GROUPS: { kind: EntityKindName; label: string }[] = [
  { kind: "person", label: "People" },
  { kind: "place", label: "Places" },
  { kind: "org", label: "Companies and products" },
  { kind: "thing", label: "Things" },
];
const FILTERS: { id: "all" | EntityKindName; label: string }[] = [
  { id: "all", label: "All" }, { id: "person", label: "People" }, { id: "place", label: "Places" }, { id: "org", label: "Companies" }, { id: "thing", label: "Things" },
];
const PER_GROUP = 60;

function open(e: EntitySummary) {
  window.dispatchEvent(new CustomEvent("prevail:open-entity", { detail: { kind: e.kind, value: e.id.slice(e.id.indexOf("/") + 1) } }));
}

function Row({ e }: { e: EntitySummary }) {
  return (
    <li>
      <button type="button" onClick={() => open(e)} data-testid="entity-row"
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-warm">
        <KindBadge kind={e.kind} name={e.name} domain={e.domain} size={36} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-medium text-text-primary">{e.name}</span>
            {e.has_page && <span title="In your vault" aria-label="In your vault" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
          </span>
          {e.aliases.length > 0 && <span className="block truncate text-[13px] text-text-muted">{e.aliases.slice(0, 3).join(", ")}</span>}
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[14px] font-semibold tabular-nums text-text-primary">{e.conversations}</span>
          <span className="block text-[12px] text-text-muted">{e.conversations === 1 ? "conversation" : "conversations"}</span>
        </span>
      </button>
    </li>
  );
}

export function EntitiesView({ vaultPath, embedded = false }: { vaultPath: string; embedded?: boolean }) {
  const phone = useIsPhone();
  const store = useEntityStore();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | EntityKindName>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { void loadEntities(vaultPath, true); }, [vaultPath]);

  const list = store.vault === vaultPath ? store.list : null;
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hits = (list?.entities ?? []).filter((e) =>
      (filter === "all" || e.kind === filter)
      && (!needle || e.name.toLowerCase().includes(needle) || e.aliases.some((a) => a.toLowerCase().includes(needle))));
    return GROUPS.map((g) => ({ ...g, items: hits.filter((e) => e.kind === g.kind) })).filter((g) => g.items.length);
  }, [list, q, filter]);

  const refresh = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await invoke<{ entities: number; pages_created: number; digests_written: number }>("entities_refresh", { vault: vaultPath });
      setNote(`${r.entities} entities, ${r.pages_created} new pages, ${r.digests_written} summaries updated`);
      await loadEntities(vaultPath, true);
    } catch (e) { setNote(`Refresh failed: ${String(e)}`); } finally { setBusy(false); }
  };

  const pad = phone ? "px-4" : "px-8";
  return (
    <div className="flex min-h-full flex-col bg-background" data-testid="entities-view">
      {!embedded && (
        <div className={`flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border ${phone ? "px-4 py-3" : "px-8 py-5"}`}>
          <h1 className="flex items-center gap-2.5 font-display text-3xl font-semibold tracking-tight text-text-primary">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent-border bg-accent-soft text-accent"><BookUser className="h-5 w-5" /></span>
            Entities
          </h1>
          <p className="text-[14px] text-text-muted max-sm:order-3 max-sm:w-full">People, places, companies and things from your conversations.</p>
        </div>
      )}
      <div className={`flex flex-wrap items-center gap-3 ${pad} pt-5`}>
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-accent-border sm:max-w-sm">
          <Search className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names" aria-label="Search entities"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-text-primary outline-none placeholder:text-text-muted" />
        </label>
        <div role="tablist" aria-label="Entity kind" className="flex max-w-full items-center overflow-x-auto rounded-lg bg-surface-warm p-1">
          {FILTERS.map((f) => (
            <button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
              className={`h-8 shrink-0 rounded-md px-3 text-[13px] ${filter === f.id ? "bg-background font-semibold text-text-primary shadow-sm" : "text-text-muted hover:text-text-secondary"}`}>
              {f.label}
            </button>
          ))}
        </div>
        {!phone && (
          <button onClick={refresh} disabled={busy} title="Rebuild the index and page summaries"
            className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Refresh
          </button>
        )}
      </div>
      {note && <div className={`${pad} pt-2 text-[13px] text-text-muted`}>{note}</div>}
      <div className={`${pad} pb-10 pt-4`}>
        {!list && <div className="flex items-center gap-2 py-8 text-[14px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" />Reading your vault</div>}
        {list && groups.length === 0 && (
          <div className="py-10 text-center">
            <p className="font-display text-xl font-semibold text-text-primary">{q || filter !== "all" ? "Nothing matches" : "No entities yet"}</p>
            <p className="mt-1 text-[14px] text-text-muted">{q || filter !== "all" ? "Try another name or kind." : "They appear as you chat, and as Intent reads your prompts."}</p>
          </div>
        )}
        <div className="grid gap-8">
          {groups.map((g) => {
            const all = expanded.has(g.kind);
            const shown = all ? g.items : g.items.slice(0, PER_GROUP);
            return (
              <section key={g.kind} aria-label={g.label}>
                <h2 className="mb-2 flex items-baseline gap-2 font-display text-xl font-semibold text-text-primary">
                  {g.label}<span className="text-[14px] font-normal text-text-muted">{g.items.length}</span>
                </h2>
                <ul className="grid gap-0.5 lg:grid-cols-2">{shown.map((e) => <Row key={e.id} e={e} />)}</ul>
                {g.items.length > shown.length && (
                  <button onClick={() => setExpanded((s) => new Set(s).add(g.kind))} className="mt-2 px-3 text-[13px] font-medium text-accent hover:underline">
                    Show all {g.items.length}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
