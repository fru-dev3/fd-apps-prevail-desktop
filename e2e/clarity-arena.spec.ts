// The Arena after the 0.4.1 redesign: a column of Run a benchmark, Presets
// and Results; a one-page run flow; results that open to a per-run
// leaderboard. Model ids here are invented ("foo", "bar") so no real model name
// lands in a test.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const RUN = (over: Record<string, unknown>) => ({
  label: "2026-09-01_claude-foo", run_dir: "/tmp/smoke-vault/bench/r1", judge_avg: 7.5, keyword_avg: 60, questions: 2,
  date: "2026-09-01", domains: ["career"], scored: true, batch_id: "b1", batch_label: "2026-09-01 10:00 · Career · 2 models",
  created_ms: 1788000000000, cli: "claude", model: "foo", ms_avg: 4000, tokens_per_sec: 30, cost_usd_est: 0.04, cost_basis: "frontier",
  ...over,
});

const ARENA_FX = {
  detect_clis: [
    { id: "claude", label: "Claude Code", available: true, versions: [] },
    { id: "ollama", label: "Ollama", available: true, versions: [] },
  ],
  bunker_status: { enabled: false, network_blocked: false, web_blocked: false, cloud_blocked: false, local_available: true },
  benchmark_questions: [
    { id: "q-foo-1", domain: "career", prompt: "Foo?", context: "", notes: "", council: false, expected_decision: "", expected_verdict_keywords: [], path: "/tmp/q1.md" },
    { id: "q-foo-2", domain: "career", prompt: "Bar?", context: "", notes: "", council: false, expected_decision: "", expected_verdict_keywords: [], path: "/tmp/q2.md" },
    { id: "q-bar-1", domain: "health", prompt: "Baz?", context: "", notes: "", council: false, expected_decision: "", expected_verdict_keywords: [], path: "/tmp/q3.md" },
  ],
  benchmark_runs: [
    RUN({}),
    RUN({ label: "2026-09-01_ollama-bar", run_dir: "/tmp/smoke-vault/bench/r2", judge_avg: 6.1, cli: "ollama", model: "bar", cost_usd_est: 0, cost_basis: "local", created_ms: 1788000001000 }),
  ],
  benchmark_matrix: [],
};

async function openArena(page: Page, localStorageSeed: Record<string, string> = {}) {
  await mockTauri(page, ARENA_FX);
  // Bunker Mode is on by default in storage; these runs use a cloud runtime.
  await page.addInitScript((seed: Record<string, string>) => {
    localStorage.setItem("prevail.pref.bunkerMode", "0");
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, localStorageSeed);
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "benchmark" })));
  await expect(page.getByTestId("arena-page")).toBeVisible({ timeout: 10_000 });
}

async function benchStarts(page: Page) {
  return page.evaluate(() => ((window as unknown as { __invokeLog: Array<{ cmd: string; args: { args: Record<string, unknown> } }> }).__invokeLog ?? [])
    .filter((e) => e.cmd === "benchmark_start").map((e) => e.args.args));
}

test("arena column: Run first, then Presets and Results; no Model Scout, Schedule or domain list", async ({ page }) => {
  await openArena(page);
  const nav = page.getByTestId("arena-nav");
  await expect(nav.getByTestId("arena-row-run")).toBeVisible();
  await expect(nav.getByText("Presets", { exact: true })).toBeVisible();
  await expect(nav.getByText("Results", { exact: true })).toBeVisible();
  await expect(nav.getByTestId("arena-row-leaderboard")).toBeVisible();
  await expect(nav.getByTestId("arena-row-result-b1")).toContainText("2 models");
  await expect(page.getByText("Model Scout")).toHaveCount(0);
  await expect(nav.getByText(/^Schedule$/)).toHaveCount(0);
  await expect(nav.locator("[data-testid^='arena-domain-']")).toHaveCount(0);
  // The Run page is the default detail.
  await expect(page.getByTestId("arena-run")).toBeVisible();
});

