import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { guessSource, secretName, shortLocation, sourcesInUse, splitSecret, useLine, type KnowledgeSource } from "./knowledgemodel";

// Knowledge sources. Invented sources only (example.com, a foo folder).

const src = (o: Partial<KnowledgeSource>): KnowledgeSource => ({
  id: "foo", name: "Foo", kind: "web", integration: "web", location: "https://foo.example.com/", urls: ["https://foo.example.com/"],
  scope: { briefings: true, general: true, domains: [], projects: [] }, last_checked: Date.now() - 3_600_000, status: "ready",
  found: "\"Foo\", a feed", trusted_here: true, ...o,
});
const FOLDER = src({ id: "foo-notes", name: "Foo Notes", kind: "folder", integration: "folder", location: "/Users/someone/Documents/foo/notes", urls: [], scope: { briefings: true, general: false, domains: ["money"], projects: [] }, found: "12 readable files (10 md, 2 csv)" });
const DB = src({ id: "bar-db", name: "Bar DB", kind: "database", integration: "database", location: "postgres://bar@db.example.com/bar", urls: [], status: "error", detail: "connection refused", found: "Could not read it: connection refused", scope: { briefings: false, general: true, domains: [], projects: ["foo-launch"] } });
const AWAY = src({ id: "baz-feed", name: "Baz Feed", status: "untrusted_here", trusted_here: false, found: undefined });

describe("knowledge model", () => {
  it("guesses what a pasted text points at", () => {
    expect(guessSource("https://foo.example.com/mcp")).toEqual({ kind: "mcp", location: "https://foo.example.com/mcp" });
    expect(guessSource("the feed https://foo.example.com/feed.xml for money briefings")).toEqual({ kind: "web", location: "https://foo.example.com/feed.xml" });
    expect(guessSource("my notes in ~/Documents/foo, called Foo")).toEqual({ kind: "folder", location: "~/Documents/foo" });
    expect(guessSource("~/data/foo.db")).toEqual({ kind: "database", location: "~/data/foo.db" });
    expect(guessSource("nothing here")).toEqual({});
  });
  it("splits a Postgres password off before anything leaves the page", () => {
    expect(splitSecret("postgres://bar:p%40ss@db.example.com/bar for money")).toEqual({ text: "postgres://bar@db.example.com/bar for money", secret: "p@ss" });
    expect(splitSecret("https://foo.example.com/")).toEqual({ text: "https://foo.example.com/" });
    expect(secretName("bar-db")).toBe("PREVAIL_SOURCE_BAR_DB_SECRET");
  });
  it("says what a source is used for and where it is, short", () => {
    expect(useLine(FOLDER)).toBe("Briefings, Money");
    expect(useLine(DB)).toBe("Chief of staff, Project Foo Launch");
    expect(useLine(src({ scope: { briefings: false, general: false, domains: [], projects: [] } }))).toBe("Chat when you name it");
    expect(shortLocation(FOLDER)).toBe(".../foo/notes");
    expect(shortLocation(DB)).toBe("db.example.com/bar");
  });
  it("picks the sources a domain, a project or briefings use", () => {
    const all = [FOLDER, DB, AWAY, src({})];
    expect(sourcesInUse(all, { domain: "money" }).map((s) => s.id)).toEqual(["foo-notes"]);
    expect(sourcesInUse(all, { domain: "general", briefing: true }).map((s) => s.id)).toEqual(["foo"]);
    expect(sourcesInUse(all, { project: "foo-launch" }).map((s) => s.id)).toEqual(["bar-db"]);
  });
});

const invokeMock = vi.fn(async (cmd: string, _args?: Record<string, unknown>): Promise<unknown> => {
  switch (cmd) {
    case "engine_knowledge_sources": return [FOLDER, DB, AWAY];
    case "scan_vault": return [{ name: "general" }, { name: "money" }, { name: "health" }];
    case "engine_knowledge_add": return { source: src({ id: "bar-db", name: "Bar DB", kind: "database" }), probe: { ok: false, error: "password needed" }, adopted: false, found: "Could not read it: password needed" };
    case "engine_knowledge_check": return { source: src({ id: "bar-db", name: "Bar DB", kind: "database" }), probe: { ok: true }, adopted: true, found: "Postgres, 2 tables: foo, bar" };
    case "app_secret_set": return null;
    default: return null;
  }
});
vi.mock("./bridge", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  listen: vi.fn(async () => () => {}),
  isBrowser: () => false,
}));

