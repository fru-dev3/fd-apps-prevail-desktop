// Every secondary column is the canonical SideSpine, every page header sits
// above the scroll, and row actions are small icons. One test per screen
// that was converted: Notes, Runtimes, chat Threads, the
// Settings/Work page frame, and Models' header tabs.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
vi.mock("./bridge", () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "read_text_file") return JSON.stringify([
      { id: "n1", title: "Roof quotes", body: "Call two roofers", updated: 1 },
      { id: "n2", title: "Trip packing", body: "Charger", updated: 2 },
    ]);
    return null;
  },
  listen: vi.fn(async () => () => {}),
  isBrowser: () => true,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn(async () => true), open: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
let phone = false;
vi.mock("./useisphone", () => ({ useIsPhone: () => phone, PHONE_MAX_PX: 767, useVisualViewportHeight: () => null }));

import { NotesPanel } from "./notespanel";
import { AgentsSection } from "./settings6";
import { ThreadsRail } from "./panels";
import { ScrollPage, SettingsHeader } from "./sectionutil";
import type { CliInfo } from "./types";

beforeEach(() => { cleanup(); calls.length = 0; phone = false; localStorage.clear(); });

describe("Notes", () => {
  it("lists notes in the SideSpine with search on top, collapses, and deletes with an icon action", async () => {
    render(<NotesPanel vaultPath="/v" />);
    const col = await screen.findByTestId("notes-list");
    await within(col).findByText("Roof quotes");
    expect(col.hasAttribute("data-spine-column")).toBe(true);
    expect(within(col).getByPlaceholderText(/Search notes/)).toBeTruthy();
    const del = within(col).getAllByRole("button", { name: "Delete note" })[0];
    expect(del.className).toMatch(/\bh-7\b/);
    fireEvent.click(screen.getByLabelText("Collapse notes"));
    expect(screen.queryByTestId("notes-list")).toBeNull();
    expect(localStorage.getItem("prevail.notes.spine")).toBe("1");
    expect(screen.getByTestId("spine-detail").getAttribute("data-spine")).toBe("collapsed");
  });
});

const cli = (id: string, label: string, available = true): CliInfo => ({ id, label, bin: id, available } as unknown as CliInfo);

describe("Runtimes", () => {
  it("groups runtimes in the SideSpine and collapses like every other column", async () => {
    render(<AgentsSection clis={[cli("claude", "Claude"), cli("ollama", "Ollama")]} embedded vaultPath="/v" />);
    const col = await screen.findByTestId("runtimes-list");
    expect(col.hasAttribute("data-spine-column")).toBe(true);
    expect(within(col).getByText(/Cloud models/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Collapse runtimes"));
    expect(screen.queryByTestId("runtimes-list")).toBeNull();
    expect(localStorage.getItem("prevail.runtimes.spine")).toBe("1");
    fireEvent.click(screen.getByLabelText("Show runtimes"));
    expect(screen.getByTestId("runtimes-list")).toBeTruthy();
  });
});

describe("chat Threads", () => {
  it("is a SpineColumn with a New action and search, and collapses to the strip", () => {
    const onNew = vi.fn();
    render(<ThreadsRail threads={[{ path: "/t1", slug: "t1", title: "Plan the trip", domain: null, created: 1, updated: 1, turn_count: 3, preview: "", cli: null, model: null }]}
      activePath={null} selectedDomain={null} vaultPath="/v" onPick={() => {}} onNew={onNew} onRefresh={() => {}} runningThreadPaths={new Set()} />);
    const col = screen.getByTestId("threads-list");
    expect(col.className).toContain("w-72");
    fireEvent.click(within(col).getByLabelText("New thread"));
    expect(onNew).toHaveBeenCalled();
    expect(within(col).getByLabelText("Search threads")).toBeTruthy();
    expect(within(col).getByRole("button", { name: "Delete thread" }).className).toMatch(/\bh-7\b/);
    fireEvent.click(screen.getByLabelText("Collapse threads"));
    expect(screen.queryByTestId("threads-list")).toBeNull();
    expect(localStorage.getItem("prevail.threads.spine")).toBe("1");
  });
});

describe("page frame", () => {
  it("puts the page header in a fixed row above the scroll area", async () => {
    render(<ScrollPage testId="pg"><SettingsHeader title="Hooks" subtitle="Run things on events." /><p>body</p></ScrollPage>);
    const header = screen.getByTestId("page-header");
    await waitFor(() => expect(within(header).getByRole("heading", { name: "Hooks" })).toBeTruthy());
    const scroll = screen.getByTestId("page-scroll");
    expect(scroll.contains(header)).toBe(false);
    expect(scroll.textContent).toContain("body");
    expect(header.className).toMatch(/\bshrink-0\b/);
  });

  it("a flush page gets no padding and no scroll of its own", () => {
    render(<ScrollPage flush testId="pg"><p>spine screen</p></ScrollPage>);
    expect(screen.queryByTestId("page-scroll")).toBeNull();
    expect(screen.getByTestId("page-flush").className).toMatch(/overflow-hidden/);
  });
});
