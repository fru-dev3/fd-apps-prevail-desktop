// Decision Inbox: one cross-domain list of the things that need YOUR call:
// connector acts the gate held, queued Google writes, loop approvals queued in
// any domain, and AI tasks that are blocked or want sign-off. The labor is the
// AI's; the decision is yours. The Inbox page (inboxpage.tsx) shows it one
// category at a time. Every approval mints a single-use token first.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Clock, Loader2, Play, ShieldAlert, X } from "lucide-react";
import { RowMenu, type RowMenuItem } from "./ui";
import { BODY, META, SECTION_TITLE } from "./typescale";
import { invoke } from "./bridge";
import { invokeCached, peekInvoke } from "./query";

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
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

/** A long request reads as a short headline (its first clause) and the rest as body text. */
export function splitHeadline(t: string): { head: string; rest: string } {
  const text = t.trim();
  if (text.length <= 90) return { head: text, rest: "" };
  const m = /^(.{12,90}?)([:.?!])\s+(.+)$/s.exec(text);
  if (m) return { head: m[2] === ":" ? m[1] : m[1] + m[2], rest: m[3] };
  const cut = text.lastIndexOf(" ", 80);
  return { head: text.slice(0, cut > 40 ? cut : 80) + "...", rest: text };
}

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
  // Seeded from the shared cache so a revisit paints the last answer at once;
  // reload() always fetches fresh behind it.
  const [items, setItems] = useState<DecisionItem[]>(() => arr(peekInvoke("decisions_pending", { vault: vaultPath })));
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<{ text: string; report: string } | null>(null);
  const [snoozed, setSnoozed] = useState<Record<string, number>>(() => readSnoozed());
  // Queued Google Workspace writes awaiting approval, plus ids dismissed locally
  // (v1 has no CLI drop command, so a dismiss just hides the card; the item stays
  // in pending_gws.json until run).
  const [gws, setGws] = useState<GwsPending[]>(() => arr(peekInvoke("engine_gws_pending_list", { vault: vaultPath })));
  const [acts, setActs] = useState<PendingAct[]>(() => arr(peekInvoke("engine_acts_pending", { vault: vaultPath })));
  const [gwsDismissed, setGwsDismissed] = useState<Record<string, boolean>>({});

  const reload = useCallback(() => {
    invokeCached<DecisionItem[]>("decisions_pending", { vault: vaultPath }, { force: true })
      .then((d) => setItems(Array.isArray(d) ? d : []))
      .catch((e) => console.error("decisions_pending", e));
    invokeCached<GwsPending[]>("engine_gws_pending_list", { vault: vaultPath }, { force: true })
      .then((d) => setGws(Array.isArray(d) ? d : []))
      .catch((e) => console.error("engine_gws_pending_list", e));
    invokeCached<PendingAct[]>("engine_acts_pending", { vault: vaultPath }, { force: true })
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
  const { active } = useMemo(() => {
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

  // One unboxed detail for every kind: a title, one meta line, what it will
  // do in words, the raw call folded away, one primary action and the rest
  // as quiet links or the menu.
  const detail = (o: {
    id: string; title: string; meta: string[]; says?: string; raw?: string; warn?: string; working: boolean;
    primary: { label: string; onClick: () => void; warn?: boolean }; links?: { label: string; onClick: () => void; title?: string; danger?: boolean }[]; menu?: RowMenuItem[];
  }) => {
    const { head, rest } = splitHeadline(o.title);
    return (
    <section key={o.id} className="max-w-3xl">
      <h2 className="break-words text-[17px] font-semibold leading-snug text-text-primary" title={o.title}>{head}</h2>
      <p className={`${META} mt-1`}>{o.meta.filter(Boolean).join(" · ")}</p>
      {rest && <p className={`${BODY} mt-3 break-words text-text-secondary`}>{rest}</p>}
      {o.says && <p className={`${BODY} mt-3 break-words text-text-secondary`}>{o.says}</p>}
      {o.warn && <p className={`${BODY} mt-3 flex items-start gap-2 text-warn`}><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><span className="text-text-secondary">{o.warn}</span></p>}
      {o.raw && (
        <details className="group mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12px] text-text-muted hover:text-text-primary [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />Exact request
          </summary>
          <pre className="mt-1.5 whitespace-pre-wrap break-all font-mono text-[12px] text-text-muted">{o.raw}</pre>
        </details>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        {o.working ? <span className={`${META} inline-flex items-center gap-1.5`}><Loader2 className="h-3.5 w-3.5 animate-spin" /> Working</span> : (
          <>
            <button onClick={o.primary.onClick} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium ${o.primary.warn ? "border border-warn/60 text-text-primary hover:bg-warn/10" : "bg-accent text-on-accent hover:bg-accent-hover"}`}>
              <Play className="h-3.5 w-3.5" /> {o.primary.label}
            </button>
            {(o.links ?? []).map((l) => (
              <button key={l.label} onClick={l.onClick} title={l.title} className={`text-[13px] ${l.danger ? "text-text-muted hover:text-err" : "text-text-secondary hover:text-accent"}`}>{l.label}</button>
            ))}
            {o.menu && o.menu.length > 0 && <RowMenu items={o.menu} />}
          </>
        )}
      </div>
    </section>
    );
  };

  const actCard = (a: PendingAct) => {
    const sensitive = (a.categories?.length ?? 0) > 0;
    return detail({
      id: a.id, title: a.summary, working: busy === a.id,
      meta: [titleCase(a.domain || "general"), "Connector action", a.ts ? `queued ${relTime(a.ts)}` : ""],
      says: argsInWords(a.argsJson), raw: [a.tool, a.argsJson?.slice(0, 2000)].filter(Boolean).join("\n"),
      warn: sensitive ? `Carries ${a.categories!.join("; ")}. Nothing has been sent. Release it only if you are sure.` : undefined,
      primary: { label: sensitive ? "Approve including sensitive info" : "Approve", warn: sensitive, onClick: () => void actApprove(a, sensitive) },
      links: [
        ...(a.alwaysEligible === true && !sensitive ? [{ label: "Always allow", title: "Approve, and always allow this tool in this domain", onClick: () => void actApprove(a, false, true) }] : []),
        { label: "Deny", title: "Decline and tell the agent not to retry", danger: true, onClick: () => void actDeny(a) },
      ],
      menu: [{ icon: X, label: "Dismiss", hint: "Clear it without an answer", onClick: () => void actDismiss(a) }],
    });
  };

  const gwsCard = (g: GwsPending) => {
    const held = gwsHeld[g.id];
    return detail({
      id: g.id, title: g.summary, working: busy === g.id,
      meta: [titleCase(g.domain || "google"), "Google", g.ts ? `queued ${relTime(g.ts)}` : ""],
      says: gwsInWords(g.args), raw: Array.isArray(g.args) ? g.args.join(" ") : undefined,
      warn: held ? `Held by your sensitive-information guardrail: it contains ${held.join("; ") || "sensitive information"}. Nothing was sent. Release it only if you are sure.` : undefined,
      primary: held ? { label: "Approve including sensitive info", warn: true, onClick: () => void gwsApprove(g, true) } : { label: "Approve & run", onClick: () => void gwsApprove(g) },
      links: [{ label: "Dismiss", danger: true, onClick: () => gwsDismiss(g) }],
    });
  };

  const card = (it: DecisionItem) => {
    const isReview = it.kind === "review";
    const asleep = (snoozed[it.id] ?? 0) > now;
    return detail({
      id: it.id, title: it.text, working: busy === it.id,
      meta: [titleCase(it.domain), isReview ? "Ready for review" : "Wants your approval", it.ts ? `queued ${relTime(it.ts)}` : "", asleep ? "snoozed" : ""],
      says: it.why ?? undefined,
      primary: isReview ? { label: "Accept", onClick: () => void reviewSet(it, "done") } : { label: "Approve & run", onClick: () => void approveRun(it) },
      links: isReview ? [{ label: "Run again", onClick: () => void reviewSet(it, "doing") }] : [{ label: it.source === "task" ? "Hand to me" : "Make a task", onClick: () => void makeTask(it) }],
      menu: isReview ? undefined : [
        asleep ? { icon: Clock, label: "Unsnooze", onClick: () => unsnooze(it) } : { icon: Clock, label: "Snooze a day", onClick: () => snooze(it) },
        ...(it.source === "loop" ? [{ icon: X, label: "Dismiss", danger: true, onClick: () => void dismiss(it) }] : []),
      ],
    });
  };

  const empty = (want("actions") ? acts.length : 0) + (want("google") ? gwsVisible.length : 0) + active.filter(showItem).length === 0;
  const g = gwsVisible.find((x) => x.id === selected);
  const a = acts.find((x) => x.id === selected);
  const it = items.find((x) => x.id === selected);
  return (
    <div className="w-full" data-testid="decision-inbox">
      {g ? gwsCard(g) : a ? actCard(a) : it ? card(it) : <p data-testid="inbox-empty" className={`${BODY} py-2 text-text-muted`}>{empty ? "Nothing is waiting on you." : "Pick an item on the left."}</p>}
      {report && (
        <div className="mt-6 max-w-3xl border-t border-border-subtle pt-4">
          <h3 className={SECTION_TITLE}>Result</h3>
          <p className={`${META} mt-0.5 truncate`} title={report.text}>{report.text}</p>
          <div className={`${BODY} mt-2 whitespace-pre-wrap text-text-secondary`}>{report.report}</div>
        </div>
      )}
    </div>
  );
}

/** A queued Google call in words: "Gmail send, to x@y.com". */
export function gwsInWords(args?: string[]): string | undefined {
  if (!Array.isArray(args) || !args.length) return undefined;
  const [svc = "", ...rest] = args;
  const verbs: string[] = []; const flags: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const x = rest[i]!;
    if (x.startsWith("--")) { const v = rest[i + 1] && !rest[i + 1]!.startsWith("--") ? rest[++i]! : ""; flags.push(`${x.slice(2).replace(/[-_]/g, " ")}${v ? ` ${v.length > 80 ? `${v.slice(0, 80)}...` : v}` : ""}`); }
    else verbs.push(x.replace(/^\+/, "").replace(/[-_]/g, " "));
  }
  return `${titleCase(svc)} ${verbs.join(" ")}${flags.length ? `, ${flags.join(", ")}` : ""}`.trim();
}

/** A connector call's arguments in words: "recipient email: client@corp.com". */
export function argsInWords(json?: string): string | undefined {
  if (!json) return undefined;
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    const parts = Object.entries(o).filter(([, v]) => v !== null && v !== "" && typeof v !== "object").slice(0, 4)
      .map(([k, v]) => { const t = String(v); return `${k.replace(/[_-]/g, " ")}: ${t.length > 80 ? `${t.slice(0, 80)}...` : t}`; });
    return parts.length ? parts.join(", ") : undefined;
  } catch { return undefined; }
}
