// Apps: a live mirror of the connectors you already signed into in your AI
// runtimes (Claude connectors, Codex, Gemini CLI, Antigravity). Prevail holds
// no credentials of its own here. Each connector can carry a sync recipe that
// runs through its runtime with read tools only and files what it finds into
// your domains. Sites and tools no connector covers use the fallback lanes at
// the bottom (browser learn/replay, command-line tools, Obsidian import).
import { SideSpine } from "./sidespine";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Loader2, Plug, RefreshCw, Wrench } from "lucide-react";
import { invoke, isBrowser } from "./bridge";
import { relTime, titleCase } from "./format";
import { toast } from "./toast";
import { RowMenu } from "./ui";
import { ProviderMark } from "./marks";
import { PageHeaderBar, SettingsHeader } from "./sectionutil";
import { useIsPhone } from "./useisphone";
import { RUNTIME_MARK, groupByRuntime, type ArchiveResult, type MirrorApp, type MirrorList, type RuntimeGroup } from "./appsmirror-model";
import { AppLogo, MIRROR_SELECT_KEY, SigninHelp, StatusPill } from "./appsmirror-parts";
import { MirrorDetail } from "./appsmirror-detail";
import { AppsFallback } from "./appsfallback";

function rowSubline(app: MirrorApp): string {
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

export function AppsMirrorPanel({ vaultPath }: { vaultPath: string }) {
  const [list, setList] = useState<MirrorList | null>(null);
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
  const [domains, setDomains] = useState<string[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const phone = useIsPhone();
  const desktop = !isBrowser();

  const load = useCallback(async () => {
    try {
      const r = await invoke<MirrorList>("apps_mirror_list", { vault: vaultPath });
      setList(r);
      setErr(r?.error ?? null);
    } catch (e) { setErr(String(e)); setList((cur) => cur ?? { generated_at: 0, runtimes: [], apps: [] }); }
  }, [vaultPath]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void invoke<{ name: string }[]>("scan_vault", { path: vaultPath })
      .then((ds) => setDomains((Array.isArray(ds) ? ds : []).map((d) => d.name).filter(Boolean)))
      .catch(() => setDomains([]));
  }, [vaultPath]);

  async function refresh(tools = false) {
    setRefreshing(true);
    try {
      const r = await invoke<MirrorList>("apps_mirror_refresh", { vault: vaultPath, tools });
      setList(r);
      setErr(r?.error ?? null);
    } catch (e) { toast.error(String(e)); }
    finally { setRefreshing(false); }
  }

  const groups = useMemo(() => groupByRuntime(list), [list]);
  const apps = list?.apps ?? [];
  // Desktop keeps a selection so the detail pane is never blank; on a phone the
  // list comes first and a tap opens the detail.
  const effectiveId = selectedId ?? (phone ? null : apps.find((a) => a.status === "connected")?.id ?? apps[0]?.id ?? null);
  const selected = apps.find((a) => a.id === effectiveId) ?? null;

  const onChanged = (next?: MirrorApp) => {
    if (next) setList((cur) => cur ? { ...cur, apps: cur.apps.map((a) => a.id === next.id ? next : a) } : cur);
    else void load();
  };

  const header = (
    <SettingsHeader
      title="Apps"
      icon={Plug}
      subtitle="The connectors you already use in Claude, Codex, Gemini and Antigravity, feeding your domains."
      right={
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void refresh(false)}
            disabled={refreshing || !desktop}
            title={desktop ? "Read every runtime's connectors again" : "Refresh runs on your Mac"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-45"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </button>
          {desktop && (
            <RowMenu label="More" items={[
              { icon: Wrench, label: "Refresh with tools", hint: "Also check every connector's tools", onClick: () => void refresh(true) },
              { icon: Archive, label: "Archive unused app folders", hint: "Review first, then move", onClick: () => setArchiveOpen(true) },
            ]} />
          )}
        </div>
      }
    />
  );

  const listBody = (
    <div>
      {list === null ? (
        <p className="flex items-center gap-2 p-3 text-[13px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Reading your runtimes</p>
      ) : (
        groups.map((g) => <RuntimeSection key={g.runtime} group={g} selectedId={effectiveId} onSelect={(a) => setSelectedId(a.id)} />)
      )}
    </div>
  );

  const detail = selected ? (
    <MirrorDetail key={selected.id} app={selected} vaultPath={vaultPath} domains={domains} onChanged={onChanged} />
  ) : (
    <div className="flex h-full min-h-[240px] items-center justify-center p-8 text-center text-[14px] text-text-muted">
      {list && apps.length === 0 ? "No connectors found in your runtimes yet. Add one in Claude, Codex, Gemini or Antigravity, then press Refresh." : "Pick a connector to see its recipe and tools."}
    </div>
  );

  // Same layout as Intent: the header pinned full width, the connectors in the
  // collapsible column on the left (grouped by runtime), the picked connector
  // in one column on the right. On a phone, the list then the detail.
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="apps-view">
      <PageHeaderBar>{header}</PageHeaderBar>
      {(err || archiveOpen) && (
        <div className={`max-h-[40vh] shrink-0 overflow-y-auto ${phone ? "px-4 pt-3" : "px-8 pt-4"}`}>
          {err && <div className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn">{err}</div>}
          {archiveOpen && <ArchivePanel vaultPath={vaultPath} onClose={() => { setArchiveOpen(false); void load(); }} />}
        </div>
      )}
      <SideSpine storageKey="prevail.apps.spine" title="Connectors" label="connectors" testId="apps-list"
        phone={phone} phoneDetail={phone && !!selected} onBack={() => setSelectedId(null)} backLabel="All apps"
        detail={
          <div className={phone ? "pb-10" : "px-2 pb-10"}>
            {detail}
            {!phone && <div className="px-6"><AppsFallback vaultPath={vaultPath} domains={domains} /></div>}
          </div>
        }>
        <div className="p-2">{listBody}</div>
        {phone && <div className="px-4 pb-10"><AppsFallback vaultPath={vaultPath} domains={domains} /></div>}
      </SideSpine>
    </div>
  );
}
