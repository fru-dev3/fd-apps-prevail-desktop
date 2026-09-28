// Saved benchmark presets: a named set of models (cli::model keys) the Arena
// can run as a unit. Single-user, no DB: persisted as JSON in localStorage.
// A window event ("prevail:bench-presets") lets every mounted view refresh the
// instant a preset changes, mirroring benchNotify().
import { useEffect, useState } from "react";
import { lsGet, lsSet } from "./storage";

export type BenchSuite = {
  id: string;
  name: string;
  mode: "single" | "council";
  models: string[];   // cli::model keys; empty when mode === "council"
  domains: string[];  // lowercase domain slugs; empty = all domains
  createdAt: number;
  // Where this saved preset came from, so the UI can distinguish and filter
  // "presets I built myself" from "AI suggestions I chose to keep":
  //   • "manual"   : hand-built by the user (Save selected models as a preset)
  //   • "ai"       : saved from an AI-suggested preset card
  //   • "canonical": saved from a built-in canonical template card
  // Optional for back-compat: suites saved before this field existed have no
  // origin and are treated as "manual" everywhere (they were user-curated).
  origin?: "manual" | "ai" | "canonical";
};

// Back-compat helper: treat an origin-less suite as "manual" everywhere.
export function suiteOrigin(s: BenchSuite): "manual" | "ai" | "canonical" {
  return s.origin ?? "manual";
}

const SUITES_KEY = "prevail.bench.suites";
const EVENT = "prevail:bench-presets";

function readArr<T>(key: string): T[] {
  try {
    const v = JSON.parse(lsGet(key, "[]") || "[]");
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}
function writeArr<T>(key: string, arr: T[]) {
  lsSet(key, JSON.stringify(arr));
  window.dispatchEvent(new Event(EVENT));
}
// Stable, collision-resistant id. (Date.now()/random are fine in app code.)
function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Suites ─────────────────────────────────────────────────────────────────
export function listSuites(): BenchSuite[] {
  return readArr<BenchSuite>(SUITES_KEY).sort((a, b) => a.name.localeCompare(b.name));
}
export function saveSuite(s: Omit<BenchSuite, "id" | "createdAt">): BenchSuite | null {
  const nm = s.name.trim();
  if (!nm) return null;
  if (s.mode === "single" && s.models.length === 0) return null;
  const all = readArr<BenchSuite>(SUITES_KEY);
  const existing = all.find((x) => x.name.toLowerCase() === nm.toLowerCase());
  if (existing) {
    existing.name = nm;
    existing.mode = s.mode;
    existing.models = [...s.models];
    existing.domains = [...s.domains];
    // Re-save preserves the ORIGIN this preset was first saved with (updating a
    // saved preset does not change who it belongs to). Only fall back to the
    // incoming origin if the existing entry never had one (legacy migration).
    existing.origin = existing.origin ?? s.origin ?? "manual";
    writeArr(SUITES_KEY, all);
    return existing;
  }
  const suite: BenchSuite = { id: newId("ste"), name: nm, mode: s.mode, models: [...s.models], domains: [...s.domains], createdAt: Date.now(), origin: s.origin ?? "manual" };
  writeArr(SUITES_KEY, [...all, suite]);
  return suite;
}
// Create a preset by name with any number of models (a new preset starts
// empty and is filled in its detail), and edit one in place by id.
export function createSuite(name: string, models: string[] = []): BenchSuite {
  const all = readArr<BenchSuite>(SUITES_KEY);
  const taken = new Set(all.map((x) => x.name.toLowerCase()));
  let nm = name.trim() || "New preset";
  for (let n = 2; taken.has(nm.toLowerCase()); n++) nm = `${name.trim() || "New preset"} ${n}`;
  const suite: BenchSuite = { id: newId("ste"), name: nm, mode: "single", models: [...models], domains: [], createdAt: Date.now(), origin: "manual" };
  writeArr(SUITES_KEY, [...all, suite]);
  return suite;
}
export function updateSuite(id: string, patch: Partial<Pick<BenchSuite, "name" | "models">>) {
  const all = readArr<BenchSuite>(SUITES_KEY);
  const s = all.find((x) => x.id === id);
  if (!s) return;
  if (patch.name !== undefined && patch.name.trim()) s.name = patch.name.trim();
  if (patch.models) s.models = [...patch.models];
  writeArr(SUITES_KEY, all);
}
export function deleteSuite(id: string) {
  writeArr(SUITES_KEY, readArr<BenchSuite>(SUITES_KEY).filter((s) => s.id !== id));
}

// ── Live hooks ───────────────────────────────────────────────────────────────
function useStore<T>(read: () => T[]): T[] {
  const [items, setItems] = useState<T[]>(read);
  useEffect(() => {
    const sync = () => setItems(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync); // cross-tab / other windows
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return items;
}
export function useSuites(): BenchSuite[] { return useStore(listSuites); }

// ── Canonical LOCAL presets ──────────────────────────────────────────────────
// A few named presets that RESOLVE over the current model universe with no AI
// and no network, so they always work offline and auto-update as models appear
// or disappear. The Arena passes in the live model list it already enumerated;
// each preset is just a filter over it. These sit above the AI suggestions as
// always-present one-tap rows, and can be Applied / Run / Saved like any preset.
//
// `AvailablePresetModel` is the desktop's enumerated model, shaped to what these
// filters need. `provider` is the cli id (used for one-per-provider grouping);
// `local` marks open-weight / locally hosted runtimes (harness, ollama, lmstudio,
// mlx); `validated` marks a runtime that verified end-to-end.
export type AvailablePresetModel = {
  key: string;        // "cli::model"
  provider: string;   // cli id
  local: boolean;
  validated: boolean;
};

export type CanonicalPreset = { name: string; rationale: string; models: string[] };

export function canonicalPresets(input: AvailablePresetModel[]): CanonicalPreset[] {
  const out: CanonicalPreset[] = [];
  const cap = (models: string[]): string[] => models.slice(0, 6); // keep presets tight
  // The "auto" router sentinel is not a model. Callers already drop it, but
  // guard here too: it was what made "One per provider" read "Auto · Auto ·
  // Auto" (each provider's curated list leads with Auto).
  const available = input.filter((m) => m.key.split("::")[1] !== "auto");

  const validated = available.filter((m) => m.validated);
  if (validated.length >= 2) {
    out.push({
      name: "All validated",
      rationale: "Every model whose runtime is verified and ready to run.",
      models: cap(validated.map((m) => m.key)),
    });
  }

  const local = available.filter((m) => m.local);
  if (local.length >= 1) {
    out.push({
      name: "Local / open models",
      rationale: "Open-weight and locally hosted models. Runs fully offline.",
      models: cap(local.map((m) => m.key)),
    });
  }

  const cloud = available.filter((m) => !m.local);
  if (cloud.length >= 2) {
    out.push({
      name: "Cloud only",
      rationale: "The hosted frontier providers, head to head.",
      models: cap(cloud.map((m) => m.key)),
    });
  }

  // One per provider: the first enumerated (flagship / curated-first) model of
  // each detected provider. Order follows the order models were passed in.
  const seenProvider = new Set<string>();
  const onePer: string[] = [];
  for (const m of available) {
    if (seenProvider.has(m.provider)) continue;
    seenProvider.add(m.provider);
    onePer.push(m.key);
  }
  if (onePer.length >= 2) {
    out.push({
      name: "One per provider",
      rationale: "A single representative model from each detected provider.",
      models: cap(onePer),
    });
  }

  // Never surface an empty or single-model preset (a benchmark needs >= 2).
  return out.filter((p) => p.models.length >= 2);
}
