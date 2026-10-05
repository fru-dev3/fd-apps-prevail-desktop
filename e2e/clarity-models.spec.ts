// The Models page: tabs under the header with a line on each, one search
// across runtimes and models, status in words, Auto routing as its own
// section, and runtime errors as one plain sentence (ANSI stripped).
import { test, expect, type Page } from "@playwright/test";
import { openChatTab } from "./open-chat";
import { mockTauri } from "./tauri-mock";

const CLIS = [
  { id: "claude", label: "Claude Code", available: true, versions: [], version: "2.1.0", bin: "claude" },
  { id: "codex", label: "Codex", available: false, versions: [], bin: "codex" },
];

async function openModels(page: Page) {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await mockTauri(page, { detect_clis: CLIS, verify_cli_model: "ok" });
  await page.goto("/");
  await openChatTab(page); await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "models" })));
  await expect(page.getByTestId("runtimes-list")).toBeVisible({ timeout: 10_000 });
}

test("models · tabs sit under the header, each with a line saying what it is", async ({ page }) => {
  await openModels(page);
  const header = page.locator("[data-shell=header]");
  const tabs = header.getByRole("tablist", { name: "Models view" });
  await expect(tabs.getByRole("tab")).toHaveText([/On this Mac/, "Aggregators", "Direct keys"]);
  await expect(header.getByTestId("models-tab-blurb")).toContainText("your own subscription");
  await tabs.getByRole("tab", { name: "Aggregators" }).click();
  await expect(header.getByTestId("models-tab-blurb")).toContainText("One key, many models");
  await tabs.getByRole("tab", { name: "Direct keys" }).click();
  await expect(header.getByTestId("models-tab-blurb")).toContainText("Keychain");
});

test("models · one search finds runtimes and models", async ({ page }) => {
  await openModels(page);
  const list = page.getByTestId("runtimes-list");
  const search = list.getByLabel("Search runtimes and models");
  // A model name keeps its runtime, says which models matched, and the detail
  // lists only those.
  await search.fill("opus");
  await expect(list.getByText("Codex")).toHaveCount(0);
  await expect(list.getByTestId("runtime-status").first()).toContainText("Matches Opus");
  const detail = page.getByTestId("spine-detail");
  await expect(detail.getByText("Sonnet", { exact: false })).toHaveCount(0);
  await expect(detail.getByText(/^Opus/).first()).toBeVisible();
  // A runtime name matches too.
  await search.fill("codex");
  await expect(list.getByText("Codex")).toBeVisible();
  await expect(list.getByText("Claude Code")).toHaveCount(0);
  await search.fill("zzzz");
  await expect(detail).toContainText("Nothing matches that search.");
});

test("models · status in words, Auto routing as a section, errors as one sentence", async ({ page }) => {
  await openModels(page);
  const list = page.getByTestId("runtimes-list");
  await expect(list.getByRole("button", { name: /Codex/ }).getByTestId("runtime-status")).toHaveText("Not installed");
  const detail = page.getByTestId("spine-detail");
  const routing = detail.getByTestId("auto-routing");
  await expect(routing).toContainText("Auto routing");
  await expect(routing.getByRole("radiogroup", { name: "Auto routing bias" })).toBeVisible();
  await expect(detail.getByTestId("model-status").first()).toBeVisible();
  // A failed model test shows one plain sentence, no escape codes, with the
  // full text behind Details.
  await page.evaluate(() => {
    (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures.verify_cli_model = () => {
      throw "\u001b[31mError: model not found for this account.\u001b[0m\n    at run (cli.js:1:1)";
    };
  });
  const row = detail.locator(".group", { hasText: "Opus" }).first();
  await row.hover();
  await row.getByRole("button", { name: /More actions for/ }).click();
  await page.getByRole("menuitem", { name: /Test/ }).click();
  const err = row.getByTestId("error-line");
  await expect(err).toContainText("Model not found for this account.");
  await expect(err).not.toContainText("[31m");
  await expect(err.getByText("Details")).toBeVisible();
});

test("models · the runtime meta line shows the version, or leaves it out; never 'undefined'", async ({ page }) => {
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  // No version and no bin, as a runtime can arrive: the segment is omitted.
  await mockTauri(page, { detect_clis: [{ id: "claude", label: "Foo Runtime", available: true }], verify_cli_model: "ok" });
  await page.goto("/");
  await openChatTab(page); await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "models" })));
  const meta = page.getByTestId("runtime-meta").first();
  await expect(meta).toBeVisible({ timeout: 10_000 });
  await expect(meta).not.toContainText("undefined");
  await expect(meta).not.toContainText("in PATH");
});

test("models · the runtime meta line shows the version when known", async ({ page }) => {
  await openModels(page);
  await expect(page.getByTestId("runtime-meta").first()).toContainText("Version 2.1.0");
});
