// Work mode: the Work tab, first in the header, then Chat (Council is a
// toggle in the composer). Work is focused: no sidebar, no thread rail, just
// the work bar (a Queue / Backlog switch inside it, one options button for
// Herdr and the machine) and, when it has items, one ordered queue of tasks
// (newest at the bottom) to drag or move with the keyboard, or the backlog of
// parked ideas; a task's detail has its route chip with Undo, re-route, agent
// kind and machine chips, actions per status, its question and the prompt it
// came from. Invented data only (foo names, /tmp paths, invented Macs).
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
// A parked idea: routed, never started, not in the queue.
const T7 = { ...base, id: "t7", promptId: "p7", goal: "A foo standing desk", text: "Look into a foo standing desk", dest: dest("domain", "health", "Health"), status: "backlog", executor: "engine",
  thread: { space: "health", session: "foo-7" }, prompt: { id: "p7", ts: NOW - 30_000, text: "Look into a foo standing desk someday", surface: "desktop" } };
const BACKLOG = { ok: true, view: "backlog", tasks: [T1, T2, T3, T5, T4, T6, T7] };
const MACHINES = {
  machines: [
    { id: "local", hostname: "foo-laptop", label: "foo-laptop", role: "client", current: true, herdr: "local" },
    { id: "mini-foo", hostname: "mini-foo", label: "mini-foo", role: "hub", current: false, herdr: "saved" },
    { id: "studio-foo", hostname: "studio-foo.local", label: "studio-foo", current: false, herdr: "missing" },
    { id: "air-foo", label: "air-foo", current: false, herdr: "missing" },
  ],
  agentKinds: ["claude", "codex", "gemini"],
};
const FIX = {
  engine_work_list: QUEUE,
  engine_work_machines: MACHINES,
  engine_work_settings: { ok: true, settings: { herdr: false, workspace: "foo-work", maxRunning: 3 } },
  engine_work_add: { ok: true, prompt: { id: "p9", ts: NOW, text: "Renew the foo passport", surface: "desktop", machine: "foo-laptop", tasks: [] } },
  engine_work_machine_add: { ok: true, output: "saved" }, engine_work_machine_approve: { ok: true, command: [] },
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

test("Work keeps the main sidebar and hides only the thread rail, with no extra collapse control; Chat brings the rail back", async ({ page }) => {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await mockTauri(page, FIX);
  await serveViews(page);
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("threads-list")).toBeVisible();
  await page.getByTestId("top-tab-queue").click();
  await expect(page.getByTestId("work-queue")).toBeVisible();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("threads-list")).toHaveCount(0);
  // The only collapse controls are the main sidebar's and the list column's own: nothing stray beside the Work tab.
  await expect(page.getByTestId("work-sidebar-toggle")).toHaveCount(0);
  expect(await page.getByTestId("top-tab-queue").evaluate((el) => { let p = el.previousElementSibling; while (p && !(p instanceof HTMLButtonElement)) p = p.previousElementSibling; return p?.outerHTML ?? null; })).toBeNull();
  expect(await nothingWide(page)).toEqual([]);
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
  await page.getByTestId("work-mode-backlog").click();
  await page.getByTestId("tab-done").click();
  await page.getByTestId("work-backlog-row").filter({ hasText: "Send the bar report to Sam Foo" }).click();
  await expect(detail(page).getByTestId("work-act-keep")).toBeVisible();
  await detail(page).getByTestId("work-act-close").click();
  await expect.poll(async () => (await calls(page, "engine_work_action"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t6", action: "close" });
});

test("the bar is the whole screen: a Queue / Backlog switch inside it, one options button, no pill row and no run-at-once", async ({ page }) => {
  await openWork(page);
  const bar = page.getByTestId("work-bar");
  await expect(bar.getByTestId("work-mode-queue")).toHaveAttribute("aria-checked", "true");
  await expect(bar.getByTestId("work-options")).toBeVisible();
  const input = page.getByTestId("work-input");
  await expect(input).toHaveAttribute("placeholder", "Ready for work");
  // Text and placeholder in Geist at a calm 15px, never the display serif.
  const font = await input.evaluate((el) => { const c = getComputedStyle(el); return { family: c.fontFamily, size: c.fontSize }; });
  expect(font.family).toMatch(/^"?Geist/);
  expect(font.size).toBe("15px");
  expect(await page.evaluate(() => document.fonts.check('15px "Geist"'))).toBe(true);
  // Focused, the field draws no ring of its own: the bar's edge shows focus.
  const restBorder = await page.getByTestId("work-bar").evaluate((el) => getComputedStyle(el).borderColor);
  await input.click();
  await page.keyboard.type("x");
  const ring = await input.evaluate((el) => { const c = getComputedStyle(el); return { style: c.outlineStyle, width: c.outlineWidth, shadow: c.boxShadow }; });
  expect(ring.style === "none" || ring.width === "0px").toBe(true);
  expect(ring.shadow).toBe("none");
  // The bar's own edge turns accent instead (its colour depends on the palette, so: not the resting border).
  await expect.poll(() => page.getByTestId("work-bar").evaluate((el) => getComputedStyle(el).borderColor)).not.toBe(restBorder);
  await input.fill("");
  // Herdr and the machine live in the options popover, not under the bar.
  await expect(page.getByTestId("work-herdr")).toHaveCount(0);
  await expect(page.getByTestId("work-machine")).toHaveCount(0);
  await expect(page.getByTestId("work-at-once")).toHaveCount(0);
  await expect(page.getByTestId("work-queue")).not.toContainText(/at once/i);
  expect(await nothingWide(page)).toEqual([]);
});

test("the switch decides what the list shows and what Send does: Backlog parks the prompt with hold", async ({ page }) => {
  await openWork(page);
  await page.getByTestId("work-mode-backlog").click();
  await expect(page.getByTestId("work-input")).toHaveAttribute("placeholder", "Park an idea for later");
  await expect(page.getByTestId("work-queue-row")).toHaveCount(0);
  await expect(page.getByTestId("spine-meta")).toHaveText("1 idea");
  await expect(page.getByTestId("work-backlog-row")).toHaveCount(1);
  await expect(page.getByTestId("work-backlog-row").first()).toContainText("Look into a foo standing desk");
  await page.getByTestId("work-input").fill("Try the bar budgeting app someday");
  await page.getByTestId("work-send").click();
  await expect.poll(async () => (await calls(page, "engine_work_add"))[0]?.body).toEqual({ text: "Try the bar budgeting app someday", surface: "desktop", machine: "foo-laptop", hold: true });
  // Remembered on this device.
  expect(await page.evaluate(() => localStorage.getItem("prevail.work.mode"))).toBe("backlog");
  // Move to queue: from the row, and from the detail.
  const idea = page.locator("[data-testid=work-backlog-row][data-id=t7]");
  await idea.hover();
  await idea.getByTestId("work-backlog-to-queue").click();
  await expect.poll(async () => (await calls(page, "engine_work_action"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t7", action: "start" });
  await idea.getByText("Look into a foo standing desk").click();
  await expect(detail(page).getByTestId("work-act-start")).toHaveText("Move to queue");
  // Back to Queue: Send starts work again, without hold.
  await page.getByTestId("work-mode-queue").click();
  await expect(page.getByTestId("work-queue-row")).toHaveCount(5);
  await page.getByTestId("work-input").fill("Renew the foo passport");
  await page.getByTestId("work-input").press("Enter");
  await expect.poll(async () => (await calls(page, "engine_work_add"))[1]?.body).toEqual({ text: "Renew the foo passport", surface: "desktop", machine: "foo-laptop" });
});

test("the options popover holds the Herdr switch and the machine as a dropdown; the button shows what is not default", async ({ page }) => {
  await openWork(page);
  await expect(page.getByTestId("work-options-herdr")).toHaveCount(0);
  await expect(page.getByTestId("work-options-machine")).toHaveCount(0);
  await page.getByTestId("work-options").click();
  const panel = page.getByTestId("work-options-panel");
  await expect(panel.getByTestId("work-herdr")).toHaveAttribute("aria-checked", "false");
  await expect(panel.locator("img[src='/herdr.png']").first()).toBeVisible();
  await panel.getByTestId("work-herdr").click();
  await expect.poll(async () => (await calls(page, "engine_work_settings")).find((a) => "herdr" in a)).toEqual({ vault: "/tmp/smoke-vault", herdr: true });
  await expect(panel.getByTestId("work-herdr")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("work-options-herdr")).toBeVisible();
  // The machine: a labelled field with its icon, name, state and a chevron; its menu lists every Mac.
  const field = panel.getByTestId("work-machine");
  await expect(field).toContainText("foo-laptop");
  await expect(field).toContainText("This Mac");
  await field.click();
  const opts = panel.getByTestId("work-machine-option");
  await expect(opts).toHaveCount(4);
  await expect(opts.filter({ hasText: "mini-foo" })).toContainText("Connected");
  await expect(opts.filter({ hasText: "studio-foo" })).toContainText("Not connected");
  await expect(opts.filter({ hasText: "studio-foo" }).getByTestId("work-machine-connect")).toBeVisible();
  await opts.filter({ hasText: "mini-foo" }).click();
  await expect(field).toContainText("mini-foo");
  await expect(page.getByTestId("work-options-machine")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("prevail.work.machine"))).toBe("mini-foo");
  expect(await nothingWide(page)).toEqual([]);
  // Escape closes it; the indicators stay.
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("work-options-herdr")).toBeVisible();
});

test("Settings > Work sets how many tasks run at once (1 to 10, default 3)", async ({ page }) => {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await mockTauri(page, FIX);
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "general" })));
  await page.getByTestId("hub-row-work").click();
  const pick = page.getByTestId("settings-work-max-running");
  await expect(pick).toHaveValue("3");
  await expect(pick.locator("option")).toHaveCount(10);
  await pick.selectOption("5");
  await expect.poll(async () => (await calls(page, "engine_work_settings")).find((a) => "maxRunning" in a)).toEqual({ vault: "/tmp/smoke-vault", maxRunning: 5 });
});

