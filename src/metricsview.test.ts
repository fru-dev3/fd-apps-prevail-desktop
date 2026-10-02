import { describe, expect, test } from "vitest";
import { fmtValue, normalText } from "./metricsview";

describe("metrics labels", () => {
  test("values read in their unit", () => {
    expect(fmtValue(42.5, "usd")).toBe("$42.50");
    expect(fmtValue(1993.4, "usd")).toBe("$1,993");
    expect(fmtValue(2_450_000, "tokens")).toBe("2.5M");
    expect(fmtValue(2_618_200_000, "tokens")).toBe("2.6B");
    expect(fmtValue(95.6, "minutes")).toBe("96 min");
    expect(fmtValue(3, "count")).toBe("3");
  });
  test("a normal is a band, or says it is still learning", () => {
    expect(normalText({ median: 5, lo: 3, hi: 8, weeks: 8, learning: false, learningWeeksLeft: 0 }, "count")).toBe("normal 3 to 8");
    expect(normalText({ median: 0, lo: 0, hi: 0, weeks: 3, learning: true, learningWeeksLeft: 1 }, "usd")).toBe("learning your normal, 1 more week");
  });
});
