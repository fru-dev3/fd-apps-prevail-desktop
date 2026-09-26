// Intent: nav routing, Noticed verdicts and rule edits, History search and
// receipt jumps, the Restart editor's exclude list, the rebuild check, and the
// phone layout. The engine is mocked at the bridge.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
const day = (s: string, h = 12) => Date.parse(`${s}T${String(h).padStart(2, "0")}:00:00`);

const FINDINGS = {
  generated_ts: day("2026-09-21"),
  letter: { week: "2026-09-14", title: "A week of checkout work", markdown: "Most of your week went to **acme shop** checkout." },
  findings: [
    {
      id: "repeated_rules:acme", kind: "repeated_rules", headline: "You told models to use pnpm 14 times",
      detail: "The same instruction, in four projects.", metric: { value: 14, unit: "times" },
      visual: { type: "dots", data: { total: 20, marked: 14 } },
      receipts: [{ ts: day("2026-09-10", 9), tool: "claude", project: "acme-shop", project_title: "acme shop", text: "use pnpm not npm" }],
      items: [{ id: "pnpm", label: "Use pnpm, never npm", count: 14, rule_text: "Always use pnpm." }],
      actions: ["rule"], cadence: "weekly", status: "new",
    },
    {
      id: "open_loops:maple", kind: "open_loops", headline: "Two projects stopped mid-sentence",
      detail: "Both went quiet after a question you asked.", metric: { value: 2, unit: "projects" },
      visual: { type: "list", data: [{ label: "Maple St rental", count: 31 }] },
      receipts: [], items: [{ id: "maple-st-rental", label: "Maple St rental lease", project: "maple-st-rental" }],
      actions: ["resume", "let_go", "replay"], cadence: "weekly", status: "new",
    },
    {
      id: "late_night:all", kind: "late_night", headline: "A third of your prompts came after 11pm",
      detail: "Mostly on weekdays.", visual: { type: "bar", data: { value: 33, max: 100 } },
      receipts: [], items: [], actions: ["none"], cadence: "quarterly", status: "new",
    },
    { id: "gone", kind: "goals_drift", headline: "Hidden one", detail: "", status: "not_really" },
  ],
};

const HISTORY_P1 = {
  total: 3, tools: ["claude", "codex"],
  weeks: [{
    week: "2026-09-14", label: "Week of Sep 14", intent_line: "You mostly worked on acme shop checkout.",
    sittings: [{
      id: "s1", tool: "claude", project: "acme-shop", project_title: "acme shop", start_ts: day("2026-09-15", 9), end_ts: day("2026-09-15", 10),
      prompts: [{ ts: day("2026-09-15", 9), text: "fix the cart total\nit rounds wrong" }, { ts: day("2026-09-15", 10), text: "x".repeat(900) }],
    }],
  }],
};
const HISTORY_P2 = {
  total: 3, tools: ["claude", "codex"],
  weeks: [{
    week: "2026-09-07", label: "Week of Sep 7", intent_line: "Lease paperwork for Maple St rental.",
    sittings: [{ id: "s2", tool: "codex", project: "maple-st-rental", project_title: "Maple St rental", start_ts: day("2026-09-10", 9), end_ts: day("2026-09-10", 9), prompts: [{ ts: day("2026-09-10", 9), text: "draft a lease renewal letter" }] }],
  }],
};

const INDEX = {
  generated_ts: day("2026-09-21"), model: "claude-fable-5-1",
  projects: [{
    slug: "acme-shop", title: "acme shop", domain: "dev", kind: "app", summary: "A small web shop.", status: "active",
    prompt_count: 120, first_ts: day("2026-06-01"), last_ts: day("2026-09-15"), monthly: { "2026-09": 40 }, tools: { claude: 100 },
    pack_dir: "p", brief_model: "claude-fable-5-1", brief_ts: day("2026-09-20"), intents: [], takeaways: [], ideas: [], open_questions: [],
  }],
  recommendations: [],
};
const RESTART = {
  slug: "acme-shop", title: "acme shop", goal: "A web shop that takes card payments.",
  requirements: [{ text: "Cart totals round to cents", source: "you" }, { text: "Works on phones", source: "inferred" }],
  rules: ["Use pnpm"], decisions: ["Stripe for payments"], dead_ends: ["A custom payment form"], open_questions: ["Ship to Canada?"],
  brief_model: "claude-fable-5-1",
};

