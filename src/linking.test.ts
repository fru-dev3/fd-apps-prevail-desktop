// Linking: the `touched` event parser and "Your things" selection.
import { describe, expect, it } from "vitest";
import { isYours, parseTouched, yoursIn } from "./linking";
import type { EntitySummary } from "./entitystore";

describe("parseTouched", () => {
  it("keeps domains with a slug and entity ids, and drops junk", () => {
    expect(parseTouched({ thread: "t1", domains: [{ slug: "insurance", fact: "Claim open" }, { fact: "no slug" }, "legal", 7], entities: ["place/foo-way", "nope", 3] }))
      .toEqual({ thread: "t1", domains: [{ slug: "insurance", fact: "Claim open" }, { slug: "legal" }], entities: ["place/foo-way"] });
  });
  it("is null when nothing was touched", () => {
    expect(parseTouched({ domains: [], entities: [] })).toBeNull();
    expect(parseTouched({})).toBeNull();
  });
});

describe("relations", () => {
  const e = (id: string, relation?: "yours" | "reference", home_domain?: string, conversations = 1) =>
    ({ id, name: id, kind: "person", aliases: [], mention_count: 1, conversations, last_ts: 1, saved: false, has_page: false, relation, home_domain }) as EntitySummary;
  it("treats an unclassified entity as yours, a reference as not", () => {
    expect(isYours(e("person/a"))).toBe(true);
    expect(isYours(e("person/a", "reference"))).toBe(false);
  });
  it("Your things are the explicitly yours entities homed in the domain, most discussed first", () => {
    const list = [e("person/a", "yours", "insurance", 1), e("person/b", "yours", "insurance", 5), e("person/c", "reference", "insurance"), e("person/d", "yours", "legal"), e("person/e")];
    expect(yoursIn(list, "insurance").map((x) => x.id)).toEqual(["person/b", "person/a"]);
  });
});
