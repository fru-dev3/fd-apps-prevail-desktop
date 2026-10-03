// Entities and Activities (ia-plan.md, IA0) on the desktop: the group pages
// with a tab per kind, breadcrumbs, Products as one list, the events strip,
// the calendar question that only the user's click answers, an event becoming
// a project, links both ways and new objects by talking. The engine is mocked
// at the bridge; every name is invented.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: () => Promise.resolve() }));
vi.mock("./useisphone", () => ({ useIsPhone: () => false, useStacked: () => false, PHONE_MAX_PX: 767 }));

const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
let eventFields: Record<string, unknown> = { date: today, time: "18:00", place: "place/foo-house" };
const LIST = { generated_ts: 1, total: 3, entities: [
  { id: "person/sam-foo", name: "Sam Foo", kind: "person", aliases: [], mention_count: 2, conversations: 2, last_ts: 2, saved: true, has_page: true, relation: "yours" },
  { id: "place/foo-house", name: "Foo House", kind: "place", aliases: [], mention_count: 1, conversations: 1, last_ts: 1, saved: true, has_page: true, relation: "yours" },
  { id: "thing/foo-watch", name: "Foo Watch", kind: "thing", aliases: [], mention_count: 1, conversations: 1, last_ts: 1, saved: true, has_page: true, relation: "yours" },
] };
const PRODUCTS = { products: [
  { id: "org/foo-bank", name: "Foo Bank", company: true, apps: [{ id: "foo-bank", title: "Foo Bank", kind: "service", domains: ["foobank.example"] }], saved: true, has_page: true, conversations: 3, last_ts: 3, relation: "yours", domain: "foobank.example" },
  { id: "org/bar-notes", name: "Bar Notes", company: false, apps: [{ id: "bar-notes", title: "Bar Notes", kind: "app", domains: [] }], saved: false, has_page: false, conversations: 0, last_ts: 0, relation: "yours" },
] };
const EVENTS = () => ({ events: [
  { id: "event/foo-dinner", name: "Foo dinner", date: today, time: "18:00", source: "prevail", has_page: true, place: { id: "place/foo-house", name: "Foo House" } },
  { id: "calendar:cal-1", name: "Foo dentist", date: today, source: "calendar", has_page: false, calendar: "synced" },
] });
const show = (id: string) => {
  const [kind, slug] = id.split("/");
  const name = kind === "org" ? (slug === "foo-bank" ? "Foo Bank" : "Bar Notes") : kind === "event" ? (slug === "foo-dentist" ? "Foo dentist" : "Foo dinner") : kind === "thing" ? "Foo Watch" : "Sam Foo";
  return {
    found: true, id: `${kind}/${slug}`, name, kind, aliases: [], kinds: [kind], mention_count: 0, conversations: 0, last_ts: 0, mentions: [], co_mentions: [],
    digest: "", notes: "", saved: true, page_path: `data/entities/x/${slug}/entity.md`,
    fields: kind === "event" ? eventFields : kind === "thing" ? { purchased: "2025-03-01", warranty: "2099-01-01", value: 420, maker: "org/foo-bank" } : {},
    ...(kind === "org" ? { apps: PRODUCTS.products.find((p) => p.id === `org/${slug}`)?.apps ?? [] } : {}),
  };
};

