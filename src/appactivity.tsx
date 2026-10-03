// The access log, drawn: every call a conversation made to an app, newest
// first. Used as an app's Activity tab (one app) and as the "Apps used"
// section of a domain's Context and an entity's detail (every app, filtered).
import { useState, type ReactNode } from "react";
import { MessageSquare, X } from "lucide-react";
import { useInvokeQuery } from "./query";
import { titleCase } from "./format";
import { VirtualRows } from "./virtualrows";
import { useChatApps } from "./chatrefs";
import { AppLogo, TONE_TEXT } from "./appsmirror-parts";
import {
  ACCESS_LABEL, OUTCOME_LABEL, accessLogArgs, asAccessLines, openApp,
  type AccessFilter, type AccessLine,
} from "./appscope";
import type { Tone } from "./appsmirror-model";

const ACCESS_TONE: Record<string, Tone> = { read: "ok", write: "warn", blocked: "err" };
const OUTCOME_TONE: Record<string, string> = { ran: "text-text-muted", queued: "text-warn", denied: "text-err", declined: "text-text-muted" };

function when(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return time;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

function Row({ l, showApp, appName, threadTitle, onOpenThread }: {
  l: AccessLine; showApp: boolean; appName: (id: string) => string;
  threadTitle?: (slug: string) => string | undefined; onOpenThread?: (slug: string) => void;
}) {
  const convo = l.thread ? threadTitle?.(l.thread) || "A conversation" : "";
  const tone = ACCESS_TONE[l.access] ?? "muted";
  // One muted meta line joined by middle dots: what kind of call, how it went,
  // the account, domain, entity and conversation. No pills.
  const parts: ReactNode[] = [
    <span key="a" className={tone === "ok" || tone === "muted" ? "" : TONE_TEXT[tone]}>{ACCESS_LABEL[l.access] ?? l.access}</span>,
    <span key="o" className={OUTCOME_TONE[l.outcome] ?? ""}>{OUTCOME_LABEL[l.outcome] ?? l.outcome}</span>,
    ...(l.account ? [<span key="acc" data-testid="access-account" className="truncate">{l.account}</span>] : []),
    ...(l.domain ? [<span key="d">{l.domain.startsWith("_app-") ? "App chat" : titleCase(l.domain)}</span>] : []),
    ...(l.entity ? [<span key="e" className="truncate">{titleCase(l.entity.split("/").pop() ?? "")}</span>] : []),
    ...(l.thread ? [onOpenThread
      ? <button key="t" type="button" onClick={() => onOpenThread(l.thread!)} className="min-w-0 truncate hover:text-accent" title="Open this conversation">{convo}</button>
      : <span key="t" className="truncate">{convo}</span>] : []),
  ];
  return (
    <li data-testid="access-line" className="flex min-w-0 gap-3 border-b border-border-subtle px-1 py-2.5 last:border-b-0">
      {showApp && <button type="button" onClick={() => openApp({ id: l.app, tab: "activity" })} title={`Open ${appName(l.app)}`} className="mt-0.5 shrink-0"><AppLogo name={appName(l.app)} size={24} /></button>}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          {showApp && <span className="shrink-0 text-[14px] font-medium text-text-primary">{appName(l.app)}</span>}
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-text-primary" title={l.tool}>{l.tool}</span>
          <span className="shrink-0 text-[12px] tabular-nums text-text-muted">{when(l.ts)}</span>
        </div>
        {l.summary && <p title={l.summary} className="mt-0.5 line-clamp-2 break-words text-[13px] text-text-secondary [overflow-wrap:anywhere]">{l.summary}</p>}
        <p className="mt-0.5 flex min-w-0 flex-wrap items-baseline text-[12px] text-text-muted">
          {parts.map((p, i) => <span key={i} className="inline-flex min-w-0">{i > 0 && <span aria-hidden className="whitespace-pre"> · </span>}{p}</span>)}
        </p>
      </div>
    </li>
  );
}

export function AppActivity({ vaultPath, filter, showApp = false, empty, onClearThread, threadTitle, onOpenThread, accounts = [], hideEmpty = false, heading }: {
  // Drawn above the list (with hideEmpty, only when there is a list).
  heading?: ReactNode;
  vaultPath: string;
  // A section on someone else's page ("Apps used"): with no calls it renders
  // nothing at all, so the page never shows an empty heading.
  hideEmpty?: boolean;
  // A Google app's accounts: each line names its account, and a filter picks one.
  accounts?: string[];
  filter: AccessFilter;
  // Every app's lines (a domain's or an entity's "Apps used"): name each one.
  showApp?: boolean;
  empty: string;
  // Shown with a thread filter: drop it and list every conversation.
  onClearThread?: () => void;
  // An app's own page knows its conversations: name them, and open one.
  threadTitle?: (slug: string) => string | undefined;
  onOpenThread?: (slug: string) => void;
}) {
  const q = useInvokeQuery<unknown>("engine_apps_access_log", accessLogArgs(vaultPath, filter), { invalidateOn: ["prevail:threads-changed"] });
  const [account, setAccount] = useState("");
  const all = asAccessLines(q.data);
  const lines = account ? all.filter((l) => l.account === account) : all;
  const accountChoices = Array.from(new Set([...accounts, ...all.map((l) => l.account ?? "").filter(Boolean)]));
  const apps = useChatApps(showApp ? vaultPath : null);
  const appName = (id: string) => apps.find((a) => a.id === id)?.name ?? id;
  if (hideEmpty && !q.loading && all.length === 0) return null;
  return (
    <div data-testid="app-activity">
      {heading}
      {filter.thread && onClearThread && (
        <div className="mb-2 flex items-center gap-2 text-[13px] text-text-secondary">
          <span className="inline-flex items-center gap-1.5 text-text-secondary">
            <MessageSquare className="h-3.5 w-3.5 text-text-muted" /> This conversation only
            <button type="button" onClick={onClearThread} aria-label="Show every conversation" title="Show every conversation" className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-strong hover:text-text-primary"><X className="h-3.5 w-3.5" /></button>
          </span>
        </div>
      )}
      {accountChoices.length > 1 && (
        <select aria-label="Filter by account" data-testid="activity-account-filter" value={account} onChange={(e) => setAccount(e.target.value)}
          className="mb-2 h-8 max-w-full truncate rounded-lg border border-border bg-background px-2 text-[13px] text-text-secondary focus:border-accent-border focus:outline-none">
          <option value="">All accounts</option>
          {accountChoices.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      )}
      {q.loading ? (
        <p className="py-3 text-[13px] text-text-muted">Reading the access log</p>
      ) : lines.length === 0 ? (
        <p data-testid="app-activity-empty" className="py-2 text-[12px] text-text-muted">{empty}</p>
      ) : (
        <ul>
          <VirtualRows items={lines} estimate={64} getKey={(l, i) => `${l.app}:${l.ts}:${i}`} render={(l) => <Row l={l} showApp={showApp} appName={appName} threadTitle={threadTitle} onOpenThread={onOpenThread} />} />
        </ul>
      )}
    </div>
  );
}
