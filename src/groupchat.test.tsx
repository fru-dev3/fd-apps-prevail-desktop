// Group chat: reply metadata survives the thread file, the join/leave log
// reads back, and a reply's header names who spoke (never "Assistant").
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { appendMemberLog, decodeTurnMeta, parseMemberLog } from "./groupchat";
import { ChatBubble } from "./chatviews";

vi.mock("./useisphone", () => ({ useIsPhone: () => false, PHONE_MAX_PX: 767 }));
beforeEach(() => cleanup());

describe("group chat records", () => {
  it("reads a turn's metadata and drops anything malformed", () => {
    expect(decodeTurnMeta('{"speaker":"planner","name":"Planner","members":["planner","BAD id"],"scope":"General","context":["Foo app"]}'))
      .toEqual({ speaker: "planner", name: "Planner", members: ["planner"], scope: "General", context: ["Foo app"] });
    expect(decodeTurnMeta("not json")).toBeUndefined();
    expect(decodeTurnMeta('{"name":"x"}')).toBeUndefined();
  });
  it("logs joins and leaves by message, and a join undone at once leaves no trace", () => {
    let log = appendMemberLog("", "researcher", true, 0);
    log = appendMemberLog(log, "planner", true, 2);
    log = appendMemberLog(log, "planner", false, 2);
    log = appendMemberLog(log, "researcher", false, 4);
    expect(log).toBe("+researcher@0;-researcher@4");
    expect(parseMemberLog(`${log};junk;+Evil@1`)).toEqual([{ id: "researcher", joined: true, at: 0 }, { id: "researcher", joined: false, at: 4 }]);
  });
});

describe("reply header", () => {
  const base = { role: "assistant" as const, content: "Three foo options.", ts: Date.now(), cli: "claude", model: "opus-5" };
  it("names the specialist who answered, with the members, scope and context", () => {
    render(<ChatBubble chief="Quill" msg={{ ...base, meta: { speaker: "researcher", name: "Researcher", members: ["researcher", "planner"], scope: "General", context: ["Foo app", "notes.md"] } }} />);
    expect(screen.getByTestId("reply-speaker").textContent).toBe("Researcher");
    expect(screen.getByTestId("reply-meta").textContent).toContain("General");
    expect(screen.getByTestId("reply-meta").textContent).toContain("+2 context");
    expect(screen.getByTestId("reply-meta-full").textContent).toContain("In the chat: Researcher, Planner");
    expect(screen.queryByText("Assistant")).toBeNull();
  });
  it("a reply with no speaker is the chief of staff, by the user's chosen name", () => {
    render(<ChatBubble chief="Quill" msg={base} />);
    expect(screen.getByTestId("reply-speaker").textContent).toBe("Quill");
    expect(screen.getByTestId("reply-speaker").getAttribute("data-speaker")).toBe("chief");
  });
});
