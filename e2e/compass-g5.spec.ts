// Goals G5 on the Compass page: values and roles over the years, the yearly
// review with odyssey lives sketched from the notes, and the export. Invented
// people and data only. COMPASS_SHOTS=<dir> captures 390, 768, 1280, 1920.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const COMPASS = "# Compass\n~schema:2\n\n## Purpose\nLive a calm foo life.\n\n## Values\n- Freedom ~id:v-freedom ~rank:1\n- Peace of mind ~id:v-peace ~rank:2\n\n## Roles\n- Parent ~id:r-parent\n";
const HISTORY = [
  { id: "v-freedom", kind: "value", title: "Freedom", now: true, rank: 1, first: "2026-01-04", events: [{ date: "2026-03-01", what: "rank", from: "2", to: "1" }] },
  { id: "v-peace", kind: "value", title: "Peace of mind", now: true, rank: 2, first: "2026-01-04", events: [] },
  { id: "r-builder", kind: "role", title: "Builder", now: false, first: "2026-01-04", events: [{ date: "2026-09-01", what: "dropped" }, { date: "2026-09-01", what: "status", from: "confirmed", to: "dropped", reason: "no longer me" }] },
];
const YEARLY = { year: 2026, file: "/v/data/domains/general/memory/reviews/year-2026.md", purpose: "Live a calm foo life.", sketches: [],
  text: "# Your yearly review, 2026\n\n## Three odyssey lives\n\n### Life one: the current path\nFive years on this road. What does a good year look like, and what does it cost?\nYour answer:\n\n### Life two: if that path vanished\nYour current work or plan is gone tomorrow. What would you do instead?\nYour answer:\n\n### Life three: if money did not matter\nMoney and what people think do not matter. What would you do with these years?\nYour answer:\n\n## One small prototype\n" };
const YEARLY2 = { ...YEARLY, sketches: [{ key: "free", sketch: "Summers at the foo lake, writing.", quote: "spend summers by the foo lake", from: "build/ideal-state.md" }] };
const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? []).filter((e) => e.cmd === c).map((e) => e.args), cmd);
async function setup(page: Page, width: number) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await mockTauri(page, {
    engine_today: null, engine_review: null, compass_read: COMPASS, compass_versions: [], compass_ledger: [], engine_compass_align: null,
    engine_compass_history: HISTORY, engine_compass_yearly: YEARLY, engine_compass_fresh: { starts: [{ kind: "new-quarter", text: "A new quarter: keep, switch or drop each initiative." }] },
    engine_compass_export: { file: "/v/build/exports/compass-constitution-2026-10-02.md", text: "# My constitution\n" },
  });
  await page.goto("/");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "compass" })));
  await expect(page.getByTestId("compass-list")).toBeVisible({ timeout: 15_000 });
}
async function noOverflow(page: Page) {
  const over = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("[data-testid]")].filter((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1) && !(e as HTMLElement).closest("[data-scroll-x]"); }).map((e) => (e as HTMLElement).dataset.testid).slice(0, 5);
  });
  expect(over).toEqual([]);
}
/** Back to the Compass list: on a phone the back button, on a narrow window the folded column. */
async function list(page: Page) {
  const back = page.getByTestId("compass-page").getByRole("button", { name: /^Compass$/ }).first();
  if (await back.isVisible().catch(() => false)) await back.click();
  const show = page.getByRole("button", { name: "Show the Compass" });
  if (await show.isVisible().catch(() => false)) await show.click();
}
const shot = async (page: Page, name: string, width: number) => { if (process.env.COMPASS_SHOTS) { await page.waitForTimeout(250); await page.screenshot({ path: `${process.env.COMPASS_SHOTS}/${name}-${width}.png` }); } };

for (const width of [390, 768, 1280, 1920]) {
  test.describe(`compass G5 · ${width}`, () => {
    test("history: values and roles over the years; the yearly review sketches only from the notes", async ({ page }) => {
      await setup(page, width);
      await page.getByTestId("compass-row-history").click();
      await expect(page.getByTestId("history-values")).toContainText("rank 2 to 1");
      await expect(page.getByTestId("history-roles")).toContainText("no longer me");
      await noOverflow(page);
      await shot(page, "g5-history", width);
      await list(page);
      await page.getByTestId("compass-row-yearly").click();
      await expect(page.getByTestId("yearly-life")).toHaveCount(3);
      await expect(page.getByTestId("yearly-fresh")).toContainText("A new quarter");
      await page.evaluate((y) => { (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures.engine_compass_yearly = y; }, YEARLY2);
      await page.getByTestId("yearly-draft").click();
      await expect.poll(async () => (await calls(page, "engine_compass_yearly")).some((a) => a.draft === true)).toBe(true);
      await expect(page.getByTestId("yearly-sketch")).toContainText("Summers at the foo lake");
      await noOverflow(page);
      await shot(page, "g5-yearly", width);
    });

    test("the export", async ({ page }) => {
      await setup(page, width);
      await page.getByTestId("compass-export").click();
      await expect(page.getByTestId("compass-note")).toContainText("compass-constitution-2026-10-02.md");
      await noOverflow(page);
    });
  });
}
