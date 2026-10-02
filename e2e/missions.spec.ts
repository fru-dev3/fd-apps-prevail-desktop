// Missions (missions-plan.md): the sidebar MISSIONS section, the Missions page
// (list by status, New mission, the sticky header with its chips and icon
// actions, the tabs), Bring in, milestones, a spend, the close-out with its
// filing preview and Undo, the mission's chat (scoped to `_mission-<slug>`)
// with its bring-in and start cards, a domain page's missions, prompt
// projects starting a mission, the goal's Mission picker, and the Purpose
// label on the Compass. Invented names only. With MISSION_SHOTS=<dir>, each
// view is captured at 390, 768, 1280 and 1920.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const T = Date.parse("2026-10-02T12:00:00Z");
const progress = (o: Partial<{ done: number; total: number; used: number; planned: number; left: number }> = {}) => ({
  milestones: { done: o.done ?? 1, total: o.total ?? 3, share: 0.25, next: { id: "ms-term-one", title: "Term one finished", done: false, weight: 2, due: "2026-12-15" }, overdue: [] },
  budget: { planned: o.planned ?? 1500, used: o.used ?? 640, share: (o.used ?? 640) / (o.planned ?? 1500), byLine: [{ id: "instrument", label: "Instrument", planned: 600, used: 520 }, { id: "lessons", label: "Lessons", planned: 800, used: 120 }] },
  days: { day: 12, total: 273, left: o.left ?? 261 },
});
const CELLO = {
  slug: "learn-the-cello", id: "mission/learn-the-cello", name: "Learn the cello", status: "active", outcome: "Play three pieces for the family by June", why: "Music on Sundays", notes: "",
  start: "2026-09-21", target: "2027-06-30", cadence: "weekly",
  domains: [{ slug: "hobbies", role: "owner" }, { slug: "money", role: "consulted" }, { slug: "family", role: "informed" }],
  apps: ["foo-calendar"], specialists: ["researcher", "scout"], people: ["person/tutor-example"], entities: [],
  budget: { total_usd: 1500, lines: [{ id: "instrument", label: "Instrument", usd: 600 }, { id: "lessons", label: "Lessons", usd: 800 }] },
  serves: [], prompt_projects: [], ceiling: "draft", nudges: { per_week: 1, muted: false }, privacy: { localOnly: false }, localOnly: false,
  progress: progress(),
  milestones: [
    { id: "ms-instrument", title: "Instrument at home", done: true, doneOn: "2026-10-01", weight: 1 },
    { id: "ms-term-one", title: "Term one finished", done: false, due: "2026-12-15", weight: 2, check: "m-lessons>=10" },
    { id: "ms-three", title: "Three pieces for the family", done: false, due: "2027-06-30", weight: 3 },
  ],
  links: { calendar: [{ app: "foo-calendar", event: "ev-1", title: "Cello lesson", start: "2026-10-04T10:00", source: "matched" }], tasks: [], files: [], threads: [{ domain: "general", thread: "t-old", title: "Cello thoughts" }] },
  artifacts: [{ path: "data/missions/learn-the-cello/memory/briefs/2026-10-02-tutors.md", name: "2026-10-02-tutors.md", kind: "brief", mtime: T }],
  log: ["2026-10-02 Spent $120.00 on lessons: Term one fee", "2026-09-21 Project started: Play three pieces for the family by June"],
  closed: false,
};
const SHED = { ...CELLO, slug: "paint-the-shed", id: "mission/paint-the-shed", name: "Paint the shed", outcome: "Shed painted before the frost", status: "paused", target: "2026-11-01", domains: [{ slug: "homestead", role: "owner" }], apps: [], specialists: [], people: [], progress: progress({ done: 0, total: 1, used: 0, planned: 0, left: 30 }), milestones: [], artifacts: [], log: [] };
const PLAN = {
  slug: "learn-the-cello", name: "Learn the cello", result: "partly", resultNote: "", summary: "Learn the cello: partly.",
  filings: [
    { n: 1, kind: "summary", domain: "hobbies", text: "Learn the cello (2026-09-21 to 2026-10-02): partly.", apply: true },
    { n: 2, kind: "lesson", domain: "hobbies", text: "Saturday lessons stuck; weekday practice did not", apply: true },
    { n: 3, kind: "note", domain: "money", text: "Project Learn the cello completed (partly).", apply: true },
    { n: 4, kind: "note", domain: "family", text: "Project Learn the cello completed (partly).", apply: true },
    { n: 5, kind: "money", domain: "money", text: "Spent $640.00 of $1500.00. Refs: plaid:txn-foo.", apply: true },
    { n: 6, kind: "task", domain: "hobbies", text: "Book next term ~id:t9", apply: true, action: "move" },
  ],
};
const FILED = [{ n: 1, ts: Date.now(), kind: "summary", domain: "hobbies", file: "data/domains/hobbies/memory/memory.md", text: "Learn the cello: partly." }, { n: 2, ts: Date.now(), kind: "note", domain: "family", file: "data/domains/family/memory/updates.jsonl", text: "Recital on June 14" }];
const prompt = (slug: string, title: string, domain: string) => ({ slug, title, domain, kind: "plan", summary: "A foo.", status: "active", prompt_count: 30,
  first_ts: T - 20 * 864e5, last_ts: T, monthly: { "2026-09": 30 }, tools: { "foo-tool": 30 }, pack_dir: "", brief_model: "", brief_ts: 0, intents: [], takeaways: [], ideas: [], open_questions: [] });
