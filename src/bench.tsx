// Subsystem extracted from App.tsx (encapsulated module state).
import { useEffect, useState } from "react";
import { invoke, listen } from "./bridge";
import { MODELS } from "./constants";
import { titleCase } from "./format";
import { isLocalCli } from "./helpers";
import { track } from "./telemetry";
import type { BenchBatch, BenchJob, BenchJobStatus, BenchQuestion, BenchmarkRun } from "./types";
import type { UnlistenFn } from "./bridge";

export const BENCH_CLI_OPTIONS = [
  { id: "claude",      label: "Claude" },
  { id: "codex",       label: "Codex" },
  { id: "antigravity", label: "Antigravity" },
  { id: "openrouter",  label: "OpenRouter" },
  { id: "ollama",      label: "Ollama" },
] as const;

// ─────────────────────────────────────────────────────────────────────
// BENCHMARK PAGE - run (multi-model, per-domain or global), results
// (by-model leaderboard + model×domain effectiveness matrix), and a
// questions manager. Replaces the old leaderboard+popup. No modals.




// ── Global benchmark-run registry ───────────────────────────────────────────
// A benchmark is a set of engine processes that outlive any one view. This
// module-scope store is the single source of truth for every live run, so
// domain switches, settings navigation, or panel remounts never lose one.
// Panels and the sidebar subscribe via useBenchBatches(); cancelBenchBatch
// signals the engine processes through abort_sessions.

export const benchBatches = new Map<string, BenchBatch>();

export const benchSubs = new Set<() => void>();

export function benchNotify() {
  for (const f of benchSubs) f();
}

export function useBenchBatches(): BenchBatch[] {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    benchSubs.add(f);
    return () => {
      benchSubs.delete(f);
    };
  }, []);
  return Array.from(benchBatches.values());
}

export function benchPatchJob(b: BenchBatch, key: string, patch: Partial<BenchJob>) {
  b.jobs = b.jobs.map((j) => (j.key === key ? { ...j, ...patch } : j));
  benchNotify();
}

export async function cancelBenchBatch(id: string) {
  const b = benchBatches.get(id);
  if (!b || !b.running) return;
  b.cancelled = true;
  b.jobs = b.jobs.map((j) =>
    j.status === "done" || j.status === "error" ? j : { ...j, status: "cancelled" as BenchJobStatus },
  );
  benchNotify();
  // SIGTERM every engine process of this batch; their benchmark:done events
  // unwind the awaits inside executeBenchBatch.
  await Promise.all(b.sessions.map((s) => invoke("abort_sessions", { prefix: s }).catch(() => {})));
}
// Wait for one benchmark:done (matched by session+phase), folding raw chunks
// into the batch's engine log along the way.

// Resolved code when a phase exceeds its watchdog without a `benchmark:done`
// event. Distinct from a real exit code so callers can mark the job timed-out
// instead of silently treating it as success. Without this, a dropped done
// event (engine crash, killed process, lost IPC) hangs the whole batch forever.
export const BENCH_TIMEOUT = -1000;

export function benchWaitDone(b: BenchBatch, session: string, phase: string, timeoutMs?: number) {
  return new Promise<number | null>((resolve) => {
    let unlisten: UnlistenFn | null = null;
    let chunkUn: UnlistenFn | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelPoll: ReturnType<typeof setInterval> | null = null;
    const cleanup = () => { unlisten?.(); chunkUn?.(); if (timer) clearTimeout(timer); if (cancelPoll) clearInterval(cancelPoll); };
    listen<{ session: string; code: number | null; phase: string }>("benchmark:done", (e) => {
      if (e.payload.session === session && e.payload.phase === phase) {
        cleanup();
        resolve(e.payload.code);
      }
    }).then((u) => {
      unlisten = u;
      // If the batch was already cancelled/torn down before the listener
      // attached, don't leak it.
      if (b.cancelled) { cleanup(); resolve(BENCH_TIMEOUT); }
    });
    // Cancel must unstick an in-flight wait immediately: if the engine never
    // emits `done` (a hung model call), the only way out otherwise is the long
    // watchdog. Poll the batch's cancelled flag so Cancel finalizes right away.
    cancelPoll = setInterval(() => { if (b.cancelled) { cleanup(); resolve(BENCH_TIMEOUT); } }, 400);
    listen<{ session: string; data: string }>("benchmark:chunk", (e) => {
      if (e.payload.session === session) {
        b.log = (b.log + e.payload.data).slice(-8000);
        benchNotify();
      }
    }).then((u) => {
      chunkUn = u;
    });
    // Watchdog: never wait forever on a phase that may never emit `done`.
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => { cleanup(); resolve(BENCH_TIMEOUT); }, timeoutMs);
    }
  });
}

