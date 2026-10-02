// Today T2 and T3: promises this week on the Today card, commitments added
// from mail with Undo, the radar behind "and N more", the filed receipt in
// chat (live and from a saved thread), the weekly card's promise proposals
// and radar, and the Compass Routines view. Invented data only. With
// T23_SHOTS=<dir>, each view is captured at 390, 768, 1280 and 1920.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

/** Today and the weekly review live in the Inbox's Briefing tab (Home is the chat). */
async function openBriefing(page: Page, which: "today" | "week" = "today") {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "inbox" })));
  await page.getByTestId("tab-briefing").click({ timeout: 15_000 });
  await page.getByTestId(`briefing-${which}`).click();
  await page.getByTestId(which === "today" ? "today-card" : "review-card").waitFor({ timeout: 15_000 });
}


const TODAY = {
  date: "2026-10-01", generated: 1, calm: null,
  items: [{ key: "task:foo:p1", kind: "commitment", title: "Send the foo deck", domain: "foo", due: "2026-10-02", person: "person/sam-rivera", thread: ["Foo"], unlinked: true, why: "due in 1 day, a promise to someone, nothing done on it yet", score: 1, ref: { domain: "foo", id: "p1" } }],
  fallingBehind: { text: "Foo app trial ends 2026-10-02: from the foo-app record (1 days)", key: "admin:app:foo-app:trial ends", kind: "admin", count: 3 },
  decisionDue: null, yourDay: { connected: false, note: "No calendar is connected yet, so your day is not on the card." }, alsoDue: [], feedback: [],
  promises: [
    { key: "task:foo:p2", title: "Return the bar drill with a rather long title that has to wrap on a phone", kind: "commitment", domain: "foo", due: "2026-10-03", person: "person/jordan", why: "due in 2 days, nothing done on it yet", slipping: true },
    { key: "task:bar:w1", title: "The signed foo lease", kind: "waiting", domain: "bar", due: "2026-10-05", person: "person/alex-reed", why: "due in 4 days", slipping: false },
  ],
  added: [{ id: "cabc1234", text: "Send the bar estimate by Friday", domain: "general", src: "gmail" }],
};
const RADAR = { computed: 1790900000000, items: [
  { key: "admin:app:foo-app:trial ends", kind: "admin", domain: "general", text: "Foo app trial ends 2026-10-02", evidence: "from the foo-app record (1 days)", due: "2026-10-02", severity: 5 },
  { key: "commitment:foo:p2", kind: "commitment", domain: "foo", text: "Return the bar drill", evidence: "due in 2 days, nothing done on it yet, to jordan", due: "2026-10-03", severity: 4 },
  { key: "relationship:person/alex-reed", kind: "relationship", domain: "bar", text: "Alex Reed: 40 days since you were last in touch", evidence: "your normal with them is about every 12 days (6 times seen)", severity: 2 },
] };
const REVIEW = {
  week: "2026-09-28", through: "2026-10-01", due: true, checkin: null, calmNormal: null,
  lines: { moved: [], drifted: [], conflict: "No conflict with evidence this week." }, conflict: null,
  glance: [], surprise: null, candidates: [], metricProposals: [], question: null, woop: [], waited: [], interruptions: { used: 0, budget: 3 }, apps: null,
  commitments: [{ src: "gmail:abc123:0", text: "Call the bar office", person: "person/casey", quote: "I'll call the bar office next week.", due: "2026-10-09" }],
  radar: RADAR.items.map(({ key, kind, text, evidence }) => ({ key, kind, text, evidence })),
};
const COMPASS = `# Compass

## Values

- Calm ~id:v-calm ~rank:1

## Routines

- Plan the week every Sunday evening ~id:rt-a ~cadence:weekly ~status:proposed
  words: "Plan the week every Sunday evening."
  from: data/domains/foo/ideal-state.md
- Run 3 times a week ~id:rt-b ~cadence:3x-week ~metric:m-workouts
`;
const OPEN = [{ id: "cfoo123", kind: "commitment", domain: "foo", text: "The foo deck for Sam", due: "2026-10-02", person: "person/sam" }];

