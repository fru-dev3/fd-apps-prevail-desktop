// Work mode: the Work tab beside Chat and Council. One box fires prompts into
// the queue (not a chat), each prompt becomes a card of routed tasks with
// Undo, re-route, agent kind and machine chips, actions per status, and the
// Herdr toggle. Invented data only (foo names, /tmp paths, invented Macs).
// With WORK_SHOTS=<dir>, the tab is captured light and dark at 1440.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const NOW = Date.now();
const dest = (kind: string, id: string, label: string, owner = id) => ({ kind, id, label, space: owner, owner, confidence: 0.9, why: "named in the prompt" });
const base = { alternatives: [], specialists: [], shape: "task", flags: {}, effort: "standard", agentKind: "claude", machine: "local", suggestions: [], log: [] };
const PROMPTS = [
  {
    id: "p1", ts: NOW - 120_000, text: "Plan the foo hike this weekend, and get the bar report to Sam Foo before Friday", surface: "desktop", machine: "local",
    tasks: [
      { ...base, id: "t1", promptId: "p1", goal: "Plan the foo hike", text: "Book the foo hike permit for Saturday", dest: dest("domain", "health", "Health"),
        alternatives: [dest("project", "foo-hike", "Foo hike")], specialists: ["planner", "scout"], status: "running", executor: "engine",
        thread: { space: "health", session: "foo-1" }, log: [{ ts: NOW - 110_000, ev: "routed", detail: "Health" }, { ts: NOW - 100_000, ev: "started" }] },
      { ...base, id: "t2", promptId: "p1", goal: "Plan the foo hike", text: "Check the trail weather and pack list", dest: dest("domain", "health", "Health"), status: "needs-you", executor: "engine",
        thread: { space: "health", session: "foo-2" }, ask: { kind: "start", detail: "Over your limit of $1 and 10 minutes. Start it?" } },
      { ...base, id: "t3", promptId: "p1", goal: "Send the bar report", text: "Draft the bar report for Sam Foo", dest: dest("project", "bar-app", "Bar app", "career"),
        specialists: ["writer"], agentKind: "codex", status: "done", executor: "herdr", thread: { space: "_mission-bar-app", session: "foo-3" },
        herdr: { machine: "local", workspaceLabel: "foo-reports", tabId: "w1:t2", lastRead: "Drafted the bar report.\nSaved to the Bar app project notes." },
        suggestions: [{ kind: "entity", name: "Sam Foo", why: "Named in the prompt, not in your people yet", state: "open" }] },
    ],
  },
  {
    id: "p2", ts: NOW - 3_600_000, text: "Fix the foo gutter before the rain", surface: "phone", machine: "local",
    tasks: [
      { ...base, id: "t4", promptId: "p2", goal: "Fix the foo gutter", text: "Find a foo gutter repair crew", dest: dest("domain", "career", "Career"), status: "paused", executor: "herdr",
        machine: "mini-foo", thread: { space: "career", session: "foo-4" }, herdr: { machine: "mini-foo", workspaceLabel: "foo-home" }, lease: { host: "mini-foo", until: NOW + 120_000 } },
    ],
  },
];
const MACHINES = {
  machines: [
    { id: "local", hostname: "foo-laptop", label: "Foo laptop", role: "client", current: true, herdr: "local" },
    { id: "mini-foo", hostname: "mini-foo", label: "Mini foo", role: "hub", current: false, herdr: "saved" },
    { id: "studio-foo", hostname: "studio-foo.local", label: "Studio foo", current: false, herdr: "missing" },
  ],
  agentKinds: ["claude", "codex", "gemini"],
};
const FIX = {
  engine_work_list: { prompts: PROMPTS },
  engine_work_machines: MACHINES,
  engine_work_settings: { herdr: false, machine: "local" },
  engine_work_add: { id: "p9", ts: NOW, text: "Renew the foo passport", surface: "desktop", machine: "local", tasks: [] },
  engine_work_route: { ok: true }, engine_work_action: { ok: true }, engine_work_answer: { ok: true },
  scan_vault: ["career", "health"].map((name) => ({ name, path: `/tmp/smoke-vault/data/domains/${name}`, has_state: true, state_preview: null })),
};

