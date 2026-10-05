// Production boot with a demo profile left active (the bundled persona over a
// demo vault): the sidebar must head the config vault's own profile, and the
// switcher must not offer the demo one.
import { test, expect } from "@playwright/test";
import { openChatTab } from "./open-chat";
import { mockTauri } from "./tauri-mock";

test("production boot shows the real profile, never a stale demo one", async ({ page }) => {
  await mockTauri(page, { read_user_md: "# Sam, Who I Am\nBuilder." });
  await page.addInitScript(() => {
    const demo = { id: "p_demo", label: "Demo Persona", vaultPath: "/Users/sam/.prevail/demo-vault", color: "#3CD8FF" };
    localStorage.setItem("prevail.profiles", JSON.stringify([demo]));
    localStorage.setItem("prevail.profiles.activeId", "p_demo");
    localStorage.setItem("prevail.profiles.defaultId", "p_demo");
  });
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.goto("/");
  await openChatTab(page); await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });

  const switcher = page.getByRole("button", { name: "Switch profile" });
  await expect(switcher).toContainText("Sam", { timeout: 10_000 });
  await expect(switcher).not.toContainText("Demo Persona");
  await switcher.click();
  await expect(page.getByText("Demo Persona")).toHaveCount(0);

  const store = await page.evaluate(() => ({
    profiles: JSON.parse(localStorage.getItem("prevail.profiles") || "[]") as Array<{ id: string; label: string; vaultPath: string }>,
    active: localStorage.getItem("prevail.profiles.activeId"),
    def: localStorage.getItem("prevail.profiles.defaultId"),
  }));
  const real = store.profiles.find((p) => p.vaultPath === "/tmp/smoke-vault");
  expect(real?.label).toBe("Sam");
  expect(store.active).toBe(real?.id);
  expect(store.def).toBe(real?.id);
  // The demo profile is kept, only hidden.
  expect(store.profiles.some((p) => p.id === "p_demo")).toBe(true);
});

test("switching profile in production never asks to rewrite the main vault", async ({ page }) => {
  await mockTauri(page, { read_user_md: "# Sam, Who I Am" });
  await page.addInitScript(() => {
    const main = { id: "p_main", label: "Sam", vaultPath: "/tmp/smoke-vault" };
    const side = { id: "p_side", label: "Side Project", vaultPath: "/tmp/side-vault" };
    localStorage.setItem("prevail.profiles", JSON.stringify([main, side]));
    localStorage.setItem("prevail.profiles.activeId", "p_main");
  });
  await page.goto("/");
  await openChatTab(page); await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Switch profile" }).click();
  await page.getByRole("button", { name: /Side Project/ }).click();
  await expect(page.getByRole("button", { name: "Switch profile" })).toContainText("Side Project", { timeout: 10_000 });
  await expect.poll(async () => page.evaluate(() =>
    ((window as unknown as { __invokeLog: Array<{ cmd: string; args: { path?: string; main?: boolean } }> }).__invokeLog)
      .filter((e) => e.cmd === "engine_set_config_vault").map((e) => ({ path: e.args?.path, main: !!e.args?.main })),
  ), { timeout: 10_000 }).toEqual([{ path: "/tmp/side-vault", main: false }]);
});

test("production boot with four profiles stays on the config vault's profile and never writes config", async ({ page }) => {
  await mockTauri(page, { read_user_md: "# Sam, Who I Am" });
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    const list = [
      { id: "p_a", label: "Demo One", vaultPath: "/Users/sam/Documents/prevail-vaults/demo-one", image: "data:image/png;base64,AAAA" },
      { id: "p_b", label: "Demo Two", vaultPath: "/Users/sam/Documents/prevail-vaults/demo-two" },
      { id: "p_c", label: "Demo Three", vaultPath: "/Users/sam/Documents/prevail-vaults/demo-three" },
      { id: "p_main", label: "Sam", vaultPath: "/tmp/smoke-vault" },
    ];
    localStorage.setItem("prevail.profiles", JSON.stringify(list));
    localStorage.setItem("prevail.profiles.activeId", "p_main");
    localStorage.setItem("prevail.profiles.defaultId", "p_main");
    localStorage.setItem("prevail.desktop.vaultProduction", "/tmp/smoke-vault");
  });
  await page.goto("/");
  await openChatTab(page); await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(4_000);
  const state = await page.evaluate(() => ({
    active: localStorage.getItem("prevail.profiles.activeId"),
    def: localStorage.getItem("prevail.profiles.defaultId"),
    vault: localStorage.getItem("prevail.desktop.vaultPath"),
    writes: ((window as unknown as { __invokeLog: Array<{ cmd: string; args: { path?: string } }> }).__invokeLog)
      .filter((e) => e.cmd === "engine_set_config_vault" || e.cmd === "engine_appmode_set").map((e) => `${e.cmd}:${e.args?.path ?? ""}`),
  }));
  expect(state).toEqual({ active: "p_main", def: "p_main", vault: "/tmp/smoke-vault", writes: [] });
  await expect(page.getByRole("button", { name: "Switch profile" })).toContainText("Sam");
});

test("a failed mode read on a cold boot still opens the config vault's profile, not the startup default", async ({ page }) => {
  await mockTauri(page, { read_user_md: "# Sam, Who I Am", engine_appmode_get: null });
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("prevail.profiles", JSON.stringify([
      { id: "p_b", label: "Demo Two", vaultPath: "/Users/sam/Documents/prevail-vaults/demo-two" },
      { id: "p_main", label: "Sam", vaultPath: "/tmp/smoke-vault" },
    ]));
    localStorage.setItem("prevail.profiles.activeId", "p_b");
    localStorage.setItem("prevail.profiles.defaultId", "p_b");
  });
  await page.goto("/");
  await openChatTab(page); await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Switch profile" })).toContainText("Sam", { timeout: 10_000 });
  expect(await page.evaluate(() => localStorage.getItem("prevail.desktop.vaultPath"))).toBe("/tmp/smoke-vault");
});
