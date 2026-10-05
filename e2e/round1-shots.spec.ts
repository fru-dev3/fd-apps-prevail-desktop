// Owner feedback round 1: the screens it changed, at 390, 768, 1280 and 1920,
// for a critical look. Runs only with ROUND1_SHOTS=<dir>. Invented data.
import { test, expect, type Page } from "@playwright/test";
import { openChatTab } from "./open-chat";
import { mockTauri } from "./tauri-mock";

const OUT = process.env.ROUND1_SHOTS;
test.skip(!OUT, "set ROUND1_SHOTS=<dir> to capture");

const NOW = Date.now();
const DAY = 86_400_000;
const COMPASS = `# Compass\n~schema:2\n\n## Purpose\nLive a calm foo life, near the people I love.\n\n## Values\n- Peace of mind ~id:v-peace ~rank:1\n  words: "Calm first."\n- Family presence ~id:v-family ~rank:2\n- Craft ~id:v-craft ~rank:3 ~status:proposed\n  from: data/domains/general/memory/memory.md\n\n## Mission statement\n- Build calm foo tools for families ~id:st-tools ~serves:v-peace,v-family\n\n## Vision\n- A foo home that runs on its own ~id:vi-home\n\n## Objectives\n- Twelve months of costs in cash ~id:o-cash ~metric:cash_months ~target:12\n\n## Goals\n- [ ] Bar cash buffer ~id:g-buffer ~objective:o-cash ~status:active ~domain:money ~added:2026-09-02\n- [ ] Open a small foo cafe ~id:g-cafe ~status:proposed\n\n## Roles\n- Parent ~id:r-parent\n- Coach ~id:r-coach ~status:archived\n\n## Non-negotiables\n- Never work Sunday mornings ~id:nn-sunday\n- Home for dinner ~id:nn-dinner\n\n## Routines\n- Morning walk ~id:rt-walk ~cadence:daily\n`;
const n = (id: string, level: string, title: string, parents: string[], children: string[], status = "confirmed") => ({ id, level, title, status, parents, children, linked: parents.length > 0 || level === "purpose" });
const TREE = { schema: 2, nodes: [
  n("purpose", "purpose", "Live a calm foo life, near the people I love.", [], ["v-peace", "v-family"]),
  n("v-peace", "value", "Peace of mind", ["purpose"], ["st-tools"]), n("v-family", "value", "Family presence", ["purpose"], ["st-tools"]),
  n("st-tools", "statement", "Build calm foo tools for families", ["v-peace", "v-family"], ["vi-home"]),
  n("vi-home", "vision", "A foo home that runs on its own", ["st-tools"], ["o-cash"]),
  n("o-cash", "objective", "Twelve months of costs in cash", ["vi-home"], ["g-buffer"]),
  n("g-buffer", "goal", "Bar cash buffer", ["o-cash"], [], "active"),
  n("g-cafe", "goal", "Open a small foo cafe", [], [], "proposed"),
], levels: [{ level: "goal", label: "Goals", count: 2, notLinked: 1 }], domainGoals: { total: 0, linked: 0 }, tasks: { open: 0, linked: 0 } };
const LEDGER = [
  { ts: NOW - DAY, id: "v-peace", from: "Calm", to: "Peace of mind", reason: "edited", by: "user" },
  { ts: NOW - 2 * DAY, id: "r-coach", from: "confirmed", to: "archived", reason: "archived", by: "user" },
  { ts: NOW - 3 * DAY, id: "g-buffer", from: "", to: "Bar cash buffer", reason: "added", by: "user" },
];
const YEARLY = (year: number) => ({ year, file: `/v/year-${year}.md`, updated: NOW - (2026 - year) * 300 * DAY, text: `# Your yearly review, ${year}\n\n## The year across your life\n\n### Health\nBody, sleep and energy this year.\nYour answer: better sleep.\n` });
const SPEC = { id: "researcher", name: "Researcher", icon: "search", family: "know", returns: "findings", ceiling: "read", tools: ["vault-read", "web"], apps: [], runtime: "standard", budget: { minutes: 5, usd: 0.3, passes: 1 }, handoff: "offer", doneWhen: ["one line"], mandate: "Finds what is true, with sources.", on: true, builtIn: true };
const ROWS = [{ id: "foo-watch", name: "Foo bill watch", goal: "Watch the foo bills", domain: "money", group: "scheduled", source: "yours", draft: false, steps: 1, running: false, schedule: { space: "money", cadence: "weekly", enabled: true, status: "active", autonomy: "tasks", lastRunTs: NOW - 2 * DAY, nextRunTs: NOW + 5 * DAY } }];
const WAY = { id: "place/foo-way", name: "Foo Way", kind: "place", aliases: ["foo way house"], mention_count: 6, conversations: 4, last_ts: 1, saved: true, has_page: true, relation: "yours", relation_confidence: 0.9 };

