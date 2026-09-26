import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import {
  faviconHost, groupByRuntime, recipeSavePayload, signinAction, statusMeta, syncBlockedReason, syncableTools, toolBadge,
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

  it("builds the save payload with only sync-allowed read tools", () => {
    const p = recipeSavePayload("/v", mail, {
      prompt: "  List new threads  ", domains: ["money", "money", " "], schedule: "weekly",
      read_tools: ["list_threads", "send_message"],
    });
    expect(p).toEqual({ vault: "/v", id: "bar-mail", prompt: "List new threads", domains: ["money"], schedule: "weekly", readTools: ["list_threads"] });
  });
});

// ── Screen ──────────────────────────────────────────────────────────────────
const invokeMock = vi.fn(async (cmd: string, _args?: Record<string, unknown>): Promise<unknown> => {
  switch (cmd) {
    case "apps_mirror_list": return LIST;
    case "scan_vault": return [{ name: "work" }, { name: "money" }];
    case "app_favicon": return "";
    case "engine_apps_list": return [];
    case "ingestion_cli_providers": return [];
    case "apps_mirror_recipe_save": return { ok: true, app: { ...mail, recipe: { prompt: "List new threads", domains: ["money"], schedule: "weekly", read_tools: ["list_threads"] } } };
    default: return undefined;
  }
});
vi.mock("./bridge", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
  listen: vi.fn(async () => () => {}),
  isBrowser: () => false,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { AppsMirrorPanel } from "./appsmirror";

beforeEach(() => { invokeMock.mockClear(); try { localStorage.clear(); } catch { /* ignore */ } });

describe("AppsMirrorPanel", () => {
  it("renders runtime sections, status pills and a calm line for a missing runtime", async () => {
    render(<AppsMirrorPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByTestId("mirror-row-acme-notes")).toBeTruthy());
    const claude = screen.getByRole("region", { name: "Claude" });
    expect(within(claude).getAllByTestId("status-pill").map((p) => p.textContent)).toEqual(["Connected", "Connected", "Needs sign-in"]);
    expect(within(claude).getByText("Sign in on claude.ai")).toBeTruthy();
    const gemini = screen.getByRole("region", { name: "Gemini" });
    expect(within(gemini).getByText("Not installed on this Mac.")).toBeTruthy();
    const codex = screen.getByRole("region", { name: "Codex" });
    expect(within(codex).getByText("codex mcp login baz-helper")).toBeTruthy();
  });

  it("shows blocked tools and saves the recipe payload", async () => {
    render(<AppsMirrorPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByTestId("mirror-row-bar-mail")).toBeTruthy());
    fireEvent.click(screen.getByTestId("mirror-row-bar-mail"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Bar Mail" })).toBeTruthy());
    expect(screen.getAllByTestId("tool-badge").map((b) => b.textContent)).toEqual(["Read", "Blocked", "Blocked"]);
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
    await waitFor(() => expect(screen.getByText(/It cannot be synced yet/)).toBeTruthy());
    expect(screen.queryByRole("region", { name: "Sync recipe" })).toBeNull();
  });

  it("keeps the fallback lanes on the page", async () => {
    render(<AppsMirrorPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByText("Sites without a connector")).toBeTruthy());
    expect(screen.getByText("Obsidian import")).toBeTruthy();
  });
});
