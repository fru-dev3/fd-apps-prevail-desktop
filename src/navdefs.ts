// Shared nav definitions for the mode-aware app sidebar. Kept in their own
// lightweight module (data + lucide icons only) so the main-bundle Sidebar can
// render the Work and Editor navs WITHOUT importing the heavy, lazy-loaded
// WorkPanel / SettingsPanel chunks.
//
// Selecting an item dispatches an event the matching content panel listens to:
//   • Work items   → "prevail:work-section"
//   • Editor items → "prevail:settings-section"
import { Activity, Blocks, BookUser, Compass, Database, FolderKanban, Layers, Lightbulb, ListChecks, Network, Scale, ScanFace, Settings as SettingsIcon, ShieldCheck, Swords } from "lucide-react";

export type NavItem = { id: string; label: string; icon: typeof Database };
export type NavGroup = { heading: string; items: NavItem[] };

// Home sidebar: the operational surfaces, in two groups. The top group sits
// directly under Home and Inbox (which the sidebar renders itself, since they
// are not in these groups); the "Work" group holds the planning screens. Every
// id here is a WorkPanel section.
//   insights  -> Intent (what your prompts say about you)
//   projects  -> Intent's Projects view
//   task-list -> Tasks, a plain list
//   compass   -> the Compass: mission, values, roles, life goals, rules;
//                domain goals and the ideals are its other two views
export const WORK_NAV: NavGroup[] = [
  { heading: "Home", items: [
    { id: "insights", label: "Insights", icon: ScanFace },
    { id: "recommendations", label: "For You", icon: Lightbulb },
  ]},
  { heading: "Work", items: [
    { id: "projects", label: "Projects", icon: FolderKanban },
    { id: "task-list", label: "Tasks", icon: ListChecks },
    { id: "compass", label: "Compass", icon: Compass },
  ]},
];

// Every WorkPanel section: the nav rows plus Inbox and Apps, which the sidebar
// draws itself.
export const WORK_SECTION_IDS: string[] = ["inbox", "apps", ...WORK_NAV.flatMap((g) => g.items.map((i) => i.id))];
// Old ids that still arrive from deep links and saved state. The Work board
// ("tasks") is the Tasks list now; the Settings Apps page ("connectors") is
// the Home Apps page.
// Goals and Ideals are views of the Compass page now.
const WORK_ALIASES: Record<string, string> = { tasks: "task-list", connectors: "apps", goals: "compass", "ideal-state": "compass", ideals: "compass", omega: "compass" };
// Which Compass view an old id asks for (read by the page on open).
const COMPASS_FOCUS: Record<string, string> = { goals: "goals", "ideal-state": "ideals", ideals: "ideals", omega: "ideals:omega" };
/** Remember the Compass view an old Goals or Ideals link asked for. */
export function noteCompassFocus(id: string): void {
  const f = COMPASS_FOCUS[id];
  if (!f) return;
  try { localStorage.setItem("prevail.compass.focus", f); } catch { /* storage off */ }
  window.dispatchEvent(new Event("prevail:compass-focus"));
}
// Screens that were removed. Links saved before that land on Home.
export const REMOVED_SECTIONS = new Set(["map", "source-map", "source", "spark", "automations", "loopboard", "calendar", "notes"]);
/** The WorkPanel section an id opens (aliases resolved), or null if it is not one. */
export function workSection(id: string): string | null {
  const s = WORK_ALIASES[id] ?? id;
  return WORK_SECTION_IDS.includes(s) ? s : null;
}

// Editor mode: configuration.
export const EDITOR_NAV: NavGroup[] = [
  { heading: "Intelligence", items: [
    { id: "models", label: "Models", icon: Layers },
    { id: "council", label: "Council", icon: Scale },
    { id: "toolkit", label: "Toolkit", icon: Blocks },
    { id: "benchmark", label: "Arena", icon: Swords },
  ]},
  { heading: "Context & Memory", items: [
    { id: "intent", label: "Intent", icon: ScanFace },
    { id: "entities", label: "Entities", icon: BookUser },
    { id: "activity", label: "Activity", icon: Activity },
  ]},
  // Each of these is one page whose side column lists what used to be
  // separate rows (EDITOR_SUBS maps the old ids to a page and a row).
  { heading: "Connections", items: [
    { id: "connections", label: "Connections", icon: Network },
  ]},
  { heading: "Privacy & Safety", items: [
    { id: "privacy-safety", label: "Privacy & Safety", icon: ShieldCheck },
  ]},
  { heading: "Settings", items: [
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ]},
];

// Old Settings ids, and the page and side row they open now.
export const EDITOR_SUBS: Record<string, [page: string, row: string]> = {
  phone: ["connections", "phone"],
  gateway: ["connections", "gateway"],
  mcp: ["connections", "mcp"],
  hooks: ["connections", "hooks"],
  remote: ["connections", "network"],
  privacy: ["privacy-safety", "bunker"],
  autonomy: ["privacy-safety", "autonomy"],
  safety: ["privacy-safety", "safety-access"],
  general: ["settings", "general"],
  appearance: ["settings", "appearance"],
  shortcuts: ["settings", "shortcuts"],
  workspace: ["settings", "vault"],
  vault: ["settings", "vault"],
  demo: ["settings", "vault"],
  profiles: ["settings", "profiles"],
  about: ["settings", "about"],
  daemons: ["settings", "daemon:distill"],
  memory: ["settings", "daemon:memory"],
  usage: ["activity", "usage:overview"],
  // Arena sections before 0.4.1. Scout and Schedule are gone; they land on Run.
  arena: ["benchmark", "run"],
  leaderboard: ["benchmark", "leaderboard"],
  history: ["benchmark", "leaderboard"],
  scout: ["benchmark", "run"],
  schedule: ["benchmark", "run"],
};
/** The side row an old id asks for on its new page, if any. */
export function editorRow(id: string): string | null {
  return EDITOR_SUBS[id]?.[1] ?? null;
}

// Intent replaced three nav items (Intents, Prompts, Retrospect) and was
// briefly called Mirror. Those ids still arrive from deep links and saved
// state, so they land on Intent.
const INTENT_ALIASES = new Set(["intents", "prompt-capture", "retrospect", "mirror"]);
// Skills, Tools and Frameworks are one Toolkit page now. Their old ids open it
// with that group expanded and its first item picked (toolkitGroup).
const TOOLKIT_ALIASES = new Set(["skills", "tools", "frameworks"]);
export function navSection(id: string): string {
  if (TOOLKIT_ALIASES.has(id)) return "toolkit";
  if (EDITOR_SUBS[id]) return EDITOR_SUBS[id][0];
  return INTENT_ALIASES.has(id) ? "intent" : id;
}
export const TOOLKIT_FOCUS_KEY = "prevail.toolkit.focus";
/** Remember which Toolkit group an old id asked for, for the page to open on. */
export function noteToolkitGroup(id: string): void {
  if (!TOOLKIT_ALIASES.has(id)) return;
  try { localStorage.setItem(TOOLKIT_FOCUS_KEY, id); } catch { /* storage off */ }
  window.dispatchEvent(new CustomEvent("prevail:toolkit-focus", { detail: id }));
}
