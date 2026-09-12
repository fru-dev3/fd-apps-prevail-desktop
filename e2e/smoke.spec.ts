// The five load-bearing flows (G2). Not pixel tests: each asserts the screen
// actually renders its purpose and that its primary control invokes the right
// backend command. A crash, a dead button, or a gutted section fails here
// before a tag can build.
import { test, expect } from "@playwright/test";
import { mockTauri, invokedCommands } from "./tauri-mock";

test.beforeEach(async ({ page }) => {
  await mockTauri(page);
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.goto("/");
});

test("1 · home renders: headline, composer, trust ribbon with the guardrail segment", async ({ page }) => {
  await expect(page.getByText("What should we work on?")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Guardrail on/i)).toBeVisible();
  await expect(page.getByText(/Vault locked/i)).toBeVisible();
  // Self-hosted fonts must actually load (no runtime Google fetch, no silent
  // fallback). Confirm the bundled Inter face is available.
  const interLoaded = await page.evaluate(() => (document as unknown as { fonts: { check: (f: string) => boolean } }).fonts.check("16px Inter"));
  expect(interLoaded).toBe(true);
  // And nothing tried to reach Google Fonts.
  const gf = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => (r as PerformanceResourceTiming).name).filter((n) => n.includes("fonts.g")));
  expect(gf).toEqual([]);
});

test("2 · Needs You shows both approval queues; approving a connector act uses the token spine", async ({ page }) => {
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  // The approval inbox lives in the Work board's "Needs you" view.
  await page.evaluate(() => {
    localStorage.setItem("prevail.board.openNeeds", "1");
    window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "tasks" }));
    window.dispatchEvent(new CustomEvent("prevail:board-view", { detail: "needs" }));
  });
  const actCard = page.getByText("PayPal: create_invoice");
  await expect(actCard).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Gmail: send")).toBeVisible();
  // The sensitive act shows the explicit release wording, not a plain approve.
  await expect(page.getByText(/Approve including sensitive info/i)).toBeVisible();
  await page.getByText(/Approve including sensitive info/i).click();
  const cmds = await invokedCommands(page);
  expect(cmds).toContain("loop_request_approval");
  expect(cmds).toContain("engine_acts_approve");
});

test("3 · Privacy page: all four controls render; the guardrail toggle drives both engine flags", async ({ page }) => {
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "privacy" })));
  await expect(page.getByText("Bunker Mode").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Vault Lock").first()).toBeVisible();
  await expect(page.getByText("Outbound Guardrail").first()).toBeVisible();
  await expect(page.getByText(/nothing reaches another party without you/i)).toBeVisible();
  await page.getByLabel("Outbound guardrail").click();
  const cmds = await invokedCommands(page);
  expect(cmds).toContain("email_policy_set");
  expect(cmds).toContain("egress_guard_set");
});

test("4 · Editor sections switch without crashing (tools, skills, apps)", async ({ page }) => {
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  for (const section of ["tools", "skills", "connectors", "usage", "intents"]) {
    await page.evaluate((s) => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: s })), section);
    await page.waitForTimeout(400); // sections lazy-load; a crash throws pageerror
  }
});

