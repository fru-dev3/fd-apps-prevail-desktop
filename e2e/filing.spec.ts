// Conversation filing: chips at the top of a conversation, "Also filed here"
// in a secondary domain, and the filing plan. Plus the composer's one chip row.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri, invokedCommands } from "./tauri-mock";

const SHOTS = process.env.MOBILE_SHOTS_DIR || "/tmp";
const FOO = "/tmp/smoke-vault/_threads/foo-plan.md";
const BAR = "/tmp/smoke-vault/_threads/bar-notes.md";
const BODY = "## You\n\nPlan the foo\n\n## claude\n\nHere is the foo plan.\n\n";
const meta = (path: string, title: string, routed: string[] = [], extra: Record<string, unknown> = {}) =>
  ({ path, slug: path.split("/").pop()!.replace(/\.md$/, ""), title, domain: null, created: 1783000000, updated: 1783000000, turn_count: 2, preview: "", cli: "claude", model: null, routed, ...extra });
const turns = [
  { role: "user", cli: null, model: null, content: "Plan the foo" },
  { role: "assistant", cli: "claude", model: null, content: "Here is the foo plan." },
];
const DOMAINS = [
  { name: "career", path: "/tmp/smoke-vault/career", has_state: true, state_preview: null },
  { name: "health", path: "/tmp/smoke-vault/health", has_state: true, state_preview: null },
  { name: "finance", path: "/tmp/smoke-vault/finance", has_state: true, state_preview: null },
];

function fixtures(routed: string[], extra: Record<string, unknown> = {}) {
  return {
    scan_vault: DOMAINS,
    read_ideal_state: "", read_omega: "", read_user_md: "", read_memory_md: "",
    list_threads: [meta(FOO, "Foo plan", routed)],
    load_thread: { meta: meta(FOO, "Foo plan", routed), turns },
    thread_set_filing: routed,
    engine_route_correct: { ok: true },
    ...extra,
  };
}

// The same state at phone width, then back.
async function shoot(page: Page, name: string, testId: string) {
  await page.screenshot({ path: `${SHOTS}/${name}-1440.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId(testId).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${name}-390.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${name} scrolls sideways at 390`).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1440, height: 900 });
}

// Fixtures do not carry functions into the page: answer per-args here.
async function listByDomain(page: Page, byDomain: Record<string, unknown>) {
  await page.addInitScript((m) => {
    const fx = (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures;
    const all = fx.list_threads;
    fx.list_threads = (a: { domain?: string | null }) => (a?.domain && a.domain in m ? m[a.domain] : all);
  }, byDomain);
}

async function openDomain(page: Page, name: string) {
  const bar = page.getByTestId("app-sidebar");
  await bar.getByRole("button", { name: /^All/ }).first().click();
  await bar.getByText(name, { exact: true }).first().click();
}

async function openFoo(page: Page) {
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  if ((page.viewportSize()?.width ?? 1440) < 500) {
    await page.getByRole("button", { name: /^Threads/ }).first().click();
    await page.getByText("Foo plan").first().click();
  } else {
    await page.getByTestId("threads-list").getByText("Foo plan").first().click();
  }
  await expect(page.getByText("Here is the foo plan.")).toBeVisible({ timeout: 10_000 });
}

const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? []).filter((e) => e.cmd === c).map((e) => e.args), cmd);

test("filing chips render from the thread's filing; remove, change home and add each file it and teach routing", async ({ page }) => {
  await mockTauri(page, fixtures(["career", "health"]));
  await page.goto("/");
  await openFoo(page);
  const chips = page.getByTestId("filing-chips");
  await expect(chips).toContainText("Filed in");
  await expect(page.getByTestId("filing-home")).toContainText("Career");
  await expect(chips).toContainText("Also in");
  await expect(chips).toContainText("Health");
  await shoot(page, "filing-chips", "filing-chips");

  await chips.getByLabel("Remove Health").click();
  await expect.poll(async () => (await calls(page, "thread_set_filing")).at(-1)?.routed).toEqual(["career"]);
  await expect.poll(async () => (await calls(page, "engine_route_correct")).at(-1)?.domains).toEqual(["career"]);

  await page.getByTestId("filing-home").click();
  await page.getByRole("menuitem", { name: /Finance/ }).click();
  await expect.poll(async () => (await calls(page, "thread_set_filing")).at(-1)?.routed).toEqual(["finance"]);
  await expect.poll(async () => (await calls(page, "engine_route_correct")).at(-1)?.from).toEqual(["career"]);

  await chips.getByLabel("Add a domain").click();
  await page.getByRole("menuitem", { name: /Health/ }).click();
  await expect.poll(async () => (await calls(page, "thread_set_filing")).at(-1)?.routed).toEqual(["finance", "health"]);
  expect((await calls(page, "engine_route_correct")).length).toBe(3);
});

