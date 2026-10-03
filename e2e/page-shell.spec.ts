// Every Home and Settings page renders inside the one shared page shell
// (PageShell): the same header band, column surface and detail surface. A
// page that draws its own header or surfaces fails here. With SHELL_SHOTS set,
// each page is also captured at 1440 in the light theme for side-by-side review.
import { test, expect } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const HOME = ["inbox", "insights", "recommendations", "missions", "task-list", "compass", "apps"];
const SETTINGS = ["models", "council", "toolkit", "benchmark", "intent", "entities", "activity", "connections", "privacy-safety", "settings"];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockTauri(page, { ui_settings_get: JSON.stringify({ theme: "light" }) });
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
});

for (const [area, ids, event] of [["home", HOME, "prevail:work-section"], ["settings", SETTINGS, "prevail:open-settings"]] as const) {
  for (const id of ids) {
    test(`page shell · ${area} · ${id}`, async ({ page }) => {
      await page.evaluate(([ev, s]) => window.dispatchEvent(new CustomEvent(ev, { detail: s })), [event, id]);
      const shell = page.locator("[data-shell=page]");
      await expect(shell).toHaveCount(1, { timeout: 10_000 });
      const header = shell.locator("[data-shell=header]");
      await expect(header).toBeVisible();
      // Exactly one header band: one page header, drawn by the shell.
      await expect(page.locator("[data-settings-header]:visible")).toHaveCount(1);
      await expect(header.locator("[data-settings-header]")).toHaveCount(1);
      await expect(page.locator("main h1:visible, [data-shell=page] h1:visible")).toHaveCount(1);
      await page.waitForTimeout(300);
      // The surfaces are the shell's own: the header band and page use the
      // background token, the column the column surface, and the detail pane
      // paints nothing of its own.
      const look = await page.evaluate(() => {
        const bg = (el: Element | null) => (el ? getComputedStyle(el).backgroundColor : null);
        const probe = (cls: string) => { const d = document.createElement("div"); d.className = cls; document.body.appendChild(d); const c = bg(d); d.remove(); return c; };
        return {
          header: bg(document.querySelector("[data-shell=header]")), page: bg(document.querySelector("[data-shell=page]")),
          columns: Array.from(document.querySelectorAll("[data-shell=column]")).map(bg),
          details: Array.from(document.querySelectorAll("[data-shell=detail]")).map(bg),
          want: { background: probe("bg-background"), column: probe("bg-surface/40") },
        };
      });
      if (process.env.SHELL_SHOTS) await page.screenshot({ path: `${process.env.SHELL_SHOTS}/${area}-${id}.png` });
      expect(look.header).toBe(look.want.background);
      expect(look.page).toBe(look.want.background);
      for (const c of look.columns) expect(c).toBe(look.want.column);
      for (const d of look.details) expect(d).toBe("rgba(0, 0, 0, 0)");
    });
  }
}
