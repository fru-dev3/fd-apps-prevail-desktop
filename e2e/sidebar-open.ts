// Sidebar sections start collapsed at every launch (owner, 2026-10-02) and
// nothing is stored, so a spec that needs a section open clicks it open.
import type { Page } from "@playwright/test";

export async function openSidebar(page: Page, sections: string[], kinds: string[] = []) {
  const side = page.getByTestId("app-sidebar");
  if (!(await side.isVisible().catch(() => false))) return;
  for (const s of sections) {
    const t = side.getByTestId(`sidebar-head-${s}`).locator("[aria-expanded]");
    if (await t.isVisible().catch(() => false) && (await t.getAttribute("aria-expanded")) === "false") await t.click();
  }
  for (const k of kinds) {
    const t = side.getByTestId(`sidebar-kind-toggle-${k}`);
    if (await t.count() && (await t.getAttribute("aria-expanded")) === "false") await t.click();
  }
  await page.mouse.move(1, 1);
}
