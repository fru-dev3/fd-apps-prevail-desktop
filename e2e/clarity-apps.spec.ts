// Apps as chat scopes: an app opens on its Chat tab, its Activity lists the
// access log, the fallback lanes live in their own groups, "@" references an
// app and sends it as --app, a reply shows "Used Gmail", a needs-sign-in card,
// a Google app's Account picker and per-account Activity, the sidebar's Apps
// toggle, and adding a trusted source (the MCP mocked).
// With APP_SHOTS set, each view is captured at 1440 and 390. Invented names.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const GMAIL = {
  id: "gmail", name: "Gmail", runtime: "claude", server: "claude.ai Gmail", url: "https://gmailmcp.googleapis.com/mcp/v1",
  status: "connected", signin_hint: "", syncable: true, domains: ["work"],
  tools: [
    { name: "search_threads", full_name: "mcp__claude_ai_Gmail__search_threads", kind: "read", sync_allowed: true, chat_default: true },
    { name: "create_draft", full_name: "mcp__claude_ai_Gmail__create_draft", kind: "write", sync_allowed: false, chat_default: false },
  ],
};
const FOO_DRIVE = { id: "foo-drive", name: "Foo Drive", runtime: "claude", server: "foo-drive", status: "needs_auth", signin_hint: "", syncable: true, domains: [] };
const now = Date.now();
const FIX = {
  read_ideal_state: "", read_omega: "", read_user_md: "", read_memory_md: "",
  // A connector opens on its product's page; this one has no page yet.
  entities_show: { found: false, id: "product/gmail", name: "gmail", kind: "product", aliases: [], mentions: [], co_mentions: [], notes: "", digest: "" },
  apps_mirror_list: {
    generated_at: 1,
    runtimes: [{ runtime: "claude", installed: true, syncable: true, signin_hint: "", count: 2 }],
    apps: [GMAIL, FOO_DRIVE],
  },
  engine_apps_threads: [{ slug: "2026-09-28_foo", title: "Mail from the foo team", updated: now - 3_600_000, turns: 4 }],
  engine_apps_access_log: [
    { ts: now - 120_000, tool: "search_threads", access: "read", outcome: "ran", thread: "2026-09-28_foo", domain: "work", summary: "query: from:foo newer_than:7d", app: "gmail", account: "foo@example.com" },
    { ts: now - 90_000, tool: "search_threads", access: "read", outcome: "ran", thread: "2026-09-28_foo", domain: "work", summary: "query: label:invoices", app: "gmail", account: "bar@example.com" },
    { ts: now - 60_000, tool: "create_draft", access: "write", outcome: "queued", thread: "2026-09-28_foo", domain: "work", summary: "to: [an email address], subject: Foo invoice", app: "gmail" },
  ],
  engine_apps_accounts: [
    { id: "foo@example.com", default: true, via: "gws" },
    { id: "bar@example.com", label: "Bar", default: false, via: "gws" },
  ],
  apps_untrusted_sources: [],
  engine_knowledge_sources: [],
  engine_knowledge_add: {
    source: { id: "context-fru-dev", name: "Context (fru.dev)", kind: "mcp", integration: "mcp-remote", location: "https://context.fru.dev/mcp", urls: ["https://context.fru.dev/mcp"], scope: { briefings: true, general: true, domains: [], projects: [] }, last_checked: 1, status: "ready", trusted_here: true, found: "4 read-only tools: list_sources, search, query_source, source_spec" },
    probe: { ok: true }, adopted: false, found: "4 read-only tools: list_sources, search, query_source, source_spec", detected: "MCP server",
  },
  entities_list: { generated_ts: 1, total: 1, entities: [{ id: "person/foo", name: "Foo Bar", kind: "person", aliases: [], mention_count: 3, conversations: 1, last_ts: 1, saved: true, has_page: true }] },
};

