// Entities and Activities (ia-plan.md, IA0) in the real bundle, the engine
// mocked: the six kinds in the sidebar with icons, the two group pages with
// icon tabs and breadcrumbs, Products as one list, a thing's details, an
// event on the week strip that becomes a project, links, new by talking, the
// @ picker and search. At 390, 768, 1280 and 1920 nothing scrolls sideways.
// With IA_SHOTS=<dir> each step is captured. Invented names only.
import { test, expect, type Page } from "@playwright/test";
import { openSidebar } from "./sidebar-open";
import { mockTauri } from "./tauri-mock";

const SHOTS = process.env.IA_SHOTS;
const d = new Date();
const ymd = (n: number) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };

const E = (id: string, name: string, kind: string, n = 1, extra: Record<string, unknown> = {}) => ({ id, name, kind, aliases: [], mention_count: n, conversations: n, last_ts: n, saved: true, has_page: true, relation: "yours", ...extra });
const LIST = { generated_ts: 1, total: 9, entities: [
  E("person/sam-foo", "Sam Foo", "person", 6, { home_domain: "home" }), E("person/ada-bar", "Ada Bar", "person", 3),
  E("place/foo-house", "Foo House", "place", 4), E("place/bar-lake-cabin", "Bar Lake cabin", "place", 2),
  E("product/foo-bank", "Foo Bank", "product", 5, { domain: "foobank.example" }),
  E("thing/foo-watch", "Foo Watch", "thing", 2), E("thing/bar-car", "Bar wagon", "thing", 3),
  E("event/foo-dinner", "Foo family dinner", "event", 1), E("event/christmas", "Christmas", "event", 1),
] };
const PRODUCTS = { products: [
  { id: "product/foo-bank", name: "Foo Bank", company: true, apps: [{ id: "foo-bank", title: "Foo Bank", kind: "service", category: "banking", domains: ["foobank.example"] }], saved: true, has_page: true, conversations: 5, last_ts: 5, relation: "yours", domain: "foobank.example" },
  { id: "product/bar-notes", name: "Bar Notes", company: false, apps: [{ id: "bar-notes", title: "Bar Notes", kind: "app", domains: [] }], saved: false, has_page: false, conversations: 0, last_ts: 0, relation: "yours" },
  { id: "product/baz-power", name: "Baz Power", company: true, apps: [], saved: true, has_page: true, conversations: 2, last_ts: 2, relation: "yours" },
] };
const EVENTS = { events: [
  { id: "event/foo-dinner", name: "Foo family dinner", date: ymd(1), time: "18:30", source: "prevail", has_page: true, place: { id: "place/foo-house", name: "Foo House" }, calendar: "ask" },
  { id: "calendar:cal-1", name: "Foo dentist", date: ymd(0), source: "calendar", has_page: false, calendar: "synced" },
  { id: "milestone:paint-the-shed:ms-paint", name: "Paint bought", date: ymd(4), source: "milestone", has_page: false, project: { id: "mission/paint-the-shed", name: "Paint the shed" } },
  { id: "event/christmas", name: "Christmas", date: ymd(40), source: "prevail", has_page: true, project: { id: "mission/plan-christmas", name: "Plan Christmas" } },
] };
const FIX: Record<string, unknown> = {
  read_ideal_state: "", read_omega: "", read_user_md: "", read_memory_md: "",
  entities_list: LIST, ia_products: PRODUCTS, ia_events: EVENTS,
  // A connector in an AI runtime that is the Foo Bank app: its connection shows on the product's page.
  apps_mirror_list: { generated_at: 1, runtimes: [], apps: [{ id: "claude:foo-bank", name: "Foo Bank", runtime: "claude", server: "foo-bank", status: "needs_auth", signin_hint: "https://claude.ai/settings/connectors", syncable: true, domains: [] }] },
  ia_links: { id: "event/foo-dinner", links: [
    { id: "person/sam-foo", name: "Sam Foo", kind: "people", via: "link" },
    { id: "place/foo-house", name: "Foo House", kind: "places", via: "field", role: "place" },
    { id: "mission/plan-christmas", name: "Plan Christmas", kind: "projects", via: "project" },
  ] },
  ia_event_adopt: { ok: true, id: "event/foo-dentist", created: true },
  ia_event_calendar: { ok: true, calendar: "synced" },
  ia_event_project: { ok: true, project: { id: "mission/plan-foo-family-dinner", name: "Plan Foo family dinner" }, created: true },
  ia_draft: { draft: { name: "Foo birthday", date: ymd(9), place: "Foo House" }, filled: ["name", "date", "place"], reply: "Got it. Say save to keep it.", ready: true, missing: [], go: false },
  engine_entity_threads: [], engine_entities_duplicates: [], engine_entities_files: [],
  engine_missions_list: [
    { slug: "plan-christmas", id: "mission/plan-christmas", name: "Plan Christmas", status: "active", outcome: "Christmas is ready", target: ymd(40), domains: [], apps: [], specialists: [], people: [], progress: { days: { day: 2, total: 42, left: 40 }, milestones: { done: 0, total: 2 }, budget: { planned: 0, used: 0 } } },
    { slug: "paint-the-shed", id: "mission/paint-the-shed", name: "Paint the shed", status: "active", outcome: "A painted shed", target: ymd(30), domains: [], apps: [], specialists: [], people: [], progress: { days: { day: 5, total: 35, left: 30 }, milestones: { done: 0, total: 1 }, budget: { planned: 0, used: 0 } } },
  ],
};

