// Entities: the detail's tabs (Overview, Chat, Notes, Conversations), the
// Chat tab's height and speed, the one-line kind filter, and the duplicates
// review. Names are invented.
import { test, expect, type Page } from "@playwright/test";
import { openChatTab } from "./open-chat";
import { mockTauri } from "./tauri-mock";

const FOO = { id: "person/foo", name: "Foo Bar", kind: "person", aliases: ["Foo"], mention_count: 3, conversations: 1, last_ts: 1, saved: true, has_page: true };
const FIX = {
  read_ideal_state: "", read_omega: "", read_user_md: "", read_memory_md: "",
  entities_list: { generated_ts: 1, total: 3, entities: [
    FOO,
    { id: "person/foo-2", name: "Foo", kind: "person", aliases: [], mention_count: 1, conversations: 1, last_ts: 1, saved: false, has_page: false },
    { id: "place/foo-town", name: "Foo Town", kind: "place", aliases: [], mention_count: 1, conversations: 1, last_ts: 1, saved: false, has_page: false },
  ] },
  entities_show: { found: true, id: "person/foo", name: "Foo Bar", kind: "person", aliases: ["Foo"], kinds: ["person"], mention_count: 3, conversations: 1, last_ts: 1783000000000, mentions: [], co_mentions: [], page_path: "data/entities/people/foo.md", saved: true, digest: "Foo runs the bar by the river.", notes: "" },
  engine_entity_threads: [],
  engine_entities_duplicates: [
    { pair: "person/foo|person/foo-2", a: { id: "person/foo", name: "Foo Bar", kind: "person", mentions: 3 }, b: { id: "person/foo-2", name: "Foo", kind: "person", mentions: 1 }, confidence: 0.7, reason: "Foo is contained in Foo Bar and they share a conversation." },
    { pair: "place/foo-town|place/foo-towne", a: { id: "place/foo-town", name: "Foo Town", kind: "place", mentions: 1 }, b: { id: "place/foo-towne", name: "Foo Towne", kind: "place", mentions: 1 }, confidence: 0.6, reason: "One letter apart." },
  ],
  engine_entities_merge: { ok: true, id: "person/foo" },
  engine_entities_not_same: { ok: true },
};

const args = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? [])
    .filter((e) => e.cmd === c).map((e) => e.args), cmd);

async function openEntities(page: Page) {
  await page.goto("/");
  await openChatTab(page); await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "entities" })));
  await expect(page.getByTestId("entity-detail")).toContainText("Foo Bar", { timeout: 10_000 });
}

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockTauri(page, FIX);
});

test("entities · tabs switch in place without remounting", async ({ page }) => {
  await openEntities(page);
  await page.getByTestId("entity-tab-notes").click();
  await page.getByLabel("Your notes").fill("Call after 5.");
  await page.getByTestId("entity-tab-chat").click();
  const box = page.getByTestId("entity-chat").locator("[data-tour=composer] textarea");
  await box.fill("a draft");
  await page.getByTestId("entity-tab-overview").click();
  await expect(page.getByTestId("entity-overview")).toContainText("Foo runs the bar by the river.");
  await expect(page.getByTestId("entity-overview")).toContainText("Also known as");
  await page.getByTestId("entity-tab-notes").click();
  await expect(page.getByLabel("Your notes")).toHaveValue("Call after 5.");
  await page.getByTestId("entity-tab-chat").click();
  await expect(box).toHaveValue("a draft");
  await expect(page.getByText("Back to overview")).toHaveCount(0);
  // The detail was fetched once: switching never reloads it.
  expect((await args(page, "entities_show")).length).toBe(1);
});

