// An app as a chat scope: the same chat as a domain or an entity, scoped to
// one app (a runtime connector or a trusted source). The app's page is a
// compact header, then tabs: Chat (the default), Activity (its access log),
// Tools, Connection. Never a side panel.
// Threads live in the app's own space (`_app-<id>`, frontmatter `app: <id>`);
// every turn goes through the engine with --scope-app so the model gets the
// app's context block and tools.
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { useDetectedClis, useFrameworkLens } from "./hooks";
import { useIsPhone } from "./useisphone";
import { resolveThreadPath } from "./entitythreads";
import { DetailTitle, META } from "./typescale";
import { AppLogo } from "./appsmirror-parts";
import { AppActivity } from "./appactivity";
import { activityRecorded, appAccountPref, appScopeKey, effectiveGoogleAccount, loadAppThreads, takeAppFocus, useGoogleAccounts, type AppFocus, type AppThread } from "./appscope";
import { getPref, setPref } from "./storage";

const ChatPanel = lazy(() => import("./chatpanel").then((m) => ({ default: m.ChatPanel })));

const NO_DOMAINS: never[] = [];
const NO_SET = new Set<string>();

// `thread`: a slug; undefined continues the latest, null starts a new one.
type Request = { thread?: string | null; n: number };

function ChatSkeleton() {
  return (
    <div data-testid="app-chat-skeleton" aria-busy="true" className="flex min-h-0 flex-1 flex-col justify-end gap-3 py-4">
      <div className="h-4 w-2/3 animate-pulse rounded bg-surface-warm" />
      <div className="h-24 animate-pulse rounded-xl border border-border bg-surface-warm/60" />
    </div>
  );
}

