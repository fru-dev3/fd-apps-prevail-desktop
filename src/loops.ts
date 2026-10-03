// Playbooks replace loops (owner, 2026-10-02). The loops UI is gone: every loop
// is carried into a scheduled playbook by the engine (`prevail playbook
// migrate-loops`), and the Playbooks page shows the schedules. What is left here:
// adding one loop line from chat (the engine carries it over at once), and the
// timer that asks the engine to run whatever is due.
import { invoke } from "./bridge";
import { PREF, cheapModel, getPref, lsGet, lsSet } from "./storage";

/** The fields a new loop line needs; the engine keeps every other field as it is on disk. */
export interface Loop {
  id: string; name: string; purpose: string; type: "open" | "closed"; signals: string[]; condition: string;
  cadence: "continuous" | "daily" | "weekly" | "monthly"; autonomy?: "suggest" | "tasks" | "ask" | "auto";
  evaluation: string; actions: string[]; status: "active" | "paused" | "done"; enabled: boolean;
  lastRunTs: number | null; createdTs: number;
}

let loopSeq = 0;
export function newLoopId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "loop";
  return `loop-${slug}-${Date.now().toString(36)}-${(loopSeq++).toString(36)}`;
}

/** Put one loop line at the top of a domain's _loops.json, leaving every other line byte for byte as it was. */
export async function addLoop(domainPath: string, loop: Loop): Promise<void> {
  const path = `${domainPath.replace(/\/+$/, "")}/_loops.json`;
  let doc: Record<string, unknown> = { schema: 1, desiredState: "", loops: [] };
  try {
    const raw = await invoke<string>("read_file", { path });
    if (raw && raw.trim()) doc = JSON.parse(raw) as Record<string, unknown>;
  } catch { /* no loops file yet */ }
  const loops = Array.isArray(doc.loops) ? doc.loops : [];
  await invoke("write_text_file", { path, contents: JSON.stringify({ ...doc, loops: [loop, ...loops] }, null, 2) });
}

// ── In-app loop runner (behind the scenes) ───────────────────────────────────
// Loops should advance on their own, not only when the user clicks "Run loops
// now". This is a module-level timer (same pattern as the benchmark/backup
// schedulers): it wakes on a cadence and triggers one loop pass via the engine,
// which advances every DUE loop (each loop still respects its own cadence). The
// tick re-reads the prefs each time, so toggling needs no restart.
let loopsSchedTimer: number | null = null;
export function startLoopsScheduler(vault: string) {
  if (loopsSchedTimer !== null) window.clearInterval(loopsSchedTimer);
  const tick = async () => {
    try {
      if (getPref(PREF.loopsAutoRun, "1") !== "1") return;
      const intervalMs = (Number(getPref(PREF.loopsIntervalSec, "3600")) || 3600) * 1000;
      const last = Number(lsGet(PREF.loopsLastRun, "0")) || 0;
      if (Date.now() - last < intervalMs) return;
      // Stamp BEFORE running so a long pass can't trigger overlapping runs.
      lsSet(PREF.loopsLastRun, String(Date.now()));
      const provider = getPref(PREF.memoryProvider, "claude");
      const model = cheapModel();
      await invoke("loops_run_once", { vault, provider, model });
      window.dispatchEvent(new Event("prevail:loops-advanced"));
    } catch (e) {
      console.error("loops scheduler tick", e);
    }
  };
  // First check shortly after launch, then on a steady cadence.
  loopsSchedTimer = window.setInterval(tick, 60_000);
  window.setTimeout(tick, 8_000);
}