// ── AI question-suggestion registry ─────────────────────────────────────────
// "Suggest with AI" (question drafting) is a long-running engine call that must
// outlive the Questions panel. Mirroring benchBatches, this module-scope store
// is the single source of truth for every in-flight (and finished) suggest job,
// so navigating away from Arena and back never drops one. Panels subscribe via
// useQuestionSuggest(); startQuestionSuggest() runs the engine call from module
// scope with module-scope event listeners, so nothing is tied to a component.

export type QSuggestJob = {
  id: string;
  vault: string;
  domain: string;
  status: "running" | "done" | "error";
  added?: number;
  error?: string;
  tail?: string;
  startedTs: number;
};

// Keyed by vault + "|" + domain: "all domains" runs one job per domain, and
// re-starting a domain replaces its prior (finished) job in place.
const qSuggestJobs = new Map<string, QSuggestJob>();

function qSuggestKey(vault: string, domain: string) {
  return `${vault}|${domain.toLowerCase()}`;
}

function qSuggestNotify() {
  window.dispatchEvent(new Event("prevail:qsuggest-changed"));
}

// Subscribe hook: re-renders on prevail:qsuggest-changed and returns the current
// jobs. Mirrors useBenchBatches (which re-renders through benchSubs); here the
// window event is the notification channel so any mounted panel stays in sync.
/// Pull the DIAGNOSIS out of the engine's output.
///
/// The engine prints the useful line first and a summary last:
///
///     failed: career: nothing to draft from (no state, goals, config, ...)
///     no questions drafted
///
/// and this used to take the LAST line, so every failure reported "no
/// questions drafted", a message that tells you to fix something without
/// saying what. The reason was computed, printed, and thrown away one line
/// from the end.
export function suggestFailureReason(output: string): string {
  const lines = output.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  // The engine's per-domain diagnosis, newest last. "failed: <domain>: <why>"
  //, drop the prefix and the domain, which the UI already names.
  const failed = lines.filter((l) => l.toLowerCase().startsWith("failed:")).pop();
  if (failed) {
    const rest = failed.slice("failed:".length).trim();
    const colon = rest.indexOf(":");
    return (colon > 0 ? rest.slice(colon + 1).trim() : rest) || rest;
  }
  // Otherwise the last line that is not the summary, which says nothing.
  const summaries = ["no questions drafted"];
  const last = lines.filter((l) => !summaries.includes(l.toLowerCase())).pop();
  return last || "the drafting model returned nothing usable (check the model is installed and signed in)";
}

export function useQuestionSuggest(): QSuggestJob[] {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    window.addEventListener("prevail:qsuggest-changed", f);
    return () => window.removeEventListener("prevail:qsuggest-changed", f);
  }, []);
  return Array.from(qSuggestJobs.values());
}

