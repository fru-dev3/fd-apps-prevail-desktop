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
