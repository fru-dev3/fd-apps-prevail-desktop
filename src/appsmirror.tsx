// Apps: a live mirror of the connectors you already signed into in your AI
// runtimes (Claude connectors, Codex, Gemini CLI, Antigravity). Prevail holds
// no credentials of its own here. Each connector can carry a sync recipe that
// runs through its runtime with read tools only and files what it finds into
// your domains. Below the runtimes, the column holds the owner's trusted
// sources (with "Add a source"), then the lanes for what no connector covers
// (sites through browser learn/replay, command-line tools, Obsidian import),
// each with its own detail. A picked app is a chat scope: see appchat.tsx.
import { SideSpine } from "./sidespine";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, FolderInput, Globe, Loader2, Plug, Plus, RefreshCw, ShieldCheck, Terminal, Wrench, type LucideIcon } from "lucide-react";
import { invoke, isBrowser } from "./bridge";
import { invokeCached, invokeKey, peekInvoke, setQueryData, useInvokeQuery } from "./query";
import { relTime, titleCase } from "./format";
import { toast } from "./toast";
import { RowMenu } from "./ui";
import { ProviderMark } from "./marks";
import { SettingsHeader } from "./sectionutil";
import { useIsPhone } from "./useisphone";
import { RUNTIME_MARK, groupByRuntime, type ArchiveResult, type MirrorApp, type MirrorList, type RuntimeGroup } from "./appsmirror-model";
import { AppLogo, MIRROR_SELECT_KEY, SigninHelp, StatusPill } from "./appsmirror-parts";
import { MirrorDetail } from "./appsmirror-detail";
import { AppsLane, type AppsLaneId } from "./appsfallback";
import { AddSourcePane, TrustedSourceDetail, UntrustedSourceDetail } from "./trustedsources";
import { SOURCE_KIND_LABEL, type UntrustedSource } from "./appscope";
import { isUserDomain } from "./helpers";

function rowSubline(app: MirrorApp): string {
  if (app.trusted) return `${SOURCE_KIND_LABEL[app.integration as keyof typeof SOURCE_KIND_LABEL] ?? "Source"} · read only`;
  const feeds = app.domains.length ? app.domains.map(titleCase).join(", ") : "No domains yet";
  const synced = app.last_sync ? `synced ${relTime(app.last_sync)}` : app.syncable ? "never synced" : "listed only";
  return `${feeds} · ${synced}`;
}

