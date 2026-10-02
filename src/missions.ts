// Missions (missions-plan.md): time-bound efforts you talk to. The engine owns
// them (`prevail missions ...`, data/missions/<slug>/); this module holds the
// shapes, the reads through the shared cache, the writes, the in-app
// navigation, and the structure suggestions (new domain, a mission from a
// prompt project, archive a dormant domain). Prompt projects (projectsview.tsx)
// are a different thing: a mission may come from one (`prompt_projects`).
import { invoke } from "./bridge";
import { useInvokeQuery } from "./query";

export type MissionStatus = "active" | "paused" | "completed" | "archived";
export const MISSION_STATUSES: MissionStatus[] = ["active", "paused", "completed", "archived"];
export type Role = "owner" | "consulted" | "informed";
export type Ceiling = "read" | "write-vault" | "draft" | "act-ask" | "act";
export const CEILINGS: Ceiling[] = ["read", "write-vault", "draft", "act-ask", "act"];

export interface Milestone { id: string; title: string; done: boolean; due?: string; doneOn?: string; weight: number; check?: string }
export interface MissionLinks {
  calendar: { app: string; event: string; title: string; start: string; kind?: string; source: "matched" | "created"; milestone?: string }[];
  tasks: { domain: string; id: string }[];
  files: { domain: string; path: string }[];
  threads: { domain: string; thread: string; title?: string }[];
}
export interface Progress {
  milestones: { done: number; total: number; share: number; next?: Milestone; overdue: Milestone[] };
  budget: { planned: number; used: number; share: number; byLine: { id: string; label: string; planned: number; used: number }[] };
  days: { day: number; total: number; left: number };
}
export interface Mission {
  slug: string;
  id: string;
  name: string;
  status: MissionStatus;
  outcome: string;
  why: string;
  notes: string;
  start: string;
  target: string;
  completed?: string;
  result?: string;
  cadence: string;
  domains: { slug: string; role: Role }[];
  apps: string[];
  specialists: string[];
  people: string[];
  entities: string[];
  budget: { total_usd?: number; hours_wk?: number; lines: { id: string; label: string; usd: number }[] };
  goal?: string;
  path?: string;
  serves: string[];
  metrics?: string[];
  match?: { calendar?: string[]; email_from?: string[]; merchants?: string[] };
  prompt_projects: string[];
  ceiling: Ceiling;
  nudges: { per_week: number; muted: boolean };
  privacy: { localOnly: boolean };
  localOnly?: boolean;
  progress: Progress;
  milestones: Milestone[];
  links: MissionLinks;
  artifacts?: { path: string; name: string; kind: "artifact" | "file" | "brief"; mtime: number }[];
  log?: string[];
  closed?: boolean;
}
export interface MissionTask { domain: string; text: string; done: boolean; due?: string; id?: string; own: boolean }
export interface Filing { n: number; kind: string; domain: string; text: string; apply: boolean; ref?: string; action?: "move" | "drop" | "carry" }
export interface CloseoutPlan { slug: string; name: string; result: string; resultNote: string; summary: string; filings: Filing[] }
export interface Receipt { n: number; ts: number; kind: string; domain: string; file: string; text: string; undone?: number }

// A write to a mission (or an accepted suggestion) invalidates these reads.
export const MISSIONS_CHANGED = "prevail:missions-changed";
export const STRUCTURE_CHANGED = "prevail:structure-changed";
const fire = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

export const statusOf = (p: { status?: string }): MissionStatus =>
  (MISSION_STATUSES as string[]).includes(p.status ?? "") ? (p.status as MissionStatus) : "active";
