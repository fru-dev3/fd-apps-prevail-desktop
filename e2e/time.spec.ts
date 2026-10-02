// Today T5 on the weekly card: the calendar by value against rank, next week
// against capacity, a protected block that waits for a yes, a drafted
// decline that is yours to send, and the honest "not connected". Invented
// data only. With PLANS_SHOTS=<dir>, captured at 390, 768, 1280 and 1920.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const N = (lo: number, hi: number) => ({ median: (lo + hi) / 2, lo, hi, weeks: 8, learning: false, learningWeeksLeft: 0 });
const TIME = {
  thisWeek: { week: "2026-09-28", connected: true, hours: 11, meetings: 8, focus: 1, afterHours: 2, unlinked: 3, lines: ["You rank Family presence first; it got 18% of your calendar hours."],
    byValue: [{ id: "v-fam", title: "Family presence", rank: 1, hours: 2, share: 18, expected: 61 }, { id: "v-foo", title: "Foo craft with a long value name", rank: 2, hours: 3, share: 27, expected: 28 }] },
  warning: "Next week has 11 hours of meetings, over your 8; that leaves 29 of 40 hours for everything else.",
  holds: [{ id: "hold-abc123", title: "Weekly bar practice (Bar league season)", start: "2026-10-05T13:00:00.000Z", end: "2026-10-05T16:00:00.000Z", for: "initiative:p-bar", status: "ask" }],
  declines: [{ id: "decline-def456", title: "Vendor pitch", start: "2026-10-06T18:00:00.000Z", body: "Hi, I can't make \"Vendor pitch\" on Tuesday, Oct 6. Could you send the notes or the decision afterwards? Thank you." }],
};
const REVIEW = {
  week: "2026-09-28", through: "2026-10-02", due: true, checkin: null, calmNormal: 4,
  lines: { moved: [], drifted: [], conflict: "No conflict with evidence this week." }, glance: [{ id: "m-ai-spend", title: "AI spend", unit: "usd", value: 42.5, documentary: false, normal: N(20, 50) }],
  surprise: null, candidates: [], metricProposals: [], question: null, woop: [], waited: [], interruptions: { used: 0, budget: 3 }, apps: null, time: TIME,
};
const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? []).filter((e) => e.cmd === c).map((e) => e.args), cmd);
async function noOverflow(page: Page) {
  const over = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("[data-testid]")].filter((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1); }).map((e) => (e as HTMLElement).dataset.testid).slice(0, 5);
  });
  expect(over).toEqual([]);
}
async function setup(page: Page, width: number, review: unknown = REVIEW) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await mockTauri(page, { engine_today: null, engine_review: review, engine_time_hold: { ok: true } });
  await page.goto("/");
}

test("the weekly card's time: by value against rank, next week warned, a hold to approve, a decline to copy", async ({ page }) => {
  await setup(page, 1280);
  const t = page.getByTestId("review-time");
  await expect(t).toBeVisible({ timeout: 15_000 });
  await expect(t).toContainText("11 h on the calendar · 8 h meetings · 1 h focus · 2 h after hours");
  await expect(t).toContainText("You rank Family presence first; it got 18%");
  await expect(t.getByTestId("review-time-warning")).toContainText("over your 8");
  await t.getByTestId("review-hold-approve").click();
  await expect.poll(async () => (await calls(page, "engine_time_hold"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "hold-abc123", action: "approve" });
  await expect(t.getByTestId("review-decline")).toContainText("a draft, yours to send");
});

test("no calendar: the card says so by name", async ({ page }) => {
  await setup(page, 1280, { ...REVIEW, time: { thisWeek: { week: "2026-09-28", connected: false, note: "No calendar is connected on this Mac (Google sign-in), so time by value waits for it.", hours: 0, meetings: 0, focus: 0, afterHours: 0, byValue: [], unlinked: 0, lines: [] }, warning: null, holds: [], declines: [] } });
  await expect(page.getByTestId("review-time-off")).toHaveText("No calendar is connected on this Mac (Google sign-in), so time by value waits for it.", { timeout: 15_000 });
});

for (const width of [390, 768, 1280, 1920]) {
  test(`layout at ${width}: the time block fits`, async ({ page }) => {
    await setup(page, width);
    await expect(page.getByTestId("review-time")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("review-time").scrollIntoViewIfNeeded();
    await noOverflow(page);
    if (process.env.PLANS_SHOTS) await page.getByTestId("review-time").screenshot({ path: `${process.env.PLANS_SHOTS}/time-${width}.png` });
  });
}
