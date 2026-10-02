// Today T6 on Home (and the phone): tell the chief of staff anything to keep,
// see where it was filed, Undo; "What am I forgetting?" opens the open loops
// inline. Invented data only. With PLANS_SHOTS=<dir>, captured at 390, 768,
// 1280 and 1920.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const TODAY = { date: "2026-10-02", generated: 1, calm: null, items: [], fallingBehind: null, decisionDue: null, yourDay: { connected: false, note: "No calendar is connected yet, so your day is not on the card." }, alsoDue: [], feedback: [], promises: [], added: [] };
const FORGET = { count: 3, sections: [
  { title: "Promises you made", items: [{ text: "Send the foo photos to Sam", why: "due 2026-10-02", domain: "general" }] },
  { title: "Decisions to make", items: [{ text: "Should I sell the foo bike?", why: "due 2026-10-15", domain: "money" }] },
  { title: "Overdue tasks", items: [{ text: "A foo task with a long name that has to be clamped on a narrow phone screen without overflow", why: "overdue since 2026-09-20", domain: "home" }] },
] };
const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? []).filter((e) => e.cmd === c).map((e) => e.args), cmd);
async function noOverflow(page: Page) {
  const over = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("[data-testid]")].filter((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1); }).map((e) => (e as HTMLElement).dataset.testid).slice(0, 5);
  });
  expect(over).toEqual([]);
}
async function setup(page: Page, width: number) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await mockTauri(page, {
    engine_today: TODAY, engine_review: null, engine_forgetting: FORGET, engine_tell_undo: { ok: true },
    engine_tell: { ok: true, told: { id: "tabc123", kind: "task", text: "Call the foo plumber", where: "Home's board, due 2026-10-02", due: "2026-10-02" }, reply: "Filed a task in Home's board, due 2026-10-02." },
  });
  await page.goto("/");
  await expect(page.getByTestId("today-card")).toBeVisible({ timeout: 15_000 });
}

test("tell anything: filed with a receipt and Undo; what am I forgetting opens inline", async ({ page }) => {
  await setup(page, 390);
  await page.getByTestId("tell-input").fill("remind me to call the foo plumber by Friday");
  await page.getByTestId("tell-input").press("Enter");
  await expect.poll(async () => (await calls(page, "engine_tell"))[0]).toEqual({ vault: "/tmp/smoke-vault", text: "remind me to call the foo plumber by Friday", surface: "phone", domain: null, mission: null });
  await expect(page.getByTestId("tell-receipt")).toContainText("Filed a task in Home's board");
  await page.getByTestId("tell-undo").click();
  await expect.poll(async () => (await calls(page, "engine_tell_undo"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "tabc123" });
  await expect(page.getByTestId("tell-receipt")).toContainText("Undone.");
  await page.getByTestId("tell-forgetting").click();
  const f = page.getByTestId("forgetting");
  await expect(f).toContainText("3 open loops");
  await expect(f.getByTestId("forgetting-item")).toHaveCount(3);
  await expect(f).toContainText("Should I sell the foo bike?");
});

test("desktop Home has no tell box; the composer files instead", async ({ page }) => {
  await setup(page, 1280);
  await expect(page.getByTestId("tell-input")).toHaveCount(0);
});

for (const width of [390]) {
  test(`layout at ${width}: the tell line and the open loops fit`, async ({ page }) => {
    await setup(page, width);
    await page.getByTestId("tell-forgetting").click();
    await expect(page.getByTestId("forgetting")).toContainText("3 open loops");
    await noOverflow(page);
    if (process.env.PLANS_SHOTS) await page.screenshot({ path: `${process.env.PLANS_SHOTS}/tell-${width}.png` });
  });
}
