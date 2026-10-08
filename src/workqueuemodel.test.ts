import { describe, expect, test } from "vitest";
import {
  actionsFor, activityLines, asMachines, asPrompts, asSettings, asWorkspaces, backlog, engineLacksWork, FALLBACK_AGENT_KINDS, groupByGoal, leaseElsewhere,
  needsApproval, plainError, moveInQueue, asQueue, queueSummary, statusLine, taskTitle, type WorkPrompt, type WorkTask,
} from "./workqueuemodel";

const task = (over: Partial<WorkTask> = {}): WorkTask => ({
  id: "t1", promptId: "p1", text: "Book the foo hike permit", goal: "Plan the foo hike", dest: null, alternatives: [], specialists: [],
  shape: "task", flags: {}, effort: "quick", agentKind: "claude", machine: "local", suggestions: [], status: "routed", executor: "engine",
  thread: { space: "foo", session: "s1" }, log: [], ...over,
});
const prompt = (over: Partial<WorkPrompt> = {}): WorkPrompt => ({ id: "p1", ts: 1, text: "foo", surface: "desktop", machine: "local", tasks: [task()], ...over });

describe("work queue model", () => {
  test("tasks group by goal in first-seen order", () => {
    const g = groupByGoal([task({ id: "a", goal: "A" }), task({ id: "b", goal: "B" }), task({ id: "c", goal: "A" })]);
    expect(g.map((x) => [x.goal, x.tasks.map((t) => t.id)])).toEqual([["A", ["a", "c"]], ["B", ["b"]]]);
  });

  test("each status offers its menu actions; nothing asks keep or close", () => {
    expect(actionsFor(task({ status: "running" }))).toEqual(["pause"]);
    expect(actionsFor(task({ status: "paused" }))).toEqual(["continue"]);
    expect(actionsFor(task({ status: "routed" }))).toEqual(["start"]);
    expect(actionsFor(task({ status: "backlog" }))).toEqual(["start"]);
    expect(actionsFor(task({ status: "needs-you" }))).toEqual(["pause"]);
    expect(actionsFor(task({ status: "done", executor: "herdr" }))).toEqual([]);
    expect(actionsFor(task({ status: "closed", executor: "herdr" }))).toEqual(["reopen"]);
    expect(statusLine(task({ status: "needs-you", waiting: "Where are you right now?" }))).toBe("Where are you right now?");
    expect(statusLine(task({ status: "paused", outcome: "Held: autonomy is paused." }))).toBe("Held: autonomy is paused.");
    expect(taskTitle(task({ name: "Foo Permit" }))).toBe("Foo Permit");
    expect(taskTitle(task())).toBe("Book the foo hike permit");
  });

  test("the log reads as plain activity: no engine words, ids or agent output", () => {
    const lines = activityLines(task({
      dest: { kind: "domain", id: "health", label: "Health", space: "health", owner: "health", confidence: 1, why: "the router named nothing that exists" },
      herdr: { machine: "local", workspaceLabel: "Health" },
      log: [
        { ts: 1, ev: "routed", detail: "domain General: the router named nothing that exists" },
        { ts: 2, ev: "guard", detail: "Your rules apply: drafts only, nothing is sent." },
        { ts: 3, ev: "starting", detail: "in Herdr" },
        { ts: 4, ev: "in Herdr", detail: "Health on foo-laptop" },
        { ts: 5, ev: "activity", detail: "Reading your Gmail", more: "\u23fa gmail - search_threads (MCP)(query: foo)" },
        { ts: 6, ev: "activity", detail: "Drafting an email" },
        { ts: 7, ev: "follow-up", more: "Only the foo ones" },
        { ts: 8, ev: "no act gate", detail: "the hook file lives on this Mac" },
        { ts: 9, ev: "could not start", detail: "herdr exited 1: {\"error\":\"x\"}" },
        { ts: 10, ev: "done" },
      ],
    }));
    expect(lines.map((l) => [l.icon, l.text])).toEqual([
      ["route", "Sent to Health"], ["shield", "Your rules apply: drafts only, nothing is sent."], ["terminal", "Opened its own Herdr tab in Health"],
      ["mail", "Reading your Gmail"], ["mail", "Drafting an email"], ["you", "You followed up"], ["warn", "Could not start"], ["check", "Done"],
    ]);
    expect(lines[5]!.more).toBe("Only the foo ones");
    expect(JSON.stringify(lines)).not.toMatch(/router|exited|hook|error/);
  });

  test("the queue is flat and in the engine's order; an older engine's prompts become oldest first, open tasks only", () => {
    const q = asQueue({ ok: true, view: "queue", tasks: [task({ id: "b", status: "queued" }), task({ id: "a", status: "running" }), task({ id: "x", status: "done" })] });
    expect(q.map((t) => t.id)).toEqual(["b", "a"]);
    const old = asQueue({ prompts: [prompt({ id: "new", ts: 2, tasks: [task({ id: "c", status: "needs-you" })] }), prompt({ id: "old", ts: 1, tasks: [task({ id: "a", status: "running" }), task({ id: "d", status: "closed" })] })] });
    expect(old.map((t) => [t.id, t.prompt?.id])).toEqual([["a", "old"], ["c", "new"]]);
    expect(queueSummary(q)).toBe("2 tasks · 1 running · 1 queued");
    expect(actionsFor(task({ status: "queued" }))).toEqual(["pause"]);
    // A finished task stays, checked, until it is cleared.
    const finished = asQueue({ tasks: [task({ id: "k", status: "done", cleared: false }), task({ id: "x", status: "done" }), task({ id: "y", status: "done", cleared: true })] });
    expect(finished.map((t) => t.id)).toEqual(["k"]);
  });

  test("moving a task names its new neighbour for the engine", () => {
    const l = ["a", "b", "c", "d"].map((id) => ({ id }));
    const ids = (r: ReturnType<typeof moveInQueue>) => r && [r.list.map((x) => x.id).join(""), r.args];
    expect(ids(moveInQueue(l, "d", 0))).toEqual(["dabc", { before: "a" }]);
    expect(ids(moveInQueue(l, "a", 4))).toEqual(["bcda", { after: "d" }]);
    expect(ids(moveInQueue(l, "a", 2))).toEqual(["bacd", { before: "c" }]);
    expect(ids(moveInQueue(l, "c", 1))).toEqual(["acbd", { before: "b" }]);
    expect(moveInQueue(l, "b", 1)).toBeNull();
    expect(moveInQueue(l, "b", 2)).toBeNull();
    expect(moveInQueue(l, "nope", 0)).toBeNull();
  });

  test("the backlog sorts by urgency then newest", () => {
    const ps = [
      prompt({ id: "old", ts: 1, tasks: [task({ id: "a", status: "running" })] }),
      prompt({ id: "new", ts: 2, tasks: [task({ id: "b", status: "running", text: "bar report" }), task({ id: "c", status: "needs-you" })] }),
      prompt({ id: "shut", ts: 3, tasks: [task({ id: "d", status: "closed" })] }),
      prompt({ id: "idea", ts: 4, tasks: [task({ id: "e", status: "backlog" })] }),
    ];
    // Ideas: the parked tasks only.
    expect(backlog(ps).map((t) => t.id)).toEqual(["e"]);
    expect(backlog(ps, "all").map((t) => t.id)).toEqual(["c", "b", "a", "e", "d"]);
    expect(backlog(ps, "done").map((t) => t.id)).toEqual(["d"]);
    expect(backlog(ps, "all", "bar").map((t) => t.id)).toEqual(["b"]);
  });

  test("engine answers come wrapped or bare", () => {
    expect(asPrompts({ prompts: [prompt()] })).toHaveLength(1);
    expect(asPrompts([prompt(), { nope: 1 }])).toHaveLength(1);
    expect(asPrompts(null)).toEqual([]);
    expect(asPrompts({ ok: true, prompt: prompt({ id: "p9" }) }).map((p) => p.id)).toEqual(["p9"]);
    const bl = asPrompts({ ok: true, view: "backlog", tasks: [
      { ...task({ id: "a", promptId: "p1" }), prompt: { id: "p1", ts: 5, text: "foo", surface: "phone" } },
      { ...task({ id: "b", promptId: "p1" }), prompt: { id: "p1", ts: 5, text: "foo", surface: "phone" } },
      { ...task({ id: "c", promptId: "p2" }), prompt: { id: "p2", ts: 6, text: "bar", surface: "cli" } },
    ] });
    expect(bl.map((p) => [p.id, p.ts, p.surface, p.tasks.map((t) => t.id)])).toEqual([["p1", 5, "phone", ["a", "b"]], ["p2", 6, "cli", ["c"]]]);
    expect("prompt" in bl[0].tasks[0]).toBe(false);
    expect(asSettings({ ok: true, settings: { herdr: true, workspace: "foo-ws" } })).toEqual({ herdr: true, workspace: "foo-ws" });
    const m = asMachines({ machines: [{ id: "local", label: "Foo laptop", current: true, herdr: "local" }], agentKinds: ["claude", "codex"] });
    expect(m.machines[0].label).toBe("Foo laptop");
    expect(m.agentKinds).toEqual(["claude", "codex"]);
    expect(asMachines(null).agentKinds).toEqual(FALLBACK_AGENT_KINDS);
    expect(asWorkspaces([{ label: "foo-ws" }, "bar-ws"])).toEqual(["foo-ws", "bar-ws"]);
  });

  test("an engine without work is told apart from a failure", () => {
    expect(engineLacksWork(new Error("prevail exited 1: unknown command: work"))).toBe(true);
    expect(engineLacksWork("prevail exited 1: vault locked")).toBe(false);
  });

  test("machines: the add command and the lease", () => {
    expect(needsApproval({ ok: false, needsApproval: true, command: ["herdr"] })).toBe(true);
    expect(needsApproval({ ok: true })).toBe(false);
    expect(plainError(new Error('prevail exited 1: {"ok":false,"error":"remote herdr server needs one final update before this client can attach"}')).text).toBe("That Mac needs a Herdr update first.");
    expect(plainError("herdr machine add failed: ssh: connect to host foo port 22: Connection refused").text).toMatch(/Could not reach/);
    const odd = plainError({ weird: 1 });
    expect(odd.text).toBe("Something went wrong.");
    expect(odd.details).toBe('{"weird":1}');
    expect(plainError("prevail exited 1: unknown command: work").text).toMatch(/Update the engine/);
    expect(leaseElsewhere(task(), "foo-laptop")).toEqual({ elsewhere: false, live: false });
    expect(leaseElsewhere(task({ lease: { host: "mini-foo", until: 2000 } }), "foo-laptop", 1000)).toEqual({ elsewhere: true, live: true });
    expect(leaseElsewhere(task({ lease: { host: "mini-foo", until: 500 } }), "foo-laptop", 1000)).toEqual({ elsewhere: true, live: false });
    expect(leaseElsewhere(task({ lease: { host: "foo-laptop", until: 2000 } }), "foo-laptop", 1000).elsewhere).toBe(false);
  });
});
