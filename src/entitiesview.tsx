// Entities: every person, place, product and thing the owner has talked
// about, laid out like Projects: the list in a collapsible left sidebar, the
// selected entity's detail in the main pane (a list, then the detail, on a
// phone). Any entity chip in the app lands here with that entity selected
// (entitystore.requestEntity). The Entities page shows one kind per tab
// (`kind`); Products list companies and their apps as one list (the engine's
// products adapter). Intent embeds the all-kinds view.
import { TintIcon } from "./tint";
import { useEffect, useMemo, useState } from "react";
import { VIRTUAL_MIN, VirtualRows } from "./virtualrows";
import { BookUser, CopyCheck, LayoutGrid, Loader2, MapPin, Package, Plus, RefreshCw, Search, Users, Watch, type LucideIcon } from "lucide-react";
import { invoke } from "./bridge";
import { EntityDetailView, KindBadge } from "./entitydetail";
import { DuplicatesPane, cachedDuplicates, loadDuplicates, type DupPair } from "./entitydups";
import { toast } from "./toast";
import {
  loadEntities, lookupEntity, peekRequestedEntity, registerEntitiesView, slugifyName, takeRequestedEntity, useEntityStore,
  type EntityKindName, type EntitySummary, type EntityTarget,
} from "./entitystore";
import { useInvokeQuery } from "./query";
import { NewObject } from "./newobject";
import { kindOfId, takeNew, type ProductRow } from "./ia";
import { SideSpine } from "./sidespine";
import { SettingsHeader } from "./sectionutil";
import { useIsPhone, useStacked } from "./useisphone";
import { isYours } from "./linking";

const GROUPS: { kind: EntityKindName; label: string }[] = [
  { kind: "person", label: "People" },
  { kind: "place", label: "Places" },
  { kind: "product", label: "Products" },
  { kind: "thing", label: "Things" },
];
const FILTERS: { id: "all" | EntityKindName; label: string; icon: LucideIcon }[] = [
  { id: "all", label: "All", icon: LayoutGrid }, { id: "person", label: "People", icon: Users }, { id: "place", label: "Places", icon: MapPin },
  { id: "product", label: "Products", icon: Package }, { id: "thing", label: "Things", icon: Watch },
];
// A product row: one folder in the products store (its page and its app).
type Row = EntitySummary & { apps?: ProductRow["apps"]; company?: boolean };
const productRow = (p: ProductRow): Row => ({
  id: p.id, name: p.name, kind: "product", aliases: [], mention_count: p.conversations, conversations: p.conversations, last_ts: p.last_ts,
  saved: p.saved, has_page: p.has_page, domain: p.domain, website: p.website, picture: p.picture, relation: p.relation, home_domain: p.home_domain,
  apps: p.apps, company: p.company,
});
const PER_GROUP = 60;
const KINDS = new Set<string>(["person", "place", "product", "thing"]);

const targetOf = (e: EntitySummary): EntityTarget => ({ kind: e.kind, value: e.id.slice(e.id.indexOf("/") + 1) });
// The list row a target stands for: the same id, or the entity one of its
// aliases folds into.
const rowIdOf = (t: EntityTarget): string => lookupEntity(t.kind, t.value)?.id ?? `${t.kind}/${slugifyName(t.value)}`;

