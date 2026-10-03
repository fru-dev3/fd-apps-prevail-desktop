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
export const RADAR_KIND_LABEL: Record<string, string> = { commitment: "Promises", waiting: "Waiting for", routine: "Routines", relationship: "People", goal: "Goals", path: "Paths", admin: "Deadlines", domain: "Domains gone cold", decision: "Decisions", mission: "Projects", rule: "Non-negotiables" };
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
  /** Apps A5: the quarterly export reminder (when turned on) and a said vs used diff waiting for a yes. */
  exportReminder?: string | null;
  stackDiff?: string | null;
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
  /** Goals G4: each chosen initiative against its expectations; the quarterly review when owed. */
  initiatives?: { id: string; title: string; state: string; explanation: string; proposal: string }[];
  quarterly?: boolean;
  /** Metrics M5: the running experiment's arm this week. */
  experiment?: { id: string; arm: "A" | "B"; text: string } | null;
  /** Today T5: this week's calendar by value, next week against capacity, holds that ask, drafted declines. */
  time?: TimeReview | null;
}
export interface TimeReview {
  thisWeek: { week: string; connected: boolean; note?: string; hours: number; meetings: number; focus: number; afterHours: number; byValue: { id: string; title: string; rank: number; hours: number; share: number; expected: number }[]; unlinked: number; lines: string[] };
  warning: string | null;
  holds: { id: string; title: string; start: string; end: string; for: string; status: string; note?: string }[];
  declines: { id: string; title: string; start: string; body: string }[];
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
  /** Specialists Phase 3: the Operator's actions, each with the broker's answer. */
  actions?: OperatorAction[];
}
export interface OperatorAction {
  n: number; text: string; why?: string; undo?: string; cls: string;
  status: "blocked" | "asks" | "running" | "done" | "failed" | "declined";
  reason?: string; act?: string; report?: string; ts: number; carries?: string[];
}
export const ACTION_STATUS_LABEL: Record<OperatorAction["status"], string> = {
  blocked: "Blocked", asks: "Waiting for your yes", running: "Running", done: "Done", failed: "Failed", declined: "Declined",
};
/** Scheduled and event playbook runs waiting in the Inbox. */
export interface InboxResult {
  runId: string; playbook: string; name: string; trigger: "schedule" | "event"; event?: string; domain?: string;
  ok: boolean; note: string; ts: number; waiting: number; steps: { label: string; ok: boolean; decision: string; note: string; specialists?: string[] }[];
}
export interface Receipt { n: number; ts: number; domain: string; kind: string; file: string; ref: string; text: string; undone?: number }
export interface StepRecord { id: string; specialist: string; status: string; passes: { n: number; check: { ok: boolean; missing: string[] } }[]; cost: { usd: number; minutes: number } }
export interface JobView { job: Job; steps: StepRecord[]; filed: Receipt[]; body: string }

export interface Specialist {
  id: string; name: string; icon: string; family: "know" | "decide" | "do" | "grow" | "deliver"; returns: string;
  ceiling: string; tools: string[]; apps: string[]; runtime: string; budget: { minutes: number; usd: number; passes: number };
  handoff: string; doneWhen: string[]; mandate: string; on: boolean; builtIn: boolean; source?: string;
  /** A preset: the built-in it is built on (never past it). */
  base?: string;
  /** The vertical pack that installed it. */
  pack?: string;
  /** An outside agent: only the brief leaves, each call asks first. */
  outside?: { endpoint: string; tool: string; perDay: number };
  /** Only from `specialists show`: the rest of the system prompt. */
  method?: string; never?: string; lens?: string;
}

// ── Editing a specialist (the engine enforces all of this again) ──
export const CEILINGS = ["read", "write-vault", "draft", "act-ask", "act"] as const;
export const CEILING_LABEL: Record<string, string> = { read: "Read", "write-vault": "Write vault", draft: "Draft", "act-ask": "Ask, then act", act: "Act" };
/** What a ceiling lets a specialist do, as a sentence fragment for the view. */
export const CEILING_SAYS: Record<string, string> = { read: "Reads only", "write-vault": "Writes to your vault", draft: "Drafts, never sends", "act-ask": "Acts after your yes", act: "Acts alone" };
export const SPECIALIST_TOOLS: { id: string; label: string }[] = [{ id: "web", label: "Web" }, { id: "vault-read", label: "Vault" }];
export const HANDOFF_LABEL: Record<string, string> = { off: "Only when named", offer: "Offers first", auto: "Starts alone" };
export const RUNTIME_LABEL: Record<string, string> = { fast: "Fast", standard: "Standard", deep: "Deep" };
export const ceilingRank = (c: string) => Math.max(0, (CEILINGS as readonly string[]).indexOf(c));
export const toolLabel = (t: string) => SPECIALIST_TOOLS.find((x) => x.id === t)?.label ?? label(t);

