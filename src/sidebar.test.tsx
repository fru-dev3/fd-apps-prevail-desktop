import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("./bridge", () => ({
  isBrowser: () => true,
  invoke: async (cmd: string) => {
    if (cmd === "work_count") return { open: 7, overdue: 0, today: 0 };
    if (cmd === "projects_index") return { projects: [{}, {}, {}] };
    if (cmd === "engine_list_archived") return ["old-stuff"];
    if (cmd === "apps_mirror_list") return appsList;
    if (cmd === "engine_waiting") return { total: 4, items: [] };
    return null;
  },
}));
let appsList: unknown = null;
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: async () => false }));

import { Sidebar } from "./sidebar";
import type { Domain, TabId } from "./types";

const domains = [{ name: "health", path: "/v/health" }, { name: "wealth", path: "/v/wealth" }] as unknown as Domain[];

function renderSidebar(tab: TabId = "chat", setTab = vi.fn()) {
  return render(
    <Sidebar collapsed={false} setCollapsed={() => {}} vaultPath="/v" domains={domains} vaultError={null}
      selectedDomain="" setSelectedDomain={() => {}} openInFinder={() => {}} tab={tab} setTab={setTab}
      onDomainCreated={() => {}} runningDomains={new Set()} finishedDomains={new Set()} domainStats={{}}
      railWidth={280} onOpenOnboarding={() => {}} onDomainsChanged={() => {}} />,
  );
}

afterEach(() => { cleanup(); appsList = null; });

describe("Sidebar", () => {
  it("lists the home surfaces, work screens and domains with real counts", async () => {
    renderSidebar();
    for (const label of ["Home", "Inbox", "Insights", "Recommendations", "Projects", "Tasks", "Goals"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label}`) })).toBeTruthy();
    }
    // The Inbox row carries the shared waiting count, in the accent colour.
    await waitFor(() => expect(screen.getByTestId("nav-inbox").textContent).toContain("4"));
    expect(screen.getByTestId("nav-inbox").querySelector(".bg-accent")).toBeTruthy();
    expect(await screen.findByText("7")).toBeTruthy();
    expect(await screen.findByText("3")).toBeTruthy();
    expect(screen.getByTestId("nav-home").getAttribute("aria-current")).toBe("page");
    expect(await screen.findByText("Archived")).toBeTruthy();
  });

  it("has none of the removed screens, and no Apps section without apps", () => {
    renderSidebar();
    for (const gone of [/Source Map/, /^Spark$/, /^Automations$/, /^Calendar$/, /^Notes$/, /Work board/]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    expect(screen.queryByText(/^Apps$/)).toBeNull();
  });

  it("lists your apps, marks one that needs sign-in, and opens the Apps page with it picked", async () => {
    appsList = { generated_at: 1, runtimes: [], apps: [
      { id: "claude:foo", name: "Foo", runtime: "claude", server: "foo", status: "connected", signin_hint: "", syncable: true, domains: [] },
      { id: "claude:bar", name: "Bar", runtime: "claude", server: "bar", status: "needs_auth", signin_hint: "", syncable: true, domains: [] },
    ] };
    const sections: string[] = [];
    const picks: string[] = [];
    const onSection = (e: Event) => sections.push((e as CustomEvent<string>).detail);
    const onPick = (e: Event) => picks.push((e as CustomEvent<string>).detail);
    window.addEventListener("prevail:work-section", onSection);
    window.addEventListener("prevail:mirror-select", onPick);
    renderSidebar();
    const foo = await screen.findByTestId("sidebar-app-claude:foo");
    expect(screen.getByText("Apps")).toBeTruthy();
    expect(foo.querySelector("[data-testid=app-signin-dot]")).toBeNull();
    expect(screen.getByTestId("sidebar-app-claude:bar").querySelector("[data-testid=app-signin-dot]")).toBeTruthy();
    fireEvent.click(foo);
    window.removeEventListener("prevail:work-section", onSection);
    window.removeEventListener("prevail:mirror-select", onPick);
    expect(sections).toEqual(["apps"]);
    expect(picks).toEqual(["claude:foo"]);
    expect(sessionStorage.getItem("prevail.apps.mirror.select")).toBe("claude:foo");
    // The header folds the list away, and the choice is remembered.
    fireEvent.click(screen.getByText("Apps"));
    expect(screen.queryByTestId("sidebar-apps")).toBeNull();
    expect(localStorage.getItem("prevail.sidebar.appsOpen")).toBe("0");
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
