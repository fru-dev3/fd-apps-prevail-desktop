// A domain's "For you" card and its add-a-task line, with the engine mocked.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

let surface: () => unknown = () => { throw new Error("could not parse a surface from the model output"); };
const calls: string[] = [];
vi.mock("./bridge", () => ({
  invoke: async (cmd: string) => {
    calls.push(cmd);
    if (cmd === "domain_surface") return surface();
    if (cmd === "tasks_read") return [];
    return null;
  },
  setWebToken: () => {},
}));

import { SurfacePanel, TasksPanel } from "./panels";

beforeEach(() => { cleanup(); calls.length = 0; localStorage.clear(); });

describe("For you card", () => {
  it("shows a failed surface as one plain sentence with Retry, never the raw error", async () => {
    render(<SurfacePanel vaultPath="/v" domain="foo" onPick={() => {}} onAddTask={() => {}} />);
    const box = await screen.findByTestId("surface-error");
    expect(box.textContent).toContain("Could not parse a surface from the model output.");
    expect(box.textContent).not.toMatch(/Couldn't surface insights \(|Needs a working agent/);
    surface = () => ({ questions: ["Is the foo policy renewed?"], actions: [], generated_at: Date.now(), stale: false });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Questions worth asking");
    expect(screen.queryByTestId("surface-error")).toBeNull();
    expect(calls.filter((c) => c === "domain_surface")).toHaveLength(2);
  });
});

describe("add a goal or task", () => {
  it("is plain sentence-case text, not a mono label", async () => {
    render(<TasksPanel vaultPath="/v" domain="foo" nonce={0} />);
    const btn = await screen.findByTestId("add-goal-task");
    await waitFor(() => expect(btn.textContent).toBe("Add a goal or task"));
    expect(btn.className).not.toMatch(/font-mono|uppercase/);
  });
});
