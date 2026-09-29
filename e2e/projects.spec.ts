// Projects you track and structure suggestions: the Work > Projects page
// (create, edit status, Chat with --entity project/<slug>, Track from
// Suggested), the goal's Project picker, the Structure cards' Accept / Not
// now / Never, and the Domains dot. With PROJ_SHOTS set, each view is
// captured at 1440 and 390. Invented names only.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const T = Date.parse("2026-09-20T12:00:00Z");
const TRIP = { id: "project/foo-trip", name: "Foo Trip", kind: "project", aliases: [], mention_count: 4, conversations: 3, last_ts: T, saved: true, has_page: true,
  status: "active", outcome: "Two weeks along the foo coast, back rested", target: "2026-12-01", domains: ["travel"], intent_project: "foo-trip-plan" };
const PIANO = { id: "project/bar-piano", name: "Bar Piano", kind: "project", aliases: [], mention_count: 2, conversations: 1, last_ts: T - 864e5, saved: true, has_page: true,
  status: "paused", outcome: "Play one bar song start to finish", domains: ["learning"] };
const SHOW = { found: true, ...TRIP, kinds: ["project"], mentions: [], digest: "", notes: "", page_path: "data/entities/projects/foo-trip/entity.md",
  co_mentions: [{ id: "place/foo-coast", name: "Foo Coast", kind: "place", count: 3 }],
  goals: [{ title: "Save for the foo trip", status: "active", domain: "wealth" }] };
const intentProject = (slug: string, title: string, domain: string) => ({ slug, title, domain, kind: "plan", summary: "A foo.", status: "active", prompt_count: 30,
  first_ts: T - 20 * 864e5, last_ts: T, monthly: { "2026-09": 30 }, tools: { "foo-tool": 30 }, pack_dir: "", brief_model: "", brief_ts: 0, intents: [], takeaways: [], ideas: [], open_questions: [] });
const SUGGESTIONS = [
  { id: "domain:foo-craft", kind: "domain", title: "Create a Foo Craft domain?", reason: "4 conversations about foo carving lessons since Sep 10.", confidence: 0.8,
    evidence: [{ thread: "2026-09-11_foo", ts: "2026-09-11T10:00:00Z", domain: "learning" }, { thread: "2026-09-14_bar", ts: "2026-09-14T10:00:00Z", domain: "wealth" }] },
  { id: "project:bar-garden", kind: "project", title: "Track Bar Garden as a project?", reason: "You came back to it in 5 sittings.", confidence: 0.7, evidence: [] },
  { id: "archive_domain:old-foo", kind: "archive_domain", title: "Archive Old Foo?", reason: "No conversations or updates in over a year.", confidence: 0.9, evidence: [] },
];
const FIX = {
  ui_settings_get: JSON.stringify({ theme: "light" }),
  read_ideal_state: "", read_omega: "", read_user_md: "", read_memory_md: "",
  scan_vault: ["travel", "learning", "wealth"].map((name) => ({ name, path: `/tmp/smoke-vault/data/domains/${name}`, has_state: true, state_preview: null })),
  entities_list: { generated_ts: 1, total: 2, entities: [TRIP, PIANO] },
  entities_show: SHOW,
  engine_entity_threads: [],
  engine_entities_files: [],
  engine_updates: [],
  projects_index: { generated_ts: T, model: "x", recommendations: [], projects: [intentProject("foo-trip-plan", "foo trip plan", "travel"), intentProject("bar-garden", "bar garden", "home")] },
  projects_restart: { slug: "foo-trip-plan", title: "foo trip plan", goal: "Plan the foo trip.", requirements: [{ text: "Stay near the coast", source: "you" }], rules: [], decisions: [], dead_ends: [], open_questions: [] },
  engine_projects_create: { id: "project/bar-garden", name: "Bar Garden", kind: "project", status: "active" },
  engine_projects_set: { ok: true },
  engine_suggest_structure: SUGGESTIONS,
  engine_suggest_accept: { ok: true, kind: "domain", domain: "foo-craft" },
  engine_suggest_dismiss: { ok: true },
  engine_recommendations: { ok: true, recommendations: [] },
  goals_files_read: [{ domain: "general", body: "- [ ] Save for the foo trip ~id:g-1 ~status:active\n" }],
  goals_file_write: "ok",
};

