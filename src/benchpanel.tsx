// The Benchmark UI cluster extracted from App.tsx: BenchmarkPanel (the page) and
// its BenchRunConfig / BenchResults / BenchMatrix / BenchQuestions children. The
// run registry + executor live in ./bench; this is the presentation layer.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirm as tauriConfirm, open, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, Archive, Award, Bookmark, BrainCircuit, Check, ChevronRight, Circle, Coins, Copy, Crown, DollarSign, Download, FileText, Gauge, Layers, Loader2, MessagesSquare, Play, Plus, RotateCw, Scale, Sparkles, Swords, Trash2, TrendingUp, Upload, X, Zap } from "lucide-react";
import { invoke, listen } from "./bridge";
import { MODELS, MODEL_SEP } from "./constants";
import { scoreColor, titleCase } from "./format";
import { isLocalCli, isUserDomain } from "./helpers";
import { modelLabel, parseRunLabel } from "./helpers2";
import { isBunkerOn, lsGet, lsSet } from "./storage";
import { BenchCrumbs, Field, ScoreBar } from "./panels";
import { Sparkline } from "./ui";
import { SideSpine, SpineTabs, STICKY_GROUP_HEAD } from "./sidespine";
import { SettingsHeader } from "./sectionutil";
import { useIsPhone } from "./useisphone";
import { RowAction } from "./rowaction";
import { ArenaBars, ArenaInsight, ArenaMetric, ArenaRightRail, ArenaStatCard, heatBg } from "./arena/arenaui";
import { ModelPicker, estimateRun, fmtEstimateUsd, keyLabel, runtimeLabel, useArenaModels } from "./arena/runsetup";
import { domainIcon } from "./icons";
import { benchBatches, benchNotify, cancelBenchBatch, executeBenchBatch, startQuestionSuggest, useBenchBatches, useQuestionSuggest } from "./bench";
import { canonicalPresets, createSuite, deleteSuite, updateSuite, useSuites } from "./bench-presets";
import { ProviderMark } from "./marks";
import type { BenchBatch, BenchJob, BenchJobStatus, BenchQuestion, BenchmarkRun, Domain, EngineApp, MatrixRow, RunDetail } from "./types";
import type { UnlistenFn } from "./bridge";
import { invokeCached, peekInvoke } from "./query";
import { DETAIL_TITLE } from "./typescale";