const FIX: Record<string, unknown> = {
  read_ideal_state: "", read_omega: "", read_user_md: "", read_memory_md: "", engine_today: null, engine_review: null,
  scan_vault: ["money", "content", "real-estate", "learning"].map((name) => ({ name, path: `/tmp/smoke-vault/data/domains/${name}`, has_state: true, state_preview: null })),
  domain_context: { state: "", decisions: "", journal: "", recent_logs: [], skills: [], layoutV4: true },
  compass_read: COMPASS, compass_ledger: LEDGER, compass_versions: [], engine_compass_tree: TREE, engine_compass_links: [], engine_compass_align: null,
  engine_compass_yearly_list: [YEARLY(2026), YEARLY(2025)],
  engine_decisions: [{ slug: "learn-the-foo-cello", domain: "learning", file: "/v/x.md", question: "Learn the foo cello", status: "decided", owner: "learning", consulted: [], serves: [], decided: "2026-10-02", chose: "Learn the foo cello", thread: "t-foo", source: "chat", sections: { Context: "Said in a conversation: \"I've decided to learn the foo cello.\"" } }],
  engine_specialists: [SPEC], engine_specialist_show: { spec: SPEC, notebooks: [], involvement: [{ ts: NOW - DAY, specialist: "researcher", name: "Researcher", method: "answered", domain: "learning", thread: "t-foo", ask: "Which foo cello teachers are near me?" }] }, engine_jobs: [],
  engine_playbook_rows: ROWS, engine_playbook_show: { ...ROWS[0], triggers: [], rows: [{ n: 1, kind: "loop", label: "Watch the foo bills", specialists: [], returns: ["tasks"], gate: false, ask: false }], runs: [] },
  entities_list: { generated_ts: 1, total: 1, entities: [WAY] },
  entities_show: { found: true, ...WAY, kinds: ["place"], mentions: [], co_mentions: [], digest: "", notes: "", merged_from: [{ id: "place/foo-way-house", name: "Foo Way House", ts: new Date(NOW - 20 * DAY).toISOString(), auto: false }, { id: "place/the-foo-house", name: "The Foo House", ts: new Date(NOW - 3 * DAY).toISOString(), auto: true }] },
  engine_entity_threads: [], engine_entities_duplicates: [], engine_updates: [],
  engine_after_turn: { ok: true, events: [
    { type: "decision_saved", thread: "t-foo", ts: NOW, decisionSaved: { domain: "learning", slug: "learn-the-foo-cello", what: "Learn the foo cello" } },
    { type: "touched", thread: "t-foo", ts: NOW, by: "code", domains: [{ slug: "content", fact: "Making a foo video" }, { slug: "real-estate", fact: "Tenant renewal" }], entities: [] },
  ] },
};

