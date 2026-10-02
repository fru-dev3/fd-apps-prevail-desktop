// Design review shots: every page reachable from the sidebar and Settings,
// at 390, 768, 1280 and 1920, with the mocked backend. Skipped unless
// DESIGN_SHOTS=<dir> is set, so it never slows the suite; when it runs it
// also fails a page that scrolls sideways. The other specs' *_SHOTS
// variables capture the richer views of their own pages. Invented data only.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const SHOTS = process.env.DESIGN_SHOTS;
test.skip(!SHOTS, "set DESIGN_SHOTS=<dir> to capture the design review shots");

const TASKS = "# Tasks\n\n- [ ] Renew the foo insurance ~id:t1 ~due:2026-10-09\n- [ ] Call Bar about the roof, a rather long task title that has to wrap on a phone ~id:t2\n- [x] Pay the foo invoice ~id:t3\n";
const FIX: Record<string, unknown> = {
  engine_today: {
    date: "2026-10-02", generated: 1, calm: 3,
    items: [
      { key: "task:money:m2", kind: "commitment", title: "Send the quote request to Sam", domain: "money", due: "2026-10-03", person: "person/sam-foo", thread: ["Money", "Cash buffer of a year", "Peace of mind"], unlinked: false, why: "due in 1 day", score: 0.4, ref: { domain: "money", id: "m2" } },
      { key: "task:home:t-1", kind: "task", title: "Fix the foo gutter before the rain", domain: "home", due: "2026-09-30", thread: ["Home"], unlinked: true, why: "2 days overdue", score: 0.1, ref: { domain: "home", text: "Fix the foo gutter before the rain" } },
    ],
    fallingBehind: { text: "Renew the bar card: 12 days overdue, and the foo statement before the end of the month" },
    decisionDue: null, yourDay: { connected: false, note: "No calendar is connected yet, so your day is not on the card." },
    alsoDue: [{ key: "task:money:m3", kind: "task", title: "Review the bar statement", domain: "money", due: "2026-10-04", thread: ["Money"], unlinked: false, why: "due in 2 days", score: 0.05, ref: { domain: "money", id: "m3" } }],
    feedback: [],
  },
  scan_vault: ["career", "health", "money", "home"].map((name) => ({ name, path: `/tmp/smoke-vault/data/domains/${name}`, has_state: true, state_preview: null })),
  read_tasks: TASKS, read_domain_tasks: TASKS,
  engine_specialists: [
    { id: "researcher", name: "Researcher", icon: "search", family: "know", returns: "findings", ceiling: "read", tools: ["web", "vault-read"], apps: [], runtime: "deep", budget: { minutes: 6, usd: 0.4, passes: 2 }, handoff: "offer", doneWhen: ["every claim has a source"], mandate: "A deep, sourced answer to one question.", on: true, builtIn: true },
  ],
  engine_jobs: [],
  chief_of_staff_read: "---\nname: Foo\nhandoff: auto\n---\n",
};

const HOME = ["inbox", "insights", "recommendations", "missions", "task-list", "compass", "decisions", "playbooks", "specialists", "apps"];
const SETTINGS = ["models", "council", "toolkit", "benchmark", "intent", "entities", "activity", "usage", "connections", "privacy-safety", "settings"];
const WIDTHS = [390, 768, 1280, 1920];

async function open(page: Page, width: number) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await mockTauri(page, FIX);
  await page.goto("/");
  await expect(page.locator("[data-tour=composer]").first()).toBeVisible({ timeout: 15_000 });
}
async function shot(page: Page, name: string, width: number) {
  await page.waitForTimeout(400);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(wide, `${name} scrolls sideways`).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${SHOTS}/${name}-${width}.png`, fullPage: true });
}
const fire = (page: Page, ev: string, detail: string) => page.evaluate(([e, d]) => window.dispatchEvent(new CustomEvent(e, { detail: d })), [ev, detail]);

for (const width of WIDTHS) {
  test(`design shots · home and domain · ${width}`, async ({ page }) => {
    await open(page, width);
    await shot(page, "d-home", width);
    await fire(page, "prevail:open-domain", "career");
    await shot(page, "d-domain", width);
  });
  test(`design shots · work pages · ${width}`, async ({ page }) => {
    await open(page, width);
    for (const id of HOME) {
      await fire(page, "prevail:work-section", id);
      await shot(page, `d-${id}`, width);
      if (id === "insights") {
        for (const tab of ["Metrics", "History"]) {
          const t = page.getByRole("tab", { name: tab }).first();
          if (await t.isVisible().catch(() => false)) { await t.click(); await shot(page, `d-insights-${tab.toLowerCase()}`, width); }
        }
      }
      if (id === "compass") {
        for (const tab of ["Goals", "Ideals"]) {
          const t = page.getByRole("tab", { name: tab }).first();
          if (await t.isVisible().catch(() => false)) { await t.click(); await shot(page, `d-compass-${tab.toLowerCase()}`, width); }
        }
      }
    }
  });
  test(`design shots · settings pages · ${width}`, async ({ page }) => {
    await open(page, width);
    for (const id of SETTINGS) {
      await fire(page, "prevail:open-settings", id);
      await shot(page, `d-settings-${id}`, width);
    }
  });
}
