// The drafting failure message used to be "no questions drafted", which tells
// you to fix something without saying what. The engine knew; the UI took the
// wrong line.
import { describe, expect, it } from "vitest";
import { suggestFailureReason } from "./bench";

describe("why drafting failed", () => {
  it("reports the engine's diagnosis, not the summary that follows it", () => {
    const out = [
      "career: drafting…",
      "failed: career: nothing to draft from (no state, goals, config, soul, tasks, or threads)",
      "no questions drafted",
    ].join("\n");
    expect(suggestFailureReason(out)).toBe("nothing to draft from (no state, goals, config, soul, tasks, or threads)");
  });

  it("passes through a failed model call", () => {
    const out = "wealth: drafting…\nfailed: wealth: LLM call failed: Error: spawn claude ENOENT\nno questions drafted";
    expect(suggestFailureReason(out)).toContain("LLM call failed");
  });

  it("reports an unparseable reply as itself", () => {
    const out = "failed: health: could not parse LLM response as JSON\nno questions drafted";
    expect(suggestFailureReason(out)).toBe("could not parse LLM response as JSON");
  });

  it("falls back to the last real line when there is no failed: line", () => {
    expect(suggestFailureReason("something odd happened\nno questions drafted")).toBe("something odd happened");
  });

  it("never returns the bare summary, and never returns nothing", () => {
    expect(suggestFailureReason("no questions drafted")).toContain("returned nothing usable");
    expect(suggestFailureReason("")).toContain("returned nothing usable");
  });
});
