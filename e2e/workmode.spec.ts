// Work mode: the Work tab, first in the header, then Chat (Council is a
// toggle in the composer). Work is focused: no sidebar, no thread rail, one
// ordered queue of tasks (newest at the bottom) to drag or move with the
// keyboard; a task's detail has its route chip with Undo, re-route, agent kind
// and machine chips, actions per status, its question and the prompt it came
// from. Invented data only (foo names, /tmp paths, invented Macs).
// With WORK_SHOTS=<dir>, the tab is captured light and dark at 1440.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const NOW = Date.now();
const dest = (kind: string, id: string, label: string, owner = id) => ({ kind, id, label, space: owner, owner, confidence: 0.9, why: "named in the prompt" });
const base = { alternatives: [], specialists: [], shape: "task", flags: {}, effort: "standard", agentKind: "claude", machine: "foo-laptop", suggestions: [], log: [] };
const P1 = { id: "p1", ts: NOW - 120_000, text: "Plan the foo hike this weekend, and get the bar report to Sam Foo before Friday", surface: "desktop" };
const P2 = { id: "p2", ts: NOW - 60_000, text: "Fix the foo gutter before the rain", surface: "phone" };
const T1 = { ...base, id: "t1", promptId: "p1", goal: "Plan the foo hike", text: "Book the foo hike permit for Saturday", dest: dest("domain", "health", "Health"),
  alternatives: [dest("project", "foo-hike", "Foo hike")], specialists: ["planner", "scout"], status: "running", executor: "engine",
  thread: { space: "health", session: "foo-1" }, log: [{ ts: NOW - 110_000, ev: "routed", detail: "Health" }, { ts: NOW - 100_000, ev: "started" }], prompt: P1 };
const T2 = { ...base, id: "t2", promptId: "p1", goal: "Plan the foo hike", text: "Check the trail weather and pack list", dest: dest("domain", "health", "Health"), status: "needs-you", executor: "engine",
  thread: { space: "health", session: "foo-2" }, ask: { kind: "start", detail: "Over your limit of $1 and 10 minutes. Start it?" }, prompt: P1 };
const T3 = { ...base, id: "t3", promptId: "p1", goal: "Send the bar report", text: "Draft the bar report for Sam Foo", dest: dest("project", "bar-app", "Bar app", "career"),
  specialists: ["writer"], agentKind: "codex", status: "running", executor: "herdr", thread: { space: "_mission-bar-app", session: "foo-3" },
  herdr: { machine: "local", workspaceLabel: "foo-reports", tabId: "w1:t2", lastRead: "Drafted the bar report.\nSaved to the Bar app project notes.\n" + "\u2500".repeat(400) + "\n/tmp/foo/" + "bar".repeat(120) },
  log: [{ ts: NOW - 90_000, ev: "asks", detail: "the agent in its Herdr tab is waiting for an answer there (it may be asking whether to trust the folder); answer it in Herdr, then Start" }],
  suggestions: [{ kind: "entity", name: "Sam Foo", why: "Named in the prompt, not in your people yet", state: "open" },
    { kind: "domain", name: "foo notes folder path", why: "User said 'this folder' but no path was provided for the foo notes", state: "open" }], prompt: P1 };
const T5 = { ...base, id: "t5", promptId: "p2", goal: "Fix the foo gutter", text: "Order the foo gutter brackets", dest: dest("domain", "career", "Career"), status: "queued", executor: "engine",
  thread: { space: "career", session: "foo-5" }, prompt: P2 };
const T4 = { ...base, id: "t4", promptId: "p2", goal: "Fix the foo gutter", text: "Find a foo gutter repair crew", dest: dest("domain", "career", "Career"), status: "paused", executor: "herdr",
  machine: "mini-foo", thread: { space: "career", session: "foo-4" }, herdr: { machine: "mini-foo", workspaceLabel: "foo-home" }, lease: { host: "mini-foo", until: NOW + 120_000 }, prompt: P2 };
const T6 = { ...base, id: "t6", promptId: "p0", goal: "Send the bar report", text: "Send the bar report to Sam Foo", dest: dest("project", "bar-app", "Bar app", "career"),
  agentKind: "codex", status: "done", executor: "herdr", thread: { space: "_mission-bar-app", session: "foo-6" },
  herdr: { machine: "local", workspaceLabel: "foo-reports", tabId: "w1:t3", lastRead: "Sent.\n" }, prompt: { id: "p0", ts: NOW - 7_200_000, text: "Send the bar report", surface: "cli" } };
