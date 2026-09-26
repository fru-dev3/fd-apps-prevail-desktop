// Sources: where Prevail gets context for conversations. One calm table of
// every source (the vault, Obsidian vaults, folders, websites) with its status,
// an in-flow detail for each, and an in-flow "Add source" flow. No drawers, no
// side cards: the content column swaps between list, detail and add (Intent
// page template: sticky header, SideSpine filter column, one content column).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, ArrowLeft, Check, ChevronRight, ExternalLink, FileText, FolderOpen, Globe, Loader2, Lock, Plus,
  RefreshCw, Search, Trash2, Waypoints,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { invoke, listen } from "./bridge";
import { SideSpine, STICKY_HEAD } from "./sidespine";
import { useIsPhone } from "./useisphone";
import { Toggle } from "./ui";
import { VaultManageSection } from "./settings8";
import {
  KIND_META, KindIcon, addSource, fmtAgo, fmtCount, fmtNext, listSources, openCitation, refreshSources, removeSource,
  setSourceEnabled, sourcesForMessage, type SourceCitation, type SourceKind, type SourceRow, type WebSite,
} from "./sourceslib";

type Filter = "all" | SourceKind;
type View = { mode: "list" } | { mode: "detail"; id: string } | { mode: "add"; kind: SourceKind | null };

const KINDS: SourceKind[] = ["prevail", "obsidian", "folder", "website"];
// Fru's canonical site: offered as a one-click start in the website form.
const SUGGESTED_SITES = ["fru.dev"];