test("entities · the composer is fully visible at 1440x900 and the kind filter (icons and labels) fits in two lines", async ({ page }) => {
  await openEntities(page);
  const tabs = page.getByTestId("entity-kind-filter").getByRole("tab");
  const tops = await tabs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBeLessThanOrEqual(2);
  await page.getByTestId("entity-tab-chat").click();
  const composer = page.getByTestId("entity-chat").locator("[data-tour=composer]");
  await expect(composer).toBeVisible({ timeout: 10_000 });
  const box = await composer.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(900);
  // The pane itself does not scroll: the chat fills it exactly.
  const over = await page.getByTestId("spine-detail").evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(over).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${process.env.MOBILE_SHOTS_DIR || "/tmp"}/desktop-entity-chat-tab.png` });
});

test("entities · the Chat tab paints without waiting on the engine", async ({ page }) => {
  await openEntities(page);
  // Every later engine read hangs for 5 seconds.
  await page.evaluate(() => {
    const fx = (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures;
    for (const k of ["engine_entity_threads", "list_threads", "load_thread"]) {
      const v = fx[k];
      fx[k] = () => new Promise((r) => setTimeout(() => r(v), 5000));
    }
  });
  const t0 = Date.now();
  await page.getByTestId("entity-tab-chat").click();
  await expect(page.getByTestId("entity-chat").locator("[data-tour=composer]")).toBeVisible({ timeout: 2_000 });
  expect(Date.now() - t0).toBeLessThan(2_000);
});

test("entities · duplicates: Merge and Not the same call the engine and drop the pair", async ({ page }) => {
  await openEntities(page);
  const row = page.getByTestId("entity-dups-row");
  await expect(row).toContainText("Possible duplicates (2)");
  await row.click();
  const pane = page.getByTestId("entity-duplicates");
  const pairs = pane.getByTestId("dup-pair");
  await expect(pairs).toHaveCount(2);
  await expect(pairs.first()).toContainText("Foo is contained in Foo Bar");
  await page.screenshot({ path: `${process.env.MOBILE_SHOTS_DIR || "/tmp"}/desktop-entity-duplicates.png` });
  // After the first action the engine has only the second pair left.
  await page.evaluate(() => {
    const fx = (window as unknown as { __fixtures: Record<string, unknown[]> }).__fixtures;
    fx.engine_entities_duplicates = fx.engine_entities_duplicates.slice(1);
  });
  await pairs.first().getByTestId("dup-merge").click();
  await expect(pairs).toHaveCount(1);
  // The engine's suggested keeper (a) is kept by default.
  expect(await args(page, "engine_entities_merge")).toEqual([{ vault: "/tmp/smoke-vault", keep: "person/foo", merge: "person/foo-2" }]);
  await page.evaluate(() => { (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures.engine_entities_duplicates = []; });
  await pairs.first().getByTestId("dup-not-same").click();
  await expect(pairs).toHaveCount(0);
  expect(await args(page, "engine_entities_not_same")).toEqual([{ vault: "/tmp/smoke-vault", a: "place/foo-town", b: "place/foo-towne" }]);
  await expect(row).toHaveCount(0);
});

test("entities · on a phone the tabs fit and the page never scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "entities" })));
  await page.getByTestId("entity-row").first().click({ timeout: 15_000 });
  await expect(page.getByTestId("entity-tab-conversations")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("entity-tab-chat").click();
  const composer = page.getByTestId("entity-chat").locator("[data-tour=composer]");
  await expect(composer).toBeVisible({ timeout: 10_000 });
  const cb = (await composer.boundingBox())!;
  expect(cb.y + cb.height).toBeLessThanOrEqual(844 - 36);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${process.env.MOBILE_SHOTS_DIR || "/tmp"}/phone-entity-chat-tab.png` });
});

// ── Pictures, websites and files ────────────────────────────────────────────
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const FOO_PIC = "/tmp/smoke-vault/data/entities/people/foo/picture.png";
const FOO_PRODUCT = { id: "product/foo-labs", name: "Foo Labs", kind: "product", aliases: [], mention_count: 2, conversations: 2, last_ts: 1, saved: true, has_page: true, website: "foolabs.dev" };

async function openWith(page: Page, fx: Record<string, unknown>) {
  await mockTauri(page, { ...FIX, ...fx });
  await openEntities(page);
}

test("entities · an entity with a picture shows it in the row and the header", async ({ page }) => {
  await openWith(page, {
    entities_list: { generated_ts: 1, total: 1, entities: [{ ...FOO, picture: FOO_PIC }] },
    entities_show: { ...(FIX.entities_show as object), page_path: "data/entities/people/foo/entity.md", picture: FOO_PIC },
    engine_entity_picture: PNG,
  });
  await expect(page.getByTestId("entity-avatar").locator("img")).toHaveAttribute("src", PNG);
  await expect(page.getByTestId("entity-row").first().locator("img")).toHaveAttribute("src", PNG);
  expect(await args(page, "engine_entity_picture")).toContainEqual({ vault: "/tmp/smoke-vault", path: FOO_PIC });
});