// The queue, in the engine's order: first runs first, newest at the bottom.
const QUEUE = { ok: true, view: "queue", maxRunning: 3, tasks: [T1, T2, T3, T5, T4] };
const BACKLOG = { ok: true, view: "backlog", tasks: [T1, T2, T3, T5, T4, T6] };
const MACHINES = {
  machines: [
    { id: "local", hostname: "foo-laptop", label: "foo-laptop", role: "client", current: true, herdr: "local" },
    { id: "mini-foo", hostname: "mini-foo", label: "mini-foo", role: "hub", current: false, herdr: "saved" },
    { id: "studio-foo", hostname: "studio-foo.local", label: "studio-foo", current: false, herdr: "missing" },
  ],
  agentKinds: ["claude", "codex", "gemini"],
};
const FIX = {
  engine_work_list: QUEUE,
  engine_work_machines: MACHINES,
  engine_work_settings: { ok: true, settings: { herdr: false, workspace: "foo-work", maxRunning: 3 } },
  engine_work_add: { ok: true, prompt: { id: "p9", ts: NOW, text: "Renew the foo passport", surface: "desktop", machine: "foo-laptop", tasks: [] } },
  engine_work_route: { ok: true }, engine_work_action: { ok: true }, engine_work_answer: { ok: true }, engine_work_reorder: { ok: true, order: [] },
  scan_vault: ["career", "health"].map((name) => ({ name, path: `/tmp/smoke-vault/data/domains/${name}`, has_state: true, state_preview: null })),
};

const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? [])
    .filter((e) => e.cmd === c).map((e) => e.args), cmd);

// The list answers by view: the ordered queue, or with `all` the backlog.
async function serveViews(page: Page) {
  await page.addInitScript(([q, b]) => {
    const fx = (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures;
    fx.__queue = q;
    fx.engine_work_list = (a: { all?: boolean } | undefined) => (a?.all ? b : fx.__queue);
  }, [QUEUE, BACKLOG] as const);
}

async function openWork(page: Page, extra: Record<string, unknown> = {}, width = 1440) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: 900 });
  await mockTauri(page, { ...FIX, ...extra });
  await serveViews(page);
  await page.goto("/");
  await page.getByTestId("top-tab-queue").click({ timeout: 15_000 });
}
const detail = (page: Page) => page.getByTestId("work-task");
const row = (page: Page, id: string) => page.locator(`[data-testid=work-queue-row][data-id=${id}]`);
const rowIds = (page: Page) => page.getByTestId("work-queue-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));

/** Nothing in the Work tab may reach past the window or widen its column. */
async function nothingWide(page: Page): Promise<string[]> {
  return page.getByTestId("work-queue").evaluate((root) => {
    const out: string[] = [];
    for (let el: Element | null = root; el; el = el.parentElement) if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "auto") out.push(`${el.tagName}.${el.getAttribute("data-testid") ?? ""} ${el.scrollWidth}>${el.clientWidth}`);
    root.querySelectorAll("*").forEach((el) => { if (el.getBoundingClientRect().right > window.innerWidth + 1 && !el.closest("pre")) out.push(`${el.tagName}.${el.getAttribute("data-testid") ?? ""} right=${Math.round(el.getBoundingClientRect().right)}`); });
    return out.slice(0, 8);
  });
}

test("the header shows Work, then Chat, and no Council tab", async ({ page }) => {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await mockTauri(page, FIX);
  await page.goto("/");
  const tabs = page.locator("[data-testid^=top-tab-]");
  await expect(tabs).toHaveText(["Work", "Chat"], { timeout: 15_000 });
  await expect(page.getByTestId("top-tab-council")).toHaveCount(0);
});

test("the Council toggle in the composer switches the conversation to the council and back", async ({ page }) => {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await mockTauri(page, FIX);
  await page.goto("/");
  // The council stays mounted (hidden) once opened, so the toggle that counts is the visible one.
  const toggle = page.locator("[data-testid=council-toggle]:visible");
  await expect(toggle).toHaveAttribute("aria-pressed", "false", { timeout: 15_000 });
  await expect(page.getByTestId("council-picker")).toHaveCount(0);
  await toggle.click();
  await expect(page.getByTestId("council-picker")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  // Chat stays the highlighted tab: the council is a way of answering it.
  await expect(page.getByTestId("top-tab-chat")).toHaveClass(/bg-accent/);
  expect(await page.evaluate(() => localStorage.getItem("prevail.chat.council"))).toBe("1");
  // Leaving for Work and coming back keeps the council on.
  await page.getByTestId("top-tab-queue").click();
  await page.getByTestId("top-tab-chat").click();
  await expect(page.getByTestId("council-picker")).toBeVisible();
  await toggle.click();
  await expect(page.getByTestId("council-picker")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => localStorage.getItem("prevail.chat.council"))).toBe("0");
});

