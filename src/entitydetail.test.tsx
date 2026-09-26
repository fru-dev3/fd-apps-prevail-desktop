// The Entities view (list and in-page detail) and entity chips opening it,
// with the engine mocked at the bridge. Names here are invented.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: () => Promise.resolve() }));

const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
const SAM = {
  found: true, id: "person/sam-rivera", name: "Sam Rivera", kind: "person", aliases: ["Sam"], kinds: ["person"],
  mention_count: 2, conversations: 2, last_ts: Date.parse("2026-09-19T10:00:00Z"),
  mentions: [
    { source: "prompt", ref: "abc", domain: "home", project: "maple", title: "Maple St rental", tool: "claude", ts: Date.parse("2026-09-19T10:00:00Z"), snippet: "Draft a note to Sam Rivera about the roof" },
    { source: "thread", ref: "data/domains/home/memory/threads/t1.md", domain: "home", project: "", title: "Lease questions", ts: Date.parse("2026-09-18T10:00:00Z"), snippet: "Ask Sam about Maple St." },
  ],
  co_mentions: [{ id: "place/maple-st", name: "Maple St", kind: "place", count: 2 }],
  page_path: "data/entities/people/sam-rivera.md", saved: false, digest: "You asked Sam about the roof.", notes: "Prefers text.",
};
const LIST = {
  generated_ts: 1, total: 3, entities: [
    { id: "person/sam-rivera", name: "Sam Rivera", kind: "person", aliases: ["Sam"], mention_count: 2, conversations: 2, last_ts: 2, saved: false, has_page: true },
    { id: "place/maple-st", name: "Maple St", kind: "place", aliases: [], mention_count: 2, conversations: 2, last_ts: 2, saved: false, has_page: false },
    { id: "org/acme", name: "acme", kind: "org", aliases: [], mention_count: 1, conversations: 1, last_ts: 1, saved: true, has_page: true },
  ],
};

vi.mock("./bridge", () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "entities_show") return String(args?.id).startsWith("person/") ? SAM : { found: false, query: args?.id };
    if (cmd === "entities_save") return { ...SAM, saved: true };
    if (cmd === "entities_note") return { ...SAM, notes: String(args?.text) };
    if (cmd === "entities_list") return LIST;
    if (cmd === "app_favicon") return "";
    throw new Error(`unexpected ${cmd}`);
  },
}));
let phone = false;
vi.mock("./useisphone", () => ({ useIsPhone: () => phone, PHONE_MAX_PX: 767 }));

import { EntitiesView } from "./entitiesview";
import { openEntity } from "./entities";
import { __setEntityListForTest } from "./entitystore";

beforeEach(() => { cleanup(); calls.length = 0; localStorage.clear(); phone = false; act(() => __setEntityListForTest(null, null)); });

async function openOn(kind: string, value: string) {
  render(<EntitiesView vaultPath="/v" />);
  await screen.findAllByTestId("entity-row");
  act(() => openEntity({ kind: kind as "person", value }));
}