function AppChat({ vaultPath, app, threads, request, onCurrent, onThreadsChanged, googleAccount }: {
  vaultPath: string;
  app: { id: string; name: string };
  // A Google app's Account picker: an account id or "all" (--google-account).
  googleAccount: string | null;
  threads: AppThread[] | null;
  request: Request;
  onCurrent: (slug: string | null) => void;
  onThreadsChanged: () => void;
}) {
  const phone = useIsPhone();
  const clis = useDetectedClis();
  const fwLens = useFrameworkLens();
  const [path, setPath] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const touched = useRef(false);
  const handled = useRef<number | null>(null);
  const scope = appScopeKey(app.id);

  useEffect(() => {
    if (request.thread === undefined && threads === null) return;
    if (handled.current === request.n) return;
    handled.current = request.n;
    touched.current = false;
    const t = request.thread === null ? null
      : request.thread ? threads?.find((x) => x.slug === request.thread) ?? { slug: request.thread, title: "", updated: 0, turns: 0 }
      : threads?.[0] ?? null;
    if (!t) { setPath(null); onCurrent(null); setNonce((k) => k + 1); return; }
    onCurrent(t.slug);
    let alive = true;
    void resolveThreadPath(vaultPath, { ...t, domain: scope }).then((p) => {
      if (!alive || touched.current || handled.current !== request.n) return;
      setPath(p);
      setNonce((k) => k + 1);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, threads, vaultPath, scope]);

  return (
    <div data-testid="app-chat" className="flex min-h-0 flex-1 flex-col">
      <ChatPanel
        domain={null}
        domainPath={null}
        threadDomain={scope}
        scopeApp={app}
        scopeGoogleAccount={googleAccount}
        vaultPath={vaultPath}
        clis={clis}
        fwLens={fwLens}
        onSwitchToCouncil={() => {}}
        activeThreadPath={path}
        chatViewNonce={nonce}
        onActiveThreadChange={(p) => {
          touched.current = true;
          setPath(p);
          onCurrent(p ? p.split("/").pop()?.replace(/\.md$/, "") ?? null : null);
        }}
        onThreadsChanged={() => { onThreadsChanged(); window.dispatchEvent(new Event("prevail:threads-changed")); }}
        onStreamStart={() => {}}
        onStreamEnd={() => {}}
        domains={NO_DOMAINS}
        domainStats={{}}
        runningDomains={NO_SET}
        finishedDomains={NO_SET}
        onPickDomain={() => {}}
        domainTab="chat"
        setDomainTab={() => {}}
        active
        phone={phone}
      />
    </div>
  );
}

export type AppTab = AppFocus["tab"];

export function AppScopeView({ vaultPath, app, subtitle, actions, tools, connection, notice, activityNote }: {
  vaultPath: string;
  app: { id: string; name: string; url?: string; runtime?: string };
  // "via Claude · Connected": where it comes from and its state, in words.
  subtitle: ReactNode;
  actions?: ReactNode;
  tools?: ReactNode;
  connection: ReactNode;
  // Above the tabs: a sign-in card or an error, when there is one.
  notice?: ReactNode;
  // A quiet line above the Activity list (what it does not record yet).
  activityNote?: string;
}) {
  const phone = useIsPhone();
  const first = useRef<AppFocus | null>(takeAppFocus(app.id));
  const [tab, setTab] = useState<AppTab>(first.current?.tab ?? "chat");
  const [threadFilter, setThreadFilter] = useState<string | undefined>(first.current?.thread);
  const [chatReq, setChatReq] = useState<Request | null>(tab === "chat" ? { n: 1 } : null);
  const [chatSlug, setChatSlug] = useState<string | null>(null);
  const [threads, setThreads] = useState<AppThread[] | null>(null);

  const accounts = useGoogleAccounts(vaultPath, app);
  const [savedAccount, setSavedAccount] = useState(() => getPref(appAccountPref(app.id), ""));
  const account = effectiveGoogleAccount(savedAccount, accounts);
  const pickAccount = (v: string) => { setPref(appAccountPref(app.id), v); setSavedAccount(v); };

  const pull = useCallback(() => loadAppThreads(vaultPath, app.id).then(setThreads), [vaultPath, app.id]);
  useEffect(() => {
    void pull();
    window.addEventListener("prevail:threads-changed", pull);
    return () => window.removeEventListener("prevail:threads-changed", pull);
  }, [pull]);
  // Opened from a reply's "Used Gmail" chip while this page is already up.
  useEffect(() => {
    const on = (e: Event) => {
      const f = (e as CustomEvent<AppFocus>).detail;
      if (f?.id !== app.id) return;
      try { sessionStorage.removeItem("prevail.apps.focus"); } catch { /* storage off */ }
      setTab(f.tab);
      setThreadFilter(f.thread);
    };
    window.addEventListener("prevail:app-focus", on);
    return () => window.removeEventListener("prevail:app-focus", on);
  }, [app.id]);

  const openChat = (thread?: string | null) => {
    setChatReq((p) => (thread === undefined && p ? p : { thread, n: (p?.n ?? 0) + 1 }));
    setTab("chat");
  };
  const TABS: { id: AppTab; label: string }[] = [
    { id: "chat", label: "Chat" }, { id: "activity", label: "Activity" },
    ...(tools ? [{ id: "tools" as const, label: "Tools" }] : []),
    { id: "connection", label: "Connection" },
  ];
  const pickerRow = (
    <div className="flex shrink-0 items-center gap-1 pb-1">
      {account && accounts.length > 1 && (
        <select aria-label="Google account" data-testid="app-account-picker" value={account}
          onChange={(e) => pickAccount(e.target.value)}
          className="h-8 max-w-[12rem] truncate rounded-lg border border-border bg-background px-2 text-[13px] text-text-secondary focus:border-accent-border focus:outline-none">
          <option value="all">All accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label || a.id}</option>)}
        </select>
      )}
      {threads && threads.length > 0 && (
        <select aria-label="Past conversations" data-testid="app-thread-picker" value={chatSlug ?? ""}
          onChange={(e) => openChat(e.target.value || null)}
          className="h-8 max-w-[12rem] truncate rounded-lg border border-border bg-background px-2 text-[13px] text-text-secondary focus:border-accent-border focus:outline-none">
          {!chatSlug && <option value="">New conversation</option>}
          {chatSlug && !threads.some((t) => t.slug === chatSlug) && <option value={chatSlug}>This conversation</option>}
          {threads.map((t) => <option key={t.slug} value={t.slug}>{t.title || "Untitled"}</option>)}
        </select>
      )}
      <button onClick={() => openChat(null)} title="New conversation" aria-label="New conversation" data-testid="app-chat-new"
        className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent">
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
  const pane = (t: AppTab) => `${tab === t ? "" : "hidden"} ${phone ? "" : "min-h-0 flex-1 overflow-y-auto"}`;

  return (
    <div data-testid="app-scope" className={`flex min-h-0 flex-col px-4 pt-4 sm:px-6 ${phone ? "" : "h-full"}`}>
      <div className="shrink-0">
        <div className="flex items-center gap-3" data-testid="app-header">
          <AppLogo name={app.name} url={app.url} size={32} />
          <div className="min-w-0 flex-1">
            <DetailTitle className="truncate">{app.name}</DetailTitle>
            <p className={`${META} truncate`}>{subtitle}</p>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
        {notice && <div className="mt-3">{notice}</div>}
        <div className="mt-3 flex items-center gap-2 border-b border-border-subtle">
          <div role="tablist" aria-label={app.name} className="-mb-px flex min-w-0 flex-1 overflow-x-auto">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} data-testid={`app-tab-${t.id}`}
                onClick={() => (t.id === "chat" ? openChat() : setTab(t.id))}
                className={`h-10 shrink-0 border-b-2 ${phone ? "px-2 text-[13px]" : "px-3 text-[14px]"} font-medium transition-colors ${tab === t.id ? "border-accent text-text-primary" : "border-transparent text-text-muted hover:text-text-secondary"}`}>
                {t.label}
              </button>
            ))}
          </div>
          {tab === "chat" && !phone && pickerRow}
        </div>
        {tab === "chat" && phone && <div className="mt-2 flex justify-end">{pickerRow}</div>}
      </div>

      {chatReq && (
        <div className={`${tab === "chat" ? "flex" : "hidden"} min-h-0 flex-col ${phone ? "h-[calc(100dvh-18rem)]" : "flex-1"}`}>
          <Suspense fallback={<ChatSkeleton />}>
            <AppChat vaultPath={vaultPath} app={app} threads={threads} request={chatReq} onCurrent={setChatSlug} onThreadsChanged={() => { void pull(); }} googleAccount={account} />
          </Suspense>
        </div>
      )}

      <div className={pane("activity")}>
        {tab === "activity" && (
          <div className="pb-8 pt-3">
            {activityNote && <p data-testid="activity-note" className="mb-2 text-[13px] text-text-muted">{activityNote}</p>}
            <AppActivity vaultPath={vaultPath} filter={{ app: app.id, thread: threadFilter }} accounts={accounts.map((a) => a.id)} onClearThread={() => setThreadFilter(undefined)}
              threadTitle={(slug) => threads?.find((t) => t.slug === slug)?.title} onOpenThread={(slug) => openChat(slug)}
              empty={activityRecorded(app.runtime)
                ? `Nothing yet. Each time a conversation reads from or writes to ${app.name}, it shows here.`
                : "Activity is recorded for apps used through Claude."} />
          </div>
        )}
      </div>
      {tools && <div className={pane("tools")}><div className="pb-8 pt-3">{tools}</div></div>}
      <div className={pane("connection")}><div className="pb-8 pt-3">{connection}</div></div>
    </div>
  );
}