const FIX = {
  ui_settings_get: JSON.stringify({ theme: "light" }),
  read_ideal_state: "", read_omega: "", read_user_md: "", read_memory_md: "",
  scan_vault: ["hobbies", "money", "family", "homestead"].map((name) => ({ name, path: `/tmp/smoke-vault/data/domains/${name}`, has_state: true, state_preview: null })),
  engine_missions_list: [CELLO, SHED],
  engine_missions_show: CELLO,
  engine_missions_create: { ...CELLO, slug: "kitchen-remodel", id: "mission/kitchen-remodel", name: "Kitchen remodel" },
  engine_missions_set: CELLO, engine_missions_attach: CELLO, engine_missions_milestone: { ok: true }, engine_missions_budget: { ok: true },
  engine_missions_state: CELLO, engine_missions_closeout_plan: PLAN, engine_missions_closeout_apply: { ok: true, receipts: FILED }, engine_missions_undo: { ok: true },
  engine_specialists: [{ id: "researcher", name: "Researcher", on: true }, { id: "scout", name: "Scout", on: true }, { id: "planner", name: "Planner", on: true }],
  engine_jobs: [{ id: "j-1", ask: "Find me three weekend tutors", status: "done", created: T, domains: { owner: "mission/learn-the-cello" } }],
  apps_mirror_list: { apps: [{ id: "foo-calendar", name: "Foo Calendar", status: "connected", runtime: "claude" }, { id: "bar-mail", name: "Bar Mail", status: "connected", runtime: "claude" }] },
  list_threads: [],
  projects_index: { generated_ts: T, model: "x", recommendations: [], projects: [prompt("bar-garden", "bar garden", "homestead")] },
  engine_suggest_structure: [{ id: "project:bar-garden", kind: "project", title: "Start a project for Bar Garden?", reason: "You came back to it in 5 sittings.", confidence: 0.7, evidence: [] }],
  engine_suggest_accept: { ok: true, kind: "project", project: { id: "mission/bar-garden" } },
  engine_suggest_dismiss: { ok: true },
  engine_recommendations: { ok: true, recommendations: [] },
  goals_files_read: [{ domain: "general", body: "- [ ] Play for the family ~id:g-1 ~status:active\n" }],
  goals_file_write: "ok",
  domain_context: { state: "", decisions: "", journal: "", recent_logs: [], skills: [], layoutV4: true },
};

