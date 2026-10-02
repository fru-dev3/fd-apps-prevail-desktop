import { describe, expect, it } from "vitest";
import { acceptedTarget, daysLeftLabel, missionFor, ownerOf, rolesOf, slugOf, statusOf, type Mission } from "./missions";
import { goalLine, parseGoals, goalsOf } from "./goalsmodel";

describe("missions", () => {
  it("reads what an accepted suggestion made, whatever shape the engine answers in", () => {
    expect(acceptedTarget({ domain: "foo" }, { kind: "domain" })).toEqual({ domain: "foo" });
    expect(acceptedTarget({ domain: { slug: "foo" } }, { kind: "domain" })).toEqual({ domain: "foo" });
    expect(acceptedTarget({ project: { id: "mission/foo-trip" } }, { kind: "project" })).toEqual({ mission: "foo-trip" });
    expect(acceptedTarget({ project: "foo-trip" }, { kind: "project" })).toEqual({ mission: "foo-trip" });
    expect(acceptedTarget({ id: "project/foo" }, { kind: "project" })).toEqual({ mission: "foo" });
    expect(acceptedTarget({ archived: "foo" }, { kind: "archive_domain" })).toBeNull();
    expect(acceptedTarget(null, { kind: "domain" })).toBeNull();
  });

  it("old project ids, mission ids and chat keys all come down to the slug", () => {
    expect(slugOf("project/paint-the-shed")).toBe("paint-the-shed");
    expect(slugOf("mission/paint-the-shed")).toBe("paint-the-shed");
    expect(slugOf("_mission-paint-the-shed")).toBe("paint-the-shed");
    expect(statusOf({})).toBe("active");
    expect(statusOf({ status: "completed" })).toBe("completed");
  });

  it("roles, the prompt project a mission came from, and the countdown", () => {
    const m = { slug: "learn-the-cello", prompt_projects: ["foo-app"], status: "active", domains: [{ slug: "hobbies", role: "owner" }, { slug: "money", role: "consulted" }], progress: { days: { day: 3, total: 10, left: 7 } } } as unknown as Mission;
    expect(ownerOf(m)).toBe("hobbies");
    expect(rolesOf(m, "consulted")).toEqual(["money"]);
    expect(missionFor([m], "foo-app")?.slug).toBe("learn-the-cello");
    expect(missionFor([m], "bar")).toBeNull();
    expect(daysLeftLabel(m)).toBe("7d");
    expect(daysLeftLabel({ ...m, progress: { ...m.progress, days: { day: 1, total: 1, left: -2 } } })).toBe("2d over");
    expect(daysLeftLabel({ ...m, status: "paused" })).toBe("");
  });

  it("a goal keeps its ~project link through a parse and a write", () => {
    const [g] = goalsOf(parseGoals("general", "- [ ] Play a foo song ~id:g-1 ~status:active ~project:foo-piano\n"));
    expect(g.title).toBe("Play a foo song");
    expect(g.project).toBe("foo-piano");
    expect(goalLine(g)).toBe("- [ ] Play a foo song ~id:g-1 ~status:active ~project:foo-piano");
    expect(goalLine({ ...g, project: null })).toBe("- [ ] Play a foo song ~id:g-1 ~status:active");
  });
});
