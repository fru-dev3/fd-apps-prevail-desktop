// Types and pure helpers for Step 3 of the plans (the engine owns the data):
// the Today card, the weekly review card, jobs and specialists, open
// decisions and metric proposals.

export interface TodayItem {
  key: string; kind: "task" | "commitment" | "waiting" | "decision" | "job"; title: string; domain: string;
  due?: string; person?: string; thread: string[]; unlinked: boolean; why: string; score: number;
  ref: { domain: string; id?: string; text?: string; slug?: string; job?: string };
}
export interface TodayCard {
  date: string; generated: number; calm: number | null; items: TodayItem[];
  fallingBehind: { text: string } | null;
  decisionDue: { question: string; due?: string; domain: string; slug: string; recommendation?: string } | null;
  yourDay: { connected: boolean; note: string };
  alsoDue: TodayItem[];
  feedback: { ts: number; key: string; action: string }[];
}

export interface GlanceRowLite { id: string; title: string; unit: string; value: number; documentary: boolean; record?: string; normal: { lo: number; hi: number; learning: boolean } }
export interface ReviewCard {
  week: string; through: string; due: boolean;
  checkin: { calm: number; note?: string } | null; calmNormal: number | null;
  lines: { moved: string[]; drifted: string[]; conflict: string };
  glance: GlanceRowLite[]; surprise: string | null;
  candidates: { key: string; kind: string; title: string; quote: string; count: number }[];
  metricProposals: MetricProposal[];
  question: { id: string; text: string } | null;
  woop: { id: string; title: string }[];
  waited: { kind: string; text: string }[];
  interruptions: { used: number; budget: number };
  /** One line about the stack (apps plan A4); null when there is nothing to say. */
  apps?: string | null;
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

/** The job id an assistant turn points to ("[job:<id>]" at its end), if any. */
export function jobIdOf(text: string): string | null {
  return /\[job:([A-Za-z0-9_-]+)\]\s*$/.exec(text ?? "")?.[1] ?? null;
}
