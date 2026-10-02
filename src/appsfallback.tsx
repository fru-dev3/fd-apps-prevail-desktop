// The Apps screen's fallback lanes, for data that no runtime connector covers.
// Each is its own group in the Apps column, with its own detail (never under a
// connector's detail):
//   Sites without a connector  a real browser the agent learns once, then
//                              replays (engine connectors browser-learn/replay)
//   Command-line tools         read-only pulls from CLIs you already signed into
//   Obsidian import            a one-way copy of an Obsidian vault into a domain
import { useCallback, useEffect, useState } from "react";
import { FolderInput, Globe, Loader2, LogIn, Play, Plus, RotateCcw, Terminal } from "lucide-react";
import { invoke, isBrowser } from "./bridge";
import { hasInvoke, invokeCached, peekInvoke } from "./query";
import { relTime, titleCase } from "./format";
import { toast } from "./toast";
import { REVEAL, RowMenu } from "./ui";
import { DETAIL_TITLE, META, ROW_TITLE } from "./typescale";
import { ConnectorRunPanel, type ConnectorRunMode } from "./connectorrun";
import { ObsidianImportModal, ObsidianLogo } from "./obsidianmodal";
import { AppLogo } from "./appsmirror-parts";
import type { CliProvider, EngineApp } from "./types";

// One plain column of rows (no boxed card); the row's one action is a quiet
// text link that shows on hover (always on touch).
const card = "";
const rowCls = "group flex min-h-[52px] min-w-0 items-center gap-3 py-2";
const btn = "inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-accent hover:underline disabled:opacity-45 disabled:no-underline";

