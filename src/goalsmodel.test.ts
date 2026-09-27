import { describe, expect, it } from "vitest";
import { goalsOf, idealSection, newGoalId, parseGoals, serializeGoals, setIdealSection, upsertGoal } from "./goalsmodel";

describe("goals.md", () => {
  const body = "# Goals\n\n- [ ] Run a foo marathon ~id:g-1 ~status:active ~due:2026-12-31 ~progress:40\n  why: Feel strong again.\n- [x] Ship the bar ~id:g-2\nA loose note.\n";

  it("reads goals with their fields and why line, keeping other lines", () => {
    const doc = parseGoals("health", body);
    const [a, b] = goalsOf(doc);
    expect(a).toMatchObject({ id: "g-1", domain: "health", title: "Run a foo marathon", status: "active", due: "2026-12-31", progress: 40, why: "Feel strong again." });
    expect(b).toMatchObject({ id: "g-2", title: "Ship the bar", status: "done", due: null, progress: null });
    expect(serializeGoals(doc)).toContain("# Goals\n\n- [ ] Run a foo marathon ~id:g-1 ~status:active ~due:2026-12-31 ~progress:40\n  why: Feel strong again.\n- [x] Ship the bar ~id:g-2 ~status:done\nA loose note.\n");
  });

  it("appends a new goal and round-trips it", () => {
    const id = newGoalId();
    const doc = upsertGoal(parseGoals("general", ""), { id, domain: "general", title: "New foo", status: "active", due: null, progress: null, why: "" });
    const text = serializeGoals(doc);
    expect(text).toBe(`- [ ] New foo ~id:${id} ~status:active\n`);
    expect(goalsOf(parseGoals("general", text))[0].title).toBe("New foo");
  });

  it("reads and writes the Mission section of the constitution", () => {
    const md = "# Ideal\n\n## Mission\n\nLive well.\n\n## Values\n\nBe kind.\n";
    expect(idealSection(md, "Mission")).toBe("Live well.");
    expect(idealSection(md, "Vision")).toBe("");
    const next = setIdealSection(md, "Mission", "Live very well.");
    expect(idealSection(next, "Mission")).toBe("Live very well.");
    expect(idealSection(next, "Values")).toBe("Be kind.");
    expect(idealSection(setIdealSection(md, "Vision", "A calm life."), "Vision")).toBe("A calm life.");
  });
});
