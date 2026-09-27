// Inbox: everything waiting on your answer, laid out like Intent > Projects:
// the page header with tabs (All, Actions, Google, Automations, Tasks; empty
// ones hidden except All), a column listing that tab's items, and the picked
// item's full card in the detail pane. The approval logic (Allow / Always /
// Deny, the sensitive release, the single-use token spine) is DecisionInbox's;
// this page only frames it. On a phone: tabs, then the list, then the item.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Inbox, Mail, Play, Repeat, ShieldAlert, type LucideIcon } from "lucide-react";
import { DecisionInbox, type InboxCategory, type InboxRow } from "./decisioninbox";
import { relTime, titleCase } from "./format";
import { SettingsHeader } from "./sectionutil";
import { SideSpine, SpineTabs } from "./sidespine";
import { useIsPhone } from "./useisphone";
import { useWaiting, type WaitingKind } from "./waiting";

const TABS: { key: InboxCategory; label: string }[] = [
  { key: "all", label: "All" },
  { key: "actions", label: "Actions" },
  { key: "google", label: "Google" },
  { key: "automations", label: "Automations" },
  { key: "tasks", label: "Tasks" },
];
const ICON: Record<InboxRow["category"], LucideIcon> = { actions: Play, google: Mail, automations: Repeat, tasks: Bot };
const KIND_CATEGORY: Record<WaitingKind, InboxRow["category"]> = { act: "actions", gws: "google", loop: "automations", task: "tasks" };
const CAT_KEY = "prevail.inbox.category";

export function InboxPage({ vaultPath }: { vaultPath: string }) {
  const phone = useIsPhone();
  const [tab, setTab] = useState<InboxCategory>(() => {
    try { const v = localStorage.getItem(CAT_KEY); return (TABS.some((c) => c.key === v) ? v : "all") as InboxCategory; } catch { return "all"; }
  });
  const [rows, setRows] = useState<InboxRow[] | null>(null);
  const onRows = useCallback((r: InboxRow[]) => setRows(r), []);
  const [sel, setSel] = useState<string | null>(null);
  const [picked, setPicked] = useState(false);

  // Counts from the list once it has loaded, and from the shared waiting
  // store before that.
  const waiting = useWaiting(vaultPath);
  const counts = useMemo(() => {
    const c: Record<InboxCategory, number> = { all: 0, actions: 0, google: 0, automations: 0, tasks: 0 };
    if (rows) for (const r of rows) { c[r.category]++; c.all++; }
    else for (const it of waiting.items) { c[KIND_CATEGORY[it.kind] ?? "actions"]++; c.all++; }
    return c;
  }, [rows, waiting]);
  const tabs = TABS.filter((t) => t.key === "all" || t.key === tab || counts[t.key] > 0).map((t) => ({ id: t.key, label: t.label, count: counts[t.key] }));
  const shown = (rows ?? []).filter((r) => tab === "all" || r.category === tab);
  const pickTab = (k: InboxCategory) => {
    setTab(k); setSel(null); setPicked(false);
    try { localStorage.setItem(CAT_KEY, k); } catch { /* storage off */ }
  };
  // On a wide screen the detail is never empty: it opens on the first item,
  // and moves on when the picked one is answered.
  useEffect(() => {
    if (sel && shown.some((r) => r.id === sel)) return;
    if (!phone) setSel(shown[0]?.id ?? null);
  }, [shown.map((r) => r.id).join("|"), phone]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = (
    <nav className="space-y-0.5 p-2" aria-label="Waiting items" data-testid="inbox-items">
      {rows === null && <p className="px-2.5 py-2 text-[13px] text-text-muted">Reading what is waiting</p>}
      {rows !== null && shown.length === 0 && <p className="px-2.5 py-2 text-[13px] text-text-muted">Nothing is waiting on you.</p>}
      {shown.map((r) => {
        const on = sel === r.id && (!phone || picked);
        const Icon = ICON[r.category];
        return (
          <button key={r.id} data-testid="inbox-row" data-category={r.category} aria-current={on ? "true" : undefined}
            onClick={() => { setSel(r.id); setPicked(true); }}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/50"} ${r.snoozed ? "opacity-60" : ""}`}>
            <Icon className={`h-4 w-4 shrink-0 ${on ? "text-accent" : "text-text-muted"}`} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[14px] ${on ? "font-semibold text-text-primary" : "text-text-primary"}`}>{r.title}</span>
              <span className="block truncate text-[12px] text-text-muted">{titleCase(r.domain || "general")}{r.ts ? ` · ${relTime(r.ts)}` : ""}{r.snoozed ? " · snoozed" : ""}</span>
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
        right={<SpineTabs label="Inbox categories" value={tab} onChange={pickTab} tabs={tabs} />} />
      <SideSpine storageKey="prevail.inbox.spine" title={TABS.find((t) => t.key === tab)?.label ?? "All"} label="items" testId="inbox-spine"
        phone={phone} phoneDetail={phone && picked} onBack={() => setPicked(false)} backLabel="All items"
        detail={
          <div className={phone ? "px-4 py-4" : "w-full px-8 py-6"}>
            <DecisionInbox vaultPath={vaultPath} category={tab} selected={sel} onRows={onRows} />
          </div>
        }>
        {list}
      </SideSpine>
      {/* On a phone's list the detail is not mounted, so this keeps the column fed. */}
      {phone && !picked && <div hidden><DecisionInbox vaultPath={vaultPath} category={tab} selected={null} onRows={onRows} /></div>}
    </div>
  );
}
