// The in-flow Context view: a SideSpine of sections on the left, the picked
// section in the detail pane, a way back to chat, and every drawer action kept.
// The engine is mocked at the bridge; all data here is invented.
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: () => Promise.resolve() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: () => Promise.resolve(false) }));

vi.mock("./bridge", () => ({
  invoke: async (cmd: string) => {
    if (cmd === "domain_context") return { state: "Garden beds planted.", journal: "", recent_logs: [], skills: [{ name: "prune", path: "/v/prune", domain: "garden", description: "Prune plan", enabled: true }], layoutV4: true };
    if (cmd === "decisions_read") return [];
    if (cmd === "read_memory_md") return "Tomatoes like sun.";
    if (cmd === "read_ideal_state") return "# Live well";
    if (cmd === "read_domain_ideal") return "A thriving garden.";
    if (cmd === "read_user_md") return "Foo likes plants.";
    if (cmd === "ingestion_list_artifacts") return [];
    return "";
  },
}));

import { DomainContextView } from "./domainpanels";

afterEach(() => { cleanup(); localStorage.clear(); });

function setup(phone = false) {
  const onClose = vi.fn(), onInject = vi.fn(), onSkill = vi.fn();
  const canvas = vi.fn();
  window.addEventListener("prevail:open-canvas", canvas as EventListener);
  render(
    <DomainContextView domain="garden" phone={phone} vaultPath="/v" domainPath="/v/data/domains/garden"
      onClose={onClose} onInjectContext={onInject} onInsertSkill={onSkill} />,
  );
  return { onClose, onInject, onSkill, canvas };
}

describe("DomainContextView", () => {
  it("lists sections in the spine and shows the picked one in-flow", async () => {
    const { onClose, onInject, canvas } = setup();
    expect(screen.getByTestId("context-view")).toBeTruthy();
    expect(screen.getByTestId("context-spine")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("ctx-row-state")).toBeTruthy());
    expect(screen.getByTestId("ctx-detail-ideal")).toBeTruthy();
    fireEvent.click(screen.getByTestId("ctx-row-memory"));
    expect(screen.queryByTestId("ctx-detail-ideal")).toBeNull();
    const detail = screen.getByTestId("ctx-detail-memory");
    fireEvent.click(detail.querySelector('[title^="View"]')!);
    expect(canvas).toHaveBeenCalled();
    fireEvent.click(detail.querySelector('[title^="Use in chat"]')!);
    expect(onInject).toHaveBeenCalledWith("Tomatoes like sun.", "Garden · memory");
    expect(screen.getByRole("status").textContent).toContain("Garden · memory");
    fireEvent.click(screen.getByTitle("Back to chat"));
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps skill insert and profile editing", async () => {
    const { onSkill } = setup();
    await waitFor(() => expect(screen.getByTestId("ctx-row-skills")).toBeTruthy());
    fireEvent.click(screen.getByTestId("ctx-row-skills"));
    fireEvent.click(screen.getByText("/prune"));
    expect(onSkill).toHaveBeenCalledWith("prune");
    fireEvent.click(screen.getByTestId("ctx-row-profile"));
    await waitFor(() => expect(screen.getByText("Edit profile")).toBeTruthy());
    fireEvent.click(screen.getByText("Edit profile"));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Foo likes plants.");
  });

  it("goes list-then-detail on a phone", async () => {
    setup(true);
    await waitFor(() => expect(screen.getByTestId("ctx-row-state")).toBeTruthy());
    expect(screen.queryByTestId("ctx-detail-ideal")).toBeNull();
    fireEvent.click(screen.getByTestId("ctx-row-state"));
    expect(screen.getByTestId("ctx-detail-state")).toBeTruthy();
    fireEvent.click(screen.getByText("All sections"));
    expect(screen.getByTestId("ctx-row-state")).toBeTruthy();
  });
});