// --- 3D Arena formatting (intelligence · speed · cost) --------------------
// Latency: show ms under a second, else seconds.
export function fmtLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}
// Cost: local runs are free; priced runs show $ to a sensible precision.
export function fmtCost(usd: number | null | undefined, basis?: string | null): string {
  if (basis === "local") return "free";
  if (usd === null || usd === undefined) return "-";
  if (usd === 0) return "free";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

// The three dimensions as a compact inline strip: intelligence (judge /10),
// speed (avg latency), and cost (estimated $ or "free" for local). Always
// shows all three so every run is comparable on all axes.
export function RunDims({ run, judge }: { run: BenchmarkRun; judge?: number | null }) {
  const j = judge !== undefined ? judge : run.judge_avg;
  return (
    <span className="flex shrink-0 items-center gap-2.5 text-[11px]">
      <span className="inline-flex items-center gap-1 text-accent" title="Intelligence: judge score /10">
        <BrainCircuit className="h-3 w-3" />
        <span className="font-semibold">{j !== null && j !== undefined ? j.toFixed(1) : "-"}</span>
      </span>
      <span className="inline-flex items-center gap-1 text-text-muted" title="Speed: average latency per question">
        <Zap className="h-3 w-3" />
        {fmtLatency(run.ms_avg)}
      </span>
      <span
        className={`inline-flex items-center gap-1 ${run.cost_basis === "local" || run.cost_usd_est === 0 ? "text-ok" : "text-text-muted"}`}
        title={`Cost: estimated ${run.cost_basis === "local" ? "(local model, free to run)" : "from token usage"}`}
      >
        <DollarSign className="h-3 w-3" />
        {fmtCost(run.cost_usd_est, run.cost_basis)}
      </span>
    </span>
  );
}

export function BenchMatrix({
  matrix, allDomains, onPick, currentDomain, runs = [],
}: {
  matrix: MatrixRow[];
  allDomains: string[];
  onPick: (runDir: string) => void;
  // When the Arena is opened inside a domain, that column leads and is
  // highlighted so it stands out against the others.
  currentDomain?: string | null;
  // Real runs, joined by run_dir so the matrix can show each model's cost +
  // speed alongside its per-domain scores (the mockup's rightmost columns).
  runs?: BenchmarkRun[];
}) {
  const runByDir = useMemo(() => {
    const m = new Map<string, BenchmarkRun>();
    for (const r of runs) m.set(r.run_dir, r);
    return m;
  }, [runs]);
  const bestPerDomain = useMemo(() => {
    const best: Record<string, number> = {};
    for (const d of allDomains) {
      let b = -1;
      for (const m of matrix) {
        const v = m.per_domain[d]?.judge_avg;
        if (v != null && v > b) b = v;
      }
      best[d] = b;
    }
    return best;
  }, [matrix, allDomains]);

  const cur = currentDomain?.toLowerCase() ?? null;
  // Column order: the current domain first (if any), then every domain that has
  // benchmark data, then the empty ones pushed all the way to the right.
  const orderedDomains = useMemo(() => {
    const hasData = (d: string) => (bestPerDomain[d] ?? -1) >= 0;
    const withData = allDomains.filter((d) => hasData(d) && d !== cur);
    const without = allDomains.filter((d) => !hasData(d) && d !== cur);
    const lead = cur && allDomains.includes(cur) ? [cur] : [];
    return [...lead, ...withData, ...without];
  }, [allDomains, bestPerDomain, cur]);

  const rows = useMemo(
    () => [...matrix].sort((a, b) => (b.judge_avg ?? -1) - (a.judge_avg ?? -1)),
    [matrix],
  );

  // Declutter: always show the top N models by overall score; the rest are
  // opt-in via a multi-select filter (persisted). Keeps the matrix readable
  // without losing access to every benchmarked model.
  const TOP_N = 6;
  const [extra, setExtra] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("prevail.bench.extraModels") || "[]")); } catch { return new Set(); }
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const setExtraPersist = (next: Set<string>) => {
    setExtra(next);
    try { localStorage.setItem("prevail.bench.extraModels", JSON.stringify([...next])); } catch { /* ignore */ }
  };
  const toggleExtra = (rd: string) => { const n = new Set(extra); if (n.has(rd)) n.delete(rd); else n.add(rd); setExtraPersist(n); };
  const topDirs = useMemo(() => new Set(rows.slice(0, TOP_N).map((m) => m.run_dir)), [rows]);
  const extraModels = useMemo(() => rows.slice(TOP_N), [rows]);
  const visibleRows = useMemo(() => rows.filter((m) => topDirs.has(m.run_dir) || extra.has(m.run_dir)), [rows, topDirs, extra]);

  // Same declutter for COLUMNS: show the top N dimensions (current domain +
  // those with the most data) by default, and let the user choose exactly which
  // dimensions to show so a vault with many domains doesn't force a sideways
  // scroll. null selection = the default top-N; otherwise the explicit picks.
  const TOP_DIMS = 5;
  const defaultDims = useMemo(() => {
    // Default to dimensions that actually have data (so empty columns like a
    // never-tested Career/Homestead don't take space), capped at the top N;
    // keep the current domain visible if we're scoped to one.
    const withData = orderedDomains.filter((d) => (bestPerDomain[d] ?? -1) >= 0);
    const base = (withData.length ? withData : orderedDomains).slice(0, TOP_DIMS);
    return cur && orderedDomains.includes(cur) && !base.includes(cur) ? [cur, ...base].slice(0, TOP_DIMS) : base;
  }, [orderedDomains, bestPerDomain, cur]);
  const [dimSel, setDimSel] = useState<string[] | null>(() => {
    try { const v = localStorage.getItem("prevail.bench.matrixDims"); return v ? JSON.parse(v) : null; } catch { return null; }
  });
  const setDimSelPersist = (next: string[] | null) => {
    setDimSel(next);
    try { if (next && next.length) localStorage.setItem("prevail.bench.matrixDims", JSON.stringify(next)); else localStorage.removeItem("prevail.bench.matrixDims"); } catch { /* ignore */ }
  };
  const visibleDomains = useMemo(() => {
    const sel = new Set(dimSel ?? defaultDims);
    const v = orderedDomains.filter((d) => sel.has(d));
    return v.length ? v : defaultDims; // never collapse to zero columns
  }, [orderedDomains, dimSel, defaultDims]);
  const [dimPickerOpen, setDimPickerOpen] = useState(false);
  const toggleDim = (d: string) => {
    const cur2 = new Set(visibleDomains);
    if (cur2.has(d)) cur2.delete(d); else cur2.add(d);
    setDimSelPersist(orderedDomains.filter((x) => cur2.has(x)));
  };

  if (allDomains.length === 0) return <div className="text-sm text-text-muted">No domain data yet.</div>;

  return (
    <div>
      {/* Filter bar: top models + top dimensions shown; multi-select to refine. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-text-muted">
          {visibleRows.length}/{rows.length} models · {visibleDomains.length}/{orderedDomains.length} dimensions
        </span>
        <div className="flex flex-wrap items-center gap-2">
        {orderedDomains.length > 1 && (
          <div className="relative">
            <button
              onClick={() => setDimPickerOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs text-text-secondary hover:border-accent-border hover:text-accent"
            >
              <Layers className="h-3.5 w-3.5" /> Dimensions · {visibleDomains.length}
              <ChevronRight className={`h-3 w-3 transition-transform ${dimPickerOpen ? "rotate-90" : ""}`} />
            </button>
            {dimPickerOpen && (
              <div className="absolute right-0 z-20 mt-1 max-h-72 w-60 overflow-auto rounded-xl border border-border bg-surface p-1.5 shadow-xl">
                <div className="flex items-center justify-between px-1.5 py-1">
                  <span className="text-[11px] text-text-muted">Show dimensions</span>
                  <button onClick={() => setDimSelPersist(null)} className="text-[10px] text-text-muted hover:text-accent">Top {TOP_DIMS}</button>
                </div>
                {orderedDomains.map((d) => {
                  const on = visibleDomains.includes(d);
                  return (
                    <button key={d} onClick={() => toggleDim(d)} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-surface-warm">
                      <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${on ? "border-accent bg-accent text-background" : "border-border"}`}>{on && <Check className="h-2.5 w-2.5" />}</span>
                      <span className="min-w-0 flex-1 truncate text-text-primary">{titleCase(d)}</span>
                      <span className="shrink-0 text-[10px] text-text-muted">{(bestPerDomain[d] ?? -1) >= 0 ? (bestPerDomain[d]).toFixed(1) : "·"}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {extraModels.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setPickerOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs text-text-secondary hover:border-accent-border hover:text-accent"
            >
              <Layers className="h-3.5 w-3.5" /> Filter models{extra.size > 0 ? ` · ${extra.size} added` : ""}
              <ChevronRight className={`h-3 w-3 transition-transform ${pickerOpen ? "rotate-90" : ""}`} />
            </button>
            {pickerOpen && (
              <div className="absolute right-0 z-20 mt-1 max-h-72 w-72 overflow-auto rounded-xl border border-border bg-surface p-1.5 shadow-xl">
                <div className="flex items-center justify-between px-1.5 py-1">
                  <span className="text-[11px] text-text-muted">Add more models</span>
                  {extra.size > 0 && <button onClick={() => setExtraPersist(new Set())} className="text-[10px] text-text-muted hover:text-accent">Clear</button>}
                </div>
                {extraModels.map((m) => {
                  const p = parseRunLabel(m.label);
                  const on = extra.has(m.run_dir);
                  return (
                    <button
                      key={m.run_dir}
                      onClick={() => toggleExtra(m.run_dir)}
                      className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-surface-warm"
                    >
                      <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${on ? "border-accent bg-accent text-background" : "border-border"}`}>{on && <Check className="h-2.5 w-2.5" />}</span>
                      <ProviderMark vendor={p.vendor} size={14} />
                      <span className="min-w-0 flex-1 truncate text-text-primary" title={p.model || m.label}>{p.model || m.label}</span>
                      <span className="shrink-0 text-[11px] text-text-muted">{m.judge_avg?.toFixed(1) ?? "-"}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface">
            <th className="sticky left-0 bg-surface px-3 py-2 text-left text-[11px] text-text-muted">Model</th>
            {visibleDomains.map((d) => (
              <th key={d} className={`px-3 py-2 text-center text-[11px] ${d === cur ? "bg-accent font-bold text-background" : "text-text-muted"}`}>{titleCase(d)}</th>
            ))}
            <th className="border-l border-border px-3 py-2 text-center text-[11px] text-accent">Avg score</th>
            <th className="px-3 py-2 text-center text-[11px] text-text-muted">Cost</th>
            <th className="px-3 py-2 text-center text-[11px] text-text-muted">Speed</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((m) => {
            const parsed = parseRunLabel(m.label);
            return (
              <tr key={m.run_dir} className="border-b border-border-subtle last:border-0 hover:bg-surface-warm">
                <td className="sticky left-0 bg-background px-3 py-2">
                  <button onClick={() => onPick(m.run_dir)} className="inline-flex max-w-[200px] items-center gap-1.5 hover:text-accent">
                    <ProviderMark vendor={parsed.vendor} size={16} />
                    <span className="truncate whitespace-nowrap text-xs text-text-primary" title={parsed.model || m.label}>{parsed.model || m.label}</span>
                  </button>
                </td>
                {visibleDomains.map((d) => {
                  const cell = m.per_domain[d];
                  const v = cell?.judge_avg ?? null;
                  const isBest = v != null && v === bestPerDomain[d] && v >= 0;
                  // Every scored cell gets a heatmap tint (green high -> red low),
                  // and the best model per domain gets a ring so it still pops.
                  return (
                    <td
                      key={d}
                      className={`px-3 py-2 text-center text-xs ${isBest ? "font-bold" : ""}`}
                      style={{ background: v == null ? undefined : heatBg(v), boxShadow: isBest ? "inset 0 0 0 1.5px var(--color-accent)" : undefined }}
                    >
                      {v == null ? <span className="text-text-muted/40">-</span> : <span className="text-text-primary">{v.toFixed(1)}</span>}
                    </td>
                  );
                })}
                <td className="border-l border-border px-3 py-2 text-center text-xs font-semibold text-accent">{m.judge_avg?.toFixed(1) ?? "-"}</td>
                <td className="px-3 py-2 text-center text-[11px] text-text-muted">{(() => { const r = runByDir.get(m.run_dir); return r ? fmtCost(r.cost_usd_est, r.cost_basis) : "-"; })()}</td>
                <td className="px-3 py-2 text-center text-[11px] text-text-muted">{(() => { const r = runByDir.get(m.run_dir); return r ? fmtLatency(r.ms_avg) : "-"; })()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// Right-rail insights for the Model x domain matrix: the strongest model
// overall, the strongest per domain, and the biggest top-vs-bottom gaps. All
// computed from the real matrix data (judge averages); no invented numbers.
function MatrixInsights({ matrix, allDomains }: { matrix: MatrixRow[]; allDomains: string[] }) {
  const insights = useMemo(() => {
    const ranked = [...matrix].filter((m) => m.judge_avg != null).sort((a, b) => (b.judge_avg ?? -1) - (a.judge_avg ?? -1));
    const overall = ranked[0] ?? null;
    const perDomain = allDomains.map((d) => {
      const scored = matrix
        .map((m) => ({ model: parseRunLabel(m.label).model || m.label, v: m.per_domain[d]?.judge_avg ?? null }))
        .filter((x): x is { model: string; v: number } => x.v != null);
      if (scored.length === 0) return null;
      const sorted = [...scored].sort((a, b) => b.v - a.v);
      const top = sorted[0];
      const bottom = sorted[sorted.length - 1];
      return { domain: d, top, gap: scored.length > 1 ? top.v - bottom.v : 0, n: scored.length };
    }).filter((x): x is NonNullable<typeof x> => x !== null);
    const byGap = [...perDomain].sort((a, b) => b.gap - a.gap).slice(0, 5);
    return { overall, perDomain, byGap };
  }, [matrix, allDomains]);

  if (!insights.overall) return null;
  const maxGap = Math.max(0.0001, ...insights.byGap.map((g) => g.gap));
  return (
    <ArenaRightRail>
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="text-[11px] text-text-muted">Strongest overall</div>
        <div className="mt-1.5 flex items-center gap-2">
          <Award className="h-4 w-4 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-base font-semibold text-text-primary">{parseRunLabel(insights.overall.label).model || insights.overall.label}</span>
          <span className="text-lg font-bold text-accent">{insights.overall.judge_avg?.toFixed(1)}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-text-muted">avg judge score across {insights.perDomain.length} domain{insights.perDomain.length === 1 ? "" : "s"}</div>
      </div>
      {insights.perDomain.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-2 text-[11px] text-text-muted">Strongest by domain</div>
          <div className="space-y-1.5">
            {insights.perDomain.map((p) => {
              const Icon = domainIcon(p.domain) ?? Circle;
              return (
                <div key={p.domain} className="flex items-center gap-2 text-[12px]">
                  <Icon className="h-3 w-3 shrink-0 text-text-muted" />
                  <span className="w-20 shrink-0 truncate text-text-secondary">{titleCase(p.domain)}</span>
                  <span className="min-w-0 flex-1 truncate text-text-primary">{p.top.model}</span>
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: heatBg(p.top.v), color: "var(--color-text-primary)" }}>{p.top.v.toFixed(1)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {insights.byGap.length > 0 && insights.byGap[0].gap > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-2 text-[11px] text-text-muted">Biggest gaps (top vs bottom)</div>
          <div className="space-y-2">
            {insights.byGap.filter((g) => g.gap > 0).map((g) => {
              const Icon = domainIcon(g.domain) ?? Circle;
              return (
                <div key={g.domain} className="flex items-center gap-2">
                  <Icon className="h-3 w-3 shrink-0 text-text-muted" />
                  <span className="w-20 shrink-0 truncate text-[12px] text-text-secondary">{titleCase(g.domain)}</span>
                  <span className="text-[11px] tabular-nums text-text-primary">{g.gap.toFixed(2)}</span>
                  <div className="min-w-0 flex-1"><div className="h-1.5 rounded-full bg-accent" style={{ width: `${(g.gap / maxGap) * 100}%` }} /></div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-text-muted">A wide gap means the model you pick matters here.</p>
        </div>
      )}
    </ArenaRightRail>
  );
}

export function BenchQuestions({
  vaultPath, questions, allDomains, initialDomain, onChanged,
}: {
  vaultPath: string;
  questions: BenchQuestion[];
  allDomains: string[];
  initialDomain?: string | null;
  onChanged: () => void;
}) {
  // Domain-scoped panel: show that domain's questions, not the whole suite.
  const [filter, setFilter] = useState<string>(initialDomain ? initialDomain.toLowerCase() : "all");
  const [editing, setEditing] = useState<BenchQuestion | "new" | null>(null);
  const blank: BenchQuestion = { id: "", domain: "", prompt: "", context: "", notes: "", council: false, expected_decision: "", expected_verdict_keywords: [], path: "" };
  const [draft, setDraft] = useState<BenchQuestion>(blank);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  // AI question suggestion runs in a MODULE-SCOPE registry (see startQuestionSuggest
  // in ./bench) so it survives navigation away from Arena and back, and panel
  // remounts. We only subscribe here; the job state is the source of truth.
  const qJobs = useQuestionSuggest();
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestDomain, setSuggestDomain] = useState<string>(initialDomain?.toLowerCase() ?? "");
  const [suggestCount, setSuggestCount] = useState(3);
  const [suggestModel, setSuggestModel] = useState(() => {
    if (!isBunkerOn()) return `claude${MODEL_SEP}opus`;
    // Bunker Mode: default to the first local provider's first model.
    const [cli, models] = Object.entries(MODELS).find(([c, ms]) => isLocalCli(c) && ms.length > 0) ?? [];
    return cli && models ? `${cli}${MODEL_SEP}${models[0].id}` : `claude${MODEL_SEP}opus`;
  });

  // Which domains the current suggest selection targets (for job matching).
  const suggestTargets = useMemo(() => {
    const d = suggestDomain.trim().toLowerCase();
    if (!d) return [] as string[];
    return d === "all" ? allDomains.map((x) => x.toLowerCase()) : [d];
  }, [suggestDomain, allDomains]);
  // Derive the button/label state from the module-scope jobs, so "Drafting…"
  // stays correct even after the panel remounts mid-run.
  const relevantJobs = qJobs.filter((j) => j.vault === vaultPath && suggestTargets.includes(j.domain));
  const suggesting = relevantJobs.some((j) => j.status === "running");
  // Any running suggest job for this vault (across domains) - shown as a small
  // "still running in the background" note independent of the current selection.
  const runningJobs = qJobs.filter((j) => j.vault === vaultPath && j.status === "running");

  // When a background suggest finishes, reload the question list so completed
  // drafts appear whether or not the user was on this page while it ran.
  useEffect(() => {
    const onChangedEvt = () => onChanged();
    window.addEventListener("prevail:questions-changed", onChangedEvt);
    return () => window.removeEventListener("prevail:questions-changed", onChangedEvt);
  }, [onChanged]);

  const inFilter = filter === "all" ? questions : questions.filter((q) => q.domain === filter);
  // AI drafts float to the top so a fresh "Suggest with AI" run is immediately
  // visible (and obviously needs your review) instead of sorting into the middle
  // of the list where you'd never notice it landed.
  const shown = inFilter
    .filter((q) => !q.archived)
    .slice()
    .sort((a, b) => (a.source === "ai" ? 0 : 1) - (b.source === "ai" ? 0 : 1));
  const archivedShown = inFilter.filter((q) => q.archived);
  async function setArchived(q: BenchQuestion, archived: boolean) {
    try {
      await invoke("benchmark_set_question_archived", { path: q.path, archived });
      onChanged();
    } catch (e) { setInfo(`Archive failed: ${e}`); }
  }

  // Export the whole suite as one portable prevail.bench/v1 JSON file.
  async function exportQuestions() {
    try {
      const dest = await saveFileDialog({
        defaultPath: "prevail-bench-questions.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!dest) return;
      await invoke("benchmark_export_questions", { vault: vaultPath, dest });
      setInfo(`Exported ${questions.length} question${questions.length === 1 ? "" : "s"} to ${dest.split("/").pop()}`);
    } catch (e) {
      setInfo(`Export failed: ${e}`);
    }
  }

  // Import a prevail.bench/v1 file; existing ids are skipped, never overwritten.
  async function importQuestions() {
    try {
      const picked = await open({ filters: [{ name: "JSON", extensions: ["json"] }], multiple: false });
      const path = typeof picked === "string" ? picked : null;
      if (!path) return;
      const json = await invoke<string>("read_file", { path });
      const report = await invoke<{ created: string[]; skipped: string[] }>("benchmark_import_questions", { vault: vaultPath, json });
      setInfo(`Imported ${report.created.length} question${report.created.length === 1 ? "" : "s"}${report.skipped.length ? `, skipped ${report.skipped.length} (already exist or malformed)` : ""}`);
      onChanged();
    } catch (e) {
      setInfo(`Import failed: ${e}`);
    }
  }

  // AI-draft questions from each domain's own context, via the engine's
  // `bench suggest`. Fire-and-forget into the MODULE-SCOPE registry so the run
  // survives navigation away and back; startQuestionSuggest streams, recounts,
  // and dispatches prevail:questions-changed on completion (which reloads the
  // list here). We do NOT await it - the button label follows the job status.
  function suggestWithAi() {
    const domain = suggestDomain.trim().toLowerCase();
    if (!domain) return;
    const [cli, model] = suggestModel.split(MODEL_SEP);
    setInfo(null);
    // "all domains" must hit EVERY domain with its own request for `count`, not a
    // single call the engine spreads thin - that left some domains empty. Loop
    // per domain (the path that works for a single domain), one job each.
    const targets = domain === "all" ? allDomains.map((d) => d.toLowerCase()) : [domain];
    for (const t of targets) {
      void startQuestionSuggest({ vault: vaultPath, domain: t, count: suggestCount, cli, model });
    }
    setInfo(
      domain === "all"
        ? `Drafting ${suggestCount} question${suggestCount === 1 ? "" : "s"} for each of ${targets.length} domains in the background. You can navigate away; results appear here when ready.`
        : `Drafting ${suggestCount} question${suggestCount === 1 ? "" : "s"} for ${titleCase(domain)} in the background. You can navigate away; results appear here when ready.`,
    );
    setSuggestOpen(false);
  }

  const openEditor = (q: BenchQuestion | "new") => {
    setEditing(q);
    setDraft(q === "new" ? blank : { ...q });
  };

  async function save() {
    // K4 (Monday feedback): a NEW question can target multiple domains at once
    // (comma-separated, no dropdown/checkboxes) - saved once per domain. Editing
    // an existing question keeps a single domain.
    const domains = draft.domain.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
    if (domains.length === 0 || !draft.prompt.trim()) return;
    const targets = editing === "new" ? domains : [domains[0]];
    setSaving(true);
    try {
      for (const dom of targets) {
        await invoke("benchmark_save_question", {
          vault: vaultPath,
          q: {
            id: editing === "new" ? null : (draft.id || null),
            domain: dom,
            prompt: draft.prompt,
            context: draft.context,
            notes: draft.notes,
            council: draft.council,
            expected_decision: draft.expected_decision,
            expected_verdict_keywords: draft.expected_verdict_keywords,
          },
        });
      }
      setEditing(null);
      onChanged();
    } finally {
      setSaving(false);
    }
  }
  async function remove(q: BenchQuestion) {
    const ok = await tauriConfirm(`Delete benchmark question "${q.id}"?`, { title: "Delete question", kind: "warning" });
    if (!ok) return;
    await invoke("benchmark_delete_question", { path: q.path });
    if (editing !== "new" && editing && editing.id === q.id) setEditing(null);
    onChanged();
  }

  if (editing) {
    return (
      <div className="w-full px-8 py-5 max-md:px-4">
        <BenchCrumbs
          items={[
            { label: "Arena" },
            { label: "Questions", onClick: () => setEditing(null) },
            { label: editing === "new" ? "New question" : draft.id },
          ]}
        />
        <div className="space-y-4">
        <h2 className={DETAIL_TITLE}>{editing === "new" ? "New question" : draft.id}</h2>
        <Field label={editing === "new" ? "Domain(s): comma-separated to add to several at once" : "Domain"}>
          <input value={draft.domain} onChange={(e) => setDraft({ ...draft, domain: e.target.value })} list="bench-domains" placeholder={editing === "new" ? "wealth, health, career" : "wealth"} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <datalist id="bench-domains">{allDomains.map((d) => <option key={d} value={d} />)}</datalist>
        </Field>
        <Field label="Prompt: the question as you'd ask it">
          <textarea value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} rows={3} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <Field label="Context: facts the model needs (numbers, dates)">
          <textarea value={draft.context} onChange={(e) => setDraft({ ...draft, context: e.target.value })} rows={3} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <Field label="Expected decision: your real ground-truth answer">
          <input value={draft.expected_decision} onChange={(e) => setDraft({ ...draft, expected_decision: e.target.value })} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <Field label="Expected keywords: comma-separated, for the mechanical floor">
          <input
            value={draft.expected_verdict_keywords.join(", ")}
            onChange={(e) => setDraft({ ...draft, expected_verdict_keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            placeholder="liquidity, 6 month floor, diversify"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Notes: what you actually decided, and why">
          <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={2} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={draft.council} onChange={(e) => setDraft({ ...draft, council: e.target.checked })} />
          Run via council (multi-model panel) by default
        </label>
        <div className="flex items-center gap-2 pt-2">
          <button onClick={save} disabled={saving || !draft.domain.trim() || !draft.prompt.trim()} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </button>
          {editing !== "new" && (
            <button onClick={() => remove(draft)} className="inline-flex items-center gap-1.5 rounded-lg border border-err/40 px-3 py-2 text-sm text-err hover:bg-err/10">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          )}
        </div>
        </div>
      </div>
    );
  }

  // The Questions title + breadcrumb now live in the Arena page header.
  return (
    <div className="w-full px-8 pb-6 max-md:px-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-text-secondary">
          <option value="all">All domains</option>
          {allDomains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={importQuestions} title="Import a prevail.bench/v1 JSON file (existing ids are skipped)" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-secondary hover:border-accent-border hover:text-accent">
          <Download className="h-3 w-3" /> Import
        </button>
        <button onClick={exportQuestions} disabled={questions.length === 0} title="Export every question as one portable JSON file" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-40">
          <Upload className="h-3 w-3" /> Export
        </button>
        <button onClick={() => { setSuggestOpen((v) => !v); if (!suggestDomain && filter !== "all") setSuggestDomain(filter); }} title="AI-draft questions from a domain's recorded context" className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] ${suggestOpen ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-secondary hover:border-accent-border hover:text-accent"}`}>
          <Sparkles className="h-3 w-3" /> Suggest with AI
        </button>
        <button onClick={() => openEditor("new")} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[11px] text-background hover:bg-accent-hover">
          <Plus className="h-3 w-3" /> New question
        </button>
      </div>
      {suggestOpen && (
        <div className="mb-4 rounded-xl border border-accent-border bg-accent-soft/25 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold text-text-primary">Draft questions with AI</span>
          </div>
          {/* Labeled controls, not a cramped row of bare selects. */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-text-muted">Domain</span>
              <select value={suggestDomain} onChange={(e) => setSuggestDomain(e.target.value)} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-text-secondary focus:border-accent-border focus:outline-none">
                <option value="">pick a domain…</option>
                <option value="all">All domains</option>
                {allDomains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-text-muted">How many{suggestDomain === "all" ? " per domain" : ""}</span>
              <select value={suggestCount} onChange={(e) => setSuggestCount(Number(e.target.value))} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-text-secondary focus:border-accent-border focus:outline-none">
                {[1, 2, 3, 5, 8].map((n) => <option key={n} value={n}>{n} question{n === 1 ? "" : "s"}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-text-muted">Drafting model</span>
              <select value={suggestModel} onChange={(e) => setSuggestModel(e.target.value)} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-text-secondary focus:border-accent-border focus:outline-none">
                {Object.entries(MODELS)
                  .filter(([cli]) => !isBunkerOn() || isLocalCli(cli))
                  .flatMap(([cli, models]) =>
                    models.map((m) => (
                      <option key={`${cli}${MODEL_SEP}${m.id}`} value={`${cli}${MODEL_SEP}${m.id}`}>{titleCase(cli)} · {m.label}</option>
                    )),
                  )}
              </select>
            </label>
            <button onClick={suggestWithAi} disabled={suggesting || !suggestDomain} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover disabled:opacity-40">
              {suggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {suggesting ? "Drafting…" : "Draft"}
            </button>
          </div>
          <p className="mt-3 text-xs text-text-muted">
            Reads each domain's state, goals, and decisions (fresh domains use goals/config). Every domain you target gets the full count; drafts are marked for your review before they affect scores.
          </p>
        </div>
      )}
      {info && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-accent-border bg-accent-soft/50 px-3 py-2 text-xs text-text-primary">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" /> {info}
        </div>
      )}
      {/* Background suggest jobs: surface running + finished state from the
          module-scope registry, so it's visible on return even after remount. */}
      {runningJobs.length > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-accent-border bg-accent-soft/30 px-3 py-2 text-xs text-text-secondary">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
          Drafting in the background: {runningJobs.map((j) => titleCase(j.domain)).join(", ")}. You can leave this page; results appear here when ready.
        </div>
      )}
      {qJobs
        .filter((j) => j.vault === vaultPath && j.status === "error")
        .map((j) => (
          <div key={j.id} className="mb-4 flex items-center gap-2 rounded-lg border border-warn/40 bg-surface px-3 py-2 text-xs text-text-secondary">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" />
            Couldn't draft {titleCase(j.domain)}: {j.error}. Fix that, then re-run.
          </div>
        ))}
      {(() => {
        const doneJobs = qJobs.filter((j) => j.vault === vaultPath && j.status === "done" && (j.added ?? 0) > 0);
        if (doneJobs.length === 0) return null;
        return (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-ok/40 bg-surface px-3 py-2 text-xs text-text-secondary">
            <Check className="h-3.5 w-3.5 shrink-0 text-ok" />
            Drafted {doneJobs.map((j) => `${j.added} for ${titleCase(j.domain)}`).join(", ")}. Review the ground truth before trusting scores.
          </div>
        );
      })()}
      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
          No questions{filter !== "all" ? ` in ${titleCase(filter)}` : ""} yet. Hit <span className="text-accent">New question</span>, <span className="text-accent">Suggest with AI</span>, or <span className="text-accent">Import</span> to add some.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          {shown.map((q) => (
            <div key={q.id} className="flex w-full items-start gap-3 border-b border-border-subtle px-4 py-3 text-left last:border-0 hover:bg-surface-warm">
              <button onClick={() => openEditor(q)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                <span className="mt-0.5 rounded bg-surface-warm px-1.5 py-0.5 text-[11px] text-text-muted">{q.domain}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {q.source === "ai" && (
                      <span className="shrink-0 rounded-full border border-accent-border bg-accent-soft px-1.5 py-px text-[11px] text-accent">Draft · review</span>
                    )}
                    <span className="truncate text-sm text-text-primary">{q.prompt || <span className="text-text-muted">(empty prompt)</span>}</span>
                  </div>
                  {q.expected_decision && <div className="mt-0.5 truncate text-[11px] text-ok">→ {q.expected_decision}</div>}
                  <div className="mt-0.5 text-[11px] text-text-muted">
                    {q.source === "ai" ? "AI-drafted - click to review and confirm the ground truth" : "written by you"}{q.created ? ` · added ${q.created}` : ""}{q.edited ? ` · edited ${q.edited} (prior version kept)` : ""}
                  </div>
                </div>
                {/* K3 (Monday feedback): tooltip on the per-question icon. */}
                {q.council && <span title="Council question: asked to the whole panel" className="mt-0.5 shrink-0"><Scale className="h-3.5 w-3.5 text-text-muted" /></span>}
              </button>
              <button
                onClick={() => void setArchived(q, true)}
                title="Archive: kept for past runs, excluded from new ones"
                className="mt-0.5 shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] text-text-muted hover:border-accent-border hover:text-accent"
              >
                <Archive className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {archivedShown.length > 0 && (
        <details className="mt-3 rounded-xl border border-border-subtle bg-surface px-3 py-2">
          <summary className="cursor-pointer text-[11px] text-text-muted">
            Archived · {archivedShown.length}: kept so past benchmark runs stay interpretable
          </summary>
          <div className="mt-2 flex flex-col">
            {archivedShown.map((q) => (
              <div key={q.id} className="flex items-start gap-3 border-b border-border-subtle px-1 py-2 last:border-0">
                <span className="mt-0.5 rounded bg-surface-warm px-1.5 py-0.5 text-[11px] text-text-muted">{q.domain}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-text-muted">{q.prompt}</div>
                  <div className="mt-0.5 text-[11px] text-text-muted">
                    {q.source === "ai" ? "AI-suggested" : "written by you"}{q.created ? ` · added ${q.created}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => void setArchived(q, false)}
                  className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] text-text-muted hover:border-accent-border hover:text-accent"
                >
                  Restore
                </button>
                <button
                  onClick={async () => { try { await invoke("benchmark_delete_question", { path: q.path }); onChanged(); } catch (e) { setInfo(`Delete failed: ${e}`); } }}
                  title="Delete permanently (past runs lose this question's text)"
                  className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] text-text-muted hover:border-warn hover:text-warn"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// RUNNING BATCH MONITOR CARD
//
// One live progress card per in-flight (or finished-but-not-dismissed) batch.
// It reads EVERYTHING from the BenchBatch it is handed, so many cards can run
// side by side, each updating independently. Extracted from the old single
// full-page progress view so the New Run wizard stays usable while runs are in
// flight and several runs can be monitored at once.
function RunningBatchCard({
  batch, onViewResults, onCancel, onDismiss,
}: {
  batch: BenchBatch;
  onViewResults: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const jobs = batch.jobs;
  const running = batch.running;
  const log = batch.log;
  // Which job card is expanded to its question-by-question detail (per card).
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  // Whole-run collapse: hide the per-model rows so several runs can be stacked
  // in the monitor without each one taking a full screen. The header + overall
  // progress stay visible so a collapsed run still shows status at a glance.
  const [collapsed, setCollapsed] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  const allDone = !running;
  const doneCount = jobs.filter((j) => j.status === "done").length;
  const errCount = jobs.filter((j) => j.status === "error").length;
  const cancelled = jobs.some((j) => j.status === "cancelled") || batch.cancelled;
  // Phase: once every model has answered (nothing queued/running), the batch
  // moves to the judge-scoring pass. The progress bar hits 100% at the END of
  // the answering phase, so without this it reads as "done" while scoring is
  // still underway.
  const answersDone = jobs.length > 0 && jobs.every((j) => j.status !== "queued" && j.status !== "running");
  const scoringPhase = running && answersDone;
  const scopeLine = batch.scopeDomains.length
    ? batch.scopeDomains.slice(0, 3).map(titleCase).join(", ") + (batch.scopeDomains.length > 3 ? ` +${batch.scopeDomains.length - 3}` : "")
    : "All domains";
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-surface px-6 py-5 shadow-sm">
      {/* Header: status icon + heading, with a Dismiss control for finished
          batches so a completed card can be cleared without leaving the wizard. */}
      <div
        className="flex items-start gap-2.5 cursor-pointer select-none"
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? "Expand this run" : "Collapse this run"}
      >
        <ChevronRight className={`mt-1 h-4 w-4 shrink-0 text-text-muted transition-transform ${collapsed ? "" : "rotate-90"}`} />
        {running
          ? <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-accent" />
          : cancelled ? <X className="mt-0.5 h-5 w-5 shrink-0 text-text-muted" />
          : errCount > 0 ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
          : <Check className="mt-0.5 h-5 w-5 shrink-0 text-ok" strokeWidth={3} />}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold text-text-primary">
            {scoringPhase ? "Scoring answers…"
              : running ? "Benchmarking…"
              : cancelled ? "Run cancelled"
              : errCount > 0 ? "Finished with errors"
              : "Benchmark complete"}
          </h2>
          <div className="mt-0.5 truncate text-[11px] text-text-muted">
            {batch.label}
          </div>
          <div className="mt-0.5 text-[11px] text-text-muted">
            {scopeLine}{" · "}{jobs.length} model{jobs.length === 1 ? "" : "s"}{" · "}{jobs[0]?.total ?? 0} q each{" · auto-scored"}
          </div>
        </div>
        {allDone && (
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            title="Dismiss this run from the monitor"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[10px] text-text-secondary transition-colors hover:bg-surface-warm"
          >
            <Trash2 className="h-3 w-3" /> Dismiss
          </button>
        )}
      </div>
      {(() => {
        const overallTotal = jobs.reduce((a, j) => a + j.total, 0);
        const overallDone = jobs.reduce((a, j) => a + (j.status === "done" || j.status === "scoring" ? j.total : j.done), 0);
        const pct = overallTotal > 0 ? Math.round((overallDone / overallTotal) * 100) : 0;
        return (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
              <span className="text-text-muted">{scoringPhase || allDone ? "answers" : "answering"}</span>
              <span className="tabular-nums text-text-secondary">{overallDone}/{overallTotal} · <span className="font-semibold text-text-primary">{pct}%</span></span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-warm">
              <div className={`h-full rounded-full transition-all duration-500 ${scoringPhase ? "bg-text-primary/70" : "bg-accent"}`} style={{ width: `${pct}%` }} />
            </div>
            {scoringPhase && (
              <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-accent">
                <Loader2 className="h-3 w-3 animate-spin" /> answers in · scoring with the judge, almost done
              </div>
            )}
          </div>
        );
      })()}
      {running && (
        <div className="flex justify-center">
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-1.5 text-[11px] text-text-secondary transition-colors hover:border-err hover:text-err"
          >
            <X className="h-3.5 w-3.5" /> Cancel run
          </button>
        </div>
      )}
      {!collapsed && (
      <div className="space-y-2">
        {jobs.map((j) => {
          const pct = j.total > 0 ? Math.round((j.done / j.total) * 100) : 0;
          const expanded = expandedJob === j.key;
          return (
            <div key={j.key} className="overflow-hidden rounded-xl border border-border bg-surface">
              <button
                onClick={() => setExpandedJob(expanded ? null : j.key)}
                className="w-full px-4 py-3 text-left hover:bg-surface-warm/60"
                title="Click for question-by-question detail"
              >
                <div className="flex items-center gap-3">
                  <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${expanded ? "rotate-90" : ""}`} />
                  {j.cli ? <ProviderMark vendor={j.cli} size={20} /> : <Scale className="h-5 w-5 text-accent" />}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{j.label}</span>
                  {j.status === "running" && j.qcur && (
                    <span className="hidden min-w-0 max-w-[220px] truncate text-[10px] text-text-muted md:inline">{j.qcur}…</span>
                  )}
                  <span className="text-[11px] tabular-nums text-text-muted">
                    {j.status === "queued" ? "queued" : `${j.done}/${j.total}`}
                  </span>
                  <span className={`w-16 text-right text-[11px] ${
                    j.status === "error" ? "text-err" : j.status === "cancelled" ? "text-text-muted" : j.status === "done" ? "text-ok" : "text-accent"
                  }`}>
                    {j.status === "error" ? "error" : j.status === "cancelled" ? "cancelled" : j.status === "done" ? "done" : j.status === "scoring" ? "scoring" : j.status === "running" ? `${pct}%` : "queued"}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-warm">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      j.status === "error" ? "bg-err/60" : j.status === "cancelled" ? "bg-surface-strong" : j.status === "scoring" || j.status === "done" ? "bg-ok" : "bg-accent"
                    } ${j.status === "scoring" ? "animate-pulse" : ""}`}
                    style={{ width: `${j.status === "done" || j.status === "scoring" ? 100 : pct}%` }}
                  />
                </div>
                {j.note && <div className="mt-1.5 text-[10px] text-err">{j.note}</div>}
              </button>
              {expanded && j.qids.length > 0 && (
                <div className="max-h-64 overflow-y-auto border-t border-border-subtle bg-background/40 px-4 py-2">
                  {j.qids.map((q) => {
                    const info = j.qdone[q];
                    const isCur = !info && j.qcur === q;
                    const failed = info?.startsWith("✗");
                    return (
                      <div key={q} className="flex items-center gap-2.5 py-1">
                        <span className="w-4 shrink-0 text-center">
                          {info ? (
                            failed
                              ? <AlertTriangle className="h-3 w-3 text-err" />
                              : <Check className="h-3 w-3 text-ok" strokeWidth={3} />
                          ) : isCur ? (
                            <Loader2 className="h-3 w-3 animate-spin text-accent" />
                          ) : (
                            <Circle className="h-2.5 w-2.5 text-text-muted/40" />
                          )}
                        </span>
                        <span className={`min-w-0 flex-1 truncate text-[11px] ${info ? "text-text-primary" : isCur ? "text-accent" : "text-text-muted/60"}`}>
                          {q}
                        </span>
                        {info && !failed && <span className="max-w-[200px] truncate text-[11px] text-text-muted">{info}</span>}
                        {failed && <span className="max-w-[260px] truncate text-[11px] text-err" title={info}>{info}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
      {allDone && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <button onClick={onViewResults} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background hover:bg-accent-hover">
            <TrendingUp className="h-4 w-4" /> View results
          </button>
          <button onClick={onDismiss} className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary hover:bg-surface-warm">
            Dismiss
          </button>
        </div>
      )}
      {allDone && doneCount > 0 && errCount > 0 && (
        <p className="text-center text-[11px] text-text-muted">Failed jobs can be rerun individually from a new run.</p>
      )}
      {log && (
        <details className="rounded-lg border border-border-subtle bg-surface px-3 py-2">
          <summary className="cursor-pointer text-[11px] text-text-muted">Engine log</summary>
          <pre ref={logRef} className="mt-2 max-h-48 overflow-y-auto text-[11px] leading-relaxed text-text-muted">{log}</pre>
        </details>
      )}
    </div>
  );
}


// Past runs grouped by BATCH: the models launched together are one run of
// the benchmark. Runs from before batch-stamping are clustered by launch time
// (a gap over ten minutes starts a new group). Newest first.
export type RunGroup = { key: string; label: string; date: string; runs: BenchmarkRun[]; isBatch: boolean; latestMs: number; best: number | null };
export function groupRunsByBatch(runs: BenchmarkRun[]): RunGroup[] {
  type Group = { key: string; label: string; date: string; runs: BenchmarkRun[]; isBatch: boolean };
  const groups = new Map<string, Group>();
  const legacy: BenchmarkRun[] = [];
  for (const r of runs) {
    if (!r.batch_id) { legacy.push(r); continue; }
    const g = groups.get(r.batch_id) ?? { key: r.batch_id, label: r.batch_label || r.batch_id, date: r.date || "", runs: [], isBatch: true };
    g.runs.push(r);
    groups.set(r.batch_id, g);
  }
  const GAP = 10 * 60 * 1000;
  const sortedLegacy = [...legacy].sort((a, b) => a.created_ms - b.created_ms);
  let cluster: BenchmarkRun[] = [];
  const flush = () => {
    if (cluster.length === 0) return;
    const first = cluster[0];
    const t = first.created_ms ? new Date(first.created_ms) : null;
    const hhmm = t ? `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` : "";
    const key = `legacy-${first.run_dir}`;
    groups.set(key, { key, label: `${first.date || ""}${hhmm ? " " + hhmm : ""}`.trim() || key, date: first.date || "", runs: cluster, isBatch: false });
    cluster = [];
  };
  for (const r of sortedLegacy) {
    if (cluster.length > 0 && r.created_ms - cluster[cluster.length - 1].created_ms > GAP) flush();
    cluster.push(r);
  }
  flush();
  return Array.from(groups.values())
    .map((g) => ({
      ...g,
      runs: [...g.runs].sort((a, b) => (b.created_ms ?? 0) - (a.created_ms ?? 0)),
      latestMs: g.runs.reduce((mx, r) => Math.max(mx, r.created_ms ?? 0), 0),
      best: g.runs.reduce<number | null>((acc, r) => (r.judge_avg == null ? acc : acc == null ? r.judge_avg : Math.max(acc, r.judge_avg)), null),
    }))
    .sort((a, b) => b.latestMs - a.latestMs);
}

// Right rail for the Leaderboard: the aggregate stats the mockup pins to the
// side (average arena score, fastest model, lowest cost, highest value), a
// score-distribution chart, and plain-language insights. Everything is derived
// from the same ranked rows shown in the standings, so the numbers are real.
type BoardRow = {
  key: string;
  parsed: { vendor: string; model: string };
  best: number | null;
  value: number | null;
  latestRun: BenchmarkRun | null;
  history: number[];
};
function LeaderboardRail({ rows }: { rows: BoardRow[] }) {
  const stats = useMemo(() => {
    const scored = rows.filter((m) => m.best != null);
    if (scored.length === 0) return null;
    const avg = scored.reduce((a, m) => a + (m.best ?? 0), 0) / scored.length;
    const costOf = (m: BoardRow) => (m.latestRun?.cost_basis === "local" ? 0 : m.latestRun?.cost_usd_est ?? null);
    const withMs = scored.filter((m) => m.latestRun?.ms_avg != null && (m.latestRun?.ms_avg ?? 0) > 0);
    const fastest = withMs.length ? withMs.reduce((a, b) => ((a.latestRun!.ms_avg as number) <= (b.latestRun!.ms_avg as number) ? a : b)) : null;
    const withCost = scored.filter((m) => costOf(m) != null);
    const cheapest = withCost.length ? withCost.reduce((a, b) => ((costOf(a) as number) <= (costOf(b) as number) ? a : b)) : null;
    const withValue = scored.filter((m) => m.value != null);
    const bestValue = withValue.length ? withValue.reduce((a, b) => ((a.value as number) >= (b.value as number) ? a : b)) : null;
    // Score distribution into 0-2 / 2-4 / 4-6 / 6-8 / 8-10 buckets.
    const buckets = [0, 0, 0, 0, 0];
    for (const m of scored) { const b = m.best ?? 0; buckets[Math.min(4, Math.floor(b / 2))]++; }
    return { avg, fastest, cheapest, bestValue, buckets, n: scored.length, leader: scored[0], avgSeries: scored.map((m) => m.best ?? 0) };
  }, [rows]);

  if (!stats) return null;
  return (
    <ArenaRightRail>
      <ArenaStatCard icon={TrendingUp} label="Average arena score" value={stats.avg.toFixed(2)} unit="/10" sub={`across ${stats.n} ranked model${stats.n === 1 ? "" : "s"}`} series={stats.avgSeries} />
      {stats.fastest && <ArenaStatCard icon={Gauge} label="Fastest model (avg)" value={fmtLatency(stats.fastest.latestRun?.ms_avg)} badge="Fastest" badgeTone="ok" sub={stats.fastest.parsed.model} />}
      {stats.cheapest && <ArenaStatCard icon={Coins} label="Lowest cost / run" value={fmtCost(stats.cheapest.latestRun?.cost_usd_est, stats.cheapest.latestRun?.cost_basis)} badge="Lowest" badgeTone="ok" sub={stats.cheapest.parsed.model} />}
      {stats.bestValue && <ArenaStatCard icon={Award} label="Highest value" value={stats.bestValue.value!.toFixed(1)} badge="Best value" badgeTone="accent" sub={stats.bestValue.parsed.model} />}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-3 text-[11px] text-text-muted">Score distribution</div>
        <ArenaBars buckets={stats.buckets} labels={["0-2", "2-4", "4-6", "6-8", "8-10"]} />
      </div>
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="mb-3 text-[11px] text-text-muted">Leaderboard insights</div>
        <div className="space-y-2.5">
          {stats.leader && <ArenaInsight icon={Crown} tone="accent">{stats.leader.parsed.model} leads with an arena score of {stats.leader.best?.toFixed(2)}.</ArenaInsight>}
          {stats.fastest && <ArenaInsight icon={Gauge} tone="ok">{stats.fastest.parsed.model} is the fastest on average ({fmtLatency(stats.fastest.latestRun?.ms_avg)} per question), ideal for low-latency use.</ArenaInsight>}
          {stats.cheapest && <ArenaInsight icon={Coins} tone="ok">{stats.cheapest.parsed.model} is the most economical at {fmtCost(stats.cheapest.latestRun?.cost_usd_est, stats.cheapest.latestRun?.cost_basis)} per run.</ArenaInsight>}
        </div>
      </div>
    </ArenaRightRail>
  );
}

export function BenchResults({
  view, domainFilter, runs, matrix, allDomains, vaultPath, initialModel, currentDomain, onChanged, onRerun,
}: {
  view: "board" | "matrix";
  domainFilter: string;
  runs: BenchmarkRun[];
  matrix: MatrixRow[];
  allDomains: string[];
  vaultPath: string;
  currentDomain?: string | null;
  initialModel?: string | null;
  onChanged: () => void;
  onRerun: (run: BenchmarkRun) => void;
}) {
  const resultsView = view;
  const [selected, setSelected] = useState<RunDetail | null>(null);
  // The run + breadcrumb context behind the open detail page, so the user can
  // see where they are (view › batch › run) and walk back up the tree.
  const [selectedRun, setSelectedRun] = useState<BenchmarkRun | null>(null);
  const [selectedFrom, setSelectedFrom] = useState<{ view: string; batch?: string } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [expandedQ, setExpandedQ] = useState<string | null>(null);
  // Set of run_dirs currently being scored, so you can fire scoring on several
  // runs at once - each scores independently instead of one lock blocking all.
  const [scoringRuns, setScoringRuns] = useState<Set<string>>(() => new Set());

  async function loadRun(runDir: string, from?: { view: string; batch?: string }) {
    setLoadingDetail(true);
    setExpandedQ(null);
    setSelectedRun(runs.find((r) => r.run_dir === runDir) ?? null);
    setSelectedFrom(from ?? { view: resultsView === "matrix" ? "By domain" : "Summary" });
    try {
      setSelected(await invoke<RunDetail>("benchmark_run_detail", { runDir }));
    } catch { /* ignore */ } finally {
      setLoadingDetail(false);
    }
  }

  // Score one unscored run on demand, then refresh the lists.
  async function scoreNow(run: BenchmarkRun) {
    const runName = run.run_dir.split("/").pop() ?? "";
    if (!runName) return;
    const dir = run.run_dir;
    if (scoringRuns.has(dir)) return; // already scoring this one
    const session = `bench-score-one-${Date.now()}-${runName}`;
    setScoringRuns((s) => new Set(s).add(dir));
    try {
      const done = new Promise<void>((resolve) => {
        let un: UnlistenFn | null = null;
        listen<{ session: string; phase: string }>("benchmark:done", (e) => {
          if (e.payload.session === session && e.payload.phase === "score") { un?.(); resolve(); }
        }).then((u) => { un = u; });
      });
      await invoke("benchmark_score", { args: { session_id: session, vault: vaultPath, run: runName } });
      await done;
      onChanged();
    } catch { /* surfaced via refresh */ } finally {
      setScoringRuns((s) => { const n = new Set(s); n.delete(dir); return n; });
    }
  }

  // Runs visible under the current domain filter (a run is "in" a domain
  // when any of its questions came from it).
  const visibleRuns = useMemo(() => {
    if (domainFilter === "all") return runs;
    return runs.filter((r) => r.domains.includes(domainFilter));
  }, [runs, domainFilter]);

  // By-model aggregation: every run of the same model folded into one row -
  // best/latest scores, run count, and the domains it has been tested on.
  const modelAgg = useMemo(() => {
    const byModel = new Map<string, { parsed: ReturnType<typeof parseRunLabel>; runs: BenchmarkRun[] }>();
    for (const r of visibleRuns) {
      const parsed = parseRunLabel(r.label);
      const key = `${parsed.vendor}::${parsed.model || r.label}`;
      const e = byModel.get(key) ?? { parsed, runs: [] };
      e.runs.push(r);
      byModel.set(key, e);
    }
    const rows = Array.from(byModel.values()).map(({ parsed, runs: rr }) => {
      const judgeFor = (r: BenchmarkRun) => {
        if (domainFilter === "all") return r.judge_avg;
        return matrix.find((m) => m.run_dir === r.run_dir)?.per_domain[domainFilter]?.judge_avg ?? null;
      };
      const kwFor = (r: BenchmarkRun) => {
        if (domainFilter === "all") return r.keyword_avg;
        return matrix.find((m) => m.run_dir === r.run_dir)?.per_domain[domainFilter]?.keyword_avg ?? null;
      };
      const scoredRuns = rr.filter((r) => judgeFor(r) !== null);
      const best = scoredRuns.reduce<number | null>((acc, r) => {
        const v = judgeFor(r);
        return v === null ? acc : acc === null ? v : Math.max(acc, v);
      }, null);
      const latest = [...rr].sort((a, b) => b.date.localeCompare(a.date))[0];
      const domains = Array.from(new Set(rr.flatMap((r) => r.domains))).sort();
      // Chronological judge scores - the drift line. Delta = latest vs the
      // run before it.
      const history = [...scoredRuns]
        .sort((a, b) => a.created_ms - b.created_ms)
        .map((r) => judgeFor(r))
        .filter((v): v is number => v !== null);
      const delta = history.length >= 2 ? history[history.length - 1] - history[history.length - 2] : null;
      return {
        key: `${parsed.vendor}::${parsed.model}`,
        parsed,
        runs: [...rr].sort((a, b) => b.date.localeCompare(a.date)),
        best,
        latestRun: latest ?? null,
        latestJudge: latest ? judgeFor(latest) : null,
        latestKw: latest ? kwFor(latest) : null,
        latestDate: latest?.date ?? "",
        domains,
        history,
        delta,
      };
    });
    return rows.sort((a, b) => (b.best ?? -1) - (a.best ?? -1));
  }, [visibleRuns, matrix, domainFilter]);
  const [expandedModel, setExpandedModel] = useState<string | null>(initialModel ?? null);

  // The Leaderboard is sortable across all dimensions + a composite Value
  // (this folds in the old Compare "Ranked" view so there's one ranked list,
  // not two). Value = 50% intelligence · 25% speed · 25% cost, normalized over
  // the visible models. Default sort stays Intelligence.
  const [boardSort, setBoardSort] = useState<"intel" | "value" | "speed" | "cost">("intel");
  const { rankedRows, unrankedRows } = useMemo(() => {
    // A model is "rankable" only if it produced a real judged score — meaning a
    // score that is BOTH present and > 0. A model that errored/never ran shows up
    // with a null OR a 0 score, and its speed ($0) and latency (~0ms) are equally
    // bogus. Excluding it from the rankable set here keeps it off the top of
    // EVERY sort (Intelligence, Value, Speed AND Cost), not just Intelligence.
    const hasRealScore = (b: number | null) => b != null && b > 0;
    const rankable = modelAgg.filter((m) => hasRealScore(m.best));
    const costsPos = rankable.map((m) => (m.latestRun?.cost_basis === "local" ? 0 : m.latestRun?.cost_usd_est)).filter((c): c is number => c != null && c > 0);
    const costMax = costsPos.length ? Math.max(...costsPos, 0.0001) : 1;
    const msVals = rankable.map((m) => m.latestRun?.ms_avg).filter((v): v is number => v != null && v > 0);
    const msMin = msVals.length ? Math.min(...msVals) : 0;
    const msMax = msVals.length ? Math.max(...msVals) : 1;
    const speedN = (ms: number | null | undefined) => ms == null ? 0.5 : msMax === msMin ? 0.5 : 1 - (ms - msMin) / (msMax - msMin);
    const costN = (c: number | null | undefined) => c == null ? 0.5 : costMax <= 0 ? 1 : 1 - c / costMax;
    const withV = rankable.map((m) => {
      const local = m.latestRun?.cost_basis === "local";
      const cost = local ? 0 : (m.latestRun?.cost_usd_est ?? null);
      return { ...m, value: (0.5 * ((m.best ?? 0) / 10) + 0.25 * speedN(m.latestRun?.ms_avg) + 0.25 * costN(cost)) * 10 };
    });
    const ranked = [...withV].sort((a, b) => {
      if (boardSort === "cost") {
        const ac = a.latestRun?.cost_basis === "local" ? 0 : (a.latestRun?.cost_usd_est ?? Infinity);
        const bc = b.latestRun?.cost_basis === "local" ? 0 : (b.latestRun?.cost_usd_est ?? Infinity);
        return ac - bc;
      }
      const f = (x: typeof withV[number]) => boardSort === "intel" ? (x.best ?? -1) : boardSort === "speed" ? speedN(x.latestRun?.ms_avg) : boardSort === "value" ? x.value : (x.best ?? -1);
      return f(b) - f(a);
    });
    // Unranked: didn't produce a real score (null OR 0). Value is null so the
    // row renders dashes, not a misleading 0.
    const unranked = modelAgg
      .filter((m) => !hasRealScore(m.best))
      .map((m) => ({ ...m, value: null as number | null }))
      .sort((a, b) => (b.latestDate || "").localeCompare(a.latestDate || ""));
    return { rankedRows: ranked, unrankedRows: unranked };
  }, [modelAgg, boardSort]);

  // One leaderboard row. rank === null means the model produced no judged score
  // (errored / unscored) — it renders muted, parked below the standings, and its
  // speed/cost are hidden so a $0/0ms error can't masquerade as a great result.
  const renderBoardRow = (m: (typeof rankedRows)[number] | (typeof unrankedRows)[number], rank: number | null) => {
    const total = rankedRows.length;
    const leader = rank === 0 && total > 1;
    const podium = rank !== null && rank < 3 && total > 1;
    return (
      <div
        key={m.key}
        className={`overflow-hidden rounded-xl border transition-colors ${
          rank === null
            ? "border-border-subtle bg-surface/60 opacity-70"
            : leader
              ? "border-accent bg-gradient-to-r from-accent-soft/70 to-surface"
              : podium
                ? "border-accent-border/50 bg-surface"
                : "border-border-subtle bg-surface"
        }`}
      >
        <button
          onClick={() => setExpandedModel(expandedModel === m.key ? null : m.key)}
          className={`flex w-full items-center gap-3 text-left hover:bg-surface-warm/60 ${leader ? "px-4 py-3" : "px-4 py-2"}`}
        >
          {/* Rank */}
          <span className={`flex shrink-0 items-center justify-center rounded-full font-bold ${
            rank === null
              ? "h-6 w-6 text-[11px] text-text-muted/50"
              : leader
                ? "h-8 w-8 bg-accent text-background"
                : podium
                  ? "h-6 w-6 border border-accent-border bg-accent-soft text-[11px] text-accent"
                  : "h-6 w-6 text-[11px] text-text-muted"
          }`}>
            {rank === null ? "–" : leader ? <Crown className="h-4 w-4" /> : rank + 1}
          </span>
          <ProviderMark vendor={m.parsed.vendor} size={leader ? 28 : 22} />
          <span className="min-w-0 flex-1">
            <span className={`block truncate ${leader ? "text-base font-bold" : "text-sm font-semibold"}`}>
              {m.parsed.model}
            </span>
            <span className="block text-[12px] text-text-muted">
              {m.runs.length} run{m.runs.length === 1 ? "" : "s"} · {m.domains.length} domain{m.domains.length === 1 ? "" : "s"} · last {m.latestDate || "-"}
              {rank === null ? (
                <span className="ml-1.5 font-semibold text-warn" title="No judged score: this model errored or hasn't been scored, so it isn't ranked.">· no score</span>
              ) : m.delta !== null && Math.abs(m.delta) >= 0.05 ? (
                <span className={`ml-1.5 font-semibold ${m.delta > 0 ? "text-ok" : "text-warn"}`} title={`Judge trend: ${m.history.map((v) => v.toFixed(1)).join(" → ")}`}>
                  {m.delta > 0 ? "▲" : "▼"}{Math.abs(m.delta).toFixed(1)}
                </span>
              ) : null}
            </span>
          </span>
          {/* Numeric columns — fixed widths + always rendered so every row lines
              up. Speed/cost are dashed for unranked models (can't be trusted). */}
          <span className={`hidden w-16 shrink-0 text-right text-[11px] tabular-nums sm:block ${boardSort === "speed" && rank !== null ? "text-text-primary" : "text-text-muted"}`} title="Speed: avg latency per question (latest run)">
            {rank !== null && m.latestRun?.ms_avg != null ? fmtLatency(m.latestRun.ms_avg) : "–"}
          </span>
          <span className={`hidden w-20 shrink-0 text-right text-[11px] tabular-nums sm:block ${boardSort === "cost" && rank !== null ? "text-text-primary" : "text-text-muted"}`} title="Cost: est. per run (latest run)">
            {rank !== null && m.latestRun?.cost_usd_est != null ? fmtCost(m.latestRun.cost_usd_est, m.latestRun.cost_basis) : "–"}
          </span>
          <span className={`hidden w-12 shrink-0 text-right text-[11px] tabular-nums md:block ${boardSort === "value" && rank !== null ? "text-accent" : "text-text-muted"}`} title="Value: 50% intelligence · 25% speed · 25% cost">
            {m.value != null ? m.value.toFixed(1) : "–"}
          </span>
          <div className="hidden w-24 shrink-0 lg:block"><ScoreBar value={m.best} max={10} color={scoreColor((m.best ?? 0) * 10)} /></div>
          <span className={`shrink-0 text-right font-bold tabular-nums ${rank === null ? "text-text-muted/50" : "text-accent"} ${leader ? "w-14 text-2xl" : "w-12 text-sm"}`}>
            {m.best?.toFixed(1) ?? "–"}
          </span>
        </button>
        {expandedModel === m.key && (
          <div className="border-t border-border-subtle bg-surface px-4 py-2">
            {m.runs.map((r) => (
              <div key={r.run_dir} className="flex w-full items-center gap-3 rounded px-2 py-1.5 hover:bg-surface-warm">
                <button
                  onClick={() => r.scored && loadRun(r.run_dir)}
                  disabled={!r.scored}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
                >
                  <span className="w-20 shrink-0 text-[11px] text-text-muted">{r.date || "undated"}</span>
                  <span className="flex min-w-0 flex-1 items-center gap-1">
                    {r.domains.slice(0, 6).map((d) => (
                      <span key={d} className="rounded bg-surface-warm px-1.5 py-0 text-[11px] text-text-muted">{d}</span>
                    ))}
                    {r.domains.length > 6 && <span className="text-[11px] text-text-muted">+{r.domains.length - 6}</span>}
                  </span>
                  <span className="text-[11px] text-text-muted">{r.questions} q</span>
                  {r.scored ? (
                    <RunDims run={r} />
                  ) : (
                    <span className="text-[11px] text-warn">Unscored</span>
                  )}
                </button>
                {!r.scored && (
                  <button
                    onClick={() => void scoreNow(r)}
                    disabled={scoringRuns.has(r.run_dir)}
                    title="Score: run only the judge on the existing answers. No answers regenerated, no generation tokens spent."
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] text-background hover:bg-accent-hover disabled:opacity-50"
                  >
                    {scoringRuns.has(r.run_dir) ? <Loader2 className="h-3 w-3 animate-spin" /> : "Score"}
                  </button>
                )}
                <button
                  onClick={() => onRerun(r)}
                  title="Rerun: regenerate all answers as a fresh run (spends generation tokens). Use Score if you just need the judge to grade existing answers."
                  className="shrink-0 rounded-md border border-border p-1 text-text-muted hover:border-accent-border hover:text-accent"
                >
                  <RotateCw className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // K2 (Monday feedback): the "Coverage by domain" summary table was removed -
  // it restated runs/models-per-domain that the main Model × domain matrix below
  // already conveys ("What's the point of this. Remove it.").

  if (selected) {
    const p = parseRunLabel(selected.score.label);
    const crumbBatch = selectedRun?.batch_label ?? selectedFrom?.batch ?? (selectedRun?.date || null);
    // A section header inside an expanded question: big, bold, unmissable.
    const SectionHead = ({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "ok" | "accent" }) => (
      <h4 className={`mb-1.5 flex items-center gap-2 text-[15px] font-semibold ${
        tone === "ok" ? "text-ok" : tone === "accent" ? "text-accent" : "text-text-primary"
      }`}>
        {children}
      </h4>
    );
    return (
      <div className="w-full px-8 py-5 max-md:px-4">
        <BenchCrumbs
          items={[
            { label: "Arena" },
            { label: selectedFrom?.view ?? "Leaderboard", onClick: () => setSelected(null) },
            ...(crumbBatch ? [{ label: crumbBatch, onClick: () => setSelected(null) }] : []),
            { label: p.model },
          ]}
          meta={`${selected.score.questionScores.length} questions`}
        />
        {/* Dense header - model, when, where it ran, and the verdict, one row. */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
          <ProviderMark vendor={p.vendor} size={28} />
          <h2 className={DETAIL_TITLE}>{p.model}</h2>
          {selectedRun?.date && <span className="rounded bg-surface-warm px-2 py-0.5 text-[12px] text-text-muted">{selectedRun.date}</span>}
          <span className="flex items-center gap-1">
            {(selectedRun?.domains ?? []).slice(0, 6).map((d) => (
              <span key={d} className="rounded bg-surface-warm px-1.5 py-0.5 text-[12px] text-text-muted">{d}</span>
            ))}
            {(selectedRun?.domains.length ?? 0) > 6 && <span className="text-[12px] text-text-muted">+{(selectedRun?.domains.length ?? 0) - 6}</span>}
          </span>
          <div className="ml-auto flex items-center gap-5 text-sm">
            <span title="Intelligence: judge score /10"><span className="font-display text-2xl font-bold text-accent">{selected.score.judge_avg?.toFixed(1) ?? "-"}</span><span className="text-[11px] text-text-muted"> /10</span></span>
            <span className="text-text-secondary">{selected.score.keyword_avg !== null ? Math.round(selected.score.keyword_avg) + "% kw" : ""}</span>
            <span className="inline-flex items-center gap-1 text-text-muted" title="Speed: average latency per question"><Zap className="h-3.5 w-3.5" />{fmtLatency(selectedRun?.ms_avg ?? selected.score.ms_avg)}</span>
            <span className={`inline-flex items-center gap-1 ${(selectedRun?.cost_basis ?? selected.score.cost_basis) === "local" ? "text-ok" : "text-text-muted"}`} title="Cost: estimated from token usage (free for local models)"><DollarSign className="h-3.5 w-3.5" />{fmtCost(selectedRun?.cost_usd_est ?? selected.score.cost_usd_est, selectedRun?.cost_basis ?? selected.score.cost_basis)}</span>
            <span className="text-text-muted">{selected.score.questionScores.length} q</span>
            {selectedRun && (
              <button
                onClick={() => onRerun(selectedRun)}
                title="Rerun: same model, same domains, as a fresh run"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-muted hover:border-accent-border hover:text-accent"
              >
                <RotateCw className="h-3 w-3" /> rerun
              </button>
            )}
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {selected.score.questionScores.map((q) => {
            const expanded = expandedQ === q.id;
            const record = selected.records.find((r) => r.id === q.id);
            return (
              <div key={q.id} className="overflow-hidden rounded-lg border border-border bg-surface">
                <button onClick={() => setExpandedQ(expanded ? null : q.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-warm">
                  <span className="text-text-muted">{expanded ? "▾" : "▸"}</span>
                  <span className="w-44 shrink-0 truncate text-sm text-text-primary" title={q.id}>{q.id}</span>
                  <span className="rounded bg-surface-warm px-1.5 py-0 text-[11px] text-text-muted">{q.domain}</span>
                  <div className="min-w-0 flex-1"><ScoreBar value={q.judge_score} max={10} /></div>
                  <span className="flex shrink-0 items-center gap-3 text-xs">
                    <span className="text-text-muted">{q.keyword_score !== null ? Math.round(q.keyword_score) + "%" : "-"}</span>
                    <span className="w-10 text-right text-accent">{q.judge_score ?? "-"}/10</span>
                  </span>
                </button>
                {expanded && (
                  <div className="space-y-5 border-t border-border-subtle px-6 py-5 text-sm">
                    <div>
                      <SectionHead><FileText className="h-4 w-4" /> Question</SectionHead>
                      <div className="max-w-[90ch] whitespace-pre-wrap leading-relaxed text-text-primary">{record?.prompt ?? "(n/a)"}</div>
                    </div>
                    {record?.expected_decision && (
                      <div className="rounded-lg border border-ok/25 bg-ok/5 px-4 py-3">
                        <SectionHead tone="ok"><Check className="h-4 w-4" strokeWidth={3} /> Expected decision</SectionHead>
                        <div className="max-w-[90ch] whitespace-pre-wrap leading-relaxed text-text-primary">{record.expected_decision}</div>
                      </div>
                    )}
                    <div>
                      <SectionHead><MessagesSquare className="h-4 w-4" /> Model's answer</SectionHead>
                      <div className="max-w-[90ch] whitespace-pre-wrap leading-relaxed text-text-primary">{record?.reply ?? "(no reply)"}</div>
                    </div>
                    {q.judge_rationale && (
                      <div className="rounded-lg border border-accent-border bg-accent-soft/40 px-4 py-3">
                        <SectionHead tone="accent"><Scale className="h-4 w-4" /> Judge verdict · {q.judge_score}/10</SectionHead>
                        <div className="max-w-[90ch] whitespace-pre-wrap leading-relaxed text-text-secondary">{q.judge_rationale}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-8 pb-6 max-md:px-4">
      {visibleRuns.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
          {domainFilter === "all"
            ? <>No runs yet. Head to <span className="text-accent">Run</span> to kick one off.</>
            : <>No runs cover <span className="text-accent">{titleCase(domainFilter)}</span> yet. Run a benchmark scoped to it, or switch the filter to all domains.</>}
        </div>
      )}

      {/* K2: "Coverage by domain" table removed - redundant with the matrix. */}

      {loadingDetail && <div className="mb-2 text-xs text-text-muted">loading…</div>}

      {/* LEADERBOARD - the page leads with the ANSWER: which model wins.
          Podium for the top three, then full standings, one row per model. */}
      {resultsView === "board" && visibleRuns.length > 0 && (
        <div className="flex flex-col gap-5">
          <div className="min-w-0 flex-1">
          {/* Hero: the current top performer reads first, with its trend and the
              dimensions that matter (speed, cost, value), all from real runs. */}
          {rankedRows.length > 0 && (() => {
            const top = rankedRows[0];
            return (
              <div className="mb-4 overflow-hidden rounded-2xl border border-accent bg-gradient-to-br from-accent-soft/70 via-surface to-surface p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-background">
                    <Crown className="h-3 w-3" /> #1 Top performer
                  </span>
                  <ProviderMark vendor={top.parsed.vendor} size={26} />
                  <span className="text-[15px] font-semibold leading-snug text-text-primary">{top.parsed.model}</span>
                  <span className="text-[11px] text-text-muted">{top.runs.length} run{top.runs.length === 1 ? "" : "s"} · {top.domains.length} domain{top.domains.length === 1 ? "" : "s"}{top.latestDate ? ` · last ${top.latestDate}` : ""}</span>
                  {top.history.length >= 2 && <span className="ml-auto"><Sparkline values={top.history} width={120} height={32} /></span>}
                </div>
                <div className="mt-4 flex flex-wrap items-end gap-6">
                  <div>
                    <div className="text-[11px] text-text-muted">Arena score</div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-[24px] font-bold leading-none text-accent">{top.best?.toFixed(2) ?? "-"}</span>
                      <span className="text-sm text-text-muted">/10</span>
                      {top.delta !== null && Math.abs(top.delta) >= 0.05 && (
                        <span className={`text-xs font-semibold ${top.delta > 0 ? "text-ok" : "text-warn"}`}>{top.delta > 0 ? "▲" : "▼"}{Math.abs(top.delta).toFixed(2)}</span>
                      )}
                    </div>
                  </div>
                  <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                    <ArenaMetric icon={Gauge} label="Avg speed" value={fmtLatency(top.latestRun?.ms_avg)} hint="latest run" />
                    <ArenaMetric icon={DollarSign} label="Avg cost / run" value={fmtCost(top.latestRun?.cost_usd_est, top.latestRun?.cost_basis)} hint="lower is better" tone={top.latestRun?.cost_basis === "local" ? "ok" : "muted"} />
                    <ArenaMetric icon={Award} label="Value" value={top.value != null ? top.value.toFixed(1) : "-"} hint="intel · speed · cost" tone="accent" />
                    <ArenaMetric icon={Layers} label="Domains" value={String(top.domains.length)} hint="tested on" />
                  </div>
                </div>
              </div>
            );
          })()}
          {(() => {
            // What each sort dimension means, surfaced as per-tab tooltips and a
            // live legend line, so the metrics (especially the composite Value)
            // are self-explanatory in the app.
            const SORT_META: Record<"intel" | "value" | "speed" | "cost", { tip: string; legend: string }> = {
              intel: { tip: "Intelligence: average judge score out of 10 (answer quality)", legend: "Intelligence = average judge score out of 10. How good the answers are, graded by a judge model." },
              value: { tip: "Value: 50% intelligence + 25% speed + 25% cost, each normalized across the visible models", legend: "Value = 50% intelligence + 25% speed + 25% cost, each normalized across the visible models. Best quality per dollar and per second." },
              speed: { tip: "Speed: average response latency per question (faster ranks higher)", legend: "Speed = average response time per question. Faster ranks higher." },
              cost: { tip: "Cost: estimated dollar cost of the run (local models are free)", legend: "Cost = estimated dollar cost of the run, from tokens used. Local models are free." },
            };
            return (
              <div className="mb-2 px-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-text-muted">Sort by</span>
                  <div className="inline-flex items-center rounded-lg border border-border-subtle bg-surface p-0.5">
                    {([["intel", "Intelligence"], ["value", "Value"], ["speed", "Speed"], ["cost", "Cost"]] as const).map(([k, label]) => (
                      <button key={k} onClick={() => setBoardSort(k)} title={SORT_META[k].tip} className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${boardSort === k ? "bg-accent text-background shadow-sm" : "text-text-muted hover:bg-surface-warm hover:text-text-primary"}`}>{label}</button>
                    ))}
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">{SORT_META[boardSort].legend}</p>
              </div>
            );
          })()}
          {/* Column header - aligns with the fixed-width columns below. */}
          <div className="mb-1 hidden items-center gap-3 px-4 text-[11px] text-text-muted/70 sm:flex">
            <span className="min-w-0 flex-1" />
            <span className="w-16 text-right">Speed</span>
            <span className="w-20 text-right">Cost</span>
            <span className="hidden w-12 text-right md:block">Value</span>
            <span className="hidden w-24 lg:block">Score</span>
            <span className="w-12 text-right">/10</span>
          </div>
          <div className="flex flex-col gap-2">
            {rankedRows.map((m, i) => renderBoardRow(m, i))}
          </div>
          {unrankedRows.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] text-text-muted">
                <AlertTriangle className="h-3 w-3 text-warn" /> Not ranked: no judged score (errored or unscored)
              </div>
              <div className="flex flex-col gap-2">
                {unrankedRows.map((m) => renderBoardRow(m, null))}
              </div>
            </div>
          )}
          </div>
          <LeaderboardRail rows={rankedRows} />
        </div>
      )}

      {resultsView === "matrix" && visibleRuns.length > 0 && (
        <div className="flex flex-col gap-5">
          <div className="min-w-0 flex-1"><BenchMatrix matrix={matrix} allDomains={allDomains} onPick={loadRun} currentDomain={currentDomain} runs={runs} /></div>
          <MatrixInsights matrix={matrix} allDomains={allDomains} />
        </div>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// THE ARENA PAGE
//
// Three things, in plain terms: run a benchmark, keep presets (saved sets of
// models), and read the results. The column lists exactly that: "Run a
// benchmark" first, then the presets, then the results (the Leaderboard across
// every run, and each past run newest first). The detail is the picked item.
type ArenaSel =
  | { kind: "run" }
  | { kind: "preset"; id: string }
  | { kind: "board" }
  | { kind: "result"; key: string };

// Which preset a run was launched from, by batch id, so the Results column can
// name it. Written when a run starts; old runs simply show their model count.
const BATCH_PRESETS_KEY = "prevail.bench.batchPresets";
function readBatchPresets(): Record<string, string> {
  try { const v = JSON.parse(lsGet(BATCH_PRESETS_KEY, "{}") || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}

type PresetView = { id: string; name: string; models: string[]; builtIn: boolean; rationale?: string };

// Old deep links name Arena sections that no longer exist; each lands on the
// nearest thing that does.
export function arenaSelFor(initial: string | null | undefined): ArenaSel | null {
  switch (initial) {
    case "run": case "benchmark": case "arena": case "presets": case "schedule": case "scout": return { kind: "run" };
    case "leaderboard": case "board": case "history": case "matrix": case "frontier": case "chart": case "questions": return { kind: "board" };
    default: return null;
  }
}

export function BenchmarkPanel({
  vaultPath,
  initialDomain,
  initial,
}: {
  vaultPath: string;
  initialDomain?: string | null;
  // A deep-linked section ("leaderboard", "history", "scout", ...).
  initial?: string | null;
}) {
  // A "runs" deep link from the Models page lands on the Leaderboard with a
  // model key expanded. Consumed once.
  const [initialModel] = useState<string | null>(() => {
    const v = lsGet("prevail.bench.expandModel");
    if (v) lsSet("prevail.bench.expandModel", "");
    return v || null;
  });
  const [sel, setSel] = useState<ArenaSel>(() => arenaSelFor(initial) ?? (initialModel ? { kind: "board" } : { kind: "run" }));
  const [picked, setPicked] = useState(false);
  const phone = useIsPhone();
  const go = (s: ArenaSel) => { setSel(s); setPicked(true); setErr(null); };

  // Data
  // Seeded from the shared cache so a revisit paints the last answers while
  // refresh() re-reads them.
  const seed = <T,>(cmd: string, args?: Record<string, unknown>): T[] => { const c = peekInvoke<T[]>(cmd, args); return Array.isArray(c) ? c : []; };
  const [runs, setRuns] = useState<BenchmarkRun[]>(() => seed("benchmark_runs", { vault: vaultPath }));
  const [matrix, setMatrix] = useState<MatrixRow[]>(() => seed("benchmark_matrix", { vault: vaultPath }));
  const [questions, setQuestions] = useState<BenchQuestion[]>(() => seed("benchmark_questions", { vault: vaultPath }));
  const [err, setErr] = useState<string | null>(null);
  const [vaultDomains, setVaultDomains] = useState<string[]>(() => seed<Domain>("scan_vault", { path: vaultPath }).map((d) => d.name).filter(isUserDomain));
  const [apps, setApps] = useState<EngineApp[]>(() => seed("engine_apps_list"));
  const refresh = useCallback(() => {
    const fresh = { force: true };
    invokeCached<BenchmarkRun[]>("benchmark_runs", { vault: vaultPath }, fresh).then((v) => setRuns(Array.isArray(v) ? v : [])).catch((e) => setErr(String(e)));
    invokeCached<MatrixRow[]>("benchmark_matrix", { vault: vaultPath }, fresh).then((v) => setMatrix(Array.isArray(v) ? v : [])).catch(() => {});
    invokeCached<BenchQuestion[]>("benchmark_questions", { vault: vaultPath }, fresh).then((v) => setQuestions(Array.isArray(v) ? v : [])).catch(() => {});
    invokeCached<Domain[]>("scan_vault", { path: vaultPath })
      .then((ds) => setVaultDomains(Array.isArray(ds) ? ds.map((d) => d.name).filter(isUserDomain) : []))
      .catch(() => {});
    invokeCached<EngineApp[]>("engine_apps_list", undefined, fresh).then((v) => setApps(Array.isArray(v) ? v : [])).catch(() => {});
  }, [vaultPath]);
  useEffect(() => { refresh(); }, [refresh]);
  // Runs change on disk from outside this view (a CLI run, a rescore): re-read
  // when the window comes back.
  useEffect(() => {
    const onWake = () => { if (document.visibilityState !== "hidden") refresh(); };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => { window.removeEventListener("focus", onWake); document.removeEventListener("visibilitychange", onWake); };
  }, [refresh]);

  // Benchmarkable domains: the vault's real domains first, then any that exist
  // only in question files or old runs. Connected apps are not domains.
  const allDomains = useMemo(() => {
    const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const appKeys = new Set<string>();
    for (const a of apps) { appKeys.add(norm(a.id)); appKeys.add(norm(a.title)); }
    const isApp = (d: string) => { const n = norm(d); return appKeys.has(n) || appKeys.has(n.replace(/^app/, "")); };
    const vault = [...vaultDomains].sort().filter((d) => !isApp(d));
    const extra = new Set<string>();
    for (const q of questions) extra.add(q.domain);
    for (const m of matrix) for (const d of Object.keys(m.per_domain)) extra.add(d);
    for (const v of vault) extra.delete(v);
    return [...vault, ...Array.from(extra).sort().filter((d) => isUserDomain(d) && !isApp(d))];
  }, [vaultDomains, questions, matrix, apps]);
  const activeQuestions = useMemo(() => questions.filter((q) => !q.archived), [questions]);
  const questionCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const q of activeQuestions) m[q.domain.toLowerCase()] = (m[q.domain.toLowerCase()] ?? 0) + 1;
    return m;
  }, [activeQuestions]);

  // Models and presets.
  const { runtimes, presetInput, loaded: modelsLoaded } = useArenaModels();
  const suites = useSuites();
  const presets: PresetView[] = useMemo(() => [
    ...suites.map((s) => ({ id: s.id, name: s.name, models: s.models, builtIn: false })),
    ...canonicalPresets(presetInput).map((p) => ({ id: `builtin:${p.name}`, name: p.name, models: p.models, builtIn: true, rationale: p.rationale })),
  ], [suites, presetInput]);

  // ── Run setup ──────────────────────────────────────────────────
  const [modelMode, setModelMode] = useState<"preset" | "custom">("preset");
  const [runPreset, setRunPreset] = useState<string | null>(null);
  const [customModels, setCustomModels] = useState<Set<string>>(() => new Set());
  const [scope, setScope] = useState<Set<string>>(() => new Set(initialDomain ? [initialDomain.toLowerCase()] : []));
  // With no presets at all, choosing models by hand is the only path.
  useEffect(() => { if (modelsLoaded && presets.length === 0) setModelMode("custom"); }, [modelsLoaded, presets.length]);
  const presetForRun = presets.find((p) => p.id === runPreset) ?? null;
  const runModels = modelMode === "preset" ? (presetForRun?.models ?? []) : Array.from(customModels);
  const scopedQuestions = scope.size === 0 ? activeQuestions : activeQuestions.filter((q) => scope.has(q.domain.toLowerCase()));
  const est = estimateRun(runModels, scopedQuestions.length, runs);
  const toggleCustom = (k: string) => setCustomModels((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleScope = (d: string) => setScope((cur) => { const n = new Set(cur); if (n.has(d)) n.delete(d); else n.add(d); return n; });

  // Live runs from the module registry (they survive navigation). The Run page
  // shows the ones in flight; a run started here opens its result when done.
  const allBatches = useBenchBatches().filter((b) => b.vault === vaultPath);
  const running = allBatches.filter((b) => b.running);
  const launched = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const b of allBatches) {
      if (b.running || !launched.current.has(b.id)) continue;
      launched.current.delete(b.id);
      refresh();
      if (b.cancelled) continue;
      const ran = b.jobs.filter((j) => j.status === "done").length;
      const errored = b.jobs.filter((j) => j.status === "error").length;
      if (ran === 0 && errored > 0) { setErr(`The run produced no results: all ${errored} model${errored === 1 ? "" : "s"} errored.`); continue; }
      setSel({ kind: "result", key: b.id });
    }
  }, [allBatches, refresh]);
  const dismissBatch = (b: BenchBatch) => { benchBatches.delete(b.id); benchNotify(); };

  // Start a batch from explicit models + domains. Returns false (with the
  // reason shown) when nothing can run.
  function executeRun(modelKeys: string[], domains: Set<string>, presetName: string | null, resumeId?: string): boolean {
    const scoped = domains.size === 0 ? activeQuestions : activeQuestions.filter((q) => domains.has(q.domain.toLowerCase()));
    const qids = scoped.map((q) => q.id).sort();
    if (qids.length === 0) {
      setErr(domains.size === 0
        ? "No active questions to run. Add some under Leaderboard, Questions."
        : `No active questions in ${Array.from(domains).map(titleCase).join(", ")}. Add or restore some under Leaderboard, Questions.`);
      return false;
    }
    const jobs: BenchJob[] = modelKeys.map((k) => {
      const [cli, model] = k.split(MODEL_SEP);
      return { key: k, cli, model, label: `${titleCase(cli)} · ${modelLabel(cli, model) || model}`, status: "queued" as BenchJobStatus, done: 0, total: qids.length, qids, qdone: {} };
    });
    const runnable = isBunkerOn() ? jobs.filter((j) => isLocalCli(j.cli)) : jobs;
    if (runnable.length === 0) { setErr(isBunkerOn() ? "Blocked by Bunker Mode: pick a local model." : "Pick at least one model to run."); return false; }
    setErr(isBunkerOn() && runnable.length < jobs.length ? "Cloud models were skipped (Blocked by Bunker Mode)." : null);
    void executeBenchBatch(vaultPath, runnable, false, Array.from(domains).join(","), resumeId);
    // executeBenchBatch registers the batch before its first await, so the
    // newest registry entry is this run.
    const id = resumeId ?? Array.from(benchBatches.keys()).pop();
    if (id) {
      launched.current.add(id);
      if (presetName) lsSet(BATCH_PRESETS_KEY, JSON.stringify({ ...readBatchPresets(), [id]: presetName }));
    }
    return true;
  }
  const startRunAllDomains = () => { setScope(new Set()); if (executeRun(runModels, new Set(), presetForRun?.name ?? null)) setSel({ kind: "run" }); };
  const startRun = () => { if (executeRun(runModels, scope, modelMode === "preset" ? presetForRun?.name ?? null : null)) setSel({ kind: "run" }); };

  // Rerun a past run (same models, same domains) or continue an unfinished one
  // under its original batch id, so the engine resumes instead of starting over.
  const groupModels = (g: RunGroup) => Array.from(new Set(g.runs.filter((r) => r.cli).map((r) => `${r.cli}${MODEL_SEP}${r.model ?? ""}`)));
  // When a run happened, as "YYYY-MM-DD HH:MM" (its first run's start).
  const groupWhen = (g: RunGroup) => {
    const first = Math.min(...g.runs.map((r) => r.created_ms || Infinity));
    if (!Number.isFinite(first)) return g.date || g.label;
    const t = new Date(first);
    const p2 = (n: number) => String(n).padStart(2, "0");
    return `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())} ${p2(t.getHours())}:${p2(t.getMinutes())}`;
  };
  const groupDomains = (g: RunGroup) => new Set(g.runs.flatMap((r) => r.domains.map((d) => d.toLowerCase())));
  const rerunGroup = (g: RunGroup, resume: boolean) => {
    const models = groupModels(g);
    if (models.length === 0) { setErr("This run predates model tracking, so it can't be repeated. Start a new run instead."); return; }
    if (executeRun(models, groupDomains(g), readBatchPresets()[g.key] ?? null, resume && g.isBatch ? g.key : undefined)) go({ kind: "run" });
  };
  const rerunOne = (r: BenchmarkRun) => {
    if (!r.cli) { setErr("This run predates model tracking, so it can't be repeated."); return; }
    if (executeRun([`${r.cli}${MODEL_SEP}${r.model ?? ""}`], new Set(r.domains.map((d) => d.toLowerCase())), null)) go({ kind: "run" });
  };

  // Results
  const groups = useMemo(() => groupRunsByBatch(runs), [runs]);
  const batchPresets = useMemo(readBatchPresets, [runs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [resultTab, setResultTab] = useState<"summary" | "domains" | "questions">("summary");
  useEffect(() => { setResultTab("summary"); }, [sel]);

  // ── Column ─────────────────────────────────────────────────────
  const isSel = (s: ArenaSel) => JSON.stringify(s) === JSON.stringify(sel) && (!phone || picked);
  const rowCls = (on: boolean) => `flex w-full items-center gap-2.5 rounded-lg border-l-2 px-2.5 py-2 text-left transition-colors ${on ? "border-l-accent bg-accent-soft shadow-sm ring-1 ring-accent-border" : "border-l-transparent ring-1 ring-transparent hover:bg-surface-warm"}`;
  const groupHead = (label: string, count: number, action?: React.ReactNode) => (
    <div data-sticky-head className={`flex items-center gap-2 px-2.5 pb-1 pt-4 ${STICKY_GROUP_HEAD} ${phone ? "bg-background" : "spine-sticky-head"}`}>
      <span className="text-[15px] font-semibold text-text-primary">{label}</span>
      <span className="text-[13px] text-text-muted">{count}</span>
      {action && <span className="ml-auto">{action}</span>}
    </div>
  );
  const newPreset = () => { const s = createSuite("New preset"); go({ kind: "preset", id: s.id }); };
  const listEl = (
    <div className="p-2">
      <button data-testid="arena-row-run" aria-current={isSel({ kind: "run" }) ? "true" : undefined} onClick={() => go({ kind: "run" })} className={rowCls(isSel({ kind: "run" }))}>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-background"><Play className="h-3.5 w-3.5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-text-primary">Run a benchmark</span>
          <span className="block truncate text-[12px] text-text-muted">{running.length > 0 ? `${running.length} running now` : "Pick models and domains"}</span>
        </span>
        {running.length > 0 && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />}
      </button>

      <div>
      {groupHead("Presets", presets.length,
        <button onClick={newPreset} data-testid="arena-new-preset" title="New preset" aria-label="New preset" className="rounded-md p-1 text-text-muted hover:bg-surface-warm hover:text-accent"><Plus className="h-4 w-4" /></button>)}
      <div className="space-y-0.5">
        {presets.map((p) => (
          <button key={p.id} data-testid={`arena-row-preset-${p.name}`} onClick={() => go({ kind: "preset", id: p.id })} className={rowCls(isSel({ kind: "preset", id: p.id }))}>
            <Bookmark className="h-4 w-4 shrink-0 text-text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-text-primary">{p.name}</span>
              <span className="block truncate text-[12px] text-text-muted">{p.models.length} model{p.models.length === 1 ? "" : "s"}{p.builtIn ? " · built in" : ""}</span>
            </span>
          </button>
        ))}
        <button onClick={newPreset} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] text-text-muted hover:bg-surface-warm hover:text-accent">
          <Plus className="h-4 w-4 shrink-0" /> New preset
        </button>
      </div>
      </div>

      <div>
      {groupHead("Results", groups.length)}
      <div className="space-y-0.5">
        <button data-testid="arena-row-leaderboard" onClick={() => go({ kind: "board" })} className={rowCls(isSel({ kind: "board" }))}>
          <Crown className="h-4 w-4 shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-text-primary">Leaderboard</span>
            <span className="block truncate text-[12px] text-text-muted">All runs combined</span>
          </span>
        </button>
        {groups.map((g) => {
          const models = new Set(g.runs.map((r) => `${r.cli ?? ""}${r.model ?? ""}${r.cli ? "" : r.label}`)).size;
          const doms = groupDomains(g).size;
          const who = batchPresets[g.key] ?? `${models} model${models === 1 ? "" : "s"}`;
          const date = groupWhen(g);
          return (
            <button key={g.key} data-testid={`arena-row-result-${g.key}`} onClick={() => go({ kind: "result", key: g.key })} className={rowCls(isSel({ kind: "result", key: g.key }))}>
              <TrendingUp className="h-4 w-4 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text-primary">{date}</span>
                <span className="block truncate text-[12px] text-text-muted">{who} · {doms === 0 ? "all domains" : `${doms} domain${doms === 1 ? "" : "s"}`}</span>
              </span>
              {g.best != null && <span className="shrink-0 text-[13px] font-semibold tabular-nums text-accent">{g.best.toFixed(1)}</span>}
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );

  // ── Details ────────────────────────────────────────────────────
  const pad = phone ? "px-4 py-4" : "px-8 py-6";
  const stepHead = (n: number, title: string, right?: React.ReactNode) => (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent">{n}</span>
      <h3 className="text-[15px] font-semibold text-text-primary">{title}</h3>
      {right && <span className="ml-auto">{right}</span>}
    </div>
  );
  const chip = (on: boolean) => `inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[14px] transition-colors ${on ? "border-accent bg-accent-soft font-medium text-accent" : "border-border bg-surface text-text-secondary hover:border-accent-border hover:text-text-primary"}`;

  const runDetail = (
    <div data-testid="arena-run" className={`${pad} space-y-8`}>
      <div>
        <h2 className={DETAIL_TITLE}>Run a benchmark</h2>
        <p className="mt-1 text-[15px] text-text-muted">Your questions go to each model; a judge scores every answer.</p>
      </div>

      <section>
        {stepHead(1, "Models")}
        <div role="tablist" aria-label="How to pick models" className="mb-4 inline-flex rounded-lg bg-surface-warm p-1">
          {([["preset", "Use a preset"], ["custom", "Choose models"]] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={modelMode === id} data-testid={`arena-mode-${id}`} onClick={() => setModelMode(id)}
              className={`inline-flex h-9 items-center rounded-md px-4 text-[14px] ${modelMode === id ? "bg-background font-semibold text-text-primary shadow-sm" : "text-text-muted hover:text-text-secondary"}`}>
              {label}
            </button>
          ))}
        </div>
        {modelMode === "preset" ? (
          presets.length === 0 ? (
            <p className="text-[14px] text-text-muted">No presets yet. Choose models instead, or add a preset from the column.</p>
          ) : (
            <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface">
              {presets.map((p) => {
                const on = runPreset === p.id;
                return (
                  <button key={p.id} type="button" role="radio" aria-checked={on} data-testid={`arena-pick-preset-${p.name}`} onClick={() => setRunPreset(p.id)}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left ${on ? "bg-accent-soft/60" : "hover:bg-surface-warm"}`}>
                    <span className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border ${on ? "border-accent" : "border-border"}`}>
                      {on && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium text-text-primary">{p.name}</span>
                      <span className="mt-0.5 block truncate text-[13px] text-text-muted">{p.models.length === 0 ? "No models yet" : p.models.map(keyLabel).join(", ")}</span>
                    </span>
                    <span className="flex shrink-0 -space-x-1.5 pt-0.5">
                      {Array.from(new Set(p.models.map((k) => k.split(MODEL_SEP)[0]))).slice(0, 4).map((cli) => <ProviderMark key={cli} vendor={cli} size={20} />)}
                    </span>
                  </button>
                );
              })}
            </div>
          )
        ) : (
          <ModelPicker runtimes={runtimes} selected={customModels} onToggle={toggleCustom} />
        )}
      </section>

      <section>
        {stepHead(2, "Domains")}
        {initialDomain ? (
          <p className="text-[14px] text-text-secondary">This run covers {titleCase(initialDomain)}.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={scope.size === 0} data-testid="arena-domain-all" onClick={() => setScope(new Set())} className={chip(scope.size === 0)}>
              All <span className="text-[13px] opacity-70">{activeQuestions.length}</span>
            </button>
            {allDomains.map((d) => {
              const on = scope.has(d.toLowerCase());
              const Icon = domainIcon(d) ?? Circle;
              return (
                <button key={d} type="button" aria-pressed={on} data-testid={`arena-domain-${d}`} onClick={() => toggleScope(d.toLowerCase())} className={chip(on)}>
                  <Icon className="h-3.5 w-3.5" /> {titleCase(d)} <span className="text-[13px] opacity-70">{questionCounts[d.toLowerCase()] ?? 0}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section>
        {stepHead(3, "Run")}
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border-subtle bg-surface px-4 py-4">
          <p data-testid="arena-estimate" className="min-w-0 flex-1 basis-60 text-[15px] text-text-secondary">
            {runModels.length === 0
              ? "Pick at least one model."
              : scopedQuestions.length === 0
                ? "No questions in these domains yet."
                : `${scopedQuestions.length} question${scopedQuestions.length === 1 ? "" : "s"} × ${runModels.length} model${runModels.length === 1 ? "" : "s"} = ${est.answers} answers. Roughly ${fmtEstimateUsd(est.usd)} and ${est.minutes} min.`}
          </p>
          {modelMode === "preset" && presetForRun && !initialDomain && (
            // One click from a preset: every domain, without picking any.
            <button data-testid="arena-run-all-domains" onClick={startRunAllDomains} disabled={runModels.length === 0 || activeQuestions.length === 0}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-border px-4 text-[14px] font-medium text-text-secondary hover:border-accent-border hover:text-accent disabled:cursor-not-allowed disabled:opacity-40">
              <Play className="h-4 w-4" /> Run with all domains
            </button>
          )}
          <button data-testid="arena-run-button" onClick={startRun} disabled={runModels.length === 0 || scopedQuestions.length === 0}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-accent px-5 text-[14px] font-semibold text-background hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40">
            <Play className="h-4 w-4" /> Run
          </button>
        </div>
      </section>

      {allBatches.length > 0 && (
        <section data-testid="arena-progress" className="space-y-3">
          <h3 className="text-[15px] font-semibold text-text-primary">{running.length > 0 ? "Running now" : "Recent runs"}</h3>
          {[...allBatches].reverse().map((b) => (
            <RunningBatchCard key={b.id} batch={b}
              onViewResults={() => go(groups.some((g) => g.key === b.id) ? { kind: "result", key: b.id } : { kind: "board" })}
              onCancel={() => void cancelBenchBatch(b.id)}
              onDismiss={() => dismissBatch(b)} />
          ))}
        </section>
      )}
    </div>
  );

  const presetDetail = (p: PresetView) => {
    const set = new Set(p.models);
    const toggle = (k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); updateSuite(p.id, { models: Array.from(n) }); };
    const duplicate = () => { const s = createSuite(`${p.name} copy`, p.models); go({ kind: "preset", id: s.id }); };
    const remove = () => { deleteSuite(p.id); go({ kind: "run" }); };
    return (
      <div data-testid="arena-preset" className={`${pad} space-y-6`}>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1 basis-64">
            {p.builtIn ? (
              <h2 className={DETAIL_TITLE}>{p.name}</h2>
            ) : (
              <input key={p.id} defaultValue={p.name} aria-label="Preset name" data-testid="arena-preset-name"
                onBlur={(e) => updateSuite(p.id, { name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className={`${DETAIL_TITLE} w-full rounded-md border border-transparent bg-transparent px-1 -mx-1 hover:border-border focus:border-accent-border focus:outline-none`} />
            )}
            <p className="mt-1 text-[15px] text-text-muted">{p.builtIn ? `${p.rationale ?? ""} Built in: it follows the models set up on this Mac.`.trim() : `${p.models.length} model${p.models.length === 1 ? "" : "s"}. Rename it by editing the title.`}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button data-testid="arena-preset-run" onClick={() => { setModelMode("preset"); setRunPreset(p.id); go({ kind: "run" }); }} disabled={p.models.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-background hover:bg-accent-hover disabled:opacity-40">
              <Play className="h-3.5 w-3.5" /> Run this preset
            </button>
            <RowAction icon={Copy} label="Duplicate" onClick={duplicate} testId="arena-preset-duplicate" />
            {!p.builtIn && <RowAction icon={Trash2} label="Delete preset" onClick={remove} testId="arena-preset-delete" />}
          </div>
        </div>

        <section>
          <h3 className="mb-3 text-[15px] font-semibold text-text-primary">Models</h3>
          {p.models.length === 0 ? (
            <p className="text-[14px] text-text-muted">No models yet. Add some below.</p>
          ) : (
            <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface">
              {p.models.map((k) => {
                const cli = k.split(MODEL_SEP)[0];
                return (
                  <div key={k} className="flex items-center gap-3 px-4 py-2.5">
                    <ProviderMark vendor={cli} size={22} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] text-text-primary">{keyLabel(k)}</span>
                      <span className="block truncate text-[13px] text-text-muted">{runtimeLabel(cli)}</span>
                    </span>
                    {!p.builtIn && <RowAction icon={X} label={`Remove ${keyLabel(k)}`} onClick={() => toggle(k)} />}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {p.builtIn ? (
          <p className="text-[14px] text-text-muted">Built-in presets can't be edited. Duplicate this one to make your own.</p>
        ) : (
          <section>
            <h3 className="mb-3 text-[15px] font-semibold text-text-primary">Add models</h3>
            <ModelPicker runtimes={runtimes} selected={set} onToggle={toggle} testId="arena-preset-picker" />
          </section>
        )}
      </div>
    );
  };

  const tabsEl = (tabs: { id: "summary" | "domains" | "questions"; label: string }[]) => (
    <div className={phone ? "px-4" : "flex px-8"}>
      <SpineTabs tabs={tabs} value={resultTab} onChange={setResultTab} label="Result views" />
    </div>
  );
  const results = (rs: BenchmarkRun[], mx: MatrixRow[], filter: string) => (
    <BenchResults
      view={resultTab === "domains" ? "matrix" : "board"}
      domainFilter={filter}
      runs={rs} matrix={mx} allDomains={allDomains} vaultPath={vaultPath}
      initialModel={initialModel} currentDomain={initialDomain} onChanged={refresh}
      onRerun={rerunOne}
    />
  );

  const boardDetail = (
    <div data-testid="arena-board" className="space-y-5 pb-6">
      <div className={phone ? "px-4 pt-4" : "px-8 pt-6"}>
        <h2 className={DETAIL_TITLE}>Leaderboard</h2>
        <p className="mt-1 text-[15px] text-text-muted">Every run combined{initialDomain ? `, in ${titleCase(initialDomain)}` : ""}: each model at its best score.</p>
      </div>
      {tabsEl([{ id: "summary", label: "Summary" }, { id: "domains", label: "By domain" }, { id: "questions", label: "Questions" }])}
      {resultTab === "questions"
        ? <BenchQuestions vaultPath={vaultPath} questions={questions} allDomains={allDomains} initialDomain={initialDomain} onChanged={refresh} />
        : results(runs, matrix, initialDomain ? initialDomain.toLowerCase() : "all")}
    </div>
  );

  const resultDetail = (key: string) => {
    const g = groups.find((x) => x.key === key);
    if (!g) {
      const live = allBatches.find((b) => b.id === key);
      return (
        <div data-testid="arena-result" className={pad}>
          <p className="text-[15px] text-text-muted">{live?.running ? "This run is still going." : "Loading this run's results."}</p>
        </div>
      );
    }
    const dirs = new Set(g.runs.map((r) => r.run_dir));
    const doms = groupDomains(g);
    const unscored = g.runs.filter((r) => !r.scored).length;
    const qs = Math.max(0, ...g.runs.map((r) => r.questions));
    return (
      <div data-testid="arena-result" className="space-y-5 pb-6">
        <div className={`flex flex-wrap items-start gap-3 ${phone ? "px-4 pt-4" : "px-8 pt-6"}`}>
          <div className="min-w-0 flex-1 basis-64">
            <h2 className={DETAIL_TITLE}>{groupWhen(g)}</h2>
            <p className="mt-1 text-[15px] text-text-muted">
              {batchPresets[g.key] ? `${batchPresets[g.key]} · ` : ""}{g.runs.length} model{g.runs.length === 1 ? "" : "s"} · {doms.size === 0 ? "all domains" : Array.from(doms).map(titleCase).join(", ")} · {qs} question{qs === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {unscored > 0 && g.isBatch && (
              <button onClick={() => rerunGroup(g, true)} title="Finish the questions still missing, then score. Answers already in are kept."
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-accent-border px-3 text-[13px] font-medium text-accent hover:bg-accent-soft">
                <RotateCw className="h-3.5 w-3.5" /> Continue
              </button>
            )}
            <button data-testid="arena-result-rerun" onClick={() => rerunGroup(g, false)} title="Run the same models on the same domains again"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-text-secondary hover:border-accent-border hover:text-accent">
              <RotateCw className="h-3.5 w-3.5" /> Run again
            </button>
          </div>
        </div>
        {tabsEl([{ id: "summary", label: "Summary" }, { id: "domains", label: "By domain" }])}
        {results(g.runs, matrix.filter((m) => dirs.has(m.run_dir)), "all")}
      </div>
    );
  };

  const presetSel = sel.kind === "preset" ? presets.find((p) => p.id === sel.id) : undefined;
  const detail = (
    <>
      {err && <div className={`${phone ? "mx-4" : "mx-8"} mt-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn`}>{err}</div>}
      {sel.kind === "run" && runDetail}
      {sel.kind === "preset" && (presetSel ? presetDetail(presetSel) : runDetail)}
      {sel.kind === "board" && boardDetail}
      {sel.kind === "result" && resultDetail(sel.key)}
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="arena-page">
      <SettingsHeader title="Arena" icon={Swords} subtitle="Run your questions past several models and keep score."
          right={
            <button onClick={() => go({ kind: "run" })} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-background hover:bg-accent-hover">
              <Play className="h-3.5 w-3.5" /> Run a benchmark
            </button>
          } />
      <div className="flex min-h-0 flex-1">
        <SideSpine storageKey="prevail.arena.spine" title={initialDomain ? `Arena · ${titleCase(initialDomain)}` : "Arena"} label="Arena" testId="arena-nav"
          phone={phone} phoneDetail={phone && picked} onBack={() => setPicked(false)} backLabel="Arena"
          detail={detail}>
          {listEl}
        </SideSpine>
      </div>
    </div>
  );
}
