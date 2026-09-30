// General-to-domain routing: the pure helpers, the engine calls (mocked
// bridge) and the chip row. All text is invented.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ChatMessage } from "./types";

const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
let routeReply: unknown = null;
vi.mock("./bridge", () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "engine_route") return routeReply;
    if (cmd === "read_domain_ideal") return "Own two more rentals by 2028.";
    if (cmd === "read_memory_md") return "Prefers fixed-rate loans.";
    if (cmd === "domain_context") return { state: "Maple Court lease ends in March.", decisions: null, journal: null, recent_logs: [], skills: [] };
    return null;
  },
  listen: vi.fn(async () => () => {}),
  isBrowser: () => false,
}));

import { buildRoutedContext, correctRoute, decodeRouteTurns, encodeRouteTurns, filingOf, mergeRoute, readFilePlan, routeText, routeThreshold, routedOf, splitRoute, threadIdOf, threadRoutes } from "./routing";
import { FilingChips } from "./routechips";

afterEach(() => { cleanup(); calls.length = 0; localStorage.clear(); });

const user = (content: string, tagged?: string[]): ChatMessage => ({ role: "user", content, ts: 1, ...(tagged ? { domainRoute: { tagged, suggested: [] } } : {}) });
const asst = (content: string): ChatMessage => ({ role: "assistant", content, ts: 2 });

describe("routing helpers", () => {
  it("splits by the threshold and drops unknown domains", () => {
    const r = splitRoute({ domains: [{ slug: "real-estate", confidence: 0.9 }, { slug: "finance", confidence: 0.5 }, { slug: "boats", confidence: 0.99 }], reason: "", source: "model" }, 0.75, new Set(["real-estate", "finance"]));
    expect(r).toEqual({ tagged: ["real-estate"], suggested: [{ slug: "finance", confidence: 0.5 }] });
    expect(splitRoute(null, 0.75)).toEqual({ tagged: [], suggested: [] });
  });

  it("threshold defaults to 0.75 and reads the setting", () => {
    expect(routeThreshold()).toBe(0.75);
    localStorage.setItem("prevail.pref.routeThreshold", "0.6");
    expect(routeThreshold()).toBe(0.6);
    localStorage.setItem("prevail.pref.routeThreshold", "7");
    expect(routeThreshold()).toBe(0.75);
  });

  it("round-trips per-turn routes and unions thread routes", () => {
    const msgs = [user("rent?", ["real-estate"]), asst("..."), user("taxes too", ["finance", "real-estate"]), asst("..."), user("thanks", [])];
    const enc = encodeRouteTurns(msgs);
    expect(enc).toBe("0:real-estate;2:finance|real-estate;4:");
    const dec = decodeRouteTurns(enc);
    expect(dec.get(2)).toEqual(["finance", "real-estate"]);
    expect(dec.get(4)).toEqual([]);
    expect(threadRoutes(msgs)).toEqual(["real-estate", "finance"]);
  });

  it("thread id is the file stem", () => {
    expect(threadIdOf("/v/data/domains/general/memory/threads/2026-09-26_10-00-00_abcd1234.md")).toBe("2026-09-26_10-00-00_abcd1234");
    expect(threadIdOf(null)).toBeNull();
  });
});

describe("engine calls", () => {
  it("sends the text and thread to engine_route", async () => {
    routeReply = { domains: [{ slug: "finance", confidence: 0.8 }], reason: "loan", source: "model" };
    const r = await routeText("/v", "Refinance the duplex", "t-1");
    expect(r?.domains[0].slug).toBe("finance");
    expect(calls[0]).toEqual({ cmd: "engine_route", args: { vault: "/v", text: "Refinance the duplex", thread: "t-1", current: [], turn: null } });
  });

  it("a malformed reply means no answer", async () => {
    routeReply = { nope: true };
    expect(await routeText("/v", "hi", null)).toBeNull();
  });

  it("builds each routed domain's context from ideal state, memory and state", async () => {
    const ctx = await buildRoutedContext("/v", ["real-estate"]);
    expect(ctx).toContain("Real Estate");
    expect(ctx).toContain("Own two more rentals by 2028.");
    expect(ctx).toContain("Prefers fixed-rate loans.");
    expect(ctx).toContain("Maple Court lease ends in March.");
    expect(await buildRoutedContext("/v", [])).toBe("");
  });

  it("records a correction", async () => {
    correctRoute("/v", "t-9", ["finance"], ["real-estate"], "Refinance the duplex");
    await Promise.resolve();
    expect(calls).toContainEqual({ cmd: "engine_route_correct", args: { vault: "/v", thread: "t-9", domains: ["finance"], from: ["real-estate"], text: "Refinance the duplex" } });
  });
});

