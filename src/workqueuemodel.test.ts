import { describe, expect, test } from "vitest";
import {
  actionsFor, asMachines, asPrompts, asWorkspaces, backlog, engineLacksWork, FALLBACK_AGENT_KINDS, groupByGoal, leaseElsewhere,
  machineAddCommand, promptStatus, promptSummary, queuePrompts, type WorkPrompt, type WorkTask,
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

  test("each status allows its actions; Keep and Close are Herdr only", () => {
    expect(actionsFor(task({ status: "running" }))).toEqual(["pause"]);
    expect(actionsFor(task({ status: "paused" }))).toEqual(["continue"]);
    expect(actionsFor(task({ status: "routed" }))).toEqual(["start"]);
    expect(actionsFor(task({ status: "needs-you", ask: { kind: "start", detail: "" } }))).toEqual([]);
    expect(actionsFor(task({ status: "done" }))).toEqual([]);
    expect(actionsFor(task({ status: "done", executor: "herdr" }))).toEqual(["keep", "close"]);
    expect(actionsFor(task({ status: "done", executor: "herdr", ask: { kind: "keep-close", detail: "" } }))).toEqual([]);
    expect(actionsFor(task({ status: "closed", executor: "herdr" }))).toEqual(["reopen"]);
    expect(actionsFor(task({ status: "closed" }))).toEqual([]);
  });

  test("a prompt reads as one line and one status", () => {
    const p = prompt({ tasks: [task({ status: "running" }), task({ id: "t2", status: "needs-you" })] });
    expect(promptSummary(p)).toBe("2 tasks · 1 needs you · 1 running");
    expect(promptStatus(p)).toBe("needs-you");
    expect(promptSummary(prompt({ tasks: [] }))).toBe("Routing");
  });

  test("the queue drops fully closed prompts; the backlog sorts by urgency then newest", () => {
    const ps = [
      prompt({ id: "old", ts: 1, tasks: [task({ id: "a", status: "running" })] }),
      prompt({ id: "new", ts: 2, tasks: [task({ id: "b", status: "running", text: "bar report" }), task({ id: "c", status: "needs-you" })] }),
      prompt({ id: "shut", ts: 3, tasks: [task({ id: "d", status: "closed" })] }),
    ];
    expect(queuePrompts(ps).map((p) => p.id)).toEqual(["new", "old"]);
    expect(backlog(ps).map((t) => t.id)).toEqual(["c", "b", "a"]);
    expect(backlog(ps, "done").map((t) => t.id)).toEqual(["d"]);
    expect(backlog(ps, "all", "bar").map((t) => t.id)).toEqual(["b"]);
  });

  test("engine answers come wrapped or bare", () => {
    expect(asPrompts({ prompts: [prompt()] })).toHaveLength(1);
    expect(asPrompts([prompt(), { nope: 1 }])).toHaveLength(1);
    expect(asPrompts(null)).toEqual([]);
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
    expect(machineAddCommand({ id: "mini-foo", hostname: "mini-foo.local" })).toBe("herdr machine add --label mini-foo mini-foo.local");
    expect(machineAddCommand({ id: "mini-foo" }, "sam@10.0.0.9")).toBe("herdr machine add --label mini-foo sam@10.0.0.9");
    expect(leaseElsewhere(task(), "foo-laptop")).toEqual({ elsewhere: false, live: false });
    expect(leaseElsewhere(task({ lease: { host: "mini-foo", until: 2000 } }), "foo-laptop", 1000)).toEqual({ elsewhere: true, live: true });
    expect(leaseElsewhere(task({ lease: { host: "mini-foo", until: 500 } }), "foo-laptop", 1000)).toEqual({ elsewhere: true, live: false });
    expect(leaseElsewhere(task({ lease: { host: "foo-laptop", until: 2000 } }), "foo-laptop", 1000).elsewhere).toBe(false);
  });
});
