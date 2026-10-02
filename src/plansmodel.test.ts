import { describe, expect, test } from "vitest";
import { elapsed, fmtDue, jobGroups, jobIdOf, jobStatusLabel, playbookGroups, stepState, triggerLine, type Job, type PlaybookRow, type StepRecord } from "./plansmodel";
import { addStep } from "./jobcard";
import { parseChief } from "./specialistspage";
import { calibrate } from "./decisionspage";

const job = (over: Partial<Job> = {}): Job => ({
  id: "2026-10-01-1432-foo", ask: "Find the best foo providers", origin: { kind: "chat", domain: "insurance" },
  domains: { owner: "insurance", consulted: ["property"], informed: ["tax"] },
  team: [{ step: 1, specialists: ["researcher", "scout"] }, { step: 2, specialists: ["steward"], gate: true }, { step: 3, specialists: ["editor"] }],
  effort: "standard", budget: { usd: 1, minutes: 10 }, why: "compare and choose", playbook: null, status: "running", startsAlone: true, created: 1000, started: 1000, ...over,
});

describe("plans model", () => {
  test("step states follow the records and the live progress", () => {
    const steps: StepRecord[] = [{ id: "1-researcher", specialist: "researcher", status: "done", passes: [], cost: { usd: 0.1, minutes: 1 } }];
    const j = job({ progress: [{ step: 1, specialist: "scout", pass: 1 }] });
    expect(stepState(j, "researcher", steps)).toBe("done");
    expect(stepState(j, "scout", steps)).toBe("now");
    expect(stepState(j, "editor", steps)).toBe("next");
  });
  test("labels and groups", () => {
    expect(jobStatusLabel(job({ status: "proposed", startsAlone: false }))).toBe("Waiting on you");
    expect(jobStatusLabel(job({ status: "done" }))).toBe("Done");
    const g = jobGroups([job(), job({ id: "b", status: "needs-approval" }), job({ id: "c", status: "failed" })]);
    expect([g.running.length, g.waiting.length, g.done.length]).toEqual([1, 1, 1]);
    expect(elapsed(job({ started: 0, ended: 95_000 }))).toBe("1:35");
  });
  test("due dates read as words", () => {
    expect(fmtDue("2026-10-01", "2026-10-02")).toBe("1 day late");
    expect(fmtDue("2026-10-02", "2026-10-02")).toBe("today");
    expect(fmtDue("2026-10-03", "2026-10-02")).toBe("tomorrow");
  });
  test("a reply's job marker", () => {
    expect(jobIdOf("On it.\n\n[job:2026-10-02-0814-find-foo]")).toBe("2026-10-02-0814-find-foo");
    expect(jobIdOf("no job here")).toBeNull();
  });
  test("a specialist added in Adjust joins before the Editor", () => {
    expect(addStep([["researcher"], ["editor"]], "steward")).toEqual([["researcher"], ["steward"], ["editor"]]);
    expect(addStep([["planner"]], "writer")).toEqual([["planner"], ["writer"]]);
  });
  test("the chief of staff's setup is read from the file", () => {
    const d = parseChief("---\nname: Foo\nhandoff: offer\n---\n\n## Limits\n- usd: 2\n- minutes: 15\n\n## Never pull in\n- health\n\n## What I've learned\n- insurance jobs: skip the scout\n");
    expect(d).toEqual({ name: "Foo", handoff: "offer", limits: { usd: 2, minutes: 15 }, neverRead: ["health"], learned: ["insurance jobs: skip the scout"] });
    expect(parseChief("")).toMatchObject({ name: null, handoff: "auto", limits: { usd: 1, minutes: 10 } });
  });
  test("calibration counts the retros per domain", () => {
    const r = (domain: string, retroRight?: string) => ({ slug: "x", domain, file: "", question: "q", status: "decided" as const, owner: domain, consulted: [], serves: [], retroRight, sections: {} });
    expect(calibrate([r("home", "gut"), r("home", "both"), r("money", "recommendation"), r("money")])).toEqual([
      { domain: "home", retros: 2, gut: 2, rec: 1 }, { domain: "money", retros: 1, gut: 0, rec: 1 },
    ]);
  });
});

describe("playbooks", () => {
  const row = (id: string, group: PlaybookRow["group"]): PlaybookRow => ({ id, name: id, goal: "", group, source: group === "built-in" ? "built-in" : "yours", draft: group === "drafts", steps: 2, running: group === "running" });
  test("groups rows in the page's order and keeps empty groups", () => {
    const g = playbookGroups([row("a", "built-in"), row("b", "drafts"), row("c", "yours"), row("d", "built-in")]);
    expect(g.running).toEqual([]);
    expect(g["built-in"].map((r) => r.id)).toEqual(["a", "d"]);
    expect(g.drafts.map((r) => r.id)).toEqual(["b"]);
  });
  test("says what runs a playbook", () => {
    expect(triggerLine([])).toBe("By hand");
    expect(triggerLine([{ domain: "foo", loop: "x", cadence: "weekly", enabled: false }])).toBe("By hand");
    expect(triggerLine([{ domain: "foo", loop: "x", cadence: "weekly", enabled: true }])).toBe("Weekly in Foo");
    expect(triggerLine([{ domain: "foo", loop: "x", cadence: "daily", enabled: true }, { domain: "bar-baz", loop: "y", cadence: "daily", enabled: true }])).toBe("Daily in Foo and Bar Baz");
    expect(triggerLine([{ domain: "foo", loop: "x", cadence: "on admin:renew", on: "admin:renew", enabled: true }])).toBe('When the radar flags an admin deadline that says "renew" in Foo');
  });
});

import { compassChips, RULE_STATE_LABEL } from "./plansmodel";
describe("Goals G3 job chips", () => {
  test("serves, watch and rules with their state; nothing without a Compass", () => {
    expect(compassChips(undefined)).toEqual({ serves: [], watch: [], rules: [] });
    const c = compassChips({ serves: [{ id: "g-foo", title: "Foo independence" }, { id: "v-free", title: "Freedom" }], costs: [{ id: "v-calm", title: "Calm", why: "Foo travel: Calm -1" }], rules: [{ id: "nn-debt", title: "No new debt", state: "unchecked" }] });
    expect(c).toEqual({ serves: ["Foo independence", "Freedom"], watch: ["Calm"], rules: [{ title: "No new debt", state: "unchecked" }] });
    expect(RULE_STATE_LABEL.unchecked).toBe("The Steward judges it");
  });
});
