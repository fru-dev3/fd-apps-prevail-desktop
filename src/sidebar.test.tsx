import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("./bridge", () => ({
  isBrowser: () => true,
  invoke: async (cmd: string) => {
    if (cmd === "work_count") return { open: 7, overdue: 0, today: 0 };
    if (cmd === "engine_missions_list") return [1, 2, 3, 4].map((i) => ({ slug: `foo-${i}`, id: `mission/foo-${i}`, name: `Foo ${i}`, status: i === 4 ? "paused" : "active", target: `2026-12-0${i}`, domains: [], progress: { days: { day: 1, total: 60, left: 10 * i }, milestones: { done: 0, total: 0 }, budget: { planned: 0, used: 0 } } }));
    if (cmd === "engine_suggest_structure") return structure;
    if (cmd === "engine_list_archived") return ["old-stuff"];
    if (cmd === "apps_mirror_list") return appsList;
    if (cmd === "engine_waiting") return { total: 4, items: [] };
    return null;
  },
}));
let appsList: unknown = null;
let structure: unknown = null;
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: async () => false }));

import { Sidebar } from "./sidebar";
import type { Domain, TabId } from "./types";

const domains = [{ name: "health", path: "/v/health" }, { name: "wealth", path: "/v/wealth" }] as unknown as Domain[];

const OPEN = ["workOpen", "activitiesOpen", "missionsOpen", "appsOpen", "domainsOpen"];
function renderSidebar(tab: TabId = "chat", setTab = vi.fn(), fresh = false) {
  // A new user sees every section collapsed; most tests open them.
  for (const k of OPEN) { if (fresh) localStorage.removeItem(`prevail.sidebar.${k}`); else if (localStorage.getItem(`prevail.sidebar.${k}`) === null) localStorage.setItem(`prevail.sidebar.${k}`, "1"); }
  return render(
    <Sidebar collapsed={false} setCollapsed={() => {}} vaultPath="/v" domains={domains} vaultError={null}
      selectedDomain="" setSelectedDomain={() => {}} openInFinder={() => {}} tab={tab} setTab={setTab}
      onDomainCreated={() => {}} runningDomains={new Set()} finishedDomains={new Set()} domainStats={{}}
      railWidth={280} onOpenOnboarding={() => {}} onDomainsChanged={() => {}} />,
  );
}

afterEach(() => { cleanup(); appsList = null; structure = null; });

describe("Sidebar", () => {
  it("lists the home surfaces, work screens and domains with real counts", async () => {
    renderSidebar();
    for (const label of ["Home", "Inbox", "Insights", "For You", "Tasks", "Compass"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label}(\\s|$)`) })).toBeTruthy();
    }
    // The Inbox row carries the shared waiting count, in the accent colour.
    await waitFor(() => expect(screen.getByTestId("nav-inbox").textContent).toContain("4"));
    expect(screen.getByTestId("nav-inbox").querySelector(".bg-accent")).toBeTruthy();
    expect(await screen.findByText("7")).toBeTruthy();
    // MISSIONS: the active ones with days left, soonest first; paused fold into one row.
    await waitFor(() => expect(screen.getByTestId("sidebar-missions").textContent).toContain("Foo 1"));
    expect(screen.getByTestId("sidebar-mission-foo-1").textContent).toContain("10d");
    expect(screen.getByTestId("sidebar-missions-paused").textContent).toContain("Paused (1)");
    expect(screen.queryByText(/^Missions?$/)).toBeNull();
    expect(screen.getByTestId("nav-home").getAttribute("aria-current")).toBe("page");
    expect(await screen.findByText("Archived")).toBeTruthy();
  });

  it("shows a dot on Domains while a new-domain suggestion waits, which opens Structure", async () => {
    structure = [
      { id: "domain:foo", kind: "domain", title: "Create a Foo domain?", reason: "4 conversations", evidence: [], confidence: 0.8 },
      { id: "archive_domain:bar", kind: "archive_domain", title: "Archive Bar?", reason: "Quiet for a year", evidence: [], confidence: 0.6 },
    ];
    const opened = vi.fn();
    window.addEventListener("prevail:open-settings", opened);
    renderSidebar();
    const dot = await screen.findByTestId("sidebar-dot-domains");
    expect(dot.textContent).toBe("1");
    fireEvent.click(dot);
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toBe("recommendations");
    expect(localStorage.getItem("prevail.recs.category")).toBe("structure");
    window.removeEventListener("prevail:open-settings", opened);
  });

  it("has none of the removed screens, and no Apps section without apps", () => {
    renderSidebar();
    for (const gone of [/Source Map/, /^Spark$/, /^Automations$/, /^Calendar$/, /^Notes$/, /Work board/]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    expect(screen.queryByText(/^Apps$/)).toBeNull();
  });

  it("has no APPS section: apps are Products now, each with its connection on its page", async () => {
    appsList = { generated_at: 1, runtimes: [], apps: [
      { id: "claude:foo", name: "Foo", runtime: "claude", server: "foo", status: "connected", signin_hint: "", syncable: true, domains: [] },
    ] };
    renderSidebar();
    await screen.findByTestId("nav-home");
    expect(screen.queryByTestId("sidebar-apps")).toBeNull();
    expect(screen.queryByTestId("sidebar-head-apps")).toBeNull();
    expect(screen.queryByTestId("sidebar-app-claude:foo")).toBeNull();
  });

  it("every section starts collapsed for a new user; the chevron and + wait for a hover", () => {
    renderSidebar("chat", vi.fn(), true);
    for (const k of ["work", "entities", "activities", "domains"]) {
      const head = screen.getByTestId(`sidebar-head-${k}`);
      expect(head.querySelector("[aria-expanded]")!.getAttribute("aria-expanded")).toBe("false");
      expect(screen.getByTestId(`sidebar-toggle-${k}`).className).toContain("opacity-0");
      expect(screen.getByTestId(`sidebar-toggle-${k}`).className).toContain("group-hover/h:opacity-100");
    }
    expect(screen.getByTestId("sidebar-add-work").className).toContain("[@media(pointer:coarse)]:opacity-100");
    expect(screen.queryByTestId("sidebar-missions")).toBeNull();
    fireEvent.click(screen.getByText("Activities"));
    expect(localStorage.getItem("prevail.sidebar.activitiesOpen")).toBe("1");
    // Each kind is a row; its + and chevron wait for a hover too.
    expect(screen.getByTestId("sidebar-kind-toggle-projects").className).toContain("opacity-0");
    expect(screen.getByTestId("sidebar-kind-add-events").className).toContain("[@media(pointer:coarse)]:opacity-100");
    fireEvent.click(screen.getByTestId("sidebar-kind-toggle-projects"));
    expect(screen.getByTestId("sidebar-missions")).toBeTruthy();
    expect(localStorage.getItem("prevail.sidebar.missionsOpen")).toBe("1");
  });

  it("search opens the command palette and the gear opens settings", () => {
    const setTab = vi.fn();
    const onPalette = vi.fn();
    window.addEventListener("prevail:open-palette", onPalette);
    renderSidebar("chat", setTab);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(onPalette).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(setTab).toHaveBeenCalledWith("settings");
    window.removeEventListener("prevail:open-palette", onPalette);
  });

  it("in settings, shows the configuration nav with a way back Home", () => {
    const setTab = vi.fn();
    renderSidebar("settings", setTab);
    expect(screen.getByRole("button", { name: /Models/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Back to Home/ }));
    expect(setTab).toHaveBeenCalledWith("chat");
  });
});