test("connecting a machine is one click: a known address runs behind the scenes, an unknown one is asked for", async ({ page }) => {
  await openWork(page);
  await page.getByTestId("work-options").click();
  const panel = page.getByTestId("work-options-panel");
  await panel.getByTestId("work-machine").click();
  await panel.getByTestId("work-machine-option").filter({ hasText: "studio-foo" }).getByTestId("work-machine-connect").click();
  // Known address: nothing to copy or type, it just connects.
  await expect.poll(async () => (await calls(page, "engine_work_machine_add"))[0]).toEqual({ vault: "/tmp/smoke-vault", label: "studio-foo", target: "studio-foo.local" });
  await expect(page.getByTestId("work-machine-add")).toHaveCount(0);
  // No address on record: one short question, then Connect.
  await panel.getByTestId("work-machine").click();
  await panel.getByTestId("work-machine-option").filter({ hasText: "air-foo" }).getByTestId("work-machine-connect").click();
  const add = page.getByTestId("work-machine-add");
  await expect(add).toContainText("Where is air-foo?");
  await expect(add.getByTestId("work-machine-add-confirm")).toBeDisabled();
  await add.getByLabel("Machine address").fill("air-foo.local");
  await add.getByTestId("work-machine-add-confirm").click();
  await expect.poll(async () => (await calls(page, "engine_work_machine_add"))[1]).toEqual({ vault: "/tmp/smoke-vault", label: "air-foo", target: "air-foo.local" });
});

