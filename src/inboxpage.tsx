// Inbox: everything waiting on your answer, laid out like Intent > Projects:
// the page header with tabs (All, Actions, Google, Automations, Tasks; empty
// ones hidden except All), a column listing that tab's items, and the picked
// item's full card in the detail pane. The approval logic (Allow / Always /
// Deny, the sensitive release, the single-use token spine) is DecisionInbox's;
// this page only frames it. On a phone: tabs, then the list, then the item.
// Results (Specialists Phase 3): playbook runs the user did not start (a
// loop's clock, a radar event) wait here until marked seen.
// Jobs (owner feedback round 1): the work the chief of staff staffed, Running,
// Waiting on you and Done, each opening as its card (moved here from
// Specialists: jobs are work, not specialists).
import { SpecialistAvatar } from "./specialistavatar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Briefcase, CalendarDays, Clock, Hourglass, CheckCheck, Inbox, Mail, Play, Repeat, ShieldAlert, Sun, Workflow, type LucideIcon } from "lucide-react";
import { Briefing } from "./todaycard";
import { DecisionInbox, type InboxCategory, type InboxRow } from "./decisioninbox";
import { invoke } from "./bridge";
import { invalidateQueries, useInvokeQuery } from "./query";
import { jobGroups, label, openPlaybook, scopeLabel, type InboxResult, type Job } from "./plansmodel";
import { JobRow } from "./specialistspage";
import { BODY, DETAIL_TITLE, META } from "./typescale";
import { relTime } from "./format";
import { SettingsHeader } from "./sectionutil";
import { SideSpine, SpineTabs } from "./sidespine";
import { useIsPhone } from "./useisphone";
import { useWaiting, type WaitingKind } from "./waiting";
import { TintIcon } from "./tint";

type Tab = InboxCategory | "results" | "briefing" | "jobs";
const TABS: { key: Tab; label: string }[] = [
  { key: "briefing", label: "Briefing" },
  { key: "all", label: "All" },
  { key: "actions", label: "Actions" },
  { key: "google", label: "Google" },
  { key: "automations", label: "Automations" },
  { key: "tasks", label: "Tasks" },
  { key: "results", label: "Results" },
  { key: "jobs", label: "Jobs" },
];
type Row = InboxRow | (Omit<InboxRow, "category"> & { category: "results" });
const ICON: Record<Row["category"], LucideIcon> = { actions: Play, google: Mail, automations: Repeat, tasks: Bot, results: Workflow };
const KIND_CATEGORY: Record<WaitingKind, InboxRow["category"]> = { act: "actions", gws: "google", loop: "automations", task: "tasks" };
const CAT_KEY = "prevail.inbox.category";