for (const width of [1440, 390]) {
  test(`an unfiled conversation shows its candidates; one click files it (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    await mockTauri(page, fixtures([], {
      engine_chat: null,
      engine_route: { domains: [], reason: "", source: "decision", primary: null, secondary: [], candidates: [{ slug: "health", score: 0.3 }, { slug: "finance", score: 0.25 }, { slug: "career", score: 0.2 }], unfiled: true, changed: true, checked: true },
    }));
    await page.goto("/");
    await openFoo(page);
    const box = page.getByPlaceholder("Ask anything").first();
    await box.fill("and the bar?");
    await box.press("Enter");
    const chips = page.getByTestId("filing-chips");
    await expect(chips).toContainText("Unfiled", { timeout: 10_000 });
    await expect(chips.getByTestId("filing-candidate")).toHaveCount(3);
    const route = (await calls(page, "engine_route")).at(-1)!;
    expect(route.turn).toBe(2);
    expect(route.current).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/filing-unfiled-${width}.png` });
    await chips.getByTestId("filing-candidate").first().click();
    await expect(page.getByTestId("filing-home")).toContainText("Health");
    await expect.poll(async () => (await calls(page, "thread_set_filing")).at(-1)?.routed).toEqual(["health"]);
  });
}

test("a secondary domain lists the thread as Also filed here", async ({ page }) => {
  await mockTauri(page, fixtures(["career", "health"]));
  await listByDomain(page, { health: [meta(FOO, "Foo plan", ["career", "health"], { linked_from: "general", filed_as: "also" })] });
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await openDomain(page, "Health");
  await expect(page.getByTestId("thread-linked").first()).toHaveText("Also filed here", { timeout: 10_000 });
});

