// Copy on select: like a terminal, text you select in replies and pages goes
// straight to the clipboard. Text boxes are left alone, so selecting text to
// retype it never overwrites the clipboard. Settings > Behavior turns it off.
import { PREF, getPref } from "./storage";
import { toast } from "./toast";

/** Whether a selection anchored at `node` with this text should be copied. */
export function shouldCopy(node: Node | null, text: string): boolean {
  if (text.trim().length < 2) return false;
  const el = node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
  if (!el) return false;
  return !el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-no-copy-on-select]");
}

let last = { text: "", at: 0 };

function onMouseUp() {
  if (getPref(PREF.copyOnSelect, "1") !== "1") return;
  // After the browser settles the selection (double and triple click too).
  window.setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString();
    if (!shouldCopy(sel.anchorNode, text) || !shouldCopy(sel.focusNode, text)) return;
    const now = Date.now();
    if (text === last.text && now - last.at < 1500) return;
    last = { text, at: now };
    void navigator.clipboard?.writeText(text).then(() => toast("Copied", { duration: 1200 })).catch(() => {});
  }, 0);
}

export function installCopyOnSelect(): void {
  document.addEventListener("mouseup", onMouseUp);
}
