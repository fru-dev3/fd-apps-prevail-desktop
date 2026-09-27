// Decision Inbox: one cross-domain list of the things that need YOUR call:
// connector acts the gate held, queued Google writes, loop approvals queued in
// any domain, and AI tasks that are blocked or want sign-off. The labor is the
// AI's; the decision is yours. The Inbox page (inboxpage.tsx) shows it one
// category at a time. Every approval mints a single-use token first.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Bot, Check, Loader2, ListPlus, Play, RotateCcw, ShieldCheck, Clock, X } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase, relTime } from "./format";
import { PREF, cheapModel, getPref } from "./storage";
import { startProcess, endProcess } from "./processes";
import type { DecisionItem } from "./types";
import { approveAct, denyAct } from "./actcard";
import { ACTS_CHANGED, announceActsChanged, useWaitingState, type PendingAct } from "./waiting";

const SNOOZE_KEY = "prevail:decisions:snoozed";
const DAY_MS = 24 * 60 * 60 * 1000;

// A queued Google Workspace WRITE action, awaiting your approval. Reads run
// automatically inside chat; anything that writes (send an email, change or
// delete something) is queued by the CLI to <vault>/_meta/pending_gws.json and
// surfaced here under Google. Shape matches the CLI contract.
type GwsPending = { id: string; domain: string; summary: string; args?: string[]; ts?: number };
// Action Gateway queue (PendingAct, from ./waiting): connector writes a
// PreToolUse hook held. Approval mints a single-use grant; the CHAT retries
// the tool to actually run it.

