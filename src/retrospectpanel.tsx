// Retrospect — where your attention went, over time. A cross-domain read-over of
// every prompt the user typed, in every AI tool (retrospect_rollup, served by the
// engine's cleaned corpus). Two lenses on one data source:
//   Time      a vantage switch (day/week/month/year), a spine of periods, and per
//             period the projects and domains attention went to, plus the threads.
//   Projects  what those prompts were building, each with a replay brief a newer
//             model can rebuild it from, and recommendations across all of it
//             (projectsview.tsx).
import { useEffect, useMemo, useState } from "react";
import { CalendarRange, FolderKanban, History, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { ProjectsView } from "./projectsview";

type Vantage = "day" | "week" | "month" | "year";
interface Thread { domain: string; project?: string; message: string; ts: number; count: number }
interface DomCount { domain: string; count: number }
interface ProjCount { slug: string; title: string; domain: string; count: number }
interface Period { key: string; label: string; total: number; byDomain: DomCount[]; byProject?: ProjCount[]; threads: Thread[] }
interface Rollup { vantage: string; periods: Period[] }

// A small warm palette; a domain always maps to the same color (stable hash).
const PALETTE = ["#e0913f", "#7ba0c4", "#6fb0a6", "#c98a8a", "#66a67e", "#a98fc4", "#d0a94e", "#8aa0b8"];
function domColor(d: string): string {
  let h = 0;
  for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const VANTAGES: { id: Vantage; label: string }[] = [
  { id: "day", label: "Day" }, { id: "week", label: "Week" }, { id: "month", label: "Month" }, { id: "year", label: "Year" },
];

export function RetrospectPanel({ vaultPath }: { vaultPath: string }) {
  const [lens, setLens] = useState<"time" | "projects">(() => {
    try { return localStorage.getItem("prevail.retrospect.lens") === "projects" ? "projects" : "time"; } catch { return "time"; }
  });
  const pickLens = (l: "time" | "projects") => { setLens(l); try { localStorage.setItem("prevail.retrospect.lens", l); } catch { /* storage off */ } };
  const [vantage, setVantage] = useState<Vantage>("month");
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);
  const [spineCollapsed, setSpineCollapsed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    invoke<Rollup>("retrospect_rollup", { vault: vaultPath, vantage, tzOffsetMinutes: new Date().getTimezoneOffset() })
      .then((raw) => {
        if (!alive) return;
        // An engine that answers with anything but a rollup reads as "nothing yet".
        const r = raw && Array.isArray(raw.periods) ? raw : { vantage, periods: [] };
        setRollup(r);
        setSelKey((cur) => r.periods.some((p) => p.key === cur) ? cur : (r.periods[0]?.key ?? null));
      })
      .catch(() => { if (alive) setRollup({ vantage, periods: [] }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [vaultPath, vantage]);

  const sel = useMemo(() => rollup?.periods.find((p) => p.key === selKey) ?? rollup?.periods[0] ?? null, [rollup, selKey]);
  const maxTotal = useMemo(() => Math.max(1, ...(rollup?.periods.map((p) => p.total) ?? [1])), [rollup]);
  const domains = sel?.byDomain ?? [];
  // Attention by project once the projects are built (the engine assigns every
  // prompt); "" is prompts no project claimed yet.
  const projTitle = useMemo(() => new Map((sel?.byProject ?? []).map((p) => [p.slug, p.slug ? p.title : "Other"])), [sel]);
  const byProject = (sel?.byProject ?? []).filter((p) => !filter || p.domain === filter);
  const shownThreads = useMemo(() => (sel?.threads ?? []).filter((t) => !filter || t.domain === filter), [sel, filter]);
  const shownDomains = useMemo(() => domains.filter((d) => !filter || d.domain === filter), [domains, filter]);
  const domTotal = shownDomains.reduce((a, d) => a + d.count, 0) || 1;
  const top = domains[0];

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Bar: vantage switch + domain filter */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <div className="flex items-center gap-2 font-display text-lg font-semibold text-text-primary">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-accent-border bg-accent-soft text-accent"><History className="h-4 w-4" /></span>
          Retrospect
        </div>
        <div className="inline-flex h-9 items-center gap-0.5 rounded-lg border border-border bg-background p-1">
          {([["time", "Time", CalendarRange], ["projects", "Projects", FolderKanban]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => pickLens(id)}
              className={`inline-flex h-full items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] transition-colors ${lens === id ? "bg-accent font-medium text-background shadow-sm" : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"}`}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
        {lens === "time" && (
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          {VANTAGES.map((v) => (
            <button key={v.id} onClick={() => setVantage(v.id)}
              className={`px-3 py-1.5 text-[12px] transition-colors ${vantage === v.id ? "bg-accent font-bold text-background" : "text-text-muted hover:bg-surface-warm hover:text-text-secondary"}`}>
              {v.label}
            </button>
          ))}
        </div>
        )}
        {lens === "time" && domains.length > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button onClick={() => setFilter(null)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${!filter ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:text-text-secondary"}`}>
              All domains
            </button>
            {domains.slice(0, 6).map((d) => (
              <button key={d.domain} onClick={() => setFilter(filter === d.domain ? null : d.domain)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${filter === d.domain ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-muted hover:text-text-secondary"}`}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: domColor(d.domain) }} /> {titleCase(d.domain)}
              </button>
            ))}
          </div>
        )}
      </div>

      {lens === "projects" ? (
        <div className="min-h-0 flex-1"><ProjectsView vaultPath={vaultPath} /></div>
      ) : (
      <div className="flex min-h-0 flex-1">
        {/* Spine: periods (collapsible) */}
        {spineCollapsed ? (
          <div className="flex w-9 shrink-0 flex-col items-center border-r border-border bg-surface/40 py-2">
            <button onClick={() => setSpineCollapsed(false)} title="Show periods" aria-label="Show periods"
              className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-warm hover:text-text-secondary">
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        ) : (
        <div className="w-56 shrink-0 overflow-y-auto border-r border-border bg-surface/40 p-2">
          <div className="flex items-center justify-between px-2.5 pb-2 pt-1">
            <span className="text-[11px] text-text-muted">{vantage === "year" ? "years" : `${vantage}s`}</span>
            <button onClick={() => setSpineCollapsed(true)} title="Collapse" aria-label="Collapse periods"
              className="rounded p-0.5 text-text-muted transition-colors hover:bg-surface-warm hover:text-text-secondary">
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          </div>
          {(rollup?.periods ?? []).map((p) => {
            const on = p.key === (sel?.key ?? "");
            const t = p.byDomain[0];
            return (
              <button key={p.key} onClick={() => setSelKey(p.key)}
                className={`mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-[13px] ${on ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{p.label}</div>
                  <div className="text-[11px] text-text-muted">{p.total} prompt{p.total === 1 ? "" : "s"}{t ? ` · ${titleCase(t.domain)}` : ""}</div>
                </div>
                <span className="h-6 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: t ? domColor(t.domain) : "var(--border)", opacity: 0.3 + 0.7 * (p.total / maxTotal) }} />
              </button>
            );
          })}
          {(rollup?.periods.length ?? 0) === 0 && !loading && (
            <div className="px-2.5 py-4 text-[12px] leading-snug text-text-muted">No prompts recorded yet. Retrospect fills in as you use Prevail.</div>
          )}
        </div>
        )}

        {/* Main */}
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-[13px] text-text-muted">Reading your prompts…</div>
          ) : !sel ? (
            <div className="max-w-md text-sm text-text-muted">Nothing to look back on yet. Retrospect fills in as you use Prevail.</div>
          ) : (
            <>
              <div className="font-display text-2xl font-semibold text-text-primary" style={{ textWrap: "balance" } as React.CSSProperties}>
                {top ? (<>In {sel.label}, you were mostly in <span className="text-accent">{titleCase(top.domain)}</span>.</>) : (<>In {sel.label}.</>)}
              </div>
              {/* The biggest thread as a plain-language "what you were working on"
                  theme — data-driven from the ledger, no model needed. */}
              {sel.threads[0]?.message && (
                <div className="mt-1.5 text-[14px] leading-snug text-text-secondary">
                  Mostly: <span className="text-text-primary">{sel.threads[0].message}</span>
                  {sel.threads[1]?.message && (top && sel.threads[1].domain !== top.domain) ? (
                    <span className="text-text-muted"> · also {titleCase(sel.threads[1].domain)}: {sel.threads[1].message}</span>
                  ) : null}
                </div>
              )}
              <div className="mt-1.5 text-[11px] text-text-muted">{sel.total} prompt{sel.total === 1 ? "" : "s"} · {domains.length} domain{domains.length === 1 ? "" : "s"} touched</div>

              {/* Attention bars: by project once projects exist, else by domain. */}
              <div className="mt-6">
                <div className="mb-3 text-[11px] text-text-muted">Where your attention went</div>
                {byProject.length > 0 ? byProject.slice(0, 12).map((p) => {
                  const tot = byProject.reduce((a, x) => a + x.count, 0) || 1;
                  const pct = Math.round((p.count / tot) * 100);
                  return (
                    <div key={p.slug || "other"} className="mb-2 flex items-center gap-3">
                      <span className="w-40 shrink-0 truncate text-right text-[13px] text-text-secondary" title={p.slug ? p.title : "Prompts no project claimed yet"}>{p.slug ? p.title : "Other"}</span>
                      <div className="h-5 flex-1 overflow-hidden rounded-md bg-surface">
                        <div className="flex h-full items-center rounded-md pl-2 text-[11px] font-bold text-background" style={{ width: `${Math.max(pct, 6)}%`, backgroundColor: p.slug ? domColor(p.domain) : "var(--color-text-muted)" }}>{p.count}</div>
                      </div>
                      <span className="w-12 shrink-0 text-right text-[11px] text-text-muted">{pct}%</span>
                    </div>
                  );
                }) : shownDomains.map((d) => {
                  const pct = Math.round((d.count / domTotal) * 100);
                  return (
                    <div key={d.domain} className="mb-2 flex items-center gap-3">
                      <span className="w-28 shrink-0 truncate text-right text-[13px] text-text-secondary">{titleCase(d.domain)}</span>
                      <div className="h-5 flex-1 overflow-hidden rounded-md bg-surface">
                        <div className="flex h-full items-center rounded-md pl-2 text-[11px] font-bold text-background" style={{ width: `${Math.max(pct, 6)}%`, backgroundColor: domColor(d.domain) }}>{d.count}</div>
                      </div>
                      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-text-muted">{pct}%</span>
                    </div>
                  );
                })}
              </div>

              {/* Threads */}
              <div className="mt-7">
                <div className="mb-2 text-[11px] text-text-muted">The threads · most-worked first</div>
                {shownThreads.length === 0 ? (
                  <div className="py-2 text-[13px] text-text-muted">No threads for this filter.</div>
                ) : shownThreads.map((t, i) => (
                  <div key={i} className="flex gap-3 border-b border-border-subtle py-2.5 last:border-b-0">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: domColor(t.domain) }} />
                    <div className="min-w-0">
                      <div className="text-[14px] leading-snug text-text-primary">{t.message}</div>
                      <div className="mt-0.5 text-[11px] text-text-muted">{t.project && projTitle.get(t.project) ? projTitle.get(t.project) : titleCase(t.domain)} · {t.count} prompt{t.count === 1 ? "" : "s"}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
