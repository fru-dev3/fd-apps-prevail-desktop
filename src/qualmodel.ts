// Metrics M4 (qualitative and alignment): the shapes `prevail metrics
// lived|guardrails|lags|proxies|themes|seasons --json` return, and the
// WHO-5 items as the engine asks them.

export interface LivedMetric { id: string; title: string; value: number; score: number; basis: string; paused?: string }
export interface ValueLived { id: string; title: string; rank: number; matters: number; lived: number | null; metrics: LivedMetric[]; checkin?: number; unmeasured: boolean }
export interface Guardrail { metric: string; title: string; guard: string; guard_title: string; state: "holding" | "slipping" | "learning"; text: string }
export interface LagTest { input: string; outcome: string; weeks: number; best_lag: number | null; r: number | null; p: number | null; verdict: string; text: string }
export interface Proxy { proxy: string; felt: string; weeks: number; r: number | null; p: number | null; status: "hidden" | "promoted" | "retired"; text: string }
export interface ThemeTrend { kind: "writing" | "reading"; month: string; topics: string[]; new: string[]; gone: string[]; steady: string[]; state: string }
export interface Season { id: string; title: string; from: string; to: string; pauses: string[] | "all"; auto?: boolean }

export const WHO5_ITEMS = [
  "I have felt cheerful and in good spirits",
  "I have felt calm and relaxed",
  "I have felt active and vigorous",
  "I woke up feeling fresh and rested",
  "My daily life has been filled with things that interest me",
];
export const WHO5_SCALE = ["At no time", "Some of the time", "Less than half the time", "More than half the time", "Most of the time", "All of the time"];

/** Bar width for a 1-5 score, as a percentage. */
export const barPct = (v: number | null) => (v === null ? 0 : Math.round((Math.max(0, Math.min(5, v)) / 5) * 100));

/** One line for a season: when, and what it pauses. */
export function seasonLine(s: Season): string {
  const what = s.pauses === "all" ? "every target" : `${s.pauses.length} metric${s.pauses.length === 1 ? "" : "s"}`;
  return `${s.from} to ${s.to}, pauses ${what}${s.auto ? " (found from days away)" : ""}`;
}
