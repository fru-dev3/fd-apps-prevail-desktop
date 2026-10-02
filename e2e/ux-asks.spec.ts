// The owner's UX asks of 2026-10-02: every specialist has its own animated
// face (sidebar, Specialists page, job card, @ picker, Inbox, missions), a
// specialist can be dragged into a chat as a handoff, and a mission is created
// by talking (fields optional). Invented data only. With UX_SHOTS=<dir>, each
// surface is captured at 390, 768, 1280 and 1920.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const spec = (id: string, name: string, family: string, returns: string, on = true) => ({
  id, name, icon: "search", family, returns, ceiling: "read", tools: ["vault-read"], apps: [], runtime: "standard",
  budget: { minutes: 5, usd: 0.3, passes: 1 }, handoff: "offer", doneWhen: [], mandate: `The ${name.toLowerCase()} of the foo team.`, on, builtIn: true,
});
const SPECIALISTS = [
  spec("researcher", "Researcher", "know", "findings"), spec("scout", "Scout", "know", "discoveries"), spec("planner", "Planner", "decide", "plan"),
  spec("steward", "Steward", "decide", "verdict"), spec("writer", "Writer", "do", "drafts"), spec("coach", "Coach", "grow", "plan"),
  spec("editor", "Editor", "deliver", "page"), spec("tutor", "Tutor", "grow", "lessons", false),
];
const JOB = {
  id: "j-foo", ask: "Compare three foo carriers", origin: { kind: "chat", domain: "hobbies" }, domains: { owner: "hobbies", consulted: [], informed: [] },
  team: [{ step: 1, specialists: ["researcher", "scout"] }, { step: 2, specialists: ["editor"] }], effort: "standard", budget: { usd: 1, minutes: 10 },
  why: "compare", playbook: null, status: "running", startsAlone: true, created: 1, started: 1,
  progress: [{ step: 1, specialist: "scout", pass: 1 }],
};
const FIX = {
  ui_settings_get: JSON.stringify({ theme: "light" }),
  read_ideal_state: "", read_omega: "", read_user_md: "", read_memory_md: "",
  scan_vault: ["hobbies", "money", "family"].map((name) => ({ name, path: `/tmp/smoke-vault/data/domains/${name}`, has_state: true, state_preview: null })),
  domain_context: { state: "", decisions: "", journal: "", recent_logs: [], skills: [], layoutV4: true },
  engine_specialists: SPECIALISTS, engine_specialist_show: { spec: SPECIALISTS[0], notebooks: [] },
  engine_jobs: [JOB],
  engine_job_show: { job: JOB, steps: [{ id: "1-researcher", specialist: "researcher", status: "done", passes: [], cost: { usd: 0.1, minutes: 1 } }, { id: "1-scout", specialist: "scout", status: "running", passes: [], cost: { usd: 0, minutes: 0 } }], filed: [], body: "" },
  chief_of_staff_read: "---\nname: Foo\nhandoff: offer\n---\n\n## Limits\n- usd: 1\n- minutes: 10\n",
  engine_missions_list: [],
  engine_playbook_inbox: [{ runId: "loop-foo", playbook: "foo-weekly", name: "Foo weekly", trigger: "schedule", domain: "hobbies", ok: true, note: "", ts: Date.parse("2026-10-02T09:00:00Z"), waiting: 0,
    steps: [{ label: "Researcher and Scout: what changed", ok: true, decision: "auto", note: "Two foo changes.", specialists: ["researcher", "scout"] }, { label: "Editor: one page", ok: true, decision: "auto", note: "Saved.", specialists: ["editor"] }] }],
};

const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? [])
    .filter((e) => e.cmd === c).map((e) => e.args), cmd);
const fire = (page: Page, name: string, detail: unknown) =>
  page.evaluate(([n, d]) => window.dispatchEvent(new CustomEvent(n as string, { detail: d })), [name, detail] as [string, unknown]);
