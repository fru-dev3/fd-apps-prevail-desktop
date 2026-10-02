// Today T4 and Missions MS4: the Decisions page (what is missing, Get a
// recommendation, the gut call before the recommendation, Scan my tasks, a
// retro owed), the decision offer in chat, and the mission's Calendar tab
// (matched events, a hold waiting for a yes, a draft invite), its metric
// proposals and the Compass path it carries out. Invented data only. With
// T4_SHOTS=<dir>, each view is captured at 390, 768, 1280 and 1920.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const DECISIONS = [
  { slug: "renew-the-foo-lease", domain: "foo", file: "/tmp/smoke-vault/data/domains/foo/memory/decisions/renew-the-foo-lease.md", question: "Renew the foo lease?", status: "open", due: "2026-10-15", owner: "foo", consulted: [], serves: [], sections: { Context: "From the task on foo's board (task:foo:t1)." }, missing: ["options", "trade-offs", "recommendation"], recommendationReady: false, big: false },
  { slug: "sell-the-bar-rental", domain: "bar", file: "/tmp/smoke-vault/data/domains/bar/memory/decisions/sell-the-bar-rental.md", question: "Sell the bar rental for a rather large sum that takes two lines on a phone?", status: "open", due: "2026-10-20", owner: "bar", consulted: ["foo"], serves: [], sections: { Options: "- Keep\n- Sell", "Trade-offs": "- Selling frees cash and gives up rent." }, missing: [], recommendationReady: true, big: true },
  { slug: "old-foo-call", domain: "foo", file: "/tmp/smoke-vault/data/domains/foo/memory/decisions/old-foo-call.md", question: "Switch foo carriers?", status: "decided", owner: "foo", consulted: [], serves: [], decided: "2026-06-01", chose: "switch", retroDue: "2026-08-30", sections: { Decision: "switch" } },
];
const T = Date.parse("2026-10-02T12:00:00Z");
const CELLO = {
  slug: "learn-the-cello", id: "mission/learn-the-cello", name: "Learn the cello", status: "active", outcome: "Learn to play three foo pieces", why: "", notes: "",
  start: "2026-09-21", target: "2027-06-30", cadence: "weekly", domains: [{ slug: "hobbies", role: "owner" }], apps: [], specialists: [], people: [], entities: [],
  budget: { total_usd: 1000, lines: [{ id: "lessons", label: "Lessons", usd: 800 }] }, serves: [], prompt_projects: [], ceiling: "draft", nudges: { per_week: 1, muted: false }, privacy: { localOnly: false }, localOnly: false,
  metrics: ["m-learn-the-cello-sessions"], match: { calendar: ["cello lesson"], email_from: ["@foo-music.example"], merchants: [] },
  progress: { milestones: { done: 0, total: 0, share: 0, overdue: [] }, budget: { planned: 1000, used: 0, share: 0, byLine: [] }, days: { day: 12, total: 283, left: 271 } },
  milestones: [],
  links: { calendar: [
    { app: "google-calendar", event: "e1", title: "Cello lesson with the foo teacher", start: "2026-10-04T10:00", source: "matched" },
    { app: "google-calendar", event: "pending-aaa", title: "Practice block", start: "2026-10-05T18:00", source: "created" },
    { app: "google-calendar", event: "pending-bbb", title: "Recital", start: "2027-06-14T18:00", source: "created" },
  ], tasks: [], files: [], threads: [] },
  artifacts: [], log: [], closed: false,
};
const PENDING = [
  { id: "pending-aaa", title: "Practice block", start: "2026-10-05T18:00", attendees: [], status: "ask", ts: T },
  { id: "pending-bbb", title: "Recital", start: "2027-06-14T18:00", attendees: ["guest@example.com"], status: "draft", ts: T },
];
const METRICS = [
  { key: "learn-the-cello:sessions", id: "m-learn-the-cello-sessions", title: "Learn the cello: practice sessions", line: "", why: "sessions, from what you say in the project's chat" },
  { key: "learn-the-cello:events", id: "m-learn-the-cello-events", title: "Learn the cello: calendar sessions", line: "", why: "the lessons or sessions on your calendar" },
];
const COMPASS = "# Compass\n\n## Goals\n- [ ] Play for the family ~id:g-play ~status:active ~domain:hobbies\n  path: Weekly foo lessons ~id:p-lessons ~status:chosen\n  path: Self taught ~id:p-self ~status:proposed\n";

