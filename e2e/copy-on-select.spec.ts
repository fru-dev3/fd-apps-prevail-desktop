import { test, expect } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __copied: string[] }).__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t: string) => { (window as unknown as { __copied: string[] }).__copied.push(t); } },
    });
  });
  await mockTauri(page);
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
});

const copied = (page: import("@playwright/test").Page) => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);

test("selecting text on a page copies it", async ({ page }) => {
  await page.getByText("What should we work on?").click({ clickCount: 3 });
  await expect.poll(() => copied(page)).toHaveLength(1);
  expect((await copied(page))[0].trim().length).toBeGreaterThan(1);
});

test("selecting text in the composer does not copy it", async ({ page }) => {
  const box = page.getByPlaceholder("Ask anything").first();
  await box.fill("foo bar baz");
  await box.click({ clickCount: 3 });
  await page.waitForTimeout(200);
  expect(await copied(page)).toHaveLength(0);
});

test("the setting turns it off", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("prevail.pref.copyOnSelect", "0"));
  await page.getByText("What should we work on?").click({ clickCount: 3 });
  await page.waitForTimeout(200);
  expect(await copied(page)).toHaveLength(0);
});
