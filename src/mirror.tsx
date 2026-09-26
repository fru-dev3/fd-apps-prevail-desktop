// Intent (module name mirror.tsx): one place to look back at yourself through your own prompts.
// Noticed and History share one sidebar of periods (`prevail intent periods`):
// weeks going back in time, newest first, each opening to its days, laid out
// like Projects (list column left, detail right; a period picker on a phone).
//   Noticed   for the selected week: its letter, what it went to and the
//             findings computed for it; for a day: its intent line, what it
//             went to and the findings that apply (`prevail intent findings
//             --week|--day`). Verdicts still apply (make it a rule, resume...).
//   History   the selected period's sittings, the prompts exactly as typed
//             (`prevail intent history --week|--day`), plain text only.
//   Projects  what those prompts were building, each with a restart brief a
//             newer model can rebuild it from (projectsview.tsx).
// The header's tool dots show which tools are captured; a click opens the
// capture setup in a drawer.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, ChevronRight, ChevronUp, ClipboardCopy, Clock, FolderKanban, Loader2,
  PauseCircle, Play, RefreshCw, RotateCcw, ScanFace, Search, Sparkles, Terminal, ThumbsDown, X,
} from "lucide-react";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { domainColor } from "./helpers";
import { Markdown } from "./Markdown";
import { CAPTURE_LABELS, PromptCapturePanel, type CaptureStatus } from "./promptcapturepanel";
import { ProjectsView } from "./projectsview";
import { EntitiesView } from "./entitiesview";
import { useIsPhone } from "./useisphone";
import { SideSpine } from "./sidespine";

// ── Engine shapes (see the mirror contract) ─────────────────────────────────
export type FindingKind = "goals_drift" | "tooling_share" | "repeated_rules" | "open_loops" | "late_night";
export interface Receipt { ts: number; tool: string; project: string; project_title: string; text: string }
export interface FindingItem { id: string; label: string; count?: number; project?: string; rule_text?: string; domain?: string }
export interface Finding {
  id: string; kind: FindingKind; headline: string; detail: string;
  metric?: { value: number; unit: string };
  visual?: { type: "dots" | "bar" | "split" | "list"; data: unknown };
  receipts?: Receipt[]; items?: FindingItem[];
  actions?: ("rule" | "replay" | "resume" | "let_go" | "none")[];
  cadence?: "weekly" | "quarterly";
  status?: "new" | "true" | "not_really" | "later";
  snoozed_until?: number;
}
export interface FindingsDoc { generated_ts: number; letter: { week: string; title: string; markdown: string } | null; findings: Finding[] }
export interface HistPrompt { ts: number; text: string }
export interface Sitting { id: string; tool: string; project: string; project_title: string; start_ts: number; end_ts: number; prompts: HistPrompt[] }
export interface HistWeek { week: string; label: string; intent_line: string | null; sittings: Sitting[] }
export interface HistoryDoc { total: number; tools: string[]; weeks: HistWeek[] }
export interface PeriodDay { day: string; label: string; prompts: number; sittings: number; intent_line: string | null }
export interface PeriodWeek { week: string; label: string; current: boolean; prompts: number; sittings: number; has_letter: boolean; intent_line: string | null; days: PeriodDay[] }
export interface PeriodsDoc { generated_ts: number; weeks: PeriodWeek[] }
export interface PeriodProject { slug: string; title: string; domain: string; sittings: number; prompts: number; minutes: number }
export interface PeriodDoc {
  period: { kind: "week" | "day"; key: string; week: string; label: string };
  current: boolean; generated_ts: number; intent_line: string | null;
  letter: FindingsDoc["letter"]; letter_status: "ready" | "missing" | "not_yet" | "none";
  totals: { prompts: number; sittings: number }; projects: PeriodProject[]; findings: Finding[];
}
export type PeriodSel = { kind: "week" | "day"; key: string };

export type MirrorView = "noticed" | "history" | "projects" | "entities";
const VIEWS: { id: MirrorView; label: string }[] = [
  { id: "noticed", label: "Noticed" }, { id: "history", label: "History" }, { id: "projects", label: "Projects" }, { id: "entities", label: "Entities" },
];
const VIEW_KEY = "prevail.mirror.view";
const FOCUS_KEY = "prevail.intent.focus";

export const toolLabel = (t: string) => CAPTURE_LABELS[t] ?? titleCase(t || "other");
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// A finding is on screen while it is new, or its snooze has run out.
export function visibleFindings(doc: FindingsDoc | null, now = Date.now()): Finding[] {
  return (doc?.findings ?? []).filter((f) => {
    if (f.status === "not_really" || f.status === "true") return false;
    if (f.status === "later") return !f.snoozed_until || f.snoozed_until <= now;
    return true;
  });
}

function ProjectChip({ slug, title }: { slug: string; title: string }) {
  if (!slug && !title) return null;
  const c = domainColor(slug || title);
  return (
    <span className="inline-flex max-w-[16rem] items-center gap-1 truncate rounded-md px-1.5 py-px text-[12px] font-semibold" style={{ color: c, backgroundColor: `${c}1f` }}>
      <FolderKanban size={12} aria-hidden className="shrink-0" /><span className="truncate">{title || slug}</span>
    </span>
  );
}

function CopyIcon({ text, label = "Copy prompt" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      aria-label={label}
      title={label}
      onClick={() => { void navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {}); }}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-accent"
    >
      {done ? <Check className="h-4 w-4 text-accent" /> : <ClipboardCopy className="h-4 w-4" />}
    </button>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────
function ToolDots({ vaultPath, onOpen }: { vaultPath: string; onOpen: () => void }) {
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  useEffect(() => {
    let alive = true;
    invoke<CaptureStatus>("capture_status", { vault: vaultPath }).then((s) => { if (alive) setStatus(s); }).catch(() => {});
    return () => { alive = false; };
  }, [vaultPath]);
  const tools = (status?.harnesses ?? []).filter((h) => h.present || h.wired);
  return (
    <button onClick={onOpen} aria-label="Capture setup" title="Which tools are captured"
      className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] text-text-secondary hover:border-accent-border hover:text-accent">
      <span className="flex items-center gap-1.5">
        {tools.length === 0 && <span className="h-2.5 w-2.5 rounded-full bg-border" />}
        {tools.map((h) => {
          const on = h.wired && h.enabled !== false;
          return <span key={h.tool} data-testid={`tool-dot-${h.tool}`} data-on={on ? "1" : "0"} title={`${toolLabel(h.tool)}: ${on ? "captured" : "off"}`}
            className={`h-2.5 w-2.5 rounded-full ${on ? "bg-accent" : "bg-text-muted/40"}`} />;
        })}
      </span>
      <span className="hidden sm:inline">Capture</span>
    </button>
  );
}

