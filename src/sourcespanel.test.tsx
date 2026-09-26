import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The Sources page: one table of every context source (vault, Obsidian,
// folders, websites) with status and row actions, an in-flow detail, and an
// in-flow Add flow. Engine calls are mocked at the bridge.

const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const ROWS = [
  { id: "vault", kind: "prevail", name: "Prevail vault", location: "", resolvedLocation: "/Users/me/PrevailVault", enabled: true, added: "", builtin: true,
    status: { state: "ready", lastIndexed: iso(now - 5 * 60_000), items: 1234, files: 400, nextRefresh: iso(now + 25 * 60_000), error: null, detail: "24 domains" } },
  { id: "obsidian-notes", kind: "obsidian", name: "Personal notes", location: "~/Obsidian", resolvedLocation: "/Users/me/Obsidian", enabled: true, added: "", domain: "notes",
    status: { state: "ready", lastIndexed: iso(now - 60_000), items: 88, nextRefresh: iso(now + 30 * 60_000), error: null, detail: "imported into notes" } },
  { id: "site-fru-dev", kind: "website", name: "fru.dev", location: "https://fru.dev", resolvedLocation: "https://fru.dev", enabled: true, added: "",
    status: { state: "ready", lastIndexed: iso(now - 3_600_000), items: 37690, nextRefresh: iso(now + 6 * 3_600_000), error: null, detail: "47 linked sites, 32,006 rows",
      web: { sites: 48, childSites: 47, rows: 32006, items: 37690, llms: 48, llmsFull: 48, openapi: 47, nextDue: null, lastUpdated: null, errors: [],
        list: [
          { origin: "https://fru.dev", name: "fru.dev", rows: 60, lastUpdated: null, nextDue: iso(now + 86_400_000), surface: { robots: true, llms: true, llmsFull: true, openapi: null, sitemap: 12, health: false } },
          { origin: "https://funding.fru.dev", name: "Funding", rows: 522, lastUpdated: iso(now - 86_400_000), nextDue: iso(now + 2 * 86_400_000), surface: { robots: true, llms: true, llmsFull: true, openapi: 7, sitemap: 600, health: true } },
        ] } } },
];

let rows = JSON.parse(JSON.stringify(ROWS));
const invokeMock = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  switch (cmd) {
    case "sources_list": return { ok: true, sources: rows };
    case "sources_add": {
      const r = { id: "folder-garden", kind: args?.kind, name: args?.name ?? "garden", location: args?.location, resolvedLocation: args?.location, enabled: true, added: "", status: { state: "never", lastIndexed: null, items: 0, nextRefresh: null, error: null } };
      rows = [...rows, r];
      return { ok: true, source: r };
    }
    case "sources_refresh": return { ok: true, busy: false, refreshed: [] };
    case "sources_set_enabled": rows = rows.map((r: { id: string }) => (r.id === args?.id ? { ...r, enabled: args?.enabled } : r)); return { ok: true };
    case "sources_remove": rows = rows.filter((r: { id: string }) => r.id !== args?.id); return { ok: true, keptImport: "/v/data/domains/notes/source/obsidian/obsidian-notes" };
    case "sources_context": return { ok: true, context: "# CONTEXT FROM YOUR SOURCES\nx\n\n[S1] Funding: 2026-05-28, Anthropic, Series H\nFrom Funding: https://funding.fru.dev/rounds/anthropic-series-h-2026-05\n2026-05-28 | Anthropic | Series H | $65B\n# END OF SOURCES\n\n", hits: [{ tag: "S1", sourceName: "fru.dev", kind: "website", title: "Funding: 2026-05-28, Anthropic, Series H", location: "funding.fru.dev/rounds/anthropic-series-h-2026-05", url: "https://funding.fru.dev/rounds/anthropic-series-h-2026-05", group: "Funding" }] };
    case "scan_vault": return [{ name: "notes" }, { name: "tax" }];
    default: return undefined;
  }
});
vi.mock("./bridge", () => ({ invoke: (...a: unknown[]) => invokeMock(...(a as [string, Record<string, unknown>])), listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => "/Users/me/garden") }));
const openUrl = vi.fn(async (_u: string) => {});
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (u: string) => openUrl(u), revealItemInDir: vi.fn(async () => {}) }));
vi.mock("./useisphone", () => ({ useIsPhone: () => false, PHONE_MAX_PX: 767 }));
// The vault's own upkeep cards are covered elsewhere; keep them out of the way.
vi.mock("./settings8", () => ({ VaultManageSection: () => <div data-testid="vault-manage" /> }));

