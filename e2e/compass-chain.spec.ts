// Goals G1b: the Compass chain on the Compass page. The list follows the chain
// top to bottom (Purpose, Values, Mission statement, Vision, Objectives, Life
// goals), each line says what it serves and what moves it, the Chain view
// draws the tree with what is not linked, a proposed link is one tap, and an
// initiative names the mission it runs as. The tree is the engine's own output
// for an invented vault (prevail compass tree --json). With PLANS_SHOTS=<dir>,
// captured at 390, 768, 1280 and 1920.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const COMPASS = "# Compass\n~schema:2\n\n## Purpose\nLive a calm foo life.\n\n## Values\n- Peace of mind ~id:v-peace ~rank:1\n- Family presence ~id:v-family ~rank:2\n\n## Mission statement\n- Build calm foo tools for families ~id:st-tools ~serves:v-peace,v-family\n\n## Vision\n- A foo home that runs on its own ~id:vi-home\n\n## Objectives\n- Twelve months of costs in cash ~id:o-cash ~metric:cash_months ~target:12 ~due:2028-12-31\n- Weekly foo hikes with the kids ~id:o-hikes\n\n## Goals\n- [ ] Bar cash buffer ~id:g-buffer ~objective:o-cash ~serves:v-peace ~status:active ~domain:money\n  initiative: Automatic foo savings ~id:p-auto ~status:chosen ~until:2027-06-30\n    mission: foo-savings-drive\n- [ ] Hike the foo ridge with my son, every season of the year, with a much longer title that wraps ~id:g-ridge ~serves:v-family ~status:confirmed ~domain:family\n\n## Roles\n- Parent ~id:r-parent\n";
const TREE = {"schema": 2, "nodes": [{"children": ["v-peace", "v-family"], "linked": true, "id": "purpose", "level": "purpose", "title": "Live a calm foo life.", "status": "confirmed", "parents": []}, {"children": ["st-tools"], "linked": true, "id": "v-peace", "level": "value", "title": "Peace of mind", "status": "confirmed", "parents": ["purpose"], "implicit": true}, {"children": ["st-tools"], "linked": true, "id": "v-family", "level": "value", "title": "Family presence", "status": "confirmed", "parents": ["purpose"], "implicit": true}, {"children": ["vi-home"], "linked": true, "id": "st-tools", "level": "statement", "title": "Build calm foo tools for families", "status": "confirmed", "parents": ["v-peace", "v-family"]}, {"children": ["o-cash", "o-hikes"], "linked": true, "id": "vi-home", "level": "vision", "title": "A foo home that runs on its own", "status": "confirmed", "parents": ["st-tools"], "implicit": true}, {"children": ["g-buffer"], "linked": true, "id": "o-cash", "level": "objective", "title": "Twelve months of costs in cash", "status": "confirmed", "parents": ["vi-home"], "implicit": true, "metric": "cash_months", "target": "12", "due": "2028-12-31"}, {"children": [], "linked": true, "id": "o-hikes", "level": "objective", "title": "Weekly foo hikes with the kids", "status": "confirmed", "parents": ["vi-home"], "implicit": true, "needs": ["metric"]}, {"children": ["p-auto"], "linked": true, "id": "g-buffer", "level": "goal", "title": "Bar cash buffer", "status": "active", "parents": ["o-cash"], "domain": "money"}, {"children": ["mission/foo-savings-drive", "task:money:t1"], "linked": true, "id": "p-auto", "level": "initiative", "title": "Automatic foo savings", "status": "chosen", "parents": ["g-buffer"], "domain": "money", "mission": {"slug": "foo-savings-drive", "name": "Foo savings drive", "status": "active"}}, {"children": [], "linked": false, "id": "g-ridge", "level": "goal", "title": "Hike the foo ridge with my son, every season of the year, with a much longer title that wraps", "status": "confirmed", "parents": [], "domain": "family"}, {"children": [], "linked": true, "id": "mission/foo-savings-drive", "level": "mission", "title": "Foo savings drive", "status": "active", "parents": ["p-auto"]}, {"children": [], "linked": true, "id": "task:money:t1", "level": "task", "title": "Set up the foo transfer", "status": "open", "parents": ["p-auto"], "domain": "money"}], "levels": [{"level": "purpose", "label": "Purpose", "count": 1, "notLinked": 0}, {"level": "value", "label": "Values", "count": 2, "notLinked": 0}, {"level": "statement", "label": "Mission statement", "count": 1, "notLinked": 0}, {"level": "vision", "label": "Vision", "count": 1, "notLinked": 0}, {"level": "objective", "label": "Objectives", "count": 2, "notLinked": 0}, {"level": "goal", "label": "Goals", "count": 2, "notLinked": 1}, {"level": "initiative", "label": "Initiatives", "count": 1, "notLinked": 0}, {"level": "mission", "label": "Projects", "count": 1, "notLinked": 0}, {"level": "task", "label": "Tasks", "count": 1, "notLinked": 1}], "domainGoals": {"total": 0, "linked": 0}, "tasks": {"open": 2, "linked": 1}};
const LINKS = [{"kind": "goal-objective", "from": "g-ridge", "to": "o-hikes", "quote": "Hike the foo ridge with my son, every season of the year, with a much longer title that wraps", "source": "family goals", "by": "code", "domain": "family", "id": "c4fdfc11b9", "fromTitle": "Hike the foo ridge with my son, every season of the year, with a much longer title that wraps", "toTitle": "Weekly foo hikes with the kids", "status": "proposed", "ts": 1790975974583}];
const INITIATIVES = { goal: "g-buffer", title: "Bar cash buffer", paths: [{ id: "p-auto", title: "Automatic foo savings", status: "chosen", hours: 1, usd: 0, stress: 0, until: "2027-06-30", mission: "foo-savings-drive", values: [] }], left: [] };