export function SourcesPanel({ vaultPath, initialDetail, onSetupDomains, onVaultMoved }: {
  vaultPath: string;
  // Open straight onto one source (the old Vault deep links open the vault).
  initialDetail?: string;
  onSetupDomains?: () => void;
  onVaultMoved?: (path: string) => void;
}) {
  const phone = useIsPhone();
  const [rows, setRows] = useState<SourceRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<View>(initialDetail ? { mode: "detail", id: initialDetail } : { mode: "list" });
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    try {
      const r = await listSources(vaultPath);
      if (alive.current) { setRows(r); setErr(null); }
    } catch (e) {
      if (alive.current) setErr(e instanceof Error ? e.message : String(e));
    }
  }, [vaultPath]);
  useEffect(() => { setRows(null); void load(); }, [load]);
  useEffect(() => {
    let off: (() => void) | null = null;
    void listen("prevail:sources-changed", () => { void load(); }).then((u) => { off = u; }).catch(() => {});
    return () => { off?.(); };
  }, [load]);
  // While anything is indexing, keep the table live.
  const indexing = (rows ?? []).some((r) => r.status.state === "indexing") || busy.size > 0;
  useEffect(() => {
    if (!indexing) return;
    const t = setInterval(() => { void load(); }, 2500);
    return () => clearInterval(t);
  }, [indexing, load]);

  const refresh = useCallback(async (ids?: string[], force = false) => {
    const key = ids?.length ? ids : ["*"];
    setBusy((b) => new Set([...b, ...key]));
    setNote(null);
    try {
      const r = await refreshSources(vaultPath, { ids, force });
      if (r.busy) setNote("A refresh is already running. The table updates when it finishes.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((b) => { const n = new Set(b); for (const k of key) n.delete(k); return n; });
      void load();
    }
  }, [vaultPath, load]);

  const toggle = async (r: SourceRow, on: boolean) => {
    setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, enabled: on } : x)) ?? rs);
    try { await setSourceEnabled(vaultPath, r.id, on); } catch (e) { setNote(String(e)); }
    void load();
  };

  const remove = async (r: SourceRow) => {
    try {
      const out = await removeSource(vaultPath, r.id);
      setNote(out.keptImport ? `Removed ${r.name}. Its imported notes stay in the vault.` : `Removed ${r.name}. Nothing in the folder or site was touched.`);
      setView({ mode: "list" });
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    void load();
  };

  const onAdded = (r: SourceRow) => {
    setView({ mode: "list" });
    setFilter("all");
    setRows((rs) => [...(rs ?? []), { ...r, resolvedLocation: r.location, status: { state: "indexing", lastIndexed: null, items: 0, nextRefresh: null, error: null } }]);
    void refresh([r.id]);
  };

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, prevail: 0, obsidian: 0, folder: 0, website: 0 };
    for (const r of rows ?? []) { c.all++; c[r.kind]++; }
    return c;
  }, [rows]);
  const shown = (rows ?? []).filter((r) => filter === "all" || r.kind === filter);
  const on = (rows ?? []).filter((r) => r.enabled);
  const items = on.reduce((n, r) => n + (r.status.items || 0), 0);
  const selected = view.mode === "detail" ? rows?.find((r) => r.id === view.id) ?? null : null;

  const addButton = (
    <button onClick={() => setView({ mode: "add", kind: null })} data-testid="add-source"
      className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[14px] font-semibold text-background transition-colors hover:bg-accent-hover">
      <Plus className="h-4 w-4" />Add source
    </button>
  );
  const header = (
    <div data-testid="page-header" className={STICKY_HEAD}>
      {/* On a phone the shell's header bar already names the page. */}
      {!phone ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border px-8 py-5">
          <h1 className="flex items-center gap-2.5 font-display text-3xl font-semibold tracking-tight text-text-primary">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent-border bg-accent-soft text-accent"><Waypoints className="h-5 w-5" /></span>
            Sources
          </h1>
          <p className="text-[14px] text-text-muted">Where Prevail gets context for your conversations.</p>
          {addButton}
        </div>
      ) : (
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <p className="min-w-0 flex-1 text-[13px] text-text-muted">Where Prevail gets context for your conversations.</p>
          {addButton}
        </div>
      )}
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-subtle ${phone ? "px-4" : "px-6"} py-3 text-[13px] text-text-muted`}>
        <span data-testid="sources-summary">
          {rows ? `${on.length} of ${rows.length} source${rows.length === 1 ? "" : "s"} on, ${fmtCount(items)} items indexed` : "Reading sources"}
        </span>
        {note && <span className="text-text-secondary">{note}</span>}
        <button onClick={() => void refresh(undefined)} disabled={busy.has("*")} title="Index every source that is on (sites only re-read what changed)"
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-60">
          {busy.has("*") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}{busy.has("*") ? "Refreshing" : "Refresh all"}
        </button>
      </div>
    </div>
  );

  const typeNav = (
    <nav aria-label="Source types" data-testid="source-types" className="p-2">
      {(["all", ...KINDS] as Filter[]).map((f) => {
        const active = filter === f && view.mode === "list";
        return (
          <button key={f} onClick={() => { setFilter(f); setView({ mode: "list" }); }} aria-current={active ? "true" : undefined}
            className={`mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${active ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${f === "all" ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-secondary"}`}>
              {f === "all" ? <Waypoints className="h-4 w-4" /> : <KindIcon kind={f} className="h-4 w-4" />}
            </span>
            <span className={`min-w-0 flex-1 truncate text-[14px] ${active ? "font-semibold text-text-primary" : "font-medium text-text-secondary"}`}>{f === "all" ? "All sources" : KIND_META[f].plural}</span>
            <span className="shrink-0 tabular-nums text-[12px] text-text-muted">{counts[f]}</span>
          </button>
        );
      })}
    </nav>
  );

  let content: React.ReactNode;
  if (view.mode === "add") {
    content = <AddSource vaultPath={vaultPath} initialKind={view.kind} existing={rows ?? []} onCancel={() => setView({ mode: "list" })} onAdded={onAdded} />;
  } else if (view.mode === "detail" && selected) {
    content = (
      <SourceDetail row={selected} vaultPath={vaultPath} busy={busy.has(selected.id)} onBack={() => setView({ mode: "list" })}
        onToggle={(v) => void toggle(selected, v)} onRefresh={() => void refresh([selected.id], true)} onRemove={() => void remove(selected)}
        onSetupDomains={onSetupDomains} onVaultMoved={onVaultMoved} />
    );
  } else {
    content = (
      <div className={phone ? "p-4" : "p-6"}>
        {err && <div className="mb-4 flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-[13px] text-warn"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{err}</div>}
        {!rows && !err && <div className="flex items-center gap-2 py-6 text-[14px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" />Reading sources</div>}
        {rows && (
          <SourcesTable rows={shown} busy={busy} onOpen={(r) => setView({ mode: "detail", id: r.id })}
            onToggle={(r, v) => void toggle(r, v)} onRefresh={(r) => void refresh([r.id], true)} onRemove={(r) => void remove(r)}
            onAdd={() => setView({ mode: "add", kind: filter === "all" ? null : filter })} filter={filter} />
        )}
        {rows && <TryQuestion vaultPath={vaultPath} disabled={items === 0} />}
      </div>
    );
  }

  return (
    <div className={`flex flex-col bg-background ${phone ? "min-h-full" : "min-h-[calc(100vh-28px)]"}`} data-testid="sources-view">
      {header}
      {phone ? (
        <div className="min-h-0 flex-1">{content}</div>
      ) : (
        <SideSpine storageKey="prevail.sources.spine" title="Types" label="source types" testId="sources-spine" detail={content}>
          {typeNav}
        </SideSpine>
      )}
    </div>
  );
}