test("Work hides the sidebar and the thread rail; Chat brings them back; one control shows the sidebar in Work", async ({ page }) => {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await mockTauri(page, FIX);
  await serveViews(page);
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("threads-list")).toBeVisible();
  await page.getByTestId("top-tab-queue").click();
  await expect(page.getByTestId("work-queue")).toBeVisible();
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("threads-list")).toHaveCount(0);
  await page.getByTestId("work-sidebar-toggle").click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await page.getByTestId("work-sidebar-toggle").click();
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  await page.getByTestId("top-tab-chat").click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("threads-list")).toBeVisible();
});

test("the queue is one ordered list of tasks with status, destination, agent and machine", async ({ page }) => {
  await openWork(page);
  await expect.poll(() => rowIds(page)).toEqual(["t1", "t2", "t3", "t5", "t4"]);
  await expect(row(page, "t1")).toContainText("Running · Health · claude · foo-laptop");
  await expect(row(page, "t5")).toContainText("Queued · Career");
  await expect(row(page, "t2")).toContainText("Needs you");
  await expect(row(page, "t4")).toContainText("Paused · Career · claude · mini-foo");
  await expect(page.getByTestId("spine-meta")).toHaveText("5 tasks · 2 running · 1 queued · 1 needs you · 1 paused");
  // The first task shows in the detail, with the prompt it came from.
  await expect(detail(page)).toContainText("Book the foo hike permit for Saturday");
  await expect(page.getByTestId("work-from-prompt")).toContainText("Plan the foo hike this weekend");
  await expect(page.getByTestId("work-sibling")).toHaveCount(3);
  await row(page, "t5").getByText("Order the foo gutter brackets").click();
  await expect(detail(page)).toHaveAttribute("data-status", "queued");
  await expect(detail(page).getByTestId("work-act-pause")).toBeVisible();
  expect(await nothingWide(page)).toEqual([]);
});

