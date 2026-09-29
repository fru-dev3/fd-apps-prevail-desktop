import { describe, expect, it } from "vitest";
import { acceptedTarget, statusOf, trackedFor, type TrackedProject } from "./trackedprojects";
import { goalLine, parseGoals, goalsOf } from "./goalsmodel";

describe("tracked projects", () => {
  it("reads what an accepted suggestion made, whatever shape the engine answers in", () => {
    expect(acceptedTarget({ domain: "foo" }, { kind: "domain" })).toEqual({ domain: "foo" });
    expect(acceptedTarget({ domain: { slug: "foo" } }, { kind: "domain" })).toEqual({ domain: "foo" });
    expect(acceptedTarget({ project: { id: "project/foo-trip" } }, { kind: "project" })).toEqual({ project: "project/foo-trip" });
    expect(acceptedTarget({ project: "foo-trip" }, { kind: "project" })).toEqual({ project: "project/foo-trip" });
    expect(acceptedTarget({ id: "project/foo" }, { kind: "project" })).toEqual({ project: "project/foo" });
    expect(acceptedTarget({ archived: "foo" }, { kind: "archive_domain" })).toBeNull();
    expect(acceptedTarget(null, { kind: "domain" })).toBeNull();
  });

  it("treats an unknown status as active and finds the project an Intent project became", () => {
    expect(statusOf({})).toBe("active");
    expect(statusOf({ status: "paused" })).toBe("paused");
    const list = [{ id: "project/foo", intent_project: "foo-shop" }] as TrackedProject[];
    expect(trackedFor(list, "foo-shop")?.id).toBe("project/foo");
    expect(trackedFor(list, "bar")).toBeNull();
  });

  it("a goal keeps its ~project link through a parse and a write", () => {
    const [g] = goalsOf(parseGoals("general", "- [ ] Play a foo song ~id:g-1 ~status:active ~project:foo-piano\n"));
    expect(g.title).toBe("Play a foo song");
    expect(g.project).toBe("foo-piano");
    expect(goalLine(g)).toBe("- [ ] Play a foo song ~id:g-1 ~status:active ~project:foo-piano");
    expect(goalLine({ ...g, project: null })).toBe("- [ ] Play a foo song ~id:g-1 ~status:active");
  });
});
