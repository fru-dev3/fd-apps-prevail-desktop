// The app opens on Work. A spec that needs the chat switches to it first
// (the desktop header's Chat tab); a phone-sized window has no header tab and
// already opens on chat.
import type { Page } from "@playwright/test";

export async function openChatTab(page: Page): Promise<void> {
  const tab = page.getByTestId("top-tab-chat");
  await page.getByText("What should we work on?").or(tab).first().waitFor({ timeout: 15_000 });
  if (await tab.isVisible()) await tab.click();
}