test("dragging a row by its grip reorders the queue through the engine", async ({ page }) => {
  await openWork(page);
  const grip = row(page, "t5").getByTestId("work-drag");
  await row(page, "t5").hover();
  const g = (await grip.boundingBox())!;
  const top = (await row(page, "t1").boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, top.y + 4, { steps: 8 });
  await expect(page.getByTestId("work-drop-indicator")).toHaveCount(1);
  // The engine answers the next list in the new order.
  await page.evaluate(() => { const fx = (window as unknown as { __fixtures: { __queue: { tasks: { id: string }[] } } }).__fixtures; const t = fx.__queue.tasks; fx.__queue = { ...fx.__queue, tasks: [t[3]!, ...t.filter((x) => x.id !== "t5")] }; });
  await page.mouse.up();
  await expect(page.getByTestId("work-drop-indicator")).toHaveCount(0);
  await expect.poll(async () => (await calls(page, "engine_work_reorder"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t5", before: "t1" });
  await expect.poll(async () => (await rowIds(page)).slice(0, 2)).toEqual(["t5", "t1"]);
});

test("the keyboard moves a row too: Alt+Arrow and the row menu", async ({ page }) => {
  await openWork(page);
  await row(page, "t1").getByRole("button", { name: /^Book the foo hike permit/ }).focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(async () => (await calls(page, "engine_work_reorder"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t1", before: "t3" });
  await page.evaluate(() => { (window as unknown as { __invokeLog: unknown[] }).__invokeLog.length = 0; });
  await row(page, "t4").hover();
  await row(page, "t4").getByTestId("work-row-menu").click();
  await page.getByRole("menuitem", { name: "Move to top" }).click();
  await expect.poll(async () => (await calls(page, "engine_work_reorder"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t4", before: "t1" });
});

test("a new task appears at the bottom of the queue", async ({ page }) => {
  await openWork(page);
  const T9 = { ...T5, id: "t9", promptId: "p9", text: "Renew the foo passport", status: "running", prompt: { id: "p9", ts: NOW, text: "Renew the foo passport", surface: "desktop" } };
  await page.evaluate((t9) => { const fx = (window as unknown as { __fixtures: { __queue: { tasks: unknown[] } } }).__fixtures; fx.__queue = { ...fx.__queue, tasks: [...fx.__queue.tasks, t9] }; }, T9);
  await page.getByTestId("work-input").fill("Renew the foo passport");
  await page.getByTestId("work-send").click();
  await expect.poll(async () => (await rowIds(page)).at(-1)).toBe("t9");
  await expect(row(page, "t9")).toContainText("Renew the foo passport");
});

test("Send fires the prompt and clears the box at once; Enter sends too", async ({ page }) => {
  await openWork(page);
  const box = page.getByTestId("work-input");
  await box.fill("Renew the foo passport");
  await page.getByTestId("work-send").click();
  await expect(box).toHaveValue("");
  await expect.poll(async () => ((await calls(page, "engine_work_add"))[0]?.body as { text?: string })?.text).toBe("Renew the foo passport");
  await box.fill("Call the bar plumber");
  await box.press("Enter");
  await expect(box).toHaveValue("");
  await expect.poll(async () => ((await calls(page, "engine_work_add"))[1]?.body as { text?: string })?.text).toBe("Call the bar plumber");
});

test("route chip with Undo, re-route by machine, Pause, and suggestions", async ({ page }) => {
  await openWork(page);
  await expect(detail(page).getByTestId("work-route")).toContainText("Health");
  await detail(page).getByTestId("work-route-undo").click();
  await expect.poll(async () => (await calls(page, "engine_work_route"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t1", undo: true });
  await detail(page).getByTestId("work-task-machine").click();
  await page.getByRole("menuitem", { name: /mini-foo/ }).click();
  await expect.poll(async () => (await calls(page, "engine_work_route"))[1]).toEqual({ vault: "/tmp/smoke-vault", id: "t1", machine: "mini-foo" });
  await detail(page).getByTestId("work-agent").click();
  await page.getByRole("menuitem", { name: "gemini" }).click();
  await expect.poll(async () => (await calls(page, "engine_work_route"))[2]).toEqual({ vault: "/tmp/smoke-vault", id: "t1", agentKind: "gemini" });
  await detail(page).getByTestId("work-act-pause").click();
  await expect.poll(async () => (await calls(page, "engine_work_action"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t1", action: "pause" });
  await row(page, "t2").getByText("Check the trail weather").click();
  await expect(detail(page).getByTestId("work-ask")).toContainText("Over your limit");
  await detail(page).getByTestId("work-answer-yes").click();
  await expect.poll(async () => (await calls(page, "engine_work_answer"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t2", answer: "yes" });
  await row(page, "t3").getByText("Draft the bar report").click();
  await detail(page).getByTestId("work-suggest-accept").first().click();
  await expect.poll(async () => (await calls(page, "engine_work_action"))[1]).toEqual({ vault: "/tmp/smoke-vault", id: "t3", action: "accept", n: 1 });
});

test("a Herdr task shows its mirrored output without widening the tab", async ({ page }) => {
  await openWork(page);
  await row(page, "t3").getByText("Draft the bar report").click();
  await expect(detail(page)).toHaveAttribute("data-executor", "herdr");
  await expect(detail(page).getByTestId("work-herdr-output")).toContainText("Drafted the bar report.");
  // A long unbroken line (terminal rule, long path) must wrap inside the box, never widen the page.
  expect(await nothingWide(page)).toEqual([]);
});

test("done tasks leave the queue; the backlog keeps them, with Keep and Close for a Herdr one", async ({ page }) => {
  await openWork(page);
  await expect(row(page, "t6")).toHaveCount(0);
  await page.getByTestId("tab-backlog").click();
  await page.getByTestId("tab-done").click();
  await page.getByTestId("work-backlog-row").filter({ hasText: "Send the bar report to Sam Foo" }).click();
  await expect(detail(page).getByTestId("work-act-keep")).toBeVisible();
  await detail(page).getByTestId("work-act-close").click();
  await expect.poll(async () => (await calls(page, "engine_work_action"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t6", action: "close" });
});

test("the Herdr toggle and the run-at-once cap go to the engine's settings", async ({ page }) => {
  await openWork(page);
  await page.getByTestId("work-herdr").click();
  await expect.poll(async () => (await calls(page, "engine_work_settings")).find((a) => "herdr" in a)).toEqual({ vault: "/tmp/smoke-vault", herdr: true });
  await expect(page.getByTestId("work-herdr")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("work-at-once")).toContainText("3 at once");
  await page.getByTestId("work-at-once").click();
  await page.getByRole("menuitem", { name: "5" }).click();
  await expect.poll(async () => (await calls(page, "engine_work_settings")).find((a) => "maxRunning" in a)).toEqual({ vault: "/tmp/smoke-vault", maxRunning: 5 });
});

test("a machine that is not connected shows the Add prompt with the command to confirm", async ({ page }) => {
  await openWork(page);
  await page.getByTestId("work-machine").click();
  await page.getByRole("menuitem", { name: /Connect studio-foo/ }).click();
  const add = page.getByTestId("work-machine-add");
  await expect(add).toContainText("studio-foo is not connected to Herdr");
  await expect(add.getByTestId("work-machine-add-command")).toHaveText("herdr machine add --label studio-foo studio-foo.local");
  await expect(add.getByTestId("work-machine-add-confirm")).toBeDisabled();
  await add.getByLabel("SSH target").fill("foo@studio-foo.local");
  await expect(add.getByTestId("work-machine-add-command")).toHaveText("herdr machine add --label studio-foo foo@studio-foo.local");
  await add.getByTestId("work-machine-add-confirm").click();
  await expect.poll(async () => (await calls(page, "engine_work_machine_add"))[0]).toEqual({ vault: "/tmp/smoke-vault", label: "studio-foo", target: "foo@studio-foo.local" });
});

test("a task held by another Mac offers Continue here, asking first while that lease is live", async ({ page }) => {
  await openWork(page);
  await row(page, "t4").getByText("Find a foo gutter repair crew").click();
  await page.getByTestId("work-continue-here").click();
  await page.getByRole("button", { name: "Yes" }).click();
  await expect.poll(async () => (await calls(page, "engine_work_action"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t4", action: "continue-here" });
});

test("an older engine's queue of prompts still shows, oldest first", async ({ page }) => {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  const strip = (t: Record<string, unknown>) => { const { prompt: _p, ...x } = t; return x; };
  await mockTauri(page, { ...FIX, engine_work_list: { ok: true, view: "queue", prompts: [
    { ...P2, machine: "foo-laptop", tasks: [T5, T4].map(strip) }, { ...P1, machine: "foo-laptop", tasks: [T1, T2, T3].map(strip) },
  ] } });
  await page.goto("/");
  await page.getByTestId("top-tab-queue").click({ timeout: 15_000 });
  await expect.poll(() => rowIds(page)).toEqual(["t1", "t2", "t3", "t5", "t4"]);
});

test("an engine without work shows the update state, not an error", async ({ page }) => {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await mockTauri(page, FIX);
  await page.addInitScript(() => {
    const fx = (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures;
    fx.engine_work_list = () => Promise.reject(new Error("prevail exited 1: unknown command: work"));
  });
  await page.goto("/");
  await page.getByTestId("top-tab-queue").click({ timeout: 15_000 });
  await expect(page.getByTestId("work-too-old")).toContainText("Update the engine to use Work mode");
  await expect(page.getByTestId("work-error")).toHaveCount(0);
});

const SHOTS = process.env.WORK_SHOTS;
for (const theme of ["light", "dark"]) {
  test(`Work tab shots · ${theme}`, async ({ page }) => {
    test.skip(!SHOTS, "set WORK_SHOTS=<dir> to capture the Work tab");
    await openWork(page, { ui_settings_get: JSON.stringify({ theme }) });
    await expect(page.getByTestId("work-queue-row")).toHaveCount(5);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/work-${theme}-1440.png` });
    // A drag in progress: the grabbed row dims and a line shows where it lands.
    await row(page, "t4").hover();
    const g = (await row(page, "t4").getByTestId("work-drag").boundingBox())!;
    const t2 = (await row(page, "t2").boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, t2.y + 4, { steps: 8 });
    await expect(page.getByTestId("work-drop-indicator")).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}/work-drag-${theme}-1440.png` });
    await page.mouse.up();
    await page.getByTestId("tab-backlog").click();
    await expect(page.getByTestId("work-backlog-row").first()).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/work-backlog-${theme}-1440.png` });
    // Chat with the Council toggle off, then on.
    await page.getByTestId("top-tab-chat").click();
    const toggle = page.locator("[data-testid=council-toggle]:visible");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/chat-council-off-${theme}-1440.png` });
    await toggle.click();
    await expect(page.getByTestId("council-picker")).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/chat-council-on-${theme}-1440.png` });
  });
}
