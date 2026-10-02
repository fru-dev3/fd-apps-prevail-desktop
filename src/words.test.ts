import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Words (missions-plan.md): "Mission" names the time-bound effort, never the
// Compass statement (that is Purpose), and missions are never called
// "Projects". Prompt projects are always "Prompt projects".
const SRC = join(__dirname);
const files = readdirSync(SRC).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
const text = (f: string) => readFileSync(join(SRC, f), "utf8");

describe("words", () => {
  it("no UI label calls anything plain Projects", () => {
    const hits = files.flatMap((f) => [...text(f).matchAll(/(label|title|aria-label)[:=]\s*"Projects"|>Projects</g)].map((m) => `${f}: ${m[0]}`));
    expect(hits).toEqual([]);
  });
  it("the Compass page says Purpose, never Mission", () => {
    expect(text("compasspage.tsx")).not.toMatch(/"Mission"|>Mission</);
  });
});
