import { describe, expect, it } from "vitest";
import { fatalLogText } from "./fatallog";

describe("fatalLogText", () => {
  it("keeps the class and frames, never the message", () => {
    const e = new TypeError("cannot read my private prompt text");
    e.stack = "TypeError: cannot read my private prompt text\n    at render (app.js:1:2)\nrender@app.js:3:4\nsecond line of the message";
    const out = fatalLogText("fatal", e);
    expect(out).toContain("fatal: TypeError");
    expect(out).toContain("at render (app.js:1:2)");
    expect(out).toContain("render@app.js:3:4");
    expect(out).not.toContain("private");
    expect(out).not.toContain("second line");
  });
  it("names a non-Error by its type only", () => {
    expect(fatalLogText("rejection", "secret reply")).not.toContain("secret");
  });
});
