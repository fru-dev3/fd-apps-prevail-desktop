// Work mode, desktop side: the engine's queue types (mirrored from the
// engine's src/work-router.ts and src/work.ts) and the pure helpers the Work
// tab draws with. The engine owns every record; nothing here writes.

export type DestKind = "domain" | "project" | "entity" | "event" | "app" | "folder";
export interface Destination {
  kind: DestKind; id: string; label: string; space: string; owner: string;
  entity?: string;
  // Translated per machine by the engine; "abs" only works on its own Mac.
  folder?: { root: "vault" | "home" | "mono" | "abs"; rel: string };
  confidence: number; why: string;
}
export interface Suggestion {
  kind: "domain" | "project" | "entity" | "app" | "specialist" | "machine";
  name: string; why: string; draft?: unknown; state: "open" | "accepted" | "declined";
}
export type Shape = string;
export type Effort = "quick" | "standard" | "deep";
export interface RoutedTask {
  /** A short name, 2 to 4 words ("Landlord Reply"); older records have none, so show `taskTitle`. */
  name?: string;
  text: string; goal: string; dest: Destination | null; alternatives: Destination[]; specialists: string[];
  shape: Shape; flags: { open_ended?: boolean; decision?: boolean; money?: boolean; numbers?: boolean };
  effort: Effort; agentKind: string; machine: string; suggestions: Suggestion[];
}
export interface RouterPlan { goals: { text: string; tasks: RoutedTask[] }[]; source: "model" | "code" }
// "queued": may start, waiting for a free slot (the engine runs up to maxRunning at once, in queue order).
// "backlog": parked as an idea (routed, never started, not in the queue); Move to queue (`work start`) puts it at the end.
export type WorkStatus = "backlog" | "routed" | "queued" | "needs-you" | "running" | "paused" | "done" | "failed" | "closed";
export type AskKind = "start" | "herdr-workspace" | "keep-close" | "machine-add";
export interface WorkTask extends RoutedTask {
  id: string; promptId: string; status: WorkStatus; executor: "engine" | "herdr"; jobId?: string;
  board?: { space: string; id: string };
  thread: { space: string; session: string };
  ask?: { kind: AskKind; detail: string; command?: string };
  herdr?: { machine: string; workspaceLabel: string; workspaceId?: string; tabId?: string; paneId?: string; agent?: string; createdWorkspace?: boolean; lastRead?: string; glyph?: boolean; briefPending?: boolean };
  // Which Mac is driving the task now; stale after a few minutes without renewal.
  lease?: { host: string; until: number };
  log: LogEntry[];
  /** What came of it, one or two plain sentences (done, failed or held). */
  outcome?: string;
  /** False while a finished task waits, checked, in the queue; true once cleared. */
  cleared?: boolean;
  /** What the vault already knew that the work needed: `label` is the line the panel shows. */
  context?: { label: string; text: string }[];
  /** The question the agent waits on (status needs-you), one plain sentence. */
  waiting?: string;
  /** Every domain the work touches, the owner first; and the apps it involves. */
  domains?: string[];
  apps?: string[];
  /** The light back-and-forth: the task's short plain lines and the user's replies, oldest first. */
  updates?: TaskUpdate[];
}
export interface TaskUpdate { ts: number; from: "task" | "you"; text: string; /** A plan's questions, answered in one reply. */ questions?: string[] }
export interface LogEntry { ts: number; ev: string; detail?: string; more?: string }

/** A task's title: its short name, else its words. */
export const taskTitle = (t: Pick<WorkTask, "name" | "text">) => t.name?.trim() || t.text;
export interface WorkPrompt { id: string; ts: number; text: string; surface: "desktop" | "phone" | "cli"; machine: string; tasks: WorkTask[] }
export interface Machine {
  id: string; hostname?: string; label: string; role?: "hub" | "client"; current: boolean;
  herdr: "saved" | "disabled" | "missing" | "local"; vaultRoot?: string; lastSeen?: number;
}
export interface WorkSettings { herdr: boolean; workspace?: string; maxRunning?: number }
/** `work settings` answers `{ ok, settings }`. */
export function asSettings(v: unknown): WorkSettings {
  const o = (v ?? {}) as { settings?: WorkSettings } & Partial<WorkSettings>;
  const s = o.settings ?? o;
  return { herdr: !!s.herdr, workspace: s.workspace, ...(typeof s.maxRunning === "number" ? { maxRunning: s.maxRunning } : {}) };
}

