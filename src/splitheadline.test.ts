import { describe, expect, it } from "vitest";
import { splitHeadline } from "./decisioninbox";

describe("splitHeadline", () => {
  it("keeps a short title whole", () => {
    expect(splitHeadline("Renew the foo card")).toEqual({ head: "Renew the foo card", rest: "" });
  });
  it("turns a long request into its first clause and the rest", () => {
    const t = "Decide on the stalled foo audit: it has been filed 3 times since July with no movement. Either keep it or pay someone.";
    expect(splitHeadline(t)).toEqual({ head: "Decide on the stalled foo audit", rest: "it has been filed 3 times since July with no movement. Either keep it or pay someone." });
  });
  it("cuts a long run-on at a word and keeps the full text below", () => {
    const t = "word ".repeat(40).trim();
    const r = splitHeadline(t);
    expect(r.head.endsWith("...")).toBe(true);
    expect(r.rest).toBe(t);
  });
});