import { SourcesPanel } from "./sourcespanel";
import { SourcesCited } from "./sourceslib";
import { EDITOR_NAV, navSection } from "./navdefs";

beforeEach(() => {
  rows = JSON.parse(JSON.stringify(ROWS));
  invokeMock.mockClear();
  openUrl.mockClear();
  try { localStorage.clear(); } catch { /* ignore */ }
});

describe("SourcesPanel", () => {
  it("lists every source in one table with status, items and next refresh", async () => {
    render(<SourcesPanel vaultPath="/v" />);
    await waitFor(() => expect(screen.getByTestId("source-row-site-fru-dev")).toBeTruthy());
    expect(screen.getByTestId("page-header").className).toContain("sticky");
    expect(screen.getByText("Sources")).toBeTruthy();
    const site = within(screen.getByTestId("source-row-site-fru-dev"));
    expect(site.getByText("fru.dev")).toBeTruthy();
    expect(site.getByText("37,690")).toBeTruthy();
    expect(site.getByText("47 sites, 32,006 rows")).toBeTruthy();
    expect(within(screen.getByTestId("source-row-vault")).getByText("Default")).toBeTruthy();
    expect(screen.getByTestId("sources-summary").textContent).toBe("3 of 3 sources on, 39,012 items indexed");
    // The type column counts each kind.
    const types = within(screen.getByTestId("source-types"));
    expect(types.getByText("Websites")).toBeTruthy();
    // The built-in vault can't be removed, only turned off.
    expect(within(screen.getByTestId("source-row-vault")).queryByLabelText("Remove source")).toBeNull();
  });

  it("toggles a source and refreshes one row", async () => {
    render(<SourcesPanel vaultPath="/v" />);
    await waitFor(() => screen.getByTestId("source-row-obsidian-notes"));
    const row = within(screen.getByTestId("source-row-obsidian-notes"));
    fireEvent.click(row.getAllByRole("switch", { name: "Personal notes on" })[0]!);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("sources_set_enabled", { vault: "/v", id: "obsidian-notes", enabled: false }));
    fireEvent.click(within(screen.getByTestId("source-row-site-fru-dev")).getByLabelText("Refresh now"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("sources_refresh", { vault: "/v", ids: ["site-fru-dev"], force: true, due: null }));
  });

  it("removes only after a second click, and says the files were kept", async () => {
    render(<SourcesPanel vaultPath="/v" />);
    await waitFor(() => screen.getByTestId("source-row-obsidian-notes"));
    const row = within(screen.getByTestId("source-row-obsidian-notes"));
    fireEvent.click(row.getByLabelText("Remove source"));
    expect(invokeMock).not.toHaveBeenCalledWith("sources_remove", expect.anything());
    fireEvent.click(row.getByLabelText("Click again to remove"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("sources_remove", { vault: "/v", id: "obsidian-notes" }));
    await waitFor(() => expect(screen.getByText(/imported notes stay in the vault/)).toBeTruthy());
  });

  it("adds a folder in-flow: pick a type, choose the folder, add and index", async () => {
    render(<SourcesPanel vaultPath="/v" />);
    await waitFor(() => screen.getByTestId("source-row-vault"));
    fireEvent.click(screen.getByTestId("add-source"));
    // Four types, in the content column (no modal, no drawer).
    for (const k of ["prevail", "obsidian", "folder", "website"]) expect(screen.getByTestId(`add-kind-${k}`)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("add-kind-folder"));
    fireEvent.click(screen.getByText("Choose folder"));
    await waitFor(() => expect(screen.getByTestId("picked-folder").textContent).toBe("~/garden"));
    fireEvent.click(screen.getByTestId("add-source-submit"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("sources_add", { vault: "/v", kind: "folder", location: "/Users/me/garden", name: "garden", domain: null }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("sources_refresh", { vault: "/v", ids: ["folder-garden"], force: false, due: null }));
    await waitFor(() => expect(screen.getByTestId("source-row-folder-garden")).toBeTruthy());
  });

  it("offers fru.dev as a one-click website", async () => {
    rows = rows.filter((r: { id: string }) => r.id !== "site-fru-dev");
    render(<SourcesPanel vaultPath="/v" />);
    await waitFor(() => screen.getByTestId("source-row-vault"));
    fireEvent.click(screen.getByTestId("add-source"));
    fireEvent.click(screen.getByTestId("add-kind-website"));
    fireEvent.click(screen.getByRole("button", { name: "fru.dev" }));
    expect((screen.getByLabelText("Website address") as HTMLInputElement).value).toBe("fru.dev");
  });

  it("opens a website's detail with what was found and every linked site", async () => {
    render(<SourcesPanel vaultPath="/v" />);
    await waitFor(() => screen.getByTestId("source-row-site-fru-dev"));
    fireEvent.click(within(screen.getByTestId("source-row-site-fru-dev")).getByText("fru.dev"));
    const detail = within(screen.getByTestId("source-detail"));
    expect(detail.getByText("What Prevail found")).toBeTruthy();
    expect(detail.getByText("llms-full.txt tables, 48")).toBeTruthy();
    const sites = within(screen.getByTestId("site-table"));
    expect(sites.getByText("Funding")).toBeTruthy();
    expect(sites.getByText("522")).toBeTruthy();
    fireEvent.click(detail.getByText("All sources"));
    expect(screen.getByTestId("sources-table")).toBeTruthy();
  });

  it("the old Vault deep link opens the vault with its location and backups", async () => {
    render(<SourcesPanel vaultPath="/v" initialDetail="vault" />);
    await waitFor(() => expect(screen.getByTestId("source-detail")).toBeTruthy());
    expect(screen.getByText("Vault location and backups")).toBeTruthy();
    expect(screen.getByTestId("vault-manage")).toBeTruthy();
  });

  it("Try a question shows the cited excerpts", async () => {
    render(<SourcesPanel vaultPath="/v" />);
    await waitFor(() => screen.getByTestId("source-row-vault"));
    fireEvent.change(screen.getByLabelText("Test question"), { target: { value: "Anthropic series H" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const hits = within(await screen.findByTestId("try-hits"));
    expect(hits.getByText("S1")).toBeTruthy();
    expect(hits.getByText("Funding: 2026-05-28, Anthropic, Series H")).toBeTruthy();
    expect(hits.getByText(/Anthropic \| Series H/)).toBeTruthy();
  });
});

describe("citations under a reply", () => {
  it("lists each source as a chip that opens it", () => {
    render(<SourcesCited sources={[{ tag: "S1", sourceName: "fru.dev", kind: "website", title: "Funding row", location: "funding.fru.dev/rounds/x", url: "https://funding.fru.dev/rounds/x", group: "Funding" }]} />);
    const row = screen.getByTestId("sources-cited");
    expect(row.textContent).toContain("S1");
    expect(row.textContent).toContain("Funding");
    fireEvent.click(within(row).getByRole("button"));
    expect(openUrl).toHaveBeenCalledWith("https://funding.fru.dev/rounds/x");
  });
  it("renders nothing without sources", () => {
    const { container } = render(<SourcesCited sources={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("navigation", () => {
  it("Sources leads Context & Memory and the old Vault ids route to it", () => {
    const group = EDITOR_NAV.find((g) => g.heading === "Context & Memory")!;
    expect(group.items[0]).toMatchObject({ id: "sources", label: "Sources" });
    const ids = EDITOR_NAV.flatMap((g) => g.items.map((i) => i.id));
    expect(ids).not.toContain("workspace");
    for (const old of ["workspace", "vault", "demo", "context"]) expect(navSection(old)).toBe("sources");
  });
  it("the sidebar footer no longer carries the Obsidian icon", () => {
    const src = readFileSync(join(__dirname, "sidebar.tsx"), "utf8");
    expect(src).not.toContain("ObsidianLogo");
    expect(src).not.toContain("prevail:import-obsidian");
  });
});
