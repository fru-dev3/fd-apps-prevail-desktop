// Subsystem extracted from App.tsx (encapsulated module state).
import { useEffect, useState } from "react";
import { MODELS } from "./constants";
import { LS, lsGet, lsSet } from "./storage";
import type { ModelPick } from "./types";

export const COUNCIL_MEMBERS_KEY = "prevail.council.defaultMembers";

export const COUNCIL_CHAIR_KEY = "prevail.council.defaultChair";

export function councilSlotKey(cliId: string, modelId: string): string { return `${cliId}::${modelId}`; }

export function councilModelsFor(cliId: string): ModelPick[] {
  return MODELS[cliId] ?? [{ id: "", label: "Default", blurb: "" } as ModelPick];
}

export function readCouncilMembers(): string[] {
  // Only accept slot-key-shaped entries (`cli::model`). Older builds stored bare
  // CLI ids here; those are ignored so the panel re-seeds with real slots.
  try { const a = JSON.parse(lsGet(COUNCIL_MEMBERS_KEY) || "[]"); return Array.isArray(a) ? a.filter((x) => typeof x === "string" && x.includes("::")) : []; } catch { return []; }
}

export function readCouncilChair(): string { return lsGet(COUNCIL_CHAIR_KEY) || ""; }


// ── Named councils ──────────────────────────────────────────────────────────
// The user keeps several named councils ("Money council", "Quick check"), each
// with its own seats (slot keys `cli::model`) and chair. Exactly one is the
// Default. Stored as one list plus the default id. The legacy panel and chair
// keys above are still written from the Default council on every save, so
// anything that reads them (the chat Council tab seed, the WebUI) keeps working.
export type Council = { id: string; name: string; seats: string[]; chair: string };
export const COUNCILS_KEY = "prevail.council.list";
export const DEFAULT_COUNCIL_KEY = "prevail.council.defaultId";
export const COUNCILS_CHANGED = "prevail:council-changed";

function isCouncil(x: unknown): x is Council {
  const c = x as Council;
  return !!c && typeof c.id === "string" && typeof c.name === "string" && Array.isArray(c.seats) && typeof c.chair === "string";
}

export function readCouncils(): { councils: Council[]; defaultId: string } {
  let councils: Council[] = [];
  try {
    const a = JSON.parse(lsGet(COUNCILS_KEY) || "[]");
    if (Array.isArray(a)) councils = a.filter(isCouncil).map((c) => ({ ...c, seats: c.seats.filter((k) => typeof k === "string" && k.includes("::")) }));
  } catch { /* corrupt list: fall through to the migration below */ }
  if (councils.length === 0) {
    // Upgrade: the single panel and chair become the first council. Nothing
    // is dropped: the seats and chair are carried over as they were.
    councils = [{ id: "default", name: "Default council", seats: readCouncilMembers(), chair: readCouncilChair() }];
  }
  const saved = lsGet(DEFAULT_COUNCIL_KEY);
  const defaultId = councils.some((c) => c.id === saved) ? saved : councils[0].id;
  return { councils, defaultId };
}

export function writeCouncils(councils: Council[], defaultId: string): void {
  if (councils.length === 0) return; // never leave the user without a council
  const def = councils.find((c) => c.id === defaultId) ?? councils[0];
  lsSet(COUNCILS_KEY, JSON.stringify(councils));
  lsSet(DEFAULT_COUNCIL_KEY, def.id);
  // Legacy keys, mirrored from the Default council.
  lsSet(COUNCIL_MEMBERS_KEY, JSON.stringify(def.seats));
  lsSet(COUNCIL_CHAIR_KEY, def.chair);
  const cli = def.chair.split("::")[0];
  if (cli) lsSet(LS.defaultChairCli, cli);
  window.dispatchEvent(new Event(COUNCILS_CHANGED));
}

export function useCouncils(): { councils: Council[]; defaultId: string } {
  const [state, setState] = useState(readCouncils);
  useEffect(() => {
    const on = () => setState(readCouncils());
    window.addEventListener(COUNCILS_CHANGED, on);
    return () => window.removeEventListener(COUNCILS_CHANGED, on);
  }, []);
  return state;
}

export function newCouncilId(): string { return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; }

// "Use in chat": the Council tab picks this council up when it opens. Kept in
// module state as well as the event, because the tab mounts lazily and may
// miss the event on its first visit.
export const USE_COUNCIL_EVENT = "prevail:use-council";
let pendingCouncil: string | null = null;
export function requestCouncilInChat(id: string): void {
  pendingCouncil = id;
  window.dispatchEvent(new CustomEvent(USE_COUNCIL_EVENT, { detail: { id } }));
}
export function takePendingCouncil(): string | null { const id = pendingCouncil; pendingCouncil = null; return id; }

// Rough cost of one seat answering one council question. Local / open-source
// models run on-device, so they are free; cloud models use a blended $/1M
// tokens by tier times a typical council turn. An estimate, not a quote.
export const COUNCIL_OSS_TOKENS = ["ollama", "llama", "mistral", "qwen", "deepseek", "gemma", "phi", "mixtral", "mlx", "lmstudio", "omlx", "lm-studio", "localai", "llamacpp"];
export const COUNCIL_TURN_TOKENS = 6000;
export function seatIsLocal(key: string, label = ""): boolean {
  const hay = `${key} ${label}`.toLowerCase();
  return COUNCIL_OSS_TOKENS.some((t) => hay.includes(t));
}
export function seatCostUsd(key: string, label = ""): number {
  if (seatIsLocal(key, label)) return 0;
  const hay = `${key} ${label}`.toLowerCase();
  const flagship = ["fable", "opus", "astra", "gpt-6", "gpt-5", "gpt5", "gemini-3.1-pro", "gemini-pro", "grok-4", "o3", "o1"];
  const perMillion = flagship.some((t) => hay.includes(t)) ? 18 : 4;
  return (COUNCIL_TURN_TOKENS / 1_000_000) * perMillion;
}
export function fmtUsd(n: number): string {
  if (n <= 0) return "Free";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}
