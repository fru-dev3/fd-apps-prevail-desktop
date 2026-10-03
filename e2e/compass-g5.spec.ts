// Goals G5 on the Compass page: History as one list of every change, the
// yearly reviews (opened to edit, chat), and the export. Invented
// people and data only. COMPASS_SHOTS=<dir> captures 390, 768, 1280, 1920.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const COMPASS = "# Compass\n~schema:2\n\n## Purpose\nLive a calm foo life.\n\n## Values\n- Freedom ~id:v-freedom ~rank:1\n- Peace of mind ~id:v-peace ~rank:2\n\n## Roles\n- Parent ~id:r-parent\n";
const YEARLY = { year: 2026, file: "/v/data/domains/general/memory/reviews/year-2026.md", purpose: "Live a calm foo life.", sketches: [],
  text: "# Your yearly review, 2026\n\n## Three odyssey lives\n\n### Life one: the current path\nFive years on this road. What does a good year look like, and what does it cost?\nYour answer:\n\n### Life two: if that path vanished\nYour current work or plan is gone tomorrow. What would you do instead?\nYour answer:\n\n### Life three: if money did not matter\nMoney and what people think do not matter. What would you do with these years?\nYour answer:\n\n## One small prototype\n" };
const LEDGER = [
  { ts: Date.parse("2026-10-02T10:00:00Z"), id: "v-freedom", from: "Liberty", to: "Freedom", reason: "edited", by: "user" },
  { ts: Date.parse("2026-09-01T10:00:00Z"), id: "r-parent", from: "confirmed", to: "archived", reason: "archived", by: "user" },
];
const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? []).filter((e) => e.cmd === c).map((e) => e.args), cmd);
async function setup(page: Page, width: number) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await mockTauri(page, {
    engine_today: null, engine_review: null, compass_read: COMPASS, compass_versions: [], compass_ledger: LEDGER, engine_compass_align: null,
    engine_compass_yearly: YEARLY, engine_compass_yearly_list: [{ ...YEARLY, updated: Date.parse("2026-10-02T10:00:00Z") }, { ...YEARLY, year: 2025, file: "/v/y-2025.md", updated: Date.parse("2025-12-30T10:00:00Z") }], engine_compass_yearly_save: { ok: true, file: "/v/y.md" }, engine_compass_fresh: { starts: [{ kind: "new-quarter", text: "A new quarter: keep, switch or drop each initiative." }] },
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
    test("history is one list of every change; the yearly reviews open to edit and to chat", async ({ page }) => {
      await setup(page, width);
      await page.getByTestId("compass-row-history").click();
      const rows = page.getByTestId("history-row");
      await expect(rows.first()).toContainText("Freedom");
      await expect(rows.first()).toContainText("Edited");
      await expect(rows.first()).toContainText("Liberty");
      await expect(rows.nth(1)).toContainText("Archived");
      await noOverflow(page);
      await shot(page, "g5-history", width);
      await list(page);
      await page.getByTestId("compass-row-yearly").click();
      await expect(page.getByTestId("compass-detail-yearly")).toContainText("Once a year");
      await expect(page.getByTestId("yearly-row")).toHaveCount(2);
      const y = page.getByTestId("yearly-row").first();
      await y.getByTestId("line-open").click();
      await y.getByRole("textbox").fill(`${YEARLY.text}\nMore lake.\n`);
      await y.getByTestId("yearly-save").click();
      await expect.poll(async () => (await calls(page, "engine_compass_yearly_save"))[0]).toMatchObject({ year: 2026 });
      await noOverflow(page);
      await shot(page, "g5-yearly", width);
    });

    test("the export", async ({ page }) => {
      await setup(page, width);
      await page.getByTestId("compass-row-overview").click();
      await page.getByTestId("compass-export").click();
      await expect(page.getByTestId("compass-note")).toContainText("compass-constitution-2026-10-02.md");
      await noOverflow(page);
    });
  });
}
