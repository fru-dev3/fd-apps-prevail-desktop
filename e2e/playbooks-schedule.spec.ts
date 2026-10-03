// Playbooks replace loops (owner, 2026-10-02): the loops UI is gone and the
// Playbooks page shows schedules. Scheduled playbooks sit under "On a
// schedule", folded by space (indented, a thin line); a row's one meta line is
// cadence, next run, last run and what it may do; the detail can switch a
// schedule off and back on. Invented data only.
// With PLANS_SHOTS=<dir>, the page is captured at 390, 768, 1280, 1920.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const DAY = 86_400_000;
const NOW = Date.now();
const sched = (space: string, o: Record<string, unknown> = {}) => ({ space, cadence: "weekly", enabled: true, status: "active", autonomy: "tasks", lastRunTs: NOW - 2 * DAY, nextRunTs: NOW + 5 * DAY, ...o });
const ROWS = [
  { id: "foo-watch", name: "Foo bill watch", goal: "Watch the foo bills", domain: "foo", group: "scheduled", source: "yours", draft: false, steps: 1, running: false, schedule: sched("foo") },
  { id: "foo-digest", name: "Foo monthly page", goal: "A monthly foo page", domain: "foo", group: "scheduled", source: "yours", draft: false, steps: 1, running: false, schedule: sched("foo", { cadence: "monthly", enabled: false, status: "staged", lastRunTs: null, nextRunTs: null, autonomy: "suggest" }) },
  { id: "morning-brief", name: "Morning brief", goal: "A short morning page", domain: "general", group: "scheduled", source: "yours", draft: false, steps: 1, running: false, schedule: sched("general", { cadence: "daily", autonomy: "auto", nextRunTs: NOW + DAY / 2 }) },
  { id: "keep-or-sell", name: "Keep or sell", goal: "Decide whether to keep or sell something you own", group: "built-in", source: "built-in", draft: false, steps: 4, running: false },
];
const VIEW = {
  ...ROWS[0], triggers: [{ domain: "foo", loop: "foo-watch", cadence: "weekly", enabled: true }],
  rows: [{ n: 1, kind: "loop", label: "Watch the foo bills", specialists: [], returns: ["tasks"], gate: false, ask: false }],
  runs: [],
};

const FIX: Record<string, unknown> = {
  engine_today: null, engine_review: null,
  engine_playbook_rows: ROWS, engine_playbook_show: VIEW, engine_playbook_trigger: { ok: true }, engine_jobs: [], engine_specialists: [], engine_decisions: [],
  scan_vault: ["foo", "bar"].map((name) => ({ name, path: `/tmp/smoke-vault/data/domains/${name}`, has_state: true, state_preview: null })),
  read_ideal_state: "", read_omega: "", read_user_md: "", read_memory_md: "",
  domain_context: { state: "", decisions: "", journal: "", recent_logs: [], skills: [], layoutV4: true },
};
const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? []).filter((e) => e.cmd === c).map((e) => e.args), cmd);

async function open(page: Page, width: number) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await mockTauri(page, FIX);
  await page.goto("/");
  await expect(page.getByText("What should we work on?")).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => {
    localStorage.setItem("prevail.playbooks.focus", "foo-watch");
    window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "playbooks" }));
  });
  await expect(page.getByTestId("playbooks-page")).toBeVisible({ timeout: 10_000 });
}

test("scheduled playbooks: by space, folded, one meta line each; switch a schedule off", async ({ page }) => {
  await open(page, 1280);
  const list = page.getByTestId("playbooks-list");
  await expect(list).toContainText("On a schedule");
  // The space holding the open playbook unfolds; the others stay folded.
  await expect(page.getByTestId("playbook-row-foo-watch")).toContainText("Weekly · next");
  await expect(page.getByTestId("playbook-row-foo-watch")).toContainText("files tasks");
  await expect(page.getByTestId("playbook-row-foo-digest")).toContainText("Off");
  await expect(page.getByTestId("playbook-row-morning-brief")).toHaveCount(0);
  await page.getByTestId("playbook-space-general").getByRole("button").first().click();
  await expect(page.getByTestId("playbook-row-morning-brief")).toContainText("runs on its own");
  const d = page.getByTestId("playbook-detail");
  await expect(d.getByTestId("playbook-schedule-line")).toContainText("in Foo");
  await expect(d.getByTestId("playbook-triggers")).toHaveCount(0);
  await d.getByTestId("playbook-schedule-line").getByRole("button", { name: /More for/ }).click();
  await page.getByRole("menuitem", { name: /Switch off/ }).click();
  await expect.poll(async () => (await calls(page, "engine_playbook_trigger"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "foo-watch", domain: "foo", cadence: null, on: null, off: true });
  // No Loops tab anywhere in a domain any more.
  await expect(page.getByRole("tab", { name: "Loops" })).toHaveCount(0);
});

for (const width of [390, 768, 1280, 1920]) {
  test(`layout at ${width}: the schedules fit`, async ({ page }) => {
    await open(page, width);
    const over = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      return [...document.querySelectorAll("[data-testid]")].filter((e) => {
        const r = (e as HTMLElement).getBoundingClientRect();
        return r.width > 0 && (r.right > vw + 1 || r.left < -1);
      }).map((e) => (e as HTMLElement).dataset.testid).slice(0, 5);
    });
    expect(over).toEqual([]);
    if (process.env.PLANS_SHOTS) await page.screenshot({ path: `${process.env.PLANS_SHOTS}/playbooks-schedules-${width}.png` });
  });
}
