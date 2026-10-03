// The information architecture (ia-plan.md, IA0): two groups, six kinds.
//   Entities:   People, Places, Products, Things
//   Activities: Events, Projects
// The engine's registry (`prevail entities kinds`) is the same list; this is
// the desktop's copy with real icon components, plus the one way every
// surface opens a kind or an object, so the sidebar, chips, the @ picker and
// search all speak the same words with the same icons.
import { CalendarDays, FolderKanban, MapPin, Package, Users, Watch, type LucideIcon } from "lucide-react";

export type Group = "entities" | "activities";
export type KindId = "people" | "places" | "products" | "things" | "events" | "projects";
export interface KindDef { id: KindId; group: Group; label: string; singular: string; icon: LucideIcon; prefix: string }

export const GROUP_LABEL: Record<Group, string> = { entities: "Entities", activities: "Activities" };
export const KINDS: KindDef[] = [
  { id: "people", group: "entities", label: "People", singular: "Person", icon: Users, prefix: "person" },
  { id: "places", group: "entities", label: "Places", singular: "Place", icon: MapPin, prefix: "place" },
  { id: "products", group: "entities", label: "Products", singular: "Product", icon: Package, prefix: "org" },
  { id: "things", group: "entities", label: "Things", singular: "Thing", icon: Watch, prefix: "thing" },
  { id: "events", group: "activities", label: "Events", singular: "Event", icon: CalendarDays, prefix: "event" },
  { id: "projects", group: "activities", label: "Projects", singular: "Project", icon: FolderKanban, prefix: "mission" },
];
export const kindsOf = (g: Group) => KINDS.filter((k) => k.group === g);
export const kindDef = (id: KindId) => KINDS.find((k) => k.id === id)!;

/** The kind an id or an entity kind belongs to: person/, org/, app/, event/, mission/, project/ ... */
export function kindOfId(idOrKind: string): KindDef | null {
  const head = idOrKind.split("/")[0]!.toLowerCase();
  const p = head === "app" ? "org" : head === "project" ? "mission" : head;
  return KINDS.find((k) => k.prefix === p || k.id === p) ?? null;
}

/** The entity kind name an Entities tab lists (the engine's kind). */
export const ENTITY_KIND_OF: Partial<Record<KindId, "person" | "place" | "org" | "thing" | "event">> = { people: "person", places: "place", products: "org", things: "thing", events: "event" };

// Which kind a page shows, remembered across the mount (the sidebar and a
// chip set it before the page exists) and announced when the page is up.
const KIND_KEY = "prevail.ia.kind";
export const IA_KIND_EVENT = "prevail:ia-kind";
/** Section ids that open a kind: each kind's id, plus the old ones. */
const SECTION_KIND: Record<string, KindId> = {
  people: "people", places: "places", products: "products", things: "things", events: "events", projects: "projects",
  missions: "projects", companies: "products", orgs: "products",
};
export function noteIaKind(section: string): void {
  const k = SECTION_KIND[section];
  if (!k) return;
  try { localStorage.setItem(KIND_KEY, k); } catch { /* storage off */ }
  window.dispatchEvent(new CustomEvent(IA_KIND_EVENT, { detail: k }));
}
export function takeIaKind(group: Group): KindId | null {
  try {
    const k = localStorage.getItem(KIND_KEY) as KindId | null;
    if (k && kindDef(k)?.group === group) { localStorage.removeItem(KIND_KEY); return k; }
  } catch { /* storage off */ }
  return null;
}
/** The work section a kind lives on. */
export const sectionOfKind = (k: KindId) => (k === "projects" ? "missions" : kindDef(k).group);

/** Open a kind's page (its tab on Entities or Activities). */
export function openKind(k: KindId): void {
  noteIaKind(k);
  window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: sectionOfKind(k) }));
}

/** Start a new object of a kind: its page opens on a conversation. */
export const NEW_KEY = "prevail.ia.new";
export function newOfKind(k: KindId): void {
  if (k === "projects") {
    try { localStorage.setItem("prevail.missions.focus", "new"); } catch { /* storage off */ }
    window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "missions" }));
    window.dispatchEvent(new CustomEvent("prevail:missions-focus", { detail: "new" }));
    return;
  }
  try { localStorage.setItem(NEW_KEY, k); } catch { /* storage off */ }
  openKind(k);
  window.dispatchEvent(new CustomEvent("prevail:ia-new", { detail: k }));
}
export function takeNew(k: KindId): boolean {
  try { if (localStorage.getItem(NEW_KEY) === k) { localStorage.removeItem(NEW_KEY); return true; } } catch { /* storage off */ }
  return false;
}

// Engine shapes (ia.ts in the engine).
export interface AppRecord { id: string; title: string; kind?: string; category?: string; domains: string[] }
export interface ProductRow {
  id: string; name: string; company: boolean; apps: AppRecord[];
  website?: string; domain?: string; picture?: string;
  saved: boolean; has_page: boolean; conversations: number; last_ts: number;
  relation: "yours" | "reference"; home_domain?: string;
}
export interface LinkView { id: string; name: string; kind: KindId; via: "link" | "field" | "project"; role?: string }
export type EventSource = "prevail" | "calendar" | "milestone" | "hold";
export interface EventRow {
  id: string; name: string; date: string; end?: string; time?: string; source: EventSource; has_page: boolean;
  project?: { id: string; name: string }; place?: { id: string; name: string };
  calendar?: "ask" | "synced" | "declined"; account?: string; url?: string; done?: boolean;
}
export interface ServiceEntry { date: string; what: string; cost?: number }
export interface ObjectFields {
  date?: string; end?: string; time?: string; people?: string[]; project?: string; calendar?: "ask" | "synced" | "declined"; calendar_event?: string; milestone?: string;
  purchased?: string; warranty?: string; value?: number; maker?: string; service?: ServiceEntry[]; place?: string;
}

/** "2026-12-25" as "Dec 25" (this year) or "Dec 25, 2027". */
export function fmtDay(ymd?: string): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return "";
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString(undefined, d.getFullYear() === new Date().getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}
export const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
