// Metrics M4 (qualitative and alignment): the weekly review card's ladder,
// WHO-5, hypothesis, guardrail and a paused row; the Compass's matters vs
// lived bars; Insights > Metrics > Patterns with lags, proxies, themes,
// seasons and the WHO-5 switch. Invented data only. With M4_SHOTS=<dir>, each
// view is captured at 390, 768, 1280 and 1920.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

/** Today and the weekly review live in the Inbox's Briefing tab (Home is the chat). */
async function openBriefing(page: Page, which: "today" | "week" = "today") {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "inbox" })));
  await page.getByTestId("tab-briefing").click({ timeout: 15_000 });
  await page.getByTestId(`briefing-${which}`).click();
  await page.getByTestId(which === "today" ? "today-card" : "review-card").waitFor({ timeout: 15_000 });
}


const N = (lo: number, hi: number) => ({ lo, hi, learning: false });
const REVIEW = {
  week: "2026-09-28", through: "2026-10-02", due: true, checkin: null, calmNormal: 4,
  lines: { moved: [], drifted: [], conflict: "No conflict with evidence this week." },
  glance: [{ id: "m-commits", title: "Commits", unit: "count", value: 2, documentary: false, normal: N(5, 12), paused: "Foo Valley trip" }, { id: "m-ai-spend", title: "AI spend", unit: "usd", value: 42.5, documentary: false, normal: N(20, 50) }],
  surprise: null, candidates: [], metricProposals: [], question: null, woop: [], waited: [], interruptions: { used: 0, budget: 3 }, apps: null,
  asked: { ladder: true, who5: true },
  hypothesis: { key: "heavy-week:2026-09-28", text: "Heavy week? Emails 2.1x your normal, after-hours meetings up." },
  guardrails: ["Videos published is up while weekly calm slipped to 2 (normal 4)."],
};
const LIVED = [
  { id: "v-family", title: "Family presence", rank: 1, matters: 5, lived: 3, metrics: [{ id: "m-family-hours", title: "Family time on the calendar", value: 6, score: 3, basis: "6 hours a week against your normal of 5 to 9" }], checkin: 3, unmeasured: false },
  { id: "v-learning", title: "Lifelong learning with a rather long value name to wrap", rank: 2, matters: 4, lived: null, metrics: [], unmeasured: true },
];
const METRICS: Record<string, unknown> = {
  lived: LIVED,
  lags: [{ input: "m-sleep", outcome: "m-calm", weeks: 14, best_lag: 1, r: 0.62, p: 0.01, verdict: "moves it", text: "More sleep goes with calmer weeks one week later (14 weeks). A pattern, not proof." }, { input: "m-commits", outcome: "m-shipped", weeks: 6, best_lag: null, r: null, p: null, verdict: "too early", text: "Commits and things shipped: too early, 6 weeks of data." }],
  proxies: [{ proxy: "m-after-hours", felt: "m-calm", weeks: 4, r: null, p: null, status: "hidden", text: "After-hours meetings for calm: hidden until it predicts your check-ins (4 of 8 weeks)." }],
  themes: [{ kind: "writing", month: "2026-10", topics: ["ai tools", "travel", "rentals"], new: ["travel"], gone: ["taxes"], steady: ["ai tools", "rentals"], state: "a pattern, in words; never a mood score" }, { kind: "reading", month: "", topics: [], new: [], gone: [], steady: [], state: "off: turn on Browsing topics in Sources" }],
  seasons: [{ id: "s-foo", title: "Foo Valley trip", from: "2026-09-26", to: "2026-10-04", pauses: ["m-commits", "m-shipped"], auto: true }],
};
const COMPASS = `# Compass

## Values

- Family presence ~id:v-family ~rank:1 ~status:confirmed
  words: "Being there for dinner."
- Lifelong learning with a rather long value name to wrap ~id:v-learning ~rank:2 ~status:confirmed
`;

