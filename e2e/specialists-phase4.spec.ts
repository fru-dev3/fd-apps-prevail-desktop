// Specialists Phase 4: the last four on with their own faces, Yours (a preset
// and an outside agent), and a new specialist
// made by talking (fields optional, nothing made until go). Invented data
// only. With SPEC_SHOTS=<dir>, each screen is captured at 390, 768, 1280, 1920.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const spec = (id: string, name: string, family: string, returns: string, extra: Record<string, unknown> = {}) => ({
  id, name, icon: "search", family, returns, ceiling: "read", tools: ["vault-read"], apps: [], runtime: "standard",
  budget: { minutes: 5, usd: 0.3, passes: 1 }, handoff: "offer", doneWhen: ["one line"], mandate: `The ${name.toLowerCase()} of the foo team.`, on: true, builtIn: true, ...extra,
});
const SPECIALISTS = [
  spec("researcher", "Researcher", "know", "findings"), spec("negotiator", "Negotiator", "decide", "strategy", { ceiling: "draft" }),
  spec("liaison", "Liaison", "do", "nudges", { ceiling: "draft" }), spec("tutor", "Tutor", "grow", "lessons", { ceiling: "write-vault" }),
  spec("confidant", "Confidant", "grow", "reflection"),
  spec("deal-analyst", "Deal analyst", "know", "numbers", { builtIn: false, base: "analyst", source: "build/specialists/deal-analyst.md" }),
  spec("foo-travel-agent", "Foo travel agent", "know", "findings", { builtIn: false, tools: [], outside: { endpoint: "https://agents.example.com/rpc", tool: "plan_trip", perDay: 3 }, source: "build/specialists/foo-travel-agent.md" }),
];
const D1 = { draft: { name: "Foo grant finder", base: "researcher", mandate: "Finds grants for foo projects." }, filled: ["name", "base", "mandate"], dropped: [{ field: "ceiling", value: "act", why: "a specialist never acts on its own" }], question: "What should it never do?", reply: "A grant finder built on the Researcher. What should it never do?", ready: true, missing: [], go: false };
const D2 = { ...D1, draft: { ...D1.draft, never: "Apply for anything." }, filled: ["never"], question: null, reply: "Got it. Say go to add it.", go: true };
const FIX: Record<string, unknown> = {
  engine_specialists: SPECIALISTS, engine_specialist_show: { spec: SPECIALISTS[6], notebooks: [] }, engine_jobs: [],
  engine_specialist_draft: D1, engine_specialist_create: { ok: true, spec: { id: "foo-grant-finder" }, path: "build/specialists/foo-grant-finder.md", dropped: [] },
  chief_of_staff_read: "---\nname: Foo\n---\n",
};
const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? []).filter((e) => e.cmd === c).map((e) => e.args), cmd);
const fire = (page: Page, name: string, detail: unknown) => page.evaluate(([n, d]) => window.dispatchEvent(new CustomEvent(n as string, { detail: d })), [name, detail] as [string, unknown]);
const SHOTS = process.env.SPEC_SHOTS;
async function shot(page: Page, name: string) { if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()?.width}.png` }); } }
async function open(page: Page, width: number) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await mockTauri(page, FIX);
  await page.goto("/");
  await expect(page.getByText("What should we work on?")).toBeVisible({ timeout: 15_000 });
  await fire(page, "prevail:work-section", "specialists");
  await expect(page.getByTestId("specialists-page")).toBeVisible({ timeout: 10_000 });
}
async function noOverflow(page: Page) {
  const over = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("[data-testid]")].filter((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1) && !(e as HTMLElement).closest("[data-scroll-x]"); }).map((e) => (e as HTMLElement).dataset.testid).slice(0, 5);
  });
  expect(over).toEqual([]);
}

for (const width of [390, 768, 1280, 1920]) {
  test.describe(`specialists phase 4 · ${width}`, () => {
    test("the four have faces; Yours shows a preset and an outside agent with what each may do", async ({ page }) => {
      await open(page, width);
      const list = page.getByTestId("specialists-list");
      for (const id of ["negotiator", "liaison", "tutor", "confidant"]) await expect(list.locator(`[data-specialist=${id}]`)).toBeVisible();
      await expect(list.getByText("Yours")).toBeVisible();
      await expect(page.getByTestId("specialists-row-spec:deal-analyst")).toContainText("Built on the Analyst");
      await shot(page, "spec4-list");
      await page.getByTestId("specialists-row-spec:foo-travel-agent").click();
      await expect(page.getByTestId("specialist-origin")).toContainText("Outside agent at agents.example.com");
      await expect(page.getByTestId("specialist-origin")).toContainText("asks before every call");
      await noOverflow(page);
      await shot(page, "spec4-outside");
    });

    test("a new specialist by talking: the draft fills, nothing is made until go", async ({ page }) => {
      await open(page, width);
      if (width < 500) await page.getByRole("button", { name: "New specialist" }).first().click();
      else await page.getByTestId("specialist-new-open").click();
      const box = page.getByTestId("specialist-chat-input");
      await box.fill("I want a specialist that finds grants for my foo projects");
      await box.press("Enter");
      await expect(page.getByTestId("specialist-chat-reply").last()).toContainText("What should it never do?");
      await expect(page.getByTestId("specialist-draft-summary")).toContainText("built on the Researcher");
      expect(await calls(page, "engine_specialist_create")).toEqual([]);
      await shot(page, "spec4-new");
      await page.evaluate((d) => { (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures.engine_specialist_draft = d; }, D2);
      await box.fill("never apply for anything. go");
      await box.press("Enter");
      await expect.poll(async () => (await calls(page, "engine_specialist_create")).length).toBe(1);
      expect((await calls(page, "engine_specialist_create"))[0]).toMatchObject({ draft: { name: "Foo grant finder", never: "Apply for anything." } });
      await noOverflow(page);
    });
  });
}
