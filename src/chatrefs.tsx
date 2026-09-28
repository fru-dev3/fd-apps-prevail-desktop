// @-references in every chat composer, and what a reply says about the apps
// it used. Typing "@" lists apps (connectors and trusted sources), people and
// things, and domains; picking one adds a chip that is sent with every turn
// (--app / --entity / --ref-domain). A reply whose tool calls went to an app
// opens with a small "Used Gmail · 3 reads" chip that leads to that app's
// Activity; engine notes about apps (routed, needs sign-in, unavailable) are
// drawn in the flow of the reply.
import { useEffect, useMemo } from "react";
import { AlertTriangle, Boxes, Building2, ExternalLink, KeyRound, Layers, MapPin, Route, User, X } from "lucide-react";
import { useInvokeQuery } from "./query";
import { titleCase } from "./format";
import { lsGet, LS } from "./storage";
import { isUserDomain } from "./helpers";
import { loadEntities, useEntityStore } from "./entitystore";
import { AppLogo, openExternal } from "./appsmirror-parts";
import type { MirrorApp, MirrorList } from "./appsmirror-model";
import { appUseLabel, appUses, openApp, runtimeName, type ChatRef, type RefKind } from "./appscope";
import type { AppNotice, ChatMessage } from "./types";

export const AT_RE = /(^|\s)@([\p{L}\p{N}_.\-/]*)$/u;
export function atMatchAt(input: string, caret: number): { token: string; start: number; end: number } | null {
  const before = input.slice(0, Math.min(caret, input.length));
  const m = before.match(AT_RE);
  if (!m) return null;
  return { token: m[2], start: before.length - m[2].length - 1, end: before.length };
}

// The apps a chat can reference: runtime connectors plus trusted sources.
export function useChatApps(vaultPath: string | null): { id: string; name: string; url?: string; runtime?: string; trusted?: boolean }[] {
  const mirror = useInvokeQuery<MirrorList>("apps_mirror_list", vaultPath ? { vault: vaultPath } : null, { staleMs: Infinity });
  return useMemo(() => (mirror.data?.apps ?? []).filter((a) => a.status !== "untrusted_here").map((a) => ({ id: a.id, name: a.name, url: a.url ?? a.urls?.[0], runtime: a.runtime, trusted: !!a.trusted })), [mirror.data]);
}

export type RefCandidate = ChatRef & { sub?: string; url?: string; entityKind?: string };

export function useRefCandidates(vaultPath: string | null, token: string | null, only: RefKind | null): RefCandidate[] {
  const apps = useChatApps(token !== null ? vaultPath : null);
  const ents = useEntityStore();
  const doms = useInvokeQuery<{ name: string }[]>("scan_vault", token !== null && vaultPath ? { path: vaultPath } : null, { staleMs: 60_000 });
  useEffect(() => { if (token !== null && vaultPath) void loadEntities(vaultPath); }, [token !== null, vaultPath]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => {
    if (token === null) return [];
    const q = token.toLowerCase();
    const hit = (...xs: (string | undefined)[]) => !q || xs.some((x) => x && x.toLowerCase().includes(q));
    const a: RefCandidate[] = apps.filter((x) => hit(x.name, x.id)).slice(0, 5)
      .map((x) => ({ kind: "app", id: x.id, label: x.name, url: x.url, sub: x.trusted ? "Trusted source" : x.runtime ? `App via ${runtimeName(x.runtime)}` : "App" }));
    const e: RefCandidate[] = (ents.list?.entities ?? []).filter((x) => hit(x.name, ...x.aliases))
      .sort((x, y) => Number(y.saved) - Number(x.saved) || y.mention_count - x.mention_count).slice(0, 5)
      .map((x) => ({ kind: "entity", id: x.id, label: x.name, entityKind: x.kind, sub: ENTITY_KIND[x.kind] ?? "Entity" }));
    const d: RefCandidate[] = (Array.isArray(doms.data) ? doms.data : []).map((x) => x.name).filter(isUserDomain).filter((x) => hit(x, titleCase(x))).slice(0, 5)
      .map((x) => ({ kind: "domain", id: x, label: titleCase(x), sub: "Domain" }));
    if (only === "app") return a;
    if (only === "entity") return e;
    return [...a, ...e, ...d];
  }, [token, only, apps, ents.list, doms.data]);
}

const ENTITY_KIND: Record<string, string> = { person: "Person", place: "Place", org: "Company", thing: "Thing" };

function RefIcon({ r, size = 16 }: { r: RefCandidate | ChatRef; size?: number }) {
  if (r.kind === "app") return <AppLogo name={r.label} url={(r as RefCandidate).url} size={size} />;
  if (r.kind === "domain") return <Layers className="shrink-0 text-text-muted" style={{ width: size - 2, height: size - 2 }} />;
  const k = (r as RefCandidate).entityKind ?? r.id.split("/")[0];
  const I = k === "person" ? User : k === "place" ? MapPin : k === "org" ? Building2 : Boxes;
  return <I className="shrink-0 text-text-muted" style={{ width: size - 2, height: size - 2 }} />;
}

const GROUP: Record<RefKind, string> = { app: "Apps", entity: "People and things", domain: "Domains" };

