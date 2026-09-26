// Recommendations: the one "what to do next" home. Everything Prevail notices
// (Intent findings, project next steps, stuck projects, connectors, recurring
// people and places, model benchmarks, context gaps) arrives from the engine
// as one list ranked by leverage. The page is the canonical template: a
// sticky header, a SideSpine of categories with counts, and one full-width
// column. "Start here" is the top five.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight, ArrowUpRight, BarChart3, Bookmark, Check, ChevronDown, ClipboardCopy, Compass, Flag, FolderKanban,
  Gauge, LayoutList, Lightbulb, ListTodo, Loader2, Play, Plug, RotateCcw, RotateCw, ScrollText, Sparkles, Users, X,
  type LucideIcon,
} from "lucide-react";
import { invoke } from "./bridge";
import { relTime, titleCase } from "./format";
import { modelLabel } from "./helpers2";
import { distillCfgFromPrefs } from "./daemoncfg";
import { SideSpine, STICKY_HEAD } from "./sidespine";
import { useIsPhone } from "./useisphone";
import {
  addTask, applyRec, copyInstruction, doItLabel, loadSet, openEvidence, recsFor, REC_DISMISSED, REC_SAVED,
  SPINE, setDomainModel, spineCounts, START_N, storeSet, visibleRecs, normalizeRec,
  type Rec, type RecCategory, type RecRow, type SpineKey,
} from "./recmodel";

export { applyRec } from "./recmodel";
export type { Rec } from "./recmodel";

type DistillStatus = { running: boolean; last_run_ts?: number | null; interval_sec?: number | null };

const SPINE_ICON: Record<SpineKey, LucideIcon> = {
  all: LayoutList, start: Flag, rules: ScrollText, projects: FolderKanban, apps: Plug,
  people: Users, models: BarChart3, context: Gauge,
};
const CAT_LABEL: Record<RecCategory, string> = {
  rules: "Rules", projects: "Projects", apps: "Apps", people: "People and places", models: "Models", context: "Context",
};
const iconBtn = "inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";

function IconAction({ label, icon: Icon, onClick, busy, done, tone, pressed }: {
  label: string; icon: LucideIcon; onClick: () => void; busy?: boolean; done?: boolean; tone?: "danger"; pressed?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={busy} title={label} aria-label={label} aria-pressed={pressed}
      className={`${iconBtn} ${done || pressed ? "text-accent" : ""} ${tone === "danger" ? "hover:text-err" : ""}`}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" fill={pressed ? "currentColor" : "none"} />}
    </button>
  );
}