const SHOTS = process.env.APP_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()?.width}.png` });
}
const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? [])
    .filter((e) => e.cmd === c).map((e) => e.args), cmd);

async function home(page: Page) {
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
}
async function openApps(page: Page) {
  await home(page);
  // Connections is a view of Products (the old Apps page id lands on it).
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "connectors" })));
  await expect(page.getByTestId("connections-view")).toBeVisible({ timeout: 10_000 });
}
async function openGmail(page: Page) {
  await openApps(page);
  const row = page.getByTestId("mirror-row-gmail");
  await row.click();
  // A connector opens on its product's page, on the App tab.
  await expect(page.getByTestId("product-app-pane")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("entity-tab-app")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("app-header")).toContainText("via Claude");
}
// Play one engine turn into the chat that just sent.
async function play(page: Page, events: Record<string, unknown>[]) {
  const [last] = (await calls(page, "engine_chat")).slice(-1);
  const session = String(last.session);
  await page.evaluate(([s, evs]) => {
    const emit = (window as unknown as { __emit: (e: string, p: unknown) => void }).__emit;
    for (const data of evs as unknown[]) emit("engine-chat:line", { session: s, data });
    emit("engine-chat:done", { session: s, code: 0 });
  }, [session, events] as [string, unknown[]]);
}

for (const width of [1440, 390]) {
  test.describe(`apps · ${width}`, () => {
    test.beforeEach(async ({ page }) => {
      page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await page.addInitScript(() => localStorage.setItem("prevail.desktop.defaultChatCli", "claude"));
      await mockTauri(page, FIX);
    });

    test("an app opens on its Chat tab, scoped to the app", async ({ page }) => {
      await openGmail(page);
      await expect(page.getByTestId("app-tab-chat")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("app-chat").locator("[data-tour=composer] textarea")).toBeVisible();
      await expect(page.getByTestId("app-header")).toContainText("via Claude");
      await expect(page.getByTestId("app-thread-picker")).toBeVisible();
      await shot(page, "app-chat");
      // The fallback lanes are not under the app.
      await expect(page.getByText("Sites without a connector")).toHaveCount(0);
    });

    test("the Activity tab lists the access log", async ({ page }) => {
      await openGmail(page);
      await page.getByTestId("app-tab-activity").click();
      const pane = page.getByTestId("product-app-pane");
      await expect(pane.getByTestId("access-line")).toHaveCount(3);
      await expect(pane.getByTestId("app-activity")).toContainText("to: [an email address], subject: Foo invoice");
      await expect(pane.getByTestId("app-activity")).toContainText("Waiting for you");
      await shot(page, "app-activity");
    });

    test("the fallback lanes live under their own groups", async ({ page }) => {
      await openApps(page);
      if (width < 500) await expect(page.getByTestId("apps-row-sites")).toBeVisible();
      await page.getByTestId("apps-row-sites").click();
      await expect(page.getByText("Sites without a connector")).toBeVisible();
      await expect(page.getByTestId("app-scope")).toHaveCount(0);
    });

    test("adding a trusted source opens Knowledge sources: the suggestion, one click, what it found", async ({ page }) => {
      await openApps(page);
      await page.getByTestId("apps-row-add-source").click();
      if (width < 500) await page.getByTestId("hub-row-knowledge").click({ timeout: 10_000 });
      await expect(page.getByTestId("knowledge-suggested")).toContainText("Context (fru.dev)", { timeout: 10_000 });
      await shot(page, "add-source");
      await page.getByTestId("knowledge-suggested").getByRole("button", { name: /Add/ }).click();
      await expect(page.getByTestId("knowledge-found")).toContainText("4 read-only tools");
      expect((await calls(page, "engine_knowledge_add"))[0]).toMatchObject({ text: "https://context.fru.dev/mcp", name: "Context (fru.dev)" });
      await shot(page, "add-source-done");
    });

    test("@ suggests an app, inserts a chip and sends it as --app; the reply shows Used Gmail", async ({ page }) => {
      await home(page);
      const box = page.locator("[data-tour=composer] textarea").first();
      await box.click();
      await box.pressSequentially("@gm");
      await expect(page.getByTestId("ref-suggest")).toBeVisible();
      await page.getByTestId("ref-option-app-gmail").click();
      await expect(page.getByTestId("ref-chip-app")).toContainText("@Gmail");
      await expect(box).toHaveValue("");
      await box.fill("anything new from the foo team?");
      await box.press("Enter");
      await expect.poll(async () => (await calls(page, "engine_chat")).length).toBe(1);
      expect((await calls(page, "engine_chat"))[0]).toMatchObject({ apps: ["gmail"], entities: [], refDomains: [], scopeApp: null });
      await play(page, [
        { type: "start", thread: "t1" },
        { type: "tool", thread: "t1", app: "gmail", step: { id: "a", label: "Claude ai Gmail search threads", status: "running" } },
        { type: "tool", thread: "t1", app: "gmail", step: { id: "a", label: "Claude ai Gmail search threads", status: "done" } },
        { type: "tool", thread: "t1", app: "gmail", step: { id: "b", label: "Claude ai Gmail search threads", status: "done" } },
        { type: "tool", thread: "t1", app: "gmail", step: { id: "c", label: "Claude ai Gmail search threads", status: "done" } },
        { type: "assistant", thread: "t1", text: "Two threads from the foo team: the invoice and the offsite." },
      ]);
      const chip = page.getByTestId("app-use-chip");
      await expect(chip).toContainText("Used Gmail · 3 reads");
      await shot(page, "chat-used-gmail");
      await chip.click();
      await expect(page.getByTestId("app-tab-activity")).toHaveAttribute("aria-selected", "true", { timeout: 10_000 });
      expect((await calls(page, "engine_apps_access_log")).some((a) => a.app === "gmail" && a.thread === "t1")).toBe(true);
    });

    test("a Google app's Account picker sends --google-account and is remembered per app", async ({ page }) => {
      await openGmail(page);
      const picker = page.getByTestId("app-account-picker");
      await expect(picker).toBeVisible();
      await expect(picker.locator("option")).toHaveText(["All accounts", "foo@example.com", "Bar"]);
      await expect(picker).toHaveValue("all");
      const box = page.getByTestId("app-chat").locator("[data-tour=composer] textarea");
      await box.fill("anything new from foo");
      await box.press("Enter");
      await expect.poll(async () => (await calls(page, "engine_chat")).length).toBe(1);
      expect((await calls(page, "engine_chat"))[0]).toMatchObject({ scopeApp: "gmail", googleAccount: "all" });
      await play(page, [{ type: "assistant", text: "Nothing new." }]);
      await picker.selectOption("bar@example.com");
      await box.fill("and from bar");
      await box.press("Enter");
      await expect.poll(async () => (await calls(page, "engine_chat")).length).toBe(2);
      expect((await calls(page, "engine_chat"))[1]).toMatchObject({ googleAccount: "bar@example.com" });
      expect(await page.evaluate(() => localStorage.getItem("prevail.app.gmail.googleAccount"))).toBe("bar@example.com");
      await openGmail(page); // a fresh load

      await expect(page.getByTestId("app-account-picker")).toHaveValue("bar@example.com");
      await page.getByTestId("app-tab-connection").click();
      await expect(page.getByTestId("app-account-row")).toHaveCount(2);
      await expect(page.getByTestId("app-accounts")).toContainText("via Google Workspace");
    });

    test("the Activity tab shows each line's account and filters by it", async ({ page }) => {
      await openGmail(page);
      await page.getByTestId("app-tab-activity").click();
      // The product page's overview has its own Apps used list; read the App tab's.
      const pane = page.getByTestId("product-app-pane");
      await expect(pane.getByTestId("access-account")).toHaveText(["bar@example.com", "foo@example.com"]);
      await pane.getByTestId("activity-account-filter").selectOption("foo@example.com");
      await expect(pane.getByTestId("access-line")).toHaveCount(1);
      await expect(pane.getByTestId("app-activity")).toContainText("from:foo");
      await pane.getByTestId("activity-account-filter").selectOption("");
      await expect(pane.getByTestId("access-line")).toHaveCount(3);
    });

    test("an app that needs sign-in renders an in-flow card", async ({ page }) => {
      await home(page);
      const box = page.locator("[data-tour=composer] textarea").first();
      await box.click();
      await box.pressSequentially("@foo");
      await page.getByTestId("ref-option-app-foo-drive").click();
      await box.fill("find the foo deck");
      await box.press("Enter");
      await expect.poll(async () => (await calls(page, "engine_chat")).length).toBe(1);
      await play(page, [
        { type: "app_needs_auth", app: "foo-drive", name: "Foo Drive" },
        { type: "routed", runtime: "claude", reason: "owns every referenced app" },
        { type: "assistant", text: "Foo Drive needs you to sign in first." },
      ]);
      await expect(page.getByTestId("app-needs-auth")).toContainText("Foo Drive needs sign-in");
      await expect(page.getByTestId("app-routed")).toContainText("Using Claude for Foo Drive");
      await shot(page, "chat-needs-auth");
    });
  });
}

test("sidebar · the Domains chevron sits at the right, shows on hover, and the row toggles the section", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockTauri(page, FIX);
  await home(page);
  const head = page.getByTestId("sidebar-head-domains");
  const toggle = head.locator("button[aria-expanded]");
  const chevron = page.getByTestId("sidebar-toggle-domains");
  const hb = (await head.boundingBox())!;
  const cb = (await chevron.boundingBox())!;
  expect(hb.x + hb.width - (cb.x + cb.width)).toBeLessThan(12);
  // Progressive reveal: hidden until the header row is hovered.
  await page.mouse.move(800, 400);
  await expect(chevron).toHaveCSS("opacity", "0");
  await head.hover();
  await expect(chevron).toHaveCSS("opacity", "1");
  await expect(page.getByTestId("sidebar-domains-list")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(page.getByTestId("sidebar-domains-list")).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.getByTestId("sidebar-domains-list")).toBeVisible();
});
