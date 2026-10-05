// Metrics M5: Your year (tiles, where the time went, the values race, places,
// the days, AI and tools, month by month), This month, patterns across the
// metrics turned into an experiment, and For You's line that opens the year.
// Invented data only. With PLANS_SHOTS=<dir>, captured at 390, 768, 1280, 1920.
import { test, expect, type Page } from "@playwright/test";
import { openChatTab } from "./open-chat";
import { mockTauri } from "./tauri-mock";

const days = (n: number, v: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1 + i * 3)).toISOString().slice(0, 10), value: v(i) }));
const RECAP = { month: "2026-09", lines: [{ id: "m-prompts", title: "Prompts you wrote", tier: "measured", value: 300, prev: 100, change: 200, unit: "count", documentary: false, from: "the prompt capture" }, { id: "m-trips", title: "Trips", tier: "measured", value: 2, prev: 1, change: 100, unit: "count", documentary: true, from: "the trip atlas" }], surprise: "Prompts you wrote rose 200% against the month before (100 to 300).", topDomains: [{ domain: "foo", share: 75 }, { domain: "bar", share: 25 }] };
const YEAR = {
  year: String(new Date().getFullYear()), through: "2026-10-02",
  ai: { prompts: 12840, usd: 1234.5, tokens: 9e7, sessions: 400, peak: { month: "2026-09", share: 61 }, byTool: [{ tool: "claude", usd: 1000, tokens: 8e7 }, { tool: "codex", usd: 234.5, tokens: 1e7 }] },
  building: { commits: 2100, aiCommits: 1900, repos: 48, shipped: 31, codingDays: 120 }, hour: 22,
  exploration: { trips: 14, places: [{ region: "Foo State · USA", place: "Minnesota", country: "USA", trips: 9, lat: 46.3, lon: -94.3 }, { region: "Egypt · Africa", place: "Egypt", country: "Egypt", trips: 5, lat: 26.8, lon: 30.8 }], countries: 2, photoDays: 0, newPlaces: 0, daysAway: 0 },
  time: [{ domain: "foo", share: 60 }, { domain: "a-domain-with-a-very-long-name-that-must-not-overflow", share: 25 }, { domain: "bar", share: 15 }],
  values: [{ id: "v-foo", title: "Foo craft", rank: 1, months: [{ month: "2026-08", share: 40 }, { month: "2026-09", share: 70 }] }, { id: "v-bar", title: "Bar calm", rank: 2, months: [{ month: "2026-08", share: 50 }, { month: "2026-09", share: 10 }] }],
  race: [{ month: "2026-08", order: ["v-bar", "v-foo"] }, { month: "2026-09", order: ["v-foo", "v-bar"] }],
  months: [{ ...RECAP }, { ...RECAP, month: "2026-10", partial: true, surprise: null }],
  tools: [{ app: "FooEdit", days: 40 }],
  heat: { calm: days(30, () => 4), focus: [], prompts: days(100, (i) => i % 7) },
  notes: [],
};
const PATTERNS = { tests: 120, found: [{ key: "m-workouts>m-calm@1", a: "m-workouts", b: "m-calm", aTitle: "Workouts", bTitle: "Weekly calm", lag: 1, r: 0.62, p: 0.001, weeks: 20, text: "Weeks with more workouts go with more weekly calm the week after (r 0.62 over 20 weeks, chance controlled across 120 tests). A pattern, not proof." }] };
const EXPS = { experiments: [{ id: "exp-a1", status: "proposed", inputTitle: "Workouts", outcomeTitle: "Weekly calm", hypothesis: "More workouts changes weekly calm.", instruction: "On A weeks, aim for more workouts than usual; on B weeks, as usual.", start: "2026-10-05", weeks: [] }], thisWeek: null };

