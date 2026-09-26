// Recommendations: the one ranked "what to do next" page. Invented data only.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
let recs: unknown[] = [];
vi.mock("./bridge", () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "engine_recommendations") return { ok: true, recommendations: recs };
    if (cmd === "distill_status") return { running: false, last_run_ts: null, interval_sec: 900 };
    if (cmd === "intent_instruction") return `INSTRUCTION:${args?.index}`;
    return { ok: true };
  },
  isBrowser: () => true,
}));
let phone = false;
vi.mock("./useisphone", () => ({ useIsPhone: () => phone, PHONE_MAX_PX: 767 }));

import { RecommendationsPanel } from "./recommendationspanel";
import { liveRec, recsFor, spineCounts, visibleRecs, type Rec } from "./recmodel";

const rec = (id: string, category: Rec["category"], leverage: number, extra: Partial<Rec> = {}): Rec => ({
  id, category, leverage, title: `Title ${id}`, detail: `Why ${id}.`, metric: { value: leverage, unit: "things" },
  action: { kind: "open_finding", finding: "f" }, ...extra,
});
const MODELS = rec("models:defaults", "models", 40, {
  title: "Better model defaults for 2 domains", metric: { value: 2, unit: "domains" },
  action: { kind: "set_domain_models" },
  rows: [
    { id: "model:garden", domain: "garden", suggested: "model-a", suggested_label: "Model A", cli: "claude", score: 8.4, models_tested: 3 },
    { id: "model:travel", domain: "travel", suggested: "model-b", suggested_label: "Model B", cli: "codex", score: 7.9, models_tested: 2 },
  ],
});
const RECS: Rec[] = [
  rec("rule:r1", "rules", 90, { title: "Make it a rule: Water before noon", instruction: "Water before noon", action: { kind: "make_rule", rule: "Water before noon", finding: "repeated_rules", item: "r1" }, evidence: { kind: "finding", ref: "repeated_rules#r1", label: "Intent: instructions you keep restating" } }),
  rec("proj:abc", "projects", 80, { task: { domain: "garden", text: "Order saplings" }, action: { kind: "project_rec", index: 3, project: "orchard" }, evidence: { kind: "project", ref: "orchard", label: "Project: Orchard plan" } }),
  rec("signin:rain", "apps", 70, { action: { kind: "signin_app", app: "rain" } }),
  rec("entity:person/ada", "people", 60, { action: { kind: "save_entity", entity: "person/ada" } }),
  rec("context:garden", "context", 50, { action: { kind: "improve_context", domain: "garden" } }),
  MODELS,
  rec("stuck:shed", "projects", 30, { action: { kind: "restart_project", project: "shed" } }),
];

beforeEach(() => {
  cleanup();
  calls.length = 0;
  recs = RECS;
  phone = false;
  localStorage.clear();
});

describe("recmodel", () => {
  it("counts per category and a top-five Start here", () => {
    const v = visibleRecs(RECS, new Set());
    const c = spineCounts(v);
    expect(c).toMatchObject({ all: 7, start: 5, rules: 1, projects: 2, apps: 1, people: 1, models: 1, context: 1 });
    expect(recsFor(v, "start").map((r) => r.id)).toEqual(["rule:r1", "proj:abc", "signin:rain", "entity:person/ada", "context:garden"]);
  });

  it("model defaults drop applied and dismissed rows, and vanish when none are left", () => {
    localStorage.setItem("prevail.domain.garden.model", "model-a");
    const one = liveRec(MODELS, new Set())!;
    expect(one.rows!.map((r) => r.domain)).toEqual(["travel"]);
    expect(one.title).toBe("Better model defaults for 1 domain");
    expect(one.metric!.value).toBe(1);
    // An old per-domain dismissal ("model:<domain>") still hides that row.
    expect(liveRec(MODELS, new Set(["model:travel"]))).toBeNull();
  });

  it("maps categories from older engines", () => {
    const v = visibleRecs([{ ...rec("model:x", "models", 1), category: "model" as Rec["category"] }], new Set());
    expect(v[0].category).toBe("models");
  });
});