vi.mock("./bridge", () => ({
  isBrowser: () => true,
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "entities_list") return LIST;
    if (cmd === "ia_products") return PRODUCTS;
    if (cmd === "ia_events") return EVENTS();
    if (cmd === "entities_show") return show(String(args?.id));
    if (cmd === "ia_event_adopt") return { ok: true, id: "event/foo-dentist", created: true };
    if (cmd === "ia_event_calendar") { eventFields = { ...eventFields, calendar: args?.answer === "yes" ? "synced" : args?.answer === "no" ? "declined" : "ask" }; return { ok: true, calendar: eventFields.calendar }; }
    if (cmd === "ia_event_project") { eventFields = { ...eventFields, project: "mission/plan-foo-dinner" }; return { ok: true, project: { id: "mission/plan-foo-dinner", name: "Plan Foo dinner" }, created: true }; }
    if (cmd === "ia_links") return { id: args?.id, links: [
      { id: "person/sam-foo", name: "Sam Foo", kind: "people", via: "link" },
      { id: "place/foo-house", name: "Foo House", kind: "places", via: "field", role: "place" },
    ] };
    if (cmd === "ia_link") return { ok: true };
    if (cmd === "ia_set_field") return { ok: true };
    if (cmd === "ia_draft") return { draft: { name: "Foo party", date: today }, filled: ["name", "date"], reply: "Got it. Say save to keep it.", ready: true, missing: [], go: false };
    if (cmd === "ia_create") return { ok: true, id: "event/foo-party" };
    if (cmd === "engine_missions_list") return [{ slug: "plan-foo-dinner", id: "mission/plan-foo-dinner", name: "Plan Foo dinner", status: "active", target: today, domains: [], progress: { days: { day: 1, total: 2, left: 1 }, milestones: { done: 0, total: 0 }, budget: { planned: 0, used: 0 } } }];
    if (cmd === "engine_entity_threads" || cmd === "engine_entities_duplicates" || cmd === "engine_entities_files") return [];
    if (cmd === "app_favicon") return "";
    return null;
  },
}));

import { GroupPage } from "./iapage";
import { __setEntityListForTest } from "./entitystore";
import { NewObject } from "./newobject";

beforeEach(() => {
  cleanup(); calls.length = 0; localStorage.clear();
  eventFields = { date: today, time: "18:00", place: "place/foo-house" };
  act(() => __setEntityListForTest("/v", LIST as never));
});
const sent = (cmd: string) => calls.filter((c) => c.cmd === cmd).map((c) => c.args);

describe("the Entities page", () => {
  it("has a tab per kind, each with its icon, and breadcrumbs down to the object", async () => {
    render(<GroupPage vaultPath="/v" group="entities" />);
    const tabs = screen.getAllByRole("tab").filter((t) => t.closest("[aria-label=Entities]"));
    expect(tabs.map((t) => t.textContent)).toEqual(["People", "Places", "Products", "Things"]);
    for (const t of tabs) expect(t.querySelector("svg")).not.toBeNull();
    // A wide screen opens on the first of the kind, and the crumbs name it.
    await waitFor(() => expect(screen.getByTestId("ia-breadcrumbs").textContent).toBe("EntitiesPeopleSam Foo"));
    fireEvent.click(screen.getByRole("tab", { name: "Products" }));
    const rows = await screen.findAllByTestId("entity-row");
    // Companies and apps, one list: the company carries its app; an app with no company is its own row.
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("Foo Bank"), expect.stringContaining("Bar Notes")]);
    expect(within(rows[0]!).getByTestId("entity-row-app").textContent).toBe("Company and its app");
    expect(within(rows[1]!).getByTestId("entity-row-app").textContent).toBe("App");
    fireEvent.click(rows[0]!);
    await waitFor(() => expect(screen.getByTestId("ia-crumb-object").textContent).toBe("Foo Bank"));
    expect(screen.getByTestId("ia-breadcrumbs").textContent).toBe("EntitiesProductsFoo Bank");
    // A product shows its app records.
    expect(await screen.findByTestId("product-apps")).toBeTruthy();
    fireEvent.click(screen.getAllByTestId("entity-row")[1]!);
    await waitFor(() => expect(screen.getByTestId("ia-crumb-object").textContent).toBe("Bar Notes"));
    // The kind crumb goes back to the list (on a wide screen, its first).
    fireEvent.click(within(screen.getByTestId("ia-breadcrumbs")).getByText("Products"));
    await waitFor(() => expect(screen.getByTestId("ia-crumb-object").textContent).toBe("Foo Bank"));
  });

  it("a thing keeps its details, editable in place", async () => {
    render(<GroupPage vaultPath="/v" group="entities" initial="things" />);
    fireEvent.click((await screen.findAllByTestId("entity-row"))[0]!);
    const d = await screen.findByTestId("thing-details");
    expect(within(d).getByTestId("thing-value").textContent).toContain("$420");
    expect(within(d).getByTestId("thing-warranty").textContent).toContain("covered");
    fireEvent.click(within(screen.getByTestId("thing-value")).getByRole("button", { name: /change value/i }));
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "380" } });
    fireEvent.submit(screen.getByLabelText("Value").closest("form")!);
    await waitFor(() => expect(sent("ia_set_field")).toEqual([{ vault: "/v", id: "thing/foo-watch", field: "value", value: "380" }]));
  });
});

