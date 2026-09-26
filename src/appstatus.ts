// Vault apps (the engine's `connectors list`): the browser, CLI and Obsidian
// lanes plus any app a domain was bound to. Their status folding and the
// in-app due-pass scheduler live here, shared by the app shell and the Map.
import { invoke } from "./bridge";
import { PREF, getPref, lsGet, lsSet } from "./storage";
import type { EngineApp } from "./types";

export type AppStatus = "connected" | "authorized" | "attention" | "connecting" | "disconnected";

// Fold the engine's status strings + flags into the states the user needs to
// tell apart. "connected" requires a REAL successful fetch (firstFetchOk, or the
// legacy lastSuccessTs); credentials present but nothing pulled yet is
// "authorized", never green.
export function appStatus(a: EngineApp): AppStatus {
  const s = (a.status || "").toLowerCase();
  if (s.includes("sync") || s.includes("connecting") || s.includes("probing")) return "connecting";
  if (!a.configured) return "disconnected";
  if (a.lastError || s.includes("error") || s.includes("expired") || s.includes("fail") || s.includes("auth")) return "attention";
  if (!a.firstFetchOk && !a.lastSuccessTs) return "authorized";
  return "connected";
}

// In-app autonomous sync: trigger a "due pass" on a cadence so vault apps
// refresh on their own schedule while the app is open (the headless
// `daemon --sync` does the same when the app is closed). The tick re-reads the
// enabled pref, and the engine respects each app's own schedule + the file lock.
let appsSyncTimer: number | null = null;
export function startAppsScheduler(vault: string) {
  if (appsSyncTimer !== null) window.clearInterval(appsSyncTimer);
  const tick = async () => {
    try {
      if (getPref(PREF.appsAutoSync, "1") !== "1") return;
      const intervalMs = (Number(getPref(PREF.appsSyncIntervalSec, "300")) || 300) * 1000;
      const last = Number(lsGet(PREF.appsSyncLastRun, "0")) || 0;
      if (Date.now() - last < intervalMs) return;
      lsSet(PREF.appsSyncLastRun, String(Date.now()));
      await invoke("engine_apps_sync_due", { vault });
      window.dispatchEvent(new Event("prevail:apps-synced"));
    } catch (e) { console.error("apps sync scheduler tick", e); }
  };
  appsSyncTimer = window.setInterval(tick, 60_000);
  window.setTimeout(tick, 12_000);
}