export interface SpecialistDraft {
  mandate: string; method: string; never: string; tools: string[]; apps: string[]; ceiling: string;
  minutes: string; usd: string; passes: string; handoff: string; runtime: string; doneWhen: string;
}
export function draftOf(s: Specialist): SpecialistDraft {
  return {
    mandate: s.mandate, method: s.method ?? "", never: s.never ?? "", tools: [...s.tools], apps: [...s.apps], ceiling: s.ceiling,
    minutes: String(s.budget.minutes), usd: String(s.budget.usd), passes: String(s.budget.passes), handoff: s.handoff, runtime: s.runtime,
    doneWhen: s.doneWhen.join("\n"),
  };
}
/** The edit the engine gets: only what changed. A string is the first problem found. */
export function editOf(s: Specialist, d: SpecialistDraft): Record<string, unknown> | string {
  const out: Record<string, unknown> = {};
  if (!d.mandate.trim()) return "Say what it is for (the mandate).";
  const m = Number(d.minutes), u = Number(d.usd), p = Number(d.passes);
  if (!(m > 0 && m <= 120)) return "Minutes run from 1 to 120.";
  if (!(u >= 0 && u <= 50)) return "Dollars run from 0 to 50.";
  if (!(Number.isInteger(p) && p >= 1 && p <= 5)) return "Passes run from 1 to 5.";
  if (d.mandate.trim() !== s.mandate.trim()) out.mandate = d.mandate;
  if (d.method.trim() !== (s.method ?? "").trim()) out.method = d.method;
  if (d.never.trim() !== (s.never ?? "").trim()) out.never = d.never;
  if (d.tools.join() !== s.tools.join()) out.tools = d.tools;
  if (d.apps.join() !== s.apps.join()) out.apps = d.apps;
  if (d.ceiling !== s.ceiling) out.ceiling = d.ceiling;
  if (d.handoff !== s.handoff) out.handoff = d.handoff;
  if (d.runtime !== s.runtime) out.runtime = d.runtime;
  if (m !== s.budget.minutes || u !== s.budget.usd || p !== s.budget.passes) out.budget = { minutes: m, usd: u, passes: p };
  const done = d.doneWhen.split("\n").map((x) => x.trim()).filter(Boolean);
  if (done.join("\n") !== s.doneWhen.join("\n")) out.doneWhen = done;
  return out;
}
/** Why a domain's instructions would loosen the specialist, or null. In a domain it may only tighten. */
export function loosens(s: Pick<Specialist, "ceiling" | "tools" | "apps">, e: { ceiling?: string; tools?: string[]; apps?: string[] }): string | null {
  if (e.ceiling && ceilingRank(e.ceiling) > ceilingRank(s.ceiling)) return `Its ceiling here must be ${CEILING_LABEL[s.ceiling]} or lower.`;
  const extra = [...(e.tools ?? []).filter((t) => !s.tools.includes(t)), ...(e.apps ?? []).filter((a) => !s.apps.includes(a))];
  return extra.length ? `${extra.map(toolLabel).join(", ")} is not one of its own.` : null;
}

