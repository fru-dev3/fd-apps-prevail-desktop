// Vault objects in a reply render as chips that open the real thing. These pin
// the address grammar, that react-markdown keeps the prevail:// scheme (its
// default filter blanks unknown protocols), and what each chip does on click.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const openUrl = vi.fn((_u: string) => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (u: string) => openUrl(u) }));

import { Markdown } from "./Markdown";
import { entityLinkDirective, markdownUrlTransform, parseEntityHref } from "./entities";

beforeEach(() => { cleanup(); openUrl.mockClear(); localStorage.clear(); });

describe("parseEntityHref", () => {
  it("reads each kind", () => {
    expect(parseEntityHref("prevail://domain/real-estate")).toEqual({ kind: "domain", value: "real-estate" });
    expect(parseEntityHref("prevail://person/Marcus%20Aurelius")).toEqual({ kind: "person", value: "Marcus Aurelius" });
    expect(parseEntityHref("prevail://task/wealth/abc1234")).toEqual({ kind: "task", domain: "wealth", value: "abc1234" });
    expect(parseEntityHref("prevail://file/data/domains/tax/memory/state.md")).toEqual({ kind: "file", value: "data/domains/tax/memory/state.md" });
    expect(parseEntityHref("prevail://date/2026-09-30")).toEqual({ kind: "date", value: "2026-09-30" });
  });

  it("rejects what it cannot open", () => {
    expect(parseEntityHref("https://example.com")).toBeNull();
    expect(parseEntityHref("prevail://robot/x")).toBeNull();
    expect(parseEntityHref("prevail://task/wealth")).toBeNull();
    expect(parseEntityHref("prevail://file/../../etc/passwd")).toBeNull();
    expect(parseEntityHref("prevail://domain/")).toBeNull();
  });
});

describe("markdownUrlTransform", () => {
  it("keeps prevail://, web and relative links, drops script schemes", () => {
    expect(markdownUrlTransform("prevail://domain/tax")).toBe("prevail://domain/tax");
    expect(markdownUrlTransform("https://a.b/c")).toBe("https://a.b/c");
    expect(markdownUrlTransform("Note.md")).toBe("Note.md");
    expect(markdownUrlTransform("javascript:alert(1)")).toBe("");
  });
});

describe("Markdown renders vault objects", () => {
  it("draws a domain pill that opens the domain", () => {
    const seen: unknown[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("prevail:open-domain", on);
    render(<Markdown source="File it under [Finance](prevail://domain/finance)." />);
    const pill = screen.getByRole("button", { name: /finance/i });
    expect(pill.getAttribute("data-entity")).toBe("domain");
    fireEvent.click(pill);
    window.removeEventListener("prevail:open-domain", on);
    expect(seen).toEqual(["finance"]);
  });

  it("draws a person with initials and no navigation", () => {
    const { container } = render(<Markdown source="Ask [Jeff Smith](prevail://person/Jeff%20Smith) in accounting." />);
    const person = container.querySelector('[data-entity="person"]')!;
    expect(person.textContent).toContain("JS");
    expect(person.textContent).toContain("Jeff Smith");
    expect(container.querySelector("a")).toBeNull();
  });

  it("opens a task on the board, even when the board mounts later", () => {
    const sections: unknown[] = [];
    const on = (e: Event) => sections.push((e as CustomEvent).detail);
    window.addEventListener("prevail:work-section", on);
    const { container } = render(<Markdown source="Next: [file the Q2 return](prevail://task/tax/abc1234)" />);
    fireEvent.click(container.querySelector('[data-entity="task"]')!);
    window.removeEventListener("prevail:work-section", on);
    expect(sections).toEqual(["tasks"]);
    expect(localStorage.getItem("prevail.board.openTask")).toBe("abc1234");
  });

  it("opens a vault file, and treats a relative .md link as one", () => {
    const files: unknown[] = [];
    const on = (e: Event) => files.push((e as CustomEvent).detail);
    window.addEventListener("prevail:open-vault-file", on);
    const { container } = render(<Markdown source="See [state](prevail://file/data/domains/tax/memory/state.md) and [Note](My%20Note.md)." />);
    container.querySelectorAll('[data-entity="file"]').forEach((el) => fireEvent.click(el));
    window.removeEventListener("prevail:open-vault-file", on);
    expect(files).toEqual(["data/domains/tax/memory/state.md", "My Note.md"]);
  });

  it("opens places and web links in the browser, not the app window", () => {
    const { container } = render(<Markdown source="[Rome](prevail://place/Rome) and [docs](https://example.com/x)" />);
    fireEvent.click(container.querySelector('[data-entity="place"]')!);
    fireEvent.click(screen.getByText("docs").closest("a")!);
    expect(openUrl).toHaveBeenCalledWith("https://maps.apple.com/?q=Rome");
    expect(openUrl).toHaveBeenCalledWith("https://example.com/x");
  });

  it("leaves an unknown prevail kind as plain text", () => {
    const { container } = render(<Markdown source="[thing](prevail://robot/x)" />);
    expect(container.textContent).toBe("thing");
    expect(container.querySelector("[data-entity]")).toBeNull();
  });
});

describe("entityLinkDirective", () => {
  it("names the real domain slugs and every kind", () => {
    const d = entityLinkDirective(["tax", "real-estate", "_meta"]);
    expect(d).toContain("Only these slugs exist: tax, real-estate\n");
    for (const k of ["domain", "person", "place", "task", "file", "date"]) expect(d).toContain(`prevail://${k}/`);
    expect(d).not.toMatch(/—/);
  });
});
