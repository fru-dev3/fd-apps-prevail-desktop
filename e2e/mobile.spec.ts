// Phone-width smoke: the same real bundle with mocked IPC, rendered at an
// iPhone viewport. Not pixel tests: each screen must render without a crash,
// and the page must never scroll horizontally (the classic sign of a desktop
// layout leaking off a phone). Screenshots land in the scratchpad for review.
import { test, expect } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const SHOTS = process.env.MOBILE_SHOTS_DIR || "/tmp";
const PHONE = { width: 390, height: 844 }; // iPhone 15 / 16 logical size

test.use({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

test.beforeEach(async ({ page }) => {
  await mockTauri(page);
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.goto("/");
});

async function noHorizontalScroll(page: import("@playwright/test").Page, label: string) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `${label}: page scrolls horizontally (${sw} > ${cw})`).toBeLessThanOrEqual(cw + 1);
}

test("home at phone width", async ({ page }) => {
  await expect(page.getByText("What should we work on?")).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/mobile-home.png`, fullPage: false });
  await noHorizontalScroll(page, "home");
});

test("the drawer opens from the menu button and closes on navigation", async ({ page }) => {
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  // Closed by default: the desktop rail must not be squeezing the content.
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  await expect(page.getByText("Work board")).toBeHidden();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByText("Work board")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/mobile-drawer.png`, fullPage: false });
  // Navigating from inside the drawer closes it.
  await page.getByText("Work board").click();
  await expect(page.getByText("Work board")).toBeHidden({ timeout: 5_000 });
  await noHorizontalScroll(page, "after drawer");
});

test("settings at phone width", async ({ page }) => {
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "remote" })));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/mobile-settings.png`, fullPage: false });
  await noHorizontalScroll(page, "settings");
});

test("work board at phone width", async ({ page }) => {
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.evaluate(() => {
    localStorage.setItem("prevail.board.openNeeds", "1");
    window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "tasks" }));
    window.dispatchEvent(new CustomEvent("prevail:board-view", { detail: "needs" }));
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/mobile-board.png`, fullPage: false });
  await noHorizontalScroll(page, "board");
});