// Remote: the pair card must show the same-Wi-Fi address with no Tailscale on
// the phone, and one tap must turn on the internet tunnel and move the QR to
// its https address (the one that makes the phone mic work).
test("6 · Remote: Wi-Fi address in the pair card; Share over the internet swaps the QR to the tunnel", async ({ page }) => {
  const off = {
    running: true, port: 8787, user: "admin", remote: true,
    remote_url: "http://192.168.1.20:8787", via_tailscale: false,
    lan_url: "http://192.168.1.20:8787", tailscale_url: "", tunnel_url: "",
    tunnel_state: "off", tunnel_error: "", cloudflared_installed: true, pair_ready: true, bunker_blocking: false,
    devices: [{ id: "d_1", label: "iPhone (Safari)", ip: "192.168.1.44", first_seen_ms: Date.now() - 60000, last_seen_ms: Date.now() - 5000, via: "qr" }],
  };
  const on = { ...off, remote_url: "https://witty-otter-cat.trycloudflare.com", tunnel_url: "https://witty-otter-cat.trycloudflare.com", tunnel_state: "on" };
  await mockTauri(page, { webui_status: off, webui_secret_get: "hunter2", webui_tunnel_start: on, webui_tunnel_stop: off, webui_pair_code: "http://192.168.1.20:8787/#p=deadbeefdeadbeef" });
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "phone" })));
  const card = page.getByTestId("remote-pair");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("remote-primary-url")).toHaveText("http://192.168.1.20:8787");
  await expect(page.getByTestId("remote-lan")).toContainText("192.168.1.20");
  await expect(card.getByAltText(/QR code for http:\/\/192\.168\.1\.20:8787/)).toBeVisible();
  await expect(card.getByText(/Same Wi-Fi as this Mac/)).toBeVisible();

  await card.getByRole("button", { name: "Share over the internet" }).click();
  // The status poll must agree with what the start command returned.
  await page.evaluate((s) => { (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures.webui_status = s; }, on);
  await expect(page.getByTestId("remote-tunnel-url")).toHaveText("https://witty-otter-cat.trycloudflare.com");
  await expect(page.getByTestId("remote-primary-url")).toHaveText("https://witty-otter-cat.trycloudflare.com");
  await expect(card.getByAltText(/QR code for https:\/\/witty-otter-cat\.trycloudflare\.com/)).toBeVisible();
  await expect(card.getByText(/Over the internet/)).toBeVisible();
  const cmds = await invokedCommands(page);
  expect(cmds).toContain("webui_tunnel_start");
  await page.screenshot({ path: `${process.env.MOBILE_SHOTS_DIR || "/tmp"}/desktop-remote-tunnel.png` });

  await card.getByRole("button", { name: "Stop sharing" }).click();
  await page.evaluate((s) => { (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures.webui_status = s; }, off);
  await expect(card.getByRole("button", { name: "Share over the internet" })).toBeVisible();
  await expect(page.getByTestId("remote-primary-url")).toHaveText("http://192.168.1.20:8787");
});

// Phone is its own destination in the sidebar, and turning it on is one
// button: mobile access used to be buried inside the WebUI panel.
test("7 · Phone is a top-level section and turns itself on in one tap", async ({ page }) => {
  const offline = { running: false, port: 8787, user: "admin", remote: false, remote_url: "", via_tailscale: false, lan_url: "", tailscale_url: "", tunnel_url: "", tunnel_state: "off", tunnel_error: "", cloudflared_installed: true, pair_ready: false, devices: [], bunker_blocking: false };
  const live = { ...offline, running: true, remote: true, remote_url: "http://192.168.1.20:8787", lan_url: "http://192.168.1.20:8787", pair_ready: true };
  await mockTauri(page, { webui_status: offline, webui_secret_get: "", webui_pair_code: "http://192.168.1.20:8787/#p=deadbeefdeadbeef" });
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });

  // Reachable by name from the Editor sidebar, not only by deep link.
  await page.getByRole("button", { name: "Editor" }).click();
  const phoneNav = page.getByRole("button", { name: "Phone", exact: true });
  await expect(phoneNav).toBeVisible({ timeout: 10_000 });
  await phoneNav.click();
  await expect(page.getByText("Put Prevail on your phone")).toBeVisible();

  await page.getByRole("button", { name: "Turn on phone access" }).click();
  await page.evaluate((s) => { (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures.webui_status = s; }, live);
  await expect(page.getByTestId("remote-pair")).toBeVisible({ timeout: 10_000 });
  const cmds = await invokedCommands(page);
  expect(cmds).toContain("webui_start");
  // A password was minted and stored, so the user never had to invent one.
  expect(cmds).toContain("webui_secret_set");
  // The QR must promise a no-typing sign-in, which is the whole point.
  await expect(page.getByText(/You are signed in\./)).toBeVisible();
  await page.screenshot({ path: `${process.env.MOBILE_SHOTS_DIR || "/tmp"}/desktop-phone-section.png` });
});

