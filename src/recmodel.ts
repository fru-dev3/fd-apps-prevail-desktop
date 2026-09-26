// Recommendations: the data side of the one "what to do next" page. The engine
// (`prevail recommendations --json`) ranks everything by leverage; this module
// holds the types, the filtering the page does on top (dismissed, saved,
// model defaults already applied) and the in-flow navigation to each item's
// evidence. No React here, so it is easy to test.
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { lsGet, lsSet } from "./storage";
import { requestEntity, type EntityKindName } from "./entitystore";
import { MIRROR_SELECT_KEY } from "./appsmirror-parts";

export type RecCategory = "rules" | "projects" | "apps" | "people" | "models" | "context";
export type SpineKey = "all" | "start" | RecCategory;

export interface RecEvidence { kind: "finding" | "project" | "entity" | "app" | "domain" | "benchmark"; ref: string; label: string }
export interface RecRow {
  id: string; domain: string; current?: string; suggested?: string; suggested_label?: string;
  cli?: string; score?: number; models_tested?: number;
}
export interface Rec {
  id: string;
  // Older engines sent "domain" | "model" | "app" | "context"; normalizeRec maps them.
  category: RecCategory;
  title: string;
  detail: string;
  metric?: { value: number; unit: string };
  leverage?: number;
  evidence?: RecEvidence;
  source?: string;
  instruction?: string;
  task?: { domain: string; text: string };
  rows?: RecRow[];
  action: {
    kind: string;
    domain?: string; model?: string; cli?: string; rule?: string; finding?: string; item?: string;
    project?: string; app?: string; entity?: string; index?: number;
  };
}

export const SPINE: { key: SpineKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "start", label: "Start here" },
  { key: "rules", label: "Rules" },
  { key: "projects", label: "Projects" },
  { key: "apps", label: "Apps" },
  { key: "people", label: "People and places" },
  { key: "models", label: "Models" },
  { key: "context", label: "Context" },
];
export const CATEGORIES: RecCategory[] = ["rules", "projects", "apps", "people", "models", "context"];
export const START_N = 5;

export const REC_DISMISSED = "prevail.recs.dismissed";
export const REC_SAVED = "prevail.recs.saved";
export function loadSet(key: string): Set<string> {
  try { return new Set(JSON.parse(lsGet(key) || "[]") as string[]); } catch { return new Set(); }
}
export function storeSet(key: string, s: Set<string>) {
  try { lsSet(key, JSON.stringify([...s])); } catch { /* storage off */ }
}

const LEGACY: Record<string, RecCategory> = { model: "models", app: "apps", domain: "context", context: "context" };
export function normalizeRec(r: Rec): Rec {
  const category = (CATEGORIES as string[]).includes(r.category) ? r.category : LEGACY[r.category as string] ?? "context";
  return { ...r, category };
}

// The model a domain uses today, as the app stores it.
export function currentModel(domain: string): string {
  try { return lsGet(`prevail.domain.${domain}.model`); } catch { return ""; }
}

// Rows still worth showing: not dismissed, and (for model defaults) not
// already the domain's model.
export function liveRows(r: Rec, dismissed: Set<string>): RecRow[] {
  return (r.rows ?? [])
    .filter((x) => !dismissed.has(x.id))
    .map((x) => (r.action.kind === "set_domain_models" ? { ...x, current: currentModel(x.domain) } : x))
    .filter((x) => r.action.kind !== "set_domain_models" || !x.suggested || x.current !== x.suggested);
}

// The item as the page shows it: an aggregated item whose rows are all gone
// disappears, and its number and headline follow the rows that are left.
export function liveRec(r: Rec, dismissed: Set<string>): Rec | null {
  if (!r.rows) return r;
  const rows = liveRows(r, dismissed);
  if (!rows.length) return null;
  if (rows.length === r.rows.length) return { ...r, rows };
  const n = rows.length;
  const title = r.action.kind === "set_domain_models"
    ? `Better model defaults for ${n} domain${n === 1 ? "" : "s"}`
    : r.title.replace(/^\d[\d,]*/, String(n)).replace(/^1 domains have/, "1 domain has");
  return { ...r, rows, title, metric: r.metric ? { ...r.metric, value: n } : undefined };
}

export function visibleRecs(recs: Rec[], dismissed: Set<string>, opts: { showDismissed?: boolean; savedOnly?: boolean; saved?: Set<string> } = {}): Rec[] {
  const out: Rec[] = [];
  for (const raw of recs) {
    const isDismissed = dismissed.has(raw.id);
    if (isDismissed && !opts.showDismissed) continue;
    if (opts.savedOnly && !opts.saved?.has(raw.id)) continue;
    const r = liveRec(normalizeRec(raw), dismissed);
    if (r) out.push(r);
  }
  return out;
}

export function spineCounts(recs: Rec[]): Record<SpineKey, number> {
  const c = { all: recs.length, start: Math.min(START_N, recs.length) } as Record<SpineKey, number>;
  for (const k of CATEGORIES) c[k] = 0;
  for (const r of recs) c[r.category] += 1;
  return c;
}

export function recsFor(recs: Rec[], key: SpineKey): Rec[] {
  if (key === "all") return recs;
  if (key === "start") return recs.slice(0, START_N);
  return recs.filter((r) => r.category === key);
}