const SHOTS = process.env.T23_SHOTS;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()?.width}.png` });
}
const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? [])
    .filter((e) => e.cmd === c).map((e) => e.args), cmd);
async function noOverflow(page: Page) {
  const over = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("[data-testid]")].filter((e) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      if ((e as HTMLElement).parentElement?.closest("[data-scroll-x]")) return false;
      return r.width > 0 && (r.right > vw + 1 || r.left < -1);
    }).map((e) => (e as HTMLElement).dataset.testid).slice(0, 5);
  });
  expect(over).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}
async function setup(page: Page, width: number, extra: Record<string, unknown> = {}) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await page.addInitScript(() => localStorage.setItem("prevail.desktop.defaultChatCli", "claude"));
  await mockTauri(page, {
    engine_today: TODAY, engine_review: REVIEW, engine_radar: RADAR, engine_commitments: OPEN, engine_commitment_undo: { ok: true }, engine_commitment_answer: { ok: true },
    engine_routines: { added: [] }, compass_read: COMPASS, compass_versions: [], compass_ledger: [], engine_compass_align: null,
    scan_vault: ["foo", "bar"].map((name) => ({ name, path: `/tmp/smoke-vault/data/domains/${name}`, has_state: true, state_preview: null })),
    read_ideal_state: "", read_omega: "", read_user_md: "", read_memory_md: "",
    domain_context: { state: "", decisions: "", journal: "", recent_logs: [], skills: [], layoutV4: true },
    ...extra,
  });
  await page.goto("/");
}
const work = (page: Page, id: string) => page.evaluate((d) => window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: d })), id);

for (const width of [390, 768, 1280, 1920]) {
  test.describe(`today T2 T3 · ${width}`, () => {
    test("Today: promises this week, added from mail with Undo, and the radar behind and N more", async ({ page }) => {
      await setup(page, width);
      await openBriefing(page);
      const card = page.getByTestId("today-card");
      await expect(card).toBeVisible({ timeout: 15_000 });
      const p = card.getByTestId("today-promises");
      await expect(p.getByTestId("today-promise")).toHaveCount(2);
      await expect(p.locator('[data-slipping="true"]')).toContainText("To Jordan");
      await expect(p).toContainText("Waiting on Alex Reed");
      await card.getByTestId("today-added-undo").click();
      await expect.poll(() => calls(page, "engine_commitment_undo")).toEqual([{ vault: "/tmp/smoke-vault", id: "cabc1234" }]);
      await card.getByTestId("today-radar-more").click();
      const r = card.getByTestId("radar-list");
      await expect(r.getByTestId("radar-group")).toHaveCount(3);
      await expect(r.locator('[data-kind="relationship"]')).toContainText("your normal with them is about every 12 days");
      await noOverflow(page);
      await shot(page, "today-promises-radar");
      await r.getByTestId("radar-refresh").click();
      await expect.poll(async () => (await calls(page, "engine_radar")).some((a) => a.refresh === true)).toBe(true);
    });

    test("the weekly card: a promise from mail to say yes to, and everything falling behind", async ({ page }) => {
      await setup(page, width);
      await openBriefing(page, "week");
      const rc = page.getByTestId("review-card");
      await expect(rc).toBeVisible({ timeout: 15_000 });
      await expect(rc.getByTestId("review-commitment")).toContainText("I'll call the bar office next week.");
      await expect(rc.getByTestId("review-radar")).toContainText("Alex Reed: 40 days since you were last in touch");
      await noOverflow(page);
      await shot(page, "review-t2t3");
      await rc.getByTestId("review-commitment-yes").click();
      await expect.poll(() => calls(page, "engine_commitment_answer")).toEqual([{ vault: "/tmp/smoke-vault", src: "gmail:abc123:0", yes: true, domain: null }]);
    });

    test("Compass: routines with their cadence, confirm a proposed one, draft more from the domains", async ({ page }) => {
      await setup(page, width, { compass_write: { ok: true } });
      await work(page, "compass");
      await page.getByTestId("compass-row-routines").click();
      const d = page.getByTestId("compass-detail-routines");
      await expect(d.getByTestId("compass-item")).toHaveCount(2);
      await expect(d.getByTestId("compass-cadence")).toHaveText(["Every week", "3 times a week"]);
      await noOverflow(page);
      await shot(page, "compass-routines");
      await d.getByTestId("compass-draft-routines").click();
      await expect.poll(() => calls(page, "engine_routines")).toEqual([{ vault: "/tmp/smoke-vault", bootstrap: true }]);
      await d.getByTestId("compass-confirm").first().click();
      await expect.poll(async () => (await calls(page, "compass_write")).length).toBe(1);
    });
  });
}

test("a promise told in chat: a receipt with Undo, live and from the saved thread", async ({ page }) => {
  await setup(page, 1280);
  await openBriefing(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: "foo" })));
  const box = page.locator("[data-tour=composer] textarea").first();
  await expect(box).toBeVisible({ timeout: 10_000 });
  await box.fill("remind me I owe Sam the foo deck by Friday");
  await box.press("Enter");
  await expect.poll(async () => (await calls(page, "engine_chat")).length).toBe(1);
  const [last] = (await calls(page, "engine_chat")).slice(-1);
  const reply = "Noted: a promise to Sam, due 2026-10-02. It is on the board, and Today will show it before it slips.";
  await page.evaluate(([s, r]) => {
    const emit = (window as unknown as { __emit: (e: string, p: unknown) => void }).__emit;
    for (const data of [{ type: "start" }, { type: "filed", filed: { id: "cfoo123", kind: "commitment", domain: "foo", text: "The foo deck for Sam", due: "2026-10-02", person: "person/sam" } }, { type: "delta", text: r }, { type: "assistant", text: r }]) emit("engine-chat:line", { session: s, data });
    emit("engine-chat:done", { session: s, code: 0 });
  }, [String(last.session), reply] as [string, string]);
  const card = page.getByTestId("filed-card");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText("The foo deck for Sam");
  await expect(card).toContainText("A promise to Sam");
  await expect(page.getByText(/\[filed:/)).toHaveCount(0);
  await noOverflow(page);
  await shot(page, "chat-filed");
  await card.getByTestId("filed-undo").click();
  await expect.poll(() => calls(page, "engine_commitment_undo")).toEqual([{ vault: "/tmp/smoke-vault", id: "cfoo123" }]);
  await expect(card).toContainText("Undone");
});
