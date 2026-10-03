import { describe, expect, test } from "vitest";
import { confirmLines, dropLines, fieldOf, items, missionOf, parseCompass, proposedCount, serializeCompass } from "./compassmodel";

// The same sample the engine's compass.test.ts round-trips: both repos must
// read and write the file the same way.
const SAMPLE = `# Compass

Some intro the user wrote.

## Mission
Live a calm foo life.

## Values
- Peace of mind ~id:v-peace ~rank:2 ~tier:1
  words: "Grow foo while preserving peace of mind."
  enough: calm 4 of 5 most weeks
  signal: checkin.calm . cash_months
- Freedom ~id:v-freedom ~rank:1
  words: "So work becomes a choice."
- Faith ~id:v-faith ~rank:3 ~local

## Roles
- Parent ~id:r-parent ~people:person/sam-rivera ~weight:high
  hope: "Present at dinner."

## Goals
- [ ] Bar independence ~id:g-fi ~serves:v-freedom,v-peace ~status:active ~due:2028-12-31 ~domain:wealth
  why: "Work as a choice."
  path: Foo equity ~id:p-equity ~status:chosen ~until:2027-06-30
    expect: offer by 2027-03
    stop: calm under 3 of 5 for 6 weeks
  path: Weekly bar channel ~id:p-weekly ~status:rejected
    because: breaks v-peace
- [ ] Hike the foo trail ~id:g-hike ~status:proposed

## Non-negotiables
- Home for dinner 5 nights a week ~id:nn-dinner ~check:dinners_home_wk>=5
  words: "Home for dinner."

## Negotiables
- Stay near the bay ~id:ng-bay
  trade: "Would move for the right role."

## Capacity
- hours_for_goals_wk: 10

## Something new
A line the app does not know.
`;

describe("compassmodel", () => {
  test("round trip is byte for byte", () => {
    expect(serializeCompass(parseCompass(SAMPLE))).toBe(SAMPLE);
  });
  test("parses items, tokens, flags, fields and paths", () => {
    const doc = parseCompass(SAMPLE);
    expect(items(doc, "value").map((v) => v.id)).toEqual(["v-peace", "v-freedom", "v-faith"]);
    expect(items(doc, "value")[2].flags).toEqual(["local"]);
    expect(fieldOf(items(doc, "value")[0], "words")).toBe("Grow foo while preserving peace of mind.");
    const fi = items(doc, "goal")[0];
    expect(fi.paths.map((p) => p.id)).toEqual(["p-equity", "p-weekly"]);
    expect(fi.tokens).toMatchObject({ serves: "v-freedom,v-peace", due: "2028-12-31" });
    expect(missionOf(doc)?.text).toBe("Live a calm foo life.");
    expect(proposedCount(doc)).toBe(1);
  });
  test("confirm makes a proposed goal the user's (active only after its WOOP) and leaves the rest as written", () => {
    const { doc, changes } = confirmLines(parseCompass(SAMPLE), "all");
    expect(changes).toEqual([{ id: "g-hike", from: "proposed", to: "confirmed", reason: "confirmed", by: "user" }]);
    expect(serializeCompass(doc)).toBe(SAMPLE.replace("~id:g-hike ~status:proposed", "~id:g-hike ~status:confirmed"));
  });
  test("drop removes only a proposed line, with its words as evidence", () => {
    const body = SAMPLE.replace("- Faith ~id:v-faith ~rank:3 ~local", "- Faith ~id:v-faith ~rank:3 ~status:proposed\n  words: \"Faith matters.\"");
    const { doc, changes } = dropLines(parseCompass(body), ["v-faith", "v-peace"]);
    expect(changes).toEqual([{ id: "v-faith", from: "proposed", to: "dropped", reason: "dropped", evidence: ["Faith", "Faith matters."], by: "user" }]);
    expect(serializeCompass(doc)).not.toContain("Faith");
    expect(serializeCompass(doc)).toContain("Peace of mind");
  });
  test("an empty file parses to nothing and writes nothing new", () => {
    expect(items(parseCompass(""))).toEqual([]);
    expect(proposedCount(parseCompass(""))).toBe(0);
  });
});

describe("WOOP", () => {
  test("a goal with outcome, obstacle and an if-then plan goes active on confirm; a low expectation is a small trial", () => {
    const g = (extra: string) => parseCompass(`# Compass\n\n## Goals\n- [ ] Hike ~id:g-h ~status:proposed\n${extra}`);
    const full = '  outcome: "on top"\n  obstacle: "weekends fill"\n  plan: "if a Saturday is free, then I hike"\n';
    expect(confirmLines(g(full), "all").changes[0]!.to).toBe("active");
    expect(confirmLines(g(`${full}  expect: 2\n`), "all").changes[0]!.to).toBe("prototyping");
    expect(confirmLines(g('  outcome: "on top"\n'), "all").changes[0]!.to).toBe("confirmed");
  });
  test("reads ## Purpose, and an older ## Mission heading the same", () => {
    const a = parseCompass("# Compass\n\n## Purpose\nMake foo things that last.\n\n## Values\n");
    const b = parseCompass("# Compass\n\n## Mission\nMake foo things that last.\n\n## Values\n");
    expect(missionOf(a)?.text).toBe("Make foo things that last.");
    expect(missionOf(b)?.text).toBe("Make foo things that last.");
  });
});

