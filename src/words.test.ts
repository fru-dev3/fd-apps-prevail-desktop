import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Words (missions-plan.md; owner, 2026-10-02: "Mission is confusing to me"):
// the time-bound effort is shown as a Project (stored as a mission), the
// Compass keeps "Mission statement" and Purpose, and the prompt history by
// project is always "Prompt groups", never plain "Prompt projects".
const SRC = join(__dirname);
const files = readdirSync(SRC).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
const text = (f: string) => readFileSync(join(SRC, f), "utf8");

describe("words", () => {
  it("no UI label calls anything a Mission (except the Compass's Mission statement)", () => {
    const hits = files.flatMap((f) => [...text(f).matchAll(/(label|title|aria-label|placeholder)[:=]\s*"[^"]*\bMissions?\b(?! statement)[^"]*"|>[^<{]*\bMissions?\b(?! statement)[^<{]*</g)].map((m) => `${f}: ${m[0]}`));
    expect(hits).toEqual([]);
  });
  it("prompt groups are never called Prompt projects", () => {
    const hits = files.flatMap((f) => [...text(f).matchAll(/Prompt projects/g)].map((m) => `${f}: ${m[0]}`));
    expect(hits).toEqual([]);
  });
  it("the Compass page says Purpose, never Mission", () => {
    expect(text("compasspage.tsx")).not.toMatch(/"Mission"|>Mission</);
  });
});
