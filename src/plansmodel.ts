// Types and pure helpers for Step 3 of the plans (the engine owns the data):
// the Today card, the weekly review card, jobs and specialists, open
// decisions and metric proposals.

export interface TodayItem {
  key: string; kind: "task" | "commitment" | "waiting" | "decision" | "job" | "mission"; title: string; domain: string;
  due?: string; person?: string; thread: string[]; unlinked: boolean; why: string; score: number;
  ref: { domain: string; id?: string; text?: string; slug?: string; job?: string; mission?: string };
}
export interface TodayCard {
  date: string; generated: number; calm: number | null; items: TodayItem[];
  fallingBehind: { text: string; key?: string; kind?: string; count?: number } | null;
  decisionDue: { question: string; due?: string; domain: string; slug: string; recommendation?: string } | null;
  yourDay: { connected: boolean; note: string };
  alsoDue: TodayItem[];
  feedback: { ts: number; key: string; action: string }[];
  /** Today T2: every promise due this week not among the three (none is missing from Today). */
  promises?: { key: string; title: string; kind: "commitment" | "waiting"; domain: string; due?: string; person?: string; why: string; slipping: boolean }[];
  /** Commitments added on their own from mail or meeting notes, each with Undo. */
  added?: { id: string; text: string; domain: string; src: string }[];
}

/** Today T3: one thing the radar holds. */
export interface RadarItem { key: string; kind: string; domain: string; mission?: string; text: string; evidence: string; due?: string; severity: number; interrupt?: string }
export interface Radar { computed: number; items: RadarItem[] }
export const RADAR_KIND_LABEL: Record<string, string> = { commitment: "Promises", waiting: "Waiting for", routine: "Routines", relationship: "People", goal: "Goals", path: "Paths", admin: "Deadlines", domain: "Domains gone cold", decision: "Decisions", mission: "Missions", rule: "Non-negotiables" };
/** Radar items grouped by kind, most severe group first. */
export function radarGroups(items: RadarItem[]): { kind: string; label: string; items: RadarItem[] }[] {
  const by = new Map<string, RadarItem[]>();
  for (const x of items) (by.get(x.kind) ?? by.set(x.kind, []).get(x.kind)!).push(x);
  return [...by.entries()].map(([kind, xs]) => ({ kind, label: RADAR_KIND_LABEL[kind] ?? label(kind), items: xs })).sort((a, b) => Math.max(...b.items.map((x) => x.severity)) - Math.max(...a.items.map((x) => x.severity)));
}
/** A person id (person/sam-rivera) as a name. */
export const personName = (id?: string) => (id ? label(id.replace(/^person\//, "")) : "");

export interface GlanceRowLite { id: string; title: string; unit: string; value: number; documentary: boolean; record?: string; normal: { lo: number; hi: number; learning: boolean }; paused?: string | null }
export interface ReviewCard {
  week: string; through: string; due: boolean;
  checkin: { calm: number; note?: string } | null; calmNormal: number | null;
  lines: { moved: string[]; drifted: string[]; conflict: string };
  /** Goals G3: the conflict behind the line, with its evidence. */
  conflict?: { key: string; evidence: string[] } | null;
  glance: GlanceRowLite[]; surprise: string | null;
  candidates: { key: string; kind: string; title: string; quote: string; count: number }[];
  metricProposals: MetricProposal[];
  question: { id: string; text: string } | null;
  woop: { id: string; title: string }[];
  waited: { kind: string; text: string }[];
  interruptions: { used: number; budget: number };
  /** One line about the stack (apps plan A4); null when there is nothing to say. */
  apps?: string | null;
  /** Metrics M4: the quarterly ladder and the optional monthly WHO-5 when due, one hypothesis, slipping guardrails. */
  asked?: { ladder: boolean; who5: boolean };
  hypothesis?: { key: string; text: string } | null;
  guardrails?: string[];
  /** Today T2: promises found in mail or notes, not sure enough to file alone. */
  commitments?: { src: string; text: string; due?: string; person?: string; quote: string }[];
  /** Today T3: everything falling behind. */
  radar?: { key: string; kind: string; text: string; evidence: string; due?: string }[];
  /** Missions MS4: one line per active mission. */
  missions?: string[];
}

export interface MetricProposal {
  key: string; kind: "ideal" | "goal" | "pattern" | "source"; title: string; why: string; metric?: string;
  serves?: string; servesTitle?: string; domain?: string; quote?: string; from: string; tier: string; spark: number[]; computable: boolean; score: number;
}

export interface TeamStep { step: number; specialists: string[]; gate?: boolean }
export interface Job {
  id: string; ask: string; origin: { kind: string; thread?: string; domain: string };
  domains: { owner: string; consulted: string[]; informed: string[] };
  team: TeamStep[]; effort: "quick" | "standard" | "deep"; budget: { usd: number; minutes: number }; why: string;
  playbook: string | null; status: "proposed" | "running" | "needs-approval" | "done" | "failed" | "stopped";
  startsAlone: boolean; askReason?: string; created: number; started?: number; ended?: number;
  cost?: { usd: number; minutes: number; estimated: boolean };
  progress?: { step: number; specialist: string; pass: number }[];
  result?: { type: string; summary: string; page?: string; verdict?: string; drafts?: { to: string; subject: string; body: string }[] };
  note?: string;
  /** Goals G3: what it serves, what it may cost, the non-negotiables it touches. */
  compass?: JobCompass;
}
export interface Receipt { n: number; ts: number; domain: string; kind: string; file: string; ref: string; text: string; undone?: number }
export interface StepRecord { id: string; specialist: string; status: string; passes: { n: number; check: { ok: boolean; missing: string[] } }[]; cost: { usd: number; minutes: number } }
export interface JobView { job: Job; steps: StepRecord[]; filed: Receipt[]; body: string }

export interface Specialist {
  id: string; name: string; icon: string; family: "know" | "decide" | "do" | "grow" | "deliver"; returns: string;
  ceiling: string; tools: string[]; apps: string[]; runtime: string; budget: { minutes: number; usd: number; passes: number };
  handoff: string; doneWhen: string[]; mandate: string; on: boolean; builtIn: boolean; source?: string;
}

export interface DecisionRecord {
  slug: string; domain: string; file: string; question: string; status: "open" | "decided" | "revisit"; due?: string;
  owner: string; consulted: string[]; serves: string[]; gut?: string; recommendation?: string; confidence?: string;
  decided?: string; chose?: string; retroDue?: string; retroRight?: string; sections: Record<string, string>;
  /** Today T4 (DecisionView): what the record still lacks, whether a recommendation waits behind the gut call, and whether it is big (the council). */
  missing?: string[]; recommendationReady?: boolean; big?: boolean;
}

/** Open one decision on the Decisions page ("domain/slug"). */
export const DECISIONS_FOCUS_KEY = "prevail.decisions.focus";
export function openDecision(target: string) {
  try { localStorage.setItem(DECISIONS_FOCUS_KEY, target); } catch { /* storage off */ }
  window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "decisions" }));
  window.dispatchEvent(new CustomEvent("prevail:decisions-focus", { detail: target }));
}

