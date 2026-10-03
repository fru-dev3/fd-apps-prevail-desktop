// Group chat (ux ask 5): several specialists in one chat, each answering the
// turns that concern them, as themselves; every reply records who spoke, the
// members, the scope and the context; joins and leaves show in the thread; and
// an @Planner in General goes through the engine with the name routed in code
// (it used to reach the model as text). Invented data only. With
// GROUP_SHOTS=<dir>, the thread is captured at 390 and 1280.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const spec = (id: string, name: string, family: string) => ({
  id, name, icon: "search", family, returns: "findings", ceiling: "read", tools: ["vault-read"], apps: [], runtime: "standard",
  budget: { minutes: 5, usd: 0.3, passes: 1 }, handoff: "offer", doneWhen: [], mandate: `The ${name.toLowerCase()} of the foo team.`, on: true, builtIn: true,
});
const FIX = {
  ui_settings_get: JSON.stringify({ theme: "light" }),
  read_ideal_state: "", read_omega: "", read_user_md: "", read_memory_md: "",
  scan_vault: ["hobbies", "money"].map((name) => ({ name, path: `/tmp/smoke-vault/data/domains/${name}`, has_state: true, state_preview: null })),
  domain_context: { state: "", decisions: "", journal: "", recent_logs: [], skills: [], layoutV4: true },
  engine_specialists: [spec("researcher", "Researcher", "know"), spec("planner", "Planner", "decide"), spec("scout", "Scout", "know")],
  engine_jobs: [],
  chief_of_staff_read: "---\nname: Quill\nhandoff: offer\n---\n",
  engine_missions_list: [],
  save_thread: "/tmp/smoke-vault/data/domains/general/_threads/foo-group.md",
  entities_list: { generated_ts: 1, total: 1, entities: [{ id: "person/kai-foo", name: "Kai Foo", kind: "person", aliases: [], mention_count: 3, conversations: 2, last_ts: 1, saved: true, has_page: true, relation: "yours", relation_confidence: 0.9 }] },
  entities_show: { found: true, id: "person/kai-foo", name: "Kai Foo", kind: "person", kinds: ["person"], aliases: [], mention_count: 3, conversations: 2, mentions: [], co_mentions: [], digest: "", notes: "", relation: "yours" },
  engine_entity_threads: [],
  engine_entities_duplicates: [],
  engine_specialist_show: { spec: spec("researcher", "Researcher", "know"), notebooks: [], involvement: [] },
};
const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? [])
    .filter((e) => e.cmd === c).map((e) => e.args), cmd);
async function play(page: Page, events: Record<string, unknown>[]) {
  const [last] = (await calls(page, "engine_chat")).slice(-1);
  await page.evaluate(([s, evs]) => {
    const emit = (window as unknown as { __emit: (e: string, p: unknown) => void }).__emit;
    for (const data of evs as unknown[]) emit("engine-chat:line", { session: s, data });
    emit("engine-chat:done", { session: s, code: 0 });
  }, [String(last.session), events] as [string, unknown[]]);
}
const said = (id: string, name: string, text: string) => [
  { type: "speaker", speaker: { id, name, why: "fits the message" } },
  { type: "delta", text },
  { type: "assistant", text, speaker: { id, name } },
];
const composer = (page: Page) => page.locator("[data-tour=composer] textarea").first();
async function home(page: Page, width: number) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await page.addInitScript(() => localStorage.setItem("prevail.desktop.defaultChatCli", "claude"));
  await mockTauri(page, FIX);
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
}
async function pick(page: Page, typed: string, id: string) {
  await composer(page).pressSequentially(typed);
  await page.getByTestId(`ref-option-specialist-${id}`).click();
}