function ModelTable({ rows, onApply, applied }: { rows: RecRow[]; onApply: (r: RecRow) => void; applied: Set<string> }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full text-left text-[13px]" data-testid="model-table">
        <thead className="bg-surface-warm/60 text-[12px] text-text-muted">
          <tr><th className="px-3 py-2 font-medium">Domain</th><th className="px-3 py-2 font-medium">Current</th><th className="px-3 py-2 font-medium">Suggested</th><th className="px-3 py-2 text-right font-medium">Score</th><th className="w-10" /></tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {rows.map((r) => (
            <tr key={r.id} data-testid="model-row">
              <td className="px-3 py-2 font-medium text-text-primary">{titleCase(r.domain)}</td>
              <td className="px-3 py-2 text-text-muted">{r.current ? modelLabel(undefined, r.current) || r.current : "Not set"}</td>
              <td className="px-3 py-2 text-text-secondary">{modelLabel(r.cli, r.suggested ?? "") || r.suggested_label}</td>
              <td className="px-3 py-2 text-right tabular-nums text-text-secondary" title={r.models_tested ? `Best of ${r.models_tested} models tested` : undefined}>{r.score != null ? `${r.score.toFixed(1)}/10` : ""}</td>
              <td className="px-1 py-1">
                <IconAction label={`Apply for ${titleCase(r.domain)}`} icon={Play} onClick={() => onApply(r)} done={applied.has(r.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecItem({ r, rank, vaultPath, saved, dismissed, onSave, onDismiss, onRestore, onChanged, phone }: {
  r: Rec; rank?: number; vaultPath: string; saved: boolean; dismissed: boolean;
  onSave: () => void; onDismiss: () => void; onRestore: () => void; onChanged: () => void; phone: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const run = async (key: string, f: () => Promise<string | void>) => {
    setBusy(key);
    try { const t = await f(); if (t) setMsg({ text: t, ok: true }); }
    catch (e) { setMsg({ text: `Could not do that: ${e}`, ok: false }); }
    finally { setBusy(null); }
  };
  const isModels = r.action.kind === "set_domain_models";
  const hasTable = isModels && (r.rows?.length ?? 0) > 0;
  const canCopy = !!r.instruction || r.action.kind === "project_rec";
  const canTask = !!r.task;
  return (
    <li data-testid="rec-item" data-rec-id={r.id} className={`px-4 py-4 ${dismissed ? "opacity-50" : ""}`}>
      <div className={`flex gap-3 ${phone ? "flex-col" : "items-start"}`}>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            {r.metric && (
              <span className="shrink-0 font-display text-2xl font-semibold tabular-nums leading-none text-accent" title={r.metric.unit} data-testid="rec-metric">
                {r.metric.value.toLocaleString()}
              </span>
            )}
            <h3 className="min-w-0 text-[16px] font-semibold leading-snug text-text-primary">
              {rank ? <span className="sr-only">{`${rank}. `}</span> : null}{r.title}
            </h3>
          </div>
          {r.metric && <div className="mt-0.5 text-[12px] text-text-muted">{r.metric.unit}</div>}
          <p className="mt-1.5 text-[14px] leading-snug text-text-secondary">{r.detail}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
            {r.evidence && (
              <button onClick={() => openEvidence(r.evidence!)} className="inline-flex items-center gap-1 text-accent underline decoration-accent-border underline-offset-[3px] hover:decoration-accent">
                {r.evidence.label}<ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            )}
            {hasTable && (
              <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1 text-text-secondary hover:text-accent">
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />{open ? "Hide domains" : `Show ${r.rows!.length} domains`}
              </button>
            )}
            {!isModels && r.rows && r.rows.length > 0 && (
              <span className="text-text-muted">{r.rows.slice(0, 8).map((x) => titleCase(x.domain)).join(", ")}{r.rows.length > 8 ? ` and ${r.rows.length - 8} more` : ""}</span>
            )}
          </div>
          {msg && <p className={`mt-1.5 inline-flex items-center gap-1 text-[13px] ${msg.ok ? "text-ok" : "text-err"}`}>{msg.ok && <Check className="h-3.5 w-3.5" />}{msg.text}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Actions">
          {!dismissed && (
            <IconAction label={doItLabel(r)} icon={isModels ? Play : ArrowRight} busy={busy === "do"}
              onClick={() => void run("do", async () => { const t = await applyRec(r, vaultPath); onChanged(); return t; })} />
          )}
          {canTask && !dismissed && (
            <IconAction label={`Add a task to ${titleCase(r.task!.domain)}`} icon={ListTodo} busy={busy === "task"}
              onClick={() => void run("task", async () => { await addTask(r, vaultPath); return `Added to the ${titleCase(r.task!.domain)} board.`; })} />
          )}
          {canCopy && !dismissed && (
            <IconAction label="Copy an instruction for an agent" icon={ClipboardCopy} busy={busy === "copy"}
              onClick={() => void run("copy", async () => { await copyInstruction(r, vaultPath); return "Copied."; })} />
          )}
          <IconAction label={saved ? "Saved; click to unsave" : "Save for later"} icon={Bookmark} pressed={saved} onClick={onSave} />
          {dismissed
            ? <IconAction label="Restore" icon={RotateCcw} onClick={onRestore} />
            : <IconAction label="Dismiss" icon={X} tone="danger" onClick={onDismiss} />}
        </div>
      </div>
      {hasTable && open && (
        <ModelTable rows={r.rows!} applied={applied} onApply={(row) => {
          setDomainModel(row);
          setApplied((s) => new Set(s).add(row.id));
          setMsg({ text: `${titleCase(row.domain)} now uses ${modelLabel(row.cli, row.suggested ?? "") || row.suggested_label}.`, ok: true });
        }} />
      )}
    </li>
  );
}

function SpineList({ counts, sel, onSelect }: { counts: Record<SpineKey, number>; sel: SpineKey; onSelect: (k: SpineKey) => void }) {
  return (
    <nav className="p-2" aria-label="Recommendation categories">
      {SPINE.map(({ key, label }) => {
        const Icon = SPINE_ICON[key];
        const on = sel === key;
        return (
          <button key={key} onClick={() => onSelect(key)} aria-current={on ? "page" : undefined} data-testid={`spine-${key}`}
            className={`mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
            <Icon className={`h-4 w-4 shrink-0 ${on ? "text-accent" : "text-text-muted"}`} />
            <span className={`min-w-0 flex-1 truncate text-[14px] ${on ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{label}</span>
            <span className="text-[13px] tabular-nums text-text-muted">{counts[key]}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function RecommendationsPanel({ vaultPath }: { vaultPath: string }) {
  const phone = useIsPhone();
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadSet(REC_DISMISSED));
  const [saved, setSaved] = useState<Set<string>>(() => loadSet(REC_SAVED));
  const [sel, setSel] = useState<SpineKey>(() => {
    try { const v = localStorage.getItem("prevail.recs.category"); return (SPINE.some((s) => s.key === v) ? v : "all") as SpineKey; } catch { return "all"; }
  });
  const select = (k: SpineKey) => { setSel(k); try { localStorage.setItem("prevail.recs.category", k); } catch { /* storage off */ } };
  const [showDismissed, setShowDismissed] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [tick, setTick] = useState(0); // re-read local model defaults after an apply
  const [daemon, setDaemon] = useState<DistillStatus | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await invoke<{ ok: boolean; recommendations?: Rec[] }>("engine_recommendations", { vault: vaultPath });
      setRecs(Array.isArray(r?.recommendations) ? r.recommendations.map(normalizeRec) : []);
    } catch { setRecs([]); }
    try { setDaemon(await invoke<DistillStatus>("distill_status")); } catch { /* daemon not started */ }
  }, [vaultPath]);
  useEffect(() => { void load(); }, [load]);

  const runNow = useCallback(async () => {
    setRunning(true);
    try { await invoke("distill_run_once", { cfg: distillCfgFromPrefs(vaultPath) }); } catch { /* surfaced by reload */ }
    finally { setRunning(false); await load(); }
  }, [vaultPath, load]);

  const persistDismissed = (s: Set<string>) => { setDismissed(new Set(s)); storeSet(REC_DISMISSED, s); window.dispatchEvent(new Event("prevail:recs-changed")); };
  const toggle = (set: Set<string>, id: string) => { const s = new Set(set); if (s.has(id)) s.delete(id); else s.add(id); return s; };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const live = useMemo(() => (recs ? visibleRecs(recs, dismissed, { showDismissed, savedOnly, saved }) : []), [recs, dismissed, showDismissed, savedOnly, saved, tick]);
  const counts = useMemo(() => spineCounts(live.filter((r) => !dismissed.has(r.id))), [live, dismissed]);
  const shown = recsFor(live, sel);
  const dismissedCount = (recs ?? []).filter((r) => dismissed.has(r.id)).length;
  const savedCount = (recs ?? []).filter((r) => saved.has(r.id)).length;
  const isLearning = running || !!daemon?.running;

  const item = (r: Rec, rank?: number) => (
    <RecItem key={r.id} r={r} rank={rank} vaultPath={vaultPath} phone={phone}
      saved={saved.has(r.id)} dismissed={dismissed.has(r.id)}
      onSave={() => { const s = toggle(saved, r.id); setSaved(s); storeSet(REC_SAVED, s); }}
      onDismiss={() => persistDismissed(new Set(dismissed).add(r.id))}
      onRestore={() => { const s = new Set(dismissed); s.delete(r.id); for (const x of r.rows ?? []) s.delete(x.id); persistDismissed(s); }}
      onChanged={() => setTick((n) => n + 1)} />
  );
  const list = (rs: Rec[], ranked = false) => (
    <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface">{rs.map((r, i) => item(r, ranked ? i + 1 : undefined))}</ul>
  );
  const sectionHead = (label: string, n: number, Icon: LucideIcon) => (
    <h2 className="mb-2.5 flex items-center gap-2 font-display text-xl font-semibold text-text-primary">
      <Icon className="h-5 w-5 text-accent" />{label}<span className="text-[14px] font-normal tabular-nums text-text-muted">{n}</span>
    </h2>
  );

  let body: React.ReactNode;
  if (recs === null) body = <div className="text-[14px] text-text-muted">Reading your vault...</div>;
  else if (!live.length) {
    body = (
      <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
        <Lightbulb className="mx-auto h-8 w-8 text-accent" />
        <p className="mt-3 text-[15px] text-text-secondary">{savedOnly ? "Nothing saved yet." : "Nothing to do right now."}</p>
        <p className="mt-1 text-[13px] text-text-muted">Recommendations appear as Prevail reads your prompts, projects, apps and benchmarks.</p>
      </div>
    );
  } else if (sel === "all") {
    const start = live.slice(0, START_N);
    const rest = live.slice(START_N);
    body = (
      <div className="space-y-8">
        <section data-testid="section-start">{sectionHead("Start here", start.length, Flag)}{list(start, true)}</section>
        {(Object.keys(CAT_LABEL) as RecCategory[]).map((c) => {
          const rs = rest.filter((r) => r.category === c);
          return rs.length ? <section key={c} data-testid={`section-${c}`}>{sectionHead(CAT_LABEL[c], rs.length, SPINE_ICON[c])}{list(rs)}</section> : null;
        })}
      </div>
    );
  } else {
    const label = SPINE.find((s) => s.key === sel)!.label;
    body = shown.length
      ? <section data-testid={`section-${sel}`}>{sectionHead(label, shown.length, SPINE_ICON[sel])}{list(shown, sel === "start")}</section>
      : <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center text-[14px] text-text-muted">Nothing in {label} right now.</div>;
  }

  const toolbar = (
    <div className="mb-5 flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
      <span>{counts.all} to consider, ranked by leverage</span>
      <span className="ml-auto flex items-center gap-2">
        {savedCount > 0 && (
          <button onClick={() => setSavedOnly((v) => !v)} aria-pressed={savedOnly}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 ${savedOnly ? "border-accent-border bg-accent-soft text-accent" : "border-border hover:border-accent-border hover:text-accent"}`}>
            <Bookmark className="h-3.5 w-3.5" />Saved {savedCount}
          </button>
        )}
        {dismissedCount > 0 && (
          <button onClick={() => setShowDismissed((v) => !v)} aria-pressed={showDismissed}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 hover:border-accent-border hover:text-accent">
            {showDismissed ? "Hide" : "Show"} dismissed {dismissedCount}
          </button>
        )}
      </span>
    </div>
  );
  const detail = <div className={phone ? "px-4 py-4" : "w-full px-8 py-6"}>{toolbar}{body}</div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background" data-testid="recommendations-page">
      <div data-testid="page-header" className={`${STICKY_HEAD} flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border ${phone ? "px-4 py-3" : "px-8 py-5"}`}>
        {/* On a phone the shell's header bar already names the page. */}
        {!phone && (
          <h1 className="flex items-center gap-2.5 font-display text-3xl font-semibold tracking-tight text-text-primary">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent-border bg-accent-soft text-accent"><Lightbulb className="h-5 w-5" /></span>
            Recommendations
          </h1>
        )}
        <div className="ml-auto flex items-center gap-2 text-[13px] text-text-muted">
          <span className={`h-2 w-2 rounded-full ${isLearning ? "bg-accent" : "bg-text-muted/40"}`} />
          <span>{isLearning ? "Learning now" : daemon?.last_run_ts ? `Learned ${relTime(daemon.last_run_ts * 1000)}` : "Not learned yet"}</span>
          <button onClick={() => void runNow()} disabled={isLearning} title="Learn now and refresh" aria-label="Learn now and refresh" className={iconBtn}>
            {isLearning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {phone ? (
        <>
          <div className="flex gap-1.5 overflow-x-auto border-b border-border-subtle px-4 py-2" role="tablist" aria-label="Recommendation categories">
            {SPINE.map(({ key, label }) => (
              <button key={key} role="tab" aria-selected={sel === key} onClick={() => select(key)}
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] ${sel === key ? "bg-surface-warm font-semibold text-text-primary" : "text-text-muted"}`}>
                {label}<span className="tabular-nums text-text-muted">{counts[key]}</span>
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{detail}</div>
        </>
      ) : (
        <SideSpine storageKey="prevail.recs.spine" title="Categories" label="categories" testId="recs-spine" detail={detail}>
          <SpineList counts={counts} sel={sel} onSelect={select} />
        </SideSpine>
      )}
    </div>
  );
}

// The compact home Briefing: the top three next moves plus recent intents.
// The full logic lives in RecommendationsPanel; this is only a glance.
type BriefIntent = { title?: string; goal?: string };
const BRIEF_ICON: Record<RecCategory, LucideIcon> = { rules: ScrollText, projects: FolderKanban, apps: Plug, people: Users, models: BarChart3, context: Gauge };
export function HomeBriefing({ vaultPath }: { vaultPath: string }) {
  const [recs, setRecs] = useState<Rec[]>([]);
  const [intents, setIntents] = useState<BriefIntent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    invoke<{ ok: boolean; recommendations?: Rec[] }>("engine_recommendations", { vault: vaultPath })
      .then((r) => { if (alive) setRecs(Array.isArray(r?.recommendations) ? visibleRecs(r.recommendations, loadSet(REC_DISMISSED)) : []); })
      .catch(() => { if (alive) setRecs([]); });
    invoke<{ intents?: BriefIntent[] }>("intents_distilled_read", { vault: vaultPath })
      .then((d) => { if (alive) setIntents(Array.isArray(d?.intents) ? d.intents : []); })
      .catch(() => { if (alive) setIntents([]); });
    return () => { alive = false; };
  }, [vaultPath]);

  const top = recs.filter((r) => !cleared.has(r.id)).slice(0, 3);
  const intentLine = intents.slice(0, 3).map((it) => it.title || it.goal || "").filter(Boolean).join(" · ");
  const openRecs = () => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "recommendations" }));
  const openIntents = () => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "intents" }));
  const act = useCallback(async (rec: Rec) => {
    setBusy(rec.id);
    try {
      await applyRec(rec, vaultPath);
      setDone((d) => ({ ...d, [rec.id]: true }));
      window.setTimeout(() => setCleared((c) => new Set(c).add(rec.id)), 1100);
    } catch { /* surfaced in the full panel */ }
    finally { setBusy(null); }
  }, [vaultPath]);

  if (top.length === 0 && intentLine === "") return null;
  return (
    <div className="mt-8 w-full max-w-5xl">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-bold text-text-primary">
          <Sparkles className="h-3.5 w-3.5 text-accent" /> Briefing
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-sm">
        {top.map((r, i) => {
          const Icon = BRIEF_ICON[r.category] ?? Compass;
          const tip = doItLabel(r);
          return (
            <div key={r.id} className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? "border-t border-border-subtle" : ""}`}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><Icon className="h-3.5 w-3.5" /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text-primary">{r.title}</div>
                <div className="truncate text-xs text-text-secondary">{r.detail}</div>
              </div>
              {done[r.id] ? <Check className="h-4 w-4 shrink-0 text-ok" /> : (
                <button onClick={() => void act(r)} disabled={busy === r.id} title={tip} aria-label={tip}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40">
                  {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
          );
        })}
        {intentLine !== "" && (
          <button onClick={openIntents} className="flex w-full items-center gap-2 border-t border-border-subtle px-4 py-2.5 text-left transition-colors hover:bg-surface-warm">
            <Compass className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <span className="min-w-0 flex-1 truncate text-xs text-text-secondary"><span className="font-semibold text-text-primary">Recent intents:</span> {intentLine}</span>
            <span className="shrink-0 text-xs text-accent">See all</span>
          </button>
        )}
        {top.length > 0 && (
          <button onClick={openRecs} className="flex w-full items-center justify-center gap-1 border-t border-border-subtle px-4 py-2 text-xs font-semibold text-accent transition-colors hover:bg-surface-warm">
            See all recommendations <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
