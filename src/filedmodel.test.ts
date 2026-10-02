import { describe, expect, test } from "vitest";
import { filedIdOf, personName, radarGroups } from "./plansmodel";

describe("Today T2 and T3 helpers", () => {
  test("a filed marker at the end of a reply", () => {
    expect(filedIdOf("Noted.\n\n[filed:cabc1234]")).toBe("cabc1234");
    expect(filedIdOf("no marker [filed:x] in the middle of text")).toBeNull();
  });
  test("person ids read as names", () => {
    expect(personName("person/alex-reed")).toBe("Alex Reed");
    expect(personName(undefined)).toBe("");
  });
  test("the radar groups by kind, the most severe group first", () => {
    const g = radarGroups([
      { key: "a", kind: "domain", domain: "foo", text: "x", evidence: "e", severity: 1 },
      { key: "b", kind: "commitment", domain: "foo", text: "y", evidence: "e", severity: 4 },
      { key: "c", kind: "domain", domain: "bar", text: "z", evidence: "e", severity: 1 },
    ]);
    expect(g.map((x) => [x.kind, x.label, x.items.length])).toEqual([["commitment", "Promises", 1], ["domain", "Domains gone cold", 2]]);
  });
});
