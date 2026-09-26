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

import { buildRoutedContext, correctRoute, decodeRouteTurns, encodeRouteTurns, routeText, routeThreshold, splitRoute, threadIdOf, threadRoutes } from "./routing";
import { RouteChips } from "./routechips";

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
    expect(calls[0]).toEqual({ cmd: "engine_route", args: { vault: "/v", text: "Refinance the duplex", thread: "t-1" } });
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

describe("RouteChips", () => {
  const domains = ["finance", "health", "real-estate"];

  it("shows tagged chips and corrects on remove and undo", () => {
    const onChange = vi.fn();
    render(<RouteChips route={{ tagged: ["real-estate", "finance"], suggested: [] }} domains={domains} onChange={onChange} />);
    expect(screen.getByText("Real Estate")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remove Finance"));
    expect(onChange).toHaveBeenLastCalledWith(["real-estate"]);
    fireEvent.click(screen.getByLabelText("Undo: keep this in General"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("offers a below-threshold domain as a quiet suggestion", () => {
    const onChange = vi.fn();
    render(<RouteChips route={{ tagged: [], suggested: [{ slug: "health", confidence: 0.6 }] }} domains={domains} onChange={onChange} />);
    fireEvent.click(screen.getByText("Health?"));
    expect(onChange).toHaveBeenCalledWith(["health"]);
  });

  it("change menu toggles domains; pending shows nothing", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<RouteChips route={{ tagged: [], suggested: [], pending: true }} domains={domains} onChange={onChange} />);
    expect(container.innerHTML).toBe("");
    rerender(<RouteChips route={{ tagged: ["finance"], suggested: [] }} domains={domains} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Change domains"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Health/ }));
    expect(onChange).toHaveBeenCalledWith(["finance", "health"]);
  });
});