const SHOTS = process.env.T4_SHOTS;
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
async function noOverflow(page: Page) {
  const over = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("[data-testid]")].filter((e) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      if ((e as HTMLElement).parentElement?.closest("[data-scroll-x]")) return false;
      return r.width > 0 && getComputedStyle(e as HTMLElement).visibility !== "hidden" && (r.right > vw + 1 || r.left < -1);
    }).map((e) => (e as HTMLElement).dataset.testid).slice(0, 5);
  });
  expect(over).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}
async function setup(page: Page, width: number) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await page.addInitScript(() => localStorage.setItem("prevail.desktop.defaultChatCli", "claude"));
  await mockTauri(page, {
    ui_settings_get: JSON.stringify({ theme: "light" }), read_ideal_state: "", read_omega: "", read_user_md: "", read_memory_md: "",
    scan_vault: ["foo", "bar", "hobbies"].map((name) => ({ name, path: `/tmp/smoke-vault/data/domains/${name}`, has_state: true, state_preview: null })),
    domain_context: { state: "", decisions: "", journal: "", recent_logs: [], skills: [], layoutV4: true },
    engine_decisions: DECISIONS, engine_decision_action: { ok: true }, engine_decision_recommend: { ok: true, by: "steward" },
    engine_decisions_scan: { ok: true, opened: [{}] }, engine_decision_open: { slug: "sell-the-foo-car", domain: "foo" },
    engine_missions_list: [CELLO], engine_missions_show: CELLO, engine_missions_track: { ok: true }, engine_missions_event_create: PENDING[0],
    engine_missions_event_approve: { ...PENDING[0], status: "created" }, engine_missions_link_path: { ok: true },
    compass_read: COMPASS, list_threads: [],
  });
  // One command answers per sub: metric proposals or pending events.
  await page.addInitScript(([m, p]) => {
    (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures.engine_missions_progress = (a: { sub?: string }) => (a?.sub === "metrics" ? m : a?.sub === "events-pending" ? p : []);
  }, [METRICS, PENDING] as [unknown, unknown]);
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
}

