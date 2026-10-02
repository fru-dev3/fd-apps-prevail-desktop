// Specialists Phase 3: standing work. The Operator's actions on a job card
// (each with the broker's answer; Allow and Deny for the ones that ask), the
// Inbox's Results (playbooks that ran on their own), and scheduling a playbook
// on a clock or a radar event. Invented data only.
// With PLANS_SHOTS=<dir>, the screens are captured at 390, 768, 1280, 1920.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const JOB = {
  id: "2026-10-02-091500-book-the-foo-trip", ask: "Book the foo trip", origin: { kind: "chat", domain: "foo" }, domains: { owner: "foo", consulted: [], informed: [] },
  team: [{ step: 1, specialists: ["planner"] }, { step: 2, specialists: ["steward"], gate: true }, { step: 3, specialists: ["operator"] }], effort: "standard",
  budget: { usd: 1, minutes: 10 }, why: "act", playbook: null, status: "done", startsAlone: false, created: 1, started: 1, ended: 90_000,
  result: { type: "action", summary: "Three actions for the foo trip" },
  actions: [
    { n: 1, text: "Add a reminder to the Foo board for Friday", cls: "reversible", status: "done", reason: "your policy lets this run alone", report: "Reminder added", ts: 1, undo: "remove the reminder" },
    { n: 2, text: "Pay the $120 deposit to Foo Lodge", cls: "financial", status: "asks", reason: "policy: \"financial\" actions need approval", act: "act_x2", carries: ["a money amount"], ts: 1 },
    { n: 3, text: "Delete the old account at Bar Bank", cls: "irreversible", status: "blocked", reason: "policy: \"irreversible\" actions are never allowed", ts: 1 },
  ],
};
const JOB_VIEW = { job: JOB, steps: [], filed: [], body: "" };
const RESULT = {
  runId: "event-pb-renewal-review-1790000000000", playbook: "renewal-review", name: "Renewal review", trigger: "event", event: "Renew the foo policy 2026-11-01",
  domain: "foo", ok: true, note: "7/8 steps completed", ts: Date.now() - 3_600_000, waiting: 1,
  steps: [
    { label: "historian: What happened with the foo policy", ok: true, decision: "auto", note: "done: three renewals, one claim" },
    { label: "writer: Quote requests, drafts only", ok: false, decision: "ask", note: "waits for your yes (job x)" },
  ],
};
const PB = { id: "renewal-review", name: "Renewal review", goal: "Review a renewal", group: "built-in", source: "built-in", draft: false, steps: 2, running: false };
const PB_VIEW = { ...PB, triggers: [{ domain: "foo", loop: "pb-renewal-review", cadence: "on admin:renew", on: "admin:renew", enabled: true }], rows: [{ n: 1, kind: "specialist", label: "What happened", specialists: ["historian"], returns: ["timeline"], gate: false, ask: false }], runs: [] };

const FIX: Record<string, unknown> = {
  engine_today: null, engine_review: null,
  engine_jobs: [JOB], engine_job_show: JOB_VIEW, engine_job_act: { ok: true }, engine_specialists: [], engine_decisions: [],
  engine_playbook_inbox: [RESULT], engine_playbook_seen: { ok: true },
  engine_playbook_rows: [PB], engine_playbook_show: PB_VIEW, engine_playbook_trigger: { ok: true },
  scan_vault: ["foo", "bar"].map((name) => ({ name, path: `/tmp/smoke-vault/data/domains/${name}`, has_state: true, state_preview: null })),
  read_ideal_state: "", read_omega: "", read_user_md: "", read_memory_md: "",
  domain_context: { state: "", decisions: "", journal: "", recent_logs: [], skills: [], layoutV4: true },
};
const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? []).filter((e) => e.cmd === c).map((e) => e.args), cmd);
const fire = (page: Page, name: string, detail: unknown) =>
  page.evaluate(([n, d]) => window.dispatchEvent(new CustomEvent(n as string, { detail: d })), [name, detail] as [string, unknown]);

async function setup(page: Page, width: number) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await mockTauri(page, FIX);
  await page.goto("/");
  await expect(page.getByText("What should we work on?")).toBeVisible({ timeout: 15_000 });
}
async function noOverflow(page: Page) {
  const over = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("[data-testid]")].filter((e) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      // A row that scrolls on its own (a tab row on a phone) may hold items past the edge.
      return r.width > 0 && (r.right > vw + 1 || r.left < -1) && !(e as HTMLElement).closest("[data-scroll-x]");
    }).map((e) => (e as HTMLElement).dataset.testid).slice(0, 5);
  });
  expect(over).toEqual([]);
}
async function openJob(page: Page) {
  await fire(page, "prevail:work-section", "specialists");
  await page.getByTestId("specialists-row-jobs:done").click();
  await page.getByTestId("job-row").first().getByRole("button").first().click();
  return page.getByTestId("job-card").first();
}

