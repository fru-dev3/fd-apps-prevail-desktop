// Step 3 of the plans: Home is Today, the weekly review card with its 1-5,
// a job card in chat (live, then done with a Filed list and Undo), the
// Specialists page with the chief of staff's setup, Decisions, metric
// proposals, and @ handing a message to a specialist. Invented data only.
// With PLANS_SHOTS=<dir>, each surface is captured at 390, 768, 1280, 1920.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const TODAY = {
  date: "2026-10-02", generated: 1, calm: 3,
  items: [
    { key: "task:money:m2", kind: "commitment", title: "Send the quote request to Sam", domain: "money", due: "2026-10-03", person: "person/sam-foo", thread: ["Money", "Cash buffer of a year", "Peace of mind"], unlinked: false, why: "due in 1 day, a promise to someone", score: 0.4, ref: { domain: "money", id: "m2" } },
    { key: "task:family:f1", kind: "task", title: "Book the foo hike permit", domain: "family", due: "2026-10-09", thread: ["Family", "Weekly foo hike", "Family presence"], unlinked: false, why: "due in 7 days", score: 0.2, ref: { domain: "family", id: "f1" } },
    { key: "task:home:t-1", kind: "task", title: "Fix the foo gutter before the rain", domain: "home", due: "2026-09-30", thread: ["Home"], unlinked: true, why: "2 days overdue", score: 0.1, ref: { domain: "home", text: "Fix the foo gutter before the rain" } },
  ],
  fallingBehind: { text: "Renew the bar card: 12 days overdue" },
  decisionDue: { question: "Keep or sell the foo rental?", due: "2026-10-15", domain: "home", slug: "keep-or-sell-the-foo-rental", recommendation: "keep" },
  yourDay: { connected: false, note: "No calendar is connected yet, so your day is not on the card." },
  alsoDue: [{ key: "task:money:m3", kind: "task", title: "Review the bar statement", domain: "money", due: "2026-10-04", thread: ["Money"], unlinked: false, why: "due in 2 days", score: 0.05, ref: { domain: "money", id: "m3" } }],
  feedback: [],
};
const N = (lo: number, hi: number) => ({ lo, hi, learning: false });
const REVIEW = {
  week: "2026-09-28", through: "2026-10-02", due: true, checkin: null, calmNormal: 4,
  lines: { moved: ["Commits 40, above your normal of 5 to 12"], drifted: ["Weekly foo hike: nothing in family for six weeks"], conflict: "No conflict with evidence this week." },
  glance: [{ id: "m-ai-spend", title: "AI spend", unit: "usd", value: 42.5, documentary: false, normal: N(20, 50) }, { id: "m-trips", title: "Trips", unit: "count", value: 0, documentary: true, record: "Latest: Hike, Foo Valley on 2026-09-12", normal: N(0, 0) }],
  surprise: null,
  candidates: [{ key: "value:being aware", kind: "value", title: "Being aware", quote: "I want to be very aware of what is happening.", count: 4 }],
  metricProposals: [{ key: "mp-1234abcd", kind: "goal", title: "Things shipped, for \"Ship the bar app\"", why: "\"Ship the bar app\" has no metric.", metric: "m-shipped", serves: "g-ship", servesTitle: "Ship the bar app", from: "build/compass.md", tier: "derived", spark: [0, 1, 0, 2, 1, 0, 0, 1, 3, 1, 0, 2], computable: true, score: 0.5 }],
  question: { id: "enough", text: "For Peace of mind, what would enough look like?" },
  woop: [], waited: [], interruptions: { used: 0, budget: 3 },
};
const JOB = {
  id: "2026-10-02-081542-find-the-best-foo-providers", ask: "Find the best foo insurance providers for next year for the rentals",
  origin: { kind: "chat", domain: "insurance" }, domains: { owner: "insurance", consulted: ["real-estate", "wealth"], informed: ["tax"] },
  team: [{ step: 1, specialists: ["researcher", "scout"] }, { step: 2, specialists: ["steward"], gate: true }, { step: 3, specialists: ["editor"] }],
  effort: "standard", budget: { usd: 1, minutes: 10 }, why: "compare and choose", playbook: null, status: "done", startsAlone: true,
  created: 1, started: 1, ended: 372_000, cost: { usd: 0.84, minutes: 6.2, estimated: true },
  result: { type: "page", summary: "Carrier A for both foo rentals, about $340 a year less.", page: "data/domains/insurance/memory/briefs/2026-10-02-find-the-best-foo.md", verdict: "fits" },
};
const JOB_VIEW = {
  job: JOB,
  steps: ["researcher", "scout", "steward", "editor"].map((s, i) => ({ id: `${i + 1}-${s}`, specialist: s, status: "done", passes: [{ n: 1, check: { ok: true, missing: [] } }], cost: { usd: 0.2, minutes: 1 } })),
  filed: [
    { n: 1, ts: 1, domain: "insurance", kind: "page", file: "data/domains/insurance/memory/briefs/x.md", ref: "x", text: "page saved" },
    { n: 2, ts: 1, domain: "insurance", kind: "task", file: "data/domains/insurance/memory/tasks.md", ref: "j1", text: "task: renew with Carrier A, by 2026-12-01" },
    { n: 3, ts: 1, domain: "real-estate", kind: "note", file: "data/domains/real-estate/memory/updates.jsonl", ref: "job:x", text: "note: premiums drop about $340 a year" },
  ],
  body: "## Answer\nCarrier A.\n\n| Carrier | Price |\n|---|---|\n| A | $1,200 |\n| B | $1,540 |",
};
const SPECIALISTS = [
  { id: "researcher", name: "Researcher", icon: "search", family: "know", returns: "findings", ceiling: "read", tools: ["web", "vault-read"], apps: [], runtime: "deep", budget: { minutes: 6, usd: 0.4, passes: 2 }, handoff: "offer", doneWhen: ["every claim has a source"], mandate: "A deep, sourced answer to one question.", on: true, builtIn: true },
  { id: "steward", name: "Steward", icon: "scale", family: "decide", returns: "verdict", ceiling: "read", tools: ["vault-read"], apps: [], runtime: "deep", budget: { minutes: 3, usd: 0.2, passes: 1 }, handoff: "offer", doneWhen: [], mandate: "Checks a result against the Compass.", on: true, builtIn: true },
  { id: "editor", name: "Editor", icon: "file-text", family: "deliver", returns: "page", ceiling: "write-vault", tools: ["vault-read"], apps: [], runtime: "standard", budget: { minutes: 3, usd: 0.2, passes: 1 }, handoff: "offer", doneWhen: [], mandate: "One clear page.", on: true, builtIn: true },
  { id: "analyst", name: "Analyst", icon: "circle-dashed", family: "know", returns: "numbers", ceiling: "read", tools: [], apps: [], runtime: "standard", budget: { minutes: 5, usd: 0.3, passes: 1 }, handoff: "off", doneWhen: [], mandate: "", on: false, builtIn: true },
];
const DECISIONS = [
  { slug: "keep-or-sell-the-foo-rental", domain: "home", file: "/tmp/smoke-vault/data/domains/home/memory/decisions/keep-or-sell-the-foo-rental.md", question: "Keep or sell the foo rental?", status: "open", due: "2026-10-15", owner: "home", consulted: ["money"], serves: [], recommendation: "keep", confidence: "medium", sections: { Context: "Two foo units, both rented.", Options: "- Keep\n- Sell", Recommendation: "Keep: cash flow covers it." } },
];
const FIX = {
  engine_today: TODAY, engine_review: REVIEW, engine_job_show: JOB_VIEW, engine_jobs: [JOB, { ...JOB, id: "b-job", ask: "Plan the foo move", status: "proposed", startsAlone: false, askReason: "over your limit of $1 and 10 minutes" }],
  engine_specialists: SPECIALISTS, engine_specialist_show: { notebooks: [{ domain: "insurance", lines: 2, notes: false }] }, engine_decisions: DECISIONS,
  engine_today_tap: TODAY, engine_review_checkin: { ok: true }, engine_review_candidate: { ok: true }, engine_job_undo: { ok: true }, engine_chief_set: { ok: true },
  engine_decision_action: { ok: true }, engine_metric_proposals: REVIEW.metricProposals, engine_metric_answer: { ok: true },
  chief_of_staff_read: "---\nname: Foo\nhandoff: auto\n---\n\n## Limits\n- usd: 1\n- minutes: 10\n\n## Never pull in\n- health\n\n## What I've learned\n- insurance jobs: skip the scout\n",
  scan_vault: ["insurance", "real-estate", "wealth", "tax"].map((name) => ({ name, path: `/tmp/smoke-vault/data/domains/${name}`, has_state: true, state_preview: null })),
  read_ideal_state: "", read_omega: "", read_user_md: "", read_memory_md: "",
  domain_context: { state: "", decisions: "", journal: "", recent_logs: [], skills: [], layoutV4: true },
};

