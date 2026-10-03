// Linking: a reply's "Also noted in" line (from the engine's `touched`
// event), Across your life and Your things on a domain's Context, the same
// updates on an entity's Overview, the Yours / Reference filter, marking an
// entity as yours, and the "Save entities as you chat" setting. With
// LINK_SHOTS set, each view is captured at 1440 and 390. Invented names.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const now = Date.now();
const WAY = { id: "place/foo-way", name: "Foo Way", kind: "place", aliases: [], mention_count: 6, conversations: 4, last_ts: 1, saved: true, has_page: true, relation: "yours", relation_confidence: 0.9, home_domain: "real-estate" };
const BANK = { id: "org/foo-bank", name: "Foo Bank", kind: "org", aliases: [], mention_count: 3, conversations: 2, last_ts: 1, saved: false, has_page: false, relation: "yours", relation_confidence: 0.8, home_domain: "insurance" };
const LAWYER = { id: "person/foo-bar", name: "Foo Bar", kind: "person", aliases: [], mention_count: 2, conversations: 2, last_ts: 1, saved: false, has_page: false, relation: "yours", relation_confidence: 0.7, home_domain: "insurance" };
const REF = { id: "person/foo-the-elder", name: "Foo the Elder", kind: "person", aliases: [], mention_count: 9, conversations: 1, last_ts: 1, saved: false, has_page: false, relation: "reference", relation_confidence: 0.2 };
const SHOW = (e: typeof WAY | typeof REF) => ({ found: true, ...e, kinds: [e.kind], mentions: [], co_mentions: [], digest: "", notes: "" });
const UPDATES = [
  { ts: new Date(now - 3_600_000).toISOString(), from_domain: "real-estate", thread: "2026-09-27_foo", fact: "Water damage claim at Foo Way: the settlement is not yet released; a lawyer is involved.", entities: ["place/foo-way"], target: { kind: "domain", slug: "insurance" } },
  { ts: new Date(now - 2 * 86_400_000).toISOString(), from_domain: "wealth", thread: "2026-09-26_bar", fact: "Foo Bank raised the escrow payment for the policy renewal.", entities: [], target: { kind: "domain", slug: "insurance" } },
];
const FIX = {
  read_ideal_state: "", read_omega: "", read_user_md: "", read_memory_md: "",
  scan_vault: ["real-estate", "insurance", "legal", "wealth"].map((name) => ({ name, path: `/tmp/smoke-vault/data/domains/${name}`, has_state: true, state_preview: null })),
  domain_context: { state: "", decisions: "", journal: "", recent_logs: [], skills: [], layoutV4: true },
  entities_list: { generated_ts: 1, total: 4, entities: [WAY, BANK, LAWYER, REF] },
  entities_show: SHOW(WAY),
  engine_entity_threads: [],
  engine_entities_duplicates: [],
  engine_updates: UPDATES,
  engine_entities_set_relation: { ok: true },
  engine_config_autosave_get: "yours",
  engine_config_autosave_set: "all",
};

