// Work mode: the operational hub. Every operational surface lives here, out
// of the Editor:
//   Home group: Inbox, Insights (Intent), Recommendations, Spark, Automations,
//               Calendar, Notes
//   Work group: Work board, Projects (Intent's Projects view), Tasks (the
//               board's list view), Goals (the ideal-state constitution)
// There is no separate Work nav column: the nav (WORK_NAV) lives in the shared
// app sidebar; this panel renders the active section, driven by
// "prevail:work-section" (and the jumpTo prop).
import { useEffect, useState } from "react";
import { BoardPanel } from "./boardpanel";
import { RecommendationsPanel } from "./recommendationspanel";
import { SparkPanel } from "./spark";
import { LoopBoard } from "./loopboard";
import { CalendarView } from "./calendarview";
import { NotesPanel } from "./notespanel";
import { MirrorPanel } from "./mirror";
import { IdealStateSection } from "./settings4";
import type { CliInfo } from "./types";

export type WorkSection = "tasks" | "task-list" | "inbox" | "recommendations" | "spark" | "automations" | "calendar" | "notes" | "insights" | "projects" | "goals";
export const WORK_SECTIONS: WorkSection[] = ["tasks", "task-list", "inbox", "recommendations", "spark", "automations", "calendar", "notes", "insights", "projects", "goals"];
// Three sidebar rows open the same board in different views.
const BOARD_VIEW: Partial<Record<WorkSection, string>> = { tasks: "board", "task-list": "list", inbox: "needs" };
// Insights and Projects are two views of the Intent screen. Its remembered view
// is set before it mounts, so the row you clicked is the view you land on.
const INTENT_VIEW: Partial<Record<WorkSection, string>> = { insights: "noticed", projects: "projects" };
// Old Settings section names that now live in Work mode (deep-link compatibility):
// "loopboard" was the LoopBoard's id under Settings; it is now "automations".
const SECTION_ALIASES: Record<string, WorkSection> = { loopboard: "automations" };
export function normalizeWorkSection(s: string): WorkSection | null {
  if ((WORK_SECTIONS as string[]).includes(s)) return s as WorkSection;
  return SECTION_ALIASES[s] ?? null;
}

export function WorkPanel({
  vaultPath,
  clis,
  jumpTo,
}: {
  vaultPath: string;
  clis: CliInfo[];
  jumpTo?: { section: string; n: number } | null;
}) {
  const [section, setSection] = useState<WorkSection>(
    (jumpTo?.section && normalizeWorkSection(jumpTo.section)) || "tasks",
  );
  useEffect(() => {
    const norm = jumpTo?.section && normalizeWorkSection(jumpTo.section);
    if (norm) setSection(norm);
  }, [jumpTo?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // The shared sidebar drives section changes via this event.
  useEffect(() => {
    const onSection = (e: Event) => {
      const norm = normalizeWorkSection((e as CustomEvent<string>).detail || "");
      if (norm) setSection(norm);
    };
    window.addEventListener("prevail:work-section", onSection as EventListener);
    return () => window.removeEventListener("prevail:work-section", onSection as EventListener);
  }, []);
  // The board listens for this; children's effects run first, so a freshly
  // mounted board is already listening.
  const boardView = BOARD_VIEW[section];
  useEffect(() => {
    if (boardView) window.dispatchEvent(new CustomEvent("prevail:board-view", { detail: boardView }));
  }, [section, jumpTo?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const intentView = INTENT_VIEW[section];
  if (intentView) { try { localStorage.setItem("prevail.mirror.view", intentView); } catch { /* storage off */ } }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="w-full px-8 py-10">
        {boardView && <BoardPanel vaultPath={vaultPath} clis={clis} />}
        {section === "recommendations" && <RecommendationsPanel vaultPath={vaultPath} />}
        {section === "spark" && <SparkPanel vaultPath={vaultPath} clis={clis} />}
        {section === "automations" && <LoopBoard vaultPath={vaultPath} />}
        {section === "calendar" && <CalendarView vaultPath={vaultPath} />}
        {section === "notes" && <NotesPanel vaultPath={vaultPath} />}
        {intentView && <div className="-mx-8 -my-10 max-md:-mx-4 max-md:-my-5"><MirrorPanel key={`${section}:${jumpTo?.n ?? 0}`} vaultPath={vaultPath} /></div>}
        {section === "goals" && <IdealStateSection vaultPath={vaultPath} />}
      </div>
    </div>
  );
}