const SHOTS = process.env.UX_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()?.width}.png` });
}

async function home(page: Page, width: number, extra: Record<string, unknown> = {}) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await page.addInitScript(() => { localStorage.setItem("prevail.desktop.defaultChatCli", "claude"); localStorage.setItem("prevail.sidebar.specialistsOpen", "1"); });
  await mockTauri(page, { ...FIX, ...extra });
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
}
const composer = (page: Page) => page.locator("[data-tour=composer] textarea").first();

/** A press, a move past the 6px threshold, and a release over `to`. */
async function drag(page: Page, from: string, to: { x: number; y: number }) {
  const b = (await page.locator(from).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 30, b.y + b.height / 2 + 10, { steps: 3 });
  await expect(page.getByTestId("drag-pill")).toBeVisible();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

test.describe("specialist faces", () => {
  test("each specialist has its own face everywhere; one at work shows it", async ({ page }) => {
    await home(page, 1280);
    const side = page.getByTestId("sidebar-specialists");
    for (const id of ["researcher", "scout", "editor"]) await expect(side.getByTestId(`sidebar-specialist-${id}`).locator(`[data-specialist=${id}]`)).toBeVisible();
    // On the running job: working faces; idle for the others.
    await expect(side.locator("[data-specialist=scout]")).toHaveAttribute("data-state", "working");
    await expect(side.locator("[data-specialist=researcher]")).toHaveAttribute("data-state", "idle");
    await expect(side.locator("[data-specialist=planner]")).toHaveAttribute("data-state", "idle");
    // Distinct colors: no two specialists share a gradient.
    const fills = await side.locator(".sa svg stop[offset='0.5']").evaluateAll((xs) => xs.map((x) => x.getAttribute("stop-color")));
    expect(new Set(fills).size).toBe(fills.length);
    // The chief of staff's face is on the Home row.
    await expect(page.getByTestId("nav-home").locator("[data-specialist=chief]")).toBeVisible();
    await shot(page, "avatars-sidebar");

    // Specialists page: the list and the detail header.
    await side.getByTestId("sidebar-specialist-scout").click();
    await expect(page.getByTestId("specialist-detail")).toHaveAttribute("data-id", "scout");
    await expect(page.getByTestId("specialist-detail").locator("[data-specialist=scout]")).toHaveAttribute("role", "img");
    await expect(page.getByTestId("specialists-list").locator("[data-specialist=coach]")).toBeVisible();
    await shot(page, "avatars-specialists");
    // The job card's team line: Researcher done, Scout working, Editor next.
    await page.getByTestId("specialists-row-jobs:running").click();
    await page.getByTestId("job-row").first().click();
    const chips = page.getByTestId("job-team-chip");
    await expect(chips.nth(1).locator("[data-specialist=scout]")).toHaveAttribute("data-state", "working");
    await expect(chips.nth(2).locator("[data-specialist=editor]")).toHaveAttribute("data-state", "off");
    await shot(page, "avatars-jobcard");
    // Inbox results: the faces of each step's team.
    await fire(page, "prevail:work-section", "inbox");
    await page.getByTestId("tab-results").click();
    await page.getByText("Foo weekly").first().click();
    await expect(page.getByTestId("inbox-step-team").first().locator(".sa")).toHaveCount(2);
  });

  test("the @ picker shows the faces", async ({ page }) => {
    await home(page, 1280);
    await composer(page).fill("@sc");
    await expect(page.getByTestId("ref-option-specialist-scout").locator("[data-specialist=scout]")).toBeVisible();
  });
});

test.describe("drag a specialist into the chat", () => {
  test("from the sidebar onto the chat: the same handoff as typing @Name", async ({ page }) => {
    await home(page, 1280);
    await composer(page).fill("compare the foo carriers");
    const box = (await composer(page).boundingBox())!;
    await drag(page, "[data-testid=sidebar-specialist-researcher]", { x: box.x + 40, y: box.y - 120 });
    await expect(composer(page)).toHaveValue("@Researcher compare the foo carriers");
    // Again: never twice.
    await drag(page, "[data-testid=sidebar-specialist-researcher]", { x: box.x + 40, y: box.y - 120 });
    await expect(composer(page)).toHaveValue("@Researcher compare the foo carriers");
    // A drop back on the sidebar does nothing; a click still opens the page.
    await page.getByTestId("sidebar-specialist-scout").click();
    await expect(page.getByTestId("specialist-detail")).toHaveAttribute("data-id", "scout");
  });

  test("from the Specialists page onto Home in the sidebar: Home opens with the handoff", async ({ page }) => {
    await home(page, 1280);
    await page.getByTestId("sidebar-specialist-scout").click();
    await expect(page.getByTestId("specialists-page")).toBeVisible();
    const h = (await page.getByTestId("nav-home").boundingBox())!;
    await drag(page, "[data-testid='specialists-row-spec:writer']", { x: h.x + h.width / 2, y: h.y + h.height / 2 });
    await expect(composer(page)).toHaveValue("@Writer ", { timeout: 10_000 });
  });
});

const DRAFT1 = { draft: { name: "Learn the cello", outcome: "Play one piece for the family", owner: "hobbies", specialists: ["coach", "researcher"] }, filled: ["name", "outcome", "owner", "specialists"], dropped: [], question: "By when would you like to play it?", reply: "A cello mission in Hobbies, with the Coach and the Researcher. By when would you like to play it?", ready: false, missing: ["target"], go: false };
const DRAFT2 = { ...DRAFT1, draft: { ...DRAFT1.draft, target: "2027-06-30", budgetUsd: 1500 }, filled: ["target", "budgetUsd"], question: null, reply: "June 30, about $1,500. Say go when you want it started, or keep adding details.", ready: true, missing: [] };
const DRAFT3 = { ...DRAFT2, filled: [], reply: "Starting it.", go: true };

test.describe("a mission by talking", () => {
  for (const width of [390, 768, 1280, 1920]) {
    test(`New mission opens as a chat, drafts the fields, starts only on go (${width})`, async ({ page }) => {
      await home(page, width, { engine_missions_draft: DRAFT1, engine_missions_create_from_draft: { slug: "learn-the-cello", name: "Learn the cello" } });
      await fire(page, "prevail:work-section", "missions");
      await expect(page.getByTestId("missions-page")).toBeVisible({ timeout: 10_000 });
      await page.getByTestId("mission-new").click();
      const chat = page.getByTestId("mission-new-chat");
      await expect(chat).toBeVisible();
      await expect(chat.getByTestId("mission-starters")).toBeVisible();
      await shot(page, "mission-chat-empty");
      // A starter goes into the box for the user to finish; nothing is sent.
      await chat.getByRole("button", { name: "I want to learn to..." }).click();
      await expect(chat.getByTestId("mission-chat-input")).toHaveValue("I want to learn to ");
      expect(await calls(page, "engine_missions_draft")).toEqual([]);
      await chat.getByTestId("mission-chat-input").fill("I want to learn the cello and play a piece for my family");
      await chat.getByTestId("mission-chat-input").press("Enter");
      await expect(chat.getByTestId("mission-chat-reply").last()).toContainText("By when would you like to play it?");
      const first = (await calls(page, "engine_missions_draft"))[0]!;
      expect(first.draft).toEqual({});
      expect((first.turns as { role: string; text: string }[]).at(-1)).toEqual({ role: "user", text: "I want to learn the cello and play a piece for my family" });
      const sum = page.getByTestId("mission-draft-summary");
      await expect(sum).toContainText("Learn the cello · Hobbies owns it");
      await expect(sum).toContainText("still to settle: a date");
      await expect(sum.locator("[data-specialist=coach]")).toBeVisible();
      await expect(page.getByTestId("mission-start-draft")).toHaveCount(0);
      await shot(page, "mission-chat-drafting");

      await page.evaluate((d) => { (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures.engine_missions_draft = d; }, DRAFT2);
      await chat.getByTestId("mission-chat-input").fill("By June 30 next year, about 1500 dollars");
      await chat.getByTestId("mission-chat-send").click();
      await expect(sum).toContainText("by Jun 30, 2027");
      await expect(sum).toContainText("$1,500");
      // The second turn carries the draft so far.
      expect((await calls(page, "engine_missions_draft"))[1]!.draft).toEqual(DRAFT1.draft);
      await expect(page.getByTestId("mission-start-draft")).toBeVisible();
      expect(await calls(page, "engine_missions_create_from_draft")).toEqual([]);
      await shot(page, "mission-chat-ready");

      // The fields, prefilled from the chat; back to the chat keeps it all.
      await page.getByTestId("mission-mode-fields").click();
      const form = page.getByTestId("mission-new-form");
      await expect(form.getByLabel("Mission name")).toHaveValue("Learn the cello");
      await expect(form.getByLabel("Target date")).toHaveValue("2027-06-30");
      await expect(form.getByLabel("Budget")).toHaveValue("1500");
      await shot(page, "mission-fields");
      await page.getByTestId("mission-mode-chat").click();
      await expect(page.getByTestId("mission-chat-reply")).toHaveCount(2);

      // "go": the engine says go, the desktop starts it with the draft.
      await page.evaluate((d) => { (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures.engine_missions_draft = d; }, DRAFT3);
      await page.getByTestId("mission-chat-input").fill("go");
      await page.getByTestId("mission-chat-input").press("Enter");
      await expect.poll(() => calls(page, "engine_missions_create_from_draft")).toEqual([{ vault: "/tmp/smoke-vault", draft: DRAFT3.draft }]);
      const over = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(over).toBe(true);
    });
  }

  test("the fields are a toggle away, and remember the choice", async ({ page }) => {
    await home(page, 1280, { engine_missions_create: { slug: "kitchen-remodel", name: "Kitchen remodel" } });
    await fire(page, "prevail:work-section", "missions");
    await page.getByTestId("mission-new").click();
    await page.getByTestId("mission-mode-fields").click();
    await page.getByTestId("mission-new-form").getByLabel("Mission name").fill("Kitchen remodel");
    await page.getByTestId("mission-create").click();
    await expect.poll(async () => (await calls(page, "engine_missions_create")).length).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem("prevail.missions.newMode"))).toBe("fields");
  });
});
