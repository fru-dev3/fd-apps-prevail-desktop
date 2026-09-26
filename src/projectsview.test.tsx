// Retrospect > Projects: the list, a project's replay actions, recommendations
// that become tasks, and the empty state that starts the first build.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
let index: unknown = null;
vi.mock("./bridge", () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "projects_index") return index;
    if (cmd === "projects_replay") return args?.withPrompts ? "BRIEF + PROMPTS" : "BRIEF";
    if (cmd === "projects_build") return index;
    if (cmd === "read_text_file") return "<!-- prevail:replay-brief -->\n# Rebuild: fru.dev site";
    return null;
  },
}));
let phone = false;
vi.mock("./useisphone", () => ({ useIsPhone: () => phone, PHONE_MAX_PX: 767 }));

import { ProjectsView, modelName, monthSpan, nPrompts, statusKind, weekSpan } from "./projectsview";

const day = (s: string) => Date.parse(`${s}T12:00:00`);
const INDEX = {
  generated_ts: day("2026-09-25"),
  model: "claude-fable-5-1",
  stats: { records: 33512, kept: 4313, internal: 25916, program: 3264, projects: 2, unassigned: 40 },
  projects: [
    {
      slug: "fru-dev-site", title: "fru.dev site", domain: "dev", kind: "site", summary: "Personal site as a desktop.",
      status: "active", prompt_count: 697, first_ts: day("2026-06-03"), last_ts: day("2026-09-24"),
      monthly: { "2026-06": 100, "2026-07": 300, "2026-09": 297 }, tools: { claude: 690, codex: 7 },
      pack_dir: "data/domains/dev/memory/projects/fru-dev-site", brief_model: "claude-fable-5-1", brief_ts: day("2026-09-25"),
      intents: [{ title: "Ship the FruOS desktop", goal: "A site that feels like an OS", status: "active" }],
      takeaways: ["Office green, never gold"], ideas: ["A guestbook window"], open_questions: ["Which analytics?"],
    },
    {
      slug: "roof-claim", title: "Roof damage claim", domain: "insurance", kind: "life", summary: "Hail claim.",
      status: "dormant", prompt_count: 3, first_ts: day("2026-07-01"), last_ts: day("2026-07-02"),
      monthly: { "2026-07": 3 }, tools: { claude: 3 }, pack_dir: "data/domains/insurance/memory/projects/roof-claim",
      brief_model: "", brief_ts: 0, intents: [], takeaways: [], ideas: [], open_questions: [],
    },
  ],
  recommendations: [
    { kind: "task", title: "Follow up with the adjuster", why: "Claim dormant since July", domain: "insurance", project: "Roof damage claim" },
    { kind: "skill", title: "Write a ship-to-Vercel skill", why: "You re-explained the deploy 14 times", domain: "dev", project: "fru.dev directory sites", project_slug: "fru-dev-site" },
  ],
  recommendations_model: "claude-fable-5-1",
};

beforeEach(() => { cleanup(); calls.length = 0; index = INDEX; phone = false; });

describe("helpers", () => {
  it("names models and spans months", () => {
    expect(modelName("claude-fable-5-1")).toBe("Fable 5.1");
    expect(modelName("claude-opus-5")).toBe("Opus 5");
    expect(modelName("gpt-6-astra")).toBe("GPT-6 Astra");
    expect(modelName("gpt-5.6-sol")).toBe("GPT-5.6 Sol");
    expect(modelName("some-new-model-x")).toBe("some-new-model-x");
    expect(monthSpan(day("2026-06-20"), day("2026-09-01"))).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(weekSpan(day("2026-09-09"), day("2026-09-24"))).toEqual(["2026-09-07", "2026-09-14", "2026-09-21"]);
    expect(statusKind("IN PROGRESS")).toBe("active");
    expect(statusKind("shipped")).toBe("done");
    expect(statusKind("parked")).toBe("dormant");
    expect(nPrompts(1)).toBe("1 prompt");
    expect(nPrompts(4313)).toBe("4,313 prompts");
  });
});

describe("ProjectsView", () => {
  it("opens on the overview with grouped recommendations, and a task one becomes a task", async () => {
    render(<ProjectsView vaultPath="/v" />);
    expect(await screen.findByText("What would move you forward")).toBeTruthy();
    expect(screen.getByText("Tasks")).toBeTruthy();
    expect(screen.getByText("Skills to write")).toBeTruthy();
    expect(screen.getByText(/4,313 of your prompts, 2 projects/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(calls.find((c) => c.cmd === "tasks_add")?.args).toMatchObject({ vault: "/v", domain: "insurance", text: "Follow up with the adjuster" }));
    expect(await screen.findByText("Added")).toBeTruthy();
  });

  it("a recommendation links to its project under the current title", async () => {
    render(<ProjectsView vaultPath="/v" />);
    fireEvent.click(await screen.findByRole("button", { name: "fru.dev site" }));
    expect(screen.getByRole("heading", { name: "fru.dev site" })).toBeTruthy();
  });

  it("shows a project's arc and copies its replay brief", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ProjectsView vaultPath="/v" />);
    fireEvent.click((await screen.findAllByText("fru.dev site"))[0]); // the list entry
    expect(screen.getByText(/697 prompts · Jun 3 to Sep 24, 2026 · Claude, Codex/)).toBeTruthy();
    expect(screen.getByText("Office green, never gold")).toBeTruthy();
    expect(screen.getByText(/Written by Fable 5.1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Copy replay brief/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("BRIEF"));
    fireEvent.click(screen.getByRole("button", { name: /Brief and every prompt/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("BRIEF + PROMPTS"));
  });

  it("opens the brief without its generator header", async () => {
    const seen: unknown[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("prevail:open-canvas", on);
    render(<ProjectsView vaultPath="/v/" />);
    fireEvent.click((await screen.findAllByText("fru.dev site"))[0]); // the list entry
    fireEvent.click(screen.getByRole("button", { name: /Read brief/ }));
    await waitFor(() => expect(seen).toHaveLength(1));
    window.removeEventListener("prevail:open-canvas", on);
    expect(calls.find((c) => c.cmd === "read_text_file")?.args).toEqual({ path: "/v/data/domains/dev/memory/projects/fru-dev-site/brief.md" });
    expect(seen[0]).toEqual({ title: "fru.dev site: replay brief", body: "# Rebuild: fru.dev site" });
  });

  it("a small project has its prompts but no brief to copy", async () => {
    render(<ProjectsView vaultPath="/v" />);
    fireEvent.click(await screen.findByText("Roof damage claim"));
    expect(screen.getByText(/No brief yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Copy replay brief/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Every prompt/ })).toBeTruthy();
  });

  it("filters to active projects", async () => {
    render(<ProjectsView vaultPath="/v" />);
    fireEvent.click(await screen.findByRole("button", { name: "Active 1" }));
    expect(screen.queryByText("Roof damage claim")).toBeNull();
  });

  it("offers the first build when there are no projects", async () => {
    index = { generated_ts: 0, projects: [], recommendations: [] };
    render(<ProjectsView vaultPath="/v" />);
    fireEvent.click(await screen.findByRole("button", { name: /Build my projects/ }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "projects_build")).toBe(true));
  });
});