const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? [])
    .filter((e) => e.cmd === c).map((e) => e.args), cmd);
const fire = (page: Page, name: string, detail: unknown) =>
  page.evaluate(([n, d]) => window.dispatchEvent(new CustomEvent(n as string, { detail: d })), [name, detail] as [string, unknown]);
const SHOTS = process.env.PLANS_SHOTS;

async function setup(page: Page, width: number, extra: Record<string, unknown> = {}) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
  await page.addInitScript(() => localStorage.setItem("prevail.desktop.defaultChatCli", "claude"));
  await mockTauri(page, { ...FIX, ...extra });
  await page.goto("/");
}

/** Nothing on the page may be wider than the window. */
async function noOverflow(page: Page) {
  const over = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll("[data-testid]")].filter((e) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      return r.width > 0 && (r.right > vw + 1 || r.left < -1);
    }).map((e) => (e as HTMLElement).dataset.testid).slice(0, 5);
  });
  expect(over).toEqual([]);
}

test("Home is Today: three things with their thread, taps go to the engine; the weekly review takes the 1-5", async ({ page }) => {
  await setup(page, 1280);
  const card = page.getByTestId("today-card");
  await expect(card).toContainText("What matters today", { timeout: 15_000 });
  await expect(card.getByTestId("today-item")).toHaveCount(3);
  await expect(card.getByTestId("today-item").first()).toContainText("Promise to Sam Foo");
  await expect(card.getByTestId("today-thread").first()).toHaveText("Money · Peace of mind");
  await expect(card.getByTestId("today-thread").nth(2)).toHaveText("Home · Not linked");
  await expect(page.getByTestId("today-falling-behind")).toContainText("Renew the bar card");
  await expect(page.getByTestId("today-decision")).toContainText("Keep or sell the foo rental?");
  await expect(page.getByTestId("today-your-day")).toContainText("No calendar is connected");
  await card.getByTestId("today-done").first().click();
  await expect.poll(async () => (await calls(page, "engine_today_tap"))[0]).toEqual({ vault: "/tmp/smoke-vault", key: "task:money:m2", action: "done" });
  await card.getByTestId("today-item").nth(1).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Not important" }).click();
  await expect.poll(async () => (await calls(page, "engine_today_tap")).length).toBe(2);
  // The weekly review: lines, glance, a candidate, a metric proposal, the question, the 1-5.
  const r = page.getByTestId("review-card");
  await expect(r).toContainText("Week of Sep 28");
  await expect(r).toContainText("Commits 40, above your normal");
  await expect(r.getByTestId("review-glance")).toContainText("$42.50");
  await expect(r.getByTestId("review-glance")).toContainText("Latest: Hike, Foo Valley");
  await r.getByRole("button", { name: "Yes: Being aware" }).click();
  await expect.poll(async () => (await calls(page, "engine_review_candidate"))[0]).toEqual({ vault: "/tmp/smoke-vault", key: "value:being aware", answer: "yes" });
  await r.getByRole("button", { name: /Track Things shipped/ }).click();
  await expect.poll(async () => (await calls(page, "engine_metric_answer"))[0]).toMatchObject({ key: "mp-1234abcd", answer: "track" });
  await r.getByTestId("review-calm-4").click();
  await expect.poll(async () => (await calls(page, "engine_review_checkin"))[0]).toEqual({ vault: "/tmp/smoke-vault", calm: 4, note: null });
  await r.getByTestId("review-continue").click();
  await expect(page.locator("[data-tour=composer] textarea").first()).toHaveValue("Let's continue my Compass");
});

