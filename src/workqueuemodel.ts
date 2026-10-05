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
  text: string; goal: string; dest: Destination | null; alternatives: Destination[]; specialists: string[];
  shape: Shape; flags: { open_ended?: boolean; decision?: boolean; money?: boolean; numbers?: boolean };
  effort: Effort; agentKind: string; machine: string; suggestions: Suggestion[];
}
export interface RouterPlan { goals: { text: string; tasks: RoutedTask[] }[]; source: "model" | "code" }
export type WorkStatus = "routed" | "needs-you" | "running" | "paused" | "done" | "failed" | "closed";
export type AskKind = "start" | "herdr-workspace" | "keep-close" | "machine-add";
export interface WorkTask extends RoutedTask {
  id: string; promptId: string; status: WorkStatus; executor: "engine" | "herdr"; jobId?: string;
  board?: { space: string; id: string };
  thread: { space: string; session: string };
  ask?: { kind: AskKind; detail: string };
  herdr?: { machine: string; workspaceLabel: string; tabId?: string; agent?: string; createdWorkspace?: boolean; lastRead?: string };
  // Which Mac is driving the task now; stale after a few minutes without renewal.
  lease?: { host: string; until: number };
  log: { ts: number; ev: string; detail?: string }[];
}
export interface WorkPrompt { id: string; ts: number; text: string; surface: "desktop" | "phone" | "cli"; machine: string; tasks: WorkTask[] }
export interface Machine {
  id: string; hostname?: string; label: string; role?: "hub" | "client"; current: boolean;
  herdr: "saved" | "disabled" | "missing" | "local"; vaultRoot?: string; lastSeen?: number;
}
export interface WorkSettings { herdr: boolean; machine?: string; agentKinds?: string[] }

// Used when the engine names no agent kinds (an older Herdr, say).
export const FALLBACK_AGENT_KINDS = ["claude", "codex", "gemini", "agy"];

export const STATUS_LABEL: Record<WorkStatus, string> = {
  routed: "Routed", "needs-you": "Needs you", running: "Running", paused: "Paused", done: "Done", failed: "Failed", closed: "Closed",
};
// The DotTone each status wears (ui.tsx StatusDot).
export const STATUS_TONE: Record<WorkStatus, "ok" | "warn" | "err" | "accent" | "muted"> = {
  routed: "accent", "needs-you": "warn", running: "accent", paused: "muted", done: "ok", failed: "err", closed: "muted",
};
export const ACTIVE: ReadonlySet<WorkStatus> = new Set(["routed", "needs-you", "running", "paused", "failed"]);

export type WorkAction = "pause" | "continue" | "start" | "stop" | "keep" | "close" | "reopen";
export const ACTION_LABEL: Record<WorkAction, string> = {
  pause: "Pause", continue: "Continue", start: "Start", stop: "Stop", keep: "Keep", close: "Close", reopen: "Reopen",
};

/** The actions a task's status allows. Keep and Close are Herdr-only, and an open keep-close ask already carries them. */
export function actionsFor(t: Pick<WorkTask, "status" | "executor" | "ask">): WorkAction[] {
  const herdr = t.executor === "herdr";
  switch (t.status) {
    case "routed": return ["start"];
    // Its question (Start / Not now, Keep / Close...) carries the choice.
    case "needs-you": return [];
    case "running": return ["pause"];
    case "paused": return ["continue"];
    case "failed": return ["continue"];
    case "done": return herdr && t.ask?.kind !== "keep-close" ? ["keep", "close"] : [];
    case "closed": return herdr ? ["reopen"] : [];
  }
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

/** "2 tasks · 1 needs you": the one meta line under a prompt in the queue. */
export function promptSummary(p: Pick<WorkPrompt, "tasks">): string {
  if (p.tasks.length === 0) return "Routing";
  const parts = [`${p.tasks.length} ${p.tasks.length === 1 ? "task" : "tasks"}`];
  const order: WorkStatus[] = ["needs-you", "running", "paused", "failed", "routed", "done", "closed"];
  for (const s of order) {
    const n = p.tasks.filter((t) => t.status === s).length;
    if (n > 0) parts.push(`${n} ${STATUS_LABEL[s].toLowerCase()}`);
  }
  return parts.join(" · ");
}

/** The status a prompt shows as a whole: the most urgent of its tasks. */
export function promptStatus(p: Pick<WorkPrompt, "tasks">): WorkStatus | null {
  for (const s of ["needs-you", "failed", "running", "paused", "routed", "done", "closed"] as WorkStatus[]) {
    if (p.tasks.some((t) => t.status === s)) return s;
  }
  return null;
}

/** Queue: prompts with work still open, newest first. Backlog shows everything. */
export function queuePrompts(ps: WorkPrompt[]): WorkPrompt[] {
  return [...ps].filter((p) => p.tasks.length === 0 || p.tasks.some((t) => t.status !== "closed")).sort((a, b) => b.ts - a.ts);
}

export type BacklogFilter = "open" | "done" | "all";
const URGENCY: Record<WorkStatus, number> = { "needs-you": 0, failed: 1, running: 2, paused: 3, routed: 4, done: 5, closed: 6 };

/** Every task across prompts: filtered by state and words, most urgent first, then newest. */
export function backlog(ps: WorkPrompt[], filter: BacklogFilter = "open", query = ""): (WorkTask & { promptTs: number })[] {
  const q = query.trim().toLowerCase();
  return ps.flatMap((p) => p.tasks.map((t) => ({ ...t, promptTs: p.ts })))
    .filter((t) => filter === "all" || (filter === "open" ? ACTIVE.has(t.status) : !ACTIVE.has(t.status)))
    .filter((t) => !q || `${t.text} ${t.goal} ${t.dest?.label ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => URGENCY[a.status] - URGENCY[b.status] || b.promptTs - a.promptTs);
}

/** Engine answers come wrapped or bare; take either. */
export function asPrompts(v: unknown): WorkPrompt[] {
  const a = Array.isArray(v) ? v : (v as { prompts?: unknown } | null)?.prompts;
  return Array.isArray(a) ? (a as WorkPrompt[]).filter((p) => p && typeof p.id === "string" && Array.isArray(p.tasks)) : [];
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

/** The command the user confirms to connect a machine to Herdr. */
export function machineAddCommand(m: Pick<Machine, "id" | "hostname">, target = ""): string {
  return `herdr machine add --label ${m.id} ${target.trim() || m.hostname || "<ssh target>"}`;
}

/** "Continue here" shows when another Mac holds the task; a live lease asks before taking it. */
export function leaseElsewhere(t: Pick<WorkTask, "lease">, host: string, now = Date.now()): { elsewhere: boolean; live: boolean } {
  if (!t.lease || !host || t.lease.host === host) return { elsewhere: false, live: false };
  return { elsewhere: true, live: t.lease.until > now };
}

export const machineLabel = (machines: Machine[], id: string) => machines.find((m) => m.id === id)?.label ?? (id === "local" ? "This Mac" : id);
