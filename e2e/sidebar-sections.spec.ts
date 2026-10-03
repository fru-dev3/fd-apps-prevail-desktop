import { test, expect } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

// Owner, 2026-10-02: every section starts collapsed for a new user; the
// chevron and + wait for a hover; one quiet double-arrow toggle collapses the
// sidebar in Home and in Settings (and ⌘B does both). Shots with
// SIDEBAR_SHOTS=<dir> at 390, 768, 1280, 1920.
const SHOTS = process.env.SIDEBAR_SHOTS;
for (const width of [390, 768, 1280, 1920]) {
  test(`sidebar · fresh state, hover reveal and both modes collapse (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockTauri(page, { __fresh_sidebar: true });
    await page.goto("/");
    await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
    const side = page.getByTestId("app-sidebar");
    if (!(await side.isVisible())) return; // the phone shell has no rail
    for (const k of ["work", "entities", "activities", "domains"]) await expect(page.getByTestId(`sidebar-head-${k}`).locator("button[aria-expanded]")).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("sidebar-missions")).toHaveCount(0);
    await page.mouse.move(width - 10, 450);
    await expect(page.getByTestId("sidebar-add-domains")).toHaveCSS("opacity", "0");
    await page.getByTestId("sidebar-head-domains").hover();
    await expect(page.getByTestId("sidebar-add-domains")).toHaveCSS("opacity", "1");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sidebar-fresh-${width}.png` });
    await page.getByTestId("sidebar-head-entities").locator("button[aria-expanded]").click();
    await page.getByTestId("sidebar-head-activities").locator("button[aria-expanded]").click();
    await page.getByTestId("sidebar-head-work").locator("button[aria-expanded]").click();
    // Each kind is a row with its icon; its chevron lists a few of that kind.
    for (const k of ["people", "places", "products", "things", "events", "projects"]) await expect(page.getByTestId(`sidebar-kind-${k}`).locator("svg")).toBeVisible();
    await page.getByTestId("sidebar-kind-projects").hover();
    await page.getByTestId("sidebar-kind-toggle-projects").click();
    await expect(page.getByTestId("sidebar-missions")).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sidebar-open-${width}.png` });
    // Home: the arrow toggle and ⌘B.
    const wide = (await side.boundingBox())!.width;
    await page.getByTestId("sidebar-collapse").click();
    await expect.poll(async () => (await side.boundingBox())!.width).toBeLessThan(wide);
    await page.keyboard.press("Meta+b");
    await expect.poll(async () => (await side.boundingBox())!.width).toBe(wide);
    // Settings: the same toggle, and collapsed it is the icon rail.
    await page.keyboard.press("Meta+,");
    await expect(page.getByTestId("settings-back")).toBeVisible();
    await page.getByTestId("sidebar-collapse").click();
    await expect.poll(async () => (await side.boundingBox())!.width).toBeLessThan(wide);
    await expect(page.getByTestId("settings-back")).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sidebar-settings-collapsed-${width}.png` });
    await page.keyboard.press("Meta+b");
    await expect.poll(async () => (await side.boundingBox())!.width).toBe(wide);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sidebar-settings-${width}.png` });
  });
}
