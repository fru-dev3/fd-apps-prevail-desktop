// Projects you track (the entity kind `project`, data/entities/projects/<slug>/)
// and the structure suggestions (new domain, new project, archive a dormant
// domain). The engine owns both; this module holds the shapes, the reads
// through the shared cache, the writes, and the in-app navigation. Intent's
// inferred projects (projectsview.tsx) are a different thing: a project here
// may come from one (`intent_project`).
import { invoke } from "./bridge";
import { useInvokeQuery } from "./query";
import type { EntitySummary } from "./entitystore";

export type ProjectStatus = "active" | "paused" | "done" | "archived";
export const PROJECT_STATUSES: ProjectStatus[] = ["active", "paused", "done", "archived"];
export interface TrackedProject extends Omit<EntitySummary, "kind"> {
  kind: "project";
  status?: ProjectStatus;
  outcome?: string;
  target?: string;
  domains?: string[];
  intent_project?: string;
}
export interface ProjectGoal { title: string; status: string; domain: string }

// A write to a project, or an accepted suggestion, invalidates these reads.
export const PROJECTS_CHANGED = "prevail:projects-changed";
export const STRUCTURE_CHANGED = "prevail:structure-changed";
const fire = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

export const statusOf = (p: { status?: string }): ProjectStatus =>
  (PROJECT_STATUSES as string[]).includes(p.status ?? "") ? (p.status as ProjectStatus) : "active";
export const slugOf = (id: string) => id.slice(id.indexOf("/") + 1);

/** The tracked projects, through `entities list --kind project`. */
export function useTrackedProjects(vaultPath: string | null) {
  const q = useInvokeQuery<{ entities?: TrackedProject[] } | null>("entities_list", vaultPath ? { vault: vaultPath, kind: "project", limit: 500 } : null, { invalidateOn: [PROJECTS_CHANGED, STRUCTURE_CHANGED] });
  const list = (Array.isArray(q.data?.entities) ? q.data!.entities! : []).filter((e) => e && e.kind === "project");
  return { projects: list, loading: q.loading, refresh: q.refresh };
}

export async function createProject(vaultPath: string, a: { name: string; outcome?: string; target?: string; domains?: string[]; fromIntent?: string }): Promise<TrackedProject> {
  const r = await invoke<TrackedProject | { project?: TrackedProject }>("engine_projects_create", {
    vault: vaultPath, name: a.name, outcome: a.outcome ?? null, target: a.target ?? null, domains: a.domains ?? null, fromIntent: a.fromIntent ?? null,
  });
  fire(PROJECTS_CHANGED);
  fire("prevail:entities-changed");
  return (r && "project" in r && r.project ? r.project : r) as TrackedProject;
}

export async function setProject(vaultPath: string, id: string, patch: { status?: ProjectStatus; outcome?: string; target?: string; domains?: string[] }): Promise<void> {
  await invoke("engine_projects_set", { vault: vaultPath, id, status: patch.status ?? null, outcome: patch.outcome ?? null, target: patch.target ?? null, domains: patch.domains ?? null });
  fire(PROJECTS_CHANGED);
}

// Opening a tracked project from anywhere: the Projects page selects it on
// mount, or in place when it is already on screen.
export const OPEN_PROJECT_KEY = "prevail.projects.open";
export const OPEN_PROJECT_EVENT = "prevail:open-project";
export function openTrackedProject(id: string) {
  const full = id.startsWith("project/") ? id : `project/${id}`;
  try { localStorage.setItem(OPEN_PROJECT_KEY, full); } catch { /* storage off */ }
  fire("prevail:open-settings", "projects");
  fire(OPEN_PROJECT_EVENT, full);
}
export function takeOpenProject(): string | null {
  try { const v = localStorage.getItem(OPEN_PROJECT_KEY); localStorage.removeItem(OPEN_PROJECT_KEY); return v; } catch { return null; }
}

/** The tracked project an Intent project became, if any. */
export const trackedFor = (projects: TrackedProject[], intentSlug: string) => projects.find((p) => p.intent_project === intentSlug) ?? null;

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
// created domain or project (a slug, an id, or an object carrying one).
export function acceptedTarget(res: unknown, s: Pick<StructureSuggestion, "kind">): { domain: string } | { project: string } | null {
  const r = (res && typeof res === "object" ? res : {}) as Record<string, unknown>;
  const pick = (v: unknown): string | null => typeof v === "string" && v ? v
    : v && typeof v === "object" ? pick((v as Record<string, unknown>).id) ?? pick((v as Record<string, unknown>).slug) : null;
  if (s.kind === "project") {
    const p = pick(r.project) ?? (typeof r.id === "string" && r.id.startsWith("project/") ? r.id : null);
    return p ? { project: p.startsWith("project/") ? p : `project/${p}` } : null;
  }
  if (s.kind === "domain") {
    const d = pick(r.domain);
    return d ? { domain: d } : null;
  }
  return null;
}
