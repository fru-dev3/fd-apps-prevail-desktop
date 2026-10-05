// Work mode: the Work tab, first in the header, then Chat (Council is a
// toggle in the composer). Work keeps the main sidebar and hides only the
// thread rail. The queue fills the screen (check box, short name, one meta
// line with icons, a spinner while it is worked); the item panel is collapsed
// to the right by default and opens on a row click: status, where it went,
// who is on it, what it already knows, outcome, plain activity, Open in Herdr
// and "Follow up or clarify". Never agent output, never a Start / Keep /
// Create question. Invented data only (foo names, /tmp paths, invented Macs).
// With WORK_SHOTS=<dir>, the tab is captured light and dark at 1440.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const NOW = Date.now();
const dest = (kind: string, id: string, label: string, owner = id) => ({ kind, id, label, space: owner, owner, confidence: 0.9, why: "the router named nothing that exists" });
const base = { alternatives: [], specialists: [], shape: "task", flags: {}, effort: "standard", agentKind: "claude", machine: "foo-laptop", suggestions: [], log: [] };
const P1 = { id: "p1", ts: NOW - 120_000, text: "Plan the foo hike this weekend, and get the bar report to Sam Foo before Friday", surface: "desktop" };
const P2 = { id: "p2", ts: NOW - 60_000, text: "Fix the foo gutter before the rain", surface: "phone" };
const T1 = { ...base, id: "t1", promptId: "p1", goal: "Plan the foo hike", name: "Hike Permit", text: "Book the foo hike permit for Saturday", dest: dest("domain", "health", "Health"),
  alternatives: [dest("project", "foo-hike", "Foo hike")], specialists: ["planner", "scout"], status: "running", executor: "engine",
  context: [{ label: "Your home city, from your profile", text: "The user's home city: Fooville." }],
  thread: { space: "health", session: "foo-1" }, prompt: P1,
  log: [{ ts: NOW - 110_000, ev: "routed", detail: "domain Health: the router named nothing that exists" }, { ts: NOW - 105_000, ev: "guard", detail: "Your rules apply: nothing is paid or bought." },
    { ts: NOW - 100_000, ev: "started", detail: "the engine runs it" }, { ts: NOW - 90_000, ev: "activity", detail: "Searching the web", more: "WebSearch(foo hike permits Saturday)" }] };
const T2 = { ...base, id: "t2", promptId: "p1", goal: "Plan the foo hike", name: "Trail Weather", text: "Check the trail weather and pack list", dest: dest("domain", "health", "Health"), status: "needs-you", executor: "herdr",
  thread: { space: "health", session: "foo-2" }, waiting: "Which trailhead, north or south?", herdr: { machine: "foo-laptop", workspaceLabel: "Health", tabId: "w1:t1", paneId: "w1:p1", agent: "w1:p1" },
  log: [{ ts: NOW - 80_000, ev: "in Herdr", detail: "Health on foo-laptop" }, { ts: NOW - 70_000, ev: "waiting", detail: "Which trailhead, north or south?" }], prompt: P1 };
const T3 = { ...base, id: "t3", promptId: "p1", goal: "Send the bar report", name: "Bar Report", text: "Draft the bar report for Sam Foo", dest: dest("project", "bar-app", "Bar app", "career"),
  specialists: ["writer"], agentKind: "codex", status: "running", executor: "herdr", thread: { space: "_mission-bar-app", session: "foo-3" },
  herdr: { machine: "foo-laptop", workspaceLabel: "Bar app", workspaceId: "w1", tabId: "w1:t2", paneId: "w1:p2", agent: "w1:p2", glyph: true, lastRead: "Drafted the bar report.\nSaved to the Bar app project notes.\n" + "\u2500".repeat(400) + "\n/tmp/foo/" + "bar".repeat(120) },
  log: [{ ts: NOW - 95_000, ev: "routed", detail: "project Bar app" }, { ts: NOW - 94_000, ev: "in Herdr", detail: "Bar app on foo-laptop" },
    { ts: NOW - 60_000, ev: "activity", detail: "Reading notes.md", more: "\u23fa Read(projects/bar-app/notes.md)" }, { ts: NOW - 50_000, ev: "activity", detail: "Drafting an email", more: "\u23fa gmail - create_draft (MCP)(to: sam@example.com)" },
    { ts: NOW - 40_000, ev: "follow-up", more: "Keep it to one page" }],
  suggestions: [{ kind: "entity", name: "Sam Foo", why: "Named in the prompt, not in your people yet", state: "open" }], prompt: P1 };