// Used when the engine names no agent kinds (an older Herdr, say).
export const FALLBACK_AGENT_KINDS = ["claude", "codex", "gemini", "agy"];

export const STATUS_LABEL: Record<WorkStatus, string> = {
  backlog: "Idea", routed: "Routed", queued: "Queued", "needs-you": "Needs you", running: "Running", paused: "Paused", done: "Done", failed: "Failed", closed: "Closed",
};
// The DotTone each status wears (ui.tsx StatusDot).
export const STATUS_TONE: Record<WorkStatus, "ok" | "warn" | "err" | "accent" | "muted"> = {
  backlog: "muted", routed: "accent", queued: "muted", "needs-you": "warn", running: "accent", paused: "muted", done: "ok", failed: "err", closed: "muted",
};
export const ACTIVE: ReadonlySet<WorkStatus> = new Set(["routed", "queued", "needs-you", "running", "paused", "failed"]);

export type WorkAction = "pause" | "continue" | "start" | "stop" | "reopen";
export const ACTION_LABEL: Record<WorkAction, string> = {
  pause: "Pause", continue: "Continue", start: "Start", stop: "Stop", reopen: "Reopen",
};

/** What a task's menu offers for its status. Work mode never asks, so there is nothing to answer. */
export function actionsFor(t: Pick<WorkTask, "status" | "executor">): WorkAction[] {
  switch (t.status) {
    // Start moves a parked idea to the end of the queue.
    case "backlog": return ["start"];
    case "routed": return ["start"];
    // It starts by itself when a slot frees; Pause holds it back.
    case "queued": return ["pause"];
    case "needs-you": return ["pause"];
    case "running": return ["pause"];
    case "paused": return ["continue"];
    case "failed": return ["continue"];
    case "done": return [];
    case "closed": return t.executor === "herdr" ? ["reopen"] : ["continue"];
  }
}

/** The status as one short sentence for the panel. */
export function statusLine(t: Pick<WorkTask, "status" | "waiting" | "outcome">): string {
  switch (t.status) {
    case "running": return "Working on it";
    case "queued": return "Waiting for a free slot";
    case "needs-you": return t.waiting || "Waiting for you";
    case "paused": return t.outcome?.startsWith("Held") ? t.outcome : "Paused";
    case "done": return "Done";
    case "failed": return "Did not finish";
    case "routed": return "About to start";
    case "backlog": return "An idea, not started";
    case "closed": return "Closed";
  }
}

export type ActivityIcon = "route" | "shield" | "terminal" | "mail" | "globe" | "file" | "pencil" | "search" | "helper" | "steps" | "spark" | "you" | "ask" | "check" | "clock" | "pause" | "play" | "split" | "warn" | "team";
export interface ActivityLine { ts: number; icon: ActivityIcon; text: string; more?: string }

const iconFor = (line: string): ActivityIcon =>
  /gmail|email/i.test(line) ? "mail" : /web/i.test(line) ? "globe" : /^Reading/.test(line) ? "file" : /^Editing/.test(line) ? "pencil"
    : /^Running a command/.test(line) ? "terminal" : /^Searching/.test(line) ? "search" : /helper/.test(line) ? "helper" : /steps/.test(line) ? "steps" : "spark";
const after = (detail = "") => detail.replace(/^\S+\s+/, "");

/**
 * The task's log as plain activity lines (never engine wording, ids or agent
 * output): what happened, with an icon, and for some lines the detail behind
 * them (the follow-up's words, the call behind an activity).
 */