async function open(page: Page, width: number) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await mockTauri(page, { ...FIX, __fresh_sidebar: false });
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await openSidebar(page, ["entities", "activities"], ["people", "events", "projects"]);
  // One detail per id: what each object's page says about itself.
  await page.evaluate(() => {
    const fx = (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures;
    const d0 = new Date();
    const day = (n: number) => { const x = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
    const list = (fx.entities_list as { entities: { id: string; name: string; kind: string }[] }).entities;
    const products = (fx.ia_products as { products: { id: string; name: string; apps: unknown[] }[] }).products;
    fx.entities_show = (a: { id: string }) => {
      const id = a.id;
      const [kind, slug] = id.split("/");
      const e = list.find((x) => x.id === id) ?? products.find((p) => p.id === id) ?? { name: slug === "foo-dentist" ? "Foo dentist" : slug, kind };
      const fields = kind === "event" ? (slug === "christmas" ? { date: day(40), project: "mission/plan-christmas", calendar: "synced" } : { date: day(1), time: "18:30", place: "place/foo-house", people: ["person/sam-foo"], calendar: "ask" })
        : kind === "thing" ? { purchased: "2025-03-01", warranty: day(400), value: 420, maker: "product/foo-bank", place: "place/foo-house", service: [{ date: "2026-01-10", what: "Battery replaced", cost: 35 }] } : {};
      return { found: true, id, name: e.name, kind, aliases: [], kinds: [kind], mention_count: 2, conversations: 2, last_ts: Date.now() - 86_400_000,
        mentions: [], co_mentions: [], digest: kind === "person" ? "Sam lends the ladder and helps with the shed." : "", notes: "", saved: true,
        page_path: `data/entities/x/${slug}/entity.md`, relation: "yours", fields, ...(kind === "product" ? { apps: products.find((p) => p.id === id)?.apps ?? [] } : {}) };
    };
  });
}
async function shot(page: Page, name: string, width: number) {
  await page.waitForTimeout(350);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(wide, `${name} scrolls sideways at ${width}`).toBeLessThanOrEqual(1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${width}.png`, fullPage: false });
}
const fire = (page: Page, ev: string, detail: string) => page.evaluate(([e, x]) => window.dispatchEvent(new CustomEvent(e, { detail: x })), [ev, detail]);

for (const width of [390, 768, 1280, 1920]) {
  const phone = width < 500;
  // Below 1100px a kind's list and detail stack (list, then detail), like a phone.
  const stacked = width < 1100;
  test.describe(`ia · ${width}`, () => {
    test("the sidebar holds ENTITIES and ACTIVITIES, each kind with its icon", async ({ page }) => {
      await open(page, width);
      if (phone) { await shot(page, "ia-home", width); return; }
      const side = page.getByTestId("app-sidebar");
      for (const k of ["people", "places", "products", "things", "events", "projects"]) await expect(side.getByTestId(`sidebar-kind-${k}`).locator("svg")).toBeVisible();
      await expect(side.getByTestId("sidebar-kind-items-people")).toContainText("Sam Foo");
      await expect(side.getByTestId("sidebar-kind-items-events")).toContainText("Foo family dinner");
      await expect(side.getByTestId("sidebar-missions")).toContainText("Plan Christmas");
      await side.getByTestId("sidebar-kind-events").hover();
      await expect(side.getByTestId("sidebar-kind-add-events")).toHaveCSS("opacity", "1");
      await shot(page, "ia-sidebar", width);
      await side.getByTestId("sidebar-kind-products").click();
      await expect(page.getByTestId("ia-page-entities")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("ia-kind-products")).toBeVisible();
      await expect(side.getByTestId("sidebar-kind-products")).toHaveAttribute("aria-current", "page");
    });

    test("Entities: icon tabs, breadcrumbs, Products as one list, a thing's details", async ({ page }) => {
      await open(page, width);
      await fire(page, "prevail:work-section", "people");
      await expect(page.getByTestId("ia-page-entities")).toBeVisible({ timeout: 10_000 });
      const tabs = page.getByRole("tablist", { name: "Entities" }).getByRole("tab");
      await expect(tabs).toHaveText(["People", "Places", "Products", "Things"]);
      for (let i = 0; i < 4; i++) await expect(tabs.nth(i).locator("svg")).toBeVisible();
      if (stacked) await page.getByTestId("entity-row").first().click();
      await expect(page.getByTestId("entity-detail")).toContainText("Sam Foo", { timeout: 10_000 });
      if (!phone) await expect(page.getByTestId("ia-breadcrumbs")).toHaveText(/Entities.*People.*Sam Foo/);
      await shot(page, "ia-people", width);
      await fire(page, "prevail:work-section", "products");
      const rows = page.getByTestId("entity-row");
      await expect(rows).toHaveCount(3, { timeout: 10_000 });
      await expect(rows.nth(0)).toContainText("Service");
      await expect(page.getByTestId("entities-list")).toContainText("Bar Notes");
      if (stacked) await rows.first().click();
      // A product's app lives on its page: the App tab, and its connection on the overview.
      await expect(page.getByTestId("entity-tab-app")).toBeVisible({ timeout: 10_000 });
      const conn = page.getByTestId("product-connection");
      await expect(conn.getByTestId("product-connector")).toHaveAttribute("data-id", "claude:foo-bank");
      await expect(conn).toContainText("via Claude");
      if (!stacked) await expect(page.getByTestId("tab-connections")).toBeVisible();
      await page.getByTestId("product-open-app").click();
      await expect(page.getByTestId("product-app-pane")).toBeVisible({ timeout: 10_000 });
      await shot(page, "ia-products", width);
      await fire(page, "prevail:work-section", "things");
      if (stacked) await page.getByTestId("entity-row").first().click();
      const details = page.getByTestId("thing-details");
      await expect(details).toContainText("$420", { timeout: 10_000 });
      await expect(page.getByTestId("thing-service")).toContainText("Battery replaced");
      await shot(page, "ia-thing", width);
    });

    test("Activities: events on the week strip, the calendar question, an event becomes a project", async ({ page }) => {
      await open(page, width);
      await fire(page, "prevail:work-section", "events");
      await expect(page.getByTestId("ia-page-activities")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("tablist", { name: "Activities" }).getByRole("tab")).toHaveText(["Events", "Projects"]);
      const strip = page.getByTestId("calendar-strip");
      await expect(strip.getByTestId("strip-event").first()).toBeVisible({ timeout: 10_000 });
      await expect(strip.getByTestId("strip-day")).toHaveCount(7);
      if (stacked) await page.getByTestId("event-row").first().click();
      const ask = page.getByTestId("event-calendar-ask");
      await expect(ask).toBeVisible({ timeout: 10_000 });
      expect(await page.evaluate(() => (window as unknown as { __invokeLog: { cmd: string }[] }).__invokeLog.filter((e) => e.cmd === "ia_event_calendar").length)).toBe(0);
      await shot(page, "ia-event", width);
      await page.getByTestId("event-make-project").click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __invokeLog: { cmd: string; args: unknown }[] }).__invokeLog.filter((e) => e.cmd === "ia_event_project").map((e) => e.args))).toEqual([{ vault: "/tmp/smoke-vault", id: "event/foo-dinner", project: null }]);
      await page.getByTestId("entity-tab-links").click();
      await expect(page.getByTestId("object-links")).toContainText("Plan Christmas", { timeout: 10_000 });
      await shot(page, "ia-event-links", width);
      // A calendar entry opens as an event page.
      if (stacked) await page.getByRole("button", { name: "All events" }).click();
      await page.getByTestId("event-row").filter({ hasText: "Foo dentist" }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __invokeLog: { cmd: string; args: unknown }[] }).__invokeLog.filter((e) => e.cmd === "ia_event_adopt").map((e) => e.args))).toEqual([{ vault: "/tmp/smoke-vault", row: "calendar:cal-1" }]);
      if (!stacked) {
        await page.getByRole("tab", { name: "Projects" }).click();
        await expect(page.getByTestId("missions-page")).toBeVisible({ timeout: 10_000 });
        await shot(page, "ia-projects", width);
      }
    });

    test("a new event by talking; the @ picker and search speak the kinds", async ({ page }) => {
      await open(page, width);
      await fire(page, "prevail:work-section", "events");
      await page.getByTestId("events-new").click();
      await page.getByTestId("new-object-input").fill("Foo birthday next week at Foo House");
      await page.getByTestId("new-object-send").click();
      await expect(page.getByTestId("new-object-summary")).toContainText("Foo birthday", { timeout: 10_000 });
      await expect(page.getByTestId("new-object-save")).toBeVisible();
      await shot(page, "ia-new-event", width);
      if (phone) return;
      await page.keyboard.press("Meta+k");
      await page.getByPlaceholder(/Search actions/).fill("foo");
      await expect(page.getByText("Foo family dinner").first()).toBeVisible();
      await expect(page.getByText("People", { exact: true }).first()).toBeVisible();
      await shot(page, "ia-search", width);
      await page.keyboard.press("Escape");
      await fire(page, "prevail:open-settings", "inbox");
      await page.evaluate(() => { window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: "" })); });
      const box = page.locator("[data-tour=composer] textarea").first();
      await box.waitFor({ timeout: 10_000 });
      await box.fill("@foo");
      const sug = page.getByTestId("ref-suggest");
      await expect(sug).toBeVisible({ timeout: 10_000 });
      await expect(sug).toContainText("Events");
      await expect(sug).toContainText("People");
      await shot(page, "ia-at-picker", width);
    });
  });
}
