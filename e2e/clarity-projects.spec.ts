// Intent > Projects detail: Title Case titles, pinned tabs (Overview,
// Requirements, Your prompts, Timeline) that switch in place, the From you /
// Inferred filter, Technical details folded, and prompts shown verbatim.
// Names are invented.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const T = Date.parse("2026-09-20T12:00:00Z");
const RAW = "make the foo header   green\n  and keep *this* exactly";
const FIX = {
  ui_settings_get: JSON.stringify({ theme: "light" }),
  projects_index: {
    generated_ts: T, model: "x", stats: { records: 10, kept: 40, internal: 0, projects: 1, unassigned: 0 }, recommendations: [],
    projects: [{
      slug: "foo-shop", title: "foo shop for the web", domain: "career", kind: "app", summary: "A small shop.", status: "active",
      prompt_count: 40, first_ts: T - 30 * 864e5, last_ts: T, monthly: { "2026-08": 10, "2026-09": 30 }, tools: { claude: 30, codex: 10 },
      pack_dir: "", brief_model: "", brief_ts: 0, intents: [], takeaways: ["Keep it small"], ideas: [], open_questions: [],
    }],
  },
  projects_restart: {
    slug: "foo-shop", title: "foo shop", goal: "Sell foo online.",
    requirements: [{ text: "Cart totals round to cents", source: "you" }, { text: "Works on phones", source: "inferred" }],
    rules: ["Use pnpm"], decisions: ["Stripe for payments"], dead_ends: [], open_questions: [],
  },
  mirror_history: { total: 1, tools: ["claude"], weeks: [{ week: "2026-09-14", label: "Sep 14 to 20", intent_line: null, sittings: [
    { id: "s1", tool: "claude", project: "foo-shop", project_title: "foo shop", start_ts: T, end_ts: T + 6e5, prompts: [{ ts: T, text: RAW }] },
  ] }] },
};

async function open(page: Page) {
  await mockTauri(page, FIX);
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "projects" })));
  await page.getByTestId("projects-list").getByText("Foo Shop for the Web").click({ timeout: 10_000 });
  await expect(page.getByTestId("project-header")).toContainText("Foo Shop for the Web");
}

test("projects · tabs switch in place and stay pinned; Technical details start folded", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("project-technical")).not.toHaveAttribute("open", "");
  await page.getByTestId("project-tab-requirements").click();
  const reqs = page.getByTestId("project-requirements");
  await expect(reqs).toContainText("Cart totals round to cents");
  await expect(reqs).toContainText("Works on phones");
  await page.getByTestId("req-filter-you").click();
  await expect(reqs).not.toContainText("Works on phones");
  await page.getByTestId("req-filter-inferred").click();
  await expect(reqs).toContainText("Works on phones");
  await expect(reqs).not.toContainText("Cart totals");
  // An untick made here carries into the copy from the Overview.
  await page.getByLabel("Include: Works on phones").uncheck();
  await page.getByTestId("project-tab-overview").click();
  await expect(page.getByTestId("project-overview")).toBeVisible();
  await expect(page.getByTestId("project-tab-requirements")).toBeInViewport();
  expect((await page.evaluate(() => (window as unknown as { __invokeLog: { cmd: string }[] }).__invokeLog.filter((e) => e.cmd === "projects_restart").length))).toBe(1);
});

test("projects · Your prompts shows the raw prompts exactly as typed", async ({ page }) => {
  await open(page);
  await page.getByTestId("project-tab-prompts").click();
  const p = page.getByTestId("project-prompt").first();
  await expect(p).toBeVisible({ timeout: 10_000 });
  expect(await p.textContent()).toBe(RAW);
  await page.getByTestId("project-tab-timeline").click();
  await expect(page.getByTestId("project-timeline")).toContainText("Prompts per");
  await expect(page.getByTestId("project-tab-timeline")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("project-tab-overview")).toHaveAttribute("aria-selected", "false");
  await expect(page.getByTestId("project-overview")).toBeHidden();
  const underline = (id: string) => page.getByTestId(id).evaluate((el) => getComputedStyle(el).borderBottomColor);
  expect(await underline("project-tab-timeline")).not.toBe(await underline("project-tab-overview"));
  await page.screenshot({ path: `${process.env.MOBILE_SHOTS_DIR || "/tmp"}/desktop-project-timeline.png` });
});