const SHOTS = process.env.LINK_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()?.width}.png` });
}
const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? [])
    .filter((e) => e.cmd === c).map((e) => e.args), cmd);
const fire = (page: Page, name: string, detail: unknown) =>
  page.evaluate(([n, d]) => window.dispatchEvent(new CustomEvent(n as string, { detail: d })), [name, detail] as [string, unknown]);

async function home(page: Page) {
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
}
async function play(page: Page, events: Record<string, unknown>[]) {
  const [last] = (await calls(page, "engine_chat")).slice(-1);
  await page.evaluate(([s, evs]) => {
    const emit = (window as unknown as { __emit: (e: string, p: unknown) => void }).__emit;
    for (const data of evs as unknown[]) emit("engine-chat:line", { session: s, data });
    emit("engine-chat:done", { session: s, code: 0 });
  }, [String(last.session), events] as [string, unknown[]]);
}
async function openEntities(page: Page) {
  await home(page);
  await fire(page, "prevail:open-settings", "entities");
  await expect(page.getByTestId("entities-view")).toBeVisible({ timeout: 10_000 });
}

for (const width of [1440, 390]) {
  test.describe(`linking · ${width}`, () => {
    test.beforeEach(async ({ page }) => {
      page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
      await page.addInitScript(() => localStorage.setItem("prevail.desktop.defaultChatCli", "claude"));
      await mockTauri(page, FIX);
    });

    test("a touched reply says where else it was noted, and each name opens it", async ({ page }) => {
      await home(page);
      // A domain chat runs on the engine (`prevail chat --json`), which sends `touched`.
      await fire(page, "prevail:open-domain", "real-estate");
      const box = page.locator("[data-tour=composer] textarea").first();
      await expect(box).toBeVisible({ timeout: 10_000 });
      await box.fill("my lawyer says the water damage claim at Foo Way is still open");
      await box.press("Enter");
      await expect.poll(async () => (await calls(page, "engine_chat")).length).toBe(1);
      await play(page, [
        { type: "assistant", text: "Then the claim is still open. Keep the adjuster's letter with the lease." },
        { type: "touched", thread: "t1", domains: [{ slug: "insurance", fact: "Claim open" }, { slug: "legal", fact: "Lawyer involved" }], entities: ["place/foo-way"] },
      ]);
      const line = page.getByTestId("touched-line");
      await expect(line).toHaveText(/Also noted in\s*Insurance,\s*Legal\s*·\s*Foo Way/);
      await shot(page, "touched-chips");
      await line.getByTestId("touched-entity").click();
      await expect(page.getByTestId("entity-detail")).toContainText("Foo Way", { timeout: 10_000 });
    });

    test("a touched domain name opens that domain", async ({ page }) => {
      await home(page);
      // A domain chat runs on the engine (`prevail chat --json`), which sends `touched`.
      await fire(page, "prevail:open-domain", "real-estate");
      const box = page.locator("[data-tour=composer] textarea").first();
      await expect(box).toBeVisible({ timeout: 10_000 });
      await box.fill("the claim is still open with the lawyer");
      await box.press("Enter");
      await expect.poll(async () => (await calls(page, "engine_chat")).length).toBe(1);
      await play(page, [
        { type: "assistant", text: "Noted." },
        { type: "touched", thread: "t1", domains: [{ slug: "insurance", fact: "Claim open" }], entities: [] },
      ]);
      await page.getByTestId("touched-domain").click();
      await expect(page.getByTestId("across-card")).toContainText("2 updates from other domains", { timeout: 10_000 });
    });

    test("a domain's Context lists Across your life and Your things", async ({ page }) => {
      await home(page);
      await fire(page, "prevail:open-domain", "insurance");
      const card = page.getByTestId("across-card");
      await expect(card).toContainText("2 updates from other domains", { timeout: 10_000 });
      await card.click();
      const view = page.getByTestId("context-view");
      const across = view.getByTestId("ctx-detail-across");
      await expect(across).toBeVisible({ timeout: 10_000 });
      await expect(across.getByTestId("update-row")).toHaveCount(2);
      await expect(across.getByTestId("update-row").first()).toContainText("Water damage claim at Foo Way");
      await expect(across.getByTestId("domain-chip").first()).toContainText("Real Estate");
      expect((await calls(page, "engine_updates")).some((a) => a.domain === "insurance")).toBe(true);
      await shot(page, "domain-across");
      if (width < 500) await view.getByRole("button", { name: "All sections" }).click();
      await view.getByTestId("ctx-row-things").click();
      const things = view.getByTestId("ctx-detail-things");
      await expect(things.getByTestId("your-thing")).toHaveCount(2);
      await expect(things).toContainText("Foo Bank");
      await expect(things).toContainText("Foo Bar");
      await expect(things).not.toContainText("Foo Way");
      await shot(page, "domain-things");
      await things.getByTestId("your-thing").first().click();
      await expect(page.getByTestId("entity-detail")).toBeVisible({ timeout: 10_000 });
    });

    test("an entity's Overview shows Across your life and its home domain", async ({ page }) => {
      await openEntities(page);
      if (width < 500) await page.getByTestId("entity-row").first().click();
      const ov = page.getByTestId("entity-overview");
      await expect(ov).toContainText("Across your life", { timeout: 10_000 });
      await expect(ov.getByTestId("update-row")).toHaveCount(2);
      expect((await calls(page, "engine_updates")).some((a) => a.entity === "place/foo-way")).toBe(true);
      await expect(page.getByTestId("entity-detail").getByTestId("domain-chip").first()).toContainText("Real Estate");
      await shot(page, "entity-across");
    });

    test("the Entities column splits Yours and Reference, Yours by default", async ({ page }) => {
      await openEntities(page);
      const yours = page.getByTestId("entity-relation-yours");
      const ref = page.getByTestId("entity-relation-reference");
      await expect(yours).toHaveAttribute("aria-selected", "true");
      // Entities > People: the counts are this kind's.
      await expect(yours).toContainText("1");
      await expect(ref).toContainText("1");
      const list = page.getByTestId("entities-list");
      await expect(list.getByTestId("entity-row")).toHaveCount(1);
      await expect(list).not.toContainText("Foo the Elder");
      await expect(list.getByTestId("domain-chip").first()).toBeVisible();
      await shot(page, "entities-yours");
      await ref.click();
      await expect(list.getByTestId("entity-row")).toHaveCount(1);
      await expect(list).toContainText("Foo the Elder");
      await shot(page, "entities-reference");
    });

    test("This is mine on a reference sends set-relation", async ({ page }) => {
      await mockTauri(page, { ...FIX, entities_show: SHOW(REF) });
      await openEntities(page);
      await page.getByTestId("entity-relation-reference").click();
      await page.getByTestId("entities-list").getByTestId("entity-row").first().click();
      const note = page.getByTestId("entity-reference-note");
      await expect(note).toContainText("only mentioned in replies, not in your own words", { timeout: 10_000 });
      await shot(page, "entity-reference");
      await note.getByTestId("entity-mark-mine").click();
      await expect.poll(async () => calls(page, "engine_entities_set_relation")).toEqual([{ vault: "/tmp/smoke-vault", id: "person/foo-the-elder", relation: "yours" }]);
    });

    test("Just a reference in the menu sends set-relation", async ({ page }) => {
      await openEntities(page);
      if (width < 500) await page.getByTestId("entity-row").first().click();
      await page.getByTestId("entity-detail").getByRole("button", { name: "More entity actions" }).click();
      await page.getByRole("menuitem", { name: /Just a reference/ }).click();
      await expect.poll(async () => calls(page, "engine_entities_set_relation")).toEqual([{ vault: "/tmp/smoke-vault", id: "place/foo-way", relation: "reference" }]);
    });
  });
}

test("Settings · Save entities as you chat writes the engine setting", async ({ page }) => {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockTauri(page, FIX);
  await home(page);
  await fire(page, "prevail:open-settings", "settings");
  await page.getByRole("button", { name: /^Behavior/ }).first().click();
  const sel = page.getByTestId("autosave-select");
  await expect(sel).toHaveValue("yours", { timeout: 10_000 });
  await sel.selectOption("all");
  await expect.poll(async () => calls(page, "engine_config_autosave_set")).toEqual([{ value: "all" }]);
});
