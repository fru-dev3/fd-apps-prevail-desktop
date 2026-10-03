import { describe, expect, test } from "vitest";
import { activeShare, appsIn, categoryTitle, healthTone, money, needsConfirm, needsFda, sourceState, stackSubtitle, type SourceRow, type Stack, type StackApp } from "./stackmodel";

const app = (id: string, category: string, d30 = 0): StackApp => ({ id, name: id, kind: "app", category, lifecycle: "in use", usage: d30 ? { id, active_days: { d7: 1, d30, d90: d30 }, minutes_30d: 0, device_minutes_30d: {}, web_visits_30d: 0, ai_sessions_30d: 0, trend: "flat", signals: [], hosts: [] } : null, monthly: null, health: null, verdict: "keep", why: [] });
const stack: Stack = { ts: 0, month_total: 1234.5, in_use: 2, apps: [app("foo-notes", "notes", 15), app("bar-ai", "ai-coding", 45), app("baz", "")], categories: [], archived_seen: [], unknown: 0, fda: [{ host: "mac-a", state: "needs-fda" }, { host: "mac-b", state: "ok" }], ai: { paid_monthly: null, api_equivalent: 0, value_multiple: null } };
const src = (o: Partial<SourceRow>): SourceRow => ({ id: "x", title: "X", wave: 2, reads: "r", never: "n", defaultOn: true, emits: [], on: true, decided: false, state: "ok", ...o });

describe("stack model", () => {
  test("subtitle, money and categories", () => {
    expect(stackSubtitle(stack)).toBe("$1,235 a month known · 2 in use");
    expect(money(9.5)).toBe("$9.50");
    expect(categoryTitle("ai-coding")).toBe("AI tools");
    expect(categoryTitle("")).toBe("Other");
    expect(appsIn(stack, "cat:notes").map((a) => a.id)).toEqual(["foo-notes"]);
    expect(appsIn(stack, "cat:ai-tools").map((a) => a.id)).toEqual(["bar-ai"]);
    expect(appsIn(stack, "all")).toHaveLength(3);
    expect(appsIn(null, "all")).toEqual([]);
  });
  test("usage share is capped; health tones; Full Disk Access hosts", () => {
    expect(activeShare(stack.apps[0]!.usage)).toBe(0.5);
    expect(activeShare(stack.apps[1]!.usage)).toBe(1);
    expect(activeShare(null)).toBe(0);
    expect(healthTone("ok")).toBe("good");
    expect(healthTone("degraded")).toBe("warn");
    expect(healthTone("ineligible")).toBe("bad");
    expect(healthTone(null)).toBe("none");
    expect(needsFda(stack)).toEqual(["mac-a"]);
  });
  test("sources: waves 3 and 4 ask before turning on; states in words", () => {
    expect(needsConfirm(src({ wave: 4 }), true)).toBe(true);
    expect(needsConfirm(src({ wave: 4 }), false)).toBe(false);
    expect(needsConfirm(src({ wave: 2 }), true)).toBe(false);
    expect(sourceState(src({ on: false }))).toBe("Off");
    expect(sourceState(src({ state: "needs-fda" }))).toBe("Needs Full Disk Access");
    expect(sourceState(src({ state: "something new" }))).toBe("something new");
  });
});
