// Performance budgets, with every mocked IPC answer delayed 150 ms (the
// engine's per-call cost). For each main page:
//   header    the page header paints within 200 ms of navigating, every visit
//             (the first visit shows the shell and a skeleton at once)
//   content   on the second visit the page's final content (cached data) is
//             on screen within 200 ms, and sooner than one IPC round trip;
//             the background refresh changes nothing
// And a sidebar click never holds the main thread for more than 50 ms
// (long-task observer). PERF_REPORT=1 prints the measured table. Runs in the
// "perf" project, against a production build (playwright.config.ts).
import { test, expect, type Page } from "@playwright/test";
import { openChatTab } from "./open-chat";
import { mockTauri } from "./tauri-mock";

const LATENCY = 150;
const HOME = ["inbox", "insights", "recommendations", "missions", "task-list", "compass", "apps"];
const SETTINGS = ["models", "council", "toolkit", "benchmark", "intent", "entities", "activity", "connections", "privacy-safety", "settings"];
const PAGES: Array<[string, string]> = [
  ...HOME.map((id) => ["prevail:work-section", id] as [string, string]),
  ...SETTINGS.map((id) => ["prevail:open-settings", id] as [string, string]),
];

// A large vault's worth of rows (invented "foo" names), so list rendering
// cost shows up in the long-task budget the way it does on a real vault.
const T = Date.parse("2026-09-20T12:00:00Z");
const BIG = {
  scan_skills: Array.from({ length: 1200 }, (_, i) => ({ domain: `foo-domain-${i % 30}`, name: `foo-skill-${i}`, path: `/tmp/smoke-vault/data/domains/foo-domain-${i % 30}/memory/skills/foo-skill-${i}`, description: `Foo skill number ${i}`, enabled: true })),
  entities_list: { generated_ts: 1, total: 350, entities: Array.from({ length: 350 }, (_, i) => ({ id: `person/foo-${i}`, name: `Foo ${i}`, kind: i % 3 ? "person" : "org", aliases: [], mention_count: i, conversations: 1, last_ts: T - i * 1000, saved: i % 2 === 0, has_page: i % 2 === 0 })) },
  tasks_read_all: Array.from({ length: 500 }, (_, i) => ({ id: `t${i}`, domain: `foo-domain-${i % 30}`, text: `Foo task ${i}`, status: ["todo", "doing", "blocked", "done"][i % 4], owner: i % 2 ? "me" : "ai", due: null, priority: null })),
  activity_read: Array.from({ length: 400 }, (_, i) => ({ ts: T - i * 60_000, type: i % 2 ? "sync" : "briefing", domain: `foo-domain-${i % 30}`, title: `Foo event ${i}` })),
  list_threads: Array.from({ length: 300 }, (_, i) => ({ path: `/tmp/smoke-vault/foo-${i}.md`, slug: `foo-${i}`, title: `Foo thread ${i}`, domain: null, created: 1783000000 - i, updated: 1783000000 - i, turn_count: 2, preview: "", cli: "foo-tool", model: null })),
  entities_show: { found: true, id: "person/foo-0", name: "Foo 0", kind: "person", aliases: [], kinds: ["person"], mention_count: 3, conversations: 1, last_ts: T, mentions: [], co_mentions: [], page_path: "data/entities/people/foo-0/entity.md", saved: true, digest: "Foo runs the bar.", notes: "" },
  engine_entities_duplicates: [],
  engine_entity_threads: [],
  mirror_periods: { generated_ts: T, weeks: Array.from({ length: 10 }, (_, w) => ({ week: `2026-07-${String(w + 1).padStart(2, "0")}`, label: `Week ${w}`, current: w === 0, prompts: 350, sittings: 35, has_letter: true, intent_line: `Foo week ${w}.`, days: [] })) },
  mirror_period: { generated_ts: T, totals: { prompts: 350, sittings: 35 }, projects: [{ slug: "foo-shop", title: "foo shop", domain: "foo", sittings: 35, prompts: 350, minutes: 600 }],
    period: { kind: "week", key: "2026-07-01", week: "2026-07-01", label: "Week 0" }, current: false, intent_line: "Foo week 0.", letter: { week: "2026-07-01", title: "A foo week", markdown: "Mostly foo." }, letter_status: "ready", findings: [] },
  projects_index: { generated_ts: T, model: "x", stats: { records: 3500, kept: 3500, internal: 0, projects: 40, unassigned: 0 }, recommendations: [],
    projects: Array.from({ length: 40 }, (_, i) => ({ slug: `foo-${i}`, title: `foo project ${i}`, domain: "foo", kind: "app", summary: "A foo.", status: "active", prompt_count: 80, first_ts: T - 90 * 864e5, last_ts: T - i * 864e5, monthly: { "2026-09": 40 }, tools: { "foo-tool": 80 }, pack_dir: "", brief_model: "", brief_ts: 0, intents: [], takeaways: [], ideas: [], open_questions: [] })) },
  engine_recommendations: { ok: true, recommendations: Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, category: i % 2 ? "rules" : "projects", title: `Foo recommendation ${i}`, detail: "Foo detail.", action: { kind: "open_rules" } })) },
  mirror_history: { total: 3500, tools: ["foo-tool"], weeks: Array.from({ length: 10 }, (_, w) => ({ week: `2026-07-${String(w + 1).padStart(2, "0")}`, label: `Week ${w}`, intent_line: null, sittings: Array.from({ length: 35 }, (_, k) => ({
    id: `s${w}-${k}`, tool: "foo-tool", project: "foo-shop", project_title: "foo shop", start_ts: T - (w * 35 + k) * 3.6e6, end_ts: T - (w * 35 + k) * 3.6e6 + 6e5,
    prompts: Array.from({ length: 10 }, (_, j) => ({ ts: T - (w * 35 + k) * 3.6e6 + j * 1000, text: `foo prompt ${w}-${k}-${j}` })),
  })) })) },
};

