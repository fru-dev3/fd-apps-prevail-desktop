// Specialists Phase 2: the Playbooks page (Running, Yours, Drafts, Built in;
// steps with GATE and ASK and their typed results; Run in a domain; Adopt a
// draft; run history) and Save as playbook on a finished job. Invented data only.
// With PLANS_SHOTS=<dir>, the page is captured at 390, 768, 1280, 1920.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const ROWS = [
  { id: "foo-renewal", name: "Foo renewal", goal: "Review the foo renewal", group: "yours", source: "yours", draft: false, steps: 3, running: false, lastRun: { ts: 1, status: "done" } },
  { id: "bar-plan", name: "Bar plan from chat", goal: "Plan the bar move", domain: "foo", group: "drafts", source: "yours", draft: true, steps: 2, running: false },
  { id: "keep-or-sell", name: "Keep or sell", goal: "Decide whether to keep or sell something you own", group: "built-in", source: "built-in", draft: false, steps: 4, running: false },
];
const VIEW = {
  ...ROWS[0], triggers: [{ domain: "foo", loop: "foo-renewal", cadence: "weekly", enabled: true }],
  rows: [
    { n: 1, kind: "specialist", label: "What happened with the foo plan", specialists: ["historian"], returns: ["timeline"], gate: false, ask: false },
    { n: 2, kind: "specialist", label: "Does it fit the Compass?", specialists: ["steward"], returns: ["verdict"], gate: true, ask: false },
    { n: 3, kind: "specialist", label: "Quote requests to the two best foo providers, drafts only", specialists: ["writer"], returns: ["draft"], gate: false, ask: true },
    { n: 4, kind: "task", label: "Call the foo office about the renewal window", specialists: [], returns: ["task"], gate: false, ask: false },
  ],
  runs: [{ id: "pb-foo-renewal-1790000000000-s1", status: "done", ts: 1, summary: "Two foo renewals, both on time" }],
};
const DRAFT_VIEW = { ...ROWS[1], triggers: [], rows: [{ n: 1, kind: "specialist", label: "Researcher compares the bar options", specialists: ["researcher"], returns: ["findings"], gate: false, ask: false }], runs: [], from: "2026-10-02-0900-plan-the-bar-move" };
const BUILTIN_VIEW = { ...ROWS[2], triggers: [], rows: [{ n: 1, kind: "specialist", label: "What happened with it", specialists: ["historian"], returns: ["timeline"], gate: false, ask: false }], runs: [] };
const JOB = {
  id: "2026-10-02-081542-find-foo", ask: "Find the best foo providers", origin: { kind: "chat", domain: "foo" }, domains: { owner: "foo", consulted: [], informed: [] },
  team: [{ step: 1, specialists: ["researcher"] }, { step: 2, specialists: ["editor"] }], effort: "standard", budget: { usd: 1, minutes: 10 }, why: "compare", playbook: null,
  status: "done", startsAlone: true, created: 1, started: 1, ended: 60_000, result: { type: "page", summary: "Option A for foo" },
};
const JOB_VIEW = {
  job: JOB, steps: [], body: "",
  filed: [{ n: 1, ts: 1, domain: "foo", kind: "build", file: "build/_meta/jobs/x/build/tools/check.sh", ref: "x", text: "file tools/check.sh, waiting for you (nothing ran)" }],
};

const FIX: Record<string, unknown> = {
  engine_today: null, engine_review: null,
  engine_playbook_rows: ROWS, engine_playbook_show: VIEW, engine_playbook_run: { ok: true, note: "3/4 steps completed" }, engine_playbook_adopt: { ok: true },
  engine_playbook_save: { ok: true, playbook: { id: "find-the-best-foo-providers", name: "Find the best foo providers", steps: [{}, {}], draft: true } },
  engine_jobs: [JOB], engine_job_show: JOB_VIEW, engine_specialists: [], engine_decisions: [],
  scan_vault: ["foo", "bar"].map((name) => ({ name, path: `/tmp/smoke-vault/data/domains/${name}`, has_state: true, state_preview: null })),
  read_ideal_state: "", read_omega: "", read_user_md: "", read_memory_md: "",
  domain_context: { state: "", decisions: "", journal: "", recent_logs: [], skills: [], layoutV4: true },
};
const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? []).filter((e) => e.cmd === c).map((e) => e.args), cmd);
const fire = (page: Page, name: string, detail: unknown) =>
  page.evaluate(([n, d]) => window.dispatchEvent(new CustomEvent(n as string, { detail: d })), [name, detail] as [string, unknown]);