const SHOTS = process.env.MISSION_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()?.width}.png` });
}
const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? [])
    .filter((e) => e.cmd === c).map((e) => e.args), cmd);
const fire = (page: Page, name: string, detail: unknown) =>
  page.evaluate(([n, d]) => window.dispatchEvent(new CustomEvent(n as string, { detail: d })), [name, detail] as [string, unknown]);

/** Nothing on the page may be wider than the window, and nothing cut at the right. */
async function noOverflow(page: Page) {
  const over = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("[data-testid]")].filter((e) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(e as HTMLElement);
      // A tab strip that scrolls sideways (phone) may hold tabs past the edge; the strip itself must fit.
      if ((e as HTMLElement).parentElement?.closest("[data-scroll-x]")) return false;
      return r.width > 0 && s.visibility !== "hidden" && (r.right > vw + 1 || r.left < -1);
    }).map((e) => (e as HTMLElement).dataset.testid).slice(0, 5);
  });
  expect(over).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}

async function home(page: Page, width: number, extra: Record<string, unknown> = {}) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await page.addInitScript(() => localStorage.setItem("prevail.desktop.defaultChatCli", "claude"));
  await mockTauri(page, { ...FIX, ...extra });
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
}
async function openMissions(page: Page) {
  await fire(page, "prevail:work-section", "missions");
  await expect(page.getByTestId("missions-page")).toBeVisible({ timeout: 10_000 });
}
async function openCello(page: Page, phone: boolean) {
  await openMissions(page);
  if (phone) await page.getByTestId("mission-row").first().click();
  await expect(page.getByTestId("mission-header")).toContainText("Learn the cello", { timeout: 10_000 });
}

// The Compass chain (G1b): a mission says the initiative, goal and objective it serves (the vision on hover).
const CHAIN_TREE = {
  schema: 2, levels: [], domainGoals: { total: 0, linked: 0 }, tasks: { open: 0, linked: 0 },
  nodes: [
    { id: "vi-x", level: "vision", title: "A foo home full of music", status: "confirmed", parents: [], children: ["o-x"], linked: true },
    { id: "o-x", level: "objective", title: "Three pieces a year for the family", status: "confirmed", parents: ["vi-x"], children: ["g-1"], linked: true },
    { id: "g-1", level: "goal", title: "Play for the family", status: "active", parents: ["o-x"], children: ["p-lessons"], linked: true },
    { id: "p-lessons", level: "initiative", title: "Weekly cello lessons", status: "chosen", parents: ["g-1"], children: ["mission/learn-the-cello"], linked: true },
    { id: "mission/learn-the-cello", level: "mission", title: "Learn the cello", status: "active", parents: ["p-lessons"], children: [], linked: true },
  ],
};
test("a project names the initiative, goal and objective it serves", async ({ page }) => {
  await home(page, 1280, { engine_compass_tree: CHAIN_TREE });
  await openCello(page, false);
  const c = page.getByTestId("mission-header").getByTestId("mission-chain");
  await expect(c).toHaveText("Serves Weekly cello lessons > Play for the family > Three pieces a year for the family");
  await expect(c).toHaveAttribute("title", /Vision: A foo home full of music/);
});

for (const width of [390, 768, 1280, 1920]) {
  const phone = width < 500;
  test.describe(`projects · ${width}`, () => {
    test("the sidebar's PROJECTS section, the page, its header and every tab fit the window", async ({ page }) => {
      await home(page, width);
      if (!phone) {
        const side = page.getByTestId("sidebar-missions");
        await expect(side.getByTestId("sidebar-mission-learn-the-cello")).toContainText("261d", { timeout: 10_000 });
        await expect(side.getByTestId("sidebar-missions-paused")).toContainText("Paused (1)");
        await expect(page.getByTestId("app-sidebar").getByText(/^Missions?$/)).toHaveCount(0);
        await side.getByTestId("sidebar-mission-learn-the-cello").click();
        await expect(page.getByTestId("mission-header")).toContainText("Learn the cello", { timeout: 10_000 });
      } else {
        await openCello(page, phone);
      }
      const h = page.getByTestId("mission-header");
      await expect(h.getByTestId("mission-meta")).toContainText("Active · day 12 of 273 · target Jun 30, 2027 · 1 of 3 milestones · $640 of $1,500");
      await expect(h.getByTestId("mission-chips")).toContainText("Owner");
      await expect(h.getByTestId("mission-chips")).toContainText("Reads");
      await expect(h.getByTestId("mission-chips")).toContainText("Tells");
      // The team as faces; their names on hover.
      await expect(h.getByTestId("mission-team")).toContainText("2 specialists");
      await expect(h.getByTestId("mission-team")).toHaveAttribute("title", "Researcher, Scout");
      await expect(h.getByTestId("mission-chips")).toContainText("Not linked to a goal");
      await noOverflow(page);
      await shot(page, "mission-chat");
      for (const t of ["milestones", "tasks", "calendar", "budget", "artifacts", "timeline", "setup"]) {
        await h.getByTestId(`mission-tab-${t}`).click();
        await expect(page.getByTestId(`mission-${t}`)).toBeVisible();
        await noOverflow(page);
        if (["milestones", "budget", "setup"].includes(t)) await shot(page, `mission-${t}`);
      }
      await expect(page.getByTestId("mission-milestones")).toHaveCount(0);
      await h.getByTestId("mission-tab-milestones").click();
      await expect(page.getByTestId("mission-milestones")).toContainText("Term one finished");
      // The header stays put while the tab scrolls.
      await expect(h).toBeInViewport();
      await h.getByTestId("mission-bring").click();
      await expect(page.getByTestId("mission-bring-panel")).toBeVisible();
      await noOverflow(page);
      await shot(page, "mission-bring-in");
      await h.getByTestId("mission-complete").click();
      await expect(page.getByTestId("mission-closeout")).toContainText("Saturday lessons stuck", { timeout: 10_000 });
      await noOverflow(page);
      await shot(page, "mission-closeout");
    });
  });
}

test.describe("projects · actions", () => {
  test("the list by status; a new project from the form", async ({ page }) => {
    await home(page, 1280);
    await openMissions(page);
    const col = page.getByTestId("missions-list");
    await expect(col.getByTestId("mission-row")).toHaveCount(1);
    await page.getByTestId("tab-paused").click();
    await expect(col.getByTestId("mission-row")).toContainText("Paint the shed");
    await expect(col.getByTestId("suggested-mission")).toContainText("Bar Garden");
    await page.getByTestId("mission-new").click();
    // New mission opens as a chat; the fields are a toggle away.
    await page.getByTestId("mission-mode-fields").click();
    const form = page.getByTestId("mission-new-form");
    await form.getByLabel("Project name").fill("Kitchen remodel");
    await form.getByLabel("Outcome").fill("New counters in by spring");
    await form.getByLabel("Owner domain").selectOption("homestead");
    await form.getByLabel("Budget").fill("4000");
    await form.getByTestId("mission-create").click();
    await expect.poll(() => calls(page, "engine_missions_create")).toEqual([{ vault: "/tmp/smoke-vault", name: "Kitchen remodel", outcome: "New counters in by spring", target: null, owner: "homestead", consult: null, inform: null, apps: null, specialists: null, budgetUsd: 4000, milestones: null, fromPromptProject: null }]);
    await col.getByTestId("suggested-start").click();
    await expect.poll(async () => (await calls(page, "engine_missions_create")).map((a) => a.fromPromptProject)).toEqual([null, "bar-garden"]);
  });

  test("header actions, bring in, a milestone, a spend, setup: each one call to the engine", async ({ page }) => {
    await home(page, 1280);
    await openCello(page, false);
    const h = page.getByTestId("mission-header");
    await h.getByTestId("mission-pause").click();
    await expect.poll(() => calls(page, "engine_missions_state")).toEqual([{ vault: "/tmp/smoke-vault", slug: "learn-the-cello", action: "pause", target: null }]);
    await h.getByTestId("mission-bring").click();
    const b = page.getByTestId("mission-bring-panel");
    await b.getByLabel("Add a domain").selectOption("homestead");
    await b.getByLabel("Add an app").selectOption("bar-mail");
    await b.getByLabel("Add an agent").selectOption("planner");
    await b.getByLabel("Money role").selectOption("informed");
    await expect.poll(async () => (await calls(page, "engine_missions_attach")).map((a) => `${a.kind}:${a.value}`)).toEqual(["domain:homestead:consulted", "app:bar-mail", "specialist:planner", "domain:money:informed"]);
    await h.getByTestId("mission-tab-milestones").click();
    await page.getByLabel("Mark Term one finished done").click();
    await page.getByLabel("New milestone").fill("First piece");
    await page.getByRole("button", { name: "Add milestone" }).click();
    await expect.poll(async () => (await calls(page, "engine_missions_milestone")).map((a) => [a.op, a.id ?? a.title])).toEqual([["done", "ms-term-one"], ["add", "First piece"]]);
    await h.getByTestId("mission-tab-budget").click();
    await page.getByLabel("Line").fill("lessons");
    await page.getByLabel("Amount").fill("120");
    await page.getByLabel("What").fill("Term one fee");
    await page.getByRole("button", { name: "Spent" }).click();
    await expect.poll(() => calls(page, "engine_missions_budget")).toEqual([{ vault: "/tmp/smoke-vault", slug: "learn-the-cello", op: "spend", line: "lessons", usd: 120, what: "Term one fee" }]);
    await h.getByTestId("mission-tab-setup").click();
    await page.getByLabel("Ceiling").selectOption("read");
    await expect.poll(() => calls(page, "engine_missions_set")).toEqual([{ vault: "/tmp/smoke-vault", slug: "learn-the-cello", field: "ceiling", value: "read" }]);
  });

  test("complete: result, untick a line, move a task, file; then Undo from the Timeline", async ({ page }) => {
    await home(page, 1280);
    await openCello(page, false);
    await page.getByTestId("mission-header").getByTestId("mission-complete").click();
    const c = page.getByTestId("mission-closeout");
    await c.getByTestId("closeout-result-met").click();
    await expect.poll(async () => (await calls(page, "engine_missions_closeout_plan")).map((a) => a.result)).toContain("met");
    await c.getByLabel("File Note to family").uncheck();
    await c.getByRole("button", { name: "Drop" }).click();
    await c.getByTestId("closeout-apply").click();
    await expect.poll(async () => (await calls(page, "engine_missions_closeout_apply")).length).toBe(1);
    const sent = (await calls(page, "engine_missions_closeout_apply"))[0]!.plan as typeof PLAN;
    expect(sent.result).toBe("met");
    expect(sent.filings.find((f) => f.n === 4)!.apply).toBe(false);
    expect(sent.filings.find((f) => f.n === 6)!.action).toBe("drop");
    await expect(page.getByTestId("mission-closeout-done")).toContainText("2 lines filed");
    await page.evaluate(([m, f]) => { (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures.engine_missions_show = (a: { part?: string }) => (a.part === "filed" ? f : m); }, [CELLO, FILED] as [unknown, unknown]);
    await page.getByTestId("mission-header").getByTestId("mission-tab-timeline").click();
    await page.getByRole("button", { name: "Undo Recital on June 14" }).click();
    await expect.poll(() => calls(page, "engine_missions_undo")).toEqual([{ vault: "/tmp/smoke-vault", slug: "learn-the-cello", n: 2 }]);
  });

  test("the project's chat goes to the engine as _mission-<slug>, with no desktop preambles; its cards answer", async ({ page }) => {
    await home(page, 1280);
    await openCello(page, false);
    const box = page.getByTestId("mission-chat").locator("[data-tour=composer] textarea").first();
    await expect(box).toBeVisible({ timeout: 10_000 });
    await box.fill("What do my taxes say about the lesson fees?");
    await box.press("Enter");
    await expect.poll(async () => (await calls(page, "engine_chat")).length).toBe(1);
    const [first] = await calls(page, "engine_chat");
    expect(first).toMatchObject({ domain: "_mission-learn-the-cello", message: "What do my taxes say about the lesson fees?" });
    await page.evaluate((s) => {
      const emit = (window as unknown as { __emit: (e: string, p: unknown) => void }).__emit;
      const text = "This needs taxes, which is not in the project. Bring it in for this question, for the project, or not?";
      for (const data of [{ type: "start" }, { type: "bring_in", bringIn: { mission: "learn-the-cello", domains: ["taxes"], never: false, why: "taxes is not in the project" } }, { type: "delta", text }, { type: "assistant", text }]) emit("engine-chat:line", { session: s, data });
      emit("engine-chat:done", { session: s, code: 0 });
    }, String(first!.session));
    const card = page.getByTestId("bring-in-card");
    await expect(card).toContainText("Bring in Taxes?", { timeout: 10_000 });
    await card.getByTestId("bring-in-turn").click();
    await expect(box).toHaveValue("What do my taxes say about the lesson fees?");
    await box.press("Enter");
    await expect.poll(async () => (await calls(page, "engine_chat")).length).toBe(2);
    expect((await calls(page, "engine_chat"))[1]).toMatchObject({ domain: "_mission-learn-the-cello", refDomains: ["taxes"] });
  });

  test("a start card from a domain chat makes a project only on Start", async ({ page }) => {
    await home(page, 1280);
    await fire(page, "prevail:open-domain", "hobbies");
    const box = page.locator("[data-tour=composer] textarea").first();
    await expect(box).toBeVisible({ timeout: 10_000 });
    await box.fill("Start a project to learn the cello");
    await box.press("Enter");
    await expect.poll(async () => (await calls(page, "engine_chat")).length).toBe(1);
    const [first] = await calls(page, "engine_chat");
    await page.evaluate((s) => {
      const emit = (window as unknown as { __emit: (e: string, p: unknown) => void }).__emit;
      const text = "This sounds like a project: Learn the cello. Start it?";
      for (const data of [{ type: "start" }, { type: "mission_start", missionDraft: { name: "Learn the cello", outcome: "learn the cello", owner: "hobbies", consulted: [], specialists: ["researcher"] } }, { type: "delta", text }, { type: "assistant", text }]) emit("engine-chat:line", { session: s, data });
      emit("engine-chat:done", { session: s, code: 0 });
    }, String(first!.session));
    const card = page.getByTestId("mission-start-card");
    await expect(card).toContainText("Learn the cello", { timeout: 10_000 });
    expect(await calls(page, "engine_missions_create")).toEqual([]);
    await card.getByTestId("mission-start").click();
    await expect.poll(() => calls(page, "engine_missions_create")).toEqual([{ vault: "/tmp/smoke-vault", name: "Learn the cello", outcome: "learn the cello", target: null, owner: "hobbies", consult: [], inform: null, apps: null, specialists: ["researcher"], budgetUsd: null, milestones: null, fromPromptProject: null }]);
    await expect(page.getByTestId("missions-page")).toBeVisible({ timeout: 10_000 });
  });

  test("a domain page lists its active projects; Intent says Prompt groups; the Compass says Purpose", async ({ page }) => {
    await home(page, 1280);
    await fire(page, "prevail:open-domain", "money");
    await expect(page.getByTestId("domain-missions")).toContainText("Learn the cello", { timeout: 10_000 });
    await expect(page.getByTestId("domain-missions")).toContainText("reads");
    await page.getByTestId("domain-mission-learn-the-cello").click();
    await expect(page.getByTestId("missions-page")).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => localStorage.setItem("prevail.mirror.view", "projects"));
    await fire(page, "prevail:open-settings", "intent");
    await expect(page.getByRole("tab", { name: /Prompt groups/ })).toBeVisible({ timeout: 10_000 });
    await fire(page, "prevail:work-section", "compass");
    await expect(page.getByTestId("work-page").getByText("Purpose", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("an accepted project suggestion opens it; the goal's Project picker writes ~project:", async ({ page }) => {
    await home(page, 1280);
    await page.evaluate(() => localStorage.setItem("prevail.recs.category", "structure"));
    await fire(page, "prevail:work-section", "recommendations");
    await page.getByTestId("structure-card").first().getByTestId("structure-accept").click();
    await expect(page.getByTestId("missions-page")).toBeVisible({ timeout: 10_000 });
    await fire(page, "prevail:work-section", "goals");
    await page.getByTestId("goal-row").first().click();
    await page.getByTestId("goal-project").selectOption("learn-the-cello");
    await expect.poll(async () => (await calls(page, "goals_file_write")).map((a) => a.body)).toEqual(["- [ ] Play for the family ~id:g-1 ~status:active ~project:learn-the-cello\n"]);
  });
});