describe("RecommendationsPanel", () => {
  it("sticky header, category spine with counts, Start here first", async () => {
    render(<RecommendationsPanel vaultPath="/v" />);
    const start = await screen.findByTestId("section-start");
    expect(within(start).getAllByTestId("rec-item")).toHaveLength(5);
    expect(screen.getByTestId("page-header").className).toMatch(/sticky/);
    expect(screen.getByTestId("recs-spine")).toBeTruthy();
    expect(within(screen.getByTestId("spine-projects")).getByText("2")).toBeTruthy();
    expect(within(screen.getByTestId("spine-start")).getByText("5")).toBeTruthy();
    fireEvent.click(screen.getByTestId("spine-people"));
    expect(screen.getByTestId("section-people")).toBeTruthy();
    expect(screen.getAllByTestId("rec-item")).toHaveLength(1);
  });

  it("do it saves a rule in place; icon actions have tooltips", async () => {
    render(<RecommendationsPanel vaultPath="/v" />);
    await screen.findByTestId("section-start");
    const btn = screen.getByRole("button", { name: "Save as a standing rule" });
    expect(btn.getAttribute("title")).toBe("Save as a standing rule");
    fireEvent.click(btn);
    await waitFor(() => expect(calls.find((c) => c.cmd === "mirror_verdict")?.args).toEqual({ vault: "/v", findingId: "repeated_rules", verdict: "true", item: "r1", rule: "Water before noon" }));
    expect(await screen.findByText("Saved as a standing rule.")).toBeTruthy();
  });

  it("add task and copy instruction for a project recommendation", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render(<RecommendationsPanel vaultPath="/v" />);
    await screen.findByTestId("section-start");
    const item = screen.getAllByTestId("rec-item").find((n) => n.getAttribute("data-rec-id") === "proj:abc")!;
    fireEvent.click(within(item).getByRole("button", { name: "Add a task to Garden" }));
    await waitFor(() => expect(calls.find((c) => c.cmd === "tasks_add")?.args).toEqual({ vault: "/v", domain: "garden", text: "Order saplings", source: "recommendations" }));
    fireEvent.click(within(item).getByRole("button", { name: "Copy an instruction for an agent" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("INSTRUCTION:3"));
  });

  it("evidence opens the project in Intent", async () => {
    const seen: unknown[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("prevail:open-settings", on);
    render(<RecommendationsPanel vaultPath="/v" />);
    fireEvent.click(await screen.findByRole("button", { name: /Project: Orchard plan/ }));
    expect(seen).toEqual(["intent"]);
    expect(localStorage.getItem("prevail.mirror.view")).toBe("projects");
    expect(localStorage.getItem("prevail.intent.project")).toBe("orchard");
    window.removeEventListener("prevail:open-settings", on);
  });

  it("the model item expands to a table with per-row apply and Apply all", async () => {
    render(<RecommendationsPanel vaultPath="/v" />);
    fireEvent.click(await screen.findByTestId("spine-models"));
    fireEvent.click(screen.getByRole("button", { name: "Show 2 domains" }));
    expect(screen.getAllByTestId("model-row")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Apply for Garden" }));
    expect(localStorage.getItem("prevail.domain.garden.model")).toBe("model-a");
    fireEvent.click(screen.getByRole("button", { name: "Apply all" }));
    await waitFor(() => expect(localStorage.getItem("prevail.domain.travel.model")).toBe("model-b"));
    expect(localStorage.getItem("prevail.domain.travel.cli")).toBe("codex");
  });

  it("dismiss persists under the same key as before and updates counts", async () => {
    render(<RecommendationsPanel vaultPath="/v" />);
    await screen.findByTestId("section-start");
    const item = screen.getAllByTestId("rec-item").find((n) => n.getAttribute("data-rec-id") === "signin:rain")!;
    fireEvent.click(within(item).getByRole("button", { name: "Dismiss" }));
    expect(JSON.parse(localStorage.getItem("prevail.recs.dismissed")!)).toEqual(["signin:rain"]);
    expect(within(screen.getByTestId("spine-all")).getByText("6")).toBeTruthy();
  });

  it("a phone gets category tabs instead of the spine", async () => {
    phone = true;
    render(<RecommendationsPanel vaultPath="/v" />);
    await screen.findByTestId("section-start");
    expect(screen.queryByTestId("recs-spine")).toBeNull();
    expect(screen.getByRole("tablist", { name: "Recommendation categories" })).toBeTruthy();
  });
});
