// The access log, drawn: every call a conversation made to an app, newest
// first. Used as an app's Activity tab (one app) and as the "Apps used"
// section of a domain's Context and an entity's detail (every app, filtered).
import { useState } from "react";
import { AtSign, Boxes, Layers, MessageSquare, X } from "lucide-react";
import { useInvokeQuery } from "./query";
import { titleCase } from "./format";
import { VirtualRows } from "./virtualrows";
import { useChatApps } from "./chatrefs";
import { AppLogo, TONE_PILL } from "./appsmirror-parts";
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
  return (
    <li data-testid="access-line" className="flex min-w-0 gap-3 border-b border-border-subtle px-1 py-2.5 last:border-b-0">
      {showApp && <button type="button" onClick={() => openApp({ id: l.app, tab: "activity" })} title={`Open ${appName(l.app)}`} className="mt-0.5 shrink-0"><AppLogo name={appName(l.app)} size={24} /></button>}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {showApp && <span className="text-[14px] font-semibold text-text-primary">{appName(l.app)}</span>}
          <span className="min-w-0 truncate font-mono text-[13px] text-text-primary" title={l.tool}>{l.tool}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium ring-1 ${TONE_PILL[tone]}`}>{ACCESS_LABEL[l.access] ?? l.access}</span>
          <span className={`shrink-0 text-[12px] font-medium ${OUTCOME_TONE[l.outcome] ?? "text-text-muted"}`}>{OUTCOME_LABEL[l.outcome] ?? l.outcome}</span>
          <span className="ml-auto shrink-0 text-[12px] tabular-nums text-text-muted">{when(l.ts)}</span>
        </div>
        {l.summary && <p className="mt-0.5 line-clamp-2 break-words text-[13px] text-text-secondary [overflow-wrap:anywhere]">{l.summary}</p>}
        {(l.thread || l.domain || l.entity || l.account) && (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-text-muted">
            {l.account && <span data-testid="access-account" className="inline-flex min-w-0 items-center gap-1"><AtSign className="h-3 w-3 shrink-0" /><span className="truncate">{l.account}</span></span>}
            {l.domain && <span className="inline-flex items-center gap-1"><Layers className="h-3 w-3" />{l.domain.startsWith("_app-") ? "App chat" : titleCase(l.domain)}</span>}
            {l.entity && <span className="inline-flex min-w-0 items-center gap-1"><Boxes className="h-3 w-3 shrink-0" /><span className="truncate">{l.entity.split("/").pop()}</span></span>}
            {l.thread && (onOpenThread
              ? <button type="button" onClick={() => onOpenThread(l.thread!)} className="inline-flex min-w-0 items-center gap-1 hover:text-accent" title="Open this conversation"><MessageSquare className="h-3 w-3 shrink-0" /><span className="truncate">{convo}</span></button>
              : <span className="inline-flex min-w-0 items-center gap-1"><MessageSquare className="h-3 w-3 shrink-0" /><span className="truncate">{convo}</span></span>)}
          </div>
        )}
      </div>
    </li>
  );
}

export function AppActivity({ vaultPath, filter, showApp = false, empty, onClearThread, threadTitle, onOpenThread, accounts = [] }: {
  vaultPath: string;
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
  return (
    <div data-testid="app-activity">
      {filter.thread && onClearThread && (
        <div className="mb-2 flex items-center gap-2 text-[13px] text-text-secondary">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-border bg-accent-soft px-2.5 py-0.5 text-accent">
            <MessageSquare className="h-3.5 w-3.5" /> This conversation
            <button type="button" onClick={onClearThread} aria-label="Show every conversation" title="Show every conversation" className="rounded-full p-0.5 hover:bg-accent/15"><X className="h-3 w-3" /></button>
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
        <p className="py-3 text-[14px] text-text-muted">Reading the access log</p>
      ) : lines.length === 0 ? (
        <p data-testid="app-activity-empty" className="py-3 text-[14px] text-text-muted">{empty}</p>
      ) : (
        <ul>
          <VirtualRows items={lines} estimate={64} getKey={(l, i) => `${l.app}:${l.ts}:${i}`} render={(l) => <Row l={l} showApp={showApp} appName={appName} threadTitle={threadTitle} onOpenThread={onOpenThread} />} />
        </ul>
      )}
    </div>
  );
}