/** Where a job or run lives, in words: "mission/oca" reads "Mission OCA", a domain slug its name. */
export function scopeLabel(owner: string): string {
  const m = /^mission\/(.+)$/.exec(owner ?? "");
  if (m) return `Project ${m[1]!.length <= 4 ? m[1]!.toUpperCase() : label(m[1]!)}`;
  return label(owner || "general");
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
/** The told receipt a saved reply carries ([told:<id>]), or null. */
export function toldIdOf(text: string): string | null {
  return /\[told:([A-Za-z0-9_-]+)\]\s*$/.exec(text)?.[1] ?? null;
}

export function filedIdOf(text: string): string | null {
  return /\[filed:([A-Za-z0-9_-]+)\]\s*$/.exec(text ?? "")?.[1] ?? null;
}

/** The job id an assistant turn points to ("[job:<id>]" at its end), if any. */
export function jobIdOf(text: string): string | null {
  return /\[job:([A-Za-z0-9_-]+)\]\s*$/.exec(text ?? "")?.[1] ?? null;
}

// ── Specialists Phase 2: playbooks (prevail playbook rows | show) ──

export type PlaybookGroup = "running" | "scheduled" | "yours" | "drafts" | "built-in";
/** When a playbook runs on its own (playbooks replace loops; engine playbooks.ts ScheduleView). */
export interface PlaybookSchedule { space: string; cadence: string; on?: string; enabled: boolean; status: string; autonomy: string; lastRunTs: number | null; nextRunTs: number | null; loop?: string }
export interface PlaybookRow { id: string; name: string; goal: string; domain?: string; group: PlaybookGroup; source: "yours" | "built-in"; draft: boolean; steps: number; running: boolean; lastRun?: { ts: number; status: string }; schedule?: PlaybookSchedule }
export interface PlaybookStepRow { n: number; kind: string; label: string; specialists: string[]; returns: string[]; gate: boolean; ask: boolean; domain?: string }
export interface PlaybookView extends PlaybookRow {
  rows: PlaybookStepRow[];
  triggers: { domain: string; loop: string; cadence: string; enabled: boolean; on?: string }[];
  runs: { id: string; status: string; ts: number; summary?: string }[];
  from?: string;
}

export const PLAYBOOK_GROUPS: { id: PlaybookGroup; label: string }[] = [
  { id: "running", label: "Running" }, { id: "scheduled", label: "On a schedule" }, { id: "yours", label: "Yours" }, { id: "drafts", label: "Drafts" }, { id: "built-in", label: "Built in" },
];

/** Rows by group, in the page's order; empty groups stay (they show a count of 0). */
export function playbookGroups(rows: PlaybookRow[]): Record<PlaybookGroup, PlaybookRow[]> {
  const out: Record<PlaybookGroup, PlaybookRow[]> = { running: [], scheduled: [], yours: [], drafts: [], "built-in": [] };
  for (const r of rows) (out[r.group] ?? out["built-in"]).push(r);
  return out;
}

/** "Weekly in Foo", "Daily in Foo and Bar", or "By hand". */
/** A radar event a playbook waits for, in words: "admin:renew" is "an admin deadline that says renew". */
export const RADAR_EVENT_LABEL: Record<string, string> = {
  commitment: "a promise slipping", waiting: "a waiting-for overdue", routine: "a routine slipping", relationship: "someone gone quiet",
  goal: "a goal gone quiet", path: "a path missing its expectations", admin: "an admin deadline", domain: "a domain gone cold",
  decision: "a decision due", mission: "a project falling behind", rule: "a non-negotiable at risk",
};
export function eventLabel(on: string): string {
  const [k, ...w] = on.split(":");
  const words = w.join(":").trim();
  return `when the radar flags ${RADAR_EVENT_LABEL[k ?? ""] ?? k}${words ? ` that says "${words}"` : ""}`;
}

export function triggerLine(t: PlaybookView["triggers"]): string {
  const on = t.filter((x) => x.enabled);
  if (!on.length) return "By hand";
  const cad = [...new Set(on.map((x) => (x.on ? eventLabel(x.on) : label(x.cadence))).filter(Boolean))];
  const doms = [...new Set(on.map((x) => label(x.domain)))];
  const what = cad.length ? cad.join(", ") : "On a loop";
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} in ${doms.length > 1 ? `${doms.slice(0, -1).join(", ")} and ${doms[doms.length - 1]}` : doms[0]}`;
}

/** Scheduled playbooks by the space they run in (General first, then A to Z). */
export function bySpace(rows: PlaybookRow[]): { space: string; rows: PlaybookRow[] }[] {
  const m = new Map<string, PlaybookRow[]>();
  for (const r of rows) { const k = r.schedule?.space ?? r.domain ?? "general"; m.set(k, [...(m.get(k) ?? []), r]); }
  return [...m].map(([space, rs]) => ({ space, rows: rs.sort((a, b) => Number(b.schedule?.enabled ?? 0) - Number(a.schedule?.enabled ?? 0) || a.name.localeCompare(b.name)) }))
    .sort((a, b) => (a.space === "general" ? -1 : b.space === "general" ? 1 : scopeLabel(a.space).localeCompare(scopeLabel(b.space))));
}

const AUTONOMY_WORDS: Record<string, string> = { suggest: "suggests", tasks: "files tasks", ask: "asks first", auto: "runs on its own" };
const day = (ts: number, now: number) => {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
};

/** One quiet line for a schedule: "Weekly · next Oct 9 · last Oct 2 · asks first", or "Off". */
export function scheduleLine(s: PlaybookSchedule, now = Date.now()): string {
  if (!s.enabled || (s.status !== "active" && s.status !== "")) return s.status === "done" ? "Done" : "Off";
  const when = s.on ? eventLabel(s.on) : label(s.cadence);
  const bits = [when.charAt(0).toUpperCase() + when.slice(1)];
  if (s.nextRunTs !== null && !s.on) bits.push(s.nextRunTs <= now ? "due now" : `next ${day(s.nextRunTs, now)}`);
  if (s.lastRunTs) bits.push(`last ${day(s.lastRunTs, now)}`);
  bits.push(AUTONOMY_WORDS[s.autonomy] ?? s.autonomy);
  return bits.join(" · ");
}

export const PLAYBOOKS_FOCUS_KEY = "prevail.playbooks.focus";
/** Open the Playbooks page on one playbook (from a job card's Save as playbook). */
export function openPlaybook(id: string): void {
  if (id) { try { localStorage.setItem(PLAYBOOKS_FOCUS_KEY, id); } catch { /* storage off */ } }
  window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "playbooks" }));
  if (id) window.dispatchEvent(new CustomEvent("prevail:playbooks-focus", { detail: id }));
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

/** The tone of a job's status dot. */
export function jobTone(j: Pick<Job, "status" | "startsAlone">): "ok" | "warn" | "err" | "accent" | "muted" {
  if (j.status === "running") return "accent";
  if (j.status === "proposed" || j.status === "needs-approval") return "warn";
  if (j.status === "done") return "ok";
  return j.status === "failed" ? "err" : "muted";
}
