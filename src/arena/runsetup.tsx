// The Arena's building blocks for choosing models: the set of benchmarkable
// models on this Mac (grouped by runtime), a checklist picker over them, and a
// plain estimate of what a run will cost in money and time. No engine calls
// beyond detect_clis; the page (benchpanel.tsx) owns running.
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Search } from "lucide-react";
import { invokeCached, peekInvoke } from "../query";
import { MODEL_SEP } from "../constants";
import { isLocalCli } from "../helpers";
import { curatedFor, modelLabel, modelsFor } from "../helpers2";
import { isBunkerOn } from "../storage";
import { ProviderMark } from "../marks";
import { autoVerifyClis, useCliVerifyLive } from "../verify";
import { BENCH_CLI_OPTIONS } from "../bench";
import type { AvailablePresetModel } from "../bench-presets";
import type { BenchmarkRun, CliInfo } from "../types";

export type ArenaRuntime = { id: string; label: string; models: { key: string; label: string }[] };

export function runtimeLabel(cli: string): string {
  return BENCH_CLI_OPTIONS.find((c) => c.id === cli)?.label ?? cli;
}
export function keyLabel(key: string): string {
  const [cli, model] = key.split(MODEL_SEP);
  return modelLabel(cli, model) || model || "Default";
}

// The runtimes that can run here (installed, and local-only under Bunker Mode),
// each with its curated models. "auto" is the per-runtime router, not a model,
// so it never appears as something to benchmark.
export function useArenaModels(): { runtimes: ArenaRuntime[]; presetInput: AvailablePresetModel[]; loaded: boolean } {
  // Runtime detection runs every CLI; share its answer through the cache.
  const [clis, setClis] = useState<CliInfo[] | null>(() => { const c = peekInvoke<CliInfo[]>("detect_clis"); return Array.isArray(c) ? c : null; });
  const verify = useCliVerifyLive();
  useEffect(() => {
    let alive = true;
    invokeCached<CliInfo[]>("detect_clis")
      .then((list) => { const safe = Array.isArray(list) ? list : []; if (alive) { setClis(safe); autoVerifyClis(safe); } })
      .catch(() => { if (alive) setClis([]); });
    return () => { alive = false; };
  }, []);
  return useMemo(() => {
    const runtimes: ArenaRuntime[] = [];
    const presetInput: AvailablePresetModel[] = [];
    for (const c of BENCH_CLI_OPTIONS) {
      const ci = (clis ?? []).find((x) => x.id === c.id);
      if (!ci?.available) continue;
      if (isBunkerOn() && !isLocalCli(c.id)) continue;
      if (verify.get(c.id)?.status === "failed") continue;
      const curated = curatedFor(c.id);
      const models = (curated.length ? curated : modelsFor(c.id)).filter((m) => m.id !== "auto").slice(0, 8);
      runtimes.push({ id: c.id, label: c.label, models: models.map((m) => ({ key: `${c.id}${MODEL_SEP}${m.id}`, label: m.label })) });
      for (const m of models) presetInput.push({ key: `${c.id}${MODEL_SEP}${m.id}`, provider: c.id, local: isLocalCli(c.id), validated: verify.get(c.id)?.status === "ok" });
    }
    return { runtimes, presetInput, loaded: clis !== null };
  }, [clis, verify]);
}

// A checklist of models grouped by runtime. Each group folds on its header;
// a search box looks across every runtime's full catalog.
export function ModelPicker({ runtimes, selected, onToggle, testId = "arena-model-picker" }: {
  runtimes: ArenaRuntime[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  testId?: string;
}) {
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const query = q.trim().toLowerCase();
  const groups = runtimes.map((r) => {
    if (!query) return r;
    const all = modelsFor(r.id).filter((m) => m.id !== "auto")
      .map((m) => ({ key: `${r.id}${MODEL_SEP}${m.id}`, label: m.label || m.id }))
      .filter((m) => `${m.label} ${m.key} ${r.label}`.toLowerCase().includes(query))
      .slice(0, 40);
    return { ...r, models: all };
  }).filter((r) => r.models.length > 0);
  if (runtimes.length === 0) {
    return <p className="text-[14px] text-text-muted">No runtime is ready to benchmark{isBunkerOn() ? " in Bunker Mode, which allows local models only" : ""}. Set one up on the Models page.</p>;
  }
  return (
    <div data-testid={testId} className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" aria-label="Search models"
          className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[14px] text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none" />
      </div>
      {groups.length === 0 && <p className="text-[14px] text-text-muted">No models match.</p>}
      <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface">
        {groups.map((r) => {
          const open = !!query || !closed.has(r.id);
          const n = r.models.filter((m) => selected.has(m.key)).length;
          const toggleGroup = () => setClosed((s) => { const x = new Set(s); if (x.has(r.id)) x.delete(r.id); else x.add(r.id); return x; });
          return (
            <div key={r.id}>
              <button type="button" onClick={toggleGroup} aria-expanded={open} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-surface-warm">
                <ChevronRight className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} />
                <ProviderMark vendor={r.id} size={22} />
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-text-primary">{r.label}</span>
                {n > 0 && <span className="text-[13px] text-accent">{n} picked</span>}
              </button>
              {open && (
                <div className="pb-1.5">
                  {r.models.map((m) => {
                    const on = selected.has(m.key);
                    return (
                      <button key={m.key} type="button" role="checkbox" aria-checked={on} onClick={() => onToggle(m.key)}
                        data-testid={`arena-model-${m.key.replace(MODEL_SEP, "-")}`}
                        className="flex w-full items-center gap-3 py-2 pl-11 pr-3 text-left hover:bg-surface-warm">
                        <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border ${on ? "border-accent bg-accent text-background" : "border-border bg-background"}`}>
                          {on && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                        <span className={`min-w-0 flex-1 truncate text-[14px] ${on ? "font-medium text-text-primary" : "text-text-secondary"}`}>{m.label}</span>
                        {isLocalCli(r.id) && <span className="text-[13px] text-text-muted">Local</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// A rough, plainly-labelled estimate for a run: dollars from what each model
// cost per question on its past runs (local models are free; a cloud model with
// no history counts a flat cents-per-answer guess), and minutes from its past
// speed. Up to four models run at once, so time divides by that.
const CLOUD_USD_PER_ANSWER = 0.02;
const DEFAULT_MS_PER_ANSWER = 20_000;
export function estimateRun(models: string[], questions: number, runs: BenchmarkRun[]): { answers: number; usd: number; minutes: number } {
  let usd = 0;
  let ms = 0;
  for (const key of models) {
    const [cli, model] = key.split(MODEL_SEP);
    const past = runs.filter((r) => r.cli === cli && (r.model ?? "") === (model ?? "") && r.questions > 0);
    const costRun = past.find((r) => r.cost_usd_est != null);
    const perAnswerUsd = isLocalCli(cli) ? 0 : costRun ? (costRun.cost_usd_est as number) / costRun.questions : CLOUD_USD_PER_ANSWER;
    const speedRun = past.find((r) => r.ms_avg != null && (r.ms_avg ?? 0) > 0);
    usd += perAnswerUsd * questions;
    ms += (speedRun?.ms_avg ?? DEFAULT_MS_PER_ANSWER) * questions;
  }
  const parallel = Math.max(1, Math.min(4, models.length));
  return { answers: models.length * questions, usd, minutes: Math.max(1, Math.round(ms / parallel / 60_000)) };
}

export function fmtEstimateUsd(n: number): string {
  if (n <= 0) return "free";
  if (n < 0.01) return "under $0.01";
  return `about $${n.toFixed(2)}`;
}
