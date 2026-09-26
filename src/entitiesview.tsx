// Entities: every person, place, company/product and thing the owner has
// talked about, laid out like Projects: the list in a collapsible left
// sidebar, the selected entity's detail in the main pane (a list, then the
// detail, on a phone). Any entity chip in the app lands here with that entity
// selected (entitystore.requestEntity). Reached from the sidebar (Entities)
// and from Intent.
import { useEffect, useMemo, useState } from "react";
import { BookUser, Loader2, RefreshCw, Search } from "lucide-react";
import { invoke } from "./bridge";
import { EntityDetailView, KindBadge } from "./entitydetail";
import {
  loadEntities, lookupEntity, registerEntitiesView, slugifyName, takeRequestedEntity, useEntityStore,
  type EntityKindName, type EntitySummary, type EntityTarget,
} from "./entitystore";
import { SideSpine, STICKY_HEAD } from "./sidespine";
import { useIsPhone } from "./useisphone";

const GROUPS: { kind: EntityKindName; label: string }[] = [
  { kind: "person", label: "People" },
  { kind: "place", label: "Places" },
  { kind: "org", label: "Companies" },
  { kind: "thing", label: "Things" },
];
const FILTERS: { id: "all" | EntityKindName; label: string }[] = [
  { id: "all", label: "All" }, { id: "person", label: "People" }, { id: "place", label: "Places" }, { id: "org", label: "Companies" }, { id: "thing", label: "Things" },
];
const PER_GROUP = 60;
const KINDS = new Set<string>(["person", "place", "org", "thing"]);

const targetOf = (e: EntitySummary): EntityTarget => ({ kind: e.kind, value: e.id.slice(e.id.indexOf("/") + 1) });
// The list row a target stands for: the same id, or the entity one of its
// aliases folds into.
const rowIdOf = (t: EntityTarget): string => lookupEntity(t.kind, t.value)?.id ?? `${t.kind}/${slugifyName(t.value)}`;

