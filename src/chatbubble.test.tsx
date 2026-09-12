// The assistant's turn header is the busiest row on a phone: a name, a model,
// a time and a live state, in 360px. It used to wrap into five lines and print
// NONE twice. These lock that down.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ChatBubble } from "./chatviews";
import type { ChatMessage } from "./types";

let phone = false;
vi.mock("./useisphone", () => ({ useIsPhone: () => phone, PHONE_MAX_PX: 767 }));

const base: ChatMessage = {
  role: "assistant",
  content: "",
  ts: new Date("2026-09-12T07:35:00").getTime(),
  cli: "claude",
  model: "opus-5",
  streaming: true,
};

function draw(msg: Partial<ChatMessage>) {
  render(<ChatBubble msg={{ ...base, ...msg } as ChatMessage} />);
}

beforeEach(() => { cleanup(); phone = false; });

describe("assistant turn header", () => {
  it("never prints a NONE chip: none is the id for 'no framework'", () => {
    draw({ framework: "none", lens: "NONE" });
    expect(screen.queryByText(/none/i)).toBeNull();
  });

  it("still shows a framework and lens that were actually applied", () => {
    draw({ framework: "first-principles", lens: "skeptic" });
    expect(screen.getByText("first-principles")).toBeTruthy();
    expect(screen.getByText("skeptic")).toBeTruthy();
  });

  it("on a phone drops the word Assistant, the chips, and the date", () => {
    phone = true;
    draw({ framework: "first-principles", lens: "skeptic" });
    // The avatar already says who is talking.
    expect(screen.queryByText("Assistant")).toBeNull();
    // Chips are desktop-only: the row has no width for them.
    expect(screen.queryByText("first-principles")).toBeNull();
    expect(screen.queryByText("skeptic")).toBeNull();
    // The clock, not "Sep 12 at 7:35 AM", which wrapped to three lines.
    expect(screen.queryByText(/Sep 12 at/)).toBeNull();
  });

  it("says it is thinking while streaming, and writing once text arrives", () => {
    phone = true;
    draw({ content: "" });
    expect(screen.getByText("thinking")).toBeTruthy();
    cleanup();
    draw({ content: "partial answer" });
    expect(screen.getByText("writing")).toBeTruthy();
  });
});