const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? []).filter((e) => e.cmd === c).map((e) => e.args), cmd);
const work = (page: Page, id: string) => page.evaluate((d) => window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: d })), id);
async function noOverflow(page: Page) {
  const over = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("[data-testid]")].filter((e) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      return r.width > 0 && (r.right > vw + 1 || r.left < -1);
    }).map((e) => (e as HTMLElement).dataset.testid).slice(0, 5);
  });
  expect(over).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}
async function setup(page: Page, width: number) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await mockTauri(page, {
    engine_today: null, engine_review: null, compass_read: COMPASS, compass_versions: [], compass_ledger: [], engine_compass_align: null,
    engine_compass_tree: TREE, engine_compass_links: LINKS, engine_compass_link: { ok: true }, engine_initiatives: INITIATIVES,
  });
  await page.goto("/");
  await work(page, "compass");
}
const shot = async (page: Page, name: string, width: number) => {
  if (process.env.PLANS_SHOTS) { await page.waitForTimeout(250); await page.screenshot({ path: `${process.env.PLANS_SHOTS}/${name}-${width}.png` }); }
};

test("the list follows the chain; Not linked is counted, never blocked", async ({ page }) => {
  await setup(page, 1280);
  const nav = page.getByTestId("compass-list");
  await expect(nav.getByTestId("compass-row-objectives")).toBeVisible({ timeout: 15_000 });
  const order = await nav.locator("[data-testid^=compass-row-]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid!.replace("compass-row-", "")));
  expect(order).toEqual(["overview", "chain", "mission", "values", "statement", "vision", "objectives", "goals", "roles", "rules", "routines", "history"]);
  await expect(nav.getByTestId("compass-row-goals")).toContainText("1 not linked");
  await expect(nav.getByTestId("compass-row-chain")).toContainText("Not linked: 1 goal · 1 task");
});

test("each line says what it serves and what moves it; children unfold", async ({ page }) => {
  await setup(page, 1280);
  await page.getByTestId("compass-row-objectives").click();
  const cash = page.locator('[data-testid=compass-item][data-id=o-cash]');
  await expect(cash.getByTestId("chain-up")).toHaveText("Toward A foo home that runs on its own", { timeout: 10_000 });
  await expect(cash).toContainText("Measured by cash_months, target 12");
  await expect(page.locator('[data-testid=compass-item][data-id=o-hikes]')).toContainText("No measure yet");
  await cash.getByTestId("chain-down").click();
  await expect(cash.getByTestId("chain-children")).toContainText("Bar cash buffer");
  await page.getByTestId("compass-row-statement").click();
  await expect(page.locator('[data-testid=compass-item][data-id=st-tools]').getByTestId("chain-up")).toHaveText("Serves Peace of mind, Family presence");
});

test("a goal not linked says so, and the proposed link is its one primary action; initiatives name their project", async ({ page }) => {
  await setup(page, 1280);
  await page.getByTestId("compass-row-goals").click();
  const ridge = page.locator('[data-testid=compass-item][data-id=g-ridge]');
  await expect(ridge.getByTestId("chain-not-linked-row")).toHaveText("Not linked to an objective", { timeout: 10_000 });
  await expect(ridge).toContainText("Moves Weekly foo hikes with the kids?");
  await ridge.hover();
  await ridge.getByTestId("compass-link-accept").click();
  await expect.poll(async () => (await calls(page, "engine_compass_link"))[0]).toEqual({ vault: "/tmp/smoke-vault", action: "accept", id: "c4fdfc11b9", to: null });
  const buffer = page.locator('[data-testid=compass-item][data-id=g-buffer]');
  await expect(buffer.getByTestId("chain-up")).toHaveText("Toward Twelve months of costs in cash");
  await expect(buffer.getByTestId("initiative").first()).toContainText("Runs as Foo savings drive");
});

test("the Chain view draws the tree from the purpose to the task, with links to check", async ({ page }) => {
  await setup(page, 1280);
  await page.getByTestId("compass-row-chain").click();
  const view = page.getByTestId("chain-view");
  await expect(view.getByTestId("chain-not-linked")).toHaveText("Not linked: 1 goal · 1 task", { timeout: 10_000 });
  await expect(view.locator('[data-testid=chain-node][data-level=purpose]')).toContainText("Live a calm foo life.");
  await expect(view.locator('[data-testid=chain-node][data-id=o-cash]')).toContainText("Bar cash buffer");
  // Levels below goals start folded: unfold the goal to reach the initiative, its mission and its task.
  await view.getByRole("button", { name: "Unfold Bar cash buffer" }).click();
  await view.getByRole("button", { name: "Unfold Automatic foo savings" }).click();
  await expect(view.locator('[data-testid=chain-node][data-id=p-auto]')).toContainText("Runs as Foo savings drive");
  await expect(view.locator('[data-testid=chain-node][data-level=task]')).toContainText("Set up the foo transfer");
  await expect(view.getByTestId("chain-link")).toContainText("Moves Weekly foo hikes with the kids");
  await expect(view.getByTestId("chain-loose")).toContainText("Goals (1)");
  // The word on screen is "Mission statement", never a bare "Mission" for the Compass level.
  await expect(page.getByTestId("compass-list")).not.toContainText(/Mission(?! statement)/);
});

for (const width of [390, 768, 1280, 1920]) {
  test(`layout at ${width}: the chain fits`, async ({ page }) => {
    await setup(page, width);
    const phone = width < 1100;
    await page.getByTestId("compass-row-chain").click();
    await expect(page.getByTestId("chain-view")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Unfold Bar cash buffer" }).click();
    await noOverflow(page);
    await shot(page, "compass-chain", width);
    if (phone) await page.getByTestId("spine-detail").getByRole("button", { name: "Compass", exact: true }).click();
    await page.getByTestId("compass-row-objectives").click();
    await expect(page.getByTestId("compass-detail-objectives")).toBeVisible();
    await noOverflow(page);
    await shot(page, "compass-objectives", width);
    if (phone) await page.getByTestId("spine-detail").getByRole("button", { name: "Compass", exact: true }).click();
    await page.getByTestId("compass-row-goals").click();
    await expect(page.getByTestId("compass-detail-goals")).toBeVisible();
    await noOverflow(page);
    await shot(page, "compass-goals", width);
  });
}

test("Today names a task's chain in one line: short, the whole walk on hover", async ({ page }) => {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width: 1280, height: 900 });
  const item = { key: "task:money:t1", kind: "task", title: "Set up the foo transfer", domain: "money", due: "2026-10-02", thread: ["Automatic foo savings", "Bar cash buffer", "Twelve months of costs in cash", "A foo home that runs on its own"], unlinked: false, why: "due today", score: 1, ref: { domain: "money", id: "t1" } };
  await mockTauri(page, {
    engine_today: { date: "2026-10-02", generated: 1, calm: null, items: [item], fallingBehind: null, decisionDue: null, yourDay: { connected: false, note: "" }, alsoDue: [], feedback: [], promises: [], added: [] },
    engine_review: null, compass_read: COMPASS, engine_compass_tree: TREE,
  });
  await page.goto("/");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "inbox" })));
  await page.getByTestId("tab-briefing").click({ timeout: 15_000 });
  await page.getByTestId("briefing-today").click();
  const t = page.getByTestId("today-thread").first();
  await expect(t).toHaveText("Automatic foo savings · A foo home that runs on its own", { timeout: 15_000 });
  await expect(page.getByTestId("today-item").first().locator("p[title]").nth(1)).toHaveAttribute("title", "Automatic foo savings > Bar cash buffer > Twelve months of costs in cash > A foo home that runs on its own");
});
