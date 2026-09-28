import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { VIRTUAL_MIN, VirtualRows } from "./virtualrows";

const rows = (n: number) => Array.from({ length: n }, (_, i) => `foo ${i}`);

describe("VirtualRows", () => {
  it("renders a short list whole, with no wrapper", () => {
    const { container } = render(<ul><VirtualRows items={rows(VIRTUAL_MIN)} render={(r) => <li>{r}</li>} /></ul>);
    expect(container.querySelectorAll("ul > li")).toHaveLength(VIRTUAL_MIN);
    expect(container.querySelector("[data-virtual-rows]")).toBeNull();
  });

  it("windows a long list: only rows near the viewport are in the DOM", () => {
    const { container } = render(<div style={{ overflowY: "auto", height: 400 }}><VirtualRows items={rows(1200)} render={(r) => <div className="row">{r}</div>} /></div>);
    expect(container.querySelector("[data-virtual-rows]")?.getAttribute("data-virtual-rows")).toBe("1200");
    expect(container.querySelectorAll(".row").length).toBeLessThan(200);
  });
});