// ── The table ───────────────────────────────────────────────────────────

function StatusCell({ r, busy }: { r: SourceRow; busy: boolean }) {
  const st = r.status;
  if (!r.enabled) return <span className="text-text-muted">Off</span>;
  if (busy || st.state === "indexing") return <span className="inline-flex items-center gap-1.5 text-accent"><Loader2 className="h-3.5 w-3.5 animate-spin" />Indexing</span>;
  if (st.state === "error") return <span className="inline-flex min-w-0 items-center gap-1.5 text-warn" title={st.error ?? ""}><AlertCircle className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{st.error ?? "Error"}</span></span>;
  if (st.state === "missing") return <span className="inline-flex items-center gap-1.5 text-warn"><AlertCircle className="h-3.5 w-3.5 shrink-0" />Folder not found</span>;
  if (st.state === "locked") return <span className="inline-flex items-center gap-1.5 text-text-muted"><Lock className="h-3.5 w-3.5 shrink-0" />Vault locked</span>;
  if (st.state === "paused") return <span className="text-text-muted" title={st.error ?? ""}>Paused in Bunker Mode</span>;
  if (st.state === "never" || !st.lastIndexed) return <span className="text-text-muted">Not indexed yet</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-text-secondary" title={st.error ?? undefined}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${st.error ? "bg-warn" : "bg-accent"}`} aria-hidden />
      <span className="truncate">Indexed {fmtAgo(st.lastIndexed).toLowerCase()}</span>
    </span>
  );
}

function itemsLine(r: SourceRow): string {
  const st = r.status;
  if (r.kind === "website" && st.web) return st.web.childSites ? `${fmtCount(st.web.childSites)} sites, ${fmtCount(st.web.rows)} rows` : `${fmtCount(st.web.rows)} rows`;
  return st.detail ?? (st.files ? `${fmtCount(st.files)} files` : "");
}