function CaptureDrawer({ vaultPath, onClose }: { vaultPath: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div role="dialog" aria-label="Capture setup" onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-2xl overflow-y-auto border-l border-border bg-background px-6 py-6 shadow-xl">
        <div className="mb-2 flex justify-end">
          <button onClick={onClose} aria-label="Close" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-warm hover:text-text-primary"><X className="h-5 w-5" /></button>
        </div>
        <PromptCapturePanel vaultPath={vaultPath} />
      </div>
    </div>
  );
}

export function MirrorPanel({ vaultPath }: { vaultPath: string }) {
  const phone = useIsPhone();
  const [view, setViewState] = useState<MirrorView>(() => {
    try {
      if (localStorage.getItem(FOCUS_KEY)) return "history";
      const v = localStorage.getItem(VIEW_KEY);
      return v === "history" || v === "projects" || v === "entities" ? v : "noticed";
    } catch { return "noticed"; }
  });
  const setView = (v: MirrorView) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage off */ } };
  const [capture, setCapture] = useState(false);
  const [focus, setFocus] = useState<{ ts: number; n: number } | null>(null);
  const [projectSlug, setProjectSlug] = useState<{ slug: string; n: number } | null>(null);
  const [periods, setPeriods] = useState<PeriodsDoc | null>(null);
  const [periodsErr, setPeriodsErr] = useState<string | null>(null);
  const [sel, setSel] = useState<PeriodSel | null>(null);

  const loadPeriods = useCallback(() => {
    invoke<PeriodsDoc>("mirror_periods", { vault: vaultPath, tz: tzNow() })
      .then((d) => {
        const doc = d && Array.isArray(d.weeks) ? d : { generated_ts: 0, weeks: [] };
        setPeriods(doc); setPeriodsErr(null);
        // Opens on the newest week.
        setSel((s) => s ?? (doc.weeks[0] ? { kind: "week", key: doc.weeks[0].week } : null));
      })
      .catch((e) => { setPeriods({ generated_ts: 0, weeks: [] }); setPeriodsErr(String(e)); });
  }, [vaultPath]);
  useEffect(loadPeriods, [loadPeriods]);

  // A receipt, or an entity card's "Mentioned in" row, opens History on the
  // day that prompt was typed, scrolled to it.
  const jumpToPrompt = (ts: number) => {
    setSel({ kind: "day", key: localDay(ts) });
    setFocus((f) => ({ ts, n: (f?.n ?? 0) + 1 }));
    setView("history");
  };
  useEffect(() => {
    const take = () => {
      try {
        const ts = Number(localStorage.getItem(FOCUS_KEY));
        localStorage.removeItem(FOCUS_KEY);
        if (ts > 0) jumpToPrompt(ts);
      } catch { /* storage off */ }
    };
    take();
    window.addEventListener("prevail:intent-focus", take);
    return () => window.removeEventListener("prevail:intent-focus", take);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const openProject = (slug: string) => { setProjectSlug((p) => ({ slug, n: (p?.n ?? 0) + 1 })); setView("projects"); };
  const select = (s: PeriodSel) => { setSel(s); setFocus(null); };

  const periodView = view === "noticed" || view === "history";
  let body: React.ReactNode = null;
  if (periodView) {
    if (!periods) body = <div className="p-8 text-[15px] text-text-muted">Looking back over your prompts...</div>;
    else if (!periods.weeks.length || !sel) {
      body = (
        <div className={phone ? "p-4" : "mx-auto max-w-4xl px-8 py-8"}>
          <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
            <ScanFace className="mx-auto h-10 w-10 text-accent" />
            <h2 className="mt-3 font-display text-3xl font-semibold text-text-primary">No prompts yet</h2>
            <p className="mx-auto mt-2 max-w-lg text-[15px] leading-relaxed text-text-secondary">
              Turn on capture for your tools and every prompt you type shows up here, week by week. Intent then points out what you might not see yourself: instructions you keep repeating, projects left open, where your hours really go.
            </p>
            <button onClick={() => setCapture(true)} className={`${btnPrimary} mt-5 h-11 px-5`}>Set up capture</button>
            {periodsErr && <div className="mt-3 text-[13px] text-err">{periodsErr}</div>}
          </div>
        </div>
      );
    } else {
      body = (
        <PeriodFrame key={view} storageKey={`prevail.intent.spine.${view}`} periods={periods} sel={sel} onSelect={select} phone={phone}>
          {view === "noticed"
            ? <NoticedView key={`${sel.kind}:${sel.key}`} vaultPath={vaultPath} phone={phone} periods={periods} sel={sel} onSelect={select} onReceipt={jumpToPrompt} onProject={openProject} onPeriodsChanged={loadPeriods} />
            : <HistoryView vaultPath={vaultPath} phone={phone} periods={periods} sel={sel} focus={focus} />}
        </PeriodFrame>
      );
    }
  }

  return (
    <div className="flex min-h-full flex-col bg-background" data-testid="mirror">
      <div className={`flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border ${phone ? "px-4 py-3" : "px-8 py-5"}`}>
        <h1 className="flex items-center gap-2.5 font-display text-3xl font-semibold tracking-tight text-text-primary">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent-border bg-accent-soft text-accent"><ScanFace className="h-5 w-5" /></span>
          Intent
        </h1>
        <div role="tablist" aria-label="Intent view" className="flex items-center rounded-lg bg-surface-warm p-1 max-sm:order-3 max-sm:w-full">
          {VIEWS.map((v) => (
            <button key={v.id} role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}
              className={`h-9 rounded-md px-4 text-[14px] max-sm:flex-1 max-sm:px-2 ${view === v.id ? "bg-background font-semibold text-text-primary shadow-sm" : "text-text-muted hover:text-text-secondary"}`}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="ml-auto"><ToolDots vaultPath={vaultPath} onOpen={() => setCapture(true)} /></div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {periodView && body}
        {view === "projects" && <ProjectsView vaultPath={vaultPath} initialSlug={projectSlug?.slug} key={projectSlug?.n ?? 0} />}
        {view === "entities" && <EntitiesView vaultPath={vaultPath} embedded />}
      </div>
      {capture && <CaptureDrawer vaultPath={vaultPath} onClose={() => setCapture(false)} />}
    </div>
  );
}

// ── Noticed ─────────────────────────────────────────────────────────────────
function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

// The small picture each finding carries. `data` is loosely typed by the
// engine, so every shape reads defensively and draws nothing it cannot read.
// Engine shapes: dots = [{domain, prompts, share}] (one dot per domain, lit
// when it came up); bar = [{label, value, prompts}] (value is a percent);
// split = {tooling, outcome, tooling_projects, outcome_projects}; list =
// [{label, count}]. Older numeric shapes still draw.
type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === "object" && x !== null && !Array.isArray(x);
const SPLIT_LABELS: Record<string, string> = { tooling: "Tools and setup", outcome: "Things for their own sake" };

export function FindingVisual({ visual }: { visual: Finding["visual"] }) {
  if (!visual) return null;
  const d = visual.data as Rec | unknown[] | number | null;
  if (visual.type === "dots") {
    let dots: { on: boolean; name: string; label: string }[] = [];
    if (Array.isArray(d)) dots = d.map((x) => {
      if (!isRec(x)) return { on: num(x) > 0, name: "", label: "" };
      const name = String(x.domain ?? x.label ?? "");
      return { on: num(x.prompts ?? x.value ?? x.count) > 0, name, label: x.prompts != null && name ? `${name}: ${num(x.prompts)} prompts` : name };
    });
    else if (isRec(d)) { const t = Math.min(84, num(d.total)); const m = num(d.marked ?? d.value); dots = Array.from({ length: t }, (_, i) => ({ on: i < m, name: "", label: "" })); }
    if (!dots.length) return null;
    const lit = dots.filter((x) => x.on).length;
    const named = dots.some((x) => x.name);
    const quiet = dots.filter((x) => !x.on && x.name).map((x) => x.name);
    return (
      <div>
        <div className="flex flex-wrap gap-1.5" data-testid="visual-dots">
          {dots.slice(0, 84).map((x, i) => <span key={i} title={x.label || undefined} aria-label={x.label || undefined} className={`h-3 w-3 rounded-full ${x.on ? "bg-accent" : "bg-border"}`} />)}
        </div>
        {named && <div className="mt-2 text-[13px] text-text-muted" data-testid="visual-dots-legend"><span className="tabular-nums">{lit}</span> of <span className="tabular-nums">{dots.length}</span> came up</div>}
        {quiet.length > 0 && <div className="mt-1 break-words text-[13px] text-text-secondary" data-testid="visual-dots-quiet">Never came up: {quiet.map(titleCase).join(", ")}</div>}
      </div>
    );
  }
  if (visual.type === "bar") {
    let bars: { label: string; frac: number; value: number; note: string }[] = [];
    if (typeof d === "number") bars = [{ label: "", frac: d > 1 ? d / 100 : d, value: d, note: "" }];
    else if (Array.isArray(d)) bars = d.filter(isRec).map((x) => {
      const v = num(x.value); const max = num(x.max) || 100;
      return { label: String(x.label ?? ""), frac: v / max, value: v, note: x.prompts != null ? `${num(x.prompts)} prompts` : "" };
    });
    else if (isRec(d)) { const max = num(d.max) || 1; bars = [{ label: String(d.label ?? ""), frac: num(d.value) / max, value: num(d.value), note: "" }]; }
    if (!bars.length) return null;
    const multi = bars.length > 1 || Array.isArray(d);
    return (
      <div data-testid="visual-bar" className="space-y-3">
        {bars.map((b, i) => {
          const w = Math.round(Math.max(0, Math.min(1, b.frac)) * 100);
          return (
            <div key={i}>
              {multi && <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]"><span className="min-w-0 truncate text-text-secondary">{b.label}</span><span className="shrink-0 tabular-nums text-text-muted">{b.value}%{b.note ? ` of ${b.note}` : ""}</span></div>}
              <div className="h-4 w-full overflow-hidden rounded-full bg-surface-warm"><div className="h-full rounded-full bg-accent" style={{ width: `${w}%` }} /></div>
              {!multi && b.label && <div className="mt-1.5 text-[13px] text-text-muted">{b.label}</div>}
            </div>
          );
        })}
      </div>
    );
  }
  if (visual.type === "split") {
    // Only numeric entries are segments; arrays such as tooling_projects are
    // the names behind a segment and show under the bar.
    const raw: { key: string; label: string; value: number }[] = Array.isArray(d)
      ? d.filter(isRec).map((p) => ({ key: String(p.label ?? ""), label: String(p.label ?? ""), value: num(p.value ?? p.count) }))
      : isRec(d) ? Object.entries(d).filter(([, v]) => typeof v === "number" && Number.isFinite(v)).map(([k, v]) => ({ key: k, label: SPLIT_LABELS[k] ?? titleCase(k), value: v as number })) : [];
    const parts = raw.filter((p) => p.value > 0);
    const total = parts.reduce((a, p) => a + p.value, 0);
    if (!total) return null;
    const namesFor = (key: string): string[] => {
      if (!isRec(d)) return [];
      const list = d[`${key}_projects`];
      return Array.isArray(list) ? list.filter(isRec).map((x) => `${String(x.title ?? x.slug ?? "")}${x.sittings != null ? ` (${num(x.sittings)})` : ""}`).filter((t) => !t.startsWith(" (")) : [];
    };
    const shade = (i: number) => i === 0 ? "var(--color-accent)" : `color-mix(in srgb, var(--color-accent) ${Math.max(18, 70 - i * 18)}%, var(--color-border))`;
    return (
      <div data-testid="visual-split">
        <div className="flex h-4 w-full overflow-hidden rounded-full bg-surface-warm">
          {parts.map((p, i) => <div key={p.key + i} style={{ width: `${(p.value / total) * 100}%`, background: shade(i) }} title={`${p.label}: ${p.value}`} />)}
        </div>
        <div className="mt-2 space-y-1.5 text-[13px] text-text-secondary">
          {parts.map((p, i) => {
            const names = namesFor(p.key);
            return (
              <div key={p.key + i} className="min-w-0">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: shade(i) }} />{p.label} <span className="tabular-nums text-text-muted">{p.value} ({Math.round((p.value / total) * 100)}%)</span></span>
                {names.length > 0 && <div className="mt-0.5 break-words pl-4 text-text-muted" data-testid={`split-names-${p.key}`}>{names.slice(0, 4).join(", ")}{names.length > 4 ? `, +${names.length - 4} more` : ""}</div>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  if (visual.type === "list") {
    const rows = (Array.isArray(d) ? d : []).map((x) => typeof x === "string" ? { label: x, count: undefined as number | undefined } : { label: String(isRec(x) ? x.label ?? "" : ""), count: isRec(x) && x.count != null ? num(x.count) : undefined }).filter((r) => r.label);
    if (!rows.length) return null;
    const max = Math.max(1, ...rows.map((r) => num(r.count)));
    return (
      <ul className="space-y-1.5" data-testid="visual-list">
        {rows.slice(0, 6).map((r, i) => (
          <li key={i} className="flex items-center gap-3 text-[14px] text-text-secondary">
            <span className="min-w-0 flex-1 truncate" title={r.label}>{r.label}</span>
            {r.count != null && <span className="flex w-28 shrink-0 items-center gap-2"><span className="h-2 rounded-full bg-accent" style={{ width: `${Math.max(6, (num(r.count) / max) * 80)}px` }} /><span className="tabular-nums text-text-muted">{r.count}</span></span>}
          </li>
        ))}
      </ul>
    );
  }
  return null;
}

function Receipts({ receipts, onReceipt }: { receipts: Receipt[]; onReceipt: (ts: number) => void }) {
  if (!receipts.length) return null;
  return (
    <div className="mt-6">
      <h3 className="mb-2 text-[15px] font-semibold text-text-primary">Receipts</h3>
      <ul className="space-y-2">
        {receipts.slice(0, 5).map((r, i) => (
          <li key={`${r.ts}-${i}`}>
            <button onClick={() => onReceipt(r.ts)} aria-label={`Open prompt from ${fmtDate(r.ts)}`}
              className="group w-full rounded-lg border border-border-subtle bg-background px-3.5 py-2.5 text-left hover:border-accent-border">
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-muted">
                <span className="tabular-nums">{fmtDate(r.ts)}</span><span>{toolLabel(r.tool)}</span>
                <ProjectChip slug={r.project} title={r.project_title} />
                <ArrowRight className="ml-auto h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <div className="mt-1 line-clamp-2 text-[14px] leading-snug text-text-secondary">{r.text}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const btn = "inline-flex items-center justify-center gap-2 rounded-lg text-[14px] font-medium transition-colors disabled:opacity-60";
const btnPrimary = `${btn} bg-accent text-background hover:bg-accent-hover`;
const btnGhost = `${btn} border border-border bg-background text-text-secondary hover:border-accent-border hover:text-accent`;

// One repeated instruction: confirm it as a standing rule, editing the words first.
function RuleItem({ item, big, onConfirm }: { item: FindingItem; big: boolean; onConfirm: (text: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.rule_text || item.label);
  const [busy, setBusy] = useState(false);
  const h = big ? "h-12 px-5" : "h-9 px-3.5";
  return (
    <li className="rounded-lg border border-border-subtle bg-background px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`min-w-0 flex-1 text-[15px] text-text-primary ${big ? "basis-full" : ""}`}>{item.label}</span>
        {item.count != null && <span className="text-[13px] tabular-nums text-text-muted">said {item.count} times</span>}
        {!editing && <button onClick={() => setEditing(true)} className={`${btnPrimary} ${h} ${big ? "ml-auto" : ""}`}><Sparkles className="h-4 w-4" />Make it a rule</button>}
      </div>
      {editing && (
        <div className="mt-3">
          <label className="mb-1 block text-[13px] text-text-muted" htmlFor={`rule-${item.id}`}>The rule, in your words</label>
          <textarea id={`rule-${item.id}`} value={text} onChange={(e) => setText(e.target.value)} rows={2}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[15px] text-text-primary focus:border-accent-border focus:outline-none" />
          <div className="mt-2 flex flex-wrap gap-2">
            <button disabled={busy || !text.trim()} onClick={async () => { setBusy(true); try { await onConfirm(text.trim()); } finally { setBusy(false); } }} className={`${btnPrimary} ${h}`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Save rule
            </button>
            <button onClick={() => setEditing(false)} className={`${btnGhost} ${h}`}>Cancel</button>
          </div>
        </div>
      )}
    </li>
  );
}

function FeaturedFinding({ f, phone, leaving, onVerdict, onReceipt, onProject }: {
  f: Finding; phone: boolean; leaving: boolean;
  onVerdict: (verdict: string, opts?: { item?: string; rule?: string; whole?: boolean }) => Promise<void>;
  onReceipt: (ts: number) => void; onProject: (slug: string) => void;
}) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const items = (f.items ?? []).filter((i) => !gone.has(i.id));
  const drop = (id: string) => setGone((g) => new Set(g).add(id));
  const acts = f.actions ?? [];
  const isRules = f.kind === "repeated_rules" || acts.includes("rule");
  const isLoops = f.kind === "open_loops" || acts.includes("resume") || acts.includes("let_go");
  const h = phone ? "h-12 px-5 text-[15px]" : "h-10 px-4";
  return (
    <article data-testid="featured-finding" className={`rounded-2xl border border-border-subtle bg-surface transition-all duration-300 ${leaving ? "translate-y-2 opacity-0" : "opacity-100"} ${phone ? "p-5" : "p-8"}`}>
      <h2 className={`font-display font-semibold leading-tight tracking-tight text-text-primary ${phone ? "text-3xl" : "text-4xl"}`}>{f.headline}</h2>
      <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-text-secondary">{f.detail}</p>
      {/* A list visual repeats the item rows below it; draw it only when there are no rows. */}
      {!((isRules || isLoops) && f.visual?.type === "list" && items.length > 0) && <div className="mt-6 max-w-xl"><FindingVisual visual={f.visual} /></div>}

      {isRules && items.length > 0 && (
        <ul className="mt-6 space-y-2">
          {items.map((it) => <RuleItem key={it.id} item={it} big={phone} onConfirm={async (rule) => { await onVerdict("true", { item: it.id, rule }); drop(it.id); }} />)}
        </ul>
      )}
      {isLoops && items.length > 0 && (
        <ul className="mt-6 space-y-2">
          {items.map((it) => (
            <li key={it.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-background px-3.5 py-3">
              <span className={`min-w-0 flex-1 text-[15px] text-text-primary ${phone ? "basis-full" : ""}`}>{it.label}{it.count != null && it.count > 0 && <span className="ml-2 text-[13px] tabular-nums text-text-muted">{it.count} prompts</span>}</span>
              <button onClick={async () => { await onVerdict("resume", { item: it.id }); drop(it.id); if (it.project) onProject(it.project); }} className={`${btnPrimary} ${phone ? "h-12 min-w-0 flex-1 px-2" : "h-9 px-3.5"}`}><Play className="h-4 w-4" />Resume</button>
              <button onClick={async () => { await onVerdict("let_go", { item: it.id }); drop(it.id); }} className={`${btnGhost} ${phone ? "h-12 min-w-0 flex-1 px-2" : "h-9 px-3.5"}`}><PauseCircle className="h-4 w-4" />Let go</button>
              {it.project && <button onClick={() => onProject(it.project!)} className={`${btnGhost} ${phone ? "h-12 min-w-0 flex-1 px-2" : "h-9 px-3.5"}`}><RotateCcw className="h-4 w-4" />Replay</button>}
            </li>
          ))}
        </ul>
      )}

      {!phone && <Receipts receipts={f.receipts ?? []} onReceipt={onReceipt} />}

      <div className={`mt-7 flex flex-wrap gap-2 ${phone ? "[&>button]:flex-1" : ""}`}>
        {!isRules && !isLoops && <button onClick={() => void onVerdict("true", { whole: true })} className={`${btnPrimary} ${h}`}><Check className="h-4 w-4" />That's true</button>}
        <button onClick={() => void onVerdict("not_really", { whole: true })} className={`${btnGhost} ${h}`}><ThumbsDown className="h-4 w-4" />Not really</button>
        <button onClick={() => void onVerdict("later", { whole: true })} className={`${btnGhost} ${h}`}><Clock className="h-4 w-4" />Later</button>
      </div>
      {phone && <Receipts receipts={(f.receipts ?? []).slice(0, 3)} onReceipt={onReceipt} />}
    </article>
  );
}

function QuietCard({ f, onOpen }: { f: Finding; onOpen: () => void }) {
  return (
    <button onClick={onOpen} data-testid="quiet-finding" className="flex h-full w-full flex-col rounded-xl border border-border-subtle bg-surface p-5 text-left hover:border-accent-border">
      <div className="font-display text-xl font-semibold leading-snug text-text-primary">{f.headline}</div>
      <div className="mt-2 line-clamp-2 text-[14px] leading-snug text-text-muted">{f.detail}</div>
      <span className="mt-auto inline-flex items-center gap-1 pt-4 text-[13px] font-medium text-accent">Look closer <ArrowRight className="h-3.5 w-3.5" /></span>
    </button>
  );
}

// ── Periods: the sidebar both Noticed and History read from ─────────────────
// Weeks newest first, each opening to its days, as a list column beside the
// detail (the Projects layout). On a phone it folds into one period picker.
export const tzNow = () => new Date().getTimezoneOffset();
const pad2 = (n: number) => String(n).padStart(2, "0");
export const localDay = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const nPrompts = (n: number) => `${n.toLocaleString()} prompt${n === 1 ? "" : "s"}`;
const nSittings = (n: number) => `${n.toLocaleString()} sitting${n === 1 ? "" : "s"}`;

export function weekOfSel(sel: PeriodSel, weeks: PeriodWeek[]): string {
  if (sel.kind === "week") return sel.key;
  return weeks.find((w) => w.days.some((d) => d.day === sel.key))?.week ?? "";
}

function PeriodList({ weeks, sel, onSelect }: { weeks: PeriodWeek[]; sel: PeriodSel | null; onSelect: (s: PeriodSel) => void }) {
  const selWeek = sel ? weekOfSel(sel, weeks) : "";
  const [open, setOpen] = useState<Set<string>>(() => new Set(selWeek ? [selWeek] : []));
  useEffect(() => { if (selWeek) setOpen((o) => (o.has(selWeek) ? o : new Set(o).add(selWeek))); }, [selWeek]);
  const toggle = (w: string) => setOpen((o) => { const n = new Set(o); if (n.has(w)) n.delete(w); else n.add(w); return n; });
  return (
    <nav aria-label="Periods" data-testid="period-list" className="p-2">
      {weeks.map((w) => {
        const on = sel?.kind === "week" && sel.key === w.week;
        const isOpen = open.has(w.week);
        return (
          <div key={w.week} className="mb-1">
            <div className={`flex items-center rounded-lg transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
              <button onClick={() => { onSelect({ kind: "week", key: w.week }); setOpen((o) => new Set(o).add(w.week)); }} aria-current={on ? "true" : undefined}
                data-testid={`period-week-${w.week}`} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left">
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[14px] ${on ? "font-semibold text-text-primary" : "font-medium text-text-secondary"}`}>{w.label}</span>
                  <span className="mt-0.5 block text-[12px] text-text-muted">{w.current ? "This week, " : ""}{nPrompts(w.prompts)}</span>
                </span>
                {w.has_letter && <BookOpen className="h-4 w-4 shrink-0 text-accent" aria-label="Has a letter" />}
              </button>
              <button onClick={() => toggle(w.week)} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} the days of ${w.label}`}
                className="mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-accent">
                <ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`} />
              </button>
            </div>
            {isOpen && w.days.length > 0 && (
              <div className="ml-4 mt-0.5 border-l border-border-subtle pl-2">
                {w.days.map((d) => {
                  const dOn = sel?.kind === "day" && sel.key === d.day;
                  return (
                    <button key={d.day} onClick={() => onSelect({ kind: "day", key: d.day })} aria-current={dOn ? "true" : undefined} data-testid={`period-day-${d.day}`}
                      className={`mb-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${dOn ? "bg-surface-warm font-semibold text-text-primary" : "text-text-secondary hover:bg-surface-warm/50"}`}>
                      <span className="min-w-0 flex-1 truncate">{d.label}</span>
                      <span className="shrink-0 tabular-nums text-[12px] text-text-muted">{d.prompts}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function PeriodPicker({ weeks, sel, onSelect }: { weeks: PeriodWeek[]; sel: PeriodSel | null; onSelect: (s: PeriodSel) => void }) {
  return (
    <div className="border-b border-border-subtle px-4 py-3">
      <select aria-label="Period" data-testid="period-picker" value={sel ? `${sel.kind}:${sel.key}` : ""}
        onChange={(e) => { const [kind, key] = e.target.value.split(":"); onSelect({ kind: kind as PeriodSel["kind"], key }); }}
        className="h-12 w-full rounded-lg border border-border bg-surface px-3 text-[16px] font-semibold text-text-primary focus:border-accent-border focus:outline-none">
        {weeks.map((w) => (
          <optgroup key={w.week} label={w.label}>
            <option value={`week:${w.week}`}>{w.label}, whole week{w.current ? " (this week)" : ""}</option>
            {w.days.map((d) => <option key={d.day} value={`day:${d.day}`}>{d.label}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

// The shared frame: list column (or picker) plus the detail for the selection.
function PeriodFrame({ storageKey, periods, sel, onSelect, phone, children }: { storageKey: string; periods: PeriodsDoc; sel: PeriodSel | null; onSelect: (s: PeriodSel) => void; phone: boolean; children: React.ReactNode }) {
  if (phone) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PeriodPicker weeks={periods.weeks} sel={sel} onSelect={onSelect} />
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    );
  }
  return (
    <SideSpine storageKey={storageKey} title="Weeks" label="periods" testId="period-spine" detail={children}>
      <PeriodList weeks={periods.weeks} sel={sel} onSelect={onSelect} />
    </SideSpine>
  );
}

// The period heading every detail opens with: the dates, the intent line.
function PeriodHeading({ label, line, lineBusy, totals, right }: { label: string; line: string | null; lineBusy: boolean; totals: { prompts: number; sittings: number }; right?: React.ReactNode }) {
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-start gap-3">
        <h2 className="min-w-0 flex-1 font-display text-3xl font-semibold tracking-tight text-text-primary" data-testid="period-title">{label}</h2>
        {right}
      </div>
      {line ? <p className="mt-2 max-w-3xl text-[17px] leading-snug text-text-secondary" data-testid="period-line">{line}</p>
        : lineBusy ? <p className="mt-2 inline-flex items-center gap-2 text-[15px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" />Reading what you were after</p> : null}
      <div className="mt-2 text-[13px] text-text-muted">{nPrompts(totals.prompts)} in {nSittings(totals.sittings)}</div>
    </header>
  );
}

function SpentOn({ projects, title, onProject }: { projects: PeriodProject[]; title: string; onProject: (slug: string) => void }) {
  if (!projects.length) return null;
  const max = Math.max(1, ...projects.map((p) => p.prompts));
  return (
    <section className="mb-8" data-testid="spent-on">
      <h3 className="mb-3 font-display text-xl font-semibold text-text-primary">{title}</h3>
      <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface">
        {projects.slice(0, 8).map((p) => {
          const row = (
            <>
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-text-primary">{p.title}</span>
              <span className="hidden h-2 w-32 overflow-hidden rounded-full bg-surface-warm sm:block" aria-hidden><span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(6, (p.prompts / max) * 100)}%` }} /></span>
              <span className="w-40 shrink-0 text-right text-[13px] tabular-nums text-text-muted max-sm:w-auto">{nPrompts(p.prompts)}, {nSittings(p.sittings)}</span>
            </>
          );
          return (
            <li key={p.slug || "other"}>
              {p.slug ? (
                <button onClick={() => onProject(p.slug)} title={`Open ${p.title} in Projects`} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-warm/60">{row}</button>
              ) : <div className="flex items-center gap-3 px-4 py-3">{row}</div>}
            </li>
          );
        })}
      </ul>
      {projects.length > 8 && <div className="mt-2 text-[13px] text-text-muted">and {projects.length - 8} more</div>}
    </section>
  );
}

// The findings for one period: one featured, the rest a click away.
function Findings({ findings, phone, onVerdict, onReceipt, onProject }: {
  findings: Finding[]; phone: boolean;
  onVerdict: (f: Finding, verdict: string, opts?: { item?: string; rule?: string; whole?: boolean }) => Promise<boolean>;
  onReceipt: (ts: number) => void; onProject: (slug: string) => void;
}) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<string | null>(null);
  const [featuredId, setFeaturedId] = useState<string | null>(null);
  const shown = visibleFindings({ generated_ts: 0, letter: null, findings }).filter((f) => !done.has(f.id));
  const featured = shown.find((f) => f.id === featuredId) ?? shown[0] ?? null;
  if (!featured) return null;
  const rest = shown.filter((f) => f !== featured);
  const idx = shown.indexOf(featured);
  const verdict = async (f: Finding, v: string, o?: { item?: string; rule?: string; whole?: boolean }) => {
    const ok = await onVerdict(f, v, o);
    if (!ok || !o?.whole) return;
    setLeaving(f.id);
    setTimeout(() => { setDone((d) => new Set(d).add(f.id)); setLeaving(null); setFeaturedId(null); }, 280);
  };
  return (
    <div className="space-y-4">
      <FeaturedFinding key={featured.id} f={featured} phone={phone} leaving={leaving === featured.id}
        onVerdict={(v, o) => verdict(featured, v, o)} onReceipt={onReceipt} onProject={onProject} />
      {phone ? shown.length > 1 && (
        <div className="flex items-center gap-2">
          <button aria-label="Previous finding" disabled={idx <= 0} onClick={() => setFeaturedId(shown[idx - 1]?.id ?? null)} className={`${btnGhost} h-12 w-12`}><ArrowLeft className="h-5 w-5" /></button>
          <span className="flex-1 text-center text-[14px] tabular-nums text-text-muted">{idx + 1} of {shown.length}</span>
          <button aria-label="Next finding" disabled={idx >= shown.length - 1} onClick={() => setFeaturedId(shown[idx + 1]?.id ?? null)} className={`${btnGhost} h-12 w-12`}><ArrowRight className="h-5 w-5" /></button>
        </div>
      ) : rest.length > 0 && (
        <div className="space-y-3">
          {rest.map((f) => <QuietCard key={f.id} f={f} onOpen={() => setFeaturedId(f.id)} />)}
        </div>
      )}
    </div>
  );
}

function LetterBlock({ letter, status, busy, current, onLastWeek }: { letter: FindingsDoc["letter"]; status: PeriodDoc["letter_status"]; busy: boolean; current: boolean; onLastWeek?: () => void }) {
  const [open, setOpen] = useState(true);
  if (letter) {
    return (
      <section className="mb-8 rounded-2xl border border-accent-border bg-accent-soft/30 p-5 sm:p-6" data-testid="letter">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2.5 text-left">
          <BookOpen className="h-5 w-5 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 font-display text-2xl font-semibold text-text-primary">{letter.title}</span>
          {open ? <ChevronUp className="h-5 w-5 text-text-muted" /> : <ChevronDown className="h-5 w-5 text-text-muted" />}
        </button>
        {open && <div className="mt-3 max-w-3xl text-[15px] leading-relaxed text-text-secondary"><Markdown source={letter.markdown} /></div>}
      </section>
    );
  }
  if (status === "missing" && busy) {
    return <div className="mb-8 inline-flex items-center gap-2 text-[15px] text-text-muted" data-testid="letter-writing"><Loader2 className="h-4 w-4 animate-spin" />Writing the letter for this week</div>;
  }
  if (current) {
    return (
      <div className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-text-muted" data-testid="letter-not-yet">
        <span>The letter for this week is written once it ends.</span>
        {onLastWeek && <button onClick={onLastWeek} className="inline-flex items-center gap-1 font-medium text-accent hover:underline"><BookOpen className="h-4 w-4" />Read last week's letter</button>}
      </div>
    );
  }
  return null;
}

// ── Noticed ─────────────────────────────────────────────────────────────────
function NoticedView({ vaultPath, phone, periods, sel, onSelect, onReceipt, onProject, onPeriodsChanged }: {
  vaultPath: string; phone: boolean; periods: PeriodsDoc; sel: PeriodSel;
  onSelect: (s: PeriodSel) => void; onReceipt: (ts: number) => void; onProject: (slug: string) => void; onPeriodsChanged: () => void;
}) {
  const [doc, setDoc] = useState<PeriodDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const asked = useRef<Set<string>>(new Set());
  const reqRef = useRef(0);

  const load = useCallback(async (fresh = false) => {
    const id = ++reqRef.current;
    setLoading(true);
    try {
      const d = await invoke<PeriodDoc>("mirror_period", { vault: vaultPath, kind: sel.kind, key: sel.key, tz: tzNow(), fresh });
      if (id !== reqRef.current) return null;
      const ok = d && Array.isArray(d.findings) ? d : null;
      setDoc(ok); setErr(null);
      return ok;
    } catch (e) { if (id === reqRef.current) { setDoc(null); setErr(String(e)); } return null; }
    finally { if (id === reqRef.current) setLoading(false); }
  }, [vaultPath, sel.kind, sel.key]);

  // The model-written parts of a week (its letter, the day lines) are made
  // the first time it is opened, then read back.
  const generate = useCallback(async (week: string, fresh = false) => {
    setWriting(true);
    try {
      await invoke("mirror_generate", { vault: vaultPath, week, tz: tzNow(), fresh });
      await load();
      onPeriodsChanged();
    } catch { /* model unavailable (or the phone bridge): the period still reads */ }
    finally { setWriting(false); }
  }, [vaultPath, load, onPeriodsChanged]);

  useEffect(() => {
    setDoc(null);
    void load().then((d) => {
      if (!d || !d.totals.sittings) return;
      const needs = d.letter_status === "missing" || !d.intent_line;
      const week = d.period.week;
      if (needs && !asked.current.has(week)) { asked.current.add(week); void generate(week); }
    });
  }, [load, generate]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      if (doc?.current) await invoke("mirror_refresh", { vault: vaultPath });
      else await invoke("mirror_generate", { vault: vaultPath, week: doc?.period.week ?? sel.key, tz: tzNow(), fresh: true }).catch(() => {});
      await load(true);
      onPeriodsChanged();
    } catch (e) { setErr(String(e)); }
    finally { setRefreshing(false); }
  };

  const verdict = async (f: Finding, v: string, o?: { item?: string; rule?: string }) => {
    try { await invoke("mirror_verdict", { vault: vaultPath, findingId: f.id, verdict: v, item: o?.item ?? null, rule: o?.rule ?? null }); return true; }
    catch (e) { setErr(String(e)); return false; }
  };

  if (loading && !doc) return <div className={phone ? "p-4 text-[15px] text-text-muted" : "px-8 py-8 text-[15px] text-text-muted"}>Looking back over this {sel.kind}...</div>;
  if (!doc) return <div className="p-8 text-[14px] text-err">{err ?? "Could not read this period."}</div>;

  const weekIdx = periods.weeks.findIndex((w) => w.week === doc.period.week);
  const prevWeek = periods.weeks[weekIdx + 1];
  const shown = visibleFindings({ generated_ts: 0, letter: null, findings: doc.findings });
  const refreshBtn = (
    <button onClick={() => void refresh()} disabled={refreshing} title={doc.current ? "Read your prompts again and redo the findings" : "Rewrite this week's letter and lines"}
      className={`${btnGhost} h-10 px-4`}>
      {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{refreshing ? "Refreshing" : "Refresh"}
    </button>
  );

  return (
    <div className={phone ? "p-4" : "mx-auto max-w-4xl px-8 py-7"} data-testid="noticed">
      <PeriodHeading label={doc.period.label} line={doc.intent_line} lineBusy={writing} totals={doc.totals} right={phone ? undefined : refreshBtn} />
      {doc.period.kind === "week" && (
        <LetterBlock letter={doc.letter} status={doc.letter_status} busy={writing} current={doc.current}
          onLastWeek={doc.current && prevWeek?.has_letter ? () => onSelect({ kind: "week", key: prevWeek.week }) : undefined} />
      )}
      <SpentOn projects={doc.projects} title={doc.period.kind === "day" ? "What the day went to" : "What the week went to"} onProject={onProject} />
      <section>
        <h3 className="mb-3 font-display text-xl font-semibold text-text-primary">Noticed</h3>
        {shown.length ? (
          <Findings key={`${doc.period.kind}:${doc.period.key}`} findings={doc.findings} phone={phone} onVerdict={verdict} onReceipt={onReceipt} onProject={onProject} />
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-surface p-6 text-[15px] leading-relaxed text-text-secondary" data-testid="nothing-noticed">
            {doc.totals.sittings ? `Nothing stood out this ${doc.period.kind}.` : `No prompts this ${doc.period.kind}.`}
            {doc.current && !doc.generated_ts && <> Intent reads every prompt you typed and points out what you might not see yourself: instructions you keep repeating, projects left open, where your hours really go.</>}
          </div>
        )}
      </section>
      <div className="mt-6 flex flex-wrap items-center gap-3 text-[13px] text-text-muted">
        {doc.generated_ts ? <span>Read {fmtDate(doc.generated_ts)}</span> : null}
        {phone && refreshBtn}
        {err && <span className="text-err">{err}</span>}
      </div>
    </div>
  );
}


// ── History ─────────────────────────────────────────────────────────────────
// The prompts exactly as they were typed: plain text, every space and line
// break kept, never rendered as Markdown. A long one is clipped by height
// only, so the text itself is never cut or rewritten.
const LONG_CHARS = 700;
const LONG_LINES = 12;

export function PromptText({ p, focused, phone }: { p: HistPrompt; focused: boolean; phone: boolean }) {
  const long = p.text.length > (phone ? LONG_CHARS / 2 : LONG_CHARS) || p.text.split("\n").length > (phone ? LONG_LINES / 2 : LONG_LINES);
  const [open, setOpen] = useState(false);
  return (
    <div data-prompt-ts={p.ts} className={`group flex gap-2 rounded-lg px-3 py-2 ${phone ? "flex-wrap" : ""} ${focused ? "bg-accent-soft ring-1 ring-accent-border" : "hover:bg-surface-warm/60"}`}>
      <span className={`shrink-0 pt-0.5 text-[12px] tabular-nums text-text-muted ${phone ? "order-first basis-[calc(100%-2.5rem)]" : "w-16"}`}>{fmtTime(p.ts)}</span>
      <div className={`min-w-0 flex-1 ${phone ? "order-last basis-full" : ""}`}>
        <div className={`relative ${long && !open ? (phone ? "max-h-40 overflow-hidden" : "max-h-72 overflow-hidden") : ""}`}>
          <pre data-testid="prompt-text" className="whitespace-pre-wrap break-words font-sans text-[15px] leading-relaxed text-text-primary">{p.text}</pre>
          {long && !open && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface to-transparent" />}
        </div>
        {long && <button onClick={() => setOpen((o) => !o)} className="mt-1 text-[13px] font-medium text-accent hover:underline">{open ? "Show less" : "Show all"}</button>}
      </div>
      <CopyIcon text={p.text} />
    </div>
  );
}

function SittingCard({ s, focusTs, phone }: { s: Sitting; focusTs: number | null; phone: boolean }) {
  const same = fmtDate(s.start_ts) === fmtDate(s.end_ts);
  return (
    <div className="rounded-xl border border-border-subtle bg-surface" data-testid="sitting">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-text-primary"><Terminal className="h-4 w-4 text-accent" />{toolLabel(s.tool)}</span>
        <ProjectChip slug={s.project} title={s.project_title} />
        <span className="ml-auto text-[13px] tabular-nums text-text-muted">
          {fmtDate(s.start_ts)}, {fmtTime(s.start_ts)} to {same ? "" : `${fmtDate(s.end_ts)}, `}{fmtTime(s.end_ts)}
        </span>
      </div>
      <div className="space-y-0.5 p-1.5">
        {s.prompts.map((p, i) => <PromptText key={`${p.ts}-${i}`} p={p} focused={focusTs === p.ts} phone={phone} />)}
      </div>
    </div>
  );
}

function HistoryView({ vaultPath, phone, periods, sel, focus }: { vaultPath: string; phone: boolean; periods: PeriodsDoc; sel: PeriodSel; focus: { ts: number; n: number } | null }) {
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [tool, setTool] = useState("");
  const [project, setProject] = useState("");
  const [doc, setDoc] = useState<HistoryDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reqRef = useRef(0);
  const focusTs = focus?.ts ?? null;

  useEffect(() => { const t = setTimeout(() => setQDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  // A new period starts unfiltered.
  useEffect(() => { setQ(""); setQDebounced(""); setTool(""); setProject(""); }, [sel.kind, sel.key]);

  useEffect(() => {
    const id = ++reqRef.current;
    setLoading(true);
    invoke<HistoryDoc>("mirror_history", {
      vault: vaultPath, q: qDebounced || null, tool: tool || null, project: project || null, before: null, limit: 2000,
      week: sel.kind === "week" ? sel.key : null, day: sel.kind === "day" ? sel.key : null, tz: tzNow(),
    })
      .then((d) => { if (id === reqRef.current) { setDoc(d && Array.isArray(d.weeks) ? d : { total: 0, tools: [], weeks: [] }); setErr(null); } })
      .catch((e) => { if (id === reqRef.current) { setDoc({ total: 0, tools: [], weeks: [] }); setErr(String(e)); } })
      .finally(() => { if (id === reqRef.current) setLoading(false); });
  }, [vaultPath, sel.kind, sel.key, qDebounced, tool, project]);

  useEffect(() => {
    if (focusTs == null) return;
    const el = document.querySelector(`[data-prompt-ts="${focusTs}"]`);
    if (el && "scrollIntoView" in el) (el as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
  }, [doc, focusTs]);

  const sittings = useMemo(() => (doc?.weeks ?? []).flatMap((w) => w.sittings), [doc]);
  const [projects, setProjects] = useState<Map<string, string>>(new Map());
  useEffect(() => { setProjects(new Map()); }, [sel.kind, sel.key]);
  useEffect(() => { setProjects((m) => { const n = new Map(m); for (const s of sittings) if (s.project) n.set(s.project, s.project_title || s.project); return n; }); }, [sittings]);
  const [tools, setTools] = useState<string[]>([]);
  useEffect(() => { if (doc?.tools?.length) setTools(doc.tools); }, [doc]);

  const week = periods.weeks.find((w) => w.week === weekOfSel(sel, periods.weeks));
  const day = sel.kind === "day" ? week?.days.find((d) => d.day === sel.key) : null;
  const label = day?.label ?? week?.label ?? sel.key;
  const line = (sel.kind === "day" ? day?.intent_line : week?.intent_line) ?? null;
  const nPromptsHere = sittings.reduce((a, s) => a + s.prompts.length, 0);
  const sel2 = "h-10 rounded-lg border border-border bg-surface px-3 text-[14px] text-text-secondary focus:border-accent-border focus:outline-none";
  const filtered = !!(qDebounced || tool || project);

  return (
    <div className={phone ? "px-3 py-4" : "mx-auto max-w-4xl px-8 py-7"} data-testid="history">
      <PeriodHeading label={label} line={line} lineBusy={false} totals={{ prompts: nPromptsHere, sittings: sittings.length }} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search this ${sel.kind}`} aria-label="Search prompts"
            className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-[15px] text-text-primary focus:border-accent-border focus:outline-none" />
        </label>
        <select aria-label="Tool" value={tool} onChange={(e) => setTool(e.target.value)} className={`${sel2} max-sm:flex-1`}>
          <option value="">All tools</option>
          {tools.map((t) => <option key={t} value={t}>{toolLabel(t)}</option>)}
        </select>
        <select aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)} className={`${sel2} max-w-[14rem] max-sm:max-w-none max-sm:flex-1`}>
          <option value="">All projects</option>
          {[...projects.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([slug, title]) => <option key={slug} value={slug}>{title}</option>)}
        </select>
      </div>
      {err && <div className="mb-3 text-[13px] text-err">{err}</div>}
      {loading && !doc ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-text-muted" /></div>
        : sittings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center text-[15px] text-text-muted">
            {filtered ? "No prompts match." : `No prompts this ${sel.kind}.`}
          </div>
        ) : (
          <div className="space-y-3">
            {sittings.map((s) => <SittingCard key={s.id} s={s} focusTs={focusTs} phone={phone} />)}
          </div>
        )}
    </div>
  );
}