for (const width of [390, 768, 1280, 1920]) {
  const phone = width < 500;
  test.describe(`decisions and projects MS4 · ${width}`, () => {
    test("Decisions: what is missing, Get a recommendation, the gut call first, Scan my tasks, a retro owed", async ({ page }) => {
      await setup(page, width);
      await page.evaluate(() => localStorage.setItem("prevail.decisions.focus", "foo/renew-the-foo-lease"));
      await fire(page, "prevail:work-section", "decisions");
      const d = page.getByTestId("decision-detail");
      await expect(d).toContainText("Renew the foo lease?", { timeout: 10_000 });
      await expect(d.getByTestId("decision-missing")).toContainText("Still missing: options, trade-offs, recommendation.");
      await d.getByTestId("decision-recommend").getByRole("button").click();
      await expect.poll(() => calls(page, "engine_decision_recommend")).toEqual([{ vault: "/tmp/smoke-vault", target: "foo/renew-the-foo-lease" }]);
      await noOverflow(page);
      await shot(page, "decision-missing");
      // A big one with a recommendation waiting: the council, and the gut call first.
      await fire(page, "prevail:decisions-focus", "bar/sell-the-bar-rental");
      await expect(d).toContainText("A recommendation is ready. Your gut call first");
      await expect(d.getByTestId("decision-recommend")).toHaveCount(0);
      await noOverflow(page);
      await shot(page, "decision-gut-first");
      if (phone) await page.getByRole("button", { name: /Decisions/ }).first().click();
      await page.getByTestId("decisions-scan").click();
      await expect(page.getByTestId("decisions-scan-note")).toHaveText("Opened 1 from your tasks.");
      await expect(page.getByTestId("decisions-list")).toContainText("retro owed");
    });

    test("a project's Calendar: matched, a hold waiting for a yes, a draft you send; a new hold", async ({ page }) => {
      await setup(page, width);
      await fire(page, "prevail:work-section", "missions");
      await expect(page.getByTestId("missions-page")).toBeVisible({ timeout: 10_000 });
      if (width < 1100) await page.getByTestId("mission-row").first().click();
      const h = page.getByTestId("mission-header");
      await expect(h).toContainText("Learn the cello", { timeout: 10_000 });
      await h.getByTestId("mission-tab-calendar").click();
      const c = page.getByTestId("mission-calendar");
      await expect(c.getByTestId("mission-event-state")).toHaveText(["matched", "hold waiting for your yes", "draft, you send it"]);
      await expect(c.getByTestId("mission-event-approve")).toHaveCount(1);
      await noOverflow(page);
      await shot(page, "mission-calendar");
      await c.getByTestId("mission-event-approve").click();
      await expect.poll(() => calls(page, "engine_missions_event_approve")).toEqual([{ vault: "/tmp/smoke-vault", slug: "learn-the-cello", id: "pending-aaa" }]);
      await c.getByLabel("Event title").fill("Practice block");
      await c.getByLabel("Starts").fill("2026-10-07T18:00");
      await c.getByLabel("With (emails, optional)").fill("guest@example.com");
      await expect(c.getByRole("button", { name: "Draft invite" })).toBeVisible();
      await c.getByRole("button", { name: "Draft invite" }).click();
      await expect.poll(() => calls(page, "engine_missions_event_create")).toEqual([{ vault: "/tmp/smoke-vault", slug: "learn-the-cello", title: "Practice block", start: "2026-10-07T18:00", end: null, attendees: ["guest@example.com"] }]);
    });

    test("a project's Setup: what counts on its own, metrics to track, the Compass path", async ({ page }) => {
      await setup(page, width);
      await fire(page, "prevail:work-section", "missions");
      if (width < 1100) await page.getByTestId("mission-row").first().click();
      const h = page.getByTestId("mission-header");
      await expect(h).toContainText("Learn the cello", { timeout: 10_000 });
      await h.getByTestId("mission-tab-setup").click();
      const p = page.getByTestId("mission-progress");
      await expect(p.getByTestId("mission-match-calendar")).toHaveValue(/cello lesson/);
      await expect(p.getByTestId("mission-match-email-from")).toHaveValue(/@foo-music\.example/);
      await p.getByTestId("mission-match-merchants").fill("FOO MUSIC SCHOOL");
      await p.getByTestId("mission-match-merchants").press("Enter");
      await expect.poll(() => calls(page, "engine_missions_set")).toContainEqual({ vault: "/tmp/smoke-vault", slug: "learn-the-cello", field: "match-merchants", value: "FOO MUSIC SCHOOL" });
      await expect(p.getByTestId("mission-metric")).toHaveCount(2);
      await expect(p.getByTestId("mission-metric-tracked")).toHaveCount(1);
      await p.getByTestId("mission-metric-track").click();
      await expect.poll(() => calls(page, "engine_missions_track")).toEqual([{ vault: "/tmp/smoke-vault", slug: "learn-the-cello", key: "learn-the-cello:events" }]);
      await p.getByTestId("mission-path").selectOption("p-lessons");
      await expect.poll(() => calls(page, "engine_missions_link_path")).toEqual([{ vault: "/tmp/smoke-vault", slug: "learn-the-cello", path: "p-lessons" }]);
      await noOverflow(page);
      await shot(page, "mission-setup-progress");
    });
  });
}

test("a deliberating message gets a decision offer; Yes opens the record", async ({ page }) => {
  await setup(page, 1280);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: "foo" })));
  const box = page.locator("[data-tour=composer] textarea").first();
  await expect(box).toBeVisible({ timeout: 10_000 });
  await box.fill("should I sell the foo car or keep it?");
  await box.press("Enter");
  await expect.poll(async () => (await calls(page, "engine_chat")).length).toBe(1);
  const [last] = (await calls(page, "engine_chat")).slice(-1);
  await page.evaluate((s) => {
    const emit = (window as unknown as { __emit: (e: string, p: unknown) => void }).__emit;
    for (const data of [{ type: "start" }, { type: "delta", text: "It depends on the repairs." }, { type: "assistant", text: "It depends on the repairs." }, { type: "decision_offer", decisionOffer: { question: "Should I sell the foo car or keep it?", domain: "foo", due: "2026-10-16" } }]) emit("engine-chat:line", { session: s, data });
    emit("engine-chat:done", { session: s, code: 0 });
  }, String(last.session));
  const card = page.getByTestId("decision-offer");
  await expect(card).toContainText("Track this decision?", { timeout: 10_000 });
  await expect(card).toContainText("Should I sell the foo car or keep it?");
  await noOverflow(page);
  await shot(page, "chat-decision-offer");
  await card.getByTestId("decision-offer-yes").click();
  await expect.poll(() => calls(page, "engine_decision_open")).toEqual([{ vault: "/tmp/smoke-vault", question: "Should I sell the foo car or keep it?", domain: "foo", due: "2026-10-16" }]);
  await expect(page.getByTestId("decisions-page")).toBeVisible({ timeout: 10_000 });
});
