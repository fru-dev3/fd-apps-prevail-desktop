// Guard for the type scale (typescale.tsx). The scale was tightened on
// 2026-10-02 because pages read too big:
//   detail title 26 -> 22px (display), section title 19 -> 15px semibold,
//   card headline 17 -> 15px, body 15px relaxed -> 14px normal leading,
//   meta 13 -> 12px, a score number 28 -> 24px; a list row title is 15px medium.
// So nothing below the page header may be set larger than 24px: Tailwind's
// text-3xl and up, and any arbitrary text-[Npx] over 24, fail unless the line
// is one of the explicitly allowed places below. The second test pins the
// scale itself, so a constant cannot drift back up unnoticed.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BODY, CARD_HEADLINE, DETAIL_TITLE, META, ROW_TITLE, SCORE, SECTION_TITLE } from "./typescale";

// The only places a larger size is allowed: the Home headline, the first
// launch welcome and the page header itself. Matched by file and a fragment
// of the line.
const ALLOWED: { file: string; line: string }[] = [
  { file: "chatpanel.tsx", line: "text-4xl sm:text-5xl" },
  { file: "shell.tsx", line: "text-5xl font-semibold leading-[0.95]" },
  { file: "sectionutil.tsx", line: "font-display text-[26px] font-semibold tracking-tight" },
];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return n.endsWith(".tsx") && !n.endsWith(".test.tsx") ? [p] : [];
  });
}

const px = (cls: string) => Number(/text-\[(\d+)px\]/.exec(cls)?.[1]);

describe("type scale", () => {
  it("no heading below the page header outranks the scale", () => {
    const bad: string[] = [];
    for (const p of tsxFiles(join(__dirname))) {
      const file = p.split("/").pop()!;
      readFileSync(p, "utf8").split("\n").forEach((line, i) => {
        const big = /\btext-(3|4|5|6|7|8|9)xl\b/.test(line);
        const over = [...line.matchAll(/\btext-\[(\d+)px\]/g)].some((m) => Number(m[1]) > 24);
        if (!big && !over) return;
        if (ALLOWED.some((a) => a.file === file && line.includes(a.line))) return;
        bad.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(bad, `oversized text:\n${bad.join("\n")}`).toEqual([]);
  });

  it("the scale itself stays quiet", () => {
    expect(px(DETAIL_TITLE)).toBe(22);
    expect(px(SECTION_TITLE)).toBeLessThanOrEqual(16);
    expect(px(ROW_TITLE)).toBe(15);
    expect(px(CARD_HEADLINE)).toBeLessThanOrEqual(16);
    expect(px(BODY)).toBe(14);
    expect(BODY).not.toContain("leading-relaxed");
    expect(px(META)).toBeGreaterThanOrEqual(12);
    expect(px(META)).toBeLessThanOrEqual(13);
    expect(px(SCORE)).toBeLessThanOrEqual(24);
  });
});