test("5 · telemetry: section navigation emits allowlisted feature_used events only", async ({ page }) => {
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "skills" })));
  await page.waitForTimeout(300);
  const log = await page.evaluate(() => localStorage.getItem("prevail.telemetry.log") ?? "[]");
  const events = JSON.parse(log) as Array<{ event: string; props: Record<string, unknown> }>;
  const feats = events.filter((e) => e.event === "feature_used");
  expect(feats.length).toBeGreaterThan(0);
  // The scrubber must have dropped anything not in the closed enum.
  for (const f of feats) {
    if (typeof f.props.feature === "string") expect(f.props.feature).toMatch(/^[a-z_]+$/);
  }
});

// Multiple phones, each revocable on its own, and a master off switch.
test("8 · connected phones are listed and can be disconnected one at a time", async ({ page }) => {
  const two = [
    { id: "d_1", label: "iPhone (Safari)", ip: "192.168.1.44", first_seen_ms: Date.now() - 600000, last_seen_ms: Date.now() - 4000, via: "qr" },
    { id: "d_2", label: "iPad (Safari)", ip: "192.168.1.45", first_seen_ms: Date.now() - 90000, last_seen_ms: Date.now() - 90000, via: "password" },
  ];
  const live = {
    running: true, port: 8787, user: "admin", remote: true,
    remote_url: "http://192.168.1.20:8787", via_tailscale: false,
    lan_url: "http://192.168.1.20:8787", tailscale_url: "", tunnel_url: "",
    tunnel_state: "off", tunnel_error: "", cloudflared_installed: true, pair_ready: true,
    bunker_blocking: false, devices: two,
  };
  const afterRevoke = { ...live, devices: [two[1]] };
  await mockTauri(page, { webui_status: live, webui_secret_get: "x", webui_pair_code: "http://192.168.1.20:8787/#p=abc123abc123", webui_device_revoke: afterRevoke, webui_device_revoke_all: { ...live, devices: [] } });
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "phone" })));

  const list = page.getByTestId("remote-devices");
  await expect(list).toBeVisible({ timeout: 10_000 });
  await expect(list).toContainText("Connected phones (2)");
  await expect(list.locator("[data-device=d_1]")).toContainText("iPhone (Safari)");
  await expect(list.locator("[data-device=d_1]")).toContainText("paired by code");
  await expect(list.locator("[data-device=d_2]")).toContainText("iPad (Safari)");

  await list.locator("[data-device=d_1]").getByRole("button", { name: "Disconnect" }).click();
  await page.evaluate((s) => { (window as unknown as { __fixtures: Record<string, unknown> }).__fixtures.webui_status = s; }, afterRevoke);
  await expect(list.locator("[data-device=d_1]")).toHaveCount(0);
  await expect(list.locator("[data-device=d_2]")).toBeVisible();
  const cmds = await invokedCommands(page);
  expect(cmds).toContain("webui_device_revoke");
  await page.screenshot({ path: `${process.env.MOBILE_SHOTS_DIR || "/tmp"}/desktop-phone-devices.png` });

  // And the master switch stops the bridge, which takes every device with it.
  await page.getByRole("button", { name: "Turn off phone access" }).click();
  expect(await invokedCommands(page)).toContain("webui_stop");
});

// Bunker Mode's promise is that nothing leaves this Mac, and a phone on the
// network is a way off it. The screen must say so rather than silently fail.
test("9 · Bunker Mode blocks phone access and explains why", async ({ page }) => {
  const blocked = {
    running: false, port: 8787, user: "admin", remote: false, remote_url: "", via_tailscale: false,
    lan_url: "", tailscale_url: "", tunnel_url: "", tunnel_state: "off", tunnel_error: "",
    cloudflared_installed: true, pair_ready: false, devices: [], bunker_blocking: true,
  };
  await mockTauri(page, { webui_status: blocked });
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "phone" })));
  await expect(page.getByText("Bunker Mode is on, so phones cannot connect")).toBeVisible({ timeout: 10_000 });
  // No way to switch it on from here: the block is real, not advisory.
  await expect(page.getByRole("button", { name: "Turn on phone access" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open Privacy" })).toBeVisible();
});