type Visit = { header: number; content: number };

// Navigate, then sample every frame for `ms`: when the header first shows and
// when the page text first equals what it finally settles on.
async function visit(page: Page, ev: string, id: string, ms = 1500): Promise<Visit> {
  return page.evaluate(([ev, id, ms]) => new Promise<Visit>((resolve) => {
    const t0 = performance.now();
    const samples: Array<[number, boolean, string]> = [];
    window.dispatchEvent(new CustomEvent(ev as string, { detail: id }));
    const tick = () => {
      const shell = document.querySelector("[data-shell=page]") as HTMLElement | null;
      const h = shell?.querySelector("[data-shell=header]") as HTMLElement | null;
      const title = h?.querySelector("h1")?.textContent ?? "";
      samples.push([performance.now() - t0, !!h && h.getBoundingClientRect().height > 0 && title.length > 0, shell ? shell.innerText : ""]);
      if (performance.now() - t0 < (ms as number)) requestAnimationFrame(tick);
      else {
        const final = samples[samples.length - 1][2];
        let content = samples[samples.length - 1][0];
        for (let i = samples.length - 1; i >= 0 && samples[i][2] === final; i--) content = samples[i][0];
        const hdr = samples.find((s) => s[1]);
        resolve({ header: hdr ? hdr[0] : Infinity, content });
      }
    };
    requestAnimationFrame(tick);
  }), [ev, id, ms] as const);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockTauri(page, BIG, { latencyMs: LATENCY });
  await page.goto("/");
  await openChatTab(page); await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  // Measure a settled app: the idle-time chunk prefetch has had its moment,
  // as it has by the time a person reaches for the sidebar.
  await page.waitForTimeout(2500);
});

test("perf · every main page paints its header at once, and cached content on the second visit", async ({ page }) => {
  test.setTimeout(120_000);
  const first: Record<string, Visit> = {};
  const second: Record<string, Visit> = {};
  for (const [ev, id] of PAGES) first[id] = await visit(page, ev, id);
  for (const [ev, id] of PAGES) second[id] = await visit(page, ev, id);
  if (process.env.PERF_REPORT) {
    const rows = PAGES.map(([, id]) => `| ${id} | ${first[id].header.toFixed(0)} | ${first[id].content.toFixed(0)} | ${second[id].header.toFixed(0)} | ${second[id].content.toFixed(0)} |`);
    console.log(["| page | 1st header | 1st content | 2nd header | 2nd content |", "|---|---:|---:|---:|---:|", ...rows].join("\n"));
  }
  for (const [, id] of PAGES) {
    expect.soft(first[id].header, `${id} first-visit header`).toBeLessThan(200);
    expect.soft(second[id].header, `${id} second-visit header`).toBeLessThan(200);
    // Under the IPC latency itself, so it can only have come from the cache.
    expect.soft(second[id].content, `${id} second-visit content`).toBeLessThan(Math.min(200, LATENCY));
  }
});

test("perf · a sidebar click never blocks the main thread for more than 50 ms", async ({ page }) => {
  test.setTimeout(120_000);
  const nav = page.getByTestId("app-sidebar");
  await page.evaluate(() => {
    const w = window as unknown as { __longTasks: number[] };
    w.__longTasks = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__longTasks.push(e.duration); }).observe({ type: "longtask", buffered: false });
  });
  const clicks = async (names: string[]) => {
    for (const name of names) {
      if (name === "Projects") await nav.getByTestId("sidebar-missions-all").click();
      else await nav.getByRole("button", { name: new RegExp(`^${name}( \\d+)?$`) }).first().click();
      await page.waitForTimeout(400);
    }
  };
  // Warm pass (chunks load, caches fill), then the measured pass.
  await clicks(["Tasks", "Projects", "Compass", "Insights"]);
  await nav.getByRole("button", { name: "Settings", exact: true }).click();
  await clicks(["Models", "Toolkit", "Council", "Activity", "Intent"]);
  await page.evaluate(() => { (window as unknown as { __longTasks: number[] }).__longTasks = []; });
  await clicks(["Models", "Toolkit", "Council", "Activity", "Intent"]);
  await nav.getByTestId("settings-back").click();
  await page.waitForTimeout(400);
  await clicks(["Tasks", "Projects", "Compass", "Insights"]);
  const longest = await page.evaluate(() => Math.max(0, ...(window as unknown as { __longTasks: number[] }).__longTasks));
  if (process.env.PERF_REPORT) console.log(`longest main-thread task during sidebar clicks: ${longest.toFixed(0)} ms`);
  expect(longest).toBeLessThanOrEqual(50);
});
