// Phone-width smoke: the same real bundle with mocked IPC, rendered at an
// iPhone viewport, which makes App.tsx swap the desktop cockpit for the
// PhoneShell (bottom tab bar + one full-width surface). Not pixel tests: each
// screen must render its purpose, navigate from the tab bar, and never scroll
// horizontally (the classic sign of a desktop layout leaking off a phone).
// Screenshots land in MOBILE_SHOTS_DIR for review.
import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";

const SHOTS = process.env.MOBILE_SHOTS_DIR || "/tmp";
const PHONE = { width: 390, height: 844 }; // iPhone 15 / 16 logical size

test.use({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

test.beforeEach(async ({ page }) => {
  await mockTauri(page, {
    // Readiness scores so the Domains screen shows its per-domain dots.
    engine_score_all: { life_readiness: 62, computed_at: "2026-09-11", domains: [{ domain: "career", score: 70 }, { domain: "health", score: 54 }] },
  });
  page.on("pageerror", (err) => { throw new Error(`frontend crashed: ${err.message}`); });
  await page.goto("/");
  await expect(page.getByText("What should we work on?")).toBeVisible({ timeout: 15_000 });
});

// A native app does not scroll as a whole: the shell is exactly the screen,
// and only the surface inside it scrolls. If the document grows past the
// viewport the entire app slides under your thumb, which is the tell that this
// is a web page in a costume.
async function fitsTheScreen(page: Page, label: string) {
  const { sh, ch } = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
  expect(sh, `${label}: the page itself scrolls vertically (${sh} > ${ch})`).toBeLessThanOrEqual(ch + 1);
}

async function noHorizontalScroll(page: Page, label: string) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `${label}: page scrolls horizontally (${sw} > ${cw})`).toBeLessThanOrEqual(cw + 1);
}

const tabBar = (page: Page) => page.getByRole("navigation", { name: "Primary" });

// The bottom nav is collapsed by default: the conversation is what you opened
// the app for, and 58px of permanent chrome on a 640px screen is a lot to pay
// for navigation you use a few times a session. Open it, then pick.
async function openNav(page: Page) {
  const handle = page.getByTestId("phone-nav-handle");
  if (await handle.count()) await handle.click();
}
async function goTab(page: Page, label: string) {
  await openNav(page);
  await tabBar(page).getByRole("button", { name: label }).click();
}

// The shell is pinned to the visible viewport, not the layout viewport. On
// mobile Safari `height: 100%` resolves against the taller URL-bar-hidden
// viewport, which is what made the whole app slide under your thumb.
test("the shell is pinned to the screen: no page scrolling, no rubber band", async ({ page }) => {
  const css = await page.evaluate(() => {
    const b = getComputedStyle(document.body);
    return {
      overflow: b.overflow,
      overscroll: b.overscrollBehaviorY,
      htmlH: document.documentElement.getBoundingClientRect().height,
      innerH: window.innerHeight,
    };
  });
  expect(css.overflow).toBe("hidden");
  expect(css.overscroll).toBe("none");
  // The document box is the screen, to the pixel.
  expect(Math.abs(css.htmlH - css.innerH)).toBeLessThanOrEqual(1);
});