/** mission/<slug>, project/<slug> (the retired kind) or a slug, to a slug. */
export const slugOf = (id: string) => id.replace(/^(mission|project)\//, "").replace(/^_mission-/, "");
export const ownerOf = (m: Pick<Mission, "domains">) => m.domains.find((d) => d.role === "owner")?.slug;
export const rolesOf = (m: Pick<Mission, "domains">, r: Role) => m.domains.filter((d) => d.role === r).map((d) => d.slug);

/** "12d", "today", "3d over": the sidebar's and list's short countdown. */
export function daysLeftLabel(m: Pick<Mission, "progress" | "status">): string {
  if (m.status !== "active") return "";
  const l = m.progress?.days?.left ?? 0;
  return l > 0 ? `${l}d` : l === 0 ? "today" : `${-l}d over`;
}

export function useMissions(vaultPath: string | null) {
  const q = useInvokeQuery<Mission[] | null>("engine_missions_list", vaultPath ? { vault: vaultPath, status: "all" } : null, { invalidateOn: [MISSIONS_CHANGED, STRUCTURE_CHANGED] });
  const list = (Array.isArray(q.data) ? q.data : []).filter((m) => m && typeof m.slug === "string");
  return { missions: list, loading: q.loading, refresh: q.refresh };
}

export function useMission(vaultPath: string | null, slug: string | null) {
  return useInvokeQuery<Mission | null>("engine_missions_show", vaultPath && slug ? { vault: vaultPath, slug } : null, { invalidateOn: [MISSIONS_CHANGED] });
}

async function write<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const r = await invoke<T>(cmd, args);
  fire(MISSIONS_CHANGED);
  return r;
}

export interface NewMission { name: string; outcome?: string; target?: string; owner?: string; consult?: string[]; inform?: string[]; apps?: string[]; specialists?: string[]; budgetUsd?: number; milestones?: string[]; fromPromptProject?: string }
export function createMission(vaultPath: string, a: NewMission): Promise<Mission> {
  return write<Mission>("engine_missions_create", {
    vault: vaultPath, name: a.name, outcome: a.outcome ?? null, target: a.target ?? null, owner: a.owner ?? null,
    consult: a.consult ?? null, inform: a.inform ?? null, apps: a.apps ?? null, specialists: a.specialists ?? null,
    budgetUsd: a.budgetUsd ?? null, milestones: a.milestones ?? null, fromPromptProject: a.fromPromptProject ?? null,
  });
}
export const setMissionField = (vaultPath: string, slug: string, field: string, value: string) => write<Mission>("engine_missions_set", { vault: vaultPath, slug, field, value });
export const attachToMission = (vaultPath: string, slug: string, kind: string, value: string, detach = false) => write<Mission>("engine_missions_attach", { vault: vaultPath, slug, kind, value, detach });
export const missionMilestone = (vaultPath: string, slug: string, op: "add" | "done" | "undone" | "move", o: { title?: string; id?: string; due?: string }) => write("engine_missions_milestone", { vault: vaultPath, slug, op, title: o.title ?? null, id: o.id ?? null, due: o.due ?? null });
export const missionBudget = (vaultPath: string, slug: string, op: "set-line" | "spend", line: string, usd: number, what?: string) => write("engine_missions_budget", { vault: vaultPath, slug, op, line, usd, what: what ?? null });
export const missionState = (vaultPath: string, slug: string, action: "pause" | "resume" | "archive" | "reopen", target?: string) => write<Mission>("engine_missions_state", { vault: vaultPath, slug, action, target: target ?? null });
export const missionLog = (vaultPath: string, slug: string, line: string) => write("engine_missions_log", { vault: vaultPath, slug, line });
export const closeoutPlan = (vaultPath: string, slug: string, result?: string, note?: string) => invoke<CloseoutPlan>("engine_missions_closeout_plan", { vault: vaultPath, slug, result: result ?? null, note: note ?? null });
export const closeoutApply = (vaultPath: string, plan: CloseoutPlan) => write<{ ok: boolean; receipts: Receipt[] }>("engine_missions_closeout_apply", { vault: vaultPath, slug: plan.slug, plan });
export const closeoutUndo = (vaultPath: string, slug: string, n: number) => write("engine_missions_undo", { vault: vaultPath, slug, n });

// MS4: progress without data entry.
export interface MetricProposalM { key: string; id: string; title: string; line: string; why: string }
export interface PendingEvent { id: string; title: string; start: string; end?: string; attendees: string[]; status: "ask" | "draft" | "created" | "declined"; note?: string; ts: number }
export const trackMissionMetric = (vaultPath: string, slug: string, key: string) => write("engine_missions_track", { vault: vaultPath, slug, key });
export const createMissionEvent = (vaultPath: string, slug: string, e: { title: string; start: string; end?: string; attendees?: string[] }) =>
  write<PendingEvent>("engine_missions_event_create", { vault: vaultPath, slug, title: e.title, start: e.start, end: e.end ?? null, attendees: e.attendees?.length ? e.attendees : null });
