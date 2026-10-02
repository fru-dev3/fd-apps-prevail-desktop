import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import {
  faviconHost, groupByRuntime, logoHost, recipeSavePayload, signinAction, statusMeta, syncBlockedReason, syncableTools, toolBadge,
  type MirrorApp, type MirrorList,
} from "./appsmirror-model";

// Fixture: invented connectors only.
const notes: MirrorApp = {
  id: "acme-notes", name: "Acme Notes", runtime: "claude", server: "acme-notes", url: "https://mcp.acmenotes.example/mcp",
  status: "connected", signin_hint: "https://claude.ai/settings/connectors", syncable: true, domains: ["work"],
  tools: [
    { name: "search_pages", full_name: "mcp__acme__search_pages", kind: "read", sync_allowed: true, chat_default: true },
    { name: "update_page", full_name: "mcp__acme__update_page", kind: "write", sync_allowed: false, chat_default: false },
  ],
  recipe: { prompt: "Summarize new pages", domains: ["work"], schedule: "daily", read_tools: ["search_pages"] },
  last_sync: Date.now() - 3 * 3600_000, records_last_sync: 4,
};
const mail: MirrorApp = {
  id: "bar-mail", name: "Bar Mail", runtime: "claude", server: "bar-mail", url: "https://bar.example",
  status: "connected", signin_hint: "https://claude.ai/settings/connectors", syncable: true, domains: [],
  tools: [
    { name: "list_threads", full_name: "list_threads", kind: "read", sync_allowed: true, chat_default: true },
    { name: "send_message", full_name: "send_message", kind: "send", sync_allowed: true, chat_default: false },
    { name: "pay_invoice", full_name: "pay_invoice", kind: "money", sync_allowed: false, chat_default: false },
  ],
  recipe: null,
};
const rides: MirrorApp = {
  id: "foo-rides", name: "Foo Rides", runtime: "claude", server: "foo-rides", status: "needs_auth",
  signin_hint: "https://claude.ai/settings/connectors", syncable: true, domains: [],
};
const helper: MirrorApp = {
  id: "baz-helper", name: "Baz Helper", runtime: "codex", server: "baz-helper", command: "baz-mcp",
  status: "disabled", signin_hint: "codex mcp login baz-helper", syncable: false, domains: [],
};
const LIST: MirrorList = {
  generated_at: 1,
  runtimes: [
    { runtime: "claude", installed: true, syncable: true, signin_hint: "", count: 3 },
    { runtime: "codex", installed: true, syncable: false, signin_hint: "", count: 1 },
    { runtime: "gemini", installed: false, syncable: false, signin_hint: "", count: 0 },
    { runtime: "agy", installed: true, syncable: false, signin_hint: "", count: 0 },
  ],
  apps: [rides, mail, helper, notes],
};

describe("apps mirror model", () => {
  it("groups by runtime in a fixed order and sorts connected first", () => {
    const g = groupByRuntime(LIST);
    expect(g.map((x) => x.label)).toEqual(["Claude", "Codex", "Gemini", "Antigravity"]);
    expect(g[0].apps.map((a) => a.name)).toEqual(["Acme Notes", "Bar Mail", "Foo Rides"]);
    expect(g[1].apps.map((a) => a.id)).toEqual(["baz-helper"]);
    expect(g[2].info?.installed).toBe(false);
    expect(g[2].apps).toEqual([]);
  });

  it("labels every status", () => {
    expect(statusMeta("connected")).toEqual({ label: "Connected", tone: "ok" });
    expect(statusMeta("needs_auth").label).toBe("Needs sign-in");
    expect(statusMeta("disabled").label).toBe("Disabled");
    expect(statusMeta("error").label).toBe("Error");
    expect(statusMeta("weird").label).toBe("Unknown");
  });

  it("blocks send and money tools from sync, even if marked allowed", () => {
    expect(mail.tools!.map((t) => toolBadge(t).label)).toEqual(["Read", "Blocked", "Blocked"]);
    expect(toolBadge(notes.tools![1]).label).toBe("Write");
    expect(syncableTools(mail).map((t) => t.name)).toEqual(["list_threads"]);
  });

  it("explains why sync is unavailable", () => {
    expect(syncBlockedReason(notes)).toBeNull();
    expect(syncBlockedReason(mail)).toMatch(/recipe/);
    expect(syncBlockedReason(rides)).toMatch(/Sign in/);
    expect(syncBlockedReason(helper)).toMatch(/Codex/);
  });

  it("links Claude sign-in and copies CLI commands", () => {
    expect(signinAction(notes)).toBeNull();
    expect(signinAction(rides)).toEqual({ kind: "link", href: "https://claude.ai/settings/connectors" });
    expect(signinAction(helper)).toEqual({ kind: "command", command: "codex mcp login baz-helper" });
  });

  it("finds the site behind an MCP endpoint", () => {
    expect(faviconHost("https://mcp.acmenotes.example/mcp")).toBe("acmenotes.example");
    expect(faviconHost("https://bar.example")).toBe("bar.example");
    expect(faviconHost("https://api.foo.co.uk/x")).toBe("foo.co.uk");
    expect(faviconHost("http://127.0.0.1:8080")).toBeNull();
    expect(faviconHost(undefined)).toBeNull();
  });

  it("uses the product site for connectors on a shared API host", () => {
    expect(logoHost("Gmail", "https://gmailmcp.googleapis.com/mcp/v1")).toBe("mail.google.com");
    expect(logoHost("Acme Notes", "https://mcp.acmenotes.example/mcp")).toBe("acmenotes.example");
    expect(logoHost("Google Calendar", "https://calendarmcp.googleapis.com/mcp/v1")).toBe("calendar.google.com");
    expect(logoHost("Foo Planner", "https://foomcp.googleapis.com/mcp/v1")).toBe("foo.google.com");
    expect(logoHost("Privacy.com", "https://mcp.privacy.com")).toBe("privacy.com");
  });

  it("builds the save payload with only sync-allowed read tools", () => {
    const p = recipeSavePayload("/v", mail, {
      prompt: "  List new threads  ", domains: ["money", "money", " "], schedule: "weekly",
      read_tools: ["list_threads", "send_message"],
    });
    expect(p).toEqual({ vault: "/v", id: "bar-mail", prompt: "List new threads", domains: ["money"], schedule: "weekly", readTools: ["list_threads"] });
  });
});

