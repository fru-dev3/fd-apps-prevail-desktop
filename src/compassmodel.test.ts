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
  test("confirm makes a proposed goal active and leaves the rest as written", () => {
    const { doc, changes } = confirmLines(parseCompass(SAMPLE), "all");
    expect(changes).toEqual([{ id: "g-hike", from: "proposed", to: "active", reason: "confirmed", by: "user" }]);
    expect(serializeCompass(doc)).toBe(SAMPLE.replace("~id:g-hike ~status:proposed", "~id:g-hike ~status:active"));
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