// MODULE-SCOPE runner: draft `count` questions for ONE domain via the engine's
// `benchmark_suggest`. Everything (invoke + streaming listeners + recount) lives
// here, not in a component, so an unmount of the Questions panel cannot drop it.
// Guards against double-starting the same vault+domain while one is running.
export async function startQuestionSuggest({
  vault, domain, count, cli, model,
}: {
  vault: string;
  domain: string;
  count: number;
  cli: string;
  model?: string | null;
}): Promise<void> {
  const target = domain.toLowerCase();
  const key = qSuggestKey(vault, target);
  const existing = qSuggestJobs.get(key);
  if (existing && existing.status === "running") return; // already in flight

  // Count from disk, not stale React state, so the "added" delta is honest.
  let before = 0;
  try {
    const pre = await invoke<BenchQuestion[]>("benchmark_questions", { vault });
    before = (pre ?? []).filter((q) => q.domain === target).length;
  } catch { /* fall back to before = 0; exit code still drives success */ }

  const session = `bench-suggest-${target}-${Date.now()}`;
  const job: QSuggestJob = { id: session, vault, domain: target, status: "running", startedTs: Date.now() };
  qSuggestJobs.set(key, job);
  qSuggestNotify();

  // Module-scope streaming + completion listeners (not component-scoped).
  let output = "";
  let chunkUn: UnlistenFn | null = null;
  listen<{ session: string; data: string }>("benchmark:chunk", (e) => {
    if (e.payload.session === session) {
      output = (output + e.payload.data).slice(-2000);
      job.tail = output.trim().split("\n").filter(Boolean).slice(-2).join(" / ");
      qSuggestNotify();
    }
  }).then((u) => { chunkUn = u; });

  const done = new Promise<number | null>((resolve) => {
    let un: UnlistenFn | null = null;
    listen<{ session: string; code: number | null; phase: string }>("benchmark:done", (e) => {
      if (e.payload.session === session && e.payload.phase === "suggest") { un?.(); resolve(e.payload.code); }
    }).then((u) => { un = u; });
  });

  try {
    await invoke("benchmark_suggest", {
      args: { session_id: session, vault, domain: target, count, cli, model: model || null },
    });
    const code = await done;
    (chunkUn as UnlistenFn | null)?.();
    // Let the engine flush new questions to disk before recounting.
    await new Promise((r) => setTimeout(r, 150));
    let added = 0;
    try {
      const fresh = await invoke<BenchQuestion[]>("benchmark_questions", { vault });
      added = (fresh ?? []).filter((q) => q.domain === target).length - before;
    } catch { /* counting is best-effort; exit code still drives success */ }
    if (code === 0 || code === null) {
      job.status = "done";
      job.added = added > 0 ? added : 0;
    } else {
      job.status = "error";
      job.error = suggestFailureReason(output);
    }
  } catch (e) {
    (chunkUn as UnlistenFn | null)?.();
    job.status = "error";
    job.error = String(e);
  }
  qSuggestNotify();
  // Tell any mounted questions panel to reload its list, whether or not the user
  // is currently looking at it, so completed drafts appear on return.
  window.dispatchEvent(new Event("prevail:questions-changed"));
}

// Scheduled benchmark runs were retired in 0.4.1 with the Schedule page. Saved
// schedule entries (prevail.bench.schedules and the older
// prevail.bench.schedule.* keys) stay in storage untouched, but nothing fires
// them any more.

// Run a batch of benchmark jobs to completion (all jobs in parallel, then one
// scoring pass). Lives at module scope, mutating the registry - NOT component
// state - so the run survives whatever the user navigates to.