export function activityLines(t: Pick<WorkTask, "log" | "dest" | "herdr">): ActivityLine[] {
  const out: ActivityLine[] = [];
  const add = (l: LogEntry, icon: ActivityIcon, text: string, more?: string) => { if (out[out.length - 1]?.text !== text) out.push({ ts: l.ts, icon, text, ...(more ? { more } : {}) }); };
  for (const l of t.log) {
    switch (l.ev) {
      case "routed": add(l, "route", `Sent to ${t.dest?.label ?? "General"}`); break;
      case "guard": case "held": if (l.detail) add(l, l.ev === "guard" ? "shield" : "pause", l.detail); break;
      case "started": add(l, "play", "Started"); break;
      case "in Herdr": add(l, "terminal", t.herdr?.workspaceLabel ? `Opened its own Herdr tab in ${t.herdr.workspaceLabel}` : "Opened its own Herdr tab"); break;
      case "back in Herdr": case "reopened": add(l, "terminal", "Back in its Herdr tab"); break;
      case "briefed": add(l, "play", "Got its brief and started"); break;
      case "activity": if (l.detail) add(l, iconFor(l.detail), l.detail, l.more); break;
      case "waiting": add(l, "ask", l.detail ? `Asked: ${l.detail}` : "Waiting for you"); break;
      case "follow-up": add(l, "you", "You followed up", l.more); break;
      case "noted": add(l, "clock", "Your follow-up goes in when this run ends"); break;
      case "again": add(l, "play", "Back at work with your follow-up"); break;
      case "renamed": case "moved": if (l.detail) add(l, l.ev === "renamed" ? "pencil" : "route", l.detail); break;
      case "split": add(l, "split", l.detail ?? "Became its own task", l.more); break;
      case "queued": add(l, "clock", "Waiting for a free slot"); break;
      case "re-routed": case "route undone": add(l, "route", `Moved to ${after(l.detail) || "General"}`); break;
      case "specialist made": if (l.detail) add(l, "team", `Brought in a new ${l.detail.replace(/-/g, " ")} specialist`); break;
      case "paused": add(l, "pause", "Paused"); break;
      case "continued": add(l, "play", "Continued"); break;
      case "stopped": add(l, "pause", "Stopped"); break;
      case "closed": add(l, "terminal", "Closed its Herdr tab"); break;
      case "done": case "job done": add(l, "check", "Done"); break;
      case "checked off": add(l, "check", "Checked off"); break;
      case "could not start": add(l, "warn", "Could not start"); break;
      case "job failed": add(l, "warn", "Did not finish"); break;
      case "job needs-approval": add(l, "shield", "Stopped before an action that needs your approval"); break;
      default: break;
    }
  }
  return out;
}

/** A task's tasks grouped by goal, in the order the goals first appear. */
export function groupByGoal<T extends Pick<WorkTask, "goal">>(tasks: T[]): { goal: string; tasks: T[] }[] {
  const out: { goal: string; tasks: T[] }[] = [];
  for (const t of tasks) {
    const g = out.find((x) => x.goal === t.goal);
    if (g) g.tasks.push(t); else out.push({ goal: t.goal, tasks: [t] });
  }
  return out;
}

/** A queue row: the task and a summary of the prompt it came from. */
export type QueueTask = WorkTask & { prompt?: { id: string; ts: number; text: string; surface?: WorkPrompt["surface"] } };
const OPEN_IN_QUEUE: ReadonlySet<WorkStatus> = new Set(["routed", "queued", "needs-you", "running", "paused"]);
// A finished task stays in the queue, checked, until it is cleared (an older record that still asks stays too).
export const inQueue = (t: WorkTask): boolean => OPEN_IN_QUEUE.has(t.status) || !!t.ask || ((t.status === "done" || t.status === "failed") && t.cleared === false);
/** Checked: finished, waiting in the queue to be cleared. */
export const isChecked = (t: Pick<WorkTask, "status">) => t.status === "done";

/**
 * The queue, flat and in the engine's order (first runs first, newest at the
 * bottom). The engine answers `{ tasks }`; an older one answers `{ prompts }`,
 * whose open tasks are taken oldest prompt first.
 */
export function asQueue(v: unknown): QueueTask[] {
  const o = (v ?? {}) as { tasks?: unknown; prompts?: unknown };
  if (Array.isArray(o.tasks)) return (o.tasks as QueueTask[]).filter((t) => t && typeof t.id === "string" && inQueue(t));
  return asPrompts(v).sort((a, b) => a.ts - b.ts)
    .flatMap((p) => p.tasks.filter(inQueue).map((t): QueueTask => ({ ...t, prompt: { id: p.id, ts: p.ts, text: p.text, surface: p.surface } })));
}