for (const width of [1280, 390]) {
  test(`two specialists in one General chat answer in turn, as themselves (${width})`, async ({ page }) => {
    await home(page, width);
    // Two chips at once: the second no longer replaces the first.
    await pick(page, "@Res", "researcher");
    await pick(page, "@Pla", "planner");
    await expect(page.getByTestId("ref-chip-specialist")).toHaveCount(2);
    await expect(page.getByTestId("chat-members")).toBeVisible();
    // A context chip rides along and shows as "+1 context" on each reply.
    await page.evaluate(() => (window as unknown as { __prevailAddRef: (r: { kind: string; id: string; label: string }) => void }).__prevailAddRef({ kind: "domain", id: "money", label: "Money" }));
    await composer(page).pressSequentially("which foo carriers fit, and when should I switch?");
    await composer(page).press("Enter");
    await expect.poll(async () => (await calls(page, "engine_chat")).length).toBe(1);
    // General went through the engine with the names routed in code.
    expect((await calls(page, "engine_chat"))[0]).toMatchObject({ to: ["researcher", "planner"], members: ["researcher", "planner"] });
    expect((await calls(page, "chat_send")).length).toBe(0);
    await play(page, [...said("researcher", "Researcher", "Foo Mutual and Bar Shield fit the two foo rentals."), ...said("planner", "Planner", "Switch at the March renewal; quotes in February.")]);
    const speakers = page.getByTestId("reply-speaker");
    await expect(speakers).toHaveCount(2);
    await expect(speakers.nth(0)).toHaveText("Researcher");
    await expect(speakers.nth(1)).toHaveText("Planner");
    await expect(page.locator("[data-role=assistant]").nth(0).locator("[data-testid=reply-speaker-face] [data-specialist=researcher]")).toBeVisible();
    await expect(page.getByTestId("reply-meta").first()).toContainText("General");
    await expect(page.getByTestId("reply-meta").first()).toContainText("+1 context");
    await expect(page.getByTestId("member-marker")).toHaveCount(2);
    await expect(page.getByTestId("member-marker").first()).toContainText("Researcher joined");

    // The next turn names no one: the members ride along and the engine routes.
    await composer(page).pressSequentially("what are the best foo add-ons?");
    await composer(page).press("Enter");
    await expect.poll(async () => (await calls(page, "engine_chat")).length).toBe(2);
    expect((await calls(page, "engine_chat"))[1]).toMatchObject({ to: [], members: ["researcher", "planner"] });
    await play(page, said("researcher", "Researcher", "A foo umbrella add-on is the one worth having."));
    await expect(speakers).toHaveCount(3);
    await expect(speakers.nth(2)).toHaveText("Researcher");
    if (process.env.GROUP_SHOTS) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${process.env.GROUP_SHOTS}/group-thread-${width}.png` });
      await page.getByTestId("reply-meta").first().hover();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${process.env.GROUP_SHOTS}/group-meta-hover-${width}.png` });
      await page.locator("[data-role=assistant]").first().evaluate((el) => el.closest(".overflow-y-auto")?.scrollTo({ top: 0 }));
      await page.mouse.move(5, 5);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${process.env.GROUP_SHOTS}/group-top-${width}.png` });
    }

    // Remove one: a quiet "left" line, and the next turn goes without them.
    await page.getByTestId("chat-members").locator("button").first().click();
    await page.getByTestId("member-remove-planner").click();
    await expect(page.getByTestId("member-marker").last()).toContainText("Planner left");
    await composer(page).pressSequentially("and the deductible?");
    await composer(page).press("Enter");
    await expect.poll(async () => (await calls(page, "engine_chat")).length).toBe(3);
    expect((await calls(page, "engine_chat"))[2]).toMatchObject({ members: ["researcher"] });
    // The saved thread keeps the members and each reply's metadata.
    type Save = { members: string[]; memberLog: string; turns: { meta: string | null }[] };
    const lastSave = async () => { const s = await calls(page, "save_thread"); return s[s.length - 1] as Save; };
    await expect.poll(async () => (await lastSave())?.members, { timeout: 10_000 }).toEqual(["researcher"]);
    const last = await lastSave();
    expect(last.memberLog).toContain("-planner@");
    expect(JSON.parse(last.turns.find((t) => t.meta)!.meta!).speaker).toBe("researcher");
  });
}

test("regression: @Planner typed in General goes to the engine as a name, never as text for the model", async ({ page }) => {
  await home(page, 1280);
  await composer(page).fill("@Planner plan the foo week");
  await composer(page).press("Escape");
  await composer(page).press("Enter");
  await expect.poll(async () => (await calls(page, "engine_chat")).length).toBe(1);
  expect((await calls(page, "engine_chat"))[0]).toMatchObject({ to: ["planner"], members: ["planner"] });
  expect((await calls(page, "chat_send")).length).toBe(0);
});

test("a specialist's own chat sends every message to it; one brought into a person's chat and removed keeps working", async ({ page }) => {
  await home(page, 1280);
  // Its page opens on its own chat, with it as the member.
  await page.evaluate(() => { localStorage.setItem("prevail.specialists.focus", "spec:researcher"); window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "specialists" })); });
  const chat = page.getByTestId("specialist-chat");
  await expect(chat).toBeVisible({ timeout: 10_000 });
  await chat.locator("textarea").first().fill("which foo grants close this month?");
  await chat.locator("textarea").first().press("Enter");
  await expect.poll(async () => (await calls(page, "engine_chat")).length).toBe(1);
  expect((await calls(page, "engine_chat"))[0]).toMatchObject({ members: ["researcher"] });

  // A person's chat: bring the Planner in, then take it out; the next turn goes without it.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "entities" })));
  await page.getByTestId("entity-row").filter({ hasText: "Kai Foo" }).first().click();
  await page.getByTestId("entity-tab-chat").click();
  const box = page.getByTestId("entity-chat").locator("textarea").first();
  await expect(box).toBeVisible({ timeout: 10_000 });
  await box.pressSequentially("@Pla");
  await page.getByTestId("ref-option-specialist-planner").click();
  await box.pressSequentially("plan a foo dinner with Kai");
  await box.press("Enter");
  await expect.poll(async () => (await calls(page, "engine_chat")).length).toBe(2);
  expect((await calls(page, "engine_chat"))[1]).toMatchObject({ members: ["planner"] });
  await play(page, said("planner", "Planner", "Saturday at seven works for the foo dinner."));
  await page.getByTestId("entity-chat").getByTestId("chat-members").locator("button").first().click();
  await page.getByTestId("member-remove-planner").click();
  await box.pressSequentially("and the wine?");
  await box.press("Enter");
  await expect.poll(async () => (await calls(page, "engine_chat")).length).toBe(3);
  expect((await calls(page, "engine_chat"))[2]).toMatchObject({ members: [] });
});