const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? []).filter((e) => e.cmd === c).map((e) => e.args), cmd);
async function noOverflow(page: Page) {
  const over = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("[data-testid]")].filter((e) => {
      if ((e as HTMLElement).parentElement?.closest("[data-scroll-x]")) return false;
      const r = (e as HTMLElement).getBoundingClientRect();
      return r.width > 0 && (r.right > vw + 1 || r.left < -1);
    }).map((e) => (e as HTMLElement).dataset.testid).slice(0, 5);
  });
  expect(over).toEqual([]);
}
async function setup(page: Page, width: number) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await mockTauri(page, {
    engine_today: null, engine_review: null, engine_metrics: null, engine_metric_proposals: [], metrics_who5_state: false,
    engine_story_write: { ok: true, html: "x" }, engine_experiment: { ok: true },
  });
  await page.goto("/");
  await openChatTab(page); await expect(page.getByText("What should we work on?")).toBeVisible({ timeout: 15_000 });
  // One command, four answers: set it in the page (a fixture table entry may be a function there).
  await page.evaluate((d) => {
    (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures.engine_story = (a: { kind: string }) => (a.kind === "year" ? d.YEAR : a.kind === "recap" ? d.RECAP : a.kind === "patterns" ? d.PATTERNS : d.EXPS);
  }, { YEAR, RECAP, PATTERNS, EXPS });
}
async function openMetrics(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "insights" })));
  await page.getByTestId("tab-metrics").click();
}

test("Your year and This month: tiles, time, the values race, places, days, tools; Save as a page", async ({ page }) => {
  await setup(page, 1280);
  await openMetrics(page);
  await page.getByTestId("metrics-row-year").click();
  const y = page.getByTestId("metrics-year");
  await expect(y.getByTestId("year-tiles")).toContainText("12,840");
  await expect(y.getByTestId("year-tiles")).toContainText("61% in Sep");
  await expect(y.getByTestId("values-race")).toContainText("Foo craft");
  await expect(y.getByTestId("places-map").locator("circle")).toHaveCount(2);
  await expect(y.getByTestId("heat-grid").first().locator("rect").first()).toBeVisible();
  await expect(y.getByTestId("year-month")).toHaveCount(2);
  await y.getByTestId("story-save").click();
  await expect(y.getByTestId("story-saved")).toHaveText("Saved in General's reviews");
  await page.getByTestId("metrics-row-month").click();
  const m = page.getByTestId("metrics-month");
  await expect(m.getByTestId("recap-line").first()).toContainText("+200% on the month before");
  await expect(m.getByTestId("recap-line").nth(1)).toContainText("A record, no target");
  await expect(m.getByTestId("recap-surprise")).toContainText("rose 200%");
});

test("patterns across the metrics, tried as an experiment, then started", async ({ page }) => {
  await setup(page, 1280);
  await openMetrics(page);
  await page.getByTestId("metrics-row-patterns").click();
  const row = page.getByTestId("pattern-across").first();
  await expect(row).toContainText("A pattern, not proof.");
  await row.hover();
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Try it as an experiment" }).click();
  await expect.poll(async () => (await calls(page, "engine_experiment"))[0]).toEqual({ vault: "/tmp/smoke-vault", action: "propose", id: null, key: "m-workouts>m-calm@1" });
  await page.getByTestId("experiment-start").click();
  await expect.poll(async () => (await calls(page, "engine_experiment"))[1]).toEqual({ vault: "/tmp/smoke-vault", action: "start", id: "exp-a1", key: null });
});

for (const width of [390, 768, 1280, 1920]) {
  test(`layout at ${width}: Your year and This month fit`, async ({ page }) => {
    await setup(page, width);
    await openMetrics(page);
    await page.getByTestId("metrics-row-year").click();
    await expect(page.getByTestId("metrics-year").getByTestId("year-tiles")).toBeVisible();
    await noOverflow(page);
    if (process.env.PLANS_SHOTS) await page.screenshot({ path: `${process.env.PLANS_SHOTS}/year-${width}.png`, fullPage: false });
  });
}
