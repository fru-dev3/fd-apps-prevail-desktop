// Sources page smoke: the real frontend bundle with the Tauri IPC mocked
// (e2e/tauri-mock.ts). Asserts the table renders, a row opens its in-flow
// detail, the Add flow offers the four types, and the footer carries no
// Obsidian icon. With SOURCES_SHOTS=<dir> it also writes screenshots (light and
// dark); SOURCES_FIXTURES=<dir> swaps in real `prevail sources list/context
// --json` output (list.json, context.json) for the inline fixture.
import { test, expect, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mockTauri } from "./tauri-mock";

const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const INLINE_LIST = {
  ok: true,
  sources: [
    { id: "vault", kind: "prevail", name: "Prevail vault", location: "", resolvedLocation: "/tmp/smoke-vault", enabled: true, added: "", builtin: true,
      status: { state: "ready", lastIndexed: iso(now - 4 * 60_000), items: 142, files: 60, nextRefresh: iso(now + 26 * 60_000), error: null, detail: "11 domains" } },
    { id: "site-fru-dev", kind: "website", name: "fru.dev", location: "https://fru.dev", resolvedLocation: "https://fru.dev", enabled: true, added: "",
      status: { state: "ready", lastIndexed: iso(now - 3_600_000), items: 37692, nextRefresh: iso(now + 5 * 3_600_000), error: null, detail: "47 linked sites",
        web: { sites: 2, childSites: 1, rows: 522, items: 600, llms: 2, llmsFull: 2, openapi: 1, nextDue: null, lastUpdated: null, errors: [],
          list: [
            { origin: "https://fru.dev", name: "fru.dev", rows: 60, lastUpdated: null, nextDue: iso(now + 86_400_000), surface: { robots: true, llms: true, llmsFull: true, openapi: null, sitemap: 12, health: false } },
            { origin: "https://funding.fru.dev", name: "Funding", rows: 522, lastUpdated: iso(now - 86_400_000), nextDue: iso(now + 2 * 86_400_000), surface: { robots: true, llms: true, llmsFull: true, openapi: 7, sitemap: 600, health: true } },
          ] } } },
  ],
};
const INLINE_CONTEXT = { ok: true, context: "# CONTEXT FROM YOUR SOURCES\n\n[S1] Funding: 2026-02-12, Anthropic, Series G\nFrom Funding: https://funding.fru.dev/rounds/anthropic-series-g-2026-02\n2026-02-12 | Anthropic | Series G | $30B\n# END OF SOURCES\n\n",
  hits: [{ tag: "S1", sourceName: "fru.dev", kind: "website", title: "Funding: 2026-02-12, Anthropic, Series G", location: "funding.fru.dev/rounds/anthropic-series-g-2026-02", url: "https://funding.fru.dev/rounds/anthropic-series-g-2026-02", group: "Funding" }] };

function fixtures() {
  const dir = process.env.SOURCES_FIXTURES;
  const read = (f: string, fallback: unknown) => (dir && existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), "utf8")) : fallback);
  return {
    sources_list: read("list.json", INLINE_LIST),
    sources_context: read("context.json", INLINE_CONTEXT),
    sources_refresh: { ok: true, busy: false, refreshed: [] },
  };
}

const SHOTS = process.env.SOURCES_SHOTS;
async function shot(page: Page, name: string, opts: { fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } } = {}) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), ...opts });
}

async function openSources(page: Page, theme: "light" | "dark", width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((t) => { localStorage.setItem("prevail.desktop.theme", t); }, theme);
  await mockTauri(page, fixtures());
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "sources" })));
  await expect(page.getByTestId("sources-table")).toBeVisible({ timeout: 10_000 });
}

for (const theme of ["light", "dark"] as const) {
  test(`sources page (${theme}): table, detail, add flow, footer`, async ({ page }) => {
    await openSources(page, theme);
    await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
    await expect(page.getByTestId("source-row-vault")).toContainText("Prevail vault");
    await expect(page.getByTestId("source-row-site-fru-dev")).toContainText("fru.dev");
    await shot(page, `sources-${theme}`);

    // The footer: Beta, theme and processes. No Obsidian icon.
    const aside = page.locator("aside").first();
    await expect(aside.getByLabel("Obsidian")).toHaveCount(0);
    await expect(aside.getByText("Beta")).toBeVisible();
    const box = await aside.boundingBox();
    if (box) await shot(page, `footer-${theme}`, { clip: { x: box.x, y: box.y + box.height - 150, width: box.width, height: 150 } });

    // Try a question: cited excerpts.
    await page.getByLabel("Test question").fill("When is Thanksgiving 2026, and is it a federal payday holiday?");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByTestId("try-hits")).toBeVisible();
    await page.getByTestId("try-hits").scrollIntoViewIfNeeded();
    await shot(page, `sources-try-${theme}`);

    // A website opens in-flow with what was found and every linked site.
    await page.getByTestId("source-row-site-fru-dev").click();
    await expect(page.getByTestId("source-detail")).toBeVisible();
    await expect(page.getByText("What Prevail found")).toBeVisible();
    await expect(page.getByTestId("site-table")).toContainText("Funding");
    await shot(page, `sources-fru-dev-${theme}`);

    // Add: the four types, in the content column.
    await page.getByTestId("add-source").click();
    for (const k of ["prevail", "obsidian", "folder", "website"]) await expect(page.getByTestId(`add-kind-${k}`)).toBeVisible();
    await shot(page, `sources-add-${theme}`);
    await page.getByTestId("add-kind-website").click();
    await expect(page.getByLabel("Website address")).toBeVisible();
    await shot(page, `sources-add-website-${theme}`);
  });
}

test("sources page at phone and narrow widths has no horizontal overflow", async ({ page }) => {
  for (const width of [390, 1024]) {
    await openSources(page, "light", width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(page, `sources-${width}-light`);
  }
});
