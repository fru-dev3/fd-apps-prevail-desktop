import { beforeEach, describe, expect, it } from "vitest";
import { extractActIds, linkActsToThread, pendingActsForThread, sinceMs, stripActMarkers, waitingByDomain, waitingTaskIds, waitingThreadPaths, type WaitingItem } from "./waiting";
import { describeCron, toCron } from "./convschedule";
import { friendlyTool } from "./actcard";

const item = (over: Partial<WaitingItem>): WaitingItem => ({ kind: "act", id: "a1", domain: "career", summary: "Foo: bar", since: 1, ...over });

describe("act markers", () => {
  it("finds every marker once, in order, across the places a tool result lands", () => {
    const detail = "The action was held for your approval. [prevail-act:act_1]";
    expect(extractActIds("no marker here", detail, "again [prevail-act:act_1] and [prevail-act:act_2]", undefined)).toEqual(["act_1", "act_2"]);
  });
  it("hides the marker from what a person reads", () => {
    expect(stripActMarkers("Held for approval. [prevail-act:act_9]")).toBe("Held for approval.");
  });
});

describe("waiting views", () => {
  beforeEach(() => localStorage.clear());
  it("counts per domain, with domainless items under general", () => {
    expect(waitingByDomain([item({}), item({ id: "a2" }), item({ id: "a3", domain: "" })])).toEqual({ career: 2, general: 1 });
  });
  it("reads task ids from the task:<id> form", () => {
    expect([...waitingTaskIds([item({ kind: "task", id: "task:t_foo" }), item({ kind: "loop", id: "career:l1:0" })])]).toEqual(["t_foo"]);
  });
  it("marks a thread by its slug, or by a marker seen in it while the act is pending", () => {
    const threads = [{ path: "/v/_threads/foo.md", slug: "foo" }, { path: "/v/_threads/bar.md", slug: "bar" }];
    expect([...waitingThreadPaths([item({ thread: "foo" })], [], threads)]).toEqual(["/v/_threads/foo.md"]);
    linkActsToThread(["a9"], "/v/_threads/bar.md");
    expect(waitingThreadPaths([], [{ id: "a9", domain: "career", summary: "x", tool: "t" }], threads).has("/v/_threads/bar.md")).toBe(true);
    // Once it is answered (no longer pending) the link no longer marks the row.
    expect(waitingThreadPaths([], [], threads).size).toBe(0);
  });
  it("finds the pending acts that belong to the open thread", () => {
    const acts = [{ id: "a1", domain: "d", summary: "s", tool: "t", thread: "foo" }, { id: "a2", domain: "d", summary: "s", tool: "t" }];
    expect(pendingActsForThread(acts, "/v/_threads/foo.md").map((a) => a.id)).toEqual(["a1"]);
  });
  it("accepts since in seconds or milliseconds", () => {
    expect(sinceMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(sinceMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });
});

describe("conversation schedule cron", () => {
  it("maps the friendly picks to cron", () => {
    expect(toCron("daily", "08:30")).toBe("30 8 * * *");
    expect(toCron("weekdays", "17:05")).toBe("5 17 * * 1-5");
    expect(toCron("weekly", "09:00", 1)).toBe("0 9 * * 1");
    expect(toCron("custom", "", 0, " 0  7 * * 6 ")).toBe("0 7 * * 6");
    expect(toCron("custom", "", 0, "0 7 *")).toBeNull();
    expect(toCron("daily", "25:00")).toBeNull();
  });
  it("reads back in plain words", () => {
    expect(describeCron("30 8 * * *")).toBe("Daily at 8:30 AM");
    expect(describeCron("5 17 * * 1-5")).toBe("Weekdays at 5:05 PM");
    expect(describeCron("0 9 * * 1")).toBe("Mondays at 9:00 AM");
    expect(describeCron("*/5 * * * *")).toBe("*/5 * * * *");
  });
});

describe("friendlyTool", () => {
  it("names a connector tool plainly", () => {
    expect(friendlyTool("mcp__claude_ai_Foo__send_report")).toBe("Foo: send report");
    expect(friendlyTool("Bash")).toBe("Bash");
  });
});