test("without a Today card, Home keeps its greeting", async ({ page }) => {
  await setup(page, 1280, { engine_today: null, engine_review: null });
  await expect(page.getByText("What should we work on?")).toBeVisible({ timeout: 15_000 });
});

test("a job in chat: the card shows the team, then the result, Open page, and Undo on each filed line", async ({ page }) => {
  await setup(page, 1280);
  await expect(page.getByTestId("today-card")).toBeVisible({ timeout: 15_000 });
  await fire(page, "prevail:open-domain", "insurance");
  const box = page.locator("[data-tour=composer] textarea").first();
  await expect(box).toBeVisible({ timeout: 10_000 });
  await box.fill("Find the best foo insurance providers for next year for the rentals");
  await box.press("Enter");
  await expect.poll(async () => (await calls(page, "engine_chat")).length).toBe(1);
  const [last] = (await calls(page, "engine_chat")).slice(-1);
  await page.evaluate(([s, job]) => {
    const emit = (window as unknown as { __emit: (e: string, p: unknown) => void }).__emit;
    for (const data of [{ type: "start" }, { type: "job", job }, { type: "delta", text: "On it. Researcher, Scout, Steward, Editor are on it; the result lands in insurance." }, { type: "assistant", text: "On it. Researcher, Scout, Steward, Editor are on it; the result lands in insurance." }]) emit("engine-chat:line", { session: s, data });
    emit("engine-chat:done", { session: s, code: 0 });
  }, [String(last.session), { id: JOB.id, status: "running" }] as [string, unknown]);
  const card = page.getByTestId("job-card");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/\[job:/)).toHaveCount(0);
  await expect(card.getByTestId("job-result")).toContainText("Carrier A for both foo rentals");
  await expect(card).toContainText("Steward: fits");
  await card.getByTestId("job-open-page").click();
  await expect(card).toContainText("$1,540");
  await expect(card.getByTestId("job-filed-row")).toHaveCount(3);
  await card.getByTestId("job-undo").nth(2).click();
  await expect.poll(async () => (await calls(page, "engine_job_undo"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: JOB.id, n: 3 });
});