async function boot(page: Page, width: number) {
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await page.addInitScript(() => localStorage.setItem("prevail.desktop.defaultChatCli", "claude"));
  await mockTauri(page, FIX);
  await page.goto("/");
  await openChatTab(page); await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
}
const work = (page: Page, id: string, focus?: [string, string]) => page.evaluate(([w, f]) => { if (f) localStorage.setItem(f[0], f[1]); window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: w })); }, [id, focus ?? null] as [string, [string, string] | null]);
const shot = async (page: Page, name: string, width: number) => { await page.waitForTimeout(350); await page.mouse.move(1, 1); await page.screenshot({ path: `${OUT}/${name}-${width}.png` }); };
/** Pick a Compass row; on a narrow window go back to the list first. */
async function compassRow(page: Page, row: string) {
  const back = page.getByTestId("spine-detail").getByRole("button", { name: "Compass", exact: true });
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.getByTestId(`compass-row-${row}`).click();
}

for (const width of [390, 768, 1280, 1920]) {
  test(`round 1 screens at ${width}`, async ({ page }) => {
    await boot(page, width);
    await work(page, "compass");
    await compassRow(page, "overview");
    await expect(page.getByTestId("compass-detail-overview")).toBeVisible({ timeout: 10_000 });
    await shot(page, "compass-overview", width);
    await compassRow(page, "rules");
    await shot(page, "compass-section-rules", width);
    await compassRow(page, "goals");
    await page.locator("[data-testid=compass-item][data-id=g-buffer]").getByTestId("line-open").click();
    await expect(page.getByTestId("chain-up-list")).toBeVisible();
    await shot(page, "compass-goal-chain", width);
    await compassRow(page, "yearly");
    await page.getByTestId("yearly-row").first().getByTestId("line-open").click();
    await shot(page, "compass-yearly", width);
    await compassRow(page, "history");
    await shot(page, "compass-history", width);

    await work(page, "decisions", ["prevail.decisions.focus", "learning/learn-the-foo-cello"]);
    await expect(page.getByTestId("decision-chat")).toBeVisible({ timeout: 10_000 });
    await shot(page, "decisions-chat", width);

    await work(page, "playbooks", ["prevail.playbooks.focus", "foo-watch"]);
    await expect(page.getByTestId("playbooks-page")).toBeVisible({ timeout: 10_000 });
    await shot(page, "playbooks-schedules", width);

    await work(page, "specialists", ["prevail.specialists.focus", "spec:researcher"]);
    await expect(page.getByTestId("specialist-chat")).toBeVisible({ timeout: 10_000 });
    await shot(page, "specialist-chat", width);

    // Open the place the way a link does (entitystore requestEntity).
    await page.evaluate(() => {
      const t = { kind: "place", value: "foo-way" };
      window.dispatchEvent(new CustomEvent("prevail:open-entity", { detail: t }));
      window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "entities" }));
    });
    await page.getByRole("tab", { name: /Places/ }).first().click();
    const row = page.getByTestId("entity-row").first();
    if (await row.isVisible().catch(() => false)) await row.click();
    await expect(page.getByTestId("entity-merged-from")).toBeVisible({ timeout: 10_000 });
    await shot(page, "entity-merge-history", width);
  });

  test(`a thread with its receipts at ${width}`, async ({ page }) => {
    await boot(page, width);
    const box = page.locator("[data-tour=composer] textarea").first();
    await box.fill("I've decided to learn the foo cello. Also making a YouTube video, and the tenant wants to renew.");
    await box.press("Enter");
    const send = await page.evaluate(() => ((window as unknown as { __invokeLog: Array<{ cmd: string; args: { args?: { session_id?: string } } }> }).__invokeLog).find((e) => e.cmd === "chat_send")?.args.args?.session_id);
    await page.evaluate((s) => { const emit = (window as unknown as { __emit: (e: string, p: unknown) => void }).__emit; emit("chat:chunk", { session: s, cli: "claude", stream: "stdout", data: "Good plan. Ten minutes a day to start." }); emit("chat:done", { session: s, cli: "claude", code: 0 }); }, send);
    await expect(page.getByTestId("touched-line")).toBeVisible({ timeout: 10_000 });
    await shot(page, "thread-receipts", width);
  });
}