for (const width of [1440, 390]) {
  test(`the filing plan applies routed only and leaves the thread body byte-identical (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    // A tiny in-page vault: thread_set_filing rewrites only the routed line.
    await page.addInitScript(([foo, body]) => {
      (window as unknown as { __files: Record<string, string> }).__files = { [foo]: `---\ntitle: Foo plan\ndomain: \n---\n\n${body}` };
    }, [FOO, BODY]);
    await mockTauri(page, {
      scan_vault: DOMAINS,
      engine_file_plan: {
        plan: [
          { thread: FOO, title: "Foo plan", current_home: "general", primary: "career", secondary: ["health"], candidates: [{ slug: "career", score: 0.7 }], unfiled: false },
          { thread: BAR, title: "Bar notes", current_home: "general", primary: null, secondary: [], candidates: [{ slug: "finance", score: 0.3 }, { slug: "health", score: 0.2 }], unfiled: true },
        ],
        skipped: 2, total: 4, cached: 0,
      },
      engine_route_correct: { ok: true },
    });
    await page.addInitScript(() => {
      const w = window as unknown as { __files: Record<string, string>; __TAURI_INTERNALS__: { invoke: (c: string, a: Record<string, unknown>) => Promise<unknown> } };
      const t = setInterval(() => {
        const inner = w.__TAURI_INTERNALS__;
        if (!inner || (inner as unknown as { __wrapped?: boolean }).__wrapped) return;
        const orig = inner.invoke.bind(inner);
        inner.invoke = async (cmd, args) => {
          if (cmd === "thread_set_filing") {
            const p = String(args.thread);
            const raw = w.__files[p] ?? "";
            const [, fm, rest] = raw.match(/^---\n([\s\S]*?\n)---\n([\s\S]*)$/) ?? [];
            if (fm !== undefined) {
              const routed = (args.routed as string[]).join(", ");
              w.__files[p] = `---\n${fm.split("\n").filter((l) => l && !l.startsWith("routed:")).join("\n")}\n${routed ? `routed: ${routed}\n` : ""}---\n${rest}`;
            }
          }
          return orig(cmd, args);
        };
        (inner as unknown as { __wrapped?: boolean }).__wrapped = true;
        clearInterval(t);
      }, 0);
    });
    await page.goto("/");
    await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
    if (width < 500) {
      const handle = page.getByTestId("phone-nav-handle");
      if (await handle.count()) await handle.click();
      // On a phone the plan lives in Settings > Behavior.
      await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Settings" }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).last().click();
      await page.getByRole("button", { name: /Behavior/ }).first().click();
      await expect(page.getByText("2 conversations have no home domain yet.", { exact: false })).toBeVisible({ timeout: 10_000 });
      await page.getByTestId("filing-settings").getByRole("button", { name: "Review" }).click();
    } else {
      await page.getByTestId("app-sidebar").getByRole("button", { name: "For You" }).click();
      const card = page.getByTestId("filing-card");
      await expect(card).toContainText("File 2 unfiled conversations", { timeout: 10_000 });
      await card.getByRole("button", { name: "Review" }).click();
    }
    const plan = page.getByTestId("filing-plan");
    await expect(plan).toContainText("2 skipped: incognito, local-only or Bunker Mode");
    await expect(plan.getByTestId("filing-row")).toHaveCount(2);
    // Edit the first row: drop its secondary domain. The second has no home yet.
    await plan.getByTestId("filing-row").first().getByLabel("Remove Health").click();
    await plan.getByTestId("filing-row").nth(1).getByRole("button", { name: "Finance" }).click();
    await page.screenshot({ path: `${SHOTS}/filing-plan-${width}.png`, fullPage: true });
    await plan.getByRole("button", { name: /File all 2/ }).click();
    await expect(plan.getByTestId("filing-done")).toHaveText("Filed 2 conversations");
    const sets = await calls(page, "thread_set_filing");
    expect(sets.map((s) => [s.thread, s.routed])).toEqual([[FOO, ["career"]], [BAR, ["finance"]]]);
    const file = await page.evaluate((p) => (window as unknown as { __files: Record<string, string> }).__files[p], FOO);
    expect(file).toContain("routed: career\n");
    expect(file.slice(file.indexOf("\n---\n") + 5)).toBe(`\n${BODY}`);
    expect(await invokedCommands(page)).not.toContain("save_thread");
  });
}

for (const width of [1440, 390]) {
  test(`the composer keeps context and @refs in one row; overflow folds into +N that expands in place (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    // A slow machine (the CI runner): frames land late, after the next keys.
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => { setTimeout(() => raf(cb), 120); return 0; };
    });
    await mockTauri(page, {
      scan_vault: DOMAINS,
      apps_mirror_list: {
        generated_at: 1783000000, runtimes: [],
        apps: [["notion", "Notion"], ["gmail", "Gmail"], ["foo-drive", "Foo Drive"], ["bar-sheets", "Bar Sheets"]].map(([id, name]) => ({ id, name, runtime: "claude", server: name, status: "connected", signin_hint: "", syncable: true, domains: ["career"] })),
      },
      domain_context: { state: "Foo state.", journal: "", recent_logs: [], skills: [] },
    });
    await page.goto("/");
    await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
    if (width < 500) {
      const handle = page.getByTestId("phone-nav-handle");
      if (await handle.count()) await handle.click();
      await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Domains" }).click();
      await page.locator("[data-domain=career]").click();
    } else {
      await openDomain(page, "Career");
    }
    const row = page.getByTestId("attach-row");
    await expect(row).toContainText("Career state", { timeout: 10_000 });
    const box = page.locator("[data-tour=composer] textarea").first();
    await box.click();
    await box.pressSequentially("@not");
    await page.getByTestId("ref-option-app-notion").click();
    await expect(row.getByTestId("ref-chip-app")).toContainText("@Notion");
    // Context and the @app share ONE row.
    await expect(page.getByTestId("attach-row")).toHaveCount(1);
    await expect(page.getByTestId("ref-chips")).toHaveCount(0);
    for (const [q, id] of [["@gm", "app-gmail"], ["@hea", "domain-health"], ["@fin", "domain-finance"], ["@foo", "app-foo-drive"], ["@bar", "app-bar-sheets"]]) {
      await box.pressSequentially(q);
      await page.getByTestId(`ref-option-${id}`).click();
    }
    const more = row.getByTestId("attach-more");
    await expect(more).toBeVisible();
    await expect(more).toHaveText(/^\+\d+$/);
    const rowBox = await row.boundingBox();
    await page.screenshot({ path: `${SHOTS}/composer-chips-${width}.png` });
    await more.click();
    await expect(more).toHaveCount(0);
    await expect(row.getByTestId("ref-chip-app")).toHaveCount(4);
    expect((await row.boundingBox())!.height).toBeGreaterThan(rowBox!.height);
    await page.screenshot({ path: `${SHOTS}/composer-chips-open-${width}.png` });
  });
}
