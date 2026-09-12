// Small prop-driven UI cards extracted from App.tsx: the sidebar's running-
// benchmark progress strip, the framework/lens cycle row, and the Settings
// scheduled-benchmark card.
import { useEffect, useState } from "react";
import { Activity, Archive, CalendarClock, Loader2, X } from "lucide-react";
import { useProcesses } from "./processes";
import { BACKUP_CFG } from "./backup";
import { lsGet } from "./storage";
import { benchFreqLabel, BENCH_SCHED, cancelBenchBatch, useBenchBatches } from "./bench";

// BENCH-1: a persistent indicator that a benchmark is ARMED to run on a
// schedule (distinct from one actively running - SidebarBenchmarkRuns owns
// that). The founder must never have a nightly benchmark running without being
// aware of it. Mirrors the SidebarMcpLive / SidebarGatewayLive "live" pattern,
// but with a steady (non-pulsing) dot + calendar icon to read as "armed".
// P2: a live "N processes" indicator. Lists every long-running thing (chat,
// council, benchmark, loop) so the user can see work continuing while they move
// around, and click to jump back to it.
export function SidebarProcesses({ collapsed, setTab }: { collapsed: boolean; setTab?: (t: "chat" | "council" | "benchmark" | "settings") => void }) {
  const procs = useProcesses();
  if (procs.length === 0) return null;
  const n = procs.length;
  const jump = (p: { kind: string; domain?: string | null }) => {
    if (p.kind === "council") setTab?.("council");
    else if (p.kind === "benchmark") setTab?.("benchmark");
    else if ((p.kind === "loop" || p.kind === "audit") && p.domain) window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: p.domain }));
    else setTab?.("chat");
  };
  if (collapsed) {
    return (
      <div title={`${n} process${n === 1 ? "" : "es"} running`} className="flex w-full flex-col items-center gap-0.5 border-t border-border-subtle px-2 py-2 text-accent">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="font-mono text-[10px]">{n}</span>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-warm/40 p-2.5">
      <div className="mb-1.5 flex items-center gap-2 px-0.5">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
        <span className="flex-1 text-[13px] font-medium text-text-primary">{n} process{n === 1 ? "" : "es"} running</span>
        <Activity className="h-3.5 w-3.5 shrink-0 text-text-muted" />
      </div>
      <div className="flex flex-col gap-0.5">
        {procs.slice(0, 4).map((p) => (
          <button key={p.id} onClick={() => jump(p)} title="Jump to this process" className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-background">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span className="flex-1 truncate text-[12px] text-text-secondary group-hover:text-text-primary">{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function SidebarBenchScheduled({ collapsed }: { collapsed: boolean }) {
  const [on, setOn] = useState(() => lsGet(BENCH_SCHED.enabled, "0") === "1");
  const [freq, setFreq] = useState(() => lsGet(BENCH_SCHED.freq, "weekly") || "weekly");
  const running = useBenchBatches().some((b) => b.running);
  useEffect(() => {
    const sync = () => { setOn(lsGet(BENCH_SCHED.enabled, "0") === "1"); setFreq(lsGet(BENCH_SCHED.freq, "weekly") || "weekly"); };
    window.addEventListener("prevail:bench-sched", sync);
    const id = window.setInterval(sync, 30_000);
    return () => { window.removeEventListener("prevail:bench-sched", sync); window.clearInterval(id); };
  }, []);
  if (!on || running) return null; // a live run already shows in SidebarBenchmarkRuns
  const open = () => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "benchmark" }));
  const title = `A benchmark is scheduled to run ${benchFreqLabel(freq)} in the background. Click for Benchmark settings.`;
  if (collapsed) {
    return (
      <button onClick={open} title={title} className="flex w-full justify-center border-t border-border-subtle px-2 py-2 text-text-muted hover:text-accent">
        <CalendarClock className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <button onClick={open} title={title} className="group flex w-full items-center gap-2.5 rounded-xl border border-border-subtle bg-surface-warm/40 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-surface-warm">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <CalendarClock className="h-3.5 w-3.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[13px] font-medium text-text-primary">Benchmark scheduled</span>
        <span className="truncate font-mono text-[10px] text-text-muted">{benchFreqLabel(freq)}</span>
      </span>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
    </button>
  );
}

// W2 (Monday feedback): a clear sidebar indicator when automatic backups are ON,
// so the user always knows their vault is being snapshotted. Same pattern as the
// scheduled-benchmark indicator.
export function SidebarBackupActive({ collapsed }: { collapsed: boolean }) {
  const [on, setOn] = useState(() => lsGet(BACKUP_CFG.enabled, "0") === "1");
  const [freq, setFreq] = useState(() => lsGet(BACKUP_CFG.freq, "weekly") || "weekly");
  useEffect(() => {
    const sync = () => { setOn(lsGet(BACKUP_CFG.enabled, "0") === "1"); setFreq(lsGet(BACKUP_CFG.freq, "weekly") || "weekly"); };
    window.addEventListener("prevail:backup-done", sync);
    const id = window.setInterval(sync, 30_000);
    return () => { window.removeEventListener("prevail:backup-done", sync); window.clearInterval(id); };
  }, []);
  if (!on) return null;
  const label = /^custom:/.test(freq) ? "every N days" : freq;
  const open = () => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "workspace" }));
  const title = `Automatic vault backups are ON (${label}). Click for Workspace.`;
  if (collapsed) {
    return (
      <button onClick={open} title={title} className="flex w-full justify-center border-t border-border-subtle px-2 py-2 text-text-muted hover:text-accent">
        <Archive className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <button onClick={open} title={title} className="group flex w-full items-center gap-2.5 rounded-xl border border-border-subtle bg-surface-warm/40 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-surface-warm">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-ok/12 text-ok">
        <Archive className="h-3.5 w-3.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[13px] font-medium text-text-primary">Automatic backups</span>
        <span className="truncate font-mono text-[10px] text-text-muted">{label}</span>
      </span>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
    </button>
  );
}

export function SidebarBenchmarkRuns({ collapsed }: { collapsed: boolean }) {
  const runningBatches = useBenchBatches().filter((b) => b.running);
  if (runningBatches.length === 0) return null;
  if (collapsed) {
    return (
      <div
        className="flex items-center justify-center gap-1 border-t border-border-subtle px-2 py-2"
        title={runningBatches.map((b) => `Benchmarking ${b.scopeLabel}`).join("\n")}
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
        </span>
        {runningBatches.length > 1 && (
          <span className="font-mono text-[10px] text-accent">{runningBatches.length}</span>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {runningBatches.map((b) => {
        const done = b.jobs.reduce(
          (a, j) => a + (j.status === "done" || j.status === "scoring" ? j.total : j.done),
          0,
        );
        const total = b.jobs.reduce((a, j) => a + j.total, 0);
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        return (
          <div key={b.id} className="rounded-xl border border-border-subtle bg-surface-warm/40 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              <span
                className="flex-1 truncate text-[13px] font-medium text-text-primary"
                title={b.label}
              >
                {b.scopeLabel}
              </span>
              <button
                onClick={() => void cancelBenchBatch(b.id)}
                title="Cancel this benchmark run"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-strong hover:text-err"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border-subtle">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
                  style={{ width: `${pct}%` }}
                >
                  <div className="h-full w-full animate-pulse rounded-full bg-accent/40" />
                </div>
              </div>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-muted">
                {done}/{total}
              </span>
              <span className="shrink-0 font-mono text-[10px] font-semibold tabular-nums text-accent">
                {pct}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