const calls = (page: Page, cmd: string) => page.evaluate((c) =>
  ((window as unknown as { __invokeLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__invokeLog ?? [])
    .filter((e) => e.cmd === c).map((e) => e.args), cmd);

async function openWork(page: Page, extra: Record<string, unknown> = {}, width = 1440) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.setViewportSize({ width, height: 900 });
  await mockTauri(page, { ...FIX, ...extra });
  await page.goto("/");
  await page.getByTestId("top-tab-queue").click({ timeout: 15_000 });
}
const task = (page: Page, id: number) => page.getByTestId("work-task").nth(id);

test("the Work tab sits next to Chat and Council", async ({ page }) => {
  await openWork(page);
  const tabs = page.locator("[data-testid^=top-tab-]");
  await expect(tabs).toHaveText(["Chat", "Council", "Work"]);
  await expect(page.getByTestId("work-queue")).toBeVisible();
  await expect(page.getByTestId("work-prompt-row")).toHaveCount(2);
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
  await expect(task(page, 0).getByTestId("work-route")).toContainText("Health");
  await task(page, 0).getByTestId("work-route-undo").click();
  await expect.poll(async () => (await calls(page, "engine_work_route"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t1", undo: true });
  await task(page, 0).getByTestId("work-task-machine").click();
  await page.getByRole("menuitem", { name: /Mini foo/ }).click();
  await expect.poll(async () => (await calls(page, "engine_work_route"))[1]).toEqual({ vault: "/tmp/smoke-vault", id: "t1", machine: "mini-foo" });
  await task(page, 0).getByTestId("work-agent").click();
  await page.getByRole("menuitem", { name: "gemini" }).click();
  await expect.poll(async () => (await calls(page, "engine_work_route"))[2]).toEqual({ vault: "/tmp/smoke-vault", id: "t1", agentKind: "gemini" });
  await task(page, 0).getByTestId("work-act-pause").click();
  await expect.poll(async () => (await calls(page, "engine_work_action"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t1", action: "pause" });
  await expect(task(page, 1).getByTestId("work-ask")).toContainText("Over your limit");
  await task(page, 1).getByTestId("work-answer-yes").click();
  await expect.poll(async () => (await calls(page, "engine_work_answer"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t2", answer: "yes" });
  await task(page, 2).getByTestId("work-suggest-accept").click();
  await expect.poll(async () => (await calls(page, "engine_work_action"))[1]).toEqual({ vault: "/tmp/smoke-vault", id: "t3", action: "accept", n: 0 });
});

test("a done Herdr task shows Keep and Close and its mirrored output", async ({ page }) => {
  await openWork(page);
  const t = task(page, 2);
  await expect(t).toHaveAttribute("data-executor", "herdr");
  await expect(t.getByTestId("work-act-keep")).toBeVisible();
  await expect(t.getByTestId("work-act-close")).toBeVisible();
  await t.getByText("Draft the bar report for Sam Foo").click();
  await expect(t.getByTestId("work-herdr-output")).toContainText("Drafted the bar report.");
  await t.getByTestId("work-act-close").click();
  await expect.poll(async () => (await calls(page, "engine_work_action"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t3", action: "close" });
});

test("the Herdr toggle and the machine picker go to the engine's settings", async ({ page }) => {
  await openWork(page);
  await page.getByTestId("work-herdr").click();
  await expect.poll(async () => (await calls(page, "engine_work_settings")).find((a) => "herdr" in a)).toEqual({ vault: "/tmp/smoke-vault", herdr: true });
  await expect(page.getByTestId("work-herdr")).toHaveAttribute("aria-pressed", "true");
});

test("a machine that is not connected shows the Add prompt with the command to confirm", async ({ page }) => {
  await openWork(page);
  await page.getByTestId("work-machine").click();
  await page.getByRole("menuitem", { name: /Connect Studio foo/ }).click();
  const add = page.getByTestId("work-machine-add");
  await expect(add).toContainText("Studio foo is not connected to Herdr");
  await expect(add.getByTestId("work-machine-add-command")).toHaveText("herdr machine add --label studio-foo studio-foo.local");
  await expect(add.getByTestId("work-machine-add-confirm")).toBeDisabled();
  await add.getByLabel("SSH target").fill("foo@studio-foo.local");
  await expect(add.getByTestId("work-machine-add-command")).toHaveText("herdr machine add --label studio-foo foo@studio-foo.local");
  await add.getByTestId("work-machine-add-confirm").click();
  await expect.poll(async () => (await calls(page, "engine_work_machine_add"))[0]).toEqual({ vault: "/tmp/smoke-vault", label: "studio-foo", target: "foo@studio-foo.local" });
});

test("a task held by another Mac offers Continue here, asking first while that lease is live", async ({ page }) => {
  await openWork(page);
  await page.getByTestId("work-prompt-row").nth(1).click();
  await page.getByTestId("work-continue-here").click();
  await page.getByRole("button", { name: "Yes" }).click();
  await expect.poll(async () => (await calls(page, "engine_work_action"))[0]).toEqual({ vault: "/tmp/smoke-vault", id: "t4", action: "continue-here" });
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
    await expect(page.getByTestId("work-task")).toHaveCount(3);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/work-${theme}-1440.png` });
    await page.getByTestId("tab-backlog").click();
    await expect(page.getByTestId("work-backlog-row").first()).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/work-backlog-${theme}-1440.png` });
  });
}
