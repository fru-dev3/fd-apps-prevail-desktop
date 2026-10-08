// Knowledge sources (Settings > Connections): the list, the chat-first add
// with its Fields toggle, a row's scope, and the link from a playbook. Every
// engine call is mocked; invented sources only. 390 to 1920 wide, no
// sideways scroll. With APP_SHOTS set, each view is captured.
import { test, expect, type Page } from "@playwright/test";
import { openChatTab } from "./open-chat";
import { mockTauri } from "./tauri-mock";

const now = Date.now();
const scope = (o: Record<string, unknown> = {}) => ({ briefings: true, general: true, domains: [], projects: [], ...o });
const SOURCES = [
  { id: "foo-news", name: "Foo News", kind: "web", integration: "web", location: "https://news.example.com/feed.xml", urls: ["https://news.example.com/feed.xml"], scope: scope(), last_checked: now - 3_600_000, status: "ready", trusted_here: true, found: "\"Foo News\", a feed" },
  { id: "foo-notes", name: "Foo Notes", kind: "folder", integration: "folder", location: "/Users/someone/Documents/foo-notes", urls: [], scope: scope({ general: false, domains: ["money"] }), last_checked: now - 7_200_000, status: "ready", trusted_here: true, found: "12 readable files (10 md, 2 csv)" },
  { id: "bar-db", name: "Bar DB", kind: "database", integration: "database", location: "/Users/someone/data/bar.db", urls: [], scope: scope({ briefings: false }), last_checked: now - 60_000, status: "error", detail: "no database file", trusted_here: true, found: "Could not read it: no database file" },
  { id: "baz-context", name: "Baz Context", kind: "mcp", integration: "mcp-remote", location: "https://baz.example.com/mcp", urls: ["https://baz.example.com/mcp"], scope: scope(), last_checked: null, status: "untrusted_here", trusted_here: false },
];
const FIX = {
  read_ideal_state: "", read_omega: "", read_user_md: "", read_memory_md: "",
  engine_knowledge_sources: SOURCES,
  engine_knowledge_add: { source: { ...SOURCES[1], id: "qux-notes", name: "Qux Notes" }, probe: { ok: true }, adopted: false, found: "3 readable files (3 md)" },
  engine_knowledge_check: { source: SOURCES[3], probe: { ok: true }, adopted: true, found: "5 read-only tools" },
};
const SHOTS = process.env.APP_SHOTS;
const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? [])
    .filter((e) => e.cmd === c).map((e) => e.args), cmd);

async function openKnowledge(page: Page, width: number) {
  await page.goto("/");
  await openChatTab(page); await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "knowledge-sources" })));
  if (width < 500) {
    // On a phone the hub opens on its list; the row opens the section.
    await page.getByTestId("hub-row-knowledge").click({ timeout: 10_000 });
  }
  await expect(page.getByTestId("knowledge-sources")).toBeVisible({ timeout: 10_000 });
}
async function noSideScroll(page: Page) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(o.sw).toBeLessThanOrEqual(o.cw + 1);
}

for (const width of [1920, 1440, 768, 390]) {
  test.describe(`knowledge sources · ${width}`, () => {
    test.beforeEach(async ({ page }) => {
      page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await mockTauri(page, FIX);
    });

    test("one row per source: kind, use, what was found; paths stay in tooltips", async ({ page }) => {
      await openKnowledge(page, width);
      const rows = page.getByTestId("knowledge-row");
      await expect(rows).toHaveCount(4);
      await expect(rows.nth(1)).toContainText("Folder · Briefings, Money · 12 readable files");
      await expect(rows.nth(2)).toHaveAttribute("data-status", "error");
      await expect(rows.nth(3).getByTestId("knowledge-trust")).toBeVisible();
      await expect(page.getByTestId("knowledge-sources")).not.toContainText("/Users/someone");
      await noSideScroll(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/knowledge-${width}.png` });
    });

    test("add by pasting; the Fields show what it was understood as", async ({ page }) => {
      await openKnowledge(page, width);
      await page.getByTestId("knowledge-text").fill("my notes in ~/Documents/qux for money briefings");
      await page.getByTestId("knowledge-fields-toggle").click();
      await expect(page.getByTestId("knowledge-location")).toHaveValue("~/Documents/qux");
      await expect(page.getByTestId("knowledge-kind-folder")).toHaveAttribute("aria-checked", "true");
      await noSideScroll(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/knowledge-fields-${width}.png` });
      await page.getByTestId("knowledge-fields-toggle").click();
      await page.getByTestId("knowledge-submit").click();
      await expect(page.getByTestId("knowledge-found")).toContainText("3 readable files");
      expect((await calls(page, "engine_knowledge_add"))[0]).toMatchObject({ text: "my notes in ~/Documents/qux for money briefings" });
    });

    test("trust a source from another Mac; open a row to change its scope", async ({ page }) => {
      await openKnowledge(page, width);
      await page.getByTestId("knowledge-row").nth(3).getByTestId("knowledge-trust").click();
      await expect.poll(async () => (await calls(page, "engine_knowledge_check")).length).toBe(1);
      await page.getByTestId("knowledge-row").nth(0).getByTestId("knowledge-open").click();
      await expect(page.getByTestId("knowledge-detail")).toContainText("news.example.com/feed.xml");
      await noSideScroll(page);
    });
  });
}
