// The sidebar top: one way into Settings (a quiet gear), one way out (the
// back row), and a Settings search that filters the Settings nav.
import { test, expect } from "@playwright/test";
import { openChatTab } from "./open-chat";
import { mockTauri } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await mockTauri(page);
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.goto("/");
  await openChatTab(page); await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
});

test("sidebar · the gear opens Settings; one back control, no X, and it returns Home", async ({ page }) => {
  const nav = page.getByTestId("app-sidebar");
  const gear = nav.getByRole("button", { name: "Settings", exact: true });
  await expect(gear).toHaveCount(1);
  await gear.click();
  await expect(nav.getByTestId("settings-back")).toBeVisible({ timeout: 10_000 });
  // Exactly one way out, no close X, no profile switcher, no second Home row.
  await expect(nav.getByRole("button", { name: /Back to Home|Close settings|Close/ })).toHaveCount(1);
  await expect(nav.getByRole("button", { name: "Switch profile" })).toHaveCount(0);
  await expect(nav.getByTestId("nav-home")).toHaveCount(0);
  await nav.getByTestId("settings-back").click();
  await expect(nav.getByTestId("nav-home")).toBeVisible();
  await expect(nav.getByTestId("settings-back")).toHaveCount(0);
});

test("sidebar · Esc returns Home from Settings", async ({ page }) => {
  const nav = page.getByTestId("app-sidebar");
  await nav.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(nav.getByTestId("settings-back")).toBeVisible({ timeout: 10_000 });
  await page.locator("body").click({ position: { x: 5, y: 890 } }).catch(() => {});
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Escape");
  await expect(nav.getByTestId("nav-home")).toBeVisible({ timeout: 5_000 });
});

test("sidebar · typing in Search settings filters the rows; Enter opens the first match", async ({ page }) => {
  const nav = page.getByTestId("app-sidebar");
  await nav.getByRole("button", { name: "Settings", exact: true }).click();
  const search = nav.getByRole("textbox", { name: "Search settings" });
  await expect(search).toBeVisible({ timeout: 10_000 });
  await expect(nav.getByRole("button", { name: "Arena", exact: true })).toBeVisible();
  await search.fill("mod");
  await expect(nav.getByRole("button", { name: "Models", exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Arena", exact: true })).toHaveCount(0);
  await expect(nav.getByRole("button", { name: "Toolkit", exact: true })).toHaveCount(0);
  // Side rows are searchable too.
  await search.fill("phone");
  await expect(nav.getByTestId("settings-sub-matches")).toContainText("Phone in Connections");
  await search.fill("inten");
  await search.press("Enter");
  await expect(search).toHaveValue("");
  await expect(page.getByTestId("settings-page").getByTestId("page-header").filter({ hasText: "Intent" }).first()).toBeVisible({ timeout: 10_000 });
  // Esc inside the field does not leave Settings.
  await search.press("Escape");
  await expect(nav.getByTestId("settings-back")).toBeVisible();
});

test.describe("sidebar · sticky section headers", () => {
  test.beforeEach(async ({ page }) => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `foo${i + 1}`, path: `/tmp/smoke-vault/foo${i + 1}`, has_state: true, state_preview: null }));
    await page.setViewportSize({ width: 1440, height: 700 });
    await mockTauri(page, { scan_vault: many });
    await page.goto("/");
    await openChatTab(page); await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  });

  test("sidebar · the Domains header stays pinned while its long list scrolls", async ({ page }) => {
    const scroller = page.getByTestId("sidebar-scroll");
    const head = page.getByTestId("sidebar-head-domains");
    await expect(head).toBeVisible();
    // "All" opens collapsed; open it so the 30 domains overflow the rail.
    const all = page.getByTestId("app-sidebar").getByRole("button", { name: /^All\b/ });
    if ((await all.getAttribute("aria-expanded")) === "false") await all.click();
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event("scroll")); });
    await expect(head).toBeInViewport();
    const [s, h] = await Promise.all([scroller.boundingBox(), head.boundingBox()]);
    expect(Math.abs(h!.y - s!.y)).toBeLessThanOrEqual(1);
    await expect(head).toHaveAttribute("data-stuck", "");
    // The fold toggle still works while pinned.
    await head.getByRole("button", { name: /Domains/ }).click();
    await expect(head.getByRole("button", { name: /Domains/ })).toHaveAttribute("aria-expanded", "false");
  });
});

test("sidebar · a named chief of staff takes the General row", async ({ page }) => {
  await mockTauri(page, { chief_of_staff_read: "---\nname: Foo\nvoice: plain\n---\n" });
  await page.goto("/");
  const row = page.getByTestId("app-sidebar").getByTestId("nav-home");
  await expect(row).toContainText("Foo", { timeout: 15_000 });
  await expect(row).toHaveAttribute("title", "Foo, your chief of staff");
});

test("sidebar · with no name the General row stays Home", async ({ page }) => {
  await expect(page.getByTestId("app-sidebar").getByTestId("nav-home")).toContainText("Home");
});