/** What a decision row says beside its question: due, decided, or a retro owed. */
export function decisionStatus(r: Pick<DecisionRecord, "status" | "due" | "decided" | "retroDue" | "retroRight">, today = new Date().toISOString().slice(0, 10)): string {
  if (r.status === "decided") return r.retroDue && !r.retroRight && r.retroDue <= today ? "retro owed" : r.decided ? `decided ${r.decided}` : "decided";
  return r.due ? fmtDue(r.due, today) : "";
}

export const FAMILY_LABEL: Record<Specialist["family"], string> = { know: "Know", decide: "Decide", do: "Do", grow: "Grow", deliver: "Deliver" };
export const label = (slug: string) => slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/** Which step of the team a specialist is on: done, now, or next. */
export function stepState(job: Job, specialist: string, steps: StepRecord[]): "done" | "now" | "next" | "failed" {
  const rec = steps.find((s) => s.specialist === specialist);
  if (rec && rec.status.startsWith("done")) return "done";
  if (rec && rec.status === "failed") return "failed";
  if (job.status === "running" && job.progress?.some((p) => p.specialist === specialist)) return "now";
  return job.status === "done" ? "done" : "next";
}

export function jobStatusLabel(j: Job): string {
  if (j.status === "running") return "Running";
  if (j.status === "proposed") return j.startsAlone ? "Ready" : "Waiting on you";
  if (j.status === "needs-approval") return "Waiting on you";
  if (j.status === "done") return "Done";
  if (j.status === "stopped") return "Stopped";
  return "Failed";
}

