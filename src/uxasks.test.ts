// The owner's UX asks (2026-10-02): faces, drag handoff, the chat-first draft line.
import { describe, expect, test } from "vitest";
import { withHandoff, takePendingHandoff } from "./dragref";
import { LOOKS, avatarColor, lookOf } from "./specialistavatar";
import { draftFromFields, summaryBits } from "./missiondraft";

describe("specialist faces", () => {
  test("every built-in has its own color and face, and no hue is gold", () => {
    const keys = Object.values(LOOKS).map((l) => `${l.hue}:${l.eyes}:${(l.extra ?? []).join(",")}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const l of Object.values(LOOKS)) expect(l.hue > 68 && l.hue < 118).toBe(false);
  });
  test("a specialist the user made gets a stable look outside the gold band", () => {
    for (const id of ["budget-buddy", "foo", "bar-baz-qux", "z"]) {
      const l = lookOf(id);
      expect(lookOf(id)).toEqual(l);
      expect(l.hue > 68 && l.hue < 118).toBe(false);
    }
    expect(avatarColor("chief")).toBe("var(--color-accent)");
  });
});

describe("drag a specialist into the chat", () => {
  test("hands the message over once, like typing @Name", () => {
    expect(withHandoff("compare the foo carriers", "Researcher")).toBe("@Researcher compare the foo carriers");
    expect(withHandoff("@Researcher compare", "Researcher")).toBe("@Researcher compare");
    expect(withHandoff("", "Scout")).toBe("@Scout ");
    expect(withHandoff("@scout", "Scout")).toBe("@scout ");
  });
  test("a pending handoff is read once and goes stale after 20 seconds", () => {
    localStorage.setItem("prevail.chat.handoff", JSON.stringify({ label: "Writer", at: 1_000 }));
    expect(takePendingHandoff(5_000)).toBe("Writer");
    expect(takePendingHandoff(5_000)).toBeNull();
    localStorage.setItem("prevail.chat.handoff", JSON.stringify({ label: "Writer", at: 1_000 }));
    expect(takePendingHandoff(60_000)).toBeNull();
  });
});

describe("the chat-first draft line", () => {
  test("settled fields in reading order, short", () => {
    expect(summaryBits({ name: "Learn the cello", target: "2027-06-30", owner: "hobbies", consult: ["money"], budgetUsd: 1500, people: ["person/sam-foo"], milestones: [{ title: "x" }] }).map((b) => b.text))
      .toEqual(["Learn the cello", "by Jun 30, 2027", "Hobbies owns it", "reads Money", "$1,500", "with Sam Foo", "1 milestone"]);
    expect(summaryBits({})).toEqual([]);
  });
  test("the fields write back into the draft, keeping what the chat found", () => {
    expect(draftFromFields({ name: "A", specialists: ["coach"] }, { name: "Learn the cello", outcome: "", target: "2027-06-30", owner: "", budget: "40" }))
      .toEqual({ name: "Learn the cello", specialists: ["coach"], target: "2027-06-30", budgetUsd: 40 });
  });
});
