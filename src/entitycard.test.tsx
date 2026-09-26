// The entity card and the Entities view, with the engine mocked at the bridge.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
    { id: "org/acme", name: "acme", kind: "org", aliases: [], mention_count: 1, conversations: 1, last_ts: 1, saved: false, has_page: false },
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
vi.mock("./useisphone", () => ({ useIsPhone: () => false, PHONE_MAX_PX: 767 }));

import { EntityCardHost } from "./entitycard";
import { EntitiesView } from "./entitiesview";

beforeEach(() => { cleanup(); calls.length = 0; localStorage.clear(); });

function openCard(kind: string, value: string) {
  act(() => { window.dispatchEvent(new CustomEvent("prevail:open-entity", { detail: { kind, value } })); });
}

describe("entity card", () => {
  it("shows the digest, notes, mentions and co-mentions", async () => {
    render(<EntityCardHost vaultPath="/v" />);
    openCard("person", "Sam Rivera");
    await screen.findByText("You asked Sam about the roof.");
    expect(calls.find((c) => c.cmd === "entities_show")?.args).toEqual({ vault: "/v", id: "person/Sam Rivera" });
    expect(screen.getByRole("heading", { name: "Sam Rivera" })).toBeTruthy();
    expect((screen.getByLabelText("Your notes") as HTMLTextAreaElement).value).toBe("Prefers text.");
    expect(screen.getAllByTestId("entity-mention")).toHaveLength(2);
    expect(screen.getByText("Maple St").closest("[data-entity]")?.getAttribute("data-entity")).toBe("place");
    expect(screen.getByText("In your vault", { selector: "span" })).toBeTruthy();
  });

  it("saves to the vault and writes only the notes", async () => {
    render(<EntityCardHost vaultPath="/v" />);
    openCard("person", "Sam Rivera");
    await screen.findByText("You asked Sam about the roof.");
    fireEvent.click(screen.getByRole("button", { name: /save to vault/i }));
    await screen.findByText("Saved");
    fireEvent.change(screen.getByLabelText("Your notes"), { target: { value: "Call after 5." } });
    fireEvent.click(screen.getByRole("button", { name: /save notes/i }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "entities_note")).toBe(true));
    expect(calls.find((c) => c.cmd === "entities_note")?.args).toMatchObject({ vault: "/v", id: "person/sam-rivera", text: "Call after 5." });
  });

  it("opens a prompt mention on the Intent history and a thread in its domain", async () => {
    const seen: string[] = [];
    const on = (e: Event) => seen.push(`${e.type}:${JSON.stringify((e as CustomEvent).detail)}`);
    for (const n of ["prevail:open-settings", "prevail:open-thread"]) window.addEventListener(n, on);
    render(<EntityCardHost vaultPath="/v" />);
    openCard("person", "Sam Rivera");
    await screen.findByText("You asked Sam about the roof.");
    fireEvent.click(screen.getAllByTestId("entity-mention")[0]);
    expect(localStorage.getItem("prevail.intent.focus")).toBe(String(SAM.mentions[0].ts));
    openCard("person", "Sam Rivera");
    await screen.findByText("You asked Sam about the roof.");
    fireEvent.click(screen.getAllByTestId("entity-mention")[1]);
    for (const n of ["prevail:open-settings", "prevail:open-thread"]) window.removeEventListener(n, on);
    expect(seen).toEqual(['prevail:open-settings:"intent"', 'prevail:open-thread:{"domain":"home","ref":"data/domains/home/memory/threads/t1.md"}']);
  });

  it("seeds a new chat with the entity context", async () => {
    const seeds: string[] = [];
    const on = (e: Event) => seeds.push(String((e as CustomEvent).detail));
    window.addEventListener("prevail:compose-seed", on);
    render(<EntityCardHost vaultPath="/v" />);
    openCard("person", "Sam Rivera");
    await screen.findByText("You asked Sam about the roof.");
    fireEvent.click(screen.getByRole("button", { name: /ask about it/i }));
    window.removeEventListener("prevail:compose-seed", on);
    expect(seeds[0]).toContain("[Sam Rivera](prevail://person/sam-rivera)");
    expect(seeds[0]).toContain("My notes: Prefers text.");
    expect(screen.queryByTestId("entity-card")).toBeNull();
  });

  it("an unknown place still gets a card with a map and Save", async () => {
    render(<EntityCardHost vaultPath="/v" />);
    openCard("place", "Maple St");
    await screen.findByText("No conversations mention it yet.");
    expect(screen.getByTestId("entity-map")).toBeTruthy();
    expect(screen.getByRole("button", { name: /open map/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /save to vault/i })).toBeTruthy();
  });
});

describe("Entities view", () => {
  it("groups by kind, filters and searches", async () => {
    render(<EntitiesView vaultPath="/v2" />);
    await screen.findByRole("heading", { name: /people/i });
    expect(screen.getByRole("heading", { name: /places/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /companies and products/i })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search entities"), { target: { value: "map" } });
    expect(screen.getAllByTestId("entity-row")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Search entities"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("tab", { name: "Companies" }));
    expect(screen.getAllByTestId("entity-row").map((r) => r.textContent)).toEqual([expect.stringContaining("acme")]);
  });
});
