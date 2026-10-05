// Icon color review shots (owner, 2026-10-03: colorful icons everywhere):
// the sidebar in Home and Settings mode and the SideSpine pages, light and
// dark, at 1280 and 390. Skipped unless COLOR_SHOTS=<dir> is set. Invented data only.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";
import { openSidebar } from "./sidebar-open";

const SHOTS = process.env.COLOR_SHOTS;
test.skip(!SHOTS, "set COLOR_SHOTS=<dir> to capture the icon color shots");

const fix = (theme: string): Record<string, unknown> => ({
  ui_settings_get: JSON.stringify({ theme }),
  scan_vault: ["career", "health", "money", "home"].map((name) => ({ name, path: `/tmp/smoke-vault/data/domains/${name}`, has_state: true, state_preview: null })),
  engine_specialists: [
    { id: "researcher", name: "Researcher", icon: "search", family: "know", returns: "findings", ceiling: "read", tools: ["web"], apps: [], runtime: "deep", budget: { minutes: 6, usd: 0.4, passes: 2 }, handoff: "offer", doneWhen: [], mandate: "A sourced answer.", on: true, builtIn: true },
  ],
  chief_of_staff_read: "---\nname: Foo\nhandoff: auto\n---\n",
});
const fire = (page: Page, ev: string, detail: string) => page.evaluate(([e, d]) => window.dispatchEvent(new CustomEvent(e, { detail: d })), [ev, detail]);
const HOME = ["inbox", "insights", "recommendations", "entities", "activities", "compass", "decisions", "playbooks", "specialists", "stack"];
const SETTINGS = ["models", "toolkit", "activity", "usage", "connections", "privacy-safety", "settings"];

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 390]) {
    test(`color shots · ${theme} · ${width}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await mockTauri(page, fix(theme));
      await page.goto("/");
      await expect(page.locator("[data-tour=composer]").first()).toBeVisible({ timeout: 15_000 });
      await openSidebar(page, ["work", "entities", "activities", "specialists", "domains"]);
      const shot = async (name: string) => { await page.waitForTimeout(350); await page.screenshot({ path: `${SHOTS}/${name}-${theme}-${width}.png` }); };
      await page.evaluate(() => document.querySelector("[data-testid=sidebar-scroll]")?.scrollTo(0, 0));
      await shot("sidebar-home");
      for (const id of HOME) { await fire(page, "prevail:work-section", id); await shot(`p-${id}`); }
      for (const id of SETTINGS) { await fire(page, "prevail:open-settings", id); await shot(`s-${id}`); }
    });
  }
}