let historyPages: unknown[] = [];
vi.mock("./bridge", () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "mirror_findings") return FINDINGS;
    if (cmd === "mirror_verdict") return { ok: true };
    if (cmd === "mirror_refresh") return { ok: true };
    if (cmd === "mirror_history") return historyPages.shift() ?? { total: 3, tools: [], weeks: [] };
    if (cmd === "capture_status") return { harnesses: [{ tool: "claude", method: "push", present: true, wired: true }, { tool: "codex", method: "sync", present: true, wired: false }] };
    if (cmd === "projects_index") return INDEX;
    if (cmd === "projects_restart") return RESTART;
    if (cmd === "projects_restart_text") return `TEXT:${args?.format}`;
    if (cmd === "projects_diff") return { met: ["Cart totals round to cents"], missed: ["Works on phones"], unclear: [] };
    return null;
  },
  isBrowser: () => true,
}));
let phone = false;
vi.mock("./useisphone", () => ({ useIsPhone: () => phone, PHONE_MAX_PX: 767 }));

import { FindingVisual, MirrorPanel, visibleFindings, type FindingsDoc } from "./mirror";
import { EDITOR_NAV, navSection } from "./navdefs";

const byCmd = (c: string) => calls.filter((x) => x.cmd === c);

beforeEach(() => {
  cleanup();
  calls.length = 0;
  phone = false;
  historyPages = [];
  localStorage.clear();
  Object.assign(navigator, { clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
});

describe("nav routing", () => {
  it("has one Intent item and routes the old ids to it", () => {
    const ids = EDITOR_NAV.flatMap((g) => g.items.map((i) => i.id));
    expect(ids).toContain("intent");
    for (const old of ["intents", "prompt-capture", "retrospect", "mirror"]) {
      expect(ids).not.toContain(old);
      expect(navSection(old)).toBe("intent");
    }
    expect(navSection("models")).toBe("models");
  });
});

describe("Noticed", () => {
  it("shows the letter, one featured finding, two quiet cards, and the tool dots", async () => {
    render(<MirrorPanel vaultPath="/v" />);
    expect(await screen.findByText("A week of checkout work")).toBeTruthy();
    expect(screen.getByTestId("featured-finding").textContent).toContain("You told models to use pnpm 14 times");
    expect(screen.getAllByTestId("quiet-finding")).toHaveLength(2);
    expect(screen.queryByText("Hidden one")).toBeNull();
    expect(screen.getByTestId("visual-dots").children).toHaveLength(20);
    await waitFor(() => expect(screen.getByTestId("tool-dot-claude").dataset.on).toBe("1"));
    expect(screen.getByTestId("tool-dot-codex").dataset.on).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Capture setup" }));
    expect(screen.getByRole("dialog", { name: "Capture setup" })).toBeTruthy();
  });

  it("edits a rule before confirming it", async () => {
    render(<MirrorPanel vaultPath="/v" />);
    fireEvent.click(await screen.findByRole("button", { name: /Make it a rule/ }));
    const box = screen.getByLabelText("The rule, in your words") as HTMLTextAreaElement;
    expect(box.value).toBe("Always use pnpm.");
    fireEvent.change(box, { target: { value: "Use pnpm in every repo." } });
    fireEvent.click(screen.getByRole("button", { name: /Save rule/ }));
    await waitFor(() => expect(byCmd("mirror_verdict")).toHaveLength(1));
    expect(byCmd("mirror_verdict")[0].args).toEqual({ vault: "/v", findingId: "repeated_rules:acme", verdict: "true", item: "pnpm", rule: "Use pnpm in every repo." });
    await waitFor(() => expect(screen.queryByText("Use pnpm, never npm")).toBeNull());
  });

  it("Not really and Later send verdicts and the finding leaves", async () => {
    render(<MirrorPanel vaultPath="/v" />);
    fireEvent.click(await screen.findByRole("button", { name: /Not really/ }));
    await waitFor(() => expect(byCmd("mirror_verdict")[0]?.args).toMatchObject({ findingId: "repeated_rules:acme", verdict: "not_really", item: null }));
    await waitFor(() => expect(screen.getByTestId("featured-finding").textContent).toContain("Two projects stopped"));
    fireEvent.click(screen.getByRole("button", { name: /Let go/ }));
    await waitFor(() => expect(byCmd("mirror_verdict")[1]?.args).toMatchObject({ findingId: "open_loops:maple", verdict: "let_go", item: "maple-st-rental" }));
    fireEvent.click(screen.getByRole("button", { name: /Later/ }));
    await waitFor(() => expect(byCmd("mirror_verdict")[2]?.args).toMatchObject({ verdict: "later" }));
  });

  it("hides answered and snoozed findings", () => {
    const doc = { generated_ts: 0, letter: null, findings: [
      { id: "a", kind: "late_night", headline: "", detail: "", status: "later", snoozed_until: 2000 },
      { id: "b", kind: "late_night", headline: "", detail: "", status: "later", snoozed_until: 500 },
      { id: "c", kind: "late_night", headline: "", detail: "", status: "true" },
    ] } as FindingsDoc;
    expect(visibleFindings(doc, 1000).map((f) => f.id)).toEqual(["b"]);
  });

  it("a receipt opens History on that prompt", async () => {
    historyPages = [HISTORY_P2];
    render(<MirrorPanel vaultPath="/v" />);
    fireEvent.click(await screen.findByRole("button", { name: /Open prompt from/ }));
    await waitFor(() => expect(byCmd("mirror_history")).toHaveLength(1));
    expect(byCmd("mirror_history")[0].args).toMatchObject({ before: day("2026-09-10", 9) + 1, q: null });
    expect(await screen.findByText("draft a lease renewal letter")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector(`[data-prompt-ts="${day("2026-09-10", 9)}"]`)?.className).toContain("ring-1");
  });
});

describe("History", () => {
  it("shows weeks with intent lines, collapses long prompts, searches and pages", async () => {
    localStorage.setItem("prevail.mirror.view", "history");
    historyPages = [HISTORY_P1, HISTORY_P2];
    render(<MirrorPanel vaultPath="/v" />);
    expect(await screen.findByText("You mostly worked on acme shop checkout.")).toBeTruthy();
    expect(screen.getByText(/fix the cart total\s+it rounds wrong/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load older" }));
    expect(await screen.findByText("Lease paperwork for Maple St rental.")).toBeTruthy();
    expect(byCmd("mirror_history")[1].args).toMatchObject({ before: day("2026-09-15", 9) });
    fireEvent.click(within(screen.getAllByTestId("sitting")[0]).getAllByRole("button", { name: "Copy prompt" })[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("fix the cart total\nit rounds wrong");
    historyPages = [HISTORY_P2];
    fireEvent.change(screen.getByLabelText("Search prompts"), { target: { value: "lease" } });
    await waitFor(() => expect(byCmd("mirror_history").some((c) => c.args?.q === "lease")).toBe(true));
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "maple-st-rental" } });
    await waitFor(() => expect(byCmd("mirror_history").at(-1)?.args).toMatchObject({ q: "lease", project: "maple-st-rental" }));
  });
});

describe("Projects restart", () => {
  it("excludes unchecked items from the copy and checks a rebuild", async () => {
    localStorage.setItem("prevail.mirror.view", "projects");
    render(<MirrorPanel vaultPath="/v" />);
    fireEvent.click((await screen.findAllByText("acme shop"))[0]);
    expect(await screen.findByText("Rules you already had to give")).toBeTruthy();
    expect(screen.getByText("inferred")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Include: Works on phones"));
    fireEvent.click(screen.getByLabelText("Include: A custom payment form"));
    fireEvent.click(screen.getByRole("button", { name: /Copy restart brief/ }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("TEXT:handoff"));
    expect(byCmd("projects_restart_text")[0].args).toEqual({ vault: "/v", slug: "acme-shop", format: "handoff", exclude: ["Works on phones", "A custom payment form"] });
    fireEvent.click(screen.getByLabelText("Include: Works on phones"));
    fireEvent.click(screen.getByRole("button", { name: /Copy raw prompts/ }));
    await waitFor(() => expect(byCmd("projects_restart_text")[1]?.args).toMatchObject({ format: "raw", exclude: ["A custom payment form"] }));
    fireEvent.click(screen.getByRole("button", { name: /Copy intent/ }));
    await waitFor(() => expect(byCmd("projects_restart_text")[2]?.args).toMatchObject({ format: "intent" }));

    fireEvent.change(screen.getByLabelText("Rebuild folder"), { target: { value: "/tmp/acme-v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(within(await screen.findByTestId("diff-met")).getByText("Cart totals round to cents")).toBeTruthy();
    expect(within(screen.getByTestId("diff-missed")).getByText("Works on phones")).toBeTruthy();
    expect(byCmd("projects_diff")[0].args).toEqual({ vault: "/v", slug: "acme-shop", against: "/tmp/acme-v2" });
  });
});

describe("phone", () => {
  it("Noticed shows one finding per screen with paging", async () => {
    phone = true;
    render(<MirrorPanel vaultPath="/v" />);
    expect((await screen.findByTestId("featured-finding")).textContent).toContain("pnpm");
    expect(screen.queryAllByTestId("quiet-finding")).toHaveLength(0);
    expect(screen.getByText("1 of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next finding" }));
    expect(screen.getByTestId("featured-finding").textContent).toContain("Two projects stopped");
  });

  it("Projects detail offers only the restart brief", async () => {
    phone = true;
    localStorage.setItem("prevail.mirror.view", "projects");
    render(<MirrorPanel vaultPath="/v" />);
    fireEvent.click((await screen.findAllByText("acme shop"))[0]);
    expect(await screen.findByRole("button", { name: /Copy restart brief/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Copy intent/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Copy raw prompts/ })).toBeNull();
    expect(screen.queryByTestId("rebuild-check")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

// Shapes copied from real `prevail mirror findings --json` output, labels invented.
describe("FindingVisual engine shapes", () => {
  it("goals_drift dots: one dot per domain, lit when it came up", () => {
    render(<FindingVisual visual={{ type: "dots", data: [
      { domain: "health", prompts: 0, share: 0 }, { domain: "acme", prompts: 69, share: 2 },
      { domain: "garden", prompts: 0, share: 0 }, { domain: "maple-st", prompts: 723, share: 17 },
    ] }} />);
    const dots = screen.getByTestId("visual-dots").children;
    expect(dots).toHaveLength(4);
    expect(Array.from(dots).filter((d) => d.className.includes("bg-accent"))).toHaveLength(2);
    expect(dots[1].getAttribute("title")).toBe("acme: 69 prompts");
    expect(screen.getByTestId("visual-dots-legend").textContent).toBe("2 of 4 came up");
    expect(screen.getByTestId("visual-dots-quiet").textContent).toBe("Never came up: Health, Garden");
  });

  it("tooling_share split: numeric keys are segments, project lists are names", () => {
    render(<FindingVisual visual={{ type: "split", data: {
      tooling: 57, outcome: 31,
      tooling_projects: [{ slug: "acme-cli", title: "Acme CLI", sittings: 33 }, { slug: "sam-bot", title: "Sam bot", sittings: 19 }],
      outcome_projects: [{ slug: "maple-st", title: "Maple St site", sittings: 17 }],
    } }} />);
    const bar = screen.getByTestId("visual-split").firstElementChild!;
    expect(bar.children).toHaveLength(2);
    expect((bar.children[0] as HTMLElement).style.width).toBe(`${(57 / 88) * 100}%`);
    const text = screen.getByTestId("visual-split").textContent ?? "";
    expect(text).toContain("Tools and setup");
    expect(text).toContain("57 (65%)");
    expect(text).not.toContain("tooling_projects");
    expect(screen.getByTestId("split-names-tooling").textContent).toBe("Acme CLI (33), Sam bot (19)");
    expect(screen.getByTestId("split-names-outcome").textContent).toBe("Maple St site (17)");
  });

  it("late_night bar: one bar per row, value is a percent", () => {
    render(<FindingVisual visual={{ type: "bar", data: [
      { label: "23:00 to 05:00", value: 40, prompts: 25 }, { label: "Daytime", value: 10, prompts: 300 },
    ] }} />);
    const root = screen.getByTestId("visual-bar");
    expect(root.children).toHaveLength(2);
    expect(root.textContent).toContain("40% of 25 prompts");
    const fills = root.querySelectorAll(".bg-accent");
    expect((fills[0] as HTMLElement).style.width).toBe("40%");
    expect((fills[1] as HTMLElement).style.width).toBe("10%");
  });

  it("list rows ignore extra keys such as last_ts", () => {
    render(<FindingVisual visual={{ type: "list", data: [
      { label: "Maple St repairs", count: 34, last_ts: 1783895264643 }, { label: "Acme onboarding", count: 6, last_ts: 1787182129612 },
    ] }} />);
    const rows = screen.getByTestId("visual-list").children;
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toBe("Maple St repairs34");
    expect(screen.getByTestId("visual-list").textContent).not.toContain("1783895264643");
  });
});