describe("filing", () => {
  const known = new Set(["finance", "health", "real-estate"]);
  const res = (o: object) => ({ domains: [], reason: "", source: "decision", ...o });

  it("files generously: the primary becomes home, secondaries are added", () => {
    const f = mergeRoute(null, res({ primary: "finance", secondary: ["health", "foo-unknown"], changed: true }), known);
    expect(f).toEqual({ home: "finance", also: ["health"] });
    expect(routedOf(f)).toEqual(["finance", "health"]);
    expect(filingOf(["finance", "health"])).toEqual(f);
    expect(filingOf([])).toBeNull();
  });

  it("a re-check only adds; the home never changes", () => {
    const prev = { home: "finance", also: [] };
    expect(mergeRoute(prev, res({ primary: "health", secondary: ["real-estate"], changed: true }), known)).toEqual({ home: "finance", also: ["real-estate"] });
    expect(mergeRoute(prev, res({ primary: "health", secondary: ["real-estate"], changed: false }), known)).toBe(prev);
    expect(mergeRoute(prev, res({ checked: false }), known)).toBe(prev);
  });

  it("unfiled carries three candidates; a failed route marks nothing", () => {
    const cands = [{ slug: "health", score: 0.3 }, { slug: "finance", score: 0.2 }, { slug: "real-estate", score: 0.1 }, { slug: "health", score: 0 }];
    expect(mergeRoute(null, res({ primary: null, unfiled: true, candidates: cands, changed: true }), known)?.candidates).toHaveLength(3);
    expect(mergeRoute(null, res({ source: "none", unfiled: false }), known)).toBeNull();
  });

  it("reads the plan object and its skipped count", async () => {
    routeReply = null;
    const plan = await readFilePlan("/v");
    expect(plan).toEqual({ rows: [], skipped: 0 });
  });
});

describe("FilingChips", () => {
  const domains = ["finance", "health", "real-estate"];

  it("shows home and also; remove, change home and add each report the new filing", () => {
    const onChange = vi.fn();
    render(<FilingChips filing={{ home: "real-estate", also: ["finance"] }} domains={domains} onChange={onChange} />);
    expect(screen.getByText("Filed in")).toBeTruthy();
    expect(screen.getByText("Also in")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remove Finance"));
    expect(onChange).toHaveBeenLastCalledWith({ home: "real-estate", also: [] });
    fireEvent.click(screen.getByTestId("filing-home"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Health/ }));
    expect(onChange).toHaveBeenLastCalledWith({ home: "health", also: ["finance"] });
    fireEvent.click(screen.getByLabelText("Add a domain"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Health/ }));
    expect(onChange).toHaveBeenLastCalledWith({ home: "real-estate", also: ["finance", "health"] });
  });

  it("unfiled shows candidates and one click files it; nothing shows before routing", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<FilingChips filing={null} domains={domains} onChange={onChange} />);
    expect(container.innerHTML).toBe("");
    rerender(<FilingChips filing={{ home: null, also: [], candidates: [{ slug: "health", score: 0.3 }, { slug: "finance", score: 0.2 }] }} domains={domains} onChange={onChange} />);
    expect(screen.getByText("Unfiled")).toBeTruthy();
    fireEvent.click(screen.getByText("Health"));
    expect(onChange).toHaveBeenCalledWith({ home: "health", also: [] });
  });
});
