import { describe, expect, it } from "vitest";
import { isNewer } from "./updatecheck";

describe("update badge version compare", () => {
  it("orders patch, minor and major numerically, not as strings", () => {
    expect(isNewer("0.3.119", "0.3.118")).toBe(true);
    expect(isNewer("0.3.118", "0.3.118")).toBe(false);
    expect(isNewer("0.3.9", "0.3.118")).toBe(false);   // "9" > "118" as strings
    expect(isNewer("0.4.0", "0.3.118")).toBe(true);
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
    expect(isNewer("v0.3.119", "0.3.118")).toBe(true);
  });
});