function IconButton({ label, onClick, children, disabled, danger }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} disabled={disabled} title={label} aria-label={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm disabled:opacity-40 ${danger ? "hover:text-warn" : "hover:text-accent"}`}>
      {children}
    </button>
  );
}

function SourcesTable({ rows, busy, onOpen, onToggle, onRefresh, onRemove, onAdd, filter }: {
  rows: SourceRow[]; busy: Set<string>; filter: Filter;
  onOpen: (r: SourceRow) => void; onToggle: (r: SourceRow, on: boolean) => void; onRefresh: (r: SourceRow) => void; onRemove: (r: SourceRow) => void; onAdd: () => void;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const grid = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 @3xl:grid-cols-[minmax(0,1fr)_10.5rem_8rem_7rem_2.75rem_4rem]";
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
        <p className="font-display text-lg font-semibold text-text-primary">No {filter === "all" ? "sources" : KIND_META[filter].plural.toLowerCase()} yet</p>
        <p className="mt-1 text-[14px] text-text-muted">{filter === "all" ? "Add your vault, an Obsidian vault, a folder or a website." : KIND_META[filter].blurb}</p>
        <button onClick={onAdd} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg border border-accent-border bg-accent-soft px-3.5 text-[14px] font-semibold text-accent hover:bg-accent hover:text-background">
          <Plus className="h-4 w-4" />Add {filter === "all" ? "a source" : KIND_META[filter].label.toLowerCase()}
        </button>
      </div>
    );
  }
  return (
    <div className="@container overflow-hidden rounded-xl border border-border bg-surface" data-testid="sources-table">
      <div className={`${grid} hidden border-b border-border-subtle bg-surface-warm/40 px-4 py-2.5 text-[13px] font-medium text-text-muted @3xl:grid`}>
        <span>Source</span><span>Status</span><span>Items</span><span>Next refresh</span><span>On</span><span className="sr-only">Actions</span>
      </div>
      <ul>
        {rows.map((r) => {
          const isBusy = busy.has(r.id) || busy.has("*");
          const place = r.kind === "website" ? r.location.replace(/^https?:\/\//, "") : shortPath(r.resolvedLocation);
          // A site named after its host would print the same word twice.
          const loc = place === r.name ? KIND_META[r.kind].label : place;
          return (
            <li key={r.id} data-testid={`source-row-${r.id}`} className={`${grid} cursor-pointer border-b border-border-subtle px-4 py-3 last:border-b-0 hover:bg-surface-warm/40 ${r.enabled ? "" : "opacity-70"}`}
              onClick={() => onOpen(r)}>
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-background text-text-secondary">
                  <KindIcon kind={r.kind} className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-semibold text-text-primary">{r.name}</span>
                    {r.builtin && <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">Default</span>}
                  </span>
                  <span className="block truncate text-[13px] text-text-muted" title={`${KIND_META[r.kind].label}: ${r.kind === "website" ? r.location : r.resolvedLocation}`}>{loc}</span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[13px] @3xl:hidden">
                    <StatusCell r={r} busy={isBusy} />
                    {r.enabled && r.status.items > 0 && <span className="shrink-0 tabular-nums text-text-muted">{fmtCount(r.status.items)} items</span>}
                  </span>
                </span>
              </div>
              <span className="hidden min-w-0 text-[13px] @3xl:block"><StatusCell r={r} busy={isBusy} /></span>
              <span className="hidden min-w-0 @3xl:block">
                <span className="block text-[14px] font-semibold tabular-nums text-text-primary">{fmtCount(r.status.items || 0)}</span>
                <span className="block truncate text-[12px] text-text-muted">{itemsLine(r)}</span>
              </span>
              <span className="hidden text-[13px] text-text-secondary @3xl:block">{r.enabled ? fmtNext(r.status.nextRefresh) : "Off"}</span>
              <span className="hidden @3xl:block" onClick={(e) => e.stopPropagation()}>
                <Toggle on={r.enabled} onChange={(v) => onToggle(r, v)} label={`${r.name} on`} />
              </span>
              <span className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                <span className="mr-1 @3xl:hidden"><Toggle on={r.enabled} onChange={(v) => onToggle(r, v)} label={`${r.name} on`} /></span>
                <IconButton label="Refresh now" onClick={() => onRefresh(r)} disabled={isBusy || !r.enabled}>
                  <RefreshCw className={`h-4 w-4 ${isBusy ? "animate-spin" : ""}`} />
                </IconButton>
                {r.builtin ? (
                  <IconButton label="Open" onClick={() => onOpen(r)}><ChevronRight className="h-4 w-4" /></IconButton>
                ) : confirm === r.id ? (
                  <IconButton label="Click again to remove" onClick={() => { setConfirm(null); onRemove(r); }} danger><Check className="h-4 w-4 text-warn" /></IconButton>
                ) : (
                  <IconButton label="Remove source" onClick={() => { setConfirm(r.id); setTimeout(() => setConfirm((c) => (c === r.id ? null : c)), 4000); }} danger>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~");
}

// ── Try a question ──────────────────────────────────────────────────────

function TryQuestion({ vaultPath, disabled }: { vaultPath: string; disabled: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SourceCitation[] | null>(null);
  const [snips, setSnips] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!q.trim()) return;
    setBusy(true);
    const r = await sourcesForMessage(vaultPath, q, 8000);
    // Pull each excerpt's text back out of the cited block for the preview.
    const map: Record<string, string> = {};
    for (const part of (r?.context ?? "").split(/\n(?=\[S\d+\] )/)) {
      const m = part.match(/^\[(S\d+)\] .*\nFrom .*\n(?:Columns: .*\n)?([\s\S]*)$/);
      if (m) map[m[1]!] = m[2]!.replace(/# END OF SOURCES[\s\S]*$/, "").trim();
    }
    setSnips(map);
    setHits(r?.hits ?? []);
    setBusy(false);
  };
  return (
    <section className="mt-8" aria-label="Try a question">
      <h2 className="font-display text-xl font-semibold tracking-tight text-text-primary">Try a question</h2>
      <p className="mt-1 text-[14px] text-text-muted">See what a chat would pull from your sources, and how it would cite them.</p>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-accent-border">
          <Search className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Who led the latest funding round at Anthropic?" aria-label="Test question" disabled={disabled}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-text-primary outline-none placeholder:text-text-muted" />
        </label>
        <button type="submit" disabled={disabled || busy || !q.trim()}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-accent-border bg-accent-soft px-4 text-[14px] font-semibold text-accent hover:bg-accent hover:text-background disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Search
        </button>
      </form>
      {hits && hits.length === 0 && <p className="mt-3 text-[14px] text-text-muted">Nothing in your sources matches that yet.</p>}
      {hits && hits.length > 0 && (
        <ol className="mt-3 overflow-hidden rounded-xl border border-border bg-surface" data-testid="try-hits">
          {hits.map((h) => (
            <li key={h.tag} className="flex items-start gap-3 border-b border-border-subtle px-4 py-3 last:border-b-0">
              <span className="mt-0.5 w-7 shrink-0 text-[13px] font-semibold text-accent">{h.tag}</span>
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => openCitation(h)} className="block max-w-full truncate text-left text-[14px] font-semibold text-text-primary hover:text-accent">{h.title}</button>
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-text-muted">
                  <KindIcon kind={h.kind} className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{h.kind === "website" ? (h.group ?? h.sourceName) : h.sourceName}, {h.url && /^https?:/.test(h.url) ? h.url.replace(/^https?:\/\//, "") : h.location}</span>
                </span>
                {snips[h.tag] && <p className="mt-1.5 line-clamp-2 break-words text-[13px] leading-snug text-text-secondary">{snips[h.tag]}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ── Detail ──────────────────────────────────────────────────────────────

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border-subtle bg-surface px-4 py-3">
      <div className="text-[13px] font-medium text-text-muted">{label}</div>
      <div className="mt-1 truncate font-display text-xl font-semibold tabular-nums text-text-primary">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[12px] text-text-muted">{sub}</div>}
    </div>
  );
}

function SurfaceBadge({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] ${on ? "border-accent-border bg-accent-soft text-accent" : "border-border-subtle text-text-muted"}`}>
      {on ? <Check className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-text-muted/50" aria-hidden />}{label}
    </span>
  );
}

