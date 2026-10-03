// Goals G4: a goal's initiatives on the Compass. Proposed ones with what they
// take and the even-swap sentence, Choose (the only tap), Find initiatives,
// what was left out and why, and a chosen one's weekly check. Invented data
// only. With PLANS_SHOTS=<dir>, captured at 390, 768, 1280 and 1920.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const COMPASS = `# Compass

## Values

- Curiosity ~id:v-curious ~rank:1
- Calm ~id:v-calm ~rank:2

## Goals

- [ ] Stay curious about the foo world ~id:g-curious ~serves:v-curious ~status:active ~domain:foo
  why: "I want to stay curious about the foo world"
`;
const MAP = {
  goal: "g-curious", title: "Stay curious about the foo world", generated: 1,
  paths: [
    { id: "x-aaa111", title: "Morning foo brief", status: "chosen", kind: "low-effort", hours: 1, usd: 0, stress: 0, until: "2026-11-27", playbooks: "x-aaa111-1", values: [{ id: "v-curious", effect: 2 }], check: { state: "missing", explanation: "Morning foo brief is missing 1 of its expectations.", proposal: "Keep going until 2026-11-27 as committed; look at what is in the way (your if-then plan)." } },
    { id: "x-bbb222", title: "Sunday reflection with a much longer name that has to wrap on a phone", status: "proposed", kind: "skill", hours: 1, usd: 0, stress: 0, values: [{ id: "v-curious", effect: 1 }, { id: "v-calm", effect: 1 }], swap: "Sunday reflection gives up Curiosity to gain Calm, against Morning foo brief." },
    { id: "x-ccc333", title: "Foo course with a tutor", status: "proposed", kind: "capital", hours: 4, usd: 200, stress: 2, values: [{ id: "v-curious", effect: 2 }, { id: "v-calm", effect: -1 }], swap: "Foo course with a tutor gives up Calm, 3 more hours a week and about $200 more a month against Morning foo brief." },
  ],
  left: [{ title: "Foo club evenings", kind: "social", reason: "breaks \"Family time five hours a week\" (family_hours_wk -3)" }, { title: "Foo deep dive weekends", kind: "skill", reason: "does not fit your capacity: 12 of 10 hours a week" }],
};
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
}
async function setup(page: Page, width: number) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await mockTauri(page, {
    engine_today: null, engine_review: null, compass_read: COMPASS, compass_versions: [], compass_ledger: [], engine_compass_align: null,
    engine_initiatives: MAP, engine_initiatives_generate: { ok: true, candidates: [{ verdict: "survivor" }, { verdict: "survivor" }, { verdict: "rejected" }] },
    engine_initiative_choose: { ok: true, playbooks: ["x-bbb222-1"], loops: [], tasks: [] }, engine_initiative_retire: { ok: true, loops: 0 },
  });
  await page.goto("/");
  await work(page, "compass");
  await page.getByTestId("compass-row-goals").click();
  // A goal opens to its chain up and its initiatives.
  await page.getByTestId("compass-detail-goals").getByTestId("line-open").first().click();
}

test("a goal's initiatives: proposed with even swaps, Choose, Find, left out with why, the weekly check", async ({ page }) => {
  await setup(page, 1280);
  const ini = page.getByTestId("initiatives").first();
  await expect(ini).toBeVisible({ timeout: 15_000 });
  const rows = ini.getByTestId("initiative");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute("data-status", "chosen");
  await expect(rows.nth(0).getByTestId("initiative-check")).toContainText("Missing what you expected");
  await expect(rows.nth(2).getByTestId("initiative-swap")).toContainText("gives up Calm");
  await expect(rows.nth(2)).toContainText("4 h a week · $200 a month · stress 2 of 5");
  await rows.nth(1).getByTestId("initiative-choose").click();
  await expect.poll(async () => (await calls(page, "engine_initiative_choose"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "x-bbb222", until: null, trial: null });
  await expect(ini.getByTestId("initiatives-msg")).toContainText("1 playbook now run on their own");
  await ini.getByTestId("initiatives-left").click();
  await expect(ini).toContainText("does not fit your capacity: 12 of 10 hours a week");
  await ini.getByTestId("initiatives-generate").click();
  await expect.poll(async () => (await calls(page, "engine_initiatives_generate"))[0]).toEqual({ vault: "/tmp/smoke-vault", goal: "g-curious" });
  await expect(ini.getByTestId("initiatives-msg")).toContainText("Proposed 2");
  // The word on screen is "initiative", never "path".
  await expect(ini).not.toContainText(/\bpaths?\b/i);
});

for (const width of [390, 768, 1280, 1920]) {
  test(`layout at ${width}: initiatives fit`, async ({ page }) => {
    await setup(page, width);
    await expect(page.getByTestId("initiatives").first()).toBeVisible({ timeout: 15_000 });
    await noOverflow(page);
    if (process.env.PLANS_SHOTS) await page.screenshot({ path: `${process.env.PLANS_SHOTS}/initiatives-${width}.png` });
  });
}