const T5 = { ...base, id: "t5", promptId: "p2", goal: "Fix the foo gutter", name: "Gutter Brackets", text: "Order the foo gutter brackets", dest: dest("domain", "career", "Career"), status: "queued", executor: "engine",
  thread: { space: "career", session: "foo-5" }, prompt: P2 };
const T4 = { ...base, id: "t4", promptId: "p2", goal: "Fix the foo gutter", name: "Gutter Crew", text: "Find a foo gutter repair crew", dest: dest("domain", "career", "Career"), status: "paused", executor: "herdr",
  machine: "mini-foo", thread: { space: "career", session: "foo-4" }, herdr: { machine: "mini-foo", workspaceLabel: "Career" }, lease: { host: "mini-foo", until: NOW + 120_000 }, prompt: P2 };
const T6 = { ...base, id: "t6", promptId: "p0", goal: "Send the bar report", name: "Bar Draft", text: "Draft the bar report email to Sam Foo", dest: dest("project", "bar-app", "Bar app", "career"),
  agentKind: "codex", status: "done", cleared: false, outcome: "Drafted the bar report email to Sam Foo; it is in your drafts, nothing was sent.", executor: "herdr", thread: { space: "_mission-bar-app", session: "foo-6" },
  specialists: ["writer"], herdr: { machine: "foo-laptop", workspaceLabel: "Bar app", tabId: "w1:t3", agent: "w1:p3", lastRead: "Sent.\n" },
  log: [{ ts: NOW - 7_100_000, ev: "in Herdr" }, { ts: NOW - 7_000_000, ev: "activity", detail: "Drafting an email" }, { ts: NOW - 6_900_000, ev: "done" }],
  prompt: { id: "p0", ts: NOW - 7_200_000, text: "Send the bar report", surface: "cli" } };
// The queue, in the engine's order: first runs first, newest at the bottom; a finished task stays checked until cleared.
const QUEUE = { ok: true, view: "queue", maxRunning: 3, tasks: [T1, T2, T3, T5, T4, T6] };
// A parked idea: routed, never started, not in the queue.
const T7 = { ...base, id: "t7", promptId: "p7", goal: "A foo standing desk", name: "Standing Desk", text: "Look into a foo standing desk", dest: dest("domain", "health", "Health"), status: "backlog", executor: "engine",
  thread: { space: "health", session: "foo-7" }, prompt: { id: "p7", ts: NOW - 30_000, text: "Look into a foo standing desk someday", surface: "desktop" } };
const BACKLOG = { ok: true, view: "backlog", tasks: [T1, T2, T3, T5, T4, { ...T6, cleared: true }, T7] };
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
  engine_work_route: { ok: true }, engine_work_action: { ok: true }, engine_work_answer: { ok: true }, engine_work_reorder: { ok: true, order: [] }, engine_work_followup: { ok: true },
  chief_of_staff_read: "---\nname: Ben\n---\n",
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
const panel = (page: Page) => page.getByTestId("work-panel");
/** Open a task's panel by clicking its row. */
const openRow = (page: Page, id: string) => row(page, id).getByTestId("work-row-meta").click();
const menuItem = (page: Page, name: string | RegExp) => page.getByRole("menuitem", { name });
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
  // The app opens on Work; Chat is one click away.
  await page.getByTestId("top-tab-chat").click({ timeout: 15_000 });
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

test("the app opens on Work, which keeps the main sidebar and hides only the thread rail, with no extra collapse control; Chat brings the rail back", async ({ page }) => {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await mockTauri(page, FIX);
  await serveViews(page);
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible({ timeout: 15_000 });
  // Work is the default screen, not Chat.
  await expect(page.getByTestId("work-queue")).toBeVisible();
  await expect(page.getByTestId("top-tab-queue")).toHaveClass(/bg-accent/);
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
  // The explicit switch holds: Chat stays until Work is picked again.
  await expect(page.getByTestId("work-queue")).toHaveCount(0);
});