export function MirrorRow({ app, selected, onSelect }: { app: MirrorApp; selected: boolean; onSelect: () => void }) {
  const needsHelp = app.status === "needs_auth" || app.status === "disabled";
  const sub = rowSubline(app);
  // The name gets the full row width (status moved to the second line), so
  // long connector names fit; anything still too long ends in an ellipsis
  // with the full name on hover. Every row keeps the same two-line height.
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      data-testid={`mirror-row-${app.id}`}
      title={app.name}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      className={`flex h-[60px] w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
        selected ? "bg-accent-soft ring-1 ring-accent-border" : "hover:bg-surface-strong/60"
      }`}
    >
      <AppLogo name={app.name} url={app.url} size={32} />
      <div className="min-w-0 flex-1">
        <div title={app.name} className="truncate text-[14px] font-semibold text-text-primary">{app.name}</div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-text-muted">
          <StatusPill status={app.status} compact />
          {needsHelp ? (
            <span className="min-w-0 truncate">· <SigninHelp app={app} compact /></span>
          ) : (
            <span className="min-w-0 truncate" title={sub}>· {sub}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function RuntimeSection({ group, selectedId, onSelect }: { group: RuntimeGroup; selectedId: string | null; onSelect: (a: MirrorApp) => void }) {
  const { info, apps } = group;
  const installed = info ? info.installed : apps.length > 0;
  return (
    <section className="mb-3 last:mb-0" aria-label={group.label}>
      <div className="flex items-center gap-2 px-2.5 pb-1 pt-2">
        <ProviderMark vendor={RUNTIME_MARK[group.runtime] ?? group.runtime} size={20} />
        <h3 className="text-[15px] font-semibold text-text-primary">{group.label}</h3>
        {apps.length > 0 && <span className="text-[13px] text-text-muted">{apps.length}</span>}
      </div>
      {!installed ? (
        <p className="px-2.5 pb-1 text-[13px] text-text-muted">Not installed on this Mac.</p>
      ) : info?.error ? (
        <p className="px-2.5 pb-1 text-[13px] text-err">{info.error}</p>
      ) : apps.length === 0 ? (
        <p className="px-2.5 pb-1 text-[13px] text-text-muted">No connectors yet.</p>
      ) : (
        <div className="space-y-0.5">
          {apps.map((a) => <MirrorRow key={a.id} app={a} selected={a.id === selectedId} onSelect={() => onSelect(a)} />)}
        </div>
      )}
    </section>
  );
}

// A row that opens a lane or a flow rather than an app.
function LaneRow({ id, icon: Icon, title, sub, selected, onSelect }: { id: string; icon: LucideIcon; title: string; sub: string; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" data-testid={`apps-row-${id}`} aria-current={selected ? "true" : undefined} onClick={onSelect}
      className={`flex h-[60px] w-full min-w-0 items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${selected ? "bg-accent-soft ring-1 ring-accent-border" : "hover:bg-surface-strong/60"}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-strong text-text-secondary ring-1 ring-border-subtle"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-text-primary">{title}</span>
        <span className="mt-0.5 block truncate text-[12px] text-text-muted">{sub}</span>
      </span>
    </button>
  );
}

function GroupHead({ icon: Icon, title, count }: { icon: LucideIcon; title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 px-2.5 pb-1 pt-2">
      <Icon className="h-4 w-4 text-text-muted" />
      <h3 className="text-[15px] font-semibold text-text-primary">{title}</h3>
      {!!count && <span className="text-[13px] text-text-muted">{count}</span>}
    </div>
  );
}

const LANES: { id: AppsLaneId; icon: LucideIcon; title: string; sub: string }[] = [
  { id: "sites", icon: Globe, title: "Sites", sub: "Learn a site once, then replay it" },
  { id: "clis", icon: Terminal, title: "Command-line tools", sub: "Pull from gh, op, stripe and more" },
  { id: "obsidian", icon: FolderInput, title: "Obsidian import", sub: "Copy a vault into a domain" },
];

function ArchivePanel({ vaultPath, onClose }: { vaultPath: string; onClose: () => void }) {
  const [plan, setPlan] = useState<ArchiveResult | null>(null);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    void invoke<ArchiveResult>("apps_mirror_archive", { vault: vaultPath, apply: false })
      .then((r) => setPlan(r))
      .catch((e) => setPlan({ candidates: [], moved: [], error: String(e) }))
      .finally(() => setBusy(false));
  }, [vaultPath]);
  async function apply() {
    setBusy(true);
    try {
      const r = await invoke<ArchiveResult>("apps_mirror_archive", { vault: vaultPath, apply: true });
      if (r.error) { toast.error(r.error); return; }
      toast.success(`Moved ${r.moved.length} folder${r.moved.length === 1 ? "" : "s"} to the archive`);
      onClose();
    } catch (e) { toast.error(String(e)); }
    finally { setBusy(false); }
  }
  const n = plan?.candidates.length ?? 0;
  return (
    <div className="mb-4 rounded-xl border border-border-subtle bg-surface p-4">
      <h3 className="text-base font-semibold text-text-primary">Archive unused app folders</h3>
      {busy && !plan ? (
        <p className="mt-2 flex items-center gap-2 text-[13px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Checking the vault</p>
      ) : plan?.error ? (
        <p className="mt-2 text-[13px] text-err">{plan.error}</p>
      ) : n === 0 ? (
        <p className="mt-2 text-[13px] text-text-muted">Nothing to archive. Every app folder holds data, code or a connector.</p>
      ) : (
        <>
          <p className="mt-1 text-[13px] text-text-muted">These folders are moved to an archive folder in the vault, not deleted.</p>
          <ul className="mt-2 max-h-56 divide-y divide-border-subtle overflow-y-auto">
            {plan!.candidates.map((c) => (
              <li key={c.id} className="flex min-w-0 items-center gap-3 py-1.5 text-[13px]">
                <span className="min-w-0 shrink-0 truncate font-semibold text-text-primary">{c.id}</span>
                <span className="min-w-0 flex-1 truncate text-text-muted">{c.reason}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-3 flex gap-2">
        {n > 0 && !plan?.error && (
          <button type="button" onClick={apply} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-45">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />} Move {n} to archive
          </button>
        )}
        <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-[13px] text-text-secondary hover:text-text-primary">
          {n > 0 ? "Cancel" : "Close"}
        </button>
      </div>
    </div>
  );
}

export function AppsMirrorPanel({ vaultPath, tabs }: { vaultPath: string; tabs?: React.ReactNode }) {
  // Seeded from the shared cache (the sidebar reads the same list).
  const [list, setList] = useState<MirrorList | null>(() => peekInvoke<MirrorList>("apps_mirror_list", { vault: vaultPath }) ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // A pinned connector clicked in the sidebar hands its id over here, either
  // before this panel mounts (session storage) or while it is open (event).
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      const id = sessionStorage.getItem(MIRROR_SELECT_KEY);
      if (id) sessionStorage.removeItem(MIRROR_SELECT_KEY);
      return id || null;
    } catch { return null; }
  });
  useEffect(() => {
    const onSelect = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id === "string" && id) {
        setSelectedId(id);
        try { sessionStorage.removeItem(MIRROR_SELECT_KEY); } catch { /* ignore */ }
      }
    };
    window.addEventListener("prevail:mirror-select", onSelect);
    return () => window.removeEventListener("prevail:mirror-select", onSelect);
  }, []);
  const [domains, setDomains] = useState<string[]>(() => { const c = peekInvoke<{ name: string }[]>("scan_vault", { path: vaultPath }); return (Array.isArray(c) ? c : []).map((d) => d.name).filter(isUserDomain); });
  const [archiveOpen, setArchiveOpen] = useState(false);
  const phone = useIsPhone();
  const desktop = !isBrowser();

  const load = useCallback(async (force = false) => {
    try {
      const r = await invokeCached<MirrorList>("apps_mirror_list", { vault: vaultPath }, { force });
      setList(r);
      setErr(r?.error ?? null);
    } catch (e) { setErr(String(e)); setList((cur) => cur ?? { generated_at: 0, runtimes: [], apps: [] }); }
  }, [vaultPath]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void invokeCached<{ name: string }[]>("scan_vault", { path: vaultPath })
      .then((ds) => setDomains((Array.isArray(ds) ? ds : []).map((d) => d.name).filter(isUserDomain)))
      .catch(() => setDomains([]));
  }, [vaultPath]);

  async function refresh(tools = false) {
    setRefreshing(true);
    try {
      const r = await invoke<MirrorList>("apps_mirror_refresh", { vault: vaultPath, tools });
      setList(r);
      setQueryData(invokeKey("apps_mirror_list", { vault: vaultPath }), r);
      setErr(r?.error ?? null);
    } catch (e) { toast.error(String(e)); }
    finally { setRefreshing(false); }
  }

  const groups = useMemo(() => groupByRuntime(list), [list]);
  const apps = list?.apps ?? [];
  // Desktop keeps a selection so the detail pane is never blank; on a phone the
  // list comes first and a tap opens the detail.
  const effectiveId = selectedId ?? (phone ? null : apps.find((a) => a.status === "connected" && !a.trusted)?.id ?? apps[0]?.id ?? null);
  const selected = apps.find((a) => a.id === effectiveId) ?? null;

  const onChanged = (next?: MirrorApp) => {
    if (next) setList((cur) => cur ? { ...cur, apps: cur.apps.map((a) => a.id === next.id ? next : a) } : cur);
    else void load();
  };

  // Refresh and the rest sit in the column header, never alone in the page
  // header.
  const columnActions = (
    <>
      <button type="button" onClick={() => void refresh(false)} disabled={refreshing || !desktop} data-testid="apps-refresh"
        title={desktop ? "Refresh: read every runtime's connectors again" : "Refresh runs on your Mac"} aria-label="Refresh connectors"
        className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-45">
        <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
      </button>
      {desktop && (
        <RowMenu label="More" items={[
          { icon: Wrench, label: "Refresh with tools", hint: "Also check every connector's tools", onClick: () => void refresh(true) },
          { icon: Archive, label: "Archive unused app folders", hint: "Review first, then move", onClick: () => setArchiveOpen(true) },
        ]} />
      )}
    </>
  );
  const header = (
    <SettingsHeader
      title="Apps"
      icon={Plug}
      subtitle="The connectors you already use in Claude, Codex, Gemini and Antigravity, feeding your domains."
      tabs={tabs}
    />
  );

  // Sources synced from another Mac: the engine marks them (trusted_here:
  // false, status untrusted_here). An older engine leaves them out of `apps
  // list`, so only then does the manifest comparison find them.
  const isUntrusted = (a: MirrorApp) => a.status === "untrusted_here" || a.trusted_here === false;
  const engineMarks = apps.some((a) => a.trusted_here !== undefined || a.status === "untrusted_here");
  const trusted = apps.filter((a) => a.trusted && !isUntrusted(a));
  const untrustedQ = useInvokeQuery<UntrustedSource[]>("apps_untrusted_sources", desktop && list && !engineMarks ? { vault: vaultPath } : null, { staleMs: 60_000 });
  const untrusted: UntrustedSource[] = engineMarks
    ? apps.filter(isUntrusted).map((a) => ({ id: a.id, name: a.name, integration: (a.integration ?? "mcp-remote") as UntrustedSource["integration"], urls: a.urls ?? (a.url ? [a.url] : []) }))
    : (Array.isArray(untrustedQ.data) ? untrustedQ.data : []).filter((u) => !apps.some((a) => a.id === u.id));
  const pick = (id: string) => setSelectedId(id);
  const listBody = (
    <div>
      {list === null ? (
        <p className="flex items-center gap-2 p-3 text-[13px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Reading your runtimes</p>
      ) : (
        groups.map((g) => <RuntimeSection key={g.runtime} group={g} selectedId={effectiveId} onSelect={(a) => pick(a.id)} />)
      )}
      <section className="mb-3" aria-label="Trusted sources">
        <GroupHead icon={ShieldCheck} title="Trusted sources" count={trusted.length + untrusted.length} />
        <div className="space-y-0.5">
          {trusted.map((a) => <MirrorRow key={a.id} app={a} selected={a.id === effectiveId} onSelect={() => pick(a.id)} />)}
          {untrusted.map((u) => (
            <LaneRow key={u.id} id={`untrusted-${u.id}`} icon={ShieldCheck} title={u.name} sub="Not trusted on this Mac yet"
              selected={effectiveId === `untrusted:${u.id}`} onSelect={() => pick(`untrusted:${u.id}`)} />
          ))}
          <LaneRow id="add-source" icon={Plus} title="Add a source" sub="An MCP address, a site or links"
            selected={effectiveId === "lane:add-source"} onSelect={() => pick("lane:add-source")} />
        </div>
      </section>
      <section className="mb-3 last:mb-0" aria-label="Without a connector">
        <GroupHead icon={Globe} title="Without a connector" />
        <div className="space-y-0.5">
          {LANES.map((l) => (
            <LaneRow key={l.id} id={l.id} icon={l.icon} title={l.title} sub={l.sub} selected={effectiveId === `lane:${l.id}`} onSelect={() => pick(`lane:${l.id}`)} />
          ))}
        </div>
      </section>
    </div>
  );

  const lane = effectiveId?.startsWith("lane:") ? effectiveId.slice(5) : null;
  const untrustedPick = untrusted.find((u) => `untrusted:${u.id}` === effectiveId || u.id === effectiveId) ?? null;
  const detail = lane === "add-source" ? (
    <AddSourcePane vaultPath={vaultPath} existing={apps.map((a) => a.id)} onAdded={() => { void load(true); void untrustedQ.refresh(); }} onOpen={pick} />
  ) : lane ? (
    <AppsLane lane={lane as AppsLaneId} vaultPath={vaultPath} domains={domains} />
  ) : untrustedPick ? (
    <UntrustedSourceDetail key={untrustedPick.id} vaultPath={vaultPath} source={untrustedPick} onTrusted={() => { void load(true); void untrustedQ.refresh(); pick(untrustedPick.id); }} />
  ) : selected?.trusted ? (
    <TrustedSourceDetail key={selected.id} vaultPath={vaultPath} app={selected} onChanged={() => { void load(true); void untrustedQ.refresh(); }} />
  ) : selected ? (
    <MirrorDetail key={selected.id} app={selected} vaultPath={vaultPath} domains={domains} onChanged={onChanged} />
  ) : (
    <div className="flex h-full min-h-[240px] items-center justify-center p-8 text-center text-[14px] text-text-muted">
      {list && apps.length === 0 ? "No connectors found in your runtimes yet. Add one in Claude, Codex, Gemini or Antigravity, then press Refresh." : "Pick a connector to chat with it and see its activity."}
    </div>
  );

  // Same layout as Intent: the header pinned full width, the connectors in the
  // collapsible column on the left (grouped by runtime), the picked connector
  // in one column on the right. On a phone, the list then the detail.
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="apps-view">
      {header}
      {(err || archiveOpen) && (
        <div className={`max-h-[40vh] shrink-0 overflow-y-auto ${phone ? "px-4 pt-3" : "px-8 pt-4"}`}>
          {err && <div className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn">{err}</div>}
          {archiveOpen && <ArchivePanel vaultPath={vaultPath} onClose={() => { setArchiveOpen(false); void load(); }} />}
        </div>
      )}
      <SideSpine storageKey="prevail.apps.spine" title="Connectors" label="connectors" testId="apps-list" actions={columnActions}
        phone={phone} phoneDetail={phone && !!(selected || lane || untrustedPick)} onBack={() => setSelectedId(null)} backLabel="All apps"
        detail={detail}>
        <div className="p-2">{listBody}</div>
      </SideSpine>
    </div>
  );
}