test("a Mac whose Herdr needs an update: a plain sentence, Approve in Terminal, then Check again", async ({ page }) => {
  await openWork(page, {
    engine_work_machine_add: { ok: false, needsApproval: true, label: "studio-foo", target: "studio-foo.local", command: ["/tmp/foo/herdr", "machine", "add", "--label", "studio-foo", "studio-foo.local"], error: "studio-foo needs a Herdr update" },
    engine_work_machine_approve: { ok: true, command: ["/tmp/foo/herdr", "machine", "add", "--label", "studio-foo", "studio-foo.local"] },
  });
  await page.getByTestId("work-options").click();
  const panel = page.getByTestId("work-options-panel");
  await panel.getByTestId("work-machine").click();
  await panel.getByTestId("work-machine-option").filter({ hasText: "studio-foo" }).getByTestId("work-machine-connect").click();
  const add = page.getByTestId("work-machine-add");
  await expect(add).toContainText("studio-foo needs a Herdr update on that Mac first. Approving restarts Herdr there.");
  await expect(add).not.toContainText("{");
  await add.getByTestId("work-machine-approve").click();
  await expect.poll(async () => (await calls(page, "engine_work_machine_approve"))[0]).toEqual({ vault: "/tmp/smoke-vault", label: "studio-foo", target: "studio-foo.local" });
  await expect(add.getByTestId("work-machine-recheck")).toBeVisible();
  await add.getByTestId("work-machine-recheck").click();
  await expect.poll(async () => (await calls(page, "engine_work_machine_add")).length).toBe(2);
  expect(await nothingWide(page)).toEqual([]);
});