test("arena run flow: a preset plus one domain runs the preset's models on that domain", async ({ page }) => {
  const suite = [{ id: "ste-foo", name: "Foo preset", mode: "single", models: ["claude::foo", "ollama::bar"], domains: [], createdAt: 1, origin: "manual" }];
  await openArena(page, { "prevail.bench.suites": JSON.stringify(suite) });
  const run = page.getByTestId("arena-run");
  await run.getByTestId("arena-mode-preset").click();
  await run.getByTestId("arena-pick-preset-Foo preset").click();
  await run.getByTestId("arena-domain-career").click();
  await expect(run.getByTestId("arena-estimate")).toContainText("2 questions × 2 models = 4 answers");
  await run.getByTestId("arena-run-button").click();
  await expect.poll(async () => (await benchStarts(page)).length).toBe(2);
  const starts = await benchStarts(page);
  expect(starts.map((s) => `${s.cli}/${s.model}`).sort()).toEqual(["claude/foo", "ollama/bar"]);
  expect(starts.every((s) => s.domain === "career")).toBe(true);
  // Live progress shows in place.
  await expect(run.getByTestId("arena-progress")).toBeVisible();
});

test("arena run flow: choosing models by hand with all domains runs those models on everything", async ({ page }) => {
  await openArena(page);
  const run = page.getByTestId("arena-run");
  await run.getByTestId("arena-mode-custom").click();
  const first = run.locator("[data-testid^='arena-model-claude-']").first();
  const key = (await first.getAttribute("data-testid"))!.replace("arena-model-claude-", "");
  await first.click();
  await expect(first).toHaveAttribute("aria-checked", "true");
  await expect(run.getByTestId("arena-domain-all")).toHaveAttribute("aria-pressed", "true");
  await expect(run.getByTestId("arena-estimate")).toContainText("3 questions × 1 model = 3 answers");
  await run.getByTestId("arena-run-button").click();
  await expect.poll(async () => (await benchStarts(page)).length).toBe(1);
  const [s] = await benchStarts(page);
  expect(s.cli).toBe("claude");
  expect(s.model).toBe(key);
  expect(s.domain).toBeNull();
});

test("arena results: a past run opens to its own leaderboard, and the Leaderboard combines every run", async ({ page }) => {
  await openArena(page);
  await page.getByTestId("arena-row-result-b1").click();
  const result = page.getByTestId("arena-result");
  await expect(result).toBeVisible();
  await expect(result).toContainText("2 models");
  await expect(result.getByRole("tab", { name: "Summary" })).toBeVisible();
  await expect(result.getByRole("tab", { name: "By domain" })).toBeVisible();
  await expect(result).toContainText("7.5");
  await expect(result).toContainText("6.1");
  await page.getByTestId("arena-row-leaderboard").click();
  const board = page.getByTestId("arena-board");
  await expect(board.getByRole("tab", { name: "Questions" })).toBeVisible();
  await board.getByRole("tab", { name: "Questions" }).click();
  await expect(board).toContainText("Foo?");
});

test("arena presets: a new preset is named and filled in its detail", async ({ page }) => {
  await openArena(page);
  await page.getByTestId("arena-new-preset").click();
  const detail = page.getByTestId("arena-preset");
  const name = detail.getByTestId("arena-preset-name");
  await name.fill("Foo trio");
  await name.press("Enter");
  await detail.locator("[data-testid^='arena-model-claude-']").first().click();
  await expect(page.getByTestId("arena-nav").getByTestId("arena-row-preset-Foo trio")).toContainText("1 model");
  // Run this preset opens the run page with it picked.
  await detail.getByTestId("arena-preset-run").click();
  await expect(page.getByTestId("arena-pick-preset-Foo trio")).toHaveAttribute("aria-checked", "true");
});

test("arena deep links: old Scout, Schedule and History ids land on real pages", async ({ page }) => {
  await openArena(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "history" })));
  await expect(page.getByTestId("arena-board")).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "scout" })));
  await expect(page.getByTestId("arena-run")).toBeVisible({ timeout: 10_000 });
});

test("arena: Run this preset opens the Run page with it picked, and Run with all domains starts it on every domain", async ({ page }) => {
  const suite = [{ id: "ste-foo", name: "Foo preset", mode: "single", models: ["claude::foo", "ollama::bar"], domains: [], createdAt: 1, origin: "manual" }];
  await openArena(page, { "prevail.bench.suites": JSON.stringify(suite) });
  await page.getByTestId("arena-nav").getByTestId("arena-row-preset-Foo preset").click();
  await page.getByTestId("arena-preset-run").click();
  const run = page.getByTestId("arena-run");
  await expect(run.getByTestId("arena-pick-preset-Foo preset")).toHaveAttribute("aria-checked", "true");
  // Nothing starts by itself.
  expect(await benchStarts(page)).toEqual([]);
  await run.getByTestId("arena-run-all-domains").click();
  await expect.poll(async () => (await benchStarts(page)).length).toBe(2);
  expect((await benchStarts(page)).every((s) => s.domain === null)).toBe(true);
});
