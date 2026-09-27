import { describe, expect, it } from "vitest";
import { changeSummary, missionBlocks } from "./missioneditor";

describe("mission sections", () => {
  const md = "# Foo ideal\n\nLive well.\n\n## Operating Vision\n\nCalm days.\n\n## 1. Health\n\nMove daily.\n";
  it("splits into an intro and one block per ## section", () => {
    const b = missionBlocks(md);
    expect(b.map((x) => x.heading)).toEqual([null, "Operating Vision", "1. Health"]);
    expect(b[1].raw).toContain("Calm days.");
  });
  it("summarises what changed", () => {
    expect(changeSummary(md, md.replace("Move daily.", "Move every day."))).toBe("Changed 1. Health");
    expect(changeSummary("a b", "a b c d")).toBe("+2 words");
  });
});