test("the Operator's actions: done alone, waiting for a yes (naming the money), blocked by policy; Allow and Deny", async ({ page }) => {
  await setup(page, 1280);
  const card = await openJob(page);
  const acts = card.getByTestId("job-action");
  await expect(acts).toHaveCount(3);
  await expect(acts.nth(0)).toHaveAttribute("data-status", "done");
  await expect(acts.nth(0)).toContainText("Reminder added");
  await expect(acts.nth(2)).toContainText("never allowed");
  await expect(acts.nth(2).getByTestId("job-action-allow")).toHaveCount(0);
  await expect(acts.nth(1).getByTestId("job-action-meta")).toContainText("carries a money amount");
  await acts.nth(1).getByTestId("job-action-allow").click();
  await expect.poll(async () => (await calls(page, "engine_job_act"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: JOB.id, n: 2, answer: "allow" });
  await acts.nth(1).hover();
  await acts.nth(1).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Deny" }).click();
  await expect.poll(async () => (await calls(page, "engine_job_act"))[1]).toEqual({ vault: "/tmp/smoke-vault", id: JOB.id, n: 2, answer: "deny" });
});

test("the Inbox's Results: a playbook the radar started, its steps, Seen", async ({ page }) => {
  await setup(page, 1280);
  await page.getByTestId("nav-inbox").click();
  const inbox = page.getByTestId("inbox-page");
  await expect(inbox).toBeVisible({ timeout: 10_000 });
  const header = page.getByTestId("work-page").getByTestId("page-header").first();
  await expect(header.getByTestId("tab-results")).toContainText("1", { timeout: 10_000 });
  await header.getByTestId("tab-results").click();
  await inbox.getByTestId("inbox-row").filter({ hasText: "Renewal review" }).click();
  const r = inbox.getByTestId("inbox-result");
  await expect(r).toContainText("Ran when the radar flagged: Renew the foo policy 2026-11-01");
  await expect(r).toContainText("Waits for your yes");
  await r.getByTestId("inbox-result-seen").click();
  await expect.poll(async () => (await calls(page, "engine_playbook_seen"))[0]).toEqual({ vault: "/tmp/smoke-vault", runId: RESULT.runId });
});

test("a playbook on a radar event, and on a clock", async ({ page }) => {
  await setup(page, 1280);
  await page.getByTestId("app-sidebar").getByRole("button", { name: "Playbooks" }).click();
  const d = page.getByTestId("playbook-detail");
  await expect(d.getByTestId("playbook-triggers")).toHaveText('When the radar flags an admin deadline that says "renew" in Foo');
  await d.getByTestId("playbook-when").selectOption("event");
  await d.getByTestId("playbook-event").selectOption("mission");
  await d.getByTestId("playbook-where").selectOption("foo");
  await d.getByTestId("playbook-schedule-save").click();
  await expect.poll(async () => (await calls(page, "engine_playbook_trigger"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "renewal-review", domain: "foo", cadence: null, on: "mission", off: null });
  await d.getByTestId("playbook-when").selectOption("weekly");
  await d.getByTestId("playbook-schedule-save").click();
  await expect.poll(async () => (await calls(page, "engine_playbook_trigger"))[1]).toMatchObject({ cadence: "weekly", on: null });
  await expect(d.getByTestId("playbook-schedule-msg")).toContainText("Inbox");
});

for (const width of [390, 768, 1280, 1920]) {
  test(`layout at ${width}: the job card's actions, the Inbox result and the schedule row fit`, async ({ page }) => {
    await setup(page, width);
    const card = await openJob(page);
    await expect(card.getByTestId("job-actions")).toBeVisible();
    await noOverflow(page);
    if (process.env.PLANS_SHOTS) await page.screenshot({ path: `${process.env.PLANS_SHOTS}/standing-job-${width}.png` });
    await fire(page, "prevail:work-section", "inbox");
    await expect(page.getByTestId("inbox-page")).toBeVisible({ timeout: 10_000 });
    await noOverflow(page);
    await fire(page, "prevail:work-section", "playbooks");
    await expect(page.getByTestId("playbooks-page")).toBeVisible();
    if (width >= 1100) { await page.getByTestId("playbook-detail").getByTestId("playbook-when").selectOption("event"); await noOverflow(page); }
    if (process.env.PLANS_SHOTS) await page.screenshot({ path: `${process.env.PLANS_SHOTS}/standing-playbook-${width}.png` });
  });
}