function readSnoozed(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || "{}"); } catch { return {}; }
}
function writeSnoozed(m: Record<string, number>) {
  try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

// The Inbox page's categories. Actions: held connector acts. Google: queued
// Google Workspace writes. Automations: loop actions awaiting approval.
// Tasks: tasks waiting on you (blocked, or finished and wanting sign-off).
export type InboxCategory = "all" | "actions" | "google" | "automations" | "tasks";
export type InboxCounts = Record<InboxCategory, number>;

// One row of the Inbox column.
export type InboxRow = { id: string; category: Exclude<InboxCategory, "all">; title: string; domain: string; ts?: number; sensitive?: boolean; snoozed?: boolean };

// `selected` (the Inbox page): render only that item's card, full size, with
// its actions. `onRows` hands the page the list for its column.
export function DecisionInbox({ vaultPath, category = "all", onCounts, selected, onRows }: {
  vaultPath: string;
  category?: InboxCategory;
  onCounts?: (c: InboxCounts) => void;
  selected?: string | null;
  onRows?: (rows: InboxRow[]) => void;
}) {
  const [items, setItems] = useState<DecisionItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<{ text: string; report: string } | null>(null);
  const [snoozed, setSnoozed] = useState<Record<string, number>>(() => readSnoozed());
  const [showSnoozed, setShowSnoozed] = useState(false);
  // Queued Google Workspace writes awaiting approval, plus ids dismissed locally
  // (v1 has no CLI drop command, so a dismiss just hides the card; the item stays
  // in pending_gws.json until run).
  const [gws, setGws] = useState<GwsPending[]>([]);
  const [acts, setActs] = useState<PendingAct[]>([]);
  const [gwsDismissed, setGwsDismissed] = useState<Record<string, boolean>>({});

  const reload = useCallback(() => {
    invoke<DecisionItem[]>("decisions_pending", { vault: vaultPath })
      .then((d) => setItems(Array.isArray(d) ? d : []))
      .catch((e) => console.error("decisions_pending", e));
    invoke<GwsPending[]>("engine_gws_pending_list", { vault: vaultPath })
      .then((d) => setGws(Array.isArray(d) ? d : []))
      .catch((e) => console.error("engine_gws_pending_list", e));
    invoke<PendingAct[]>("engine_acts_pending", { vault: vaultPath })
      .then((a) => setActs(Array.isArray(a) ? a : []))
      .catch((e) => console.error("engine_acts_pending", e));
  }, [vaultPath]);
  // Refresh with the shared waiting store (it polls, and answers every
  // approve / deny / dismiss at once), so this list and every count agree.
  const waitingVersion = useWaitingState(vaultPath).version;
  useEffect(() => { reload(); }, [reload, waitingVersion]);
  useEffect(() => {
    const f = () => reload();
    window.addEventListener("prevail:tasks-changed", f);
    window.addEventListener("prevail:loops-advanced", f);
    // An answer given on an in-chat approval card clears it here too.
    window.addEventListener(ACTS_CHANGED, f);
    return () => {
      window.removeEventListener("prevail:tasks-changed", f);
      window.removeEventListener("prevail:loops-advanced", f);
      window.removeEventListener(ACTS_CHANGED, f);
    };
  }, [reload]);

  const now = Date.now();
  const { active, sleeping } = useMemo(() => {
    const a: DecisionItem[] = []; const s: DecisionItem[] = [];
    for (const it of items) ((snoozed[it.id] ?? 0) > now ? s : a).push(it);
    return { active: a, sleeping: s };
  }, [items, snoozed, now]);

  const want = (c: InboxCategory) => category === "all" || category === c;
  const isTask = (it: DecisionItem) => it.source === "task";
  const showItem = (it: DecisionItem) => want(isTask(it) ? "tasks" : "automations");
  useEffect(() => {
    if (!onCounts) return;
    const tasks = items.filter(isTask).length;
    const automations = items.length - tasks;
    const google = gws.filter((g) => !gwsDismissed[g.id]).length;
    onCounts({ all: acts.length + google + items.length, actions: acts.length, google, automations, tasks });
  }, [items, gws, gwsDismissed, acts, onCounts]);
  useEffect(() => {
    if (!onRows) return;
    const nowTs = Date.now();
    onRows([
      ...gws.filter((g) => !gwsDismissed[g.id]).map((g) => ({ id: g.id, category: "google" as const, title: g.summary, domain: g.domain, ts: g.ts })),
      ...acts.map((a) => ({ id: a.id, category: "actions" as const, title: a.summary, domain: a.domain, ts: a.ts, sensitive: (a.categories?.length ?? 0) > 0 })),
      ...items.map((it) => ({ id: it.id, category: (it.source === "task" ? "tasks" : "automations") as InboxRow["category"], title: it.text, domain: it.domain, ts: it.ts, snoozed: (readSnoozed()[it.id] ?? 0) > nowTs })),
    ]);
  }, [items, gws, gwsDismissed, acts, onRows]);

  const after = () => { reload(); window.dispatchEvent(new Event("prevail:tasks-changed")); };

  const dropLoop = (it: DecisionItem) =>
    invoke("loop_pending_drop", { vault: vaultPath, domain: it.domain, loopId: it.loopId, text: it.text });

  const approveRun = async (it: DecisionItem) => {
    setBusy(it.id); setReport(null);
    // Show it as a running process so executing an approval is visible system-wide.
    const procId = `exec-${it.id}-${Date.now()}`;
    const short = it.text.length > 48 ? `${it.text.slice(0, 48)}…` : it.text;
    startProcess(procId, "loop", `${titleCase(it.domain || "general")} · Executing: ${short}`, it.domain);
    try {
      const provider = getPref(PREF.memoryProvider, "claude");
      const model = cheapModel();
      // Mint a single-use approval token bound to this exact action (C1/O16),
      // then execute with it — the backend verifies approval, not UI trust.
      const approval = await invoke<string>("loop_request_approval", { domain: it.domain, action: it.text });
      const rep = await invoke<string>("loop_execute_action", { vault: vaultPath, domain: it.domain, action: it.text, approval, provider, model });
      try {
        await invoke("decision_append", { vault: vaultPath, domain: it.domain, record: { kind: "decision", source: "inbox-exec", action: it.text, report: rep, ts: Date.now() } });
      } catch { /* best effort */ }
      // Clear the source: a loop approval drops from the queue; an AI task that was
      // blocked moves to review now that it's been run.
      if (it.source === "task" && it.taskId) {
        await invoke("tasks_set_status", { vault: vaultPath, domain: it.domain, id: it.taskId, status: "review" });
      } else {
        await dropLoop(it);
      }
      setReport({ text: it.text, report: rep.trim() || "(no report)" });
      after();
    } catch (e) {
      setReport({ text: it.text, report: `Execution failed: ${e}` });
    } finally { setBusy(null); endProcess(procId); }
  };

  // Loop approval → file it as your own task (then clear the approval). Blocked AI
  // task → hand it back to you: owner me, todo (the steward won't re-pick it).
  const makeTask = async (it: DecisionItem) => {
    setBusy(it.id);
    try {
      if (it.source === "task" && it.taskId) {
        await invoke("tasks_set_owner", { vault: vaultPath, domain: it.domain, id: it.taskId, owner: "me" });
        await invoke("tasks_set_status", { vault: vaultPath, domain: it.domain, id: it.taskId, status: "todo" });
      } else {
        await invoke("tasks_add", { vault: vaultPath, domain: it.domain, text: it.text, source: "loop" });
        await dropLoop(it);
      }
      after();
    } catch (e) { console.error("make task", e); } finally { setBusy(null); }
  };

  const dismiss = async (it: DecisionItem) => {
    setBusy(it.id);
    try { await dropLoop(it); after(); }
    catch (e) { console.error("dismiss", e); } finally { setBusy(null); }
  };

  const snooze = (it: DecisionItem) => {
    const next = { ...snoozed, [it.id]: Date.now() + DAY_MS };
    setSnoozed(next); writeSnoozed(next);
  };
  const unsnooze = (it: DecisionItem) => {
    const next = { ...snoozed }; delete next[it.id];
    setSnoozed(next); writeSnoozed(next);
  };

  // Review-task actions (AI finished; accept the result or send it back).
  const reviewSet = async (it: DecisionItem, status: string) => {
    if (!it.taskId) return;
    setBusy(it.id);
    try {
      await invoke("tasks_set_status", { vault: vaultPath, domain: it.domain, id: it.taskId, status });
      after();
    } catch (e) { console.error("review set", e); } finally { setBusy(null); }
  };

  // Cards the sensitive-egress guard held on execution: id -> honest category
  // labels. The card stays and grows a second, explicit release button.
  const [gwsHeld, setGwsHeld] = useState<Record<string, string[]>>({});

  // The visible gws queue (locally dismissed ones hidden).
  const gwsVisible = useMemo(() => gws.filter((g) => !gwsDismissed[g.id]), [gws, gwsDismissed]);

  // Approve & run ONE queued Google Workspace write. Mints a single-use token
  // bound to this exact (domain, summary), then hands it to the backend, which
  // re-verifies it before running the exact stored command. Same token spine as
  // loop approvals, so a UI bug can't drive a gws write without real approval.
  const gwsApprove = async (g: GwsPending, allowSensitive = false) => {
    setBusy(g.id); setReport(null);
    const procId = `gws-${g.id}-${Date.now()}`;
    const short = g.summary.length > 48 ? `${g.summary.slice(0, 48)}…` : g.summary;
    startProcess(procId, "loop", `${titleCase(g.domain || "google")} · Running: ${short}`, g.domain);
    try {
      const approval = await invoke<string>("loop_request_approval", { domain: g.domain, action: g.summary });
      const res = await invoke<{ ok?: boolean; output?: string; error?: string; held?: { categories?: string[] } }>(
        "engine_gws_approve",
        { vault: vaultPath, id: g.id, domain: g.domain, summary: g.summary, approval, allowSensitive },
      );
      const text = (res?.error || res?.output || (res?.ok ? "Done." : "(no output)")).trim();
      setReport({ text: g.summary, report: text });
      if (res?.held) {
        // The sensitive-egress guard held it: the pending record was KEPT
        // engine-side. Keep the card too and surface the explicit release.
        setGwsHeld((m) => ({ ...m, [g.id]: res.held?.categories ?? [] }));
      } else {
        // Remove the card: it has run (or errored). Drop it from the queue locally.
        setGws((prev) => prev.filter((x) => x.id !== g.id));
      }
    } catch (e) {
      setReport({ text: g.summary, report: `Execution failed: ${e}` });
    } finally { setBusy(null); endProcess(procId); }
  };

  // Dismiss: v1 has no CLI drop, so just hide it locally (the item stays in
  // pending_gws.json until it is actually run).
  const gwsDismiss = (g: GwsPending) => setGwsDismissed((m) => ({ ...m, [g.id]: true }));

  // Connector acts (Action Gateway): approving mints a single-use grant; the
  // action then runs when the CHAT calls the tool again. Sensitive categories
  // require the explicit release, same two-tap pattern as held gws writes.
  const actApprove = async (a: PendingAct, allowSensitive = false, always = false) => {
    setBusy(a.id); setReport(null);
    try {
      // Same single-use token spine as the in-chat card (approveAct).
      const res = await approveAct(vaultPath, a, { allowSensitive, always });
      if (res?.ok) {
        setReport({ text: a.summary, report: `Approved${always ? ", and always allowed from now on" : ""}. Go back to the chat and tell it to retry. The approval is good for one run within 10 minutes.` });
        setActs((prev) => prev.filter((x) => x.id !== a.id));
      } else {
        setReport({ text: a.summary, report: res?.error || "approval failed" });
      }
    } catch (e) {
      setReport({ text: a.summary, report: `Approval failed: ${e}` });
    } finally { setBusy(null); }
  };
  const actDismiss = async (a: PendingAct) => {
    try { await invoke("engine_acts_dismiss", { vault: vaultPath, id: a.id }); } catch (e) { console.error("acts dismiss", e); }
    setActs((prev) => prev.filter((x) => x.id !== a.id));
    announceActsChanged();
  };
  // Deny tells the agent the user said no (dismiss only clears the card).
  const actDeny = async (a: PendingAct) => {
    setBusy(a.id);
    try {
      await denyAct(vaultPath, a.id);
      setReport({ text: a.summary, report: "Declined. It was not run, and the agent was told not to retry." });
      setActs((prev) => prev.filter((x) => x.id !== a.id));
    } catch (e) { console.error("acts deny", e); } finally { setBusy(null); }
  };

  const actCard = (a: PendingAct) => {
    const running = busy === a.id;
    const sensitive = (a.categories?.length ?? 0) > 0;
    return (
      <div key={a.id} className="rounded-xl border border-border bg-surface px-3.5 py-3">
        <div className="mb-1 flex items-center gap-2 text-[11px] text-text-muted">
          <span className="text-warn"><Play className="h-3 w-3" /></span>
          {titleCase(a.domain || "general")}
          <span className="text-text-muted/50">· connector</span>
          {a.ts ? <span className="text-text-muted/50">· queued {relTime(a.ts)}</span> : null}
        </div>
        <div className="text-[13px] leading-snug text-text-primary">{a.summary}</div>
        {a.argsJson && <div className="mt-0.5 break-all text-[11px] text-text-muted">{a.argsJson.slice(0, 400)}</div>}
        {sensitive && (
          <div className="mt-1.5 rounded-md border border-warn/40 bg-warn/5 px-2 py-1.5 text-[11px] leading-snug text-text-secondary">
            Carries {a.categories!.join("; ")}. Nothing has been sent. Release it only if you are sure.
          </div>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {running && <span className="inline-flex items-center gap-1 text-[11px] text-text-muted"><Loader2 className="h-3 w-3 animate-spin" /> working…</span>}
          {!running && (
            <>
              <button onClick={() => actApprove(a, sensitive)} className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ${sensitive ? "border border-warn/60 bg-warn/10 text-text-primary hover:bg-warn/20" : "bg-accent text-background hover:bg-accent-hover"}`}>
                <Play className="h-3 w-3" /> {sensitive ? "Approve including sensitive info" : "Approve"}
              </button>
              {a.alwaysEligible === true && !sensitive && (
                <button onClick={() => actApprove(a, false, true)} title="Approve, and always allow this tool in this domain" className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:border-accent-border hover:text-accent">
                  <ShieldCheck className="h-3 w-3" /> Always
                </button>
              )}
              <button onClick={() => actDeny(a)} title="Decline and tell the agent not to retry" className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:!text-err">
                <Ban className="h-3 w-3" /> Deny
              </button>
              <button onClick={() => actDismiss(a)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:!text-err">
                <X className="h-3 w-3" /> Dismiss
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const gwsCard = (g: GwsPending) => {
    const running = busy === g.id;
    const cmd = Array.isArray(g.args) ? g.args.join(" ") : "";
    return (
      <div key={g.id} className="rounded-xl border border-border bg-surface px-3.5 py-3">
        <div className="mb-1 flex items-center gap-2 text-[11px] text-text-muted">
          <span className="text-warn"><Play className="h-3 w-3" /></span>
          {titleCase(g.domain || "google")}
          <span className="text-text-muted/50">· google</span>
          {g.ts ? <span className="text-text-muted/50">· queued {relTime(g.ts)}</span> : null}
        </div>
        <div className="text-[13px] leading-snug text-text-primary">{g.summary}</div>
        {cmd && <div className="mt-0.5 break-all font-mono text-[11px] text-text-muted">{cmd}</div>}
        {gwsHeld[g.id] && (
          <div className="mt-1.5 rounded-md border border-warn/40 bg-warn/5 px-2 py-1.5 text-[11px] leading-snug text-text-secondary">
            Held by your sensitive-information guardrail: the outbound content contains {gwsHeld[g.id]!.join("; ") || "sensitive information"}. Nothing was sent. Release it only if you are sure.
          </div>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {running && <span className="inline-flex items-center gap-1 text-[11px] text-text-muted"><Loader2 className="h-3 w-3 animate-spin" /> working…</span>}
          {!running && gwsHeld[g.id] && (
            <>
              <button onClick={() => gwsApprove(g, true)} className="inline-flex items-center gap-1 rounded-md border border-warn/60 bg-warn/10 px-2.5 py-1 text-xs font-semibold text-text-primary hover:bg-warn/20">
                <Play className="h-3 w-3" /> Approve including sensitive info
              </button>
              <button onClick={() => gwsDismiss(g)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:!text-err">
                <X className="h-3 w-3" /> Dismiss
              </button>
            </>
          )}
          {!running && !gwsHeld[g.id] && (
            <>
              <button onClick={() => gwsApprove(g)} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-background hover:bg-accent-hover">
                <Play className="h-3 w-3" /> Approve &amp; run
              </button>
              <button onClick={() => gwsDismiss(g)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:!text-err">
                <X className="h-3 w-3" /> Dismiss
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const card = (it: DecisionItem) => {
    const isReview = it.kind === "review";
    const running = busy === it.id;
    const asleep = (snoozed[it.id] ?? 0) > now;
    return (
      <div key={it.id} className="rounded-xl border border-border bg-surface px-3.5 py-3">
        <div className="mb-1 flex items-center gap-2 text-[11px] text-text-muted">
          <span className={isReview ? "text-accent" : "text-warn"}>{isReview ? <Bot className="h-3 w-3" /> : <Play className="h-3 w-3" />}</span>
          {titleCase(it.domain)}
          <span className="text-text-muted/50">· {isReview ? "review" : "approval"}</span>
          {it.ts ? <span className="text-text-muted/50">· queued {relTime(it.ts)}</span> : null}
        </div>
        <div className="text-[13px] leading-snug text-text-primary">{it.text}</div>
        {it.why && <div className="mt-0.5 text-[11px] text-text-muted">{it.why}</div>}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {running && <span className="inline-flex items-center gap-1 text-[11px] text-text-muted"><Loader2 className="h-3 w-3 animate-spin" /> working…</span>}
          {!running && isReview && (
            <>
              <button onClick={() => reviewSet(it, "done")} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-background hover:bg-accent-hover">
                <Check className="h-3 w-3" /> Accept
              </button>
              <button onClick={() => reviewSet(it, "doing")} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:border-accent-border hover:text-accent">
                <RotateCcw className="h-3 w-3" /> Re-run
              </button>
            </>
          )}
          {!running && !isReview && (
            <>
              <button onClick={() => approveRun(it)} className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-background hover:bg-accent-hover">
                <Play className="h-3 w-3" /> Approve &amp; run
              </button>
              <button onClick={() => makeTask(it)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:border-accent-border hover:text-accent">
                <ListPlus className="h-3 w-3" /> {it.source === "task" ? "Hand to me" : "Make a task"}
              </button>
              {asleep
                ? <button onClick={() => unsnooze(it)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-secondary"><Clock className="h-3 w-3" /> Unsnooze</button>
                : <button onClick={() => snooze(it)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text-secondary"><Clock className="h-3 w-3" /> Snooze</button>}
              {it.source === "loop" && (
                <button onClick={() => dismiss(it)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:!text-err"><X className="h-3 w-3" /> Dismiss</button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const shownActs = want("actions") ? acts : [];
  const shownGws = want("google") ? gwsVisible : [];
  const shownActive = active.filter(showItem);
  const shownSleeping = sleeping.filter(showItem);
  const empty = shownActs.length + shownGws.length + shownActive.length === 0;

  if (selected !== undefined) {
    const g = gwsVisible.find((x) => x.id === selected);
    const a = acts.find((x) => x.id === selected);
    const it = items.find((x) => x.id === selected);
    return (
      <div className="w-full" data-testid="decision-inbox">
        {g ? gwsCard(g) : a ? actCard(a) : it ? card(it) : <p data-testid="inbox-empty" className="py-2 text-[15px] text-text-muted">{empty ? "Nothing is waiting on you." : "Pick an item on the left."}</p>}
        {report && (
          <div className="mt-5 rounded-xl border border-border bg-surface/60 px-3.5 py-3">
            <div className="mb-1 text-[13px] font-medium text-text-secondary">Result: {report.text}</div>
            <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-secondary">{report.report}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full" data-testid="decision-inbox">
      <div className="flex flex-col gap-2.5">
        {empty && <p data-testid="inbox-empty" className="py-6 text-[15px] text-text-muted">Nothing is waiting on you.</p>}
        {shownGws.map(gwsCard)}
        {shownActs.map(actCard)}
        {shownActive.map(card)}
      </div>

      {shownSleeping.length > 0 && (
        <button onClick={() => setShowSnoozed((s) => !s)} className="mt-4 text-[13px] text-text-muted hover:text-text-secondary">
          {showSnoozed ? "Hide" : "Show"} snoozed ({shownSleeping.length})
        </button>
      )}
      {showSnoozed && shownSleeping.length > 0 && (
        <div className="mt-3 flex flex-col gap-2.5 opacity-70">{shownSleeping.map(card)}</div>
      )}

      {report && (
        <div className="mt-5 rounded-xl border border-border bg-surface/60 px-3.5 py-3">
          <div className="mb-1 text-[13px] font-medium text-text-secondary">Result: {report.text}</div>
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-secondary">{report.report}</div>
        </div>
      )}
    </div>
  );
}