describe("entity chips open the Entities view", () => {
  it("navigates to the Entities section when no view is on screen, and the view opens on that entity", async () => {
    const nav: unknown[] = [];
    const on = (e: Event) => nav.push((e as CustomEvent).detail);
    window.addEventListener("prevail:open-settings", on);
    act(() => openEntity({ kind: "place", value: "Maple St" }));
    window.removeEventListener("prevail:open-settings", on);
    expect(nav).toEqual(["entities"]);
    render(<EntitiesView vaultPath="/v" />);
    await screen.findByText("No conversations mention it yet.");
    expect(calls.find((c) => c.cmd === "entities_show")?.args).toEqual({ vault: "/v", id: "place/Maple St" });
    expect(screen.getByRole("heading", { name: "Maple St", level: 2 })).toBeTruthy();
  });

  it("selects in place, with no side card, drawer or dialog, when the view is already open", async () => {
    await openOn("person", "Sam Rivera");
    const nav: unknown[] = [];
    const on = (e: Event) => nav.push((e as CustomEvent).detail);
    window.addEventListener("prevail:open-settings", on);
    act(() => openEntity({ kind: "person", value: "Sam Rivera" }));
    window.removeEventListener("prevail:open-settings", on);
    expect(nav).toEqual([]);
    await screen.findByText("You asked Sam about the roof.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("entity-card")).toBeNull();
    const detail = screen.getByTestId("entity-detail");
    expect(detail.closest("[data-testid=spine-detail]")).not.toBeNull();
    const row = screen.getAllByTestId("entity-row").find((r) => r.textContent?.includes("Sam Rivera"))!;
    expect(row.getAttribute("aria-current")).toBe("true");
  });
});

describe("entity detail", () => {
  it("shows the digest, notes, mentions and co-mentions", async () => {
    await openOn("person", "Sam Rivera");
    await screen.findByText("You asked Sam about the roof.");
    expect(calls.filter((c) => c.cmd === "entities_show").pop()?.args).toEqual({ vault: "/v", id: "person/Sam Rivera" });
    expect(screen.getByRole("heading", { name: "Sam Rivera", level: 2 })).toBeTruthy();
    expect((screen.getByLabelText("Your notes") as HTMLTextAreaElement).value).toBe("Prefers text.");
    expect(screen.getAllByTestId("entity-mention")).toHaveLength(2);
    const chip = within(screen.getByTestId("entity-detail")).getByText("Maple St");
    expect(chip.closest("[data-entity]")?.getAttribute("data-entity")).toBe("place");
    expect(screen.getByText("data/entities/people/sam-rivera.md")).toBeTruthy();
  });

  it("saves to the vault and writes only the notes", async () => {
    await openOn("person", "Sam Rivera");
    await screen.findByText("You asked Sam about the roof.");
    fireEvent.click(screen.getByRole("button", { name: /save to vault/i }));
    await waitFor(() => expect(screen.getAllByText("Saved").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Your notes"), { target: { value: "Call after 5." } });
    fireEvent.click(screen.getByRole("button", { name: /save notes/i }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "entities_note")).toBe(true));
    expect(calls.find((c) => c.cmd === "entities_note")?.args).toMatchObject({ vault: "/v", id: "person/sam-rivera", text: "Call after 5." });
  });

  it("opens a prompt mention on the Intent history and a thread in its domain", async () => {
    const seen: string[] = [];
    const on = (e: Event) => seen.push(`${e.type}:${JSON.stringify((e as CustomEvent).detail)}`);
    await openOn("person", "Sam Rivera");
    await screen.findByText("You asked Sam about the roof.");
    for (const n of ["prevail:open-settings", "prevail:open-thread"]) window.addEventListener(n, on);
    fireEvent.click(screen.getAllByTestId("entity-mention")[0]);
    expect(localStorage.getItem("prevail.intent.focus")).toBe(String(SAM.mentions[0].ts));
    fireEvent.click(screen.getAllByTestId("entity-mention")[1]);
    for (const n of ["prevail:open-settings", "prevail:open-thread"]) window.removeEventListener(n, on);
    expect(seen).toEqual(['prevail:open-settings:"intent"', 'prevail:open-thread:{"domain":"home","ref":"data/domains/home/memory/threads/t1.md"}']);
  });

  it("seeds a new chat with the entity context", async () => {
    const seeds: string[] = [];
    const on = (e: Event) => seeds.push(String((e as CustomEvent).detail));
    window.addEventListener("prevail:compose-seed", on);
    await openOn("person", "Sam Rivera");
    await screen.findByText("You asked Sam about the roof.");
    fireEvent.click(screen.getByRole("button", { name: /ask about it/i }));
    window.removeEventListener("prevail:compose-seed", on);
    expect(seeds[0]).toContain("[Sam Rivera](prevail://person/sam-rivera)");
    expect(seeds[0]).toContain("My notes: Prefers text.");
  });

  it("an unknown place still gets a detail with a map and Save", async () => {
    await openOn("place", "Maple St");
    await screen.findByText("No conversations mention it yet.");
    expect(screen.getByTestId("entity-map")).toBeTruthy();
    expect(screen.getByRole("button", { name: /open map/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /save to vault/i })).toBeTruthy();
  });
});

describe("Entities view", () => {
  it("groups by kind, filters and searches, and opens on the most discussed", async () => {
    render(<EntitiesView vaultPath="/v2" />);
    await screen.findByRole("heading", { name: /people/i });
    expect(screen.getByRole("heading", { name: /places/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^companies/i })).toBeTruthy();
    await screen.findByText("You asked Sam about the roof.");
    // The list lives in the canonical SideSpine, and the vault marker is the
    // green ok token, never the accent.
    expect(screen.getByTestId("entities-list").hasAttribute("data-spine-column")).toBe(true);
    const dots = Array.from(document.querySelectorAll("[data-vault-dot]"));
    expect(dots.length).toBeGreaterThan(0);
    for (const dot of dots) {
      expect(dot.className).toMatch(/\bbg-ok\b/);
      expect(dot.className).not.toMatch(/\bbg-accent\b/);
    }
    fireEvent.change(screen.getByLabelText("Search entities"), { target: { value: "map" } });
    expect(screen.getAllByTestId("entity-row")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Search entities"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("tab", { name: "Companies" }));
    expect(screen.getAllByTestId("entity-row").map((r) => r.textContent)).toEqual([expect.stringContaining("acme")]);
    fireEvent.click(screen.getAllByTestId("entity-row")[0]);
    await waitFor(() => expect(calls.filter((c) => c.cmd === "entities_show").pop()?.args).toEqual({ vault: "/v2", id: "org/acme" }));
  });

  it("keeps the page header in view and the content in one column", async () => {
    await openOn("person", "Sam Rivera");
    await screen.findByText("You asked Sam about the roof.");
    expect(screen.getByTestId("page-header").className).toMatch(/\bsticky\b/);
    expect(document.body.innerHTML).not.toMatch(/grid-cols-[2-9]|columns-[2-9]/);
  });

  it("the list collapses like the other sidebars", async () => {
    render(<EntitiesView vaultPath="/v" />);
    await screen.findAllByTestId("entity-row");
    fireEvent.click(screen.getByRole("button", { name: "Collapse entities" }));
    expect(screen.getByTestId("spine-collapsed")).toBeTruthy();
    expect(localStorage.getItem("prevail.entities.spine")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Show entities" }));
    expect(screen.getAllByTestId("entity-row").length).toBe(3);
  });

  it("on a phone: the list, then the detail with a way back", async () => {
    phone = true;
    render(<EntitiesView vaultPath="/v" />);
    await screen.findAllByTestId("entity-row");
    expect(screen.queryByTestId("entity-detail")).toBeNull();
    fireEvent.click(screen.getAllByTestId("entity-row")[0]);
    await screen.findByTestId("entity-detail");
    fireEvent.click(screen.getByRole("button", { name: "All entities" }));
    expect(screen.getAllByTestId("entity-row").length).toBe(3);
  });
});