function SourceDetail({ row: r, vaultPath, busy, onBack, onToggle, onRefresh, onRemove, onSetupDomains, onVaultMoved }: {
  row: SourceRow; vaultPath: string; busy: boolean;
  onBack: () => void; onToggle: (on: boolean) => void; onRefresh: () => void; onRemove: () => void;
  onSetupDomains?: () => void; onVaultMoved?: (path: string) => void;
}) {
  const phone = useIsPhone();
  const [confirm, setConfirm] = useState(false);
  const st = r.status;
  const web = st.web;
  const openLocation = () => {
    if (r.kind === "website") void openUrl(r.location).catch(() => {});
    else void revealItemInDir(r.resolvedLocation).catch(() => {});
  };
  return (
    <div className={phone ? "p-4" : "p-6"} data-testid="source-detail">
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-accent hover:underline">
        <ArrowLeft className="h-4 w-4" />All sources
      </button>
      <header className="flex flex-wrap items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-border-subtle bg-surface text-text-secondary">
          <KindIcon kind={r.kind} className="h-7 w-7" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-3xl font-semibold tracking-tight text-text-primary">{r.name}</h2>
          <button onClick={openLocation} className="mt-1 inline-flex max-w-full items-center gap-1.5 text-[14px] text-text-muted hover:text-accent" title={r.kind === "website" ? "Open the site" : "Show in Finder"}>
            <span className="truncate">{KIND_META[r.kind].label}, {r.kind === "website" ? r.location.replace(/^https?:\/\//, "") : shortPath(r.resolvedLocation)}</span>
            {r.kind === "website" ? <ExternalLink className="h-3.5 w-3.5 shrink-0" /> : <FolderOpen className="h-3.5 w-3.5 shrink-0" />}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Toggle on={r.enabled} onChange={onToggle} label={`${r.name} on`} />
          <button onClick={onRefresh} disabled={busy || !r.enabled}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[14px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />{busy ? "Indexing" : "Refresh now"}
          </button>
          {!r.builtin && (
            <button onClick={() => { if (confirm) onRemove(); else { setConfirm(true); setTimeout(() => setConfirm(false), 4000); } }}
              title="Removes it from the list. Nothing in the folder or on the site is touched." aria-label="Remove source"
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[14px] ${confirm ? "border-warn/50 text-warn" : "border-border text-text-secondary hover:text-warn"}`}>
              <Trash2 className="h-4 w-4" />{confirm ? "Remove?" : "Remove"}
            </button>
          )}
        </div>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Status" value={!r.enabled ? "Off" : busy || st.state === "indexing" ? "Indexing" : st.state === "ready" ? "Ready" : st.state === "never" ? "Not indexed" : st.state === "missing" ? "Not found" : st.state === "locked" ? "Locked" : st.state === "paused" ? "Paused" : "Error"} sub={st.error ?? undefined} />
        <Stat label="Items" value={fmtCount(st.items || 0)} sub={itemsLine(r) || undefined} />
        <Stat label="Last indexed" value={fmtAgo(st.lastIndexed)} sub={st.lastIndexed ? new Date(st.lastIndexed).toLocaleString() : undefined} />
        <Stat label="Next refresh" value={r.enabled ? fmtNext(st.nextRefresh) : "Off"} sub={r.kind === "website" ? "On each site's schedule" : "Every 30 min, if files changed"} />
      </div>

      {r.kind === "website" && (
        <section className="mt-8" aria-label="What Prevail found">
          <h3 className="font-display text-xl font-semibold tracking-tight text-text-primary">What Prevail found</h3>
          <p className="mt-1 max-w-3xl text-[14px] text-text-muted">Public, machine-readable endpoints only. robots.txt is obeyed, every request is conditional, and each site is read again just after its own /api/health says it updates.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <SurfaceBadge on={!!web?.llms} label={`llms.txt${web && web.sites > 1 ? `, ${web.llms} sites` : ""}`} />
            <SurfaceBadge on={!!web?.llmsFull} label={`llms-full.txt tables${web && web.sites > 1 ? `, ${web.llmsFull}` : ""}`} />
            <SurfaceBadge on={!!web?.openapi} label={`OpenAPI${web && web.sites > 1 ? `, ${web.openapi}` : ""}`} />
            <SurfaceBadge on={!!web?.list.some((s) => s.surface.health)} label="Freshness (/api/health)" />
            <SurfaceBadge on={!!web?.list.some((s) => s.surface.sitemap !== null)} label="Sitemap" />
          </div>
          {web && web.list.length > 1 && <SiteTable sites={web.list} root={r.location} />}
        </section>
      )}
      {r.kind === "obsidian" && (
        <InfoLine icon={<FileText className="h-4 w-4" />}>
          Imported one way into <b className="font-semibold text-text-primary">{r.domain ?? "notes"}</b> (source/obsidian/{r.id}). Prevail reads your Obsidian folder and never writes to it. Wikilinks become normal links; tags and frontmatter are kept.
        </InfoLine>
      )}
      {r.kind === "folder" && (
        <InfoLine icon={<FolderOpen className="h-4 w-4" />}>Read in place: notes, text, CSV, JSON and YAML files. Prevail never writes to this folder.</InfoLine>
      )}
      {r.kind === "prevail" && (
        <InfoLine icon={<FileText className="h-4 w-4" />}>
          Domain ideals, state, memory, tasks and source files, plus every entity page. Chat transcripts, skills and domains set to local models only are left out.
        </InfoLine>
      )}
      {r.builtin && (
        <section className="mt-8" aria-label="Vault location and backups">
          <h3 className="mb-3 font-display text-xl font-semibold tracking-tight text-text-primary">Vault location and backups</h3>
          <VaultManageSection vaultPath={vaultPath} onSetupDomains={onSetupDomains} onVaultMoved={onVaultMoved} />
        </section>
      )}
    </div>
  );
}

function InfoLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="mt-6 flex max-w-3xl items-start gap-2.5 text-[14px] leading-relaxed text-text-secondary">
      <span className="mt-0.5 shrink-0 text-accent">{icon}</span><span>{children}</span>
    </p>
  );
}

function SiteTable({ sites, root }: { sites: WebSite[]; root: string }) {
  const [q, setQ] = useState("");
  const list = sites
    .filter((s) => s.origin !== root)
    .filter((s) => !q.trim() || `${s.name} ${s.origin}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="font-display text-lg font-semibold text-text-primary">Linked sites <span className="text-[14px] font-normal text-text-muted">{sites.length - 1}</span></h4>
        <label className="ml-auto flex h-9 w-64 max-w-full items-center gap-2 rounded-lg border border-border bg-background px-2.5 focus-within:border-accent-border">
          <Search className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter sites" aria-label="Filter sites" className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-text-muted" />
        </label>
      </div>
      <div className="@container mt-3 overflow-hidden rounded-xl border border-border bg-surface" data-testid="site-table">
        <div className="hidden grid-cols-[minmax(0,1fr)_7rem_9rem_9rem] gap-x-4 border-b border-border-subtle bg-surface-warm/40 px-4 py-2.5 text-[13px] font-medium text-text-muted @2xl:grid">
          <span>Site</span><span>Rows</span><span>Updated</span><span>Next check</span>
        </div>
        <ul>
          {list.map((s) => (
            <li key={s.origin} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-border-subtle px-4 py-2.5 last:border-b-0 @2xl:grid-cols-[minmax(0,1fr)_7rem_9rem_9rem]">
              <span className="min-w-0">
                <button type="button" onClick={() => void openUrl(s.origin).catch(() => {})} className="block max-w-full truncate text-left text-[14px] font-semibold text-text-primary hover:text-accent">{s.name}</button>
                <span className="block truncate text-[12px] text-text-muted">{s.error ? <span className="text-warn">{s.error}</span> : `${s.origin.replace(/^https?:\/\//, "")}${s.surface.openapi ? `, OpenAPI ${s.surface.openapi} endpoints` : ""}`}</span>
              </span>
              <span className="text-[14px] tabular-nums text-text-primary">{fmtCount(s.rows)}<span className="text-[12px] text-text-muted @2xl:hidden"> rows</span></span>
              <span className="hidden text-[13px] text-text-secondary @2xl:block">{s.lastUpdated ? fmtAgo(s.lastUpdated) : "Not reported"}</span>
              <span className="hidden text-[13px] text-text-secondary @2xl:block">{fmtNext(s.nextDue)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Add a source ────────────────────────────────────────────────────────

function AddSource({ vaultPath, initialKind, existing, onCancel, onAdded }: {
  vaultPath: string; initialKind: SourceKind | null; existing: SourceRow[];
  onCancel: () => void; onAdded: (r: SourceRow) => void;
}) {
  const phone = useIsPhone();
  const [kind, setKind] = useState<SourceKind | null>(initialKind);
  const [location, setLocation] = useState("");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("notes");
  const [domains, setDomains] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (kind !== "obsidian") return;
    void invoke<{ name: string }[]>("scan_vault", { path: vaultPath }).then((d) => setDomains((d ?? []).map((x) => x.name).sort())).catch(() => {});
  }, [kind, vaultPath]);

  const pick = async () => {
    setErr(null);
    try {
      const picked = await openDialog({ directory: true, multiple: false, title: kind === "obsidian" ? "Choose your Obsidian vault folder" : kind === "prevail" ? "Choose a Prevail vault folder" : "Choose a folder" });
      if (typeof picked === "string") {
        setLocation(picked);
        if (!name.trim()) setName(picked.split("/").filter(Boolean).pop() ?? "");
      }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const submit = async () => {
    if (!kind || !location.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await addSource(vaultPath, { kind, location: location.trim(), name: name.trim() || undefined, domain: kind === "obsidian" ? domain : undefined });
      onAdded(r);
    } catch (e) {
      setErr((e instanceof Error ? e.message : String(e)).replace(/^prevail exited \d+:\s*/, "").replace(/^\{"ok":false,"error":"(.*)"\}$/, "$1"));
    } finally { setBusy(false); }
  };
  const taken = new Set(existing.filter((r) => r.kind === "website").map((r) => r.location.replace(/^https?:\/\//, "")));

  return (
    <div className={phone ? "p-4" : "p-6"} data-testid="add-source-flow">
      <button onClick={kind && !initialKind ? () => { setKind(null); setErr(null); } : onCancel} className="mb-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-accent hover:underline">
        <ArrowLeft className="h-4 w-4" />{kind && !initialKind ? "All types" : "All sources"}
      </button>
      {!kind ? (
        <>
          <h2 className="font-display text-3xl font-semibold tracking-tight text-text-primary">Add a source</h2>
          <p className="mt-1 text-[15px] text-text-muted">Where should context come from? Add as many of each as you like.</p>
          <ul className="mt-5 overflow-hidden rounded-xl border border-border bg-surface">
            {KINDS.map((k) => (
              <li key={k} className="border-b border-border-subtle last:border-b-0">
                <button onClick={() => setKind(k)} data-testid={`add-kind-${k}`} className="flex w-full items-center gap-4 px-4 py-4 text-left hover:bg-surface-warm/40">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border-subtle bg-background text-text-secondary"><KindIcon kind={k} className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-semibold text-text-primary">{KIND_META[k].label}</span>
                    <span className="block text-[14px] text-text-muted">{KIND_META[k].blurb}</span>
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-text-muted" />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="max-w-2xl">
          <h2 className="flex items-center gap-3 font-display text-3xl font-semibold tracking-tight text-text-primary">
            <KindIcon kind={kind} className="h-7 w-7" />Add {KIND_META[kind].label.toLowerCase()}
          </h2>
          <p className="mt-1 text-[15px] text-text-muted">{KIND_META[kind].blurb}</p>
          {kind === "website" ? (
            <div className="mt-6">
              <label className="text-[14px] font-semibold text-text-primary" htmlFor="src-url">Website address</label>
              <input id="src-url" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="fru.dev" autoFocus
                className="mt-1.5 h-11 w-full rounded-lg border border-border bg-background px-3 text-[15px] text-text-primary outline-none focus:border-accent-border" />
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
                {SUGGESTED_SITES.filter((s) => !taken.has(s)).map((s) => (
                  <button key={s} type="button" onClick={() => { setLocation(s); if (!name) setName(s); }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-text-secondary hover:border-accent-border hover:text-accent">
                    <Globe className="h-3.5 w-3.5" />{s}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-text-muted">
                Prevail reads the site's robots.txt, llms.txt, llms-full.txt, OpenAPI spec and /api/health, and follows its llms.txt to every linked site on the same domain (fru.dev links its 47 trackers). Public endpoints only.
              </p>
            </div>
          ) : (
            <div className="mt-6">
              <span className="text-[14px] font-semibold text-text-primary">Folder</span>
              <div className="mt-1.5 flex items-center gap-2">
                <button type="button" onClick={() => void pick()} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3.5 text-[14px] text-text-secondary hover:border-accent-border hover:text-accent">
                  <FolderOpen className="h-4 w-4" />Choose folder
                </button>
                <span className="min-w-0 truncate text-[14px] text-text-secondary" data-testid="picked-folder">{location ? shortPath(location) : "No folder chosen"}</span>
              </div>
            </div>
          )}
          <div className="mt-5">
            <label className="text-[14px] font-semibold text-text-primary" htmlFor="src-name">Name</label>
            <input id="src-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "website" ? "fru.dev" : "Shown in citations"}
              className="mt-1.5 h-11 w-full rounded-lg border border-border bg-background px-3 text-[15px] text-text-primary outline-none focus:border-accent-border" />
          </div>
          {kind === "obsidian" && (
            <div className="mt-5">
              <label className="text-[14px] font-semibold text-text-primary" htmlFor="src-domain">Import into domain</label>
              <input id="src-domain" list="src-domains" value={domain} onChange={(e) => setDomain(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-lg border border-border bg-background px-3 text-[15px] text-text-primary outline-none focus:border-accent-border" />
              <datalist id="src-domains">{domains.map((d) => <option key={d} value={d} />)}</datalist>
            </div>
          )}
          {err && <p className="mt-4 flex items-start gap-2 text-[14px] text-warn"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{err}</p>}
          <div className="mt-6 flex items-center gap-2">
            <button type="submit" disabled={busy || !location.trim()} data-testid="add-source-submit"
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-[14px] font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Add and index
            </button>
            <button type="button" onClick={onCancel} className="inline-flex h-10 items-center rounded-lg px-3 text-[14px] text-text-secondary hover:text-text-primary">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