const SHOTS = process.env.M4_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()?.width}.png` });
}
const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? [])
    .filter((e) => e.cmd === c).map((e) => e.args), cmd);
async function noOverflow(page: Page) {
  const over = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("[data-testid]")].filter((e) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      if ((e as HTMLElement).parentElement?.closest("[data-scroll-x]")) return false;
      return r.width > 0 && (r.right > vw + 1 || r.left < -1);
    }).map((e) => (e as HTMLElement).dataset.testid).slice(0, 5);
  });
  expect(over).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}
async function setup(page: Page, width: number) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await mockTauri(page, { engine_today: null, engine_review: REVIEW, engine_review_answer: { ok: true }, metrics_who5_state: false, compass_read: COMPASS, compass_versions: [], compass_ledger: [] });
  await page.addInitScript((fx) => {
    (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures.engine_metrics = (a: { view: string }) => (fx as Record<string, unknown>)[a.view] ?? null;
  }, METRICS);
  await page.goto("/");
}

for (const width of [390, 768, 1280, 1920]) {
  const phone = width < 500;
  test.describe(`metrics M4 · ${width}`, () => {
    test("the review card asks the ladder, the WHO-5 and one hypothesis; a guardrail and a paused row", async ({ page }) => {
      await setup(page, width);
      await openBriefing(page, "week");
      const r = page.getByTestId("review-card");
      await expect(r).toBeVisible({ timeout: 15_000 });
      await expect(r.getByTestId("review-paused")).toHaveText("paused for Foo Valley trip");
      await expect(r.getByTestId("review-guardrail")).toContainText("weekly calm slipped");
      await expect(r.getByTestId("review-hypothesis")).toContainText("Heavy week?");
      await noOverflow(page);
      await shot(page, "review-m4");
      await r.getByTestId("hypothesis-yes").click();
      await expect.poll(() => calls(page, "engine_review_answer")).toEqual([{ vault: "/tmp/smoke-vault", kind: "hypothesis", values: ["heavy-week:2026-09-28", "yes"] }]);
      const ladder = r.getByTestId("review-ladder");
      await ladder.getByRole("button", { name: "Where you stand now: higher" }).click();
      await ladder.getByRole("button", { name: "Where you will stand in five years: higher" }).click();
      await ladder.getByRole("button", { name: "Where you will stand in five years: higher" }).click();
      await ladder.getByTestId("ladder-save").click();
      await expect.poll(async () => (await calls(page, "engine_review_answer"))[1]).toEqual({ vault: "/tmp/smoke-vault", kind: "ladder", values: ["6", "7"] });
      const who5 = r.getByTestId("review-who5");
      await expect(who5.getByTestId("who5-save")).toBeDisabled();
      for (let i = 0; i < 5; i++) await who5.getByTestId(`who5-${i}`).selectOption(String(i % 6));
      await who5.getByTestId("who5-save").click();
      await expect.poll(async () => (await calls(page, "engine_review_answer"))[2]).toEqual({ vault: "/tmp/smoke-vault", kind: "who5", values: ["0", "1", "2", "3", "4"] });
    });

    test("Insights > Metrics > Patterns: lags, proxies, themes, seasons, the WHO-5 switch", async ({ page }) => {
      await setup(page, width);
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "insights" })));
      await page.getByTestId("tab-metrics").click();
      await page.getByTestId("metrics-row-patterns").click();
      const p = page.getByTestId("metrics-patterns");
      await expect(p.getByTestId("pattern-lag").first()).toContainText("A pattern, not proof.");
      await expect(p.getByTestId("pattern-proxy")).toContainText("hidden");
      await expect(p.getByTestId("pattern-themes-writing")).toContainText("New: travel");
      await expect(p.getByTestId("pattern-themes-reading")).toContainText("off: turn on Browsing topics");
      await expect(p.getByTestId("pattern-season")).toContainText("2026-09-26 to 2026-10-04, pauses 2 metrics");
      await noOverflow(page);
      await shot(page, "patterns");
      await p.getByTestId("who5-toggle").click();
      await expect.poll(() => calls(page, "engine_review_answer")).toEqual([{ vault: "/tmp/smoke-vault", kind: "who5-toggle", values: ["on"] }]);
      if (phone) await expect(page.getByTestId("spine-detail")).toBeVisible();
    });
  });
}
