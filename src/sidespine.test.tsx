// The collapsible spine shared by Intent's Noticed, History and Projects.
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SideSpine } from "./sidespine";

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
