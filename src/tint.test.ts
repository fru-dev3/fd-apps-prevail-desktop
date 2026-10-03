// The one icon palette (tint.tsx): no yellow or gold, and a concept keeps
// its hue whether it is named by key or found by its icon.
import { describe, expect, it } from "vitest";
import { CalendarDays, Compass, FolderKanban, Inbox, MapPin, Package, Users, Watch, Zap } from "lucide-react";
import { TINT_HUE, tintColor, tintKey } from "./tint";

describe("tint palette", () => {
  it("never uses yellow or gold", () => {
    for (const [k, h] of Object.entries(TINT_HUE)) expect(h < 70 || h > 110, k).toBe(true);
    // An unknown icon gets a stable hue, also outside yellow.
    const hue = Number(/ (\d+)\)$/.exec(tintColor(tintKey(undefined, Zap)))![1]);
    expect(hue < 70 || hue > 110).toBe(true);
    expect(tintColor(tintKey(undefined, Zap))).toBe(tintColor(tintKey(undefined, Zap)));
  });
  it("a concept's icon resolves to the concept's own hue", () => {
    const pairs: [string, typeof Users][] = [["people", Users], ["places", MapPin], ["products", Package], ["things", Watch], ["events", CalendarDays], ["projects", FolderKanban], ["inbox", Inbox], ["compass", Compass]];
    for (const [k, icon] of pairs) expect(tintColor(tintKey(undefined, icon))).toBe(tintColor(k));
    // An unknown key falls back to the icon.
    expect(tintKey("person", Users)).toBe("people");
  });
});