export const approveMissionEvent = (vaultPath: string, slug: string, id: string) => write<PendingEvent>("engine_missions_event_approve", { vault: vaultPath, slug, id });
export const linkMissionPath = (vaultPath: string, slug: string, path: string) => write("engine_missions_link_path", { vault: vaultPath, slug, path });
/** A pending event, as the Calendar tab says it: a hold waits for a yes, a draft is the user's to send. */
export function pendingLabel(e: Pick<PendingEvent, "status" | "note">): string {
  if (e.status === "draft") return "draft, you send it";
  if (e.status === "created") return "on your calendar";
  if (e.status === "declined") return "declined";
  return e.note ? `hold waiting for your yes (${e.note})` : "hold waiting for your yes";
}

// Opening a mission from anywhere: the Missions page selects it on mount, or
// in place when it is already on screen.
export const OPEN_MISSION_KEY = "prevail.missions.open";
export const OPEN_MISSION_EVENT = "prevail:open-mission";
export function openMission(id: string) {
  const slug = slugOf(id);
  try { localStorage.setItem(OPEN_MISSION_KEY, slug); } catch { /* storage off */ }
  fire("prevail:work-section", "missions");
  fire(OPEN_MISSION_EVENT, slug);
}
export function takeOpenMission(): string | null {
  try { const v = localStorage.getItem(OPEN_MISSION_KEY); localStorage.removeItem(OPEN_MISSION_KEY); return v; } catch { return null; }
}

/** The mission a prompt project became, if any. */
export const missionFor = (missions: Pick<Mission, "slug" | "prompt_projects">[], promptSlug: string) => missions.find((m) => (m.prompt_projects ?? []).includes(promptSlug)) ?? null;

// ---------------------------------------------------------------------------
// structure suggestions

export interface StructureEvidence { thread?: string; ts: string | number; domain: string }
export interface StructureSuggestion {
  id: string;
  kind: "domain" | "project" | "archive_domain";
  title: string;
  reason: string;
  evidence: StructureEvidence[];
  confidence: number;
}

export function useStructureSuggestions(vaultPath: string | null) {
  const q = useInvokeQuery<StructureSuggestion[] | { suggestions?: StructureSuggestion[] } | null>("engine_suggest_structure", vaultPath ? { vault: vaultPath } : null, { invalidateOn: [STRUCTURE_CHANGED] });
  const raw = Array.isArray(q.data) ? q.data : q.data?.suggestions ?? [];
  return { suggestions: raw.filter((s) => s && typeof s.id === "string" && typeof s.title === "string"), loading: q.loading };
}

export const RECS_CATEGORY_KEY = "prevail.recs.category";
export const RECS_CATEGORY_EVENT = "prevail:recs-category";
/** Recommendations, opened on its Structure category. */
export function openStructure() {
  try { localStorage.setItem(RECS_CATEGORY_KEY, "structure"); } catch { /* storage off */ }
  fire("prevail:open-settings", "recommendations");
  fire(RECS_CATEGORY_EVENT, "structure");
}

// What `suggest accept` made, read loosely: the engine answers with the
// created domain or mission (a slug, an id, or an object carrying one). The
// suggestion kind "project" is kept on the wire; it makes a mission.
export function acceptedTarget(res: unknown, s: Pick<StructureSuggestion, "kind">): { domain: string } | { mission: string } | null {
  const r = (res && typeof res === "object" ? res : {}) as Record<string, unknown>;
  const pick = (v: unknown): string | null => typeof v === "string" && v ? v
    : v && typeof v === "object" ? pick((v as Record<string, unknown>).id) ?? pick((v as Record<string, unknown>).slug) : null;
  if (s.kind === "project") {
    const p = pick(r.project) ?? pick(r.mission) ?? (typeof r.id === "string" && /^(mission|project)\//.test(r.id) ? r.id : null);
    return p ? { mission: slugOf(p) } : null;
  }
  if (s.kind === "domain") {
    const d = pick(r.domain);
    return d ? { domain: d } : null;
  }
  return null;
}
