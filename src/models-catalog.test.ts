// The curated model catalog is what every picker in the app renders, and it is
// hand-maintained (the subscription CLIs expose no machine-readable model
// list). These tests pin the Sep 2026 lineup and the two helper bugs the new
// model names exposed.

import { describe, expect, it } from "vitest";
import { DEAD_MODELS, DEAD_MODEL_REPLACEMENT, MODELS, vendorOfModelId } from "./constants";
import { prettyModelId } from "./helpers2";

describe("model catalog", () => {
  it("offers the Claude aliases, fable included", () => {
    const byId = Object.fromEntries(MODELS.claude.map((m) => [m.id, m]));
    expect(byId.opus?.label).toBe("Opus 5");
    expect(byId.fable?.label).toBe("Fable 5.1");
    expect(byId.sonnet?.label).toBe("Sonnet 5");
    expect(byId.haiku?.label).toBe("Haiku 4.5");
    // The alias ids auto-upgrade, so each records what it resolves to today.
    expect(byId.fable?.resolved).toBe("claude-fable-5-1");
  });

  it("offers the current Codex models and no retired ones", () => {
    const ids = MODELS.codex.map((m) => m.id);
    expect(ids).toContain("gpt-5.6-sol");
    expect(ids).toContain("gpt-6-astra");
    for (const retired of ["gpt-5.4", "gpt-5.4-mini", "gpt-5-codex", "gpt-5"]) {
      expect(ids).not.toContain(retired);
    }
  });

  it("offers Gemini 3.8 and drops the 3.5 Flash models agy no longer lists", () => {
    const ids = MODELS.antigravity.map((m) => m.id);
    expect(ids).toContain("Gemini 3.8 Flash (High)");
    expect(ids).not.toContain("Gemini 3.5 Flash (High)");
  });

  it("never lists a model that is also marked dead", () => {
    const offenders: string[] = [];
    for (const [cli, picks] of Object.entries(MODELS)) {
      for (const p of picks) if (DEAD_MODELS.has(p.id)) offenders.push(`${cli}:${p.id}`);
    }
    expect(offenders).toEqual([]);
  });

  it("heals a dead pick to its OWN vendor's replacement", () => {
    expect(DEAD_MODEL_REPLACEMENT[vendorOfModelId("claude-opus-4-7")]).toBe("opus");
    expect(DEAD_MODEL_REPLACEMENT[vendorOfModelId("gpt-5.4")]).toBe("gpt-5.6-sol");
    expect(DEAD_MODEL_REPLACEMENT[vendorOfModelId("Gemini 3.5 Flash (High)")]).toBe("Gemini 3.8 Flash (High)");
  });
});

describe("prettyModelId", () => {
  it("renders the current model ids without shouting", () => {
    expect(prettyModelId("claude-opus-5")).toBe("Opus 5");
    expect(prettyModelId("claude-fable-5-1")).toBe("Fable 5.1");
    expect(prettyModelId("claude-sonnet-5")).toBe("Sonnet 5");
    expect(prettyModelId("gpt-6-astra")).toBe("GPT-6 Astra");
    expect(prettyModelId("gpt-5.6-sol")).toBe("GPT-5.6 Sol");
    expect(prettyModelId("gpt-5.5")).toBe("GPT-5.5");
  });

  it("still handles the older shapes", () => {
    expect(prettyModelId("claude-opus-4-8")).toBe("Opus 4.8");
    expect(prettyModelId("llama-3.2")).toBe("Llama 3.2");
  });
});