function EntityRow({ e, on, onPick }: { e: Row; on: boolean; onPick: (e: EntitySummary) => void }) {
  const aka = e.aliases.filter((a) => a.toLowerCase() !== e.name.toLowerCase());
  const live = (e.apps ?? []).filter((a) => !a.archived);
  const app = live.length ? (live[0]!.kind === "service" ? "Service" : live.length === 1 ? "Has an app" : `${live.length} apps`) : "";
  return (
    <li>
      <button type="button" onClick={() => onPick(e)} data-testid="entity-row" aria-current={on ? "true" : undefined}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
        <KindBadge kind={e.kind} name={e.name} domain={e.domain} size={30} entity={e} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={`truncate text-[14px] ${on ? "font-semibold text-text-primary" : "font-medium text-text-primary"}`}>{e.name}</span>
            {e.saved && <span title="Saved to your vault" aria-label="Saved to your vault" className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" data-vault-dot />}
          </span>
          {/* One quiet line, per kind: a product says what it carries, the rest
              their other names. Never the domains they came up in (a person
              can be in ten). */}
          {(app || aka.length > 0) && (
            <span className="block min-w-0 truncate text-[12px] text-text-muted" data-testid={app ? "entity-row-app" : "entity-row-aka"}>
              {app || aka.slice(0, 3).join(", ")}
            </span>
          )}
        </span>
        <span className="shrink-0 text-[12px] tabular-nums text-text-muted" title={`${e.conversations} ${e.conversations === 1 ? "conversation" : "conversations"}`}>{e.conversations}</span>
      </button>
    </li>
  );
}

export function EntitiesView({ vaultPath, embedded = false, kind, onSelected, clearN = 0 }: {
  vaultPath: string; embedded?: boolean;
  /** One kind only (a tab of the Entities page): no kind filter, no page header. */
  kind?: EntityKindName;
  /** The picked entity's name, for the page's breadcrumbs (null when none). */
  onSelected?: (name: string | null) => void;
  /** Changes when the breadcrumbs ask for the list again. */
  clearN?: number;
}) {
  // A kind tab beside the app sidebar stacks below 1100px (list, then detail), like Projects.
  const isPhone = useIsPhone();
  const stacked = useStacked();
  const phone = isPhone || (!!kind && stacked);
  const store = useEntityStore();
  const kindId = kind ? kindOfId(kind)?.id ?? null : null;
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | EntityKindName>(kind ?? "all");
  // New, by talking (the sidebar's + or this column's).
  const [adding, setAdding] = useState(() => (kindId ? takeNew(kindId) : false));
  // Yours (the people and things of your life) or Reference (what only came
  // up, like the people in an essay). Yours by default.
  const [rel, setRel] = useState<"yours" | "reference">("yours");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const mine = (t: EntityTarget | null) => !!t && (kind ? t.kind === kind : KINDS.has(t.kind));
  const [sel, setSel] = useState<(EntityTarget & { n: number }) | null>(() => {
    if (!mine(peekRequestedEntity())) return null;
    const t = takeRequestedEntity();
    return t ? { ...t, n: 0 } : null;
  });
  useEffect(() => { if (clearN) { setSel(null); setAdding(false); setShowDups(false); } }, [clearN]);
  useEffect(() => {
    if (!kindId) return;
    const onNew = (e: Event) => { if ((e as CustomEvent<string>).detail === kindId && takeNew(kindId)) { setAdding(true); setShowDups(false); } };
    window.addEventListener("prevail:ia-new", onNew);
    return () => window.removeEventListener("prevail:ia-new", onNew);
  }, [kindId]);
  // Products: one list over the products store (`entities products`).
  const products = useInvokeQuery<{ products: ProductRow[] } | null>("ia_products", kind === "product" ? { vault: vaultPath } : null, { invalidateOn: ["prevail:entities-changed"] });
  // Pairs that may be one entity, and whether the review is on screen.
  const [dups, setDups] = useState<DupPair[]>(() => cachedDuplicates(vaultPath));
  const [showDups, setShowDups] = useState(false);
  useEffect(() => {
    void loadEntities(vaultPath, true);
    let alive = true;
    void loadDuplicates(vaultPath).then((l) => { if (alive) setDups(l); });
    return () => { alive = false; };
  }, [vaultPath]);
  const dupDone = (pair: string, merged: boolean) => {
    setDups((l) => l.filter((p) => p.pair !== pair));
    if (merged) window.dispatchEvent(new CustomEvent("prevail:entities-changed"));
    void loadDuplicates(vaultPath).then(setDups);
  };

  // A chip clicked while this view is on screen selects in place.
  useEffect(() => {
    const off = registerEntitiesView();
    const onOpen = () => {
      // A request for another kind is left for that kind's view.
      if (!mine(peekRequestedEntity())) return;
      const t = takeRequestedEntity();
      if (!t) return;
      setShowDups(false); setAdding(false);
      setSel((p) => ({ ...t, n: (p?.n ?? 0) + 1 }));
    };
    window.addEventListener("prevail:open-entity", onOpen);
    return () => { off(); window.removeEventListener("prevail:open-entity", onOpen); };
  }, []);

  const storeList = store.vault === vaultPath ? store.list : null;
  const productList = kind === "product" ? products.data : undefined;
  const list: { entities: Row[] } | null = kind === "product"
    ? (Array.isArray(productList?.products) ? { entities: productList!.products.map(productRow) } : products.error ? { entities: [] } : null)
    : storeList ? { entities: kind ? storeList.entities.filter((e) => e.kind === kind) : storeList.entities.filter((e) => KINDS.has(e.kind)) } : null;
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hits = (list?.entities ?? []).filter((e) =>
      (filter === "all" || e.kind === filter)
      && isYours(e) === (rel === "yours")
      && (!needle || e.name.toLowerCase().includes(needle) || e.aliases.some((a) => a.toLowerCase().includes(needle))));
    return GROUPS.map((g) => ({ ...g, items: hits.filter((e) => e.kind === g.kind) })).filter((g) => g.items.length);
  }, [list, q, filter, rel]); // eslint-disable-line react-hooks/exhaustive-deps
  const relCount = useMemo(() => {
    const all = list?.entities ?? [];
    const yours = all.filter(isYours).length;
    return { yours, reference: all.length - yours };
  }, [list]);

  type Group = (typeof groups)[number];
  const shownOf = (g: Group) => (expanded.has(g.kind) || !!q.trim() ? g.items : g.items.slice(0, PER_GROUP));
  const groupHead = (g: Group) => kind ? null : (
    <h2 className="mb-1 flex items-baseline gap-2 px-2.5 text-[13px] font-semibold text-text-secondary">
      {g.label}<span className="text-[12px] font-normal text-text-muted">{g.items.length}</span>
    </h2>
  );
  const moreBtn = (g: Group) => (
    <button onClick={() => setExpanded((s) => new Set(s).add(g.kind))} className="mt-1 px-2.5 text-[13px] font-medium text-accent hover:underline">
      Show all {g.items.length}
    </button>
  );
  // The column as flat rows, for the windowed path.
  type Flat = { k: "h"; g: Group } | { k: "e"; e: Row } | { k: "more"; g: Group };
  const flat: Flat[] = [];
  for (const g of groups) {
    const shown = shownOf(g);
    flat.push({ k: "h", g });
    for (const e of shown) flat.push({ k: "e", e });
    if (g.items.length > shown.length) flat.push({ k: "more", g });
  }

  // On a wide screen the detail is never empty: it opens on the most
  // discussed entity until one is picked.
  const first = list?.entities.find((e) => isYours(e) === (rel === "yours")) ?? null;
  const target: EntityTarget | null = sel ?? (!phone && first ? targetOf(first) : null);
  const selectedId = target ? rowIdOf(target) : null;
  const pick = (e: EntitySummary) => { setShowDups(false); setAdding(false); setSel((p) => ({ ...targetOf(e), n: (p?.n ?? 0) + 1 })); };
  const selRow = selectedId ? (list?.entities ?? []).find((e) => e.id === selectedId) : undefined;
  // The object on screen (picked, or the one a wide screen opens on) names the last crumb.
  const selName = adding ? `New ${kindId ? kindOfId(kind!)?.singular.toLowerCase() : "entity"}` : target ? (selRow?.name ?? lookupEntity(target.kind, target.value)?.name ?? target.value.replace(/-/g, " ")) : null;
  useEffect(() => { onSelected?.(selName); }, [selName]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => {
    setBusy(true);
    try {
      const r = await invoke<{ entities: number; pages_created: number; digests_written: number; merged?: number }>("entities_refresh", { vault: vaultPath });
      toast(r.merged && r.merged > 0
        ? `Merged ${r.merged} duplicate ${r.merged === 1 ? "entity" : "entities"}.`
        : `${r.entities} entities, ${r.pages_created} new pages, ${r.digests_written} summaries updated`);
      await loadEntities(vaultPath, true);
      setDups(await loadDuplicates(vaultPath));
    } catch (e) { toast.error(`Refresh failed: ${String(e)}`); } finally { setBusy(false); }
  };

  const listPane = (
    <div className="p-2">
      <label className="mx-1 mt-1 flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-2.5 focus-within:border-accent-border">
        <Search className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names" aria-label="Search entities"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-text-primary outline-none placeholder:text-text-muted" />
      </label>
      <div role="tablist" aria-label="Yours or reference" data-testid="entity-relation-filter" className="mx-1 mt-2 flex flex-nowrap rounded-lg bg-surface-warm p-0.5">
        {(["yours", "reference"] as const).map((r) => (
          <button key={r} role="tab" aria-selected={rel === r} data-testid={`entity-relation-${r}`} onClick={() => setRel(r)}
            title={r === "yours" ? "The people, places and things of your life" : "Only came up in conversation, like the people in an essay"}
            className={`inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[13px] ${rel === r ? "bg-surface font-semibold text-text-primary shadow-sm ring-1 ring-black/5" : "text-text-muted hover:text-text-secondary"}`}>
            {r === "yours" ? "Yours" : "Reference"}<span className="text-[12px] font-normal tabular-nums text-text-muted">{relCount[r]}</span>
          </button>
        ))}
      </div>
      {!kind && <div role="tablist" aria-label="Entity kind" data-testid="entity-kind-filter" className="mx-1 mt-2 flex flex-wrap rounded-lg bg-surface-warm p-0.5">
        {FILTERS.map((f) => (
          <button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)} data-testid={`entity-filter-${f.id}`}
            className={`inline-flex h-7 min-w-0 flex-auto items-center justify-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[12px] ${filter === f.id ? "bg-surface font-semibold text-text-primary shadow-sm ring-1 ring-black/5" : "text-text-muted hover:text-text-secondary"}`}>
            <TintIcon icon={f.icon} tint={f.id} square={false} />
            {f.label}
          </button>
        ))}
      </div>}
      {dups.length > 0 && (
        <button type="button" onClick={() => setShowDups(true)} data-testid="entity-dups-row" aria-current={showDups ? "true" : undefined}
          className={`mx-0 mt-3 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] font-medium text-text-primary transition-colors ${showDups ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-accent-border bg-accent-soft text-accent"><CopyCheck className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1 truncate">Possible duplicates ({dups.length})</span>
        </button>
      )}
      {!list && <div className="flex items-center gap-2 px-2 py-6 text-[14px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" />Reading your vault</div>}
      {list && groups.length === 0 && (
        <div className="px-2 py-8 text-center">
          <p className="text-[14px] font-medium text-text-primary">{q || (!kind && filter !== "all") ? "Nothing matches" : rel === "reference" ? "No references" : `No ${kind ? GROUPS.find((g) => g.kind === kind)?.label.toLowerCase() ?? "entities" : "entities"} yet`}</p>
          <p className="mt-1 text-[12px] text-text-muted">{q || (!kind && filter !== "all") ? "Try another name or kind." : rel === "reference" ? "What only comes up in conversation, like the people in an essay, lands here." : "They appear as you chat. Add one with the +."}</p>
        </div>
      )}
      {flat.length > VIRTUAL_MIN
        // A large vault: one windowed list of kind headings, rows and "Show all".
        ? <VirtualRows items={flat} estimate={44} getKey={(r) => (r.k === "e" ? r.e.id : `${r.k}:${r.g.kind}`)}
            render={(r) => r.k === "h" ? <div className="pt-4">{groupHead(r.g)}</div>
              : r.k === "more" ? moreBtn(r.g)
              : <ul><EntityRow key={r.e.id} e={r.e} on={r.e.id === selectedId} onPick={pick} /></ul>} />
        : groups.map((g) => {
        const shown = shownOf(g);
        return (
          <section key={g.kind} aria-label={g.label} className="mt-4">
            {groupHead(g)}
            <ul>{shown.map((e) => <EntityRow key={e.id} e={e} on={e.id === selectedId} onPick={pick} />)}</ul>
            {g.items.length > shown.length && moreBtn(g)}
          </section>
        );
      })}
    </div>
  );

  const addBtn = kindId ? (
    <button onClick={() => { setAdding(true); setShowDups(false); }} data-testid="entities-new" title={`New ${kindOfId(kind!)?.singular.toLowerCase()}, by talking`} aria-label={`New ${kindOfId(kind!)?.singular.toLowerCase()}`}
      className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-warm hover:text-accent">
      <Plus className="h-4 w-4" />
    </button>
  ) : null;
  const refreshBtn = (
    <button onClick={refresh} disabled={busy} data-testid="entities-refresh"
      title={busy ? "Refreshing" : "Refresh: rebuild the index, pages and summaries"} aria-label="Refresh entities"
      className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-60">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
    </button>
  );
  const meta = list ? `${list.entities.length} · ${list.entities.filter((e) => e.saved).length} saved` : undefined;

  const detail = adding && kindId
    ? <NewObject vaultPath={vaultPath} kind={kindId} onCancel={() => setAdding(false)} onMade={(id) => {
        setAdding(false);
        void loadEntities(vaultPath, true);
        setSel((p) => ({ kind: id.split("/")[0] as EntityKindName, value: id.slice(id.indexOf("/") + 1), n: (p?.n ?? 0) + 1 }));
      }} />
    : showDups
    ? <DuplicatesPane vault={vaultPath} pairs={dups} onDone={dupDone} />
    : target
    ? <EntityDetailView key={`${target.kind}/${target.value}:${sel?.n ?? 0}`} vaultPath={vaultPath} target={target} />
    : list && !phone ? <p className="text-[13px] text-text-muted">Pick someone or something on the left.</p> : null;

  return (
    <div className={`flex ${embedded ? "min-h-0 flex-1" : "h-full min-h-0"} flex-col`} data-testid="entities-view">
      {!embedded && !kind && <SettingsHeader icon={BookUser} title="Entities" subtitle="People, places, products and things from your conversations." />}
      <SideSpine storageKey={kind ? `prevail.entities.spine.${kind}` : "prevail.entities.spine"} title={kind ? GROUPS.find((g) => g.kind === kind)?.label ?? "Entities" : "Entities"} label={kind ? GROUPS.find((g) => g.kind === kind)?.label.toLowerCase() ?? "entities" : "entities"} testId="entities-list" meta={meta}
        actions={<>{addBtn}{refreshBtn}</>}
        phone={phone} phoneDetail={sel !== null || showDups || adding} onBack={() => { setSel(null); setShowDups(false); setAdding(false); }} backLabel={kind ? `All ${GROUPS.find((g) => g.kind === kind)?.label.toLowerCase()}` : "All entities"}
        detail={adding ? detail : <div className={isPhone ? "p-4" : "flex h-full min-h-0 flex-col px-6 pb-4 pt-6"}>{detail}</div>}>
        {listPane}
      </SideSpine>
    </div>
  );
}
