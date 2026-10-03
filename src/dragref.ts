// Dragging things from a list into a chat. WKWebView's HTML5 drag and drop
// does not reliably fire dragstart, so a press that moves 6px becomes a manual
// drag with a pill under the pointer; the drop callback gets the mouseup.
//
// A specialist dropped on a chat hands the message to it, exactly like typing
// "@Name" (the composer starts "@Name "). Dropped on a sidebar row that opens a
// chat (Home, a domain, a mission), that chat opens with the handoff waiting.

export function startPillDrag(e: { button: number; clientX: number; clientY: number }, label: string, drop: (ev: MouseEvent) => void) {
  if (e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = false;
  let pill: HTMLDivElement | null = null;
  const onMove = (ev: MouseEvent) => {
    if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
    if (!dragging) {
      dragging = true;
      pill = document.createElement("div");
      pill.textContent = label;
      pill.setAttribute("data-testid", "drag-pill");
      pill.style.cssText =
        "position:fixed;z-index:9999;pointer-events:none;padding:6px 10px;border-radius:9999px;" +
        "background:var(--color-accent);color:var(--color-on-accent,#fff);font-size:12px;font-weight:600;" +
        "box-shadow:0 6px 20px rgba(0,0,0,0.2);transform:translate(-50%,-50%);";
      document.body.appendChild(pill);
      document.body.style.userSelect = "none";
    }
    if (pill) { pill.style.left = ev.clientX + "px"; pill.style.top = ev.clientY + "px"; }
  };
  const onUp = (ev: MouseEvent) => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.body.style.userSelect = "";
    if (pill) { pill.remove(); pill = null; }
    if (!dragging) return; // a click: let onClick fire
    ev.preventDefault();
    ev.stopPropagation();
    drop(ev);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

/** A mouseup that landed back on the sidebar. */
export const inSidebar = (ev: MouseEvent) => !!(ev.target as HTMLElement | null)?.closest?.("aside, [data-sidebar]");

export const HANDOFF_EVENT = "prevail:handoff";
export const HANDOFF_PENDING_EVENT = "prevail:handoff-pending";
const PENDING_KEY = "prevail.chat.handoff";

/** The composer text with the message handed to `label`: "@Label rest", never twice. */
export function withHandoff(input: string, label: string): string {
  const rest = input.replace(/^\s+/, "");
  const at = `@${label.toLowerCase()}`;
  if (rest.toLowerCase().startsWith(`${at} `)) return rest;
  if (rest.toLowerCase() === at) return `${rest} `;
  return `@${label} ${rest}`;
}

/** Drop a specialist where the pointer is: on a chat, or on a row that opens one. */
export function dropSpecialist(ev: MouseEvent, label: string): boolean {
  const at = (ev.target as HTMLElement | null) ?? null;
  const chat = at?.closest?.("[data-chat-drop]");
  if (chat) { chat.dispatchEvent(new CustomEvent(HANDOFF_EVENT, { detail: label, bubbles: true })); return true; }
  const row = at?.closest?.("[data-chat-target]") as HTMLElement | null;
  if (row) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify({ label, at: Date.now() })); } catch { /* storage off */ }
    row.click();
    setTimeout(() => window.dispatchEvent(new Event(HANDOFF_PENDING_EVENT)), 60);
    return true;
  }
  return false;
}

/** The handoff waiting for the next chat that opens (20 seconds at most); read once. */
export function takePendingHandoff(now = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    localStorage.removeItem(PENDING_KEY);
    const p = JSON.parse(raw) as { label?: string; at?: number };
    return typeof p.label === "string" && p.label && now - (p.at ?? 0) < 20_000 ? p.label : null;
  } catch { return null; }
}