test("an engine error is one plain sentence, never raw JSON; the details sit behind a disclosure", async ({ page }) => {
  await openWork(page);
  await page.evaluate(() => {
    const fx = (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures;
    fx.engine_work_action = () => Promise.reject(new Error('prevail exited 1: {"ok":false,"error":"t1 is not in the queue"}'));
  });
  await detail(page).getByTestId("work-act-pause").click();
  const e = page.getByTestId("work-error");
  await expect(e).toContainText("That task is no longer in the queue.");
  await expect(e.locator("summary")).toHaveText("Details");
  await expect(e.locator("> span")).not.toContainText("{");
});

test("an empty queue is the bar and a small living face: no list header, no text under it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockTauri(page, { ...FIX, engine_work_list: { ok: true, view: "queue", tasks: [], prompts: [], maxRunning: 3 } });
  await page.goto("/");
  await page.getByTestId("top-tab-queue").click({ timeout: 15_000 });
  const face = page.getByTestId("work-ready");
  await expect(face).toBeVisible();
  await expect(face).toHaveText("");
  await expect(face.locator("svg .wf-eyes")).toHaveCount(1);
  await expect(page.getByTestId("work-spine")).toHaveCount(0);
  await expect(page.getByText("Send a prompt")).toHaveCount(0);
  await expect(page.getByTestId("work-input")).toHaveAttribute("placeholder", "Ready for work");
  expect(await nothingWide(page)).toEqual([]);
});

test("the queue column resizes by dragging its edge or with the arrow keys, and keeps its width after a reload", async ({ page }) => {
  await openWork(page);
  const col = page.getByTestId("work-spine");
  const handle = page.getByTestId("spine-resize");
  await expect(handle).toHaveAttribute("role", "separator");
  await expect(handle).toHaveAttribute("aria-orientation", "vertical");
  const w0 = (await col.boundingBox())!.width;
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + 200);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 120, h.y + 200, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await col.boundingBox())!.width)).toBe(Math.round(w0 + 120));
  // The keyboard: Left narrows it by 16px.
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => Math.round((await col.boundingBox())!.width)).toBe(Math.round(w0 + 104));
  await expect(handle).toHaveAttribute("aria-valuenow", String(Math.round(w0 + 104)));
  await page.reload();
  await page.getByTestId("top-tab-queue").click({ timeout: 15_000 });
  await expect.poll(async () => Math.round((await page.getByTestId("work-spine").boundingBox())!.width)).toBe(Math.round(w0 + 104));
  // Never wider than 60% of the window, and nothing reaches past it.
  const h2 = (await page.getByTestId("spine-resize").boundingBox())!;
  await page.mouse.move(h2.x + 2, h2.y + 200);
  await page.mouse.down();
  await page.mouse.move(1400, h2.y + 200, { steps: 6 });
  await page.mouse.up();
  // At most 60% of the window, and the detail keeps room beside it.
  const wMax = Math.round((await page.getByTestId("work-spine").boundingBox())!.width);
  expect(wMax).toBeLessThanOrEqual(Math.round(1440 * 0.6));
  expect(wMax).toBeGreaterThan(w0 + 104);
  expect((await page.getByTestId("spine-detail").boundingBox())!.width).toBeGreaterThanOrEqual(350);
  expect(await nothingWide(page)).toEqual([]);
  // A double-click puts it back.
  await page.getByTestId("spine-resize").dblclick();
  await expect.poll(async () => Math.round((await page.getByTestId("work-spine").boundingBox())!.width)).toBe(Math.round(w0));
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
  test(`Work tab shots, empty · ${theme}`, async ({ page }) => {
    test.skip(!SHOTS, "set WORK_SHOTS=<dir> to capture the Work tab");
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockTauri(page, { ...FIX, ui_settings_get: JSON.stringify({ theme }), engine_work_list: { ok: true, view: "queue", tasks: [], prompts: [], maxRunning: 3 } });
    await page.goto("/");
    await page.getByTestId("top-tab-queue").click({ timeout: 15_000 });
    await expect(page.getByTestId("work-ready")).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/work-empty-${theme}-1440.png` });
  });
  test(`Work tab shots, tasks · ${theme}`, async ({ page }) => {
    test.skip(!SHOTS, "set WORK_SHOTS=<dir> to capture the Work tab");
    await openWork(page, { ui_settings_get: JSON.stringify({ theme }) });
    await expect(page.getByTestId("work-queue-row")).toHaveCount(5);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/work-queue-${theme}-1440.png` });
    await page.getByTestId("work-options").click();
    await page.getByTestId("work-options-panel").getByTestId("work-machine").click();
    await expect(page.getByTestId("work-machine-menu")).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/work-options-${theme}-1440.png` });
    await page.keyboard.press("Escape");
    await page.getByTestId("work-mode-backlog").click();
    await expect(page.getByTestId("work-backlog-row").first()).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/work-backlog-${theme}-1440.png` });
  });
}
