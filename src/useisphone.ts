// Phone-width detection for the shell. Below this width the desktop cockpit
// layout (rail + threads + main side by side) cannot fit, so the sidebar
// becomes an overlay drawer and the main column takes the full width. This is
// what makes the WebUI usable as an installed app on a phone.
import { useEffect, useState } from "react";

export const PHONE_MAX_PX = 767;
const QUERY = `(max-width: ${PHONE_MAX_PX}px)`;

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState<boolean>(() => {
    try { return typeof window !== "undefined" && window.matchMedia(QUERY).matches; } catch { return false; }
  });
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try { mq = window.matchMedia(QUERY); } catch { return; }
    const onChange = (e: MediaQueryListEvent) => setPhone(e.matches);
    setPhone(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq?.removeEventListener("change", onChange);
  }, []);
  return phone;
}

// The height of the part of the screen the user can actually see, in px, or
// null when the browser has no visualViewport (then CSS `height: 100%` on the
// pinned body is already right). On a phone the on-screen keyboard does not
// shrink the layout viewport: iOS Safari keeps the page the same size and
// SCROLLS it so the focused field is visible, which is exactly the "things
// move around" a pinned shell must never do. Sizing the shell to the visual
// viewport and holding the scroll at zero keeps the header put and the
// composer sitting on the keyboard.
export function useVisualViewportHeight(enabled: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") { setHeight(null); return; }
    const vv = window.visualViewport;
    if (!vv) { setHeight(null); return; }
    let raf = 0;
    const apply = () => {
      raf = 0;
      // Only pin when the visual viewport is smaller than the window (a
      // keyboard is up). Otherwise leave the CSS in charge so the URL bar
      // collapsing on scroll behaves as the browser intends.
      const keyboardUp = window.innerHeight - vv.height > 80;
      setHeight(keyboardUp ? Math.round(vv.height) : null);
      if (keyboardUp && (window.scrollY !== 0 || vv.offsetTop !== 0)) {
        try { window.scrollTo(0, 0); } catch { /* ignore */ }
      }
    };
    const onChange = () => { if (!raf) raf = window.requestAnimationFrame(apply); };
    vv.addEventListener("resize", onChange);
    vv.addEventListener("scroll", onChange);
    apply();
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      vv.removeEventListener("resize", onChange);
      vv.removeEventListener("scroll", onChange);
    };
  }, [enabled]);
  return height;
}