test("a proposed job asks first: Start, Adjust inside the card, Not now", async ({ page }) => {
  await setup(page, 1280, { engine_job_show: { ...JOB_VIEW, job: { ...JOB, id: "b-job", status: "proposed", startsAlone: false, askReason: "over your limit of $1 and 10 minutes", result: undefined }, filed: [], body: "" }, engine_job_adjust: { ok: true }, engine_job_action: { ok: true } });
  await expect(page.getByTestId("today-card")).toBeVisible({ timeout: 15_000 });
  await fire(page, "prevail:work-section", "specialists");
  await page.getByTestId("specialists-row-jobs:waiting").click();
  await page.getByTestId("job-row").first().getByRole("button").first().click();
  const card = page.getByTestId("job-card").first();
  await expect(card).toContainText("Asking first: over your limit");
  await card.getByTestId("job-adjust").click();
  const panel = card.getByTestId("job-adjust-panel");
  await panel.getByRole("button", { name: "Remove Scout" }).click();
  await panel.getByRole("button", { name: "Quick" }).click();
  await panel.getByTestId("job-adjust-save").click();
  await expect.poll(async () => (await calls(page, "engine_job_adjust"))[0]).toMatchObject({ id: "b-job", effort: "quick", owner: "insurance", consulted: ["real-estate", "wealth"], informed: ["tax"], team: [["researcher"], ["steward"], ["editor"]] });
  await card.getByTestId("job-start").click();
  await expect.poll(async () => (await calls(page, "engine_job_action"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "b-job", action: "start" });
});

test("Specialists: families, a specialist's ceiling and notebooks, the chief of staff's setup", async ({ page }) => {
  await setup(page, 1280);
  await expect(page.getByTestId("today-card")).toBeVisible({ timeout: 15_000 });
  await fire(page, "prevail:work-section", "specialists");
  await expect(page.getByTestId("specialists-page")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("specialists-row-spec:researcher").click();
  const d = page.getByTestId("specialist-detail");
  await expect(d).toContainText("Returns findings");
  await expect(d.getByTestId("specialist-ceiling")).toContainText("Read");
  await expect(d.getByTestId("specialist-notebooks")).toContainText("Insurance");
  await page.getByTestId("specialists-row-setup").click();
  const s = page.getByTestId("chief-setup");
  await expect(s).toContainText("insurance jobs: skip the scout");
  await s.getByRole("button", { name: "Always ask" }).click();
  await expect.poll(async () => (await calls(page, "engine_chief_set"))[0]).toEqual({ vault: "/tmp/smoke-vault", key: "handoff", value: "offer" });
});

test("Decisions: the gut call comes before the recommendation", async ({ page }) => {
  await setup(page, 1280);
  await expect(page.getByTestId("today-card")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("app-sidebar").getByRole("button", { name: "Decisions" }).click();
  await page.getByTestId("decision-row").first().click();
  const d = page.getByTestId("decision-detail");
  await expect(d).toContainText("Keep or sell the foo rental?");
  await expect(d).not.toContainText("Keep: cash flow covers it");
  await d.getByLabel("Your gut call").fill("sell");
  await d.getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await calls(page, "engine_decision_action"))[0]).toMatchObject({ target: "home/keep-or-sell-the-foo-rental", action: "gut", text: "sell" });
});

test("Insights > Metrics > Proposals: Track sends the answer", async ({ page }) => {
  await setup(page, 1280);
  await expect(page.getByTestId("today-card")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("app-sidebar").getByRole("button", { name: "Insights" }).click();
  await page.getByTestId("tab-metrics").click();
  await page.getByTestId("metrics-row-proposals").click();
  await expect(page.getByTestId("metric-proposal")).toHaveCount(1);
  await page.getByTestId("proposal-track").click();
  await expect.poll(async () => (await calls(page, "engine_metric_answer"))[0]).toMatchObject({ key: "mp-1234abcd", answer: "track" });
});

test("@ lists specialists; picking one hands the message to it", async ({ page }) => {
  await setup(page, 1280);
  await expect(page.getByTestId("today-card")).toBeVisible({ timeout: 15_000 });
  await fire(page, "prevail:open-domain", "insurance");
  const box = page.locator("[data-tour=composer] textarea").first();
  await expect(box).toBeVisible({ timeout: 10_000 });
  await box.fill("compare umbrella policies @Res");
  await page.getByTestId("ref-option-specialist-researcher").click();
  await expect(box).toHaveValue("@Researcher compare umbrella policies ");
});

for (const width of [390, 768, 1280, 1920]) {
  test(`layout at ${width}: Today, the review card, a job card, Specialists and Decisions fit`, async ({ page }) => {
    await setup(page, width);
    await expect(page.getByTestId("today-card")).toBeVisible({ timeout: 15_000 });
    await noOverflow(page);
    if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/today-${width}.png`, fullPage: true }); }
    await fire(page, "prevail:work-section", "specialists");
    await expect(page.getByTestId("specialists-page")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("specialists-row-jobs:done").click();
    await page.getByTestId("job-row").first().getByRole("button").first().click();
    await expect(page.getByTestId("job-card").first()).toBeVisible();
    await noOverflow(page);
    if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/jobs-${width}.png` }); }
    await fire(page, "prevail:work-section", "decisions");
    await expect(page.getByTestId("decisions-page")).toBeVisible({ timeout: 10_000 });
    await noOverflow(page);
    if (SHOTS) { await page.screenshot({ path: `${SHOTS}/decisions-${width}.png` }); }
    await fire(page, "prevail:work-section", "specialists");
    await page.evaluate(() => { localStorage.setItem("prevail.specialists.focus", "setup"); window.dispatchEvent(new Event("prevail:specialists-focus")); });
    await expect(page.getByTestId("chief-setup")).toBeVisible({ timeout: 10_000 });
    await noOverflow(page);
    if (SHOTS) { await page.screenshot({ path: `${SHOTS}/chief-setup-${width}.png` }); }
  });
}