test("bottom tab bar: collapsed by default, four tabs once opened", async ({ page }) => {
  // Collapsed state names where you are and offers the way up.
  const handle = page.getByTestId("phone-nav-handle");
  await expect(handle).toBeVisible();
  await expect(handle).toContainText("Chat");
  await handle.click();
  const nav = tabBar(page);
  await expect(nav).toBeVisible();
  for (const label of ["Chat", "Domains", "Needs you", "Settings"]) {
    await expect(nav.getByRole("button", { name: label })).toBeVisible();
  }
  await expect(nav.getByRole("button", { name: "Chat" })).toHaveAttribute("aria-current", "page");
  // Every tab is a real touch target.
  for (const label of ["Chat", "Domains", "Needs you", "Settings"]) {
    const box = await nav.getByRole("button", { name: label }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  // The desktop chrome must not be present at phone width.
  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
  await expect(page.getByText("Work board")).toBeHidden();
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
  await noHorizontalScroll(page, "home");
  await fitsTheScreen(page, "home");
});

test("Domains lists General + the fixture domains; tapping career opens its chat", async ({ page }) => {
  await goTab(page, "Domains");
  await expect(page.getByRole("heading", { name: "Domains" })).toBeVisible();
  await expect(page.locator("[data-domain=general]")).toBeVisible();
  await expect(page.locator("[data-domain=career]")).toBeVisible();
  await expect(page.locator("[data-domain=health]")).toBeVisible();
  await expect(page.locator("[data-domain=career]")).toContainText("70");
  await page.screenshot({ path: `${SHOTS}/phone-domains.png`, fullPage: false });
  await noHorizontalScroll(page, "domains");
  await fitsTheScreen(page, "domains");

  await page.locator("[data-domain=career]").click();
  // The nav puts itself away once you have chosen; its handle is what now
  // reports where you are.
  await expect(page.getByTestId("phone-nav-handle")).toContainText("Chat");
  await expect(page.getByRole("heading", { name: "Career" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-tour=composer] textarea")).toBeVisible();
  await expect(page.getByText("This section didn't load")).toHaveCount(0);
  // The composer sits above the tab bar, never under it.
  const composer = await page.locator("[data-tour=composer]").boundingBox();
  const nav = await tabBar(page).boundingBox();
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(nav!.y + 1);
  await page.screenshot({ path: `${SHOTS}/phone-chat.png`, fullPage: false });
  await noHorizontalScroll(page, "chat");
  await fitsTheScreen(page, "chat");

  // Threads sheet opens and closes.
  await page.getByRole("button", { name: /Threads/ }).click();
  await expect(page.getByRole("dialog", { name: "Threads" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog", { name: "Threads" })).toHaveCount(0);

  // Council toggle switches the same domain to the council surface.
  await page.getByRole("tab", { name: "Council" }).click();
  await expect(page.getByRole("tab", { name: "Council" })).toHaveAttribute("aria-selected", "true");
  await page.waitForTimeout(400);
  // The council surface must actually render, not fall into its error boundary.
  await expect(page.getByText("This section didn't load")).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/phone-council.png`, fullPage: false });
  await noHorizontalScroll(page, "council");
  await fitsTheScreen(page, "council");
});

// Voice: the mic is held (pointerdown), the fake recorder produces a blob on
// release, transcription is a mocked invoke, and the transcript must land in
// the composer textarea where Send would take it. getUserMedia + MediaRecorder
// are stubbed in an init script because headless Chromium has no microphone.
test("hold the mic, release, the transcript lands in the composer; Save as note files it", async ({ page }) => {
  await page.addInitScript(() => {
    // navigator.mediaDevices is a prototype getter with no setter: a plain
    // assignment is silently dropped and the real (device-less) API answers.
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) },
    });
    class FakeRecorder {
      static isTypeSupported(t: string) { return t.startsWith("audio/webm"); }
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(_s: unknown, opts?: { mimeType?: string }) { if (opts?.mimeType) this.mimeType = opts.mimeType; }
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob([new Uint8Array(64)], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  });
  await mockTauri(page, {
    engine_score_all: { life_readiness: 62, computed_at: "2026-09-11", domains: [{ domain: "career", score: 70 }] },
    transcribe_audio: { text: "Book the dentist for Tuesday morning", backend: "stub" },
    voice_note_capture: "n_voice_1",
  });
  await page.goto("/");
  await expect(page.getByText("What should we work on?")).toBeVisible({ timeout: 15_000 });
  await goTab(page, "Domains");
  await page.locator("[data-domain=career]").click();
  await expect(page.locator("[data-tour=composer] textarea")).toBeVisible();

  const mic = page.getByRole("button", { name: "Hold to talk" });
  await expect(mic).toBeVisible();
  const box = await mic.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  // It belongs in the composer row, next to Send, not in a strip of its own.
  const composer = await page.locator("[data-tour=composer]").boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(composer!.y);
  expect(box!.y + box!.height).toBeLessThanOrEqual(composer!.y + composer!.height + 2);
  await mic.dispatchEvent("pointerdown", { pointerId: 1, clientX: 40, clientY: 700, isPrimary: true });
  const held = page.getByRole("button", { name: "Recording, release to transcribe" });
  await expect(held).toBeVisible();
  await expect(page.getByTestId("phone-voice-timer")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/phone-voice-recording.png`, fullPage: false });
  await noHorizontalScroll(page, "voice recording");
  await fitsTheScreen(page, "voice recording");

  await page.waitForTimeout(500); // past the tap-vs-hold threshold
  await held.dispatchEvent("pointerup", { pointerId: 1, clientX: 40, clientY: 700, isPrimary: true });
  await expect(page.locator("[data-tour=composer] textarea")).toHaveValue("Book the dentist for Tuesday morning", { timeout: 10_000 });
  await expect(page.getByTestId("phone-voice-status")).toContainText("Fix a word");
  await page.screenshot({ path: `${SHOTS}/phone-voice-transcribed.png`, fullPage: false });
  await noHorizontalScroll(page, "voice transcribed");
  await fitsTheScreen(page, "voice transcribed");
  // Transcription ran through the Mac-side command, with the audio inline
  // (the mocked window is the Tauri path; a browser would upload first).
  const calls = await page.evaluate(() => (window as unknown as { __invokeLog: Array<{ cmd: string; args: { base64?: string; ext?: string } }> }).__invokeLog.filter((e) => e.cmd === "transcribe_audio"));
  expect(calls).toHaveLength(1);
  expect(calls[0].args.ext).toBe("webm");
  expect((calls[0].args.base64 ?? "").length).toBeGreaterThan(0);

  // Save as note files it into the current domain with the voice source.
  await page.getByRole("button", { name: "Save as note" }).click();
  await expect(page.getByText("Saved to notes")).toBeVisible();
  const notes = await page.evaluate(() => (window as unknown as { __invokeLog: Array<{ cmd: string; args: { domain?: string; text?: string } }> }).__invokeLog.filter((e) => e.cmd === "voice_note_capture"));
  expect(notes).toHaveLength(1);
  expect(notes[0].args.domain).toBe("career");
  expect(notes[0].args.text).toBe("Book the dentist for Tuesday morning");
  await expect(page.locator("[data-tour=composer] textarea")).toHaveValue("");
});

test("Needs you shows the approval queues", async ({ page }) => {
  await goTab(page, "Needs you");
  await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
  await expect(page.getByText("PayPal: create_invoice")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Gmail: send")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/phone-needs.png`, fullPage: false });
  await noHorizontalScroll(page, "needs");
  await fitsTheScreen(page, "needs");
});

test("Settings renders as a list, opens a section, and deep links land on the section", async ({ page }) => {
  await goTab(page, "Settings");
  await expect(page.locator("h1", { hasText: "Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Privacy" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/phone-settings.png`, fullPage: false });
  await noHorizontalScroll(page, "settings list");
  await fitsTheScreen(page, "settings list");

  await page.getByRole("button", { name: "Privacy" }).click();
  await expect(page.getByText("Bunker Mode").first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(300);
  await noHorizontalScroll(page, "settings section");
  await fitsTheScreen(page, "settings section");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("button", { name: "Privacy" })).toBeVisible();

  // A deep link from anywhere in the app opens the section directly.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "remote" })));
  await page.waitForTimeout(800);
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  await noHorizontalScroll(page, "settings deep link");
  await fitsTheScreen(page, "settings deep link");
});