export function elapsed(j: Job, now = Date.now()): string {
  const from = j.started ?? j.created;
  const to = j.ended ?? now;
  const s = Math.max(0, Math.round((to - from) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Group jobs the way the Jobs list shows them. */
export function jobGroups(jobs: Job[]): { running: Job[]; waiting: Job[]; done: Job[] } {
  return {
    running: jobs.filter((j) => j.status === "running"),
    waiting: jobs.filter((j) => j.status === "proposed" || j.status === "needs-approval"),
    done: jobs.filter((j) => j.status === "done" || j.status === "failed" || j.status === "stopped"),
  };
}

export function fmtDue(due?: string, today = new Date().toISOString().slice(0, 10)): string {
  if (!due) return "";
  const d = Math.round((new Date(`${due}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000);
  if (d < 0) return `${-d} day${d === -1 ? "" : "s"} late`;
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d < 7) return new Date(`${due}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });
  return new Date(`${due}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The commitment a turn filed ("[filed:<id>]" at its end), if any. */
export function filedIdOf(text: string): string | null {
  return /\[filed:([A-Za-z0-9_-]+)\]\s*$/.exec(text ?? "")?.[1] ?? null;
}

/** The job id an assistant turn points to ("[job:<id>]" at its end), if any. */
export function jobIdOf(text: string): string | null {
  return /\[job:([A-Za-z0-9_-]+)\]\s*$/.exec(text ?? "")?.[1] ?? null;
}

// ── Specialists Phase 2: playbooks (prevail playbook rows | show) ──

export type PlaybookGroup = "running" | "yours" | "drafts" | "built-in";
export interface PlaybookRow { id: string; name: string; goal: string; domain?: string; group: PlaybookGroup; source: "yours" | "built-in"; draft: boolean; steps: number; running: boolean; lastRun?: { ts: number; status: string } }
export interface PlaybookStepRow { n: number; kind: string; label: string; specialists: string[]; returns: string[]; gate: boolean; ask: boolean; domain?: string }
export interface PlaybookView extends PlaybookRow {
  rows: PlaybookStepRow[];
  triggers: { domain: string; loop: string; cadence: string; enabled: boolean }[];
  runs: { id: string; status: string; ts: number; summary?: string }[];
  from?: string;
}

export const PLAYBOOK_GROUPS: { id: PlaybookGroup; label: string }[] = [
  { id: "running", label: "Running" }, { id: "yours", label: "Yours" }, { id: "drafts", label: "Drafts" }, { id: "built-in", label: "Built in" },
];

/** Rows by group, in the page's order; empty groups stay (they show a count of 0). */
export function playbookGroups(rows: PlaybookRow[]): Record<PlaybookGroup, PlaybookRow[]> {
  const out: Record<PlaybookGroup, PlaybookRow[]> = { running: [], yours: [], drafts: [], "built-in": [] };
  for (const r of rows) (out[r.group] ?? out["built-in"]).push(r);
  return out;
}

/** "Weekly in Foo", "Daily in Foo and Bar", or "By hand". */
export function triggerLine(t: PlaybookView["triggers"]): string {
  const on = t.filter((x) => x.enabled);
  if (!on.length) return "By hand";
  const cad = [...new Set(on.map((x) => x.cadence).filter(Boolean))];
  const doms = [...new Set(on.map((x) => label(x.domain)))];
  return `${cad.length ? label(cad.join(", ")) : "On a loop"} in ${doms.length > 1 ? `${doms.slice(0, -1).join(", ")} and ${doms[doms.length - 1]}` : doms[0]}`;
}

export const PLAYBOOKS_FOCUS_KEY = "prevail.playbooks.focus";
/** Open the Playbooks page on one playbook (from a job card's Save as playbook). */
export function openPlaybook(id: string): void {
  try { localStorage.setItem(PLAYBOOKS_FOCUS_KEY, id); } catch { /* storage off */ }
  window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "playbooks" }));
  window.dispatchEvent(new CustomEvent("prevail:playbooks-focus", { detail: id }));
}


// ── Goals G3: alignment, conflicts, rules (engine compass-align.ts) ──

export type RuleStateName = "ok" | "at-risk" | "broken" | "unchecked";
export interface JobCompass { serves: { id: string; title: string }[]; costs: { id: string; title: string; why: string }[]; rules: { id: string; title: string; state: RuleStateName }[] }
export interface RuleState { id: string; title: string; check?: string; state: RuleStateName; value?: number | null; detail: string }
export interface Conflict { key: string; kind: string; a: string; b: string; aTitle: string; bTitle: string; question: string; evidence: string[]; confidence: number; asserted_by: "code" | "model" }
export interface Rollup {
  week: string; computed: number;
  values: { id: string; title: string; rank: number; matters: number; lived: number | null; attention: number; unmeasured: boolean }[];
  saidVsDid: string[]; conflicts: Conflict[]; rules: RuleState[];
  needsYou: { kind: "conflict" | "rule" | "stalled" | "woop"; key: string; text: string }[];
}

export const RULE_STATE_LABEL: Record<RuleStateName, string> = { ok: "Holding", "at-risk": "At risk", broken: "Broken", unchecked: "The Steward judges it" };

/** The chips a job card shows: what it serves (goals first), what to watch, the rules it touches with their state. */
export function compassChips(c: JobCompass | undefined): { serves: string[]; watch: string[]; rules: { title: string; state: RuleStateName }[] } {
  if (!c) return { serves: [], watch: [], rules: [] };
  return { serves: c.serves.map((x) => x.title), watch: c.costs.map((x) => x.title), rules: c.rules.map((r) => ({ title: r.title, state: r.state })) };
}
