import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("./bridge", () => ({
  isBrowser: () => true,
  invoke: async (cmd: string) => {
    if (cmd === "work_count") return { open: 7, overdue: 0, today: 0 };
    if (cmd === "projects_index") return { projects: [{}, {}, {}] };
    if (cmd === "engine_list_archived") return ["old-stuff"];
    return null;
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: async () => false }));

import { Sidebar } from "./sidebar";
import type { Domain, TabId } from "./types";

const domains = [{ name: "health", path: "/v/health" }, { name: "wealth", path: "/v/wealth" }] as unknown as Domain[];

function renderSidebar(tab: TabId = "chat", setTab = vi.fn()) {
  return render(
    <Sidebar collapsed={false} setCollapsed={() => {}} vaultPath="/v" domains={domains} vaultError={null}
      selectedDomain="" setSelectedDomain={() => {}} openInFinder={() => {}} tab={tab} setTab={setTab}
      onDomainCreated={() => {}} runningDomains={new Set()} finishedDomains={new Set()} domainStats={{}}
      railWidth={280} onOpenOnboarding={() => {}} onDomainsChanged={() => {}} inboxCount={4} />,
  );
}

afterEach(cleanup);

describe("Sidebar", () => {
  it("lists the home surfaces, work screens and domains with real counts", async () => {
    renderSidebar();
    for (const label of ["Home", "Inbox", "Insights", "Spark", "Automations", "Calendar", "Notes", "Work board", "Projects", "Tasks", "Goals"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label}`) })).toBeTruthy();
    }
    expect(screen.getByTestId("nav-inbox").textContent).toContain("4");
    expect(await screen.findByText("7")).toBeTruthy();
    expect(await screen.findByText("3")).toBeTruthy();
    expect(screen.getByTestId("nav-home").getAttribute("aria-current")).toBe("page");
    expect(await screen.findByText("Archived")).toBeTruthy();
  });

  it("has no Source Map and no Apps list", () => {
    renderSidebar();
    expect(screen.queryByText(/Source Map/)).toBeNull();
    expect(screen.queryByText(/^Apps$/)).toBeNull();
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