const SHOTS = process.env.PROJ_SHOTS;
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
const setFixture = (page: Page, cmd: string, v: unknown) =>
  page.evaluate(([c, val]) => { (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures[c as string] = val; }, [cmd, v] as [string, unknown]);

async function home(page: Page) {
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
}
async function openProjects(page: Page) {
  await home(page);
  await fire(page, "prevail:work-section", "projects");
  await expect(page.getByTestId("projects-page")).toBeVisible({ timeout: 10_000 });
}

for (const width of [1440, 390]) {
  const phone = width < 500;
  test.describe(`projects · ${width}`, () => {
    test.beforeEach(async ({ page }) => {
      page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
      await page.setViewportSize({ width, height: phone ? 844 : 900 });
      await page.addInitScript(() => localStorage.setItem("prevail.desktop.defaultChatCli", "claude"));
      await mockTauri(page, FIX);
    });

    test("the column lists tracked projects by status, and Suggested holds untracked Intent projects", async ({ page }) => {
      await openProjects(page);
      const col = page.getByTestId("tracked-projects-list");
      await expect(col.getByTestId("project-row")).toHaveCount(1);
      await expect(col.getByTestId("project-row")).toContainText("Foo Trip");
      await expect(col.getByTestId("project-row")).toContainText("Active · Target Dec 1, 2026");
      // foo-trip-plan is already tracked (Foo Trip came from it); bar-garden is not.
      await expect(col.getByTestId("suggested-project")).toHaveCount(1);
      await expect(col.getByTestId("suggested-project")).toContainText("Bar Garden");
      await shot(page, "projects-column");
      await page.getByTestId("tab-paused").click();
      await expect(col.getByTestId("project-row")).toContainText("Bar Piano");
      await page.getByTestId("tab-active").click();
      await col.getByTestId("project-row").first().click();
      const ov = page.getByTestId("project-overview");
      await expect(ov.getByLabel("Outcome")).toHaveValue("Two weeks along the foo coast, back rested", { timeout: 10_000 });
      await expect(ov.getByTestId("project-domains")).toContainText("Travel");
      await expect(ov.getByTestId("project-goals")).toContainText("Save for the foo trip");
      await expect(ov).toContainText("Foo Coast");
      await expect(ov).toContainText("Across your life");
      await shot(page, "project-overview");
      await page.getByTestId("entity-tab-brief").click();
      await expect(page.getByTestId("project-brief")).toContainText("Stay near the coast");
    });

    test("New project creates one and it shows in the column", async ({ page }) => {
      await openProjects(page);
      await page.getByTestId("project-new").click();
      await setFixture(page, "entities_list", { generated_ts: 2, total: 3, entities: [TRIP, PIANO, { ...PIANO, id: "project/foo-race", name: "Foo Race", status: "active", last_ts: T + 1 }] });
      await setFixture(page, "engine_projects_create", { id: "project/foo-race", name: "Foo Race", kind: "project", status: "active" });
      await page.getByLabel("Project name").fill("Foo Race");
      await page.getByLabel("Project name").press("Enter");
      await expect.poll(() => calls(page, "engine_projects_create")).toEqual([{ vault: "/tmp/smoke-vault", name: "Foo Race", outcome: null, target: null, domains: null, fromIntent: null }]);
      if (phone) await page.getByRole("button", { name: "All projects" }).click();
      await expect(page.getByTestId("tracked-projects-list").getByTestId("project-row").filter({ hasText: "Foo Race" })).toBeVisible();
    });

    test("editing the status writes it", async ({ page }) => {
      await openProjects(page);
      if (phone) await page.getByTestId("project-row").first().click();
      await page.getByTestId("project-status").selectOption("paused");
      await expect.poll(() => calls(page, "engine_projects_set")).toEqual([{ vault: "/tmp/smoke-vault", id: "project/foo-trip", status: "paused", outcome: null, target: null, domains: null }]);
    });

    test("the project Chat tab sends --entity project/<slug>", async ({ page }) => {
      await openProjects(page);
      if (phone) await page.getByTestId("project-row").first().click();
      await page.getByTestId("entity-tab-chat").click();
      const box = page.getByTestId("entity-chat").locator("[data-tour=composer] textarea").first();
      await expect(box).toBeVisible({ timeout: 10_000 });
      await box.fill("what is left to book for the foo trip");
      await box.press("Enter");
      await expect.poll(async () => (await calls(page, "engine_chat")).map((a) => a.entity)).toEqual(["project/foo-trip"]);
    });

    test("Track from Suggested creates one from the Intent project", async ({ page }) => {
      await openProjects(page);
      await page.getByTestId("suggested-track").click();
      await expect.poll(() => calls(page, "engine_projects_create")).toEqual([{ vault: "/tmp/smoke-vault", name: "Bar Garden", outcome: null, target: null, domains: null, fromIntent: "bar-garden" }]);
    });

    test("the goal's Project picker writes ~project:", async ({ page }) => {
      await home(page);
      await fire(page, "prevail:work-section", "goals");
      await page.getByTestId("goal-row").first().click();
      const picker = page.getByTestId("goal-project");
      await expect(picker).toBeVisible({ timeout: 10_000 });
      await shot(page, "goal-project-picker");
      await picker.selectOption("foo-trip");
      await expect.poll(async () => (await calls(page, "goals_file_write")).map((a) => a.body)).toEqual(["- [ ] Save for the foo trip ~id:g-1 ~status:active ~project:foo-trip\n"]);
    });

    test("Structure cards: Accept, Not now and Never each call the engine", async ({ page }) => {
      await home(page);
      await page.evaluate(() => localStorage.setItem("prevail.recs.category", "structure"));
      await fire(page, "prevail:work-section", "recommendations");
      const cards = page.getByTestId("structure-card");
      await expect(cards).toHaveCount(3, { timeout: 10_000 });
      await expect(cards.first()).toContainText("Create a Foo Craft domain?");
      await expect(cards.first().getByTestId("structure-evidence").locator("li")).toHaveCount(2);
      await shot(page, "structure-card");
      await cards.nth(2).getByTestId("structure-never").click();
      await expect.poll(() => calls(page, "engine_suggest_dismiss")).toEqual([{ vault: "/tmp/smoke-vault", id: "archive_domain:old-foo", forever: true }]);
      await cards.nth(1).getByTestId("structure-later").click();
      await expect.poll(async () => (await calls(page, "engine_suggest_dismiss")).length).toBe(2);
      expect((await calls(page, "engine_suggest_dismiss"))[1]).toEqual({ vault: "/tmp/smoke-vault", id: "project:bar-garden", forever: false });
      await cards.first().getByTestId("structure-accept").click();
      await expect.poll(() => calls(page, "engine_suggest_accept")).toEqual([{ vault: "/tmp/smoke-vault", id: "domain:foo-craft" }]);
    });

    test("an accepted project suggestion opens the new project", async ({ page }) => {
      await mockTauri(page, { ...FIX, engine_suggest_accept: { ok: true, kind: "project", project: { id: "project/bar-garden" } } });
      await home(page);
      await page.evaluate(() => localStorage.setItem("prevail.recs.category", "structure"));
      await fire(page, "prevail:work-section", "recommendations");
      await page.getByTestId("structure-card").nth(1).getByTestId("structure-accept").click();
      await expect(page.getByTestId("projects-page")).toBeVisible({ timeout: 10_000 });
      await expect.poll(() => calls(page, "entities_show")).toContainEqual({ vault: "/tmp/smoke-vault", id: "project/bar-garden" });
    });

    test("Intent > Projects keeps the inferred view, with Track as a project", async ({ page }) => {
      await home(page);
      await page.evaluate(() => localStorage.setItem("prevail.mirror.view", "projects"));
      await fire(page, "prevail:open-settings", "intent");
      await page.getByTestId("projects-list").getByText("Bar Garden").click({ timeout: 10_000 });
      await page.getByTestId("project-track").click();
      await expect.poll(async () => (await calls(page, "engine_projects_create")).map((a) => a.fromIntent)).toEqual(["bar-garden"]);
    });
  });
}

test("the Domains dot counts new-domain suggestions and opens Structure", async ({ page }) => {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await mockTauri(page, FIX);
  await home(page);
  const dot = page.getByTestId("sidebar-dot-domains");
  await expect(dot).toHaveText("1", { timeout: 10_000 });
  await dot.click();
  await expect(page.getByTestId("section-structure")).toBeVisible({ timeout: 10_000 });
});
