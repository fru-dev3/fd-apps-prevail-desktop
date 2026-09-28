import { describe, expect, it } from "vitest";
import { errorSentence, stripAnsi } from "./helpers";

describe("stripAnsi", () => {
  it("removes real escape codes, glyph-escaped ones and bare leftovers", () => {
    expect(stripAnsi("\x1b[33mfoo\x1b[0m")).toBe("foo");
    expect(stripAnsi("⌧[33mfoo⌧[39m bar")).toBe("foo bar");
    expect(stripAnsi("[1;31mfoo[0m")).toBe("foo");
  });
});

describe("errorSentence", () => {
  it("turns a raw runtime error into one plain sentence and keeps the full text", () => {
    const raw = "exit 1: ⌧[33m\"foo\" isn't described by this version's model catalog; update the app, or map it⌧[39m";
    const { sentence, full } = errorSentence(raw);
    expect(sentence).toBe("\"foo\" isn't described by this version's model catalog.");
    expect(full).not.toMatch(/\[\d+m/);
    expect(full).toContain("update the app");
  });
  it("never returns an empty sentence", () => {
    expect(errorSentence("").sentence).toBe("Something went wrong.");
  });
});
