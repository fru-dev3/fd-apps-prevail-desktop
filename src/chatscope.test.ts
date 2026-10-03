import { describe, expect, it } from "vitest";
import { composerMessage, engineBuildsContext, engineKey, scopeOf } from "./chatscope";

// The ChatPanel scope (missions-plan MS1 leftover): a domain chat stops
// assembling its own context. With nothing added in the composer, the engine
// receives the typed text alone, which is the input of the engine's parity
// snapshot "domain turn" (scope-parity.test.ts): the context the model sees is
// byte-identical to the CLI's for the same domain.
const NONE = { plan: "", attach: "", primed: "", skills: "", history: "" };

describe("chat scope", () => {
  it("a domain chat sends the typed text alone, exactly the engine snapshot's input", () => {
    const s = scopeOf({ domain: "homestead" });
    expect(s).toEqual({ kind: "domain", slug: "homestead" });
    expect(engineBuildsContext(s)).toBe(true);
    expect(engineKey(s)).toBe("homestead");
    expect(composerMessage({ ...NONE, visible: "What should I do this weekend?" })).toBe("What should I do this weekend?");
  });
  it("only what the composer adds rides along: plan, files, context the user put in, skills, prior turns", () => {
    const m = composerMessage({ plan: "PLAN MODE: x\n\n", attach: "Attached files (read these as context):\n- /v/a.md\n\n", primed: "--- extra ---\nbody\n\n", skills: "", history: "User: hi\nAssistant: hello", visible: "next" });
    expect(m.startsWith("PLAN MODE: x\n\nAttached files")).toBe(true);
    expect(m).toContain("--- PRIOR TURNS ---\nUser: hi");
    expect(m.endsWith("User's next message: next")).toBe(true);
    for (const header of ["# THE USER'S IDEAL STATE", "# WHO YOU'RE HELPING", "# OMEGA", "Long-term memory", "# OUTPUT FORMAT"]) expect(m).not.toContain(header);
  });
  it("a project runs in its own space; General, an app and an entity keep the desktop prompt", () => {
    expect(engineKey(scopeOf({ domain: null, mission: { slug: "learn-the-foo", name: "Learn the foo" } }))).toBe("_mission-learn-the-foo");
    expect(engineBuildsContext(scopeOf({ domain: null }))).toBe(false);
    expect(engineBuildsContext(scopeOf({ domain: "homestead", scopeApp: { id: "paint-shop" } }))).toBe(false);
    expect(engineBuildsContext(scopeOf({ domain: null, entity: { id: "person/foo" } }))).toBe(false);
  });
});
