// Trusted sources: the owner's own data sites, added as apps that feed the
// agent read only (a remote MCP address, a site with llms.txt / openapi.json,
// or a list of links). The engine adds and checks them (`apps add-source`)
// and archives them (`apps remove-source`, never a delete). Once added, a
// source behaves like any app: Chat, @-mention, Activity.
import { useState } from "react";
import { Archive, Check, FileText, Globe, Link2, Loader2, Plug, Plus, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { invoke, isBrowser } from "./bridge";
import { RowMenu } from "./ui";
import { toast } from "./toast";
import { relTime } from "./format";
import { AppLogo } from "./appsmirror-parts";
import { statusMeta, type MirrorApp } from "./appsmirror-model";
import { AppScopeView } from "./appchat";
import { DetailTitle, META, ROW_TITLE, SECTION_TITLE } from "./typescale";
import {
  SOURCE_KINDS, SOURCE_KIND_LABEL, SUGGESTED_SOURCES, isWebSource, parseUrls, slugifyId,
  type AddSourceResult, type SourceKind, type SourceProbe, type UntrustedSource,
} from "./appscope";

// Plain sections, no boxes: the page is one column of quiet content.
const card = "";
const field = "w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-text-primary placeholder:text-text-muted/70 focus:border-accent-border focus:outline-none";
const primary = "inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-45";
const secondary = "inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline disabled:opacity-45 disabled:no-underline";

export const KIND_ICON: Record<string, typeof Plug> = { "mcp-remote": Plug, web: Globe, links: Link2 };

async function addSource(vaultPath: string, kind: SourceKind, urls: string[], name: string): Promise<AddSourceResult> {
  return invoke<AddSourceResult>("engine_apps_add_source", { vault: vaultPath, kind, urls, name });
}

// What the engine found when it looked at the source, in plain words.
export function ProbeView({ probe, kind }: { probe: SourceProbe; kind: string }) {
  if (!probe.ok) {
    return (
      <p data-testid="probe-error" className="flex items-start gap-2 text-[13px] text-err">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="min-w-0 break-words">{probe.error ? `Could not use it yet: ${probe.error}` : "Could not use it yet."}</span>
      </p>
    );
  }
  return (
    <div data-testid="probe-ok" className="space-y-2 text-[13px] text-text-secondary">
      {kind === "mcp-remote" && (
        <>
          <p className="flex items-center gap-2 text-ok"><Check className="h-4 w-4" /> Reached {probe.server?.name || "the server"}. {probe.tools?.length ?? 0} read-only tools.</p>
          {!!probe.tools?.length && (
            <ul className="flex flex-wrap gap-1.5">
              {probe.tools.map((t) => <li key={t.name} className="rounded-md bg-surface-warm px-2 py-0.5 font-mono text-[12px] text-text-primary">{t.name}</li>)}
            </ul>
          )}
        </>
      )}
      {kind === "web" && (
        <p className="flex items-center gap-2 text-ok"><Check className="h-4 w-4" />
          Found {[probe.llms_txt ? "llms.txt" : "", probe.openapi ? "openapi.json" : ""].filter(Boolean).join(" and ") || "the site"}.
        </p>
      )}
      {(kind === "links" || kind === "web") && !!probe.urls?.length && (
        <ul className="space-y-0.5">
          {probe.urls.map((u) => (
            <li key={u.url} className="flex min-w-0 items-center gap-2">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${u.ok ? "bg-ok" : "bg-err"}`} aria-hidden />
              <span className="min-w-0 truncate" title={u.url}>{u.url}</span>
              {!u.ok && <span className="shrink-0 text-err">{u.status ? `answered ${u.status}` : "no answer"}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AddSourcePane({ vaultPath, existing, onAdded, onOpen }: {
  vaultPath: string;
  existing: string[];
  onAdded: () => void;
  onOpen: (id: string) => void;
}) {
  const [kind, setKind] = useState<SourceKind>("mcp-remote");
  const [urls, setUrls] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<(AddSourceResult & { kind: SourceKind; urls: string[]; name: string }) | null>(null);
  const desktop = !isBrowser();
  const meta = SOURCE_KINDS.find((k) => k.id === kind)!;
  const list = parseUrls(urls);

  async function add(k: SourceKind, u: string[], n: string, key: string) {
    setBusy(key); setErr(null);
    try {
      const r = await addSource(vaultPath, k, u, n);
      setDone({ ...r, kind: k, urls: u, name: n });
      onAdded();
      if (r.probe?.ok) toast.success(`${r.app?.name ?? n} added`);
    } catch (e) { setErr(String(e).replace(/^Error:\s*/, "")); }
    finally { setBusy(null); }
  }

  const suggestions = SUGGESTED_SOURCES.filter((s) => !existing.includes(slugifyId(s.name)) && done?.app?.id !== slugifyId(s.name));
  return (
    <div data-testid="add-source" className="space-y-5 p-4 sm:p-6">
      <div>
        <DetailTitle>Add a source</DetailTitle>
        <p className={`${META} mt-1`}>Your own data sites, read only. Once added, chat with it, or @-mention it in any chat.</p>
      </div>

      {done && (
        <section data-testid="add-source-result" className={card}>
          <div className="flex items-center gap-3">
            <AppLogo name={done.app?.name ?? done.name} url={done.urls[0]} size={32} />
            <div className="min-w-0 flex-1">
              <div className={`${ROW_TITLE} truncate`}>{done.app?.name ?? done.name}</div>
              <div className={META}>{done.adopted ? "Already here, checked again" : "Added"} · {SOURCE_KIND_LABEL[done.kind]}</div>
            </div>
            {done.probe.ok
              ? <button type="button" className={primary} onClick={() => onOpen(done.app.id)}>Open</button>
              : <button type="button" className={secondary} disabled={!!busy} onClick={() => void add(done.kind, done.urls, done.name, "retry")}>
                  {busy === "retry" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Retry
                </button>}
          </div>
          <div className="mt-3"><ProbeView probe={done.probe} kind={done.kind} /></div>
        </section>
      )}

      {suggestions.length > 0 && (
        <section aria-label="Suggested">
          <h3 className={`${SECTION_TITLE} mb-2`}>Suggested</h3>
          {suggestions.map((s) => (
            <div key={s.url} data-testid="suggested-source" className="flex items-center gap-3 border-b border-border-subtle py-2.5 last:border-b-0">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <AppLogo name={s.name} url={s.url} size={32} />
                <div className="min-w-0">
                  <div className={`${ROW_TITLE} truncate`}>{s.name}</div>
                  <div className={`${META} line-clamp-2`} title={s.blurb}>{s.blurb}</div>
                </div>
              </div>
              <button type="button" className={`${secondary} shrink-0`} disabled={!desktop || !!busy} onClick={() => void add(s.kind, [s.url], s.name, s.url)}>
                {busy === s.url ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
              </button>
            </div>
          ))}
        </section>
      )}

      <section aria-label="Your own" className={card}>
        <h3 className={SECTION_TITLE}>Your own</h3>
        <div role="radiogroup" aria-label="Kind" className="mt-3 flex w-fit items-center rounded-lg bg-surface-warm p-1 max-sm:w-full">
          {SOURCE_KINDS.map((k) => {
            const I = KIND_ICON[k.id];
            return (
              <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} data-testid={`source-kind-${k.id}`} onClick={() => setKind(k.id)}
                className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[14px] max-sm:flex-1 max-sm:justify-center max-sm:px-1.5 max-sm:text-[13px] ${kind === k.id ? "bg-background font-semibold text-text-primary shadow-sm" : "text-text-muted hover:text-text-secondary"}`}>
                <I className="h-4 w-4" /> {k.label}
              </button>
            );
          })}
        </div>
        <p className={`${META} mt-2`}>{meta.hint}</p>
        <label className="mt-3 block text-[13px] font-semibold text-text-primary" htmlFor="source-urls">{kind === "links" ? "Addresses" : "Address"}</label>
        {kind === "links"
          ? <textarea id="source-urls" rows={3} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder={meta.placeholder} className={`${field} mt-1.5 resize-y`} />
          : <input id="source-urls" value={urls} onChange={(e) => setUrls(e.target.value)} placeholder={meta.placeholder} className={`${field} mt-1.5`} />}
        <label className="mt-3 block text-[13px] font-semibold text-text-primary" htmlFor="source-name">Name</label>
        <input id="source-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Foo data" className={`${field} mt-1.5`} />
        {err && <p data-testid="add-source-error" className="mt-3 flex items-start gap-2 text-[13px] text-err"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 break-words">{err}</span></p>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className={primary} data-testid="add-source-submit"
            disabled={!desktop || !!busy || !name.trim() || !list.length || (kind === "mcp-remote" && list.length !== 1)}
            onClick={() => void add(kind, list, name.trim(), "form")}>
            {busy === "form" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add and check
          </button>
          <span className={META}>{desktop ? "Prevail looks at it before it is used. No passwords or keys: the address must work without them." : "Adding a source runs on your Mac."}</span>
        </div>
      </section>
    </div>
  );
}

// A source that synced in from another Mac: trusting is per machine, so it
// waits for a click here.
export function UntrustedSourceDetail({ vaultPath, source, onTrusted }: { vaultPath: string; source: UntrustedSource; onTrusted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [probe, setProbe] = useState<SourceProbe | null>(null);
  async function trust() {
    setBusy(true); setErr(null);
    try {
      const r = await addSource(vaultPath, source.integration, source.urls, source.name);
      setProbe(r.probe);
      if (r.probe?.ok) { toast.success(`${source.name} is trusted on this Mac`); onTrusted(); }
    } catch (e) { setErr(String(e).replace(/^Error:\s*/, "")); }
    finally { setBusy(false); }
  }
  return (
    <div data-testid="untrusted-source" className="space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <AppLogo name={source.name} url={source.urls[0]} size={32} />
        <div className="min-w-0 flex-1">
          <DetailTitle className="truncate">{source.name}</DetailTitle>
          <p className={`${META} truncate`}>Trusted source · {SOURCE_KIND_LABEL[source.integration] ?? source.integration}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <ShieldCheck className="hidden h-5 w-5 shrink-0 text-warn sm:block" />
        <div className="min-w-0 flex-1">
          <p className={ROW_TITLE}>Not trusted on this Mac yet</p>
          <p className={META}>It came over with your vault. Each Mac decides for itself what it trusts, so chats here leave it out until you trust it.</p>
        </div>
        <button type="button" className={primary} disabled={busy || isBrowser()} onClick={() => void trust()} data-testid="trust-here">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Trust on this Mac
        </button>
      </div>
      <ul className={`${META} space-y-1`}>{source.urls.map((u) => <li key={u} className="truncate" title={u}>{u}</li>)}</ul>
      {err && <p className="text-[13px] text-err">{err}</p>}
      {probe && <ProbeView probe={probe} kind={source.integration} />}
    </div>
  );
}

export function TrustedSourceDetail({ vaultPath, app, onChanged }: { vaultPath: string; app: MirrorApp; onChanged: () => void }) {
  const [busy, setBusy] = useState<null | "check" | "archive">(null);
  const [probe, setProbe] = useState<SourceProbe | null>(null);
  const [archived, setArchived] = useState<{ from: string; to: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const kind = (app.integration ?? "mcp-remote") as SourceKind;
  const status = statusMeta(app.status);
  const urls = app.urls ?? (app.url ? [app.url] : []);
  const desktop = !isBrowser();

  async function check() {
    setBusy("check"); setErr(null);
    try { const r = await addSource(vaultPath, kind, urls, app.name); setProbe(r.probe); onChanged(); }
    catch (e) { setErr(String(e).replace(/^Error:\s*/, "")); }
    finally { setBusy(null); }
  }
  async function archive() {
    setBusy("archive"); setErr(null);
    try {
      const r = await invoke<{ ok?: boolean; archived?: { from: string; to: string } }>("engine_apps_remove_source", { vault: vaultPath, id: app.id });
      if (r?.archived) setArchived(r.archived);
      toast.success(`${app.name} archived`);
      onChanged();
    } catch (e) { setErr(String(e).replace(/^Error:\s*/, "")); }
    finally { setBusy(null); }
  }

  if (archived) {
    return (
      <div data-testid="source-archived" className="space-y-2 p-4 sm:p-6">
        <DetailTitle>{app.name}</DetailTitle>
        <p className="flex items-center gap-2 text-[14px] text-text-secondary"><Archive className="h-4 w-4 text-text-muted" /> Archived. Nothing was deleted.</p>
        <p className={META} title={archived.to}>Its folder moved to the archive in your vault.</p>
      </div>
    );
  }

  const tools = kind === "mcp-remote" ? (
    <section className={card} aria-label="Tools">
      <h4 className={SECTION_TITLE}>Tools{app.tools?.length ? <span className="ml-2 text-[12px] font-normal text-text-muted">{app.tools.length}</span> : null}</h4>
      {!app.tools?.length ? <p className={`${META} mt-2`}>No tools listed yet. Check it again from Connection.</p> : (
        <ul className="mt-2 divide-y divide-border-subtle">
          {app.tools.map((t) => (
            <li key={t.name} className="flex min-w-0 items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-text-primary">{t.name}</span>
              <span data-testid="tool-badge" className={`shrink-0 text-[12px] ${t.kind === "read" ? "text-text-muted" : "text-err"}`}>{t.kind === "read" ? "Read" : "Blocked"}</span>
            </li>
          ))}
        </ul>
      )}
      <p className={`${META} mt-3`}>A trusted source is read only. Its read tools run without asking and are logged in Activity.</p>
    </section>
  ) : undefined;

  const connection = (
    <div className="space-y-6">
      <section aria-label="Source">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className={SECTION_TITLE}>{SOURCE_KIND_LABEL[kind] ?? kind}</h4>
          <button type="button" className={secondary} disabled={!desktop || busy !== null} onClick={() => void check()}>
            {busy === "check" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Check again
          </button>
        </div>
        <ul className="mt-2 space-y-1">{urls.map((u) => <li key={u} className="truncate text-[13px] text-text-secondary" title={u}>{u}</li>)}</ul>
        {app.tools_checked_at && <p className={`${META} mt-1`}>Checked {relTime(app.tools_checked_at)}</p>}
        {probe && <div className="mt-3"><ProbeView probe={probe} kind={kind} /></div>}
        {err && <p className="mt-3 text-[13px] text-err">{err}</p>}
      </section>
      {app.source && (app.source.llms || app.source.endpoints?.length) ? (
        <section className={card} aria-label="What it documents">
          <h4 className={`${SECTION_TITLE} flex items-center gap-2`}><FileText className="h-4 w-4 text-text-muted" /> {app.source.title || "What it documents"}</h4>
          {app.source.llms && <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-[13px] text-text-secondary">{app.source.llms}</p>}
          {!!app.source.endpoints?.length && (
            <ul className="mt-2 space-y-0.5">{app.source.endpoints.slice(0, 20).map((e) => <li key={e.path} className="truncate text-[13px] text-text-secondary"><span className="font-mono text-text-primary">GET {e.path}</span>{e.summary ? ` · ${e.summary}` : ""}</li>)}</ul>
          )}
        </section>
      ) : null}
      <p className={META}>Read only, on this Mac. Prevail never stores a password or database key for a source; the address must work without one.</p>
    </div>
  );

  return (
    <AppScopeView
      vaultPath={vaultPath}
      app={{ id: app.id, name: app.name, url: urls[0], runtime: "claude" }}
      subtitle={<>Trusted source · {SOURCE_KIND_LABEL[kind] ?? kind} · <span className={status.tone === "ok" ? "text-ok" : "text-err"}>{app.status === "connected" ? "Ready" : "Not reachable"}</span></>}
      actions={desktop ? <RowMenu label="More source actions" items={[
        { icon: RefreshCw, label: "Check again", onClick: () => void check() },
        { icon: Archive, label: "Archive source", hint: "Moves its folder to the archive", onClick: () => void archive() },
      ]} /> : undefined}
      notice={app.status !== "connected" ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="min-w-0 break-words text-[13px] text-err">Could not use it yet{app.status_detail ? `: ${app.status_detail}` : "."}</p>
          <button type="button" className={secondary} disabled={!desktop || busy !== null} onClick={() => void check()}>
            {busy === "check" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Retry
          </button>
        </div>
      ) : null}
      activityNote={isWebSource(app) ? "Fetches from this site aren't logged yet." : undefined}
      tools={tools}
      connection={connection}
    />
  );
}
