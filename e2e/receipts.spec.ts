// Owner feedback round 1: every chat turn quietly notes the domains its words
// concern ("Noted in Content, Real Estate") and saves a decision the user
// stated ("Saved a decision: ..."), each with Undo; a General chat on the
// native path gets the same through the engine's after-turn step. Invented
// data. RECEIPT_SHOTS=<dir> captures the thread at 1280 and 390.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const TS = 1_791_000_000_000;
const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? []).filter((e) => e.cmd === c).map((e) => e.args), cmd);
const emit = (page: Page, name: string, payload: unknown) => page.evaluate(([n, p]) => (window as unknown as { __emit: (e: string, p: unknown) => void }).__emit(n as string, p), [name, payload] as [string, unknown]);
const SHOTS = process.env.RECEIPT_SHOTS;

const FIX = {
  read_ideal_state: "", read_omega: "", read_user_md: "", read_memory_md: "",
  scan_vault: ["content", "real-estate", "learning"].map((name) => ({ name, path: `/tmp/smoke-vault/data/domains/${name}`, has_state: true, state_preview: null })),
  engine_after_turn: { ok: true, events: [
    { type: "decision_saved", thread: "t-foo", ts: TS, decisionSaved: { domain: "learning", slug: "learn-the-foo-cello", what: "Learn the foo cello" } },
    { type: "touched", thread: "t-foo", ts: TS, by: "code", domains: [{ slug: "content", fact: "Making a foo video" }, { slug: "real-estate", fact: "Tenant renewal" }], entities: [] },
  ] },
  engine_touch_undo: { ok: true, undone: ["content", "real-estate"] },
  engine_decision_undo: { ok: true },
};

for (const width of [1280, 390]) {
  test(`a General turn on the native path gets its receipts, each with Undo (${width})`, async ({ page }) => {
    page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message} ${err.stack}`); });
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    await page.addInitScript(() => localStorage.setItem("prevail.desktop.defaultChatCli", "claude"));
    await mockTauri(page, FIX);
    await page.goto("/");
    await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
    const box = page.locator("[data-tour=composer] textarea").first();
    await box.fill("I've decided to learn the foo cello. Also making a YouTube video and the tenant wants to renew.");
    await box.press("Enter");
    await expect.poll(async () => (await calls(page, "chat_send")).length).toBe(1);
    const session = String(((await calls(page, "chat_send"))[0].args as { session_id: string }).session_id);
    await emit(page, "chat:chunk", { session, cli: "claude", stream: "stdout", data: "Good plan. Start with ten minutes a day." });
    await emit(page, "chat:done", { session, cli: "claude", code: 0 });
    await expect.poll(async () => (await calls(page, "engine_after_turn")).length, { timeout: 10_000 }).toBe(1);
    expect((await calls(page, "engine_after_turn"))[0]).toMatchObject({ domain: "general", message: expect.stringContaining("learn the foo cello"), reply: expect.stringContaining("Good plan") });
    const noted = page.getByTestId("touched-line");
    await expect(noted).toHaveText(/Noted in\s*Content,\s*Real Estate\s*·\s*Undo/);
    const dec = page.getByTestId("decision-receipt");
    await expect(dec).toHaveText(/Saved a decision:\s*Learn the foo cello/);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/thread-receipts-${width}.png` });
    await noted.getByTestId("touched-undo").click();
    await expect.poll(async () => (await calls(page, "engine_touch_undo"))[0]).toMatchObject({ thread: "t-foo", ts: TS, domains: ["content", "real-estate"] });
    await expect(noted).toContainText("Taken back from Content, Real Estate");
    await dec.getByTestId("decision-undo").click();
    await expect.poll(async () => (await calls(page, "engine_decision_undo"))[0]).toMatchObject({ domain: "learning", slug: "learn-the-foo-cello" });
    await expect(dec).toContainText("Decision taken back");
  });
}

test("a decision opens with a chat, seeded with the decision", async ({ page }) => {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockTauri(page, { engine_decisions: [{ slug: "learn-the-foo-cello", domain: "learning", file: "/v/x.md", question: "Learn the foo cello", status: "decided", owner: "learning", consulted: [], serves: [], decided: "2026-10-02", chose: "Learn the foo cello", thread: "t-foo", source: "chat", sections: { Context: "Said in a conversation." } }] });
  await page.goto("/");
  await page.evaluate(() => { localStorage.setItem("prevail.decisions.focus", "learning/learn-the-foo-cello"); window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "decisions" })); });
  const d = page.getByTestId("decision-detail");
  await expect(d).toBeVisible({ timeout: 10_000 });
  await expect(d.getByTestId("decision-from-chat")).toContainText("Heard in a conversation");
  await expect(d.getByTestId("decision-chat").locator("textarea").first()).toHaveValue(/About my decision "Learn the foo cello"/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/decision-chat-1280.png` });
});
