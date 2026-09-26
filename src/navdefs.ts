// Shared nav definitions for the mode-aware app sidebar. Kept in their own
// lightweight module (data + lucide icons only) so the main-bundle Sidebar can
// render the Work and Editor navs WITHOUT importing the heavy, lazy-loaded
// WorkPanel / SettingsPanel chunks.
//
// Selecting an item dispatches an event the matching content panel listens to:
//   • Work items   → "prevail:work-section"
//   • Editor items → "prevail:settings-section"
import { Activity, BarChart3, BookUser, Bot, Briefcase, CalendarDays, Compass, Database, Dices, FileText, FolderKanban, Github, Hammer, Layers, Lightbulb, ListChecks, MessagesSquare, Network, Plug, Repeat, Scale, ScanFace, Settings as SettingsIcon, Shield, ShieldCheck, Smartphone, Sparkles, Swords, Target, UserRound, Webhook, Wrench, Zap } from "lucide-react";

export type NavItem = { id: string; label: string; icon: typeof Database };
export type NavGroup = { heading: string; items: NavItem[] };

// Home sidebar: the operational surfaces, in two groups. The top group sits
// directly under Home and Inbox (which the sidebar renders itself, since they
// are not Work sections); the "Work" group holds the planning screens. Every id
// here is a WorkPanel section.
//   insights  -> Intent (what your prompts say about you)
//   projects  -> Intent's Projects view
//   task-list -> the Work board's list view
//   goals     -> the ideal-state constitution
export const WORK_NAV: NavGroup[] = [
  { heading: "Home", items: [
    { id: "insights", label: "Insights", icon: ScanFace },
    { id: "recommendations", label: "Recommendations", icon: Lightbulb },
    { id: "spark", label: "Spark", icon: Dices },
    { id: "automations", label: "Automations", icon: Repeat },
    { id: "calendar", label: "Calendar", icon: CalendarDays },
    { id: "notes", label: "Notes", icon: FileText },
  ]},
  { heading: "Work", items: [
    { id: "tasks", label: "Work board", icon: Briefcase },
    { id: "projects", label: "Projects", icon: FolderKanban },
    { id: "task-list", label: "Tasks", icon: ListChecks },
    { id: "goals", label: "Goals", icon: Target },
  ]},
];

// Editor mode: configuration.
export const EDITOR_NAV: NavGroup[] = [
  { heading: "Intelligence", items: [
    { id: "models", label: "Models", icon: Layers },
    { id: "council", label: "Council", icon: Scale },
    { id: "frameworks", label: "Frameworks", icon: Lightbulb },
    { id: "skills", label: "Skills", icon: Sparkles },
    { id: "tools", label: "Tools", icon: Hammer },
    { id: "benchmark", label: "Arena", icon: Swords },
  ]},
  { heading: "Context & Memory", items: [
    { id: "intent", label: "Intent", icon: ScanFace },
    { id: "entities", label: "Entities", icon: BookUser },
    { id: "ideal-state", label: "Ideals", icon: Compass },
    { id: "daemons", label: "Daemons", icon: Zap },
    { id: "activity", label: "Activity", icon: Activity },
    { id: "usage", label: "Usage", icon: BarChart3 },
  ]},
  { heading: "Connections", items: [
    // Phone leads the group and is its own destination: mobile access used to
    // live inside the WebUI panel, where nobody knew to look for it.
    { id: "phone", label: "Phone", icon: Smartphone },
    { id: "connectors", label: "Apps", icon: Plug },
    { id: "gateway", label: "Gateway", icon: MessagesSquare },
    { id: "mcp", label: "MCP", icon: Wrench },
    { id: "hooks", label: "Hooks", icon: Webhook },
    { id: "remote", label: "Network", icon: Network },
  ]},
  { heading: "Privacy & Safety", items: [
    { id: "autonomy", label: "Autonomy", icon: Bot },
    { id: "privacy", label: "Privacy", icon: ShieldCheck },
    { id: "safety", label: "Safety", icon: Shield },
  ]},
  { heading: "Settings", items: [
    { id: "profiles", label: "Profiles", icon: UserRound },
    { id: "workspace", label: "Vault", icon: Database },
    { id: "general", label: "General", icon: SettingsIcon },
    { id: "about", label: "About", icon: Github },
  ]},
];

// Intent replaced three nav items (Intents, Prompts, Retrospect) and was
// briefly called Mirror. Those ids still arrive from deep links and saved
// state, so they land on Intent.
const INTENT_ALIASES = new Set(["intents", "prompt-capture", "retrospect", "mirror"]);
export function navSection(id: string): string {
  return INTENT_ALIASES.has(id) ? "intent" : id;
}
