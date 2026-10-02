// Goals G3: the Compass's Needs you (conflicts with evidence, Accept the
// tension, Resolved; rules at risk), rules as code checks them, said vs did,
// the job card's Serves / Watch / rule chips and the weekly card's conflict
// line with its evidence. Invented data only. With G3_SHOTS=<dir>, each view
// is captured at 390, 768, 1280 and 1920.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

/** The weekly review lives in the Inbox's Briefing tab (Home is the chat). */
async function openWeek(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "inbox" })));
  await page.getByTestId("tab-briefing").click({ timeout: 15_000 });
  await page.getByTestId("briefing-week").click();
}

const CONFLICT = { key: "presence:g-a-p1|g-b-p1", kind: "presence", a: "g-a-p1", b: "g-b-p1", aTitle: "Foo consulting", bTitle: "Family dinners", question: "Foo consulting means away often, but Family dinners needs home evenings. Do them in sequence, change one, or accept the tension?", evidence: ["Foo consulting means away often", "Family dinners needs home evenings"], confidence: 0.8, asserted_by: "code" };
const ROLLUP = {
  week: "2026-09-28", computed: 1,
  values: [{ id: "v-calm", title: "Calm", rank: 1, matters: 5, lived: 2, attention: 4, unmeasured: false }, { id: "v-free", title: "Freedom with a rather long value name that wraps", rank: 2, matters: 4, lived: null, attention: 96, unmeasured: true }],
  saidVsDid: ["You rank Calm first; it touched 4% of this month's activity."],
  conflicts: [CONFLICT],
  rules: [
    { id: "nn-debt", title: "No new debt", check: "new_debt_usd==0", state: "unchecked", value: null, detail: "new_debt_usd: not measured yet (Plaid liabilities)" },
    { id: "nn-sleep", title: "Seven hours of sleep", check: "sleep_hours>=7", state: "broken", value: 6.2, detail: "sleep_hours 6.2 (needs >= 7), from Apple Health or Oura" },
    { id: "nn-spend", title: "Spend under 3000 a month", check: "spend_usd_mo<=3000", state: "at-risk", value: 2900, detail: "spend_usd_mo 2900 (needs <= 3000), from card statements or Plaid" },
  ],
  needsYou: [
    { kind: "rule", key: "rule:nn-sleep", text: "Seven hours of sleep: broken (sleep_hours 6.2 (needs >= 7), from Apple Health or Oura)" },
    { kind: "conflict", key: CONFLICT.key, text: CONFLICT.question },
    { kind: "stalled", key: "stalled:g-b", text: "Bar cabin: quiet for six weeks. Keep, pause or let go?" },
  ],
};
const COMPASS = `# Compass

## Values

- Calm ~id:v-calm ~rank:1
- Freedom with a rather long value name that wraps ~id:v-free ~rank:2

## Non-negotiables

- No new debt ~id:nn-debt ~check:new_debt_usd==0
- Seven hours of sleep ~id:nn-sleep ~check:sleep_hours>=7
`;
const JOB = {
  id: "2026-10-02-081542-find-foo", ask: "Find the best foo consultancies to join", origin: { kind: "chat", domain: "foo" }, domains: { owner: "foo", consulted: [], informed: [] },
  team: [{ step: 1, specialists: ["researcher"] }], effort: "standard", budget: { usd: 1, minutes: 10 }, why: "compare", playbook: null,
  status: "proposed", startsAlone: false, askReason: "it touches your non-negotiable \"Spend under 3000 a month\"", created: 1,
  compass: { serves: [{ id: "g-a", title: "Foo independence" }, { id: "v-free", title: "Freedom" }], costs: [{ id: "v-family", title: "Family presence", why: "Family presence -1" }], rules: [{ id: "nn-spend", title: "Spend under 3000 a month", state: "at-risk" }] },
};
const REVIEW = {
  week: "2026-09-28", through: "2026-10-02", due: true, checkin: null, calmNormal: null,
  lines: { moved: [], drifted: [], conflict: CONFLICT.question },
  conflict: { key: CONFLICT.key, evidence: CONFLICT.evidence },
  glance: [], surprise: null, candidates: [], metricProposals: [], question: null, woop: [], waited: [], interruptions: { used: 0, budget: 3 }, apps: null,
};