test("entities · Set picture sends the picked file to the engine", async ({ page }) => {
  await openWith(page, { "plugin:dialog|open": "/tmp/foo.png", engine_entities_set_picture: { ok: true, path: FOO_PIC } });
  await page.getByRole("button", { name: "More entity actions" }).click();
  await page.getByRole("menuitem", { name: /Set picture/ }).click();
  await expect.poll(async () => (await args(page, "engine_entities_set_picture"))[0] ?? null)
    .toEqual({ vault: "/tmp/smoke-vault", id: "person/foo", file: "/tmp/foo.png" });
});

for (const bunker of [false, true]) {
  test(`entities · a product with a website ${bunker ? "shows no logo in Bunker Mode" : "shows its logo and keeps it"}`, async ({ page }) => {
    await mockTauri(page, { ...FIX,
      bunker_status: { enabled: bunker, network_blocked: bunker, web_blocked: bunker, cloud_blocked: bunker, local_available: true },
      entities_list: { generated_ts: 1, total: 1, entities: [FOO_PRODUCT] },
      // Products are one store: each product folder holds its page and its app.
      ia_products: { products: [{ id: FOO_PRODUCT.id, name: FOO_PRODUCT.name, company: true, apps: [], website: FOO_PRODUCT.website, saved: true, has_page: true, conversations: 2, last_ts: 1, relation: "yours" }] },
      entities_show: { found: true, ...FOO_PRODUCT, kinds: ["product"], mentions: [], co_mentions: [], page_path: "data/entities/products/foo-labs/entity.md", digest: "", notes: "" },
      app_favicon: PNG,
      engine_entities_set_picture: { ok: true },
    });
    await page.goto("/");
    await openChatTab(page); await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "products" })));
    const row = page.getByTestId("entity-row").first();
    await expect(row).toContainText("Foo Labs", { timeout: 10_000 });
    if (!bunker) {
      await expect(row.locator("img")).toHaveAttribute("src", PNG);
      expect(await args(page, "app_favicon")).toContainEqual({ host: "foolabs.dev" });
      // Fetched once, then saved into the entity's folder.
      await expect.poll(async () => (await args(page, "engine_entities_set_picture"))[0] ?? null)
        .toEqual({ vault: "/tmp/smoke-vault", id: "product/foo-labs", dataUri: PNG });
    } else {
      await page.waitForTimeout(300);
      await expect(row.locator("img")).toHaveCount(0);
      expect(await args(page, "app_favicon")).not.toContainEqual({ host: "foolabs.dev" });
    }
  });
}

test("entities · the Files tab lists the entity's files and previews a text file", async ({ page }) => {
  await openWith(page, {
    entities_show: { ...(FIX.entities_show as object), page_path: "data/entities/people/foo/entity.md" },
    engine_entities_files: [{ name: "lease.md", size: 2048, mtime: 1783000000000 }, { name: "photo.png", size: 500, mtime: 1783000000 }],
    read_text_file: "# Lease\nSigned by Foo.",
  });
  await page.getByTestId("entity-tab-files").click();
  const files = page.getByTestId("entity-files").getByTestId("entity-file");
  await expect(files).toHaveCount(2);
  await expect(files.first()).toContainText("lease.md");
  await files.first().click();
  await expect(page.getByTestId("entity-file-preview")).toContainText("Signed by Foo.");
  expect(await args(page, "read_text_file")).toContainEqual({ path: "/tmp/smoke-vault/data/entities/people/foo/files/lease.md" });
});

test("entities · an encrypted vault turns pictures and files off", async ({ page }) => {
  await openWith(page, {
    engine_vault_status: { encrypted: true, unlocked: true },
    entities_show: { ...(FIX.entities_show as object), page_path: "data/entities/people/foo/entity.md" },
    engine_entities_files: [],
  });
  await page.getByRole("button", { name: "More entity actions" }).click();
  await expect(page.getByRole("menuitem", { name: /Set picture/ })).toBeDisabled();
  await page.getByTestId("entity-overview").click({ position: { x: 5, y: 5 } });
  await page.getByTestId("entity-tab-files").click();
  await expect(page.getByTestId("entity-files-add")).toBeDisabled();
  await expect(page.getByTestId("entity-files-encrypted")).toContainText("aren't encrypted yet");
  expect(await args(page, "engine_entities_set_picture")).toEqual([]);
  expect(await args(page, "engine_entities_add_file")).toEqual([]);
});
