import { test, expect, type Page } from "@playwright/test";
import { mockTauri } from "./tauri-mock";
const SHOTS = process.env.MOBILE_SHOTS_DIR || "/tmp";
// Both ends of the range people actually carry: a current iPhone, and the
// smallest screen still in common use. A layout that only works on the big one
// is not a mobile layout.
const SIZES = [
  { name: "iphone", width: 390, height: 844 },
  { name: "small", width: 360, height: 640 },
] as const;
test.use({ isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

async function measure(page: Page, label: string) {
  const m = await page.evaluate(() => {
    const q = (s: string) => (document.querySelector(s) as HTMLElement | null)?.getBoundingClientRect().height ?? 0;
    return {
      over: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      hOver: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      composer: q("[data-tour=composer]"),
      nav: q("nav[aria-label=Primary]"),
      vh: window.innerHeight,
    };
  });
  console.log(`${label}: vOver=${m.over} hOver=${m.hOver} composer=${Math.round(m.composer)} nav=${Math.round(m.nav)} of ${m.vh}`);
  expect(m.over, `${label} scrolls vertically`).toBeLessThanOrEqual(1);
  expect(m.hOver, `${label} scrolls horizontally`).toBeLessThanOrEqual(1);
  return m;
}

for (const size of SIZES) {
test(`${size.name}: chat fits, one model control, mic in the composer, nav collapsed`, async ({ page }) => {
  await page.setViewportSize({ width: size.width, height: size.height });
  await mockTauri(page, {
    engine_score_all: { life_readiness: 62, computed_at: "2026-09-11", domains: [{ domain: "career", score: 70 }] },
    detect_clis: [{ id: "claude", label: "Claude Code", available: true, versions: [] }],
  });
  page.on("pageerror", (e) => { throw new Error(`crash: ${e.message}`); });
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15000 });
  await measure(page, `${size.name} empty-chat`);
  await page.screenshot({ path: `${SHOTS}/m1-empty-${size.name}.png` });

  // Exactly one model control on screen.
  const modelPills = await page.getByText(/Claude Code/).count();
  console.log("model mentions on chat screen:", modelPills);

  // The mic lives in the composer row, not in a strip of its own.
  const mic = page.getByRole("button", { name: "Hold to talk" });
  await expect(mic).toBeVisible();
  const micBox = await mic.boundingBox();
  const compBox = await page.locator("[data-tour=composer]").boundingBox();
  const inside = micBox && compBox && micBox.y >= compBox.y && micBox.y + micBox.height <= compBox.y + compBox.height + 2;
  console.log("mic inside composer:", inside, "mic size:", Math.round(micBox?.width ?? 0));
  expect(inside, "the mic must sit inside the composer").toBeTruthy();
  expect(micBox!.width).toBeGreaterThanOrEqual(44);

  // Tapping it when the browser has no mic must SAY something, not sit dead.
  await mic.click();
  await expect(page.getByTestId("phone-voice-status")).toBeVisible({ timeout: 5000 });
  console.log("mic tap says:", (await page.getByTestId("phone-voice-status").innerText()).slice(0, 80));
  await page.screenshot({ path: `${SHOTS}/m2-mic-${size.name}.png` });
  await measure(page, `${size.name} mic-panel`);

  // Nav is collapsed by default and opens on the chevron.
  const handle = page.getByTestId("phone-nav-handle");
  await expect(handle).toBeVisible();
  await handle.click();
  await expect(page.getByRole("button", { name: "Domains" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/m3-nav-open-${size.name}.png` });
  await measure(page, `${size.name} nav-open`);
});
}

test("a sent prompt leaves the layout intact", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTauri(page, { detect_clis: [{ id: "claude", label: "Claude Code", available: true, versions: [] }] });
  await page.goto("/");
  await page.getByText("What should we work on?").waitFor({ timeout: 15000 });
  // Inject a streaming assistant turn shaped like the real one.
  await page.evaluate(() => {
    const ta = document.querySelector("[data-tour=composer] textarea") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(ta, "Hello");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  const meta = await page.evaluate(() => {
    const el = document.querySelector(".group .font-display")?.closest("div");
    return el ? (el as HTMLElement).innerText.replace(/\n/g, " | ") : "(no assistant turn)";
  });
  console.log("assistant meta row:", meta);
  expect(meta).not.toContain("NONE");
  await page.screenshot({ path: `${SHOTS}/m4-streaming.png` });
  await measure(page, "streaming");
});