describe("the Compass chain (schema 2)", () => {
  const CHAIN = `# Compass
~schema:2

## Purpose
Live a calm foo life.

## Values
- Peace of mind ~id:v-peace ~rank:1

## Mission statement
- Build calm foo tools for families ~id:st-tools ~serves:v-peace

## Vision
- A foo home that runs on its own ~id:vi-home

## Objectives
- Twelve months of costs in cash ~id:o-cash ~metric:cash_months ~target:12

## Goals
- [ ] Bar cash buffer ~id:g-buffer ~objective:o-cash ~status:active
  initiative: Automatic foo savings ~id:p-auto ~status:chosen
    expect: a transfer every month
`;
  test("statement, vision and objectives parse; initiative: lines are the goal's; untouched round-trips byte for byte", () => {
    const doc = parseCompass(CHAIN);
    expect(items(doc, "statement").map((x) => x.tokens.serves)).toEqual(["v-peace"]);
    expect(items(doc, "vision")[0]!.id).toBe("vi-home");
    expect(items(doc, "objective")[0]!.tokens).toMatchObject({ metric: "cash_months", target: "12" });
    expect(items(doc, "goal")[0]!.paths.map((p) => `${p.id}:${p.fields[0]!.value}`)).toEqual(["p-auto:a transfer every month"]);
    expect(serializeCompass(doc)).toBe(CHAIN);
  });
  test("old path: lines read the same as initiative:, and a changed goal writes initiative:", () => {
    const old = parseCompass(CHAIN.replace("initiative:", "path:"));
    expect(items(old, "goal")[0]!.paths).toEqual(items(parseCompass(CHAIN), "goal")[0]!.paths);
    const g = items(old, "goal")[0]!;
    g.dirty = true;
    expect(serializeCompass(old)).toContain("  initiative: Automatic foo savings ~id:p-auto ~status:chosen\n    expect: a transfer every month");
  });
  test("in a schema 2 file ## Mission is the mission statement, never the purpose", () => {
    const doc = parseCompass("# Compass\n~schema:2\n\n## Purpose\nFoo.\n\n## Mission\n- Make bar for foo ~id:st-x\n");
    expect(missionOf(doc)?.text).toBe("Foo.");
    expect(items(doc, "statement").map((x) => x.id)).toEqual(["st-x"]);
  });
});

import { addLine, archiveLine, changeText, deleteLine, editLine, isArchived } from "./compassmodel";

describe("editing lines", () => {
  const base = parseCompass("# Compass\n~schema:2\n\n## Purpose\n\n## Values\n- Calm ~id:v-calm ~rank:1\n\n## Roles\n- Coach ~id:r-coach ~status:proposed\n");
  test("add puts a dated line in its section, ranked last for a value, and says so in the ledger", () => {
    const r = addLine(base, "value", "  Craft  ", Date.parse("2026-10-02T12:00:00Z"));
    const v = items(r.doc, "value").find((x) => x.id === r.id)!;
    expect(v).toMatchObject({ title: "Craft", tokens: { added: "2026-10-02", rank: "2" } });
    expect(r.changes).toEqual([{ id: "v-craft", from: "", to: "Craft", reason: "added", by: "user" }]);
    const g = addLine(base, "goal", "Open a foo cafe");
    expect(serializeCompass(g.doc)).toContain("## Goals\n\n- [ ] Open a foo cafe ~id:g-open-a-foo-cafe");
    expect(addLine(base, "value", "Calm").id).toBe("v-calm-2");
  });
  test("edit keeps before and after; a drafted line the user rewrites becomes theirs", () => {
    const r = editLine(base, "r-coach", "Coach of the foo team");
    expect(items(r.doc, "role")[0]).toMatchObject({ title: "Coach of the foo team", tokens: {} });
    expect(r.changes.map((c) => c.reason)).toEqual(["edited", "edited"]);
    expect(changeText({ ts: 1, ...r.changes[0] })).toEqual({ what: "Edited", before: "Coach", after: "Coach of the foo team" });
    const p = editLine(base, "mission", "Live a calm foo life.");
    expect(missionOf(p.doc)!.text).toBe("Live a calm foo life.");
    expect(serializeCompass(p.doc)).toContain("## Purpose\n\nLive a calm foo life.\n");
  });
  test("archive keeps the line out of use and back again; delete removes it with its words in the ledger", () => {
    const a = archiveLine(base, "v-calm");
    expect(isArchived(items(a.doc, "value")[0])).toBe(true);
    expect(isArchived(items(archiveLine(a.doc, "v-calm", false).doc, "value")[0])).toBe(false);
    const d = deleteLine(base, "v-calm");
    expect(items(d.doc, "value")).toEqual([]);
    expect(d.changes[0]).toMatchObject({ from: "Calm", reason: "deleted" });
    expect(deleteLine(base, "nope").changes).toEqual([]);
  });
});

import { chainUp, type ChainTree } from "./compasschain";
describe("a goal's chain up", () => {
  test("goal > objective > vision > statement > purpose, values skipped", () => {
    const n = (id: string, level: string, parents: string[]) => ({ id, level, title: id, status: "confirmed", parents, children: [], linked: true });
    const tree = { schema: 2, levels: [], domainGoals: { total: 0, linked: 0 }, tasks: { open: 0, linked: 0 }, nodes: [
      n("purpose", "purpose", []), n("v-a", "value", ["purpose"]), n("st", "statement", ["v-a"]), n("vi", "vision", ["st"]), n("o", "objective", ["vi"]), n("g", "goal", ["o"]),
    ] } as unknown as ChainTree;
    expect(chainUp(tree, "g").map((x) => x.id)).toEqual(["o", "vi", "st", "purpose"]);
    expect(chainUp(tree, "purpose")).toEqual([]);
  });
});