// ---------------------------------------------------------------------------
// navigation: each piece of evidence opens where it lives

const fire = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));
const setLocal = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage off */ } };
export const INTENT_VIEW_KEY = "prevail.mirror.view";
export const INTENT_PROJECT_KEY = "prevail.intent.project";

export function openProject(slug: string) {
  setLocal(INTENT_VIEW_KEY, "projects");
  setLocal(INTENT_PROJECT_KEY, slug);
  fire("prevail:open-settings", "intent");
  fire("prevail:intent-project", slug);
}

export function openApp(id: string) {
  try { sessionStorage.setItem(MIRROR_SELECT_KEY, id); } catch { /* storage off */ }
  fire("prevail:open-settings", "connectors");
  fire("prevail:mirror-select", id);
}

export function openEvidence(ev: RecEvidence) {
  if (ev.kind === "finding") { setLocal(INTENT_VIEW_KEY, "noticed"); fire("prevail:open-settings", "intent"); return; }
  if (ev.kind === "project") { openProject(ev.ref); return; }
  if (ev.kind === "entity") {
    const [kind, slug] = ev.ref.split("/");
    if (kind && slug) requestEntity({ kind: kind as EntityKindName, value: slug });
    return;
  }
  if (ev.kind === "app") { openApp(ev.ref); return; }
  if (ev.kind === "domain") { fire("prevail:open-domain", ev.ref); return; }
  fire("prevail:open-settings", "benchmark");
}

// ---------------------------------------------------------------------------
// actions

export function setDomainModel(row: RecRow) {
  if (row.cli) lsSet(`prevail.domain.${row.domain}.cli`, row.cli);
  if (row.suggested) lsSet(`prevail.domain.${row.domain}.model`, row.suggested);
  fire("prevail:domain-model-set", row.domain);
}

export function doItLabel(r: Rec): string {
  switch (r.action.kind) {
    case "make_rule": return "Save as a standing rule";
    case "save_entity": return "Save a page";
    case "create_domain": return "Create the domain";
    case "set_domain_model": case "set_domain_models": return "Apply all";
    case "restart_project": return "Open the project to restart it";
    case "open_project": case "project_rec": return "Open the project";
    case "signin_app": return "Open the app to sign in";
    case "sync_app": return "Open the app to sync";
    case "draft_recipe": return "Open the app to draft a recipe";
    case "connect_app": return "Open Apps";
    case "improve_context": return "Open the domain";
    default: return "Open";
  }
}

// Runs the item's main action. One-shot writes happen in place; anything that
// needs the user somewhere else navigates there. Returns what happened.
export async function applyRec(rec: Rec, vaultPath: string): Promise<string> {
  const a = rec.action;
  switch (a.kind) {
    case "create_domain":
      if (!a.domain) break;
      await invoke("create_domain", { vault: vaultPath, name: a.domain });
      fire("prevail:domains-changed");
      return `Created the ${titleCase(a.domain)} domain.`;
    case "make_rule":
      await invoke("mirror_verdict", { vault: vaultPath, findingId: a.finding ?? "repeated_rules", verdict: "true", item: a.item ?? null, rule: a.rule ?? null });
      return "Saved as a standing rule.";
    case "save_entity":
      if (!a.entity) break;
      await invoke("entities_save", { vault: vaultPath, id: a.entity, name: null });
      fire("prevail:entities-changed");
      return "Saved. Its page is in People and places.";
    case "set_domain_model":
      if (!a.domain) break;
      setDomainModel({ id: rec.id, domain: a.domain, suggested: a.model, cli: a.cli });
      return `Set ${a.model || "the model"} as ${titleCase(a.domain)}'s default.`;
    case "set_domain_models": {
      const rows = liveRows(rec, new Set());
      rows.forEach(setDomainModel);
      return `Set new defaults for ${rows.length} domain${rows.length === 1 ? "" : "s"}.`;
    }
    case "improve_context":
      if (a.domain) fire("prevail:open-domain", a.domain);
      return "Opened the domain.";
    case "connect_app":
      fire("prevail:open-settings", "connectors");
      return "Opened Apps.";
    case "signin_app": case "sync_app": case "draft_recipe":
      if (a.app) openApp(a.app);
      return "Opened the app.";
    default:
      if (a.project) { openProject(a.project); return "Opened the project."; }
      if (rec.evidence) { openEvidence(rec.evidence); return "Opened."; }
  }
  return "Done.";
}

export async function copyInstruction(rec: Rec, vaultPath: string): Promise<void> {
  const text = rec.action.kind === "project_rec" && typeof rec.action.index === "number"
    ? await invoke<string>("intent_instruction", { vault: vaultPath, index: rec.action.index })
    : rec.instruction ?? rec.title;
  await navigator.clipboard.writeText(text);
}

export async function addTask(rec: Rec, vaultPath: string): Promise<void> {
  const t = rec.task ?? { domain: rec.action.domain || "general", text: rec.title };
  await invoke("tasks_add", { vault: vaultPath, domain: t.domain, text: t.text, source: "recommendations" });
  fire("prevail:tasks-changed");
}