describe("the Activities page", () => {
  it("events sit on a week strip; a calendar entry becomes an event page when opened", async () => {
    render(<GroupPage vaultPath="/v" group="activities" />);
    expect(screen.getAllByRole("tab").filter((t) => t.closest("[aria-label=Activities]")).map((t) => t.textContent)).toEqual(["Events", "Projects"]);
    const strip = await screen.findByTestId("calendar-strip");
    await waitFor(() => expect(within(strip).getAllByTestId("strip-event").map((b) => b.textContent)).toEqual(["Foo dinner", "Foo dentist"]));
    expect(strip.querySelector(`[data-day="${today}"]`)).not.toBeNull();
    fireEvent.click(within(strip).getByText("Foo dentist"));
    await waitFor(() => expect(sent("ia_event_adopt")).toEqual([{ vault: "/v", row: "calendar:cal-1" }]));
    await waitFor(() => expect(sent("entities_show").pop()).toEqual({ vault: "/v", id: "event/foo-dentist" }));
  });

  it("nothing goes to the calendar until the user says yes; an event becomes a project", async () => {
    render(<GroupPage vaultPath="/v" group="activities" />);
    const ask = await screen.findByTestId("event-calendar-ask");
    expect(sent("ia_event_calendar")).toEqual([]);
    fireEvent.click(within(ask).getByTestId("event-calendar-yes"));
    await waitFor(() => expect(sent("ia_event_calendar")).toEqual([{ vault: "/v", id: "event/foo-dinner", answer: "yes" }]));
    expect(await screen.findByTestId("event-calendar-synced")).toBeTruthy();
    fireEvent.click(screen.getByTestId("event-make-project"));
    await waitFor(() => expect(sent("ia_event_project")).toEqual([{ vault: "/v", id: "event/foo-dinner", project: null }]));
    expect((await screen.findByTestId("event-project-open")).textContent).toContain("Plan Foo dinner");
  });

  it("links show both ways; a kept link can be taken back", async () => {
    render(<GroupPage vaultPath="/v" group="activities" />);
    fireEvent.click(await screen.findByTestId("entity-tab-links"));
    const pane = await screen.findByTestId("object-links");
    await waitFor(() => expect(within(pane).getAllByTestId("object-link").map((l) => l.textContent)).toEqual(["Sam Foo", "Foo HouseWhere"]));
    fireEvent.click(within(pane).getByRole("button", { name: "Unlink Sam Foo" }));
    await waitFor(() => expect(sent("ia_link")).toEqual([{ vault: "/v", a: "event/foo-dinner", b: "person/sam-foo", remove: true }]));
    // A link made by a field has no unlink: it changes with the field.
    expect(within(pane).queryByRole("button", { name: "Unlink Foo House" })).toBeNull();
  });
});

describe("new by talking", () => {
  it("drafts from what the user says and saves only on their go", async () => {
    const made: string[] = [];
    render(<NewObject vaultPath="/v" kind="events" onCancel={() => {}} onMade={(id) => made.push(id)} />);
    fireEvent.change(screen.getByTestId("new-object-input"), { target: { value: "A foo party on Friday" } });
    fireEvent.click(screen.getByTestId("new-object-send"));
    expect(await screen.findByText("Got it. Say save to keep it.")).toBeTruthy();
    expect(sent("ia_create")).toEqual([]);
    expect(screen.getByTestId("new-object-summary").textContent).toContain("Foo party");
    fireEvent.click(screen.getByTestId("new-object-save"));
    await waitFor(() => expect(made).toEqual(["event/foo-party"]));
    expect(sent("ia_create")).toEqual([{ vault: "/v", kind: "event", draft: { name: "Foo party", date: today } }]);
  });
});
