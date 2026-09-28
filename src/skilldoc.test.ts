import { describe, expect, it } from "vitest";
import { metaValue, parseSkillDoc } from "./skilldoc";

describe("parseSkillDoc", () => {
  it("splits frontmatter into properties and strips HTML comments from the body", () => {
    const doc = parseSkillDoc([
      "---",
      "name: foo-review",
      'description: "Check the foo twice."',
      "category: work",
      "tags:",
      "  - foo",
      "  - bar",
      "---",
      "<!-- vault-context -->",
      "# Foo review",
      "",
      "Do it.",
    ].join("\n"));
    expect(metaValue(doc, "description")).toBe("Check the foo twice.");
    expect(doc.meta).toContainEqual(["tags", "foo, bar"]);
    expect(doc.body).toBe("# Foo review\n\nDo it.");
  });
  it("leaves a document without frontmatter as the body", () => {
    expect(parseSkillDoc("# Foo\nBody")).toEqual({ meta: [], body: "# Foo\nBody" });
  });
});