const SHOTS = process.env.G3_SHOTS;
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
  await mockTauri(page, {
    engine_today: null, engine_review: REVIEW, compass_read: COMPASS, compass_versions: [], compass_ledger: [],
    engine_compass_align: ROLLUP, engine_compass_conflict: { ok: true }, engine_metrics: [],
    engine_jobs: [JOB], engine_job_show: { job: JOB, steps: [], filed: [], body: "" }, engine_specialists: [],
  });
  await page.goto("/");
}
const work = (page: Page, id: string) => page.evaluate((d) => window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: d })), id);

for (const width of [390, 768, 1280, 1920]) {
  test.describe(`goals G3 · ${width}`, () => {
    test("Compass: Needs you with evidence; accept a tension; rules as code checks them; said vs did", async ({ page }) => {
      await setup(page, width);
      await work(page, "compass");
      await page.getByTestId("compass-row-overview").click();
      const n = page.getByTestId("align-needs-you");
      await expect(n).toBeVisible({ timeout: 15_000 });
      await expect(n.getByTestId("align-need")).toHaveCount(3);
      await expect(n.getByTestId("align-evidence")).toContainText("Family dinners needs home evenings");
      await noOverflow(page);
      await shot(page, "compass-needs-you");
      await n.getByTestId("align-accept").click();
      await expect.poll(() => calls(page, "engine_compass_conflict")).toEqual([{ vault: "/tmp/smoke-vault", key: CONFLICT.key, answer: "accept" }]);
      if (width < 1101) await page.getByTestId("spine-detail").getByRole("button", { name: "Compass", exact: true }).first().click();
      await page.getByTestId("compass-row-rules").click();
      const rules = page.getByTestId("align-rules");
      await expect(rules.getByTestId("align-rule")).toHaveCount(3);
      await expect(rules.locator('[data-state="broken"]')).toContainText("Broken");
      await expect(rules.locator('[data-state="unchecked"]')).toContainText("The Steward judges it");
      await noOverflow(page);
      await shot(page, "compass-rules");
      if (width < 1101) await page.getByTestId("spine-detail").getByRole("button", { name: "Compass", exact: true }).first().click();
      await page.getByTestId("compass-row-values").click();
      await expect(page.getByTestId("said-vs-did")).toContainText("it touched 4%");
      await expect(page.getByTestId("said-row")).toHaveCount(2);
      await noOverflow(page);
      await shot(page, "compass-said");
    });

    test("a job card shows what it serves, what to watch and the rules it touches", async ({ page }) => {
      await setup(page, width);
      await work(page, "specialists");
      await page.getByTestId("specialists-row-jobs:waiting").click();
      await page.getByTestId("job-row").first().getByRole("button").first().click();
      const chips = page.getByTestId("job-compass");
      await expect(chips.getByTestId("job-serves")).toHaveText(["Serves Foo independence, Freedom"]);
      await expect(chips.getByTestId("job-watch")).toHaveText("Watch Family presence");
      await expect(chips.getByTestId("job-rule")).toHaveText("Spend under 3000 a month: At risk");
      await noOverflow(page);
      await shot(page, "job-chips");
    });

    test("the weekly card's conflict line carries its evidence and Accept the tension", async ({ page }) => {
      await setup(page, width);
      await openWeek(page);
      const c = page.getByTestId("review-conflict");
      await expect(c).toBeVisible({ timeout: 15_000 });
      await expect(c.getByTestId("review-conflict-evidence")).toContainText("Foo consulting means away often");
      await noOverflow(page);
      await shot(page, "review-conflict");
      await c.getByTestId("review-conflict-accept").click();
      await expect.poll(() => calls(page, "engine_compass_conflict")).toEqual([{ vault: "/tmp/smoke-vault", key: CONFLICT.key, answer: "accept" }]);
    });
  });
}
