// Work mode: the operational hub. Every operational surface lives here, out
// of the Editor:
//   Home group: Inbox, Apps, Insights (Intent), Recommendations
//   Work group: Tasks, Compass (purpose, values, rules and goals; domain
//               goals; the ideals), Decisions
//   Missions:   its own sidebar section (MISSIONS), the Missions page
// There is no separate Work nav column: the nav (WORK_NAV) lives in the shared
// app sidebar; this panel renders the active section, driven by
// "prevail:work-section" (and the jumpTo prop).
import { useEffect, useState } from "react";
import { BoardPanel } from "./boardpanel";
import { InboxPage } from "./inboxpage";
import { AppsPage } from "./appstack";
import { RecommendationsPanel } from "./recommendationspanel";
import { ScrollPage } from "./sectionutil";
import { MirrorPanel } from "./mirror";
import { CompassPage } from "./compasspage";
import { GroupPage } from "./iapage";
import { DecisionsPage } from "./decisionspage";
import { SpecialistsPage } from "./specialistspage";
import { PlaybooksPage } from "./playbookspage";
import { workSection } from "./navdefs";
import type { CliInfo } from "./types";

export type WorkSection = "task-list" | "inbox" | "apps" | "recommendations" | "insights" | "missions" | "entities" | "activities" | "compass" | "decisions" | "specialists" | "playbooks";
// Insights is a view of the Intent screen. Its remembered view is set before
// it mounts, so the row you clicked is the view you land on.
const INTENT_VIEW: Partial<Record<WorkSection, string>> = { insights: "noticed" };
export function normalizeWorkSection(s: string): WorkSection | null {
  return workSection(s) as WorkSection | null;
}
// Sections that lay out their own columns (a SideSpine page).
const FLUSH: WorkSection[] = ["recommendations", "inbox", "apps", "insights", "missions", "entities", "activities", "compass", "task-list", "decisions", "specialists", "playbooks"];

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
    (jumpTo?.section && normalizeWorkSection(jumpTo.section)) || "task-list",
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
  const intentView = INTENT_VIEW[section];
  if (intentView) { try { localStorage.setItem("prevail.mirror.view", intentView); } catch { /* storage off */ } }

  return (
    <ScrollPage key={section} testId="work-page" flush={FLUSH.includes(section)}>
        {section === "task-list" && <BoardPanel vaultPath={vaultPath} clis={clis} />}
        {section === "inbox" && <InboxPage vaultPath={vaultPath} />}
        {section === "apps" && <AppsPage vaultPath={vaultPath} />}
        {section === "recommendations" && <RecommendationsPanel vaultPath={vaultPath} />}
        {intentView && <MirrorPanel key={`${section}:${jumpTo?.n ?? 0}`} vaultPath={vaultPath} />}
        {section === "compass" && <CompassPage vaultPath={vaultPath} />}
        {section === "missions" && <GroupPage vaultPath={vaultPath} group="activities" initial="projects" />}
        {section === "entities" && <GroupPage vaultPath={vaultPath} group="entities" />}
        {section === "activities" && <GroupPage vaultPath={vaultPath} group="activities" />}
        {section === "decisions" && <DecisionsPage vaultPath={vaultPath} />}
        {section === "specialists" && <SpecialistsPage vaultPath={vaultPath} />}
        {section === "playbooks" && <PlaybooksPage vaultPath={vaultPath} />}
    </ScrollPage>
  );
}