// The suggestion list, anchored above the composer (inside its relative box).
export function RefSuggest({ items, index, onPick, empty }: { items: RefCandidate[]; index: number; onPick: (r: RefCandidate) => void; empty: string }) {
  return (
    <div data-testid="ref-suggest" role="listbox" aria-label="Reference" className="absolute bottom-full left-3 z-40 mb-1 max-h-80 w-80 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-lg border border-border bg-surface shadow-xl">
      {items.length === 0 ? <div className="px-3 py-2.5 text-[13px] text-text-muted">{empty}</div> : items.map((r, i) => (
        <div key={`${r.kind}:${r.id}`}>
          {(i === 0 || items[i - 1].kind !== r.kind) && <div className="border-t border-border-subtle bg-surface-warm px-3 py-1 text-[12px] font-medium text-text-muted first:border-t-0">{GROUP[r.kind]}</div>}
          <button type="button" role="option" aria-selected={i === index} data-testid={`ref-option-${r.kind}-${r.id}`}
            onMouseDown={(e) => { e.preventDefault(); onPick(r); }}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${i === index ? "bg-accent-soft" : "hover:bg-surface-warm"}`}>
            <RefIcon r={r} size={18} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[14px] ${i === index ? "text-accent" : "text-text-primary"}`}>{r.label}</span>
              {r.sub && <span className="block truncate text-[12px] text-text-muted">{r.sub}</span>}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

export function RefChips({ refs, onRemove }: { refs: ChatRef[]; onRemove: (r: ChatRef) => void }) {
  if (!refs.length) return null;
  return (
    <div data-testid="ref-chips" className="mb-1.5 flex flex-wrap items-center gap-1.5 px-2 pt-2">
      {refs.map((r) => (
        <span key={`${r.kind}:${r.id}`} data-testid={`ref-chip-${r.kind}`} title={r.kind === "app" ? `${r.label} is used on every turn` : `${r.label} comes along on every turn`}
          className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border border-accent-border bg-accent-soft py-0.5 pl-1.5 pr-1 text-[13px] font-medium text-accent">
          <RefIcon r={r} size={16} />
          <span className="truncate">@{r.label}</span>
          <button type="button" onClick={() => onRemove(r)} aria-label={`Remove ${r.label}`} title={`Remove ${r.label}`}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-accent/15"><X className="h-3 w-3" /></button>
        </span>
      ))}
    </div>
  );
}

function useNames(): (id: string) => { name: string; url?: string; app?: MirrorApp } {
  const vault = lsGet(LS.vault) || null;
  const apps = useChatApps(vault);
  const mirror = useInvokeQuery<MirrorList>("apps_mirror_list", vault ? { vault } : null, { staleMs: Infinity });
  return (id) => {
    const a = apps.find((x) => x.id === id);
    return { name: a?.name ?? id, url: a?.url, app: mirror.data?.apps.find((x) => x.id === id) };
  };
}

// The top of a reply: which apps it used, and what the engine said about them.
export function ReplyApps({ msg }: { msg: ChatMessage }) {
  const names = useNames();
  const vault = lsGet(LS.vault) || null;
  const mirror = useInvokeQuery<MirrorList>("apps_mirror_list", vault ? { vault } : null, { staleMs: Infinity });
  const hasApps = (msg.steps ?? []).some((s) => s.app);
  const uses = hasApps ? appUses(msg.steps, mirror.data?.apps ?? [], (msg.steps ?? []).filter((s) => s.app).map((s) => ({ id: s.app!, name: names(s.app!).name }))) : [];
  const notices = msg.appNotices ?? [];
  if (!uses.length && !notices.length) return null;
  return (
    <div className="mb-2.5 flex flex-col gap-1.5">
      {notices.map((n, i) => <Notice key={i} n={n} name={(id) => names(id).name} />)}
      {uses.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {uses.map((u) => (
            <button key={u.app} type="button" data-testid="app-use-chip" onClick={() => openApp({ id: u.app, tab: "activity", thread: u.thread })}
              title={`Open ${u.name}'s activity for this conversation`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-0.5 pl-1 pr-2.5 text-[13px] font-medium text-text-secondary transition-colors hover:border-accent-border hover:text-accent">
              <AppLogo name={u.name} url={names(u.app).url} size={18} />
              {appUseLabel(u)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Notice({ n, name }: { n: AppNotice; name: (id: string) => string }) {
  if (n.kind === "routed") {
    return (
      <p data-testid="app-routed" className="inline-flex items-center gap-1.5 text-[13px] text-text-muted">
        <Route className="h-3.5 w-3.5" /> Using {runtimeName(n.runtime)}{n.apps?.length ? ` for ${n.apps.join(", ")}` : ""}
      </p>
    );
  }
  if (n.kind === "unavailable") {
    return (
      <p data-testid="app-unavailable" className="flex items-start gap-1.5 text-[13px] text-text-secondary">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
        <span>{name(n.app)} is connected through {runtimeName(n.runtime_needed)}, so this reply could not use it. Ask again in a chat on {runtimeName(n.runtime_needed)}.</span>
      </p>
    );
  }
  const label = n.name || name(n.app);
  const href = n.signin_url || null;
  return (
    <div data-testid="app-needs-auth" className="flex flex-col gap-2 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center">
      <KeyRound className="hidden h-4 w-4 shrink-0 text-warn sm:block" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-text-primary">{label} needs sign-in</p>
        <p className="text-[13px] text-text-muted">Sign in once, then ask again. Prevail uses the sign-in your runtime keeps.</p>
      </div>
      <button type="button" onClick={() => (href ? openExternal(href) : openApp({ id: n.app, tab: "connection" }))}
        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 text-[13px] font-semibold text-accent hover:bg-accent/15">
        Sign in {href ? <ExternalLink className="h-3.5 w-3.5" /> : null}
      </button>
    </div>
  );
}