/** "2 running · 1 queued · 1 needs you": the queue's one meta line. */
export function queueSummary(ts: Pick<WorkTask, "status">[]): string {
  const n = (s: WorkStatus) => ts.filter((t) => t.status === s).length;
  const parts = [`${ts.length} ${ts.length === 1 ? "task" : "tasks"}`];
  for (const s of ["running", "queued", "needs-you", "paused", "done"] as WorkStatus[]) if (n(s)) parts.push(`${n(s)} ${STATUS_LABEL[s].toLowerCase()}`);
  return parts.join(" · ");
}

/**
 * Move `id` so it lands at insertion point `at` (0..n, in the list as it is
 * now). Returns the new order and what to tell the engine (before the task now
 * after it, or after the last), or null when nothing moves.
 */
export function moveInQueue<T extends { id: string }>(list: T[], id: string, at: number): { list: T[]; args: { before: string } | { after: string } } | null {
  const from = list.findIndex((t) => t.id === id);
  if (from < 0 || at < 0 || at > list.length || at === from || at === from + 1) return null;
  const rest = list.filter((t) => t.id !== id);
  const i = at > from ? at - 1 : at;
  const next = [...rest.slice(0, i), list[from]!, ...rest.slice(i)];
  const after = next[i + 1];
  return { list: next, args: after ? { before: after.id } : { after: next[i - 1]!.id } };
}

// Ideas: the parked tasks. Done: finished or closed. All: every task, the queue's too.
export type BacklogFilter = "ideas" | "done" | "all";
const URGENCY: Record<WorkStatus, number> = { "needs-you": 0, failed: 1, running: 2, queued: 3, paused: 4, routed: 5, backlog: 6, done: 7, closed: 8 };
const DONE: ReadonlySet<WorkStatus> = new Set(["done", "closed"]);