export function isBrowserApp(a: EngineApp): boolean {
  return (a.integration ?? "").toLowerCase().includes("browser");
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function SectionTitle({ icon: Icon, title, hint }: { icon: typeof Globe; title: string; hint: string }) {
  return (
    <div className="mb-3 flex items-start gap-2.5">
      <Icon className="mt-1.5 h-4 w-4 shrink-0 text-text-muted" />
      <div className="min-w-0">
        <h3 className={DETAIL_TITLE}>{title}</h3>
        <p className={`${META} mt-0.5`}>{hint}</p>
      </div>
    </div>
  );
}

function SitesWithoutConnector({ vaultPath, domains }: { vaultPath: string; domains: string[] }) {
  const [apps, setApps] = useState<EngineApp[] | null>(() => {
    if (!hasInvoke("engine_apps_list", { vault: vaultPath })) return null;
    const c = peekInvoke<EngineApp[]>("engine_apps_list", { vault: vaultPath });
    return (Array.isArray(c) ? c : []).filter(isBrowserApp);
  });
  const [run, setRun] = useState<{ id: string; mode: ConnectorRunMode; goal?: string; url?: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", goal: "", domain: "" });
  const [busy, setBusy] = useState(false);
  const desktop = !isBrowser();

  const load = useCallback(async () => {
    try {
      const list = await invokeCached<EngineApp[]>("engine_apps_list", { vault: vaultPath }, { force: true });
      setApps((Array.isArray(list) ? list : []).filter(isBrowserApp));
    } catch { setApps([]); }
  }, [vaultPath]);
  useEffect(() => { void load(); }, [load]);

  async function importLogin(id: string) {
    try {
      const r = await invoke<{ ok?: boolean; message?: string; error?: string }>("engine_app_import_login", { id });
      if (r?.ok) toast.success(r.message || "Sign-in copied from Chrome");
      else toast.error(r?.error || r?.message || "Could not copy the sign-in");
    } catch (e) { toast.error(String(e)); }
  }

  async function addSite() {
    const title = form.name.trim();
    const id = slugify(title);
    if (!id) return;
    let url = form.url.trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    setBusy(true);
    try {
      await invoke("engine_app_add", {
        vault: vaultPath, id, title, integration: "browser",
        domains: form.domain ? [form.domain] : [], mcpCommand: null, mcpInstall: null,
      });
      setAdding(false);
      setRun({ id, mode: "learn", goal: form.goal.trim() || undefined, url: url || undefined });
      setForm({ name: "", url: "", goal: "", domain: "" });
      void load();
    } catch (e) { toast.error(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <section>
      <SectionTitle icon={Globe} title="Sites without a connector" hint="A browser opens, you sign in once, and the agent learns the steps. Later runs replay them." />
      <div className={`${card} divide-y divide-border-subtle`}>
        {apps === null ? (
          <div className={`${rowCls} text-[12px] text-text-muted`}><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
        ) : apps.length === 0 && !adding && !run ? (
          <div className={`${rowCls} text-[12px] text-text-muted`}>No sites yet.</div>
        ) : (
          apps.map((a) => (
            <div key={a.id}>
              <div className={rowCls}>
                <AppLogo name={a.title || a.id} size={28} />
                <div className="min-w-0 flex-1">
                  <div className={`${ROW_TITLE} truncate`}>{a.title || a.id}</div>
                  <div className={`${META} truncate`}>
                    {a.domains.length ? a.domains.map(titleCase).join(", ") : "No domain"} · {a.lastSuccessTs ? `Synced ${relTime(a.lastSuccessTs)}` : "Never synced"}
                  </div>
                </div>
                {desktop && (
                  <span className={`flex shrink-0 items-center gap-2 ${REVEAL}`}>
                    <button type="button" className={btn} disabled={!!run} onClick={() => setRun({ id: a.id, mode: "replay" })}>
                      <Play className="h-3.5 w-3.5" /> Run
                    </button>
                    <RowMenu items={[
                      { icon: RotateCcw, label: "Teach again", hint: "Relearn the steps from scratch", onClick: () => setRun({ id: a.id, mode: "relearn" }), disabled: !!run },
                      { icon: LogIn, label: "Use my Chrome sign-in", hint: "Copy this site's login from Chrome (quit Chrome first)", onClick: () => void importLogin(a.id) },
                    ]} />
                  </span>
                )}
              </div>
              {run?.id === a.id && (
                <div className="pb-3">
                  <ConnectorRunPanel appId={a.id} mode={run.mode} goal={run.goal} url={run.url} vault={vaultPath}
                    onDone={() => { void load(); }} onClose={() => setRun(null)} />
                </div>
              )}
            </div>
          ))
        )}
        {run && apps && !apps.some((a) => a.id === run.id) && (
          <div className="py-3">
            <ConnectorRunPanel appId={run.id} mode={run.mode} goal={run.goal} url={run.url} vault={vaultPath}
              onDone={() => { void load(); }} onClose={() => setRun(null)} />
          </div>
        )}
        {desktop && (adding ? (
          <div className="space-y-2 py-3">
            <div className="grid gap-2">
              <input aria-label="Site name" placeholder="Name, e.g. Acme Billing" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted/70 focus:border-accent-border focus:outline-none" />
              <input aria-label="Website" placeholder="Website, e.g. acme.example" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })}
                className="rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted/70 focus:border-accent-border focus:outline-none" />
            </div>
            <textarea aria-label="What to fetch" rows={2} placeholder="What to fetch, e.g. download each month's statement" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted/70 focus:border-accent-border focus:outline-none" />
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Domain" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })}
                className="rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-text-primary focus:border-accent-border focus:outline-none">
                <option value="">Pick a domain</option>
                {domains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
              </select>
              <button type="button" onClick={addSite} disabled={busy || !slugify(form.name)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-45">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Start learning
              </button>
              <button type="button" onClick={() => setAdding(false)} className="text-[13px] text-text-muted hover:text-text-primary">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="py-2.5">
            <button type="button" onClick={() => setAdding(true)} disabled={!!run} className={btn}><Plus className="h-3.5 w-3.5" /> Add a site</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function CommandLineTools() {
  // Seeded from the shared cache: a revisit shows the last answers at once.
  const [providers, setProviders] = useState<CliProvider[] | null>(() => {
    if (!hasInvoke("ingestion_cli_providers")) return null;
    const c = peekInvoke<CliProvider[]>("ingestion_cli_providers");
    return Array.isArray(c) ? c : [];
  });
  const [found, setFound] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const p of providers ?? []) { const v = peekInvoke<boolean>("ingestion_cli_probe", { providerId: p.id }); if (v !== undefined) out[p.id] = v; }
    return out;
  });
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const desktop = !isBrowser();

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const ps = await invokeCached<CliProvider[]>("ingestion_cli_providers", undefined, { force: true });
        const list = Array.isArray(ps) ? ps : [];
        if (live) setProviders(list);
        // The probes are independent: run them together.
        await Promise.all(list.map((p) => invokeCached<boolean>("ingestion_cli_probe", { providerId: p.id }, { force: true })
          .then((ok) => { if (live) setFound((c) => ({ ...c, [p.id]: ok })); })
          .catch(() => { /* best effort */ })));
      } catch { if (live) setProviders([]); }
    })();
    return () => { live = false; };
  }, []);

  async function pull(id: string) {
    setBusy(id);
    setMsg((m) => ({ ...m, [id]: "" }));
    try {
      const r = await invoke<{ domain: string; bytes: number }>("ingestion_cli_run", { providerId: id });
      setMsg((m) => ({ ...m, [id]: `Pulled ${r.bytes.toLocaleString()} bytes into ${titleCase(r.domain)}` }));
    } catch (e) { setMsg((m) => ({ ...m, [id]: String(e) })); }
    setBusy(null);
  }

  return (
    <section>
      <SectionTitle icon={Terminal} title="Command-line tools" hint="Read-only pulls from CLIs you already installed and signed into." />
      <div className={`${card} divide-y divide-border-subtle`}>
        {providers === null ? (
          <div className={`${rowCls} text-[12px] text-text-muted`}><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
        ) : providers.length === 0 ? (
          <div className={`${rowCls} text-[12px] text-text-muted`}>No command-line tools this Mac can pull from.</div>
        ) : providers.map((p) => (
          <div key={p.id} className={rowCls}>
            <AppLogo name={p.label} size={28} />
            <div className="min-w-0 flex-1">
              <div className={`${ROW_TITLE} truncate`}>{p.label}</div>
              <div className={`${META} truncate`}>
                {msg[p.id] || `Feeds ${titleCase(p.domain)}${found[p.id] === false ? " · Not installed" : ""}`}
              </div>
            </div>
            {desktop && (
              <button type="button" className={`${btn} ${busy === p.id ? "" : REVEAL}`} onClick={() => pull(p.id)} disabled={busy === p.id || found[p.id] === false}>
                {busy === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Pull
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export type AppsLaneId = "sites" | "clis" | "obsidian";

export function AppsLane({ lane, vaultPath, domains }: { lane: AppsLaneId; vaultPath: string; domains: string[] }) {
  const [obsidian, setObsidian] = useState(false);
  const desktop = !isBrowser();
  return (
    <div data-testid={`apps-lane-${lane}`} className="p-4 sm:p-6">
      {lane === "sites" && <SitesWithoutConnector vaultPath={vaultPath} domains={domains} />}
      {lane === "clis" && <CommandLineTools />}
      {lane === "obsidian" && (
        <section>
          <SectionTitle icon={FolderInput} title="Obsidian import" hint="Copy an Obsidian vault into a domain as readable notes. Links, tags and front matter are kept." />
          <div className={card}>
            <div className={rowCls}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-strong ring-1 ring-border-subtle"><ObsidianLogo className="h-4 w-4" /></span>
              <div className={`${ROW_TITLE} min-w-0 flex-1 truncate`}>Obsidian</div>
              {desktop ? (
                <button type="button" className={btn} onClick={() => setObsidian(true)}><FolderInput className="h-3.5 w-3.5" /> Import</button>
              ) : <span className="text-[12px] text-text-muted">On your Mac</span>}
            </div>
          </div>
        </section>
      )}
      {obsidian && (
        <ObsidianImportModal
          vaultPath={vaultPath}
          domains={domains.map((d) => ({ slug: d, label: titleCase(d) }))}
          onClose={() => setObsidian(false)}
          onDone={() => setObsidian(false)}
        />
      )}
    </div>
  );
}
