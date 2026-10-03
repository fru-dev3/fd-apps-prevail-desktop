// "Chat about this": a fresh conversation in the full chat, the composer
// seeded with what the line or record is, so the user just adds their words.
// General chats carry the Compass, so a Compass line arrives with its context.
// Survives the navigation (ChatPanel reads the pending seed on mount).
export function chatAbout(seed: string, domain = ""): void {
  try { localStorage.setItem("prevail.compose.pending", seed); } catch { /* storage off */ }
  window.dispatchEvent(new Event("prevail:new-chat"));
  window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: domain }));
  window.dispatchEvent(new CustomEvent("prevail:compose-seed", { detail: seed }));
}
