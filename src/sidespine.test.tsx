// The collapsible spine shared by Intent's Noticed, History and Projects.
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { ClipboardCopy } from "lucide-react";
import { SideSpine, SpineColumn } from "./sidespine";
import { RowAction, RowActions, ROW_ACTION_CONFIRM_MS } from "./rowaction";

const KEY = "test.spine";
const view = (key = KEY) => (
  <SideSpine storageKey={key} title="Weeks" label="periods" testId="the-spine" detail={<p>detail body</p>}>
    <ul><li>Sep 21 to 27</li></ul>
  </SideSpine>
);

beforeEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

describe("SideSpine", () => {
  it("collapses to a thin strip with an open button, and the detail takes the width", () => {
    render(view());
    expect(screen.getByTestId("the-spine").className).toContain("w-72");
    expect(screen.getByText("Weeks")).toBeTruthy();
    expect(screen.getByTestId("spine-detail").getAttribute("data-spine")).toBe("open");
    fireEvent.click(screen.getByLabelText("Collapse periods"));
    expect(screen.queryByTestId("the-spine")).toBeNull();
    expect(screen.queryByText("Sep 21 to 27")).toBeNull();
    const strip = screen.getByTestId("spine-collapsed");
    expect(strip.className).toContain("w-9");
    const detail = screen.getByTestId("spine-detail");
    expect(detail.getAttribute("data-spine")).toBe("collapsed");
    expect(detail.className).toContain("flex-1");
    expect(detail.textContent).toBe("detail body");
    fireEvent.click(screen.getByLabelText("Show periods"));
    expect(screen.getByTestId("the-spine")).toBeTruthy();
    expect(screen.queryByTestId("spine-collapsed")).toBeNull();
  });

  it("remembers the state per key", () => {
    render(view());
    fireEvent.click(screen.getByLabelText("Collapse periods"));
    expect(localStorage.getItem(KEY)).toBe("1");
    cleanup();
    render(view());
    expect(screen.getByTestId("spine-collapsed")).toBeTruthy();
    cleanup();
    render(view("other.spine"));
    expect(screen.getByTestId("the-spine")).toBeTruthy();
    cleanup();
    render(view());
    fireEvent.click(screen.getByLabelText("Show periods"));
    expect(localStorage.getItem(KEY)).toBe("0");
  });

  it("still toggles when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(view());
    fireEvent.click(screen.getByLabelText("Collapse periods"));
    expect(screen.getByTestId("spine-collapsed")).toBeTruthy();
  });
});

describe("SideSpine extras", () => {
  it("shows title actions, a pinned toolbar and a footer; the strip hides them", () => {
    render(
      <SideSpine storageKey="x.spine" title="Notes" label="notes" testId="col" detail={<p>d</p>}
        actions={<button aria-label="New note">+</button>} toolbar={<input aria-label="Search notes" />} footer={<span>foot</span>}>
        <ul><li>one</li></ul>
      </SideSpine>,
    );
    expect(screen.getByLabelText("New note")).toBeTruthy();
    expect(screen.getByLabelText("Search notes")).toBeTruthy();
    expect(screen.getByText("foot")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Collapse notes"));
    expect(screen.queryByLabelText("New note")).toBeNull();
    expect(screen.queryByLabelText("Search notes")).toBeNull();
  });

  it("on a phone: the list first, then the detail under a back button", () => {
    const onBack = vi.fn();
    const { rerender } = render(
      <SideSpine storageKey="p.spine" title="Notes" label="notes" testId="col" phone phoneDetail={false} onBack={onBack} detail={<p>the detail</p>}>
        <ul><li>row</li></ul>
      </SideSpine>,
    );
    expect(screen.getByText("row")).toBeTruthy();
    expect(screen.queryByText("the detail")).toBeNull();
    expect(screen.queryByLabelText("Collapse notes")).toBeNull();
    rerender(
      <SideSpine storageKey="p.spine" title="Notes" label="notes" testId="col" phone phoneDetail onBack={onBack} backLabel="All notes" detail={<p>the detail</p>}>
        <ul><li>row</li></ul>
      </SideSpine>,
    );
    expect(screen.getByText("the detail")).toBeTruthy();
    expect(screen.queryByText("row")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /All notes/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it("SpineColumn is the same column for callers that lay out the detail", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<SpineColumn collapsed={false} onToggle={onToggle} title="Threads" label="threads" testId="t"><p>x</p></SpineColumn>);
    expect(screen.getByTestId("t").className).toContain("w-72");
    fireEvent.click(screen.getByLabelText("Collapse threads"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<SpineColumn collapsed onToggle={onToggle} title="Threads" label="threads" testId="t"><p>x</p></SpineColumn>);
    expect(screen.getByTestId("spine-collapsed").className).toContain("w-9");
  });
});

describe("RowAction", () => {
  it("is a 28px icon with the full label as tooltip and name, and confirms with a check", async () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    render(<RowActions><RowAction icon={ClipboardCopy} label="Copy prompt" doneLabel="Copied" onClick={onClick} testId="ra" /></RowActions>);
    const b = screen.getByTestId("ra");
    expect(b.className).toMatch(/\bh-7\b/);
    expect(b.className).toMatch(/\bw-7\b/);
    expect(b.getAttribute("aria-label")).toBe("Copy prompt");
    expect(b.getAttribute("title")).toBe("Copy prompt");
    expect(b.textContent).toBe("");
    await act(async () => { fireEvent.click(b); });
    expect(onClick).toHaveBeenCalled();
    expect(b.getAttribute("data-state")).toBe("done");
    expect(b.getAttribute("title")).toBe("Copied");
    await act(async () => { vi.advanceTimersByTime(ROW_ACTION_CONFIRM_MS + 10); });
    expect(b.getAttribute("data-state")).toBe("idle");
    expect(b.closest("[data-row-actions]")?.className).toMatch(/\bfloat-right\b/);
    vi.useRealTimers();
  });

  it("shows an error state when the action fails, and stays done when told", async () => {
    render(<>
      <RowAction icon={ClipboardCopy} label="Copy prompt" onClick={() => Promise.reject(new Error("no"))} testId="bad" />
      <RowAction icon={ClipboardCopy} label="Add task" onClick={() => {}} done testId="once" />
    </>);
    await act(async () => { fireEvent.click(screen.getByTestId("bad")); });
    expect(screen.getByTestId("bad").getAttribute("data-state")).toBe("err");
    expect(screen.getByTestId("once").getAttribute("data-state")).toBe("done");
    expect((screen.getByTestId("once") as HTMLButtonElement).disabled).toBe(true);
  });
});
