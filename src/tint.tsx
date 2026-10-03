// THE icon palette (owner, 2026-10-02 and 2026-10-03: "colorful, playful
// icons" everywhere icons mark a place: the sidebar, every SideSpine list,
// tab rows, page headers, the collapsed rails). Every concept has one hue and
// keeps it wherever it appears (People is always rose, Compass always green),
// drawn as a lucide icon on a small tinted square (.tint-sq in index.css) or,
// in a tab row or a section header, as the tinted icon alone. No yellow or
// gold. Domains keep their own colors (helpers.ts domainColor).
import {
  Activity, Archive, BarChart3, Blocks, Bot, Brain, Briefcase, CalendarDays, CalendarRange, CheckCircle2, CircleDot, Clock, Compass, Cpu,
  Database, Eye, FileText, FolderKanban, Gavel, Grid3x3, HelpCircle, History, Hourglass, Inbox, KeyRound, Layers, LayoutGrid, Lightbulb,
  ListChecks, Mail, MapPin, MessagesSquare, Network, Newspaper, Package, Pause, Play, Plug, Repeat, Scale, ScanFace, Settings, Shapes,
  Shield, ShieldCheck, Snowflake, Sparkles, Sun, Swords, Target, Trash2, UserCog, Users, Watch, Workflow, Wrench, type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

/** Hues in oklch degrees; yellow and gold (about 70 to 110) are never used. */
export const TINT_HUE: Record<string, number> = {
  // sidebar sections
  work: 255, entities: 352, activities: 195, specialists: 300, domains: 165,
  // Home rows
  inbox: 215, insights: 175, recommendations: 330,
  // Work rows
  "task-list": 250, compass: 155, decisions: 285, playbooks: 205,
  // kinds
  people: 355, places: 140, products: 232, things: 30, events: 190, projects: 268,
  // Settings pages
  models: 262, council: 285, toolkit: 200, benchmark: 20, intent: 175, activity: 225, usage: 240,
  connections: 205, "privacy-safety": 150, memory: 300, apps: 232, intelligence: 262,
  // views and states (tab rows, spine groups)
  all: 250, open: 215, active: 150, running: 215, waiting: 40, done: 150, completed: 150, goals: 20, ideals: 330,
  briefing: 215, today: 40, week: 205, actions: 150, google: 20, automations: 268, tasks: 250, results: 205,
  jobs: 255, history: 240, versions: 240, noticed: 175, metrics: 225, stack: 262, clis: 262, api: 205, direct: 300,
  summary: 240, questions: 285, trash: 18,
};
// Quiet concepts: the hue at low chroma, a slate tint rather than a color.
const QUIET = new Set(["settings", "archived", "paused", "icebox", "general"]);

// The icon a concept is drawn with names that concept when no key is given,
// so a page header or a list row picks up the same hue as its sidebar row.
const ICON_TINT = new Map<LucideIcon, string>([
  [Users, "people"], [MapPin, "places"], [Package, "products"], [Watch, "things"], [CalendarDays, "events"], [FolderKanban, "projects"],
  [Inbox, "inbox"], [ScanFace, "insights"], [Lightbulb, "recommendations"], [ListChecks, "task-list"], [Compass, "compass"],
  [Gavel, "decisions"], [Workflow, "playbooks"], [Briefcase, "work"], [Shapes, "entities"], [CalendarRange, "activities"],
  [Sparkles, "specialists"], [UserCog, "specialists"], [LayoutGrid, "all"], [Grid3x3, "domains"], [Layers, "models"], [Scale, "council"],
  [Blocks, "toolkit"], [Wrench, "toolkit"], [Swords, "benchmark"], [Activity, "activity"], [BarChart3, "metrics"], [Network, "connections"],
  [Plug, "connections"], [ShieldCheck, "privacy-safety"], [Shield, "privacy-safety"], [Settings, "settings"], [Target, "goals"],
  [Archive, "archived"], [Pause, "paused"], [Snowflake, "icebox"], [Trash2, "trash"], [CheckCircle2, "done"], [Play, "active"],
  [CircleDot, "open"], [Hourglass, "waiting"], [Clock, "running"], [Sun, "today"], [Newspaper, "briefing"], [Mail, "google"],
  [Repeat, "automations"], [Bot, "tasks"], [History, "history"], [Eye, "noticed"], [FileText, "summary"], [Cpu, "clis"],
  [KeyRound, "direct"], [HelpCircle, "questions"], [Brain, "memory"], [Database, "memory"], [MessagesSquare, "connections"],
]);
// Anything else gets a stable hue from its icon's name, from this set.
const SPREAD = [15, 30, 140, 160, 175, 195, 215, 232, 255, 268, 285, 300, 330, 352];

/** The palette key for a concept key or, failing that, its icon. */
export function tintKey(tint?: string, icon?: LucideIcon): string {
  if (tint && (TINT_HUE[tint] !== undefined || QUIET.has(tint))) return tint;
  return (icon && ICON_TINT.get(icon)) || tint || (icon as { displayName?: string } | undefined)?.displayName || "";
}
export function tintColor(key: string, fallback?: number): string {
  if (QUIET.has(key)) return "oklch(0.6 0.03 250)";
  let hue = TINT_HUE[key] ?? fallback;
  if (hue === undefined) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    hue = SPREAD[h % SPREAD.length];
  }
  return `oklch(0.62 0.15 ${hue})`;
}

/**
 * A lucide icon in its concept's color. `tint` names the concept (falls back
 * to the icon's own); `color` overrides it (a domain's color). Square (22px
 * tile) by default; `square={false}` is the bare tinted icon; `lg` is the 36px
 * page-header tile.
 */
export function TintIcon({ icon: Icon, tint, color, square = true, size, lg = false, className = "" }: {
  icon: LucideIcon; tint?: string; color?: string; square?: boolean; size?: number; lg?: boolean; className?: string;
}) {
  const style = { "--tint": color ?? tintColor(tintKey(tint, Icon)) } as CSSProperties;
  if (!square) return <Icon className={`tint-ic ${className}`} style={style} width={size ?? 14} height={size ?? 14} strokeWidth={2.1} aria-hidden />;
  return <span className={`${lg ? "tint-sq tint-sq-lg" : "tint-sq"} ${className}`} style={style} aria-hidden><Icon strokeWidth={lg ? 2 : 2.1} /></span>;
}