// ── Screen ──────────────────────────────────────────────────────────────────
const defaultInvoke = async (cmd: string, _args?: Record<string, unknown>): Promise<unknown> => {
  switch (cmd) {
    case "apps_mirror_list": return LIST;
    case "scan_vault": return [{ name: "work" }, { name: "money" }];
    case "app_favicon": return "";
    case "engine_apps_list": return [];
    case "engine_apps_threads": return [];
    case "apps_untrusted_sources": return [{ id: "foo-src", name: "Foo Source", integration: "mcp-remote", urls: ["https://foo.example/mcp"] }];
    case "engine_apps_access_log": return String(_args?.app) === "bar-mail" ? [
      { ts: Date.now() - 60_000, tool: "list_threads", access: "read", outcome: "ran", thread: "2026-09-28_foo", domain: "work", summary: "query: from the foo team", app: "bar-mail" },
      { ts: Date.now() - 30_000, tool: "send_message", access: "blocked", outcome: "queued", thread: "2026-09-28_foo", summary: "to: [an email address]", app: "bar-mail" },
    ] : [];
    case "engine_apps_add_source": return {
      app: { id: "context-fru-dev", name: "Context (fru.dev)", runtime: "claude", server: "context-fru-dev", status: "connected", signin_hint: "", syncable: false, domains: [], trusted: true, integration: "mcp-remote", urls: ["https://context.fru.dev/mcp"] },
      probe: { ok: true, checked_at: 1, tools: [{ name: "search", kind: "read", read_only_hint: true }, { name: "list_sources", kind: "read", read_only_hint: true }], server: { name: "ibis-context" } },
      adopted: false,
    };
    case "ingestion_cli_providers": return [];
    case "apps_mirror_recipe_save": return { ok: true, app: { ...mail, recipe: { prompt: "List new threads", domains: ["money"], schedule: "weekly", read_tools: ["list_threads"] } } };
    default: return undefined;
  }
};
const invokeMock = vi.fn(defaultInvoke);
vi.mock("./bridge", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  listen: vi.fn(async () => () => {}),
  isBrowser: () => false,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
// The app's Chat tab is the whole chat panel; here it only has to be there.
vi.mock("./chatpanel", () => ({ ChatPanel: (p: { scopeApp?: { id: string } }) => <div data-testid="chat-panel" data-scope-app={p.scopeApp?.id} /> }));

import { AppsMirrorPanel } from "./appsmirror";

beforeEach(() => { invokeMock.mockClear(); try { localStorage.clear(); } catch { /* ignore */ } });

describe("AppsMirrorPanel", () => {
  it("renders runtime sections, status pills and a calm line for a missing runtime", async () => {
    render(<AppsMirrorPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByTestId("mirror-row-acme-notes")).toBeTruthy());
    const claude = screen.getByRole("region", { name: "Claude" });
    expect(within(claude).getAllByTestId("status-pill").map((p) => p.textContent)).toEqual(["Connected", "Connected", "Needs sign-in"]);
    expect(within(claude).getByText("Sign in on claude.ai")).toBeTruthy();
    // A missing runtime gets no section of its own, just one calm line.
    expect(screen.queryByRole("region", { name: "Gemini" })).toBeNull();
    expect(screen.getByTestId("runtimes-missing").textContent).toMatch(/Not installed on this Mac: .*Gemini/);
    const codex = screen.getByRole("region", { name: "Codex" });
    expect(within(codex).getByText("codex mcp login baz-helper")).toBeTruthy();
    // The page header stays in view while scrolling; the content is one column.
    expect(document.querySelector("[data-settings-header]")).not.toBeNull();
    expect(document.body.innerHTML).not.toMatch(/grid-cols-[2-9]/);
  });

  it("shows blocked tools and saves the recipe payload", async () => {
    render(<AppsMirrorPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByTestId("mirror-row-bar-mail")).toBeTruthy());
    fireEvent.click(screen.getByTestId("mirror-row-bar-mail"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Bar Mail" })).toBeTruthy());
    fireEvent.click(screen.getByTestId("app-tab-tools"));
    expect(screen.getAllByTestId("tool-badge").map((b) => b.textContent)).toEqual(["Read", "Blocked", "Blocked"]);
    fireEvent.click(screen.getByTestId("app-tab-connection"));
    expect((screen.getByRole("button", { name: /Sync now/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Save a sync recipe first.")).toBeTruthy();
    // Only the read tool is offered in the recipe checklist.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("What to pull"), { target: { value: "List new threads" } });
    fireEvent.click(screen.getByRole("button", { name: /Money/ }));
    fireEvent.change(screen.getByLabelText("Schedule"), { target: { value: "weekly" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Save recipe/ }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("apps_mirror_recipe_save", {
      vault: "/v", id: "bar-mail", prompt: "List new threads", domains: ["money"], schedule: "weekly", readTools: ["list_threads"],
    }));
  });

  it("says a mirror-only connector cannot be synced yet", async () => {
    render(<AppsMirrorPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByTestId("mirror-row-baz-helper")).toBeTruthy());
    fireEvent.click(screen.getByTestId("mirror-row-baz-helper"));
    fireEvent.click(await screen.findByTestId("app-tab-connection"));
    await waitFor(() => expect(screen.getByText(/It cannot be synced yet/)).toBeTruthy());
    expect(screen.queryByRole("region", { name: "Sync recipe" })).toBeNull();
  });

  it("keeps the fallback lanes in their own groups, never under an app", async () => {
    render(<AppsMirrorPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByTestId("app-scope")).toBeTruthy());
    expect(screen.queryByText("Sites without a connector")).toBeNull();
    expect(screen.queryByTestId("apps-lane-sites")).toBeNull();
    fireEvent.click(screen.getByTestId("apps-row-sites"));
    await waitFor(() => expect(screen.getByText("Sites without a connector")).toBeTruthy());
    fireEvent.click(screen.getByTestId("apps-row-obsidian"));
    await waitFor(() => expect(screen.getByTestId("apps-lane-obsidian")).toBeTruthy());
    expect(screen.queryByText("Sites without a connector")).toBeNull();
  });

  it("opens an app on its Chat tab, scoped to the app", async () => {
    render(<AppsMirrorPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByTestId("mirror-row-bar-mail")).toBeTruthy());
    fireEvent.click(screen.getByTestId("mirror-row-bar-mail"));
    await waitFor(() => expect(screen.getByTestId("chat-panel").getAttribute("data-scope-app")).toBe("bar-mail"));
    expect(screen.getByTestId("app-tab-chat").getAttribute("aria-selected")).toBe("true");
  });

  it("lists the access log on the Activity tab", async () => {
    render(<AppsMirrorPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByTestId("mirror-row-bar-mail")).toBeTruthy());
    fireEvent.click(screen.getByTestId("mirror-row-bar-mail"));
    fireEvent.click(await screen.findByTestId("app-tab-activity"));
    await waitFor(() => expect(screen.getAllByTestId("access-line")).toHaveLength(2));
    expect(screen.getByText("to: [an email address]")).toBeTruthy();
    expect(screen.getByText("Waiting for you")).toBeTruthy();
    expect(invokeMock.mock.calls.find((c) => c[0] === "engine_apps_access_log")?.[1]).toMatchObject({ vault: "/v", app: "bar-mail" });
  });

  it("adds the suggested source in one click and shows what it found", async () => {
    render(<AppsMirrorPanel vaultPath="/v" />);
    fireEvent.click(await screen.findByTestId("apps-row-add-source"));
    const s = await screen.findByTestId("suggested-source");
    expect(within(s).getByText("Context (fru.dev)")).toBeTruthy();
    fireEvent.click(within(s).getByRole("button", { name: /Add/ }));
    await waitFor(() => expect(screen.getByTestId("probe-ok")).toBeTruthy());
    expect(invokeMock).toHaveBeenCalledWith("engine_apps_add_source", { vault: "/v", kind: "mcp-remote", urls: ["https://context.fru.dev/mcp"], name: "Context (fru.dev)" });
    expect(screen.getByText("list_sources")).toBeTruthy();
  });

  it("offers to trust a source that synced from another Mac", async () => {
    render(<AppsMirrorPanel vaultPath="/v" />);
    fireEvent.click(await screen.findByTestId("apps-row-untrusted-foo-src"));
    expect(within(await screen.findByTestId("untrusted-source")).getByText("Not trusted on this Mac yet")).toBeTruthy();
    fireEvent.click(screen.getByTestId("trust-here"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("engine_apps_add_source", { vault: "/v", kind: "mcp-remote", urls: ["https://foo.example/mcp"], name: "Foo Source" }));
  });

  it("reads untrusted sources from the engine's fields, without the manifest fallback", async () => {
    const synced = { id: "baz-src", name: "Baz Source", runtime: "claude", server: "baz-src", status: "untrusted_here" as const, status_detail: "Trusted on another Mac", signin_hint: "", syncable: false, domains: [], trusted: true, trusted_here: false, integration: "web", urls: ["https://baz.example"] };
    invokeMock.mockImplementation(async (cmd: string) => cmd === "apps_mirror_list" ? { ...LIST, apps: [...LIST.apps, synced] } : cmd === "scan_vault" ? [] : undefined);
    try {
      render(<AppsMirrorPanel vaultPath="/v" />);
      fireEvent.click(await screen.findByTestId("apps-row-untrusted-baz-src"));
      expect(within(await screen.findByTestId("untrusted-source")).getByText("Baz Source")).toBeTruthy();
      expect(screen.queryByTestId("apps-row-untrusted-foo-src")).toBeNull();
      expect(invokeMock.mock.calls.some(([c]) => c === "apps_untrusted_sources")).toBe(false);
    } finally { invokeMock.mockImplementation(defaultInvoke); }
  });

  it("shows the full name of a long connector on hover", async () => {
    render(<AppsMirrorPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByTestId("mirror-row-acme-notes")).toBeTruthy());
    expect(screen.getByTestId("mirror-row-acme-notes").getAttribute("title")).toBe("Acme Notes");
  });

  it("pins a connector to the sidebar and back", async () => {
    render(<AppsMirrorPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByTestId("mirror-row-bar-mail")).toBeTruthy());
    fireEvent.click(screen.getByTestId("mirror-row-bar-mail"));
    const pin = await screen.findByTestId("mirror-pin");
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(pin);
    await waitFor(() => expect(screen.getByTestId("mirror-pin").getAttribute("aria-pressed")).toBe("true"));
    expect(JSON.parse(localStorage.getItem("prevail.apps.favorites") || "[]")).toContain("mirrorbarmail");
    fireEvent.click(screen.getByTestId("mirror-pin"));
    await waitFor(() => expect(screen.getByTestId("mirror-pin").getAttribute("aria-pressed")).toBe("false"));
  });

  it("opens the connector the sidebar handed over", async () => {
    sessionStorage.setItem("prevail.apps.mirror.select", "bar-mail");
    render(<AppsMirrorPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Bar Mail" })).toBeTruthy());
    expect(sessionStorage.getItem("prevail.apps.mirror.select")).toBeNull();
  });
});

describe("Apps uses the canonical SideSpine", () => {
  it("lists connectors grouped by runtime in the column, collapses to a strip, and remembers it", async () => {
    render(<AppsMirrorPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByTestId("mirror-row-acme-notes")).toBeTruthy());
    const col = screen.getByTestId("apps-list");
    expect(col.hasAttribute("data-spine-column")).toBe(true);
    expect(col.className).toContain("w-72");
    expect(within(col).getByText("Connectors")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Collapse connectors"));
    expect(screen.queryByTestId("apps-list")).toBeNull();
    expect(screen.getByTestId("spine-collapsed").className).toContain("w-9");
    expect(screen.getByTestId("spine-detail").getAttribute("data-spine")).toBe("collapsed");
    expect(localStorage.getItem("prevail.apps.spine")).toBe("1");
    fireEvent.click(screen.getByLabelText("Show connectors"));
    expect(screen.getByTestId("apps-list")).toBeTruthy();
  });

  it("keeps the header outside the scroll and the detail in one column", async () => {
    render(<AppsMirrorPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByTestId("mirror-row-acme-notes")).toBeTruthy());
    const header = document.querySelector("[data-settings-header]")!;
    expect(header.contains(screen.getByTestId("spine-detail"))).toBe(false);
    expect(document.body.innerHTML).not.toMatch(/grid-cols-[2-9]|max-w-(2xl|3xl|4xl)/);
  });
});