function Row({ e, on, onPick }: { e: EntitySummary; on: boolean; onPick: (e: EntitySummary) => void }) {
  return (
    <li>
      <button type="button" onClick={() => onPick(e)} data-testid="entity-row" aria-current={on ? "true" : undefined}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
        <KindBadge kind={e.kind} name={e.name} domain={e.domain} size={30} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={`truncate text-[14px] ${on ? "font-semibold text-text-primary" : "font-medium text-text-primary"}`}>{e.name}</span>
            {e.saved && <span title="Saved to your vault" aria-label="Saved to your vault" className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" data-vault-dot />}
          </span>
          {e.aliases.length > 0 && <span className="block truncate text-[12px] text-text-muted">{e.aliases.slice(0, 3).join(", ")}</span>}
        </span>
        <span className="shrink-0 text-[12px] tabular-nums text-text-muted" title={`${e.conversations} ${e.conversations === 1 ? "conversation" : "conversations"}`}>{e.conversations}</span>
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
  const [sel, setSel] = useState<(EntityTarget & { n: number }) | null>(() => {
    const t = takeRequestedEntity();
    return t ? { ...t, n: 0 } : null;
  });
  useEffect(() => { void loadEntities(vaultPath, true); }, [vaultPath]);

  // A chip clicked while this view is on screen selects in place.
  useEffect(() => {
    const off = registerEntitiesView();
    const onOpen = () => {
      const t = takeRequestedEntity();
      if (t && KINDS.has(t.kind)) setSel((p) => ({ ...t, n: (p?.n ?? 0) + 1 }));
    };
    window.addEventListener("prevail:open-entity", onOpen);
    return () => { off(); window.removeEventListener("prevail:open-entity", onOpen); };
  }, []);

  const list = store.vault === vaultPath ? store.list : null;
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hits = (list?.entities ?? []).filter((e) =>
      (filter === "all" || e.kind === filter)
      && (!needle || e.name.toLowerCase().includes(needle) || e.aliases.some((a) => a.toLowerCase().includes(needle))));
    return GROUPS.map((g) => ({ ...g, items: hits.filter((e) => e.kind === g.kind) })).filter((g) => g.items.length);
  }, [list, q, filter]);

  // On a wide screen the detail is never empty: it opens on the most
  // discussed entity until one is picked.
  const first = list?.entities[0] ?? null;
  const target: EntityTarget | null = sel ?? (!phone && first ? targetOf(first) : null);
  const selectedId = target ? rowIdOf(target) : null;
  const pick = (e: EntitySummary) => setSel((p) => ({ ...targetOf(e), n: (p?.n ?? 0) + 1 }));

  const refresh = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await invoke<{ entities: number; pages_created: number; digests_written: number }>("entities_refresh", { vault: vaultPath });
      setNote(`${r.entities} entities, ${r.pages_created} new pages, ${r.digests_written} summaries updated`);
      await loadEntities(vaultPath, true);
    } catch (e) { setNote(`Refresh failed: ${String(e)}`); } finally { setBusy(false); }
  };

  const listPane = (
    <div className="p-2">
      <label className="mx-1 mt-1 flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-2.5 focus-within:border-accent-border">
        <Search className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names" aria-label="Search entities"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-text-primary outline-none placeholder:text-text-muted" />
      </label>
      <div role="tablist" aria-label="Entity kind" className="mx-1 mt-2 flex flex-wrap gap-0.5">
        {FILTERS.map((f) => (
          <button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
            className={`inline-flex h-7 items-center rounded-md px-1.5 text-[12px] ${filter === f.id ? "bg-surface font-semibold text-text-primary shadow-sm ring-1 ring-black/5" : "text-text-muted hover:text-text-secondary"}`}>
            {f.label}
          </button>
        ))}
      </div>
      {!list && <div className="flex items-center gap-2 px-2 py-6 text-[14px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" />Reading your vault</div>}
      {list && groups.length === 0 && (
        <div className="px-2 py-8 text-center">
          <p className="font-display text-lg font-semibold text-text-primary">{q || filter !== "all" ? "Nothing matches" : "No entities yet"}</p>
          <p className="mt-1 text-[13px] text-text-muted">{q || filter !== "all" ? "Try another name or kind." : "They appear as you chat, and as Intent reads your prompts."}</p>
        </div>
      )}
      {groups.map((g) => {
        const all = expanded.has(g.kind) || !!q.trim();
        const shown = all ? g.items : g.items.slice(0, PER_GROUP);
        return (
          <section key={g.kind} aria-label={g.label} className="mt-4">
            <h2 className="mb-1 flex items-baseline gap-2 px-2.5 font-display text-[17px] font-semibold text-text-primary">
              {g.label}<span className="text-[13px] font-normal text-text-muted">{g.items.length}</span>
            </h2>
            <ul>{shown.map((e) => <Row key={e.id} e={e} on={e.id === selectedId} onPick={pick} />)}</ul>
            {g.items.length > shown.length && (
              <button onClick={() => setExpanded((s) => new Set(s).add(g.kind))} className="mt-1 px-2.5 text-[13px] font-medium text-accent hover:underline">
                Show all {g.items.length}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );

  const toolbar = (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-subtle ${phone ? "px-4" : "px-6"} py-3 text-[13px] text-text-muted`}>
      <span>{list ? `${list.entities.length} entities, ${list.entities.filter((e) => e.saved).length} saved` : "Entities"}</span>
      {note && <span>{note}</span>}
      {!phone && (
        <button onClick={refresh} disabled={busy} title="Rebuild the index, pages and summaries"
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-60">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}{busy ? "Refreshing" : "Refresh"}
        </button>
      )}
    </div>
  );

  const detail = target
    ? <EntityDetailView key={`${target.kind}/${target.value}:${sel?.n ?? 0}`} vaultPath={vaultPath} target={target} />
    : list && !phone ? <p className="text-[15px] text-text-muted">Pick someone or something on the left.</p> : null;

  return (
    <div className={`flex ${embedded ? "min-h-0 flex-1" : "h-full min-h-0"} flex-col bg-background`} data-testid="entities-view">
      <div data-testid="page-header" className={`shrink-0 ${embedded ? "" : STICKY_HEAD}`}>
      {!embedded && !phone && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border px-8 py-5">
          <h1 className="flex items-center gap-2.5 font-display text-3xl font-semibold tracking-tight text-text-primary">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent-border bg-accent-soft text-accent"><BookUser className="h-5 w-5" /></span>
            Entities
          </h1>
          <p className="text-[14px] text-text-muted">People, places, companies and things from your conversations.</p>
        </div>
      )}
      {toolbar}
      </div>
      <SideSpine storageKey="prevail.entities.spine" title="Entities" label="entities" testId="entities-list"
        phone={phone} phoneDetail={sel !== null} onBack={() => setSel(null)} backLabel="All entities"
        detail={<div className={phone ? "p-4" : "p-6"}>{detail}</div>}>
        {listPane}
      </SideSpine>
    </div>
  );
}
