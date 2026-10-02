// Pure helpers for Today T4 and Missions MS4.
import { describe, expect, test } from "vitest";
import { decisionStatus } from "./plansmodel";
import { pendingLabel } from "./missions";
import { chosenPaths } from "./missionspage";

describe("T4 and MS4 helpers", () => {
  test("a decision row says due, decided, or a retro owed", () => {
    expect(decisionStatus({ status: "decided", decided: "2026-06-01", retroDue: "2026-08-30" }, "2026-10-01")).toBe("retro owed");
    expect(decisionStatus({ status: "decided", decided: "2026-06-01", retroDue: "2026-08-30", retroRight: "gut" }, "2026-10-01")).toBe("decided 2026-06-01");
    expect(decisionStatus({ status: "open" }, "2026-10-01")).toBe("");
  });
  test("a pending event says whose move it is", () => {
    expect(pendingLabel({ status: "ask" })).toBe("hold waiting for your yes");
    expect(pendingLabel({ status: "ask", note: "not created: no calendar" })).toBe("hold waiting for your yes (not created: no calendar)");
    expect(pendingLabel({ status: "draft" })).toBe("draft, you send it");
    expect(pendingLabel({ status: "created" })).toBe("on your calendar");
  });
  test("the paths a mission can carry out: chosen or in trial, with their goal", () => {
    const text = "# Compass\n\n## Goals\n- [ ] Play for the family ~id:g-play ~status:active\n  path: Weekly foo lessons ~id:p-a ~status:chosen\n  path: Self taught ~id:p-b ~status:proposed\n  path: A trial ~id:p-c ~status:trial\n";
    expect(chosenPaths(text)).toEqual([{ id: "p-a", title: "Weekly foo lessons", goal: "Play for the family" }, { id: "p-c", title: "A trial", goal: "Play for the family" }]);
  });
});