export async function executeBenchBatch(
  vault: string,
  plannedJobs: BenchJob[],
  councilMode: boolean,
  scopeStr: string,
  // CONTINUE/RESUME. When set, reuse this batch id (instead of minting a fresh
  // one) so the engine resumes INTO the existing run directories: it skips the
  // questions each model already answered and re-runs only the missing/errored
  // ones. Persisted answers are never regenerated, questions are never
  // recreated. Omit for a brand-new batch.
  resumeBatchId?: string,
): Promise<void> {
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, "0");
  // Numeric, sortable stamp: YYYY-MM-DD HH:MM (no spelled-out month).
  const dateLabel = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
  const hhmm = `${p2(now.getHours())}:${p2(now.getMinutes())}`;
  const batchId = resumeBatchId ?? `b${now.getTime()}`;
  // T18 (inert until keys exist; default-OFF, allowlist-scrubbed to counts only -
  // no model ids, no domain names, no question text).
  track("benchmark_run", { models: plannedJobs.length, domains: scopeStr ? scopeStr.split(",").filter(Boolean).length : 0 });
  const scopeDomains = scopeStr ? scopeStr.split(",").map((d) => titleCase(d.trim())).filter(Boolean) : [];
  const scopeLabel =
    scopeDomains.length === 0 ? "All domains"
    : scopeDomains.length <= 2 ? scopeDomains.join(", ")
    : `${scopeDomains.length} domains`;
  // Compact model label: "Claude Opus 4.7" instead of "Claude · Opus (latest)"
  const shortModel = (j: BenchJob) =>
    `${titleCase(j.cli)} ${(MODELS[j.cli]?.find((m) => m.id === j.model)?.label ?? j.model).replace(/\s*\(.*?\)/, "")}`.trim();
  const modelPart = plannedJobs.length === 1 ? shortModel(plannedJobs[0]) : `${plannedJobs.length} models`;
  // Numeric, sortable, compact label leading with the timestamp, then what was
  // tested. No spelled-out month, minimal punctuation.
  //   "2026-06-19 14:52 · Wealth · 4 models"
  //   "2026-06-19 14:52 · 3 domains · Claude Opus 4.8"
  const batchLabel = `${dateLabel} ${hhmm} · ${scopeLabel} · ${modelPart}`;
  // Drop stale finished batches so the registry never accumulates.
  for (const [k, v] of benchBatches) if (!v.running && v.consumed) benchBatches.delete(k);
  const batch: BenchBatch = {
    id: batchId,
    label: batchLabel,
    scopeLabel,
    scopeKey: scopeStr.toLowerCase(),
    scopeDomains,
    vault,
    councilMode,
    jobs: plannedJobs,
    running: true,
    log: "",
    sessions: [],
    cancelled: false,
    consumed: false,
  };
  benchBatches.set(batchId, batch);
  benchNotify();

  // Run one job: start the model, track per-question progress from its
  // output stream, wait for it, mark scoring.
  const runOne = async (job: BenchJob) => {
    if (batch.cancelled) return;
    benchPatchJob(batch, job.key, { status: "running" });
    const session = `bench-${job.key.replace(/[^a-z0-9]/gi, "")}-${Date.now()}`;
    batch.sessions.push(session);
    // The engine prints one "  <id>… <result>" line per finished question;
    // recount completed lines on every chunk for a live progress bar.
    let buf = "";
    const chunkUnlisten = listen<{ session: string; data: string }>("benchmark:chunk", (e) => {
      if (e.payload.session !== session) return;
      buf += e.payload.data;
      // The CLI emits one "> <id>" line when a question STARTS and one
      // "  <id>… <info>" line when it FINISHES. Count completions for the bar;
      // surface the most recent start (not yet finished) as the live question so
      // the run never looks frozen while a slow model is answering.
      const qdone: Record<string, string> = {};
      let lastStart: string | undefined;
      for (const line of buf.split("\n")) {
        const done = line.match(/^ {2}(\S+)…\s*(.+)$/);
        if (done) { qdone[done[1]] = done[2].trim(); continue; }
        const start = line.match(/^> (\S+)/);
        if (start) lastStart = start[1];
      }
      benchPatchJob(batch, job.key, {
        done: Math.min(Object.keys(qdone).length, job.total),
        qdone,
        qcur: lastStart && !qdone[lastStart] ? lastStart : undefined,
      });
    });
    try {
      await invoke("benchmark_start", {
        args: {
          session_id: session,
          vault,
          cli: job.cli || "claude",
          model: job.model || null,
          council: councilMode,
          domain: scopeStr || null,
          batch_id: batchId,
          batch_label: batchLabel,
        },
      });
      // Watchdog: a single model's run shouldn't be able to hang the batch, but
      // the ceiling must SCALE with how many questions the model answers - a flat
      // 20 minutes would wrongly kill a legitimately-progressing large run (100
      // questions at ~40-60s each is well past 20 min). Budget generously per
      // question on top of a floor, capped so a truly stuck run still unwinds.
      // Because answers now persist incrementally, even a watchdog kill loses no
      // completed work: Continue resumes from what landed on disk.
      const qCount = Math.max(1, job.qids.length || job.total || 1);
      const runWatchdogMs = Math.min(6 * 60 * 60_000, 5 * 60_000 + qCount * 3 * 60_000);
      const code = await benchWaitDone(batch, session, "run", runWatchdogMs);
      if (batch.cancelled) return; // statuses already set by cancelBenchBatch
      if (code === BENCH_TIMEOUT) {
        // Not necessarily lost: partial answers are on disk. Mark it errored so
        // the user can Continue the batch to finish the remaining questions.
        benchPatchJob(batch, job.key, { status: "error", note: "timed out - continue to resume" });
        return;
      }
      if (code !== 0 && code !== null) {
        benchPatchJob(batch, job.key, { status: "error", note: `exit ${code}` });
        return;
      }
      benchPatchJob(batch, job.key, { status: "scoring", done: job.total });
    } catch (e) {
      benchPatchJob(batch, job.key, { status: "error", note: String(e) });
    } finally {
      void chunkUnlisten.then((u) => u());
    }
  };

  try {
    // Bounded concurrency so a big multi-model run can't exhaust memory and trip
    // the memory watchdog (which would SIGKILL the largest model mid-run). Each
    // job is its own engine + model process; local models (Ollama / LM Studio /
    // MLX) are the memory hogs - a single one can be several GB - so we run at
    // most ONE local model at a time, and cap the overall pool too. Cloud models
    // (thin API-backed CLIs) are cheap, so the pool still keeps the run fast.
    // Running all N at once (the old behavior) is what pushed a 16 GB Mac past
    // the ~65%-RAM kill line with 13 models.
    const MAX_CONCURRENT = 4;
    let localBusy = false;
    const pending = [...plannedJobs];
    const worker = async (): Promise<void> => {
      while (!batch.cancelled) {
        // Pick the next job we're allowed to start: any cloud job, or a local
        // job only when no local model is currently running.
        const idx = pending.findIndex((j) => !isLocalCli(j.cli) || !localBusy);
        if (idx === -1) {
          if (pending.length === 0) return; // nothing left this worker can take
          await new Promise((r) => setTimeout(r, 250)); // only local jobs left + one busy
          continue;
        }
        const job = pending.splice(idx, 1)[0]!;
        const local = isLocalCli(job.cli);
        if (local) localBusy = true;
        try { await runOne(job); }
        finally { if (local) localBusy = false; }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT, plannedJobs.length) }, worker),
    );
    if (!batch.cancelled) {
      // Score ONLY this batch's runs (fast) - not every historical run, which
      // would re-score dozens of old runs and stall the fresh scores from landing.
      // Scoring used to be one attempt behind a flat ten-minute watchdog, and
      // a timeout was swallowed and every job marked "done" regardless. A
      // twelve-model, twenty-six-domain batch cannot judge in ten minutes, so
      // the common outcome was exactly the expensive one: answers paid for,
      // no scores, and a batch claiming success.
      //
      // Now the budget scales with the work, the pass is retried, and each
      // attempt is checked against the runs actually on disk - so a partial
      // judge pass resumes instead of starting over, and the batch only
      // reports scored when the runs really are.
      const unscoredInBatch = async (): Promise<number> => {
        const runs = await invoke<BenchmarkRun[]>("benchmark_runs", { vault }).catch(() => [] as BenchmarkRun[]);
        return runs.filter((r) => r.batch_id === batchId
          && (r.judge_avg === null || r.judge_avg === undefined)).length;
      };
      // ~40s of judging per planned run, floored at 10 min and capped at 2 h.
      const scoreBudgetMs = Math.min(2 * 60 * 60_000, Math.max(10 * 60_000, plannedJobs.length * 40_000));
      const SCORE_ATTEMPTS = 3;
      // A failed read must never be read as "nothing left to score" - that
      // would skip the judge pass altogether. The first attempt always runs;
      // the disk check only decides whether to go round again.
      let leftUnscored = await unscoredInBatch();
      for (let attempt = 1;
           attempt <= SCORE_ATTEMPTS && (attempt === 1 || leftUnscored > 0) && !batch.cancelled;
           attempt++) {
        const scoreSession = `bench-score-${Date.now()}-${attempt}`;
        batch.sessions.push(scoreSession);
        try {
          await invoke("benchmark_score", { args: { session_id: scoreSession, vault, batch: batchId } });
          await benchWaitDone(batch, scoreSession, "score", scoreBudgetMs);
        } catch { /* fall through to the disk check, then retry */ }
        const before = leftUnscored;
        leftUnscored = await unscoredInBatch();
        if (leftUnscored === 0) break;
        // A pass that scored nothing at all will not do better on a third try;
        // stop and say so rather than burning the clock.
        if (attempt > 1 && leftUnscored >= before) break;
      }
      if (!batch.cancelled) {
        // Runs that completed move to done; a run still "running" at this point
        // never reported done (timed out) - mark it errored, not stuck-scoring.
        // When judging did not finish, say that on the job instead of "done",
        // so the batch never claims a score it does not have.
        const judgeIncomplete = leftUnscored > 0;
        batch.jobs = batch.jobs.map((j) =>
          j.status === "scoring"
            ? (judgeIncomplete
                ? { ...j, status: "done" as const, note: j.note ?? `${leftUnscored} run${leftUnscored === 1 ? "" : "s"} still unscored` }
                : { ...j, status: "done" as const })
          : j.status === "running" ? { ...j, status: "error" as const, note: j.note ?? "timed out" }
          : j,
        );
      }
    }
  } finally {
    batch.running = false;
    benchNotify();
  }
}
