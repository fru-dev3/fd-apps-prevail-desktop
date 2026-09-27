// Guard for the type scale (typescale.tsx): nothing below the page header may
// be set larger than the scale allows. Tailwind's text-4xl and up, and any
// arbitrary text-[Npx] over 28px, fail the build unless the line is one of the
// explicitly allowed heroes below.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The only places a hero size is allowed: the Home headline and the first
// launch welcome. Matched by file and a fragment of the line.
const ALLOWED: { file: string; line: string }[] = [
  { file: "chatpanel.tsx", line: "text-4xl sm:text-5xl" },
  { file: "shell.tsx", line: "text-5xl font-semibold leading-[0.95]" },
];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return n.endsWith(".tsx") && !n.endsWith(".test.tsx") ? [p] : [];
  });
}

describe("type scale", () => {
  it("no heading below the page header outranks the scale", () => {
    const bad: string[] = [];
    for (const p of tsxFiles(join(__dirname))) {
      const file = p.split("/").pop()!;
      readFileSync(p, "utf8").split("\n").forEach((line, i) => {
        const big = /\btext-(4|5|6|7|8|9)xl\b/.test(line);
        const px = [...line.matchAll(/\btext-\[(\d+)px\]/g)].some((m) => Number(m[1]) > 28);
        if (!big && !px) return;
        if (ALLOWED.some((a) => a.file === file && line.includes(a.line))) return;
        bad.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(bad, `oversized text:\n${bad.join("\n")}`).toEqual([]);
  });
});
