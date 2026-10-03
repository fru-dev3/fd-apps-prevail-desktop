import { describe, expect, test } from "vitest";
import { barPct, seasonLine, WHO5_ITEMS, WHO5_SCALE } from "./qualmodel";

describe("qualitative model", () => {
  test("bars, seasons and the WHO-5 shape", () => {
    expect(barPct(5)).toBe(100);
    expect(barPct(2.5)).toBe(50);
    expect(barPct(9)).toBe(100);
    expect(barPct(null)).toBe(0);
    expect(seasonLine({ id: "s", title: "T", from: "2026-09-26", to: "2026-10-04", pauses: ["m-a"], auto: true })).toBe("2026-09-26 to 2026-10-04, pauses 1 metric (found from days away)");
    expect(seasonLine({ id: "s", title: "T", from: "a", to: "b", pauses: "all" })).toBe("a to b, pauses every target");
    expect(WHO5_ITEMS).toHaveLength(5);
    expect(WHO5_SCALE).toHaveLength(6);
  });
});
