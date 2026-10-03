import { describe, expect, test } from "vitest";
import { chiefName } from "./chiefofstaff";

describe("chiefName", () => {
  test("reads the frontmatter name", () => {
    expect(chiefName("---\nname: Foo Bar\nvoice: plain\n---\n## Limits\n")).toBe("Foo Bar");
  });
  test("no file, no frontmatter or an empty name is null", () => {
    expect(chiefName("")).toBeNull();
    expect(chiefName("name: Foo")).toBeNull();
    expect(chiefName("---\nname:\n---\n")).toBeNull();
    expect(chiefName(`---\nname: ${"x".repeat(41)}\n---\n`)).toBeNull();
  });
});