async function setup(page: Page, width: number, extra: Record<string, unknown> = {}) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await mockTauri(page, { ...FIX, ...extra });
  await page.goto("/");
  await expect(page.getByText("What should we work on?")).toBeVisible({ timeout: 15_000 });
}
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

test("Playbooks: groups, steps with GATE, ASK and typed results, what runs it, Run, a run's job card", async ({ page }) => {
  await setup(page, 1280);
  await page.getByTestId("app-sidebar").getByRole("button", { name: "Playbooks" }).click();
  const pageEl = page.getByTestId("playbooks-page");
  await expect(pageEl).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("playbooks-list")).toContainText("Built in");
  const d = page.getByTestId("playbook-detail");
  await expect(d).toHaveAttribute("data-id", "foo-renewal");
  await expect(d.getByTestId("playbook-triggers")).toHaveText("Weekly in Foo");
  const steps = d.getByTestId("playbook-step");
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(1)).toContainText("Gate");
  await expect(steps.nth(1)).toContainText("returns verdict");
  await expect(steps.nth(2)).toContainText("Asks first");
  await expect(steps.nth(3)).toContainText("For you");
  await d.getByTestId("playbook-domain").selectOption("bar");
  await d.getByTestId("playbook-run").click();
  await expect.poll(async () => (await calls(page, "engine_playbook_run"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "foo-renewal", domain: "bar" });
  await expect(d.getByTestId("playbook-msg")).toContainText("3/4 steps completed");
  await d.getByTestId("playbook-runs").getByRole("button").first().click();
  await expect(d.getByTestId("job-card")).toBeVisible();
});

test("a draft is adopted; a playbook with a domain runs there", async ({ page }) => {
  await setup(page, 1280, { engine_playbook_show: DRAFT_VIEW });
  await fire(page, "prevail:work-section", "playbooks");
  await page.getByTestId("playbook-row-bar-plan").click();
  const d = page.getByTestId("playbook-detail");
  await expect(d).toContainText("Draft");
  await expect(d.getByTestId("playbook-domain")).toHaveCount(0);
  await d.getByTestId("playbook-adopt").click();
  await expect.poll(async () => (await calls(page, "engine_playbook_adopt"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "bar-plan" });
});

test("Save as playbook on a finished job, and a Builder's file in the Filed list", async ({ page }) => {
  await setup(page, 1280);
  await fire(page, "prevail:work-section", "specialists");
  await page.getByTestId("specialists-row-jobs:done").click();
  await page.getByTestId("job-row").first().getByRole("button").first().click();
  const card = page.getByTestId("job-card").first();
  await expect(card.getByTestId("job-filed")).toContainText("nothing ran");
  await card.getByTestId("job-save-playbook").click();
  await expect.poll(async () => (await calls(page, "engine_playbook_save"))[0]).toEqual({ vault: "/tmp/smoke-vault", jobId: JOB.id, name: null, adopt: null });
  await expect(card.getByTestId("job-saved-playbook")).toContainText("Find the best foo providers");
  await card.getByTestId("job-saved-playbook").getByRole("button").click();
  await expect(page.getByTestId("playbooks-page")).toBeVisible();
});

for (const width of [390, 768, 1280, 1920]) {
  test(`Playbooks fit at ${width}px`, async ({ page }) => {
    await setup(page, width, { engine_playbook_show: BUILTIN_VIEW });
    await fire(page, "prevail:work-section", "playbooks");
    await expect(page.getByTestId("playbooks-page")).toBeVisible({ timeout: 10_000 });
    if (width < 1101) await page.getByTestId("playbook-row-keep-or-sell").click();
    await expect(page.getByTestId("playbook-detail")).toBeVisible();
    await noOverflow(page);
    if (process.env.PLANS_SHOTS) await page.screenshot({ path: `${process.env.PLANS_SHOTS}/playbooks-${width}.png`, fullPage: false });
  });
}