import { KnowledgeSourcesSection, SourcesInUse } from "./knowledgesources";
import { clearQueryCache } from "./query";

beforeEach(() => { invokeMock.mockClear(); clearQueryCache(); });

describe("KnowledgeSourcesSection", () => {
  it("lists each source as one quiet row: kind, use, what was found, when checked", async () => {
    render(<KnowledgeSourcesSection vaultPath="/v" />);
    const rows = await screen.findAllByTestId("knowledge-row");
    expect(rows.map((r) => r.getAttribute("data-id"))).toEqual(["foo-notes", "bar-db", "baz-feed"]);
    expect(rows[0]!.textContent).toContain("Folder · Briefings, Money · 12 readable files (10 md, 2 csv) · checked 1h ago");
    expect(rows[1]!.textContent).toContain("Could not read it: connection refused");
    expect(within(rows[2]!).getByTestId("knowledge-trust")).toBeTruthy();
    expect(rows[0]!.textContent).not.toContain("/Users/someone");
  });

  it("adds from a pasted sentence; a password goes to the Keychain, then the source is checked again", async () => {
    render(<KnowledgeSourcesSection vaultPath="/v" />);
    fireEvent.change(await screen.findByTestId("knowledge-text"), { target: { value: "postgres://bar:s3cret@db.example.com/bar for money" } });
    fireEvent.click(screen.getByTestId("knowledge-submit"));
    await waitFor(() => expect(screen.getByTestId("knowledge-found").textContent).toContain("Postgres, 2 tables: foo, bar"));
    const add = invokeMock.mock.calls.find((c) => c[0] === "engine_knowledge_add")![1]!;
    expect(add).toMatchObject({ vault: "/v", text: "postgres://bar@db.example.com/bar for money" });
    expect(JSON.stringify(add)).not.toContain("s3cret");
    expect(invokeMock).toHaveBeenCalledWith("app_secret_set", { name: "PREVAIL_SOURCE_BAR_DB_SECRET", value: "s3cret" });
    expect(invokeMock).toHaveBeenCalledWith("engine_knowledge_check", { vault: "/v", id: "bar-db" });
  });

  it("the Fields toggle shows what the text was understood as", async () => {
    render(<KnowledgeSourcesSection vaultPath="/v" />);
    fireEvent.change(await screen.findByTestId("knowledge-text"), { target: { value: "~/Documents/foo" } });
    fireEvent.click(screen.getByTestId("knowledge-fields-toggle"));
    expect((screen.getByTestId("knowledge-location") as HTMLInputElement).value).toBe("~/Documents/foo");
    expect(screen.getByTestId("knowledge-kind-folder").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByTestId("knowledge-submit"));
    await waitFor(() => expect(invokeMock.mock.calls.some((c) => c[0] === "engine_knowledge_add")).toBe(true));
    expect(invokeMock.mock.calls.find((c) => c[0] === "engine_knowledge_add")![1]).toMatchObject({ kind: "folder", location: "~/Documents/foo", briefings: true, general: true, domains: [] });
  });

  it("a source from another Mac is trusted here with a check; a row's scope changes in place", async () => {
    render(<KnowledgeSourcesSection vaultPath="/v" />);
    const rows = await screen.findAllByTestId("knowledge-row");
    fireEvent.click(within(rows[2]!).getByTestId("knowledge-trust"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("engine_knowledge_check", { vault: "/v", id: "baz-feed" }));
    fireEvent.click(within(rows[0]!).getByTestId("knowledge-open"));
    const detail = await screen.findByTestId("knowledge-detail");
    fireEvent.click(within(detail).getByRole("button", { name: "Health" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("engine_knowledge_use", { vault: "/v", id: "foo-notes", briefings: null, general: null, domains: ["money", "health"], projects: null }));
  });
});

describe("SourcesInUse", () => {
  it("names what a space reads and links to Knowledge sources", async () => {
    const seen: string[] = [];
    const on = (e: Event) => seen.push(String((e as CustomEvent<string>).detail));
    window.addEventListener("prevail:settings-section", on);
    render(<SourcesInUse vaultPath="/v" domain="money" />);
    expect((await screen.findByText(/Reads Foo Notes/)).textContent).toContain("Reads Foo Notes");
    fireEvent.click(screen.getByTestId("sources-in-use-open"));
    window.removeEventListener("prevail:settings-section", on);
    expect(seen).toEqual(["knowledge-sources"]);
  });
});