/** Every task across prompts: filtered by state and words, most urgent first, then newest. */
export function backlog(ps: WorkPrompt[], filter: BacklogFilter = "ideas", query = ""): (WorkTask & { promptTs: number })[] {
  const q = query.trim().toLowerCase();
  return ps.flatMap((p) => p.tasks.map((t) => ({ ...t, promptTs: p.ts })))
    .filter((t) => filter === "all" || (filter === "ideas" ? t.status === "backlog" : DONE.has(t.status)))
    .filter((t) => !q || `${t.text} ${t.goal} ${t.dest?.label ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => URGENCY[a.status] - URGENCY[b.status] || b.promptTs - a.promptTs);
}

/**
 * Engine answers come as `{ prompts }` (the queue), `{ tasks }` with each
 * task's prompt (the backlog), `{ prompt }` (one added) or a bare list; all
 * become prompts.
 */
export function asPrompts(v: unknown): WorkPrompt[] {
  const o = (v ?? {}) as { prompts?: unknown; prompt?: unknown; tasks?: unknown };
  if (!Array.isArray(v) && Array.isArray(o.tasks)) {
    const byId = new Map<string, WorkPrompt>();
    for (const t of o.tasks as (WorkTask & { prompt?: Partial<WorkPrompt> })[]) {
      if (!t || typeof t.id !== "string") continue;
      const { prompt, ...task } = t;
      const pid = prompt?.id ?? t.promptId;
      let p = byId.get(pid);
      if (!p) { p = { id: pid, ts: prompt?.ts ?? 0, text: prompt?.text ?? "", surface: prompt?.surface ?? "cli", machine: prompt?.machine ?? t.machine, tasks: [] }; byId.set(pid, p); }
      p.tasks.push(task);
    }
    return [...byId.values()];
  }
  const a = Array.isArray(v) ? v : Array.isArray(o.prompts) ? o.prompts : o.prompt ? [o.prompt] : [];
  return (a as WorkPrompt[]).filter((p) => p && typeof p.id === "string" && Array.isArray(p.tasks));
}
export function asMachines(v: unknown): { machines: Machine[]; agentKinds: string[] } {
  const o = (v ?? {}) as { machines?: unknown; agentKinds?: unknown };
  const list = Array.isArray(v) ? v : Array.isArray(o.machines) ? o.machines : [];
  const kinds = !Array.isArray(v) && Array.isArray(o.agentKinds) ? (o.agentKinds as unknown[]).filter((k): k is string => typeof k === "string") : [];
  return { machines: (list as Machine[]).filter((m) => m && typeof m.id === "string"), agentKinds: kinds.length ? kinds : FALLBACK_AGENT_KINDS };
}
export function asWorkspaces(v: unknown): string[] {
  const a = Array.isArray(v) ? v : (v as { workspaces?: unknown } | null)?.workspaces;
  return Array.isArray(a) ? a.map((w) => (typeof w === "string" ? w : (w as { label?: string })?.label ?? "")).filter(Boolean) : [];
}

/** An engine without `work` (an older sidecar) answers this way. */
export function engineLacksWork(err: unknown): boolean {
  return /unknown (sub)?command|unknown verb|no such command/i.test(String(err ?? ""));
}

export const HERDR_STATE_LABEL: Record<Machine["herdr"], string> = { local: "This Mac", saved: "Connected", disabled: "Turned off", missing: "Not connected" };
export const canDispatchTo = (m: Pick<Machine, "herdr">) => m.herdr === "local" || m.herdr === "saved";

/** `work machine-add` answers this when the other Mac's Herdr needs an update a person approves in a terminal. */
export function needsApproval(v: unknown): boolean {
  return !!v && typeof v === "object" && (v as { needsApproval?: unknown }).needsApproval === true;
}

/**
 * An engine or bridge error as one plain sentence for the Work tab, with the
 * raw text kept for a Details disclosure. Never shows JSON to the user.
 */
export function plainError(e: unknown): { text: string; details: string } {
  let raw = e instanceof Error ? e.message : typeof e === "string" ? e : (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
  // A JSON answer ({ ok:false, error }) inside the message: its error is the useful part.
  const j = raw.match(/\{[\s\S]*\}/);
  if (j) { try { const o = JSON.parse(j[0]) as { error?: unknown; message?: unknown }; const m = o.error ?? o.message; if (typeof m === "string" && m.trim()) raw = m; } catch { /* not JSON */ } }
  const details = raw.trim();
  const rules: [RegExp, string][] = [
    [/unknown (sub)?command|unknown verb|no such command/i, "Update the engine to use Work mode."],
    [/needs one final update|interactive terminal to approve|needs a Herdr update/i, "That Mac needs a Herdr update first."],
    [/ssh target|invalid ssh/i, "That address does not look right. Use a host name like mini.local, or user@host."],
    [/machine label|invalid id/i, "That name can only have letters, digits, dots and dashes."],
    [/could not open Terminal/i, "Could not open Terminal on this Mac."],
    [/permission denied|host key|could not resolve|no route to host|connection refused|timed out|operation timed out/i, "Could not reach that Mac. Check it is on and signed in."],
    [/spawn .*herdr|herdr: (command )?not found|ENOENT.*herdr/i, "Herdr is not installed on this Mac."],
    [/is not in the queue/i, "That task is no longer in the queue."],
    [/no task /i, "That task is gone. It may have been closed on another Mac."],
    [/cannot be paused/i, "That task is not running, so there is nothing to pause."],
    [/no job to run/i, "This task has nothing to run yet. Route it somewhere first."],
    [/empty prompt|say what to work on/i, "Say what needs doing first."],
    [/too long/i, "That prompt is too long."],
    [/spawn .* failed|engine task failed|prevail exited/i, "The engine did not answer. Try again in a moment."],
  ];
  for (const [re, text] of rules) if (re.test(details)) return { text, details };
  return { text: "Something went wrong.", details };
}

/** "Continue here" shows when another Mac holds the task; a live lease asks before taking it. */
export function leaseElsewhere(t: Pick<WorkTask, "lease">, host: string, now = Date.now()): { elsewhere: boolean; live: boolean } {
  if (!t.lease || !host || t.lease.host === host) return { elsewhere: false, live: false };
  return { elsewhere: true, live: t.lease.until > now };
}

// The engine names a machine by its label everywhere (a task's machine, a lease's host, --machine).
export const machineLabel = (machines: Machine[], x: string) => machines.find((m) => m.label === x || m.id === x)?.label ?? (x === "local" ? "This Mac" : x);