test("the queue fills the screen: check box, short name, one meta line with icons, a spinner while worked; the panel is collapsed", async ({ page }) => {
  await openWork(page);
  await expect.poll(() => rowIds(page)).toEqual(["t1", "t2", "t3", "t5", "t4", "t6"]);
  await expect(row(page, "t1")).toContainText("Hike Permit");
  // One line per card: the name, the domain, the team (Ben first), the status with its time, tiny agent and machine marks.
  await expect(row(page, "t1").getByTestId("work-row-meta")).toHaveText("Health");
  await expect(row(page, "t1").getByTestId("work-row-team")).toHaveAttribute("title", "Ben, with Planner and Scout");
  await expect(row(page, "t1").getByTestId("work-row-agent")).toHaveAttribute("title", "Agent: claude");
  await expect(row(page, "t1").getByTestId("work-row-machine")).toHaveAttribute("title", "Machine: foo-laptop");
  await expect(row(page, "t4").getByTestId("work-row-machine")).toHaveAttribute("title", "Machine: mini-foo");
  await expect(row(page, "t1")).toContainText(/Working\s*· (just now|\d+m)/);
  await expect(row(page, "t5")).toContainText(/Queued\s*· 1st/);
  await expect(row(page, "t6")).toContainText(/Done\s*· \d+h ago/);
  await expect(row(page, "t6").getByTestId("work-dismiss")).toHaveCount(1);
  await expect(row(page, "t1").getByTestId("work-dismiss")).toHaveCount(0);
  for (const id of ["t1", "t2", "t3", "t5", "t4", "t6"]) expect(await row(page, id).evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(64);
  await expect(row(page, "t1").getByTestId("work-spinner")).toBeVisible();
  await expect(row(page, "t3").getByTestId("work-spinner")).toBeVisible();
  await expect(row(page, "t5").getByTestId("work-spinner")).toHaveCount(0);
  await expect(row(page, "t2")).toContainText("Needs you");
  await expect(row(page, "t1").getByTestId("work-check")).toHaveAttribute("aria-checked", "false");
  await expect(row(page, "t6").getByTestId("work-check")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("work-meta")).toHaveText("6 tasks · 2 running · 1 queued · 1 needs you · 1 paused · 1 done");
  // Collapsed by default: the queue has the whole width.
  await expect(panel(page)).toHaveCount(0);
  const w = (await page.getByTestId("work-list").boundingBox())!.width;
  expect(w).toBeGreaterThan(1000);
  // A click slides the panel open for that item; closing gives the width back; the choice is remembered.
  await openRow(page, "t5");
  await expect(panel(page)).toBeVisible();
  await expect(detail(page)).toHaveAttribute("data-status", "queued");
  await expect(page.getByTestId("work-task-title")).toHaveText("Gutter Brackets");
  expect(await page.evaluate(() => localStorage.getItem("prevail.work.panel"))).toBe("1");
  await page.getByTestId("work-panel-close").click();
  await expect(panel(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("prevail.work.panel"))).toBe("0");
  await openRow(page, "t1");
  await page.reload();
  await page.getByTestId("top-tab-queue").click({ timeout: 15_000 });
  await expect(panel(page)).toBeVisible();
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
  await row(page, "t1").getByRole("button", { name: /^Hike Permit/ }).focus();
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
  const T9 = { ...T5, id: "t9", promptId: "p9", name: "Foo Passport", text: "Renew the foo passport", status: "running", prompt: { id: "p9", ts: NOW, text: "Renew the foo passport", surface: "desktop" } };
  await page.evaluate((t9) => { const fx = (window as unknown as { __fixtures: { __queue: { tasks: unknown[] } } }).__fixtures; fx.__queue = { ...fx.__queue, tasks: [...fx.__queue.tasks, t9] }; }, T9);
  await page.getByTestId("work-input").fill("Renew the foo passport");
  await page.getByTestId("work-send").click();
  await expect.poll(async () => (await rowIds(page)).at(-1)).toBe("t9");
  await expect(row(page, "t9")).toContainText("Foo Passport");
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

test("the item panel: status, where it went with its icon, who is on it, what it knows, plain activity; re-route, chips and the menu", async ({ page }) => {
  await openWork(page);
  await openRow(page, "t1");
  const d = detail(page);
  await expect(d.getByTestId("work-status")).toHaveText("Working on it");
  await expect(d.getByTestId("work-task-title")).toHaveText("Hike Permit");
  await expect(d).toContainText("Book the foo hike permit for Saturday");
  // One block of pills at the top, no headings: Ben first, then the specialists; where it went; the agent and the machine.
  await expect(d.getByTestId("work-destination")).toContainText("Health");
  await expect(d.getByTestId("work-team")).toContainText("Ben");
  await expect(d.getByTestId("work-team")).toHaveAttribute("title", "Ben, with Planner and Scout");
  await expect(d.getByTestId("work-team")).not.toContainText("Chief of staff");
  await expect(d.getByTestId("work-specialist")).toHaveCount(2);
  await expect(d.locator("h3", { hasText: /Where it went|Who is on it/ })).toHaveCount(0);
  // A balanced header: the status (with its time) and the people sit at the top right, not an empty corner.
  const right = d.getByTestId("work-head-right");
  await expect(right.getByTestId("work-status")).toHaveText("Working on it");
  await expect(right).toContainText(/· (just now|\d+m)/);
  await expect(right.getByTestId("work-team")).toBeVisible();
  const [rb, pb] = [await right.boundingBox(), await panel(page).boundingBox()];
  expect(pb!.x + pb!.width - (rb!.x + rb!.width)).toBeLessThan(40);
  await expect(d.getByTestId("work-updates")).toHaveText("Working on it, nothing needed from you.");
  // The steps stay hidden until Details is opened: the panel shows the ask and its result.
  await expect(d.getByTestId("work-activity")).toBeHidden();
  await d.getByTestId("work-details").locator("summary").first().click();
  await expect(d.getByTestId("work-context")).toContainText("Your home city, from your profile");
  await expect(d.getByTestId("work-activity-line")).toHaveText([/Sent to Health/, /Your rules apply: nothing is paid or bought\./, /Started/, /Searching the web/]);
  // Never engine words or ids.
  await expect(panel(page)).not.toContainText(/router|named nothing|routed ·|I am not sure|t1|foo-1/);
  // The activity line opens to what is behind it.
  await d.getByTestId("work-activity-line").filter({ hasText: "Searching the web" }).locator("summary").click();
  await expect(d.getByTestId("work-activity")).toContainText("WebSearch(foo hike permits Saturday)");
  await d.getByTestId("work-route").click();
  await menuItem(page, "Undo the route").click();
  await expect.poll(async () => (await calls(page, "engine_work_route"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t1", undo: true });
  await d.getByTestId("work-task-machine").click();
  await menuItem(page, /mini-foo/).click();
  await expect.poll(async () => (await calls(page, "engine_work_route"))[1]).toEqual({ vault: "/tmp/smoke-vault", id: "t1", machine: "mini-foo" });
  await d.getByTestId("work-agent").click();
  await menuItem(page, "gemini").click();
  await expect.poll(async () => (await calls(page, "engine_work_route"))[2]).toEqual({ vault: "/tmp/smoke-vault", id: "t1", agentKind: "gemini" });
  await d.getByTestId("work-task-menu").click();
  await menuItem(page, "Pause").click();
  await expect.poll(async () => (await calls(page, "engine_work_action"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t1", action: "pause" });
  // A home the work lacks is one item in the destination's menu, never a question.
  await openRow(page, "t3");
  await detail(page).getByTestId("work-route").click();
  await menuItem(page, "New entity: Sam Foo").click();
  await expect.poll(async () => (await calls(page, "engine_work_action"))[1]).toEqual({ vault: "/tmp/smoke-vault", id: "t3", action: "accept", n: 1 });
  expect(await nothingWide(page)).toEqual([]);
});

test("nothing asks: no Start, Not now, Keep, Close or Create questions; a waiting task shows its question and the answer goes as a follow-up", async ({ page }) => {
  await openWork(page);
  for (const id of ["t1", "t2", "t3", "t5", "t4", "t6"]) {
    await openRow(page, id);
    await expect(detail(page)).toHaveAttribute("data-status", /./);
    await expect(page.getByTestId("work-ask")).toHaveCount(0);
    await expect(panel(page).getByRole("button", { name: /^(Start|Not now|Keep|Close|Create it|Create one)$/ })).toHaveCount(0);
  }
  await openRow(page, "t2");
  await expect(detail(page).getByTestId("work-updates")).toContainText("Which trailhead, north or south?");
  const box = detail(page).getByTestId("work-followup-input");
  await expect(box).toHaveAttribute("placeholder", "Answer it");
  await box.fill("North, the foo trailhead");
  await box.press("Enter");
  await expect.poll(async () => (await calls(page, "engine_work_followup"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t2", text: "North, the foo trailhead" });
  await expect(box).toHaveValue("");
});

test("Follow up or clarify appends to the task, or adds a new task to the same work", async ({ page }) => {
  await openWork(page);
  await openRow(page, "t1");
  const box = detail(page).getByTestId("work-followup-input");
  await expect(box).toHaveAttribute("placeholder", "Follow up or clarify");
  await box.fill("Only the north loop");
  await detail(page).getByTestId("work-followup-send").click();
  await expect.poll(async () => (await calls(page, "engine_work_followup"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t1", text: "Only the north loop" });
  await box.fill("Also book the foo campsite");
  await detail(page).getByTestId("work-followup-new").click();
  await expect.poll(async () => (await calls(page, "engine_work_followup"))[1]).toEqual({ vault: "/tmp/smoke-vault", id: "t1", text: "Also book the foo campsite", asTask: true });
  // It is not a chat: no conversation, no replies on screen.
  await expect(panel(page).locator("[data-role=assistant], [data-testid=message], [data-testid=chat-thread]")).toHaveCount(0);
});

test("a Herdr task never shows the agent's output: its workspace and own tab, plain activity, and Open in Herdr", async ({ page }) => {
  await openWork(page);
  await openRow(page, "t3");
  await expect(detail(page)).toHaveAttribute("data-executor", "herdr");
  await expect(detail(page).getByTestId("work-herdr-link")).toContainText("Bar app");
  await expect(panel(page)).not.toContainText("Drafted the bar report.");
  await expect(panel(page)).not.toContainText("Nothing from the Herdr tab yet");
  await expect(page.getByTestId("work-herdr-output")).toHaveCount(0);
  await expect(panel(page).locator("pre")).toHaveCount(0);
  await expect(detail(page).getByTestId("work-open-herdr")).toBeHidden();
  await detail(page).getByTestId("work-details").locator("summary").first().click();
  await expect(detail(page).getByTestId("work-activity-line")).toHaveText([/Sent to Bar app/, /Opened its own Herdr tab in Bar app/, /Reading notes\.md/, /Drafting an email/, /You followed up/]);
  await detail(page).getByTestId("work-open-herdr").click();
  await expect.poll(async () => (await calls(page, "engine_work_action"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t3", action: "focus" });
  expect(await nothingWide(page)).toEqual([]);
});

test("the check box marks a task done in the engine and the row leaves; a finished task shows its outcome until cleared", async ({ page }) => {
  await openWork(page);
  await openRow(page, "t6");
  // It never closes itself: it says what came of it and asks.
  await expect(detail(page).getByTestId("work-update")).toHaveText(["Done: Drafted the bar report email to Sam Foo; it is in your drafts, nothing was sent.", /^Can I close this task\?/]);
  // The quick replies sit right under the question they answer.
  await expect(detail(page).getByTestId("work-update").last().getByTestId("work-quick-reply")).toHaveText(["Go ahead and close it", "Continue"]);
  await expect(detail(page).getByTestId("work-status")).toHaveText("Done");
  await row(page, "t1").getByTestId("work-check").click();
  await expect(row(page, "t1").getByTestId("work-check")).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await calls(page, "engine_work_action"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t1", action: "done" });
  await page.evaluate(() => { const fx = (window as unknown as { __fixtures: { __queue: { tasks: { id: string }[] } } }).__fixtures; fx.__queue = { ...fx.__queue, tasks: fx.__queue.tasks.filter((t) => t.id !== "t1") }; });
  await expect(row(page, "t1")).toHaveCount(0);
  // Ticking a finished one clears it.
  await row(page, "t6").getByTestId("work-check").click();
  await expect.poll(async () => (await calls(page, "engine_work_action"))[1]).toEqual({ vault: "/tmp/smoke-vault", id: "t6", action: "done" });
  // The backlog keeps finished work.
  await page.getByTestId("work-mode-backlog").click();
  await page.getByTestId("tab-done").click();
  await expect(page.getByTestId("work-backlog-row").filter({ hasText: "Bar Draft" })).toHaveCount(1);
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
  await expect(page.getByTestId("work-meta")).toHaveText("1 idea");
  await expect(page.getByTestId("work-backlog-row")).toHaveCount(1);
  await expect(page.getByTestId("work-backlog-row").first()).toContainText("Standing Desk");
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
  await idea.getByText("Standing Desk").click();
  await detail(page).getByTestId("work-task-menu").click();
  await expect(menuItem(page, "Move to queue")).toBeVisible();
  await page.keyboard.press("Escape");
  // Back to Queue: Send starts work again, without hold.
  await page.getByTestId("work-mode-queue").click();
  await expect(page.getByTestId("work-queue-row")).toHaveCount(6);
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
  await page.getByTestId("work-queue").waitFor({ timeout: 15_000 });
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
  await openRow(page, "t1");
  await detail(page).getByTestId("work-task-menu").click();
  await menuItem(page, "Pause").click();
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
  await expect(page.getByTestId("work-list")).toHaveCount(0);
  await expect(page.getByText("Send a prompt")).toHaveCount(0);
  await expect(page.getByTestId("work-input")).toHaveAttribute("placeholder", "Ready for work");
  expect(await nothingWide(page)).toEqual([]);
});

test("the open panel resizes by dragging its edge or with the arrow keys, and keeps its width after a reload", async ({ page }) => {
  await openWork(page);
  await openRow(page, "t1");
  const p = panel(page);
  const handle = page.getByTestId("work-panel-resize");
  await expect(handle).toHaveAttribute("role", "separator");
  const w0 = (await p.boundingBox())!.width;
  const h = (await handle.boundingBox())!;
  // The panel is on the right: dragging its edge left widens it.
  await page.mouse.move(h.x + h.width / 2, h.y + 200);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 - 120, h.y + 200, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await p.boundingBox())!.width)).toBe(Math.round(w0 + 120));
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => Math.round((await p.boundingBox())!.width)).toBe(Math.round(w0 + 104));
  await page.reload();
  await page.getByTestId("top-tab-queue").click({ timeout: 15_000 });
  await expect.poll(async () => Math.round((await panel(page).boundingBox())!.width)).toBe(Math.round(w0 + 104));
  // Never wider than 60% of the window; the queue keeps its room.
  const h2 = (await page.getByTestId("work-panel-resize").boundingBox())!;
  await page.mouse.move(h2.x + 2, h2.y + 200);
  await page.mouse.down();
  await page.mouse.move(40, h2.y + 200, { steps: 6 });
  await page.mouse.up();
  expect(Math.round((await panel(page).boundingBox())!.width)).toBeLessThanOrEqual(Math.round(1440 * 0.6));
  expect((await page.getByTestId("work-list").boundingBox())!.width).toBeGreaterThanOrEqual(300);
  expect(await nothingWide(page)).toEqual([]);
  await page.getByTestId("work-panel-resize").dblclick();
  await expect.poll(async () => Math.round((await panel(page).boundingBox())!.width)).toBe(Math.round(w0));
});

test("a task held by another Mac offers Continue here, asking first while that lease is live", async ({ page }) => {
  await openWork(page);
  await openRow(page, "t4");
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
    await page.evaluate((t8) => { const fx = (window as unknown as { __fixtures: { __queue: { tasks: unknown[] } } }).__fixtures; fx.__queue = { ...fx.__queue, tasks: [...fx.__queue.tasks, t8] }; }, T8);
    await expect(page.getByTestId("work-queue-row")).toHaveCount(7);
    await page.waitForTimeout(400);
    // The queue full width: running spinners, a waiting one, a checked one.
    await page.screenshot({ path: `${SHOTS}/work-queue-${theme}-1440.png` });
    // The panel for a running Herdr task: where it went, who is on it, activity.
    await openRow(page, "t3");
    await expect(panel(page)).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/work-panel-running-${theme}-1440.png` });
    await openRow(page, "t1");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/work-panel-engine-${theme}-1440.png` });
    // A done task with its outcome.
    await openRow(page, "t6");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/work-panel-done-${theme}-1440.png` });
    await openRow(page, "t2");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/work-panel-waiting-${theme}-1440.png` });
    // The pills and the back-and-forth that asks to close.
    await openRow(page, "t8");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/work-panel-close-${theme}-1440.png` });
    await page.getByTestId("work-panel-close").click();
    await page.getByTestId("work-queue-list").evaluate((el) => { (el as HTMLElement).style.width = "300px"; });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/work-queue-narrow-${theme}-1440.png` });
    await page.getByTestId("work-queue-list").evaluate((el) => { (el as HTMLElement).style.width = ""; });
    await openRow(page, "t2");
    await page.getByTestId("work-panel-close").click();
    await page.getByTestId("work-mode-backlog").click();
    await expect(page.getByTestId("work-backlog-row").first()).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/work-backlog-${theme}-1440.png` });
  });
}

// A finished task with its back-and-forth: the task's own lines and the owner's replies, newest at the bottom.
const T8 = { ...T6, id: "t8", name: "Foo Trip Notes", text: "Summarize the foo trip notes", specialists: ["planner", "scout", "writer", "analyst", "researcher"],
  dest: dest("domain", "travel", "Travel"), domains: ["travel", "money", "health", "career"], apps: ["foo-maps"], agentKind: "claude", machine: "mini-foo",
  updates: [
    { ts: NOW - 300_000, from: "task", text: "Working on it, nothing needed from you." },
    { ts: NOW - 200_000, from: "task", text: "Which notes, the spring or the autumn foo trip?" },
    { ts: NOW - 190_000, from: "you", text: "The autumn one" },
    { ts: NOW - 60_000, from: "task", text: "Done: Three pages of autumn foo trip notes, summarized in five lines." },
    { ts: NOW - 59_000, from: "task", text: "Can I close this task?" },
  ] };

test("the panel: pills in two rows at most, then a light back-and-forth that asks to close; a quick yes goes as a reply", async ({ page }) => {
  await openWork(page, { engine_work_list: { ...QUEUE, tasks: [...QUEUE.tasks, T8] } });
  await page.evaluate((t8) => { const fx = (window as unknown as { __fixtures: { __queue: { tasks: unknown[] } } }).__fixtures; fx.__queue = { ...fx.__queue, tasks: [...fx.__queue.tasks, t8] }; }, T8);
  await openRow(page, "t8");
  const d = detail(page);
  await expect(d.getByTestId("work-domain")).toHaveText([/Money/, /Health/, /Career/]);
  await expect(d.getByTestId("work-team")).toHaveAttribute("title", "Ben, with Planner, Scout, Writer, Analyst and Researcher");
  // What does not fit folds into a "+N" pill that names the rest; pills never squash or wrap.
  await expect(d.getByTestId("work-facts-more").first()).toBeVisible();
  expect(await d.locator("[data-pill]:visible").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width < 40).length)).toBe(0);
  // Context takes two rows at most, even with many domains and specialists.
  const h = await d.getByTestId("work-facts").evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeLessThanOrEqual(64);
  expect(await d.getByTestId("work-facts").evaluate((el) => [...el.querySelectorAll("*")].filter((c) => { const b = c.getBoundingClientRect(); return b.width > 0 && b.right > el.getBoundingClientRect().right + 1; }).length)).toBe(0);
  await expect(d.getByTestId("work-update")).toHaveText(["Working on it, nothing needed from you.", "Which notes, the spring or the autumn foo trip?", "The autumn one", "Done: Three pages of autumn foo trip notes, summarized in five lines.", /^Can I close this task\?/]);
  await expect(d.locator("[data-testid=work-update][data-from=you]")).toHaveText(["The autumn one"]);
  await expect(d.getByTestId("work-followup-input")).toHaveAttribute("placeholder", "Reply, or say close it");
  await d.getByTestId("work-quick-reply").filter({ hasText: "Go ahead and close it" }).click();
  await expect.poll(async () => (await calls(page, "engine_work_followup"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t8", text: "Go ahead and close it" });
  expect(await nothingWide(page)).toEqual([]);
});

test("a narrow column keeps each card on one line: the name stays readable, metadata drops first, nothing overflows", async ({ page }) => {
  await openWork(page);
  await expect.poll(() => rowIds(page)).toEqual(["t1", "t2", "t3", "t5", "t4", "t6"]);
  await page.getByTestId("work-queue-list").evaluate((el) => { (el as HTMLElement).style.width = "300px"; });
  await expect(row(page, "t1").getByTestId("work-row-machine")).toBeHidden();
  await expect(row(page, "t1").getByTestId("work-row-agent")).toBeHidden();
  for (const id of ["t1", "t2", "t3", "t5", "t4", "t6"]) {
    const r = row(page, id);
    expect(await r.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(64);
    // The name keeps at least about ten characters before it truncates.
    expect(await r.evaluate((el) => { const n = el.querySelector("button[title] > span") as HTMLElement; return n.getBoundingClientRect().width; })).toBeGreaterThan(100);
    expect(await r.evaluate((el) => [...el.querySelectorAll("*")].filter((c) => { const b = c.getBoundingClientRect(); return b.width > 0 && b.right > el.getBoundingClientRect().right + 1; }).map((c) => `${c.tagName}.${c.getAttribute("data-testid") ?? ""}.${(c.className as unknown as string).toString().slice(0, 40)}`))).toEqual([]);
  }
});

test("a follow-up shows at once with a thinking line until the task answers; a failed send offers Retry", async ({ page }) => {
  await openWork(page);
  await openRow(page, "t1");
  const d = detail(page);
  await d.getByTestId("work-followup-input").fill("Hey, what is going on?");
  await d.getByTestId("work-followup-input").press("Enter");
  await expect(d.locator("[data-testid=work-update][data-from=you]")).toHaveText(["Hey, what is going on?"]);
  await expect(d.getByTestId("work-thinking")).toContainText("Ben is on it");
  // The engine records the message and answers: the thinking line gives way to the reply.
  await page.evaluate(() => {
    const fx = (window as unknown as { __fixtures: { __queue: { tasks: { id: string; updates?: unknown[] }[] } } }).__fixtures;
    const now = Date.now();
    fx.__queue = { ...fx.__queue, tasks: fx.__queue.tasks.map((t) => (t.id === "t1" ? { ...t, updates: [{ ts: now - 60_000, from: "task", text: "Working on it, nothing needed from you." }, { ts: now, from: "you", text: "Hey, what is going on?" }, { ts: now + 1, from: "task", text: "On it: looking into that now." }] } : t)) };
  });
  await d.getByTestId("work-followup-input").fill("x");
  await d.getByTestId("work-followup-input").fill("");
  await expect(d.getByTestId("work-thinking")).toHaveCount(0, { timeout: 15_000 });
  await expect(d.getByTestId("work-update").last()).toHaveText("On it: looking into that now.");
  await expect(d.locator("[data-testid=work-update][data-from=you]")).toHaveCount(1);
  // A call that fails says so plainly, with Retry.
  await page.evaluate(() => { (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures.engine_work_followup = () => { throw new Error("engine down"); }; });
  await d.getByTestId("work-followup-input").fill("Still there?");
  await d.getByTestId("work-followup-input").press("Enter");
  await expect(d.getByTestId("work-send-failed")).toContainText("That did not reach the task.");
  await page.evaluate(() => { (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures.engine_work_followup = { ok: true }; });
  await d.getByTestId("work-retry").click();
  await expect(d.getByTestId("work-thinking")).toBeVisible();
  await expect.poll(async () => (await calls(page, "engine_work_followup")).filter((a) => a.text === "Still there?").length).toBe(2);
});

test("a planned task shows what it understood and its questions as a short list", async ({ page }) => {
  const T9P = { ...T5, id: "t9", name: "Europe Trip", text: "Book a trip to Europe", status: "needs-you", planning: true, waiting: "A few questions before I start.", domains: ["travel", "money", "health"],
    updates: [{ ts: NOW - 5_000, from: "task", text: "Before I start: this spends money and time, so I brought in Travel, Money, Health. From your vault: Your past trip: Foo Lisbon Trip; Travel budget: 3,000 foo dollars a year. A few things only you can tell me:",
      questions: ["Where in Europe: which cities or places?", "When, and for how long?", "What budget should I keep to?"] }] };
  await openWork(page);
  await page.evaluate((t9) => { const fx = (window as unknown as { __fixtures: { __queue: { tasks: unknown[] } } }).__fixtures; fx.__queue = { ...fx.__queue, tasks: [...fx.__queue.tasks, t9] }; }, T9P);
  await openRow(page, "t9");
  const d = detail(page);
  await expect(d.getByTestId("work-status")).toHaveText("Needs you");
  await expect(d.getByTestId("work-plan-questions").locator("li")).toHaveText(["Where in Europe: which cities or places?", "When, and for how long?", "What budget should I keep to?"]);
  await expect(d.getByTestId("work-domain")).toHaveText([/Travel/, /Money/, /Health/]);
  await expect(d.getByTestId("work-followup-input")).toHaveAttribute("placeholder", "Answer it");
});
