// Metrics M6: household numbers with consent per person (someone who does not
// share reads "not shared", never zero), metric packs, and the phone glance
// (the Work tab's head and /?view=glance on its own). Invented data only.
// M6_SHOTS=<dir> captures the screens.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const FAMILY = [{ id: "m-family-dinners-together", title: "Dinners together", unit: "count", people: [
  { person: "me", name: "You", shared: true, weeks: [{ week: "2026-09-14", value: 3 }, { week: "2026-09-21", value: 4 }, { week: "2026-09-28", value: 2 }, { week: "2026-10-05", value: 5 }] },
  { person: "ada-foo", name: "Ada Foo", shared: true, weeks: [{ week: "2026-09-14", value: 2 }, { week: "2026-09-21", value: 3 }, { week: "2026-09-28", value: 3 }, { week: "2026-10-05", value: 4 }] },
  { person: "bo-bar", name: "Bo Bar", shared: false, weeks: [] },
] }];
const PACKS = [{ id: "creators", name: "Creators", who: "People who publish videos, writing or audio", specialists: [], compass: [], metrics: { track: ["m-videos"], define: [{ id: "m-pieces-published", title: "Pieces published" }] }, installed: { specialists: [], compass: [], metrics: [] } }];
const REVIEW = { week: "2026-10-05", through: "2026-10-08", due: true, checkin: null, calmNormal: null, lines: { moved: [], drifted: [], conflict: "" }, glance: [
  { id: "m-commits", title: "Commits", unit: "count", value: 42, documentary: false, normal: { lo: 20, hi: 35, learning: false } },
  { id: "m-ai-spend", title: "AI spend", unit: "usd", value: 61, documentary: false, normal: { lo: 40, hi: 90, learning: false } },
  { id: "m-trips", title: "Trips", unit: "count", value: 1, documentary: true, record: "Foo Lake", normal: { lo: 0, hi: 0, learning: true } },
], surprise: null, candidates: [], metricProposals: [], question: null, woop: [], waited: [] };
const TODAY = { date: "2026-10-08", generated: 1, items: [{ key: "t1", kind: "task", title: "Send the foo quote to Sam", domain: "money", thread: [], unlinked: true, why: "due today", score: 1, ref: {} }], alsoDue: [], feedback: [] };
const FIX = { engine_metrics_family: FAMILY, engine_metrics_say: { ok: true }, engine_metrics_family_add: { ok: true, id: "m-family-walks" }, engine_packs: PACKS, engine_pack_install: { pack: "creators", added: [{ part: "metrics", what: "Pieces published" }], skipped: [] }, engine_review: REVIEW, engine_today: TODAY, engine_review_checkin: { ok: true } };
const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? []).filter((e) => e.cmd === c).map((e) => e.args), cmd);
const SHOTS = process.env.M6_SHOTS;
const shot = async (page: Page, n: string) => { if (SHOTS) { await page.waitForTimeout(250); await page.screenshot({ path: `${SHOTS}/${n}-${page.viewportSize()?.width}.png` }); } };
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}

for (const width of [768, 1280, 1920]) {
  test(`household numbers and metric packs (${width})`, async ({ page }) => {
    page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
    await page.setViewportSize({ width, height: 900 });
    await mockTauri(page, FIX);
    await page.goto("/");
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "insights" })));
    await page.getByTestId("tab-metrics").click();
    await page.getByTestId("metrics-row-household").click();
    const people = page.getByTestId("family-person");
    await expect(people).toHaveCount(3);
    await expect(people.nth(2)).toContainText("not shared");
    await expect(people.nth(2).getByTestId("family-log")).toHaveCount(0);
    await people.nth(1).hover();
    await people.nth(1).getByTestId("family-log").click();
    await page.getByLabel("This week for Ada Foo").fill("4");
    await page.getByLabel("This week for Ada Foo").press("Enter");
    await expect.poll(async () => (await calls(page, "engine_metrics_say"))[0]).toMatchObject({ id: "m-family-dinners-together", value: 4, member: "ada-foo" });
    await page.getByLabel("A number your household keeps").fill("Walks together");
    await page.getByLabel("A number your household keeps").press("Enter");
    await expect.poll(async () => (await calls(page, "engine_metrics_family_add"))[0]).toMatchObject({ title: "Walks together" });
    await noOverflow(page);
    await shot(page, "m6-household");
    const show = page.getByRole("button", { name: /Show metrics/i });
    if (await show.isVisible().catch(() => false)) await show.click();
    await page.getByTestId("metrics-row-packs").click();
    await page.getByTestId("pack-row").first().hover();
    await page.getByTestId("pack-install").click();
    await expect.poll(async () => (await calls(page, "engine_pack_install"))[0]).toMatchObject({ id: "creators", only: "metrics" });
    await shot(page, "m6-packs");
  });
}

test.describe("the phone glance", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("heads the Work tab: numbers against the normal, the 1-5, the next thing", async ({ page }) => {
    await mockTauri(page, FIX);
    await page.goto("/");
    await expect(page.getByText("What should we work on?")).toBeVisible({ timeout: 15_000 });
    const handle = page.getByTestId("phone-nav-handle");
    if (await handle.count()) await handle.click();
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Work" }).click();
    const g = page.getByTestId("phone-glance");
    await expect(g.getByTestId("glance-tile")).toHaveCount(3);
    await expect(g.getByTestId("glance-tile").first()).toContainText("42");
    await expect(g.getByTestId("glance-next")).toContainText("Send the foo quote");
    await g.getByTestId("glance-calm-4").click();
    await expect.poll(async () => (await calls(page, "engine_review_checkin"))[0]).toMatchObject({ calm: 4 });
    await noOverflow(page);
    await shot(page, "m6-phone-work");
  });
  test("/?view=glance opens it alone, for the home screen", async ({ page }) => {
    await mockTauri(page, FIX);
    await page.goto("/?view=glance");
    await expect(page.getByTestId("phone-glance")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("What should we work on?")).toHaveCount(0);
    await noOverflow(page);
    await shot(page, "m6-phone-glance");
  });
});