export function InboxPage({ vaultPath }: { vaultPath: string }) {
  const phone = useIsPhone();
  const [tab, setTab] = useState<Tab>(() => {
    try { const v = localStorage.getItem(CAT_KEY); return (TABS.some((c) => c.key === v) ? v : "all") as Tab; } catch { return "all"; }
  });
  const resQ = useInvokeQuery<InboxResult[]>("engine_playbook_inbox", { vault: vaultPath }, { staleMs: 30_000 });
  const results = useMemo(() => (Array.isArray(resQ.data) ? resQ.data : []), [resQ.data]);
  const resultRows: Row[] = results.map((r) => ({ id: `result:${r.runId}`, category: "results" as const, title: `${r.name}: ${r.ok ? (r.waiting ? `${r.waiting} step${r.waiting === 1 ? "" : "s"} wait for you` : "done") : "did not finish"}`, domain: r.domain ?? "general", ts: r.ts }));
  const jobsQ = useInvokeQuery<Job[]>("engine_jobs", { vault: vaultPath }, { staleMs: 5_000 });
  const jobGroupsNow = useMemo(() => jobGroups(Array.isArray(jobsQ.data) ? jobsQ.data : []), [jobsQ.data]);
  const [jobGroup, setJobGroup] = useState<"running" | "waiting" | "done">("running");
  const [rows, setRows] = useState<InboxRow[] | null>(null);
  const onRows = useCallback((r: InboxRow[]) => setRows(r), []);
  const [sel, setSel] = useState<string | null>(null);
  const [picked, setPicked] = useState(false);

  // Counts from the list once it has loaded, and from the shared waiting
  // store before that.
  const waiting = useWaiting(vaultPath);
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { briefing: 0, all: 0, actions: 0, google: 0, automations: 0, tasks: 0, results: resultRows.length, jobs: jobGroupsNow.running.length + jobGroupsNow.waiting.length };
    if (rows) for (const r of rows) { c[r.category]++; c.all++; }
    else for (const it of waiting.items) { c[KIND_CATEGORY[it.kind] ?? "actions"]++; c.all++; }
    c.all += resultRows.length;
    return c;
  }, [rows, waiting, resultRows.length, jobGroupsNow]); // eslint-disable-line react-hooks/exhaustive-deps
  const tabs = TABS.filter((t) => t.key === "briefing" || t.key === "all" || t.key === "jobs" || t.key === tab || counts[t.key] > 0).map((t) => ({ id: t.key, label: t.label, count: counts[t.key] }));
  const shown: Row[] = [...(rows ?? []), ...(rows ? resultRows : [])].filter((r) => tab === "all" || r.category === tab);
  const pickedResult = sel?.startsWith("result:") ? results.find((r) => `result:${r.runId}` === sel) ?? null : null;
  const pickTab = (k: Tab) => {
    setTab(k); setSel(null); setPicked(false);
    try { localStorage.setItem(CAT_KEY, k); } catch { /* storage off */ }
  };
  // On a wide screen the detail is never empty: it opens on the first item,
  // and moves on when the picked one is answered.
  useEffect(() => {
    if (sel && shown.some((r) => r.id === sel)) return;
    if (!phone) setSel(shown[0]?.id ?? null);
  }, [shown.map((r) => r.id).join("|"), phone]); // eslint-disable-line react-hooks/exhaustive-deps

  const [brief, setBrief] = useState<"today" | "week">("today");
  const briefList = (
    <nav className="space-y-0.5 p-2" aria-label="Briefings" data-testid="inbox-briefings">
      {([["today", "Today", Sun], ["week", "This week", CalendarDays]] as const).map(([k, label, Icon]) => {
        const on = brief === k && (!phone || picked);
        return (
          <button key={k} data-testid={`briefing-${k}`} aria-current={on ? "true" : undefined} onClick={() => { setBrief(k); setPicked(true); }}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
            <TintIcon icon={Icon} tint={k} />
            <span className={`truncate text-[14px] text-text-primary ${on ? "font-semibold" : ""}`}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
  const jobsList = (
    <nav className="space-y-0.5 p-2" aria-label="Jobs" data-testid="inbox-jobs">
      {([["running", "Running", Clock], ["waiting", "Waiting on you", Hourglass], ["done", "Done", Briefcase]] as const).map(([k, text, Icon]) => {
        const on = jobGroup === k && (!phone || picked);
        return (
          <button key={k} data-testid={`inbox-jobs-${k}`} aria-current={on ? "true" : undefined} onClick={() => { setJobGroup(k); setPicked(true); }}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
            <TintIcon icon={Icon} tint={k} />
            <span className={`min-w-0 flex-1 truncate text-[14px] text-text-primary ${on ? "font-semibold" : ""}`}>{text}</span>
            <span className="shrink-0 text-[12px] tabular-nums text-text-muted">{jobGroupsNow[k].length}</span>
          </button>
        );
      })}
    </nav>
  );
  const jobsDetail = (
    <section data-testid="inbox-jobs-detail">
      <h2 className={DETAIL_TITLE}>{jobGroup === "running" ? "Running" : jobGroup === "waiting" ? "Waiting on you" : "Done"}</h2>
      <p className={`${META} mt-1`}>Jobs your chief of staff staffed, and playbook runs.</p>
      {!jobGroupsNow[jobGroup].length && <p className={`${META} mt-4`}>{jobGroup === "running" ? "Nothing is running." : jobGroup === "waiting" ? "Nothing waits on you." : "No finished jobs yet."}</p>}
      <ul className="mt-3 max-w-3xl">{jobGroupsNow[jobGroup].map((j) => <JobRow key={j.id} job={j} vaultPath={vaultPath} />)}</ul>
    </section>
  );
  const list = (
    <nav className="space-y-0.5 p-2" aria-label="Waiting items" data-testid="inbox-items">
      {rows === null && <p className={`${META} px-2.5 py-2`}>Reading what is waiting</p>}
      {rows !== null && shown.length === 0 && <p className={`${META} px-2.5 py-2`}>Nothing is waiting on you.</p>}
      {shown.map((r) => {
        const on = sel === r.id && (!phone || picked);
        const Icon = ICON[r.category];
        return (
          <button key={r.id} data-testid="inbox-row" data-category={r.category} aria-current={on ? "true" : undefined}
            onClick={() => { setSel(r.id); setPicked(true); }}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/50"} ${r.snoozed ? "opacity-60" : ""}`}>
            <TintIcon icon={Icon} tint={r.category} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[14px] ${on ? "font-semibold text-text-primary" : "text-text-primary"}`}>{r.title}</span>
              <span className="block truncate text-[12px] text-text-muted">{scopeLabel(r.domain || "general")}{r.ts ? ` · ${relTime(r.ts)}` : ""}{r.snoozed ? " · snoozed" : ""}</span>
            </span>
            {r.sensitive && <span title="Carries sensitive information"><ShieldAlert className="h-3.5 w-3.5 shrink-0 text-warn" /></span>}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background" data-testid="inbox-page">
      <SettingsHeader title="Inbox" icon={Inbox} subtitle={counts.all === 0 ? "Nothing waiting on you" : `${counts.all} waiting on you`}
        tabs={<SpineTabs label="Inbox categories" value={tab} onChange={pickTab} tabs={tabs} />} />
      <SideSpine storageKey="prevail.inbox.spine" title={TABS.find((t) => t.key === tab)?.label ?? "All"} label="items" testId="inbox-spine"
        phone={phone} phoneDetail={phone && picked} onBack={() => setPicked(false)} backLabel="All items"
        detail={
          <div className={phone ? "px-4 py-4" : "w-full px-8 py-6"}>
            {tab === "jobs" ? jobsDetail
              : tab === "briefing" ? <Briefing which={brief} vaultPath={vaultPath} phone={phone} />
              : pickedResult
              ? <><ResultDetail r={pickedResult} vaultPath={vaultPath} onSeen={() => { setSel(null); void resQ.refresh(); }} /><div hidden><DecisionInbox vaultPath={vaultPath} category="all" selected={null} onRows={onRows} /></div></>
              : <DecisionInbox vaultPath={vaultPath} category={tab === "results" ? "all" : tab} selected={tab === "results" ? null : sel} onRows={onRows} />}
          </div>
        }>
        {tab === "briefing" ? briefList : tab === "jobs" ? jobsList : list}
      </SideSpine>
      {/* On a phone's list the detail is not mounted, so this keeps the column fed. */}
      {phone && !picked && <div hidden><DecisionInbox vaultPath={vaultPath} category={tab === "results" || tab === "briefing" || tab === "jobs" ? "all" : tab} selected={null} onRows={onRows} /></div>}
    </div>
  );
}

/** A scheduled or event playbook run: what started it, each step, and Seen. */
function ResultDetail({ r, vaultPath, onSeen }: { r: InboxResult; vaultPath: string; onSeen: () => void }) {
  const [busy, setBusy] = useState(false);
  const seen = async () => {
    setBusy(true);
    try { await invoke("engine_playbook_seen", { vault: vaultPath, runId: r.runId }); invalidateQueries("engine_playbook_inbox"); onSeen(); } finally { setBusy(false); }
  };
  return (
    <section data-testid="inbox-result" className="max-w-3xl">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className={`${DETAIL_TITLE} break-words`}>{r.name}</h2>
          <p className={`${META} mt-1`}>{r.trigger === "event" && r.event ? `Ran when the radar flagged: ${r.event}` : "Ran on its schedule"}{r.domain ? ` · ${scopeLabel(r.domain)}` : ""} · {new Date(r.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
        </div>
        <button onClick={() => openPlaybook(r.playbook)} title="Open the playbook" aria-label="Open the playbook" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-accent"><Workflow className="h-4 w-4" /></button>
        <button onClick={() => void seen()} disabled={busy} title="Seen" aria-label="Mark as seen" data-testid="inbox-result-seen" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-accent disabled:opacity-40"><CheckCheck className="h-4 w-4" /></button>
      </div>
      {r.note && <p className={`${BODY} mt-3 text-text-secondary`}>{r.note}</p>}
      <ol className="mt-3">
        {r.steps.map((x, i) => (
          <li key={i} className="flex items-start gap-3 border-b border-border-subtle py-2 last:border-b-0">
            <span className={`${META} w-5 shrink-0 pt-px text-right tabular-nums`}>{i + 1}</span>
            {x.specialists?.length ? <span className="flex shrink-0 -space-x-1.5" data-testid="inbox-step-team" title={x.specialists.map(label).join(", ")}>{x.specialists.map((id) => <SpecialistAvatar key={id} id={id} size={22} className="rounded-full ring-2 ring-background" />)}</span> : null}
            <span className="min-w-0 flex-1">
              <span className={`${BODY} block break-words text-text-primary`}>{x.label}</span>
              <span className={`${META} block break-words`}>{x.decision === "ask" ? "Waits for your yes: " : x.ok ? "" : "Did not run: "}{x.note}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
