// Transport bridge — the WebUI "wrapper" seam.
//
// The desktop frontend talks to the backend via Tauri IPC (invoke/listen).
// To serve the SAME UI bundle in a browser (no rebuild, no duplicate UI), the
// few import sites point here instead of directly at @tauri-apps/api. On the
// desktop (Tauri present) this delegates 1:1 to the real API — identical
// behavior. In a plain browser it routes invoke over HTTP POST and events over
// Server-Sent Events to the in-app bridge server (see src-tauri/src/webui.rs).
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, emit as tauriEmit, type UnlistenFn, type EventCallback } from "@tauri-apps/api/event";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Browser auth token (set by the WebUI login screen). Kept in localStorage so
// an installed home-screen app (iOS/Android PWA) stays signed in across
// launches: sessionStorage is wiped every time the standalone app is closed,
// which meant re-typing the password on every open. The token is already
// per-server-session (a restart mints a new one), so persistence on the
// user's own device costs nothing extra.
const TOKEN_KEY = "prevail.web.token";
export function setWebToken(t: string): void {
  try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
  try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
}
export function getWebToken(): string {
  try { const v = localStorage.getItem(TOKEN_KEY); if (v) return v; } catch { /* ignore */ }
  try { return sessionStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
}
export function clearWebToken(): void {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}
function token(): string {
  return getWebToken();
}
export function isBrowser(): boolean { return !isTauri; }

// ── QR pairing ────────────────────────────────────────────────────────
// The QR code on the Mac carries a one-shot code in the URL FRAGMENT
// (`#p=...`). A fragment is never sent to any server, so the code stays out of
// request logs and out of the Cloudflare tunnel; only this script reads it.
// Trading it for a session token is what spares the user from typing a
// password on a phone keyboard.
export function pendingPairCode(): string {
  if (typeof window === "undefined") return "";
  const h = window.location.hash.replace(/^#/, "");
  const code = new URLSearchParams(h).get("p") ?? "";
  return /^[a-f0-9]{16,128}$/i.test(code) ? code : "";
}

// Strip the code from the address bar so it is not left in history, in a
// screenshot, or in a link the user shares afterwards.
function forgetPairCode(): void {
  try {
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    h.delete("p");
    const rest = h.toString();
    window.history.replaceState(null, "", window.location.pathname + window.location.search + (rest ? `#${rest}` : ""));
  } catch { /* history unavailable, the code just stays in the bar */ }
}

export async function redeemPairCode(): Promise<boolean> {
  const code = pendingPairCode();
  if (!code) return false;
  try {
    const res = await fetch("/api/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const j = (await res.json().catch(() => ({}))) as { token?: string };
    if (!res.ok || !j.token) return false;
    setWebToken(j.token);
    return true;
  } catch {
    return false;
  } finally {
    forgetPairCode();
  }
}

export async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) return tauriInvoke<T>(cmd, args);
  const res = await fetch("/api/invoke", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: token() },
    body: JSON.stringify({ cmd, args: args ?? {} }),
  });
  if (res.status === 401) throw new Error("unauthorized, sign in again");
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  const j = (await res.json()) as { data?: T; error?: string };
  if (j && j.error) throw new Error(j.error);
  return j.data as T;
}

// Browser-only: ship a voice recording to the Mac (POST /api/upload-audio,
// same bearer token as invoke) and get back the staged path that
// `transcribe_audio` accepts. In the Tauri window the caller passes base64
// through invoke instead, so this is never reached there.
export async function uploadAudio(blob: Blob): Promise<string> {
  const res = await fetch("/api/upload-audio", {
    method: "POST",
    headers: { "content-type": blob.type || "audio/webm", authorization: token() },
    body: blob,
  });
  if (res.status === 401) throw new Error("unauthorized, sign in again");
  const j = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
  if (!res.ok || j.error || !j.path) throw new Error(j.error || `upload failed (HTTP ${res.status})`);
  return j.path;
}

// ── Browser event bus over SSE ────────────────────────────────────────
let es: EventSource | null = null;
const handlers = new Map<string, Set<(p: unknown) => void>>();
function ensureSse(): void {
  if (es) return;
  es = new EventSource(`/api/events?token=${encodeURIComponent(token())}`);
  es.onmessage = (m) => {
    try {
      const { event, payload } = JSON.parse(m.data) as { event: string; payload: unknown };
      const set = handlers.get(event);
      if (set) set.forEach((h) => h({ event, payload, id: 0 } as unknown as never));
    } catch { /* malformed event — skip */ }
  };
  // EventSource auto-reconnects on error; nothing to do.
}
export async function listen<T = unknown>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  if (isTauri) return tauriListen<T>(event, handler);
  ensureSse();
  let set = handlers.get(event);
  if (!set) { set = new Set(); handlers.set(event, set); }
  const h = handler as unknown as (p: unknown) => void;
  set.add(h);
  return () => { set!.delete(h); };
}
export async function emit(event: string, payload?: unknown): Promise<void> {
  if (isTauri) return tauriEmit(event, payload);
  await fetch("/api/emit", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: token() },
    body: JSON.stringify({ event, payload }),
  });
}

export type { UnlistenFn, EventCallback } from "@tauri-apps/api/event";
