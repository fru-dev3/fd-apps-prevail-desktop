// Intent (module name mirror.tsx): one place to look back at yourself through your own prompts.
//   Noticed   a few findings the engine drew from every prompt you typed
//             (`prevail intent findings`), one featured, each with receipts and
//             a verdict you can give it (make it a rule, resume, let go...).
//   History   the play-by-play: every sitting in every tool, week by week, the
//             prompts exactly as typed (`prevail intent history`).
//   Projects  what those prompts were building, each with a restart brief a
//             newer model can rebuild it from (projectsview.tsx).
// The header's tool dots show which tools are captured; a click opens the
// capture setup in a drawer.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, ChevronUp, ClipboardCopy, Clock, FolderKanban, History, Loader2,
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
  const jumpToPrompt = (ts: number) => { setFocus((f) => ({ ts, n: (f?.n ?? 0) + 1 })); setView("history"); };
  // An entity card's "Mentioned in" row lands on that sitting in History,
  // whether Intent was already open (event) or opens because of it (pending).
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
              className={`h-9 rounded-md px-4 text-[14px] max-sm:flex-1 ${view === v.id ? "bg-background font-semibold text-text-primary shadow-sm" : "text-text-muted hover:text-text-secondary"}`}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="ml-auto"><ToolDots vaultPath={vaultPath} onOpen={() => setCapture(true)} /></div>
      </div>
      <div className="min-h-0 flex-1">
        {view === "noticed" && <NoticedView vaultPath={vaultPath} phone={phone} onReceipt={jumpToPrompt} onProject={openProject} />}
        {view === "history" && <HistoryView vaultPath={vaultPath} phone={phone} focus={focus} onClearFocus={() => setFocus(null)} />}
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
    <button onClick={onOpen} data-testid="quiet-finding" className="flex h-full flex-col rounded-xl border border-border-subtle bg-surface p-5 text-left hover:border-accent-border">
      <div className="font-display text-xl font-semibold leading-snug text-text-primary">{f.headline}</div>
      <div className="mt-2 line-clamp-2 text-[14px] leading-snug text-text-muted">{f.detail}</div>
      <span className="mt-auto inline-flex items-center gap-1 pt-4 text-[13px] font-medium text-accent">Look closer <ArrowRight className="h-3.5 w-3.5" /></span>
    </button>
  );
}

function NoticedView({ vaultPath, phone, onReceipt, onProject }: { vaultPath: string; phone: boolean; onReceipt: (ts: number) => void; onProject: (slug: string) => void }) {
  const [doc, setDoc] = useState<FindingsDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<string | null>(null);
  const [featuredId, setFeaturedId] = useState<string | null>(null);
  const [letterOpen, setLetterOpen] = useState(!phone);

  const load = useCallback(() => {
    setLoading(true);
    return invoke<FindingsDoc>("mirror_findings", { vault: vaultPath })
      .then((d) => { setDoc(d && Array.isArray(d.findings) ? d : { generated_ts: 0, letter: null, findings: [] }); setErr(null); })
      .catch((e) => { setDoc({ generated_ts: 0, letter: null, findings: [] }); setErr(String(e)); })
      .finally(() => setLoading(false));
  }, [vaultPath]);
  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try { await invoke("mirror_refresh", { vault: vaultPath }); await load(); }
    catch (e) { setErr(String(e)); }
    finally { setRefreshing(false); }
  };

  const shown = useMemo(() => visibleFindings(doc).filter((f) => !done.has(f.id)), [doc, done]);
  const featured = shown.find((f) => f.id === featuredId) ?? shown[0] ?? null;
  const rest = shown.filter((f) => f !== featured).slice(0, 2);

  const verdict = async (f: Finding, v: string, opts?: { item?: string; rule?: string; whole?: boolean }) => {
    try {
      await invoke("mirror_verdict", { vault: vaultPath, findingId: f.id, verdict: v, item: opts?.item ?? null, rule: opts?.rule ?? null });
    } catch (e) { setErr(String(e)); return; }
    if (!opts?.whole) return;
    setLeaving(f.id);
    setTimeout(() => { setDone((d) => new Set(d).add(f.id)); setLeaving(null); setFeaturedId(null); }, 280);
  };

  if (loading && !doc) return <div className="p-8 text-[15px] text-text-muted">Looking back over your prompts...</div>;

  const letter = doc?.letter;
  const letterBlock = letter && (
    <section className="rounded-2xl border border-accent-border bg-accent-soft/30 p-5 sm:p-6" data-testid="letter">
      <button onClick={() => setLetterOpen((o) => !o)} className="flex w-full items-center gap-2.5 text-left">
        <BookOpen className="h-5 w-5 shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-text-muted">This week</span>
          <span className="block font-display text-2xl font-semibold text-text-primary">{letter.title}</span>
        </span>
        {letterOpen ? <ChevronUp className="h-5 w-5 text-text-muted" /> : <ChevronDown className="h-5 w-5 text-text-muted" />}
      </button>
      {letterOpen && <div className="mt-3 max-w-3xl text-[15px] leading-relaxed text-text-secondary"><Markdown source={letter.markdown} /></div>}
    </section>
  );

  if (!featured) {
    return (
      <div className={phone ? "space-y-5 p-4" : "mx-auto max-w-4xl space-y-6 px-8 py-8"}>
        {letterBlock}
        <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
          <ScanFace className="mx-auto h-10 w-10 text-accent" />
          <h2 className="mt-3 font-display text-3xl font-semibold text-text-primary">Nothing noticed yet</h2>
          <p className="mx-auto mt-2 max-w-lg text-[15px] leading-relaxed text-text-secondary">
            Intent reads every prompt you have typed, in every tool, and points out what you might not see yourself: instructions you keep repeating, projects left open, where your hours really go. Findings you answer stay answered.
          </p>
          <button onClick={() => void refresh()} disabled={refreshing} className={`${btnPrimary} mt-5 h-11 px-5`}>
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{refreshing ? "Looking" : "Refresh"}
          </button>
          {err && <div className="mt-3 text-[13px] text-err">{err}</div>}
        </div>
      </div>
    );
  }

  const idx = shown.indexOf(featured);
  const fe = (
    <FeaturedFinding key={featured.id} f={featured} phone={phone} leaving={leaving === featured.id}
      onVerdict={(v, o) => verdict(featured, v, o)} onReceipt={onReceipt} onProject={onProject} />
  );

  if (phone) {
    return (
      <div className="space-y-4 p-4">
        {letterBlock}
        {fe}
        {shown.length > 1 && (
          <div className="flex items-center gap-2">
            <button aria-label="Previous finding" disabled={idx <= 0} onClick={() => setFeaturedId(shown[idx - 1]?.id ?? null)} className={`${btnGhost} h-12 w-12`}><ArrowLeft className="h-5 w-5" /></button>
            <span className="flex-1 text-center text-[14px] tabular-nums text-text-muted">{idx + 1} of {shown.length}</span>
            <button aria-label="Next finding" disabled={idx >= shown.length - 1} onClick={() => setFeaturedId(shown[idx + 1]?.id ?? null)} className={`${btnGhost} h-12 w-12`}><ArrowRight className="h-5 w-5" /></button>
          </div>
        )}
        {err && <div className="text-[13px] text-err">{err}</div>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-8 py-8">
      {letterBlock}
      {fe}
      {rest.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {rest.map((f) => <QuietCard key={f.id} f={f} onOpen={() => setFeaturedId(f.id)} />)}
        </div>
      )}
      <div className="flex items-center gap-3 text-[13px] text-text-muted">
        {doc?.generated_ts ? <span>Read {fmtDate(doc.generated_ts)}</span> : null}
        <button onClick={() => void refresh()} disabled={refreshing} className="inline-flex items-center gap-1.5 text-accent hover:underline disabled:opacity-60">
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Refresh
        </button>
        {err && <span className="text-err">{err}</span>}
      </div>
    </div>
  );
}

// ── History ─────────────────────────────────────────────────────────────────
const LONG_CHARS = 600;
const LONG_LINES = 10;

function PromptText({ p, focused, phone }: { p: HistPrompt; focused: boolean; phone: boolean }) {
  const chars = phone ? LONG_CHARS / 2 : LONG_CHARS;
  const lines = phone ? LONG_LINES / 2 : LONG_LINES;
  const long = p.text.length > chars || p.text.split("\n").length > lines;
  const [open, setOpen] = useState(false);
  const shown = long && !open ? `${p.text.split("\n").slice(0, lines).join("\n").slice(0, chars)}...` : p.text;
  return (
    <div data-prompt-ts={p.ts} className={`group flex gap-2 rounded-lg px-3 py-2 ${phone ? "flex-wrap" : ""} ${focused ? "bg-accent-soft ring-1 ring-accent-border" : "hover:bg-surface-warm/60"}`}>
      <span className={`shrink-0 pt-0.5 text-[12px] tabular-nums text-text-muted ${phone ? "order-first basis-[calc(100%-2.5rem)]" : "w-16"}`}>{fmtTime(p.ts)}</span>
      <div className={`min-w-0 flex-1 ${phone ? "order-last basis-full" : ""}`}>
        <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-text-primary">{shown}</div>
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

function mergeWeeks(prev: HistWeek[], next: HistWeek[]): HistWeek[] {
  const out = prev.map((w) => ({ ...w, sittings: [...w.sittings] }));
  for (const w of next) {
    const hit = out.find((o) => o.week === w.week);
    if (hit) { const ids = new Set(hit.sittings.map((s) => s.id)); hit.sittings.push(...w.sittings.filter((s) => !ids.has(s.id))); hit.intent_line = hit.intent_line ?? w.intent_line; }
    else out.push({ ...w, sittings: [...w.sittings] });
  }
  return out;
}

function HistoryView({ vaultPath, phone, focus, onClearFocus }: { vaultPath: string; phone: boolean; focus: { ts: number; n: number } | null; onClearFocus: () => void }) {
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [tool, setTool] = useState("");
  const [project, setProject] = useState("");
  const [weeks, setWeeks] = useState<HistWeek[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [projects, setProjects] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [end, setEnd] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reqRef = useRef(0);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const focusTs = focus?.ts ?? null;

  useEffect(() => { const t = setTimeout(() => setQDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const fetchPage = useCallback(async (before: number | null, reset: boolean) => {
    const id = ++reqRef.current;
    setLoading(true);
    try {
      const d = await invoke<HistoryDoc>("mirror_history", {
        vault: vaultPath, q: qDebounced || null, tool: tool || null, project: project || null, before, limit: 200,
      });
      if (id !== reqRef.current) return;
      const got = Array.isArray(d?.weeks) ? d.weeks : [];
      setWeeks((w) => reset ? got : mergeWeeks(w, got));
      if (Array.isArray(d?.tools) && d.tools.length) setTools(d.tools);
      if (typeof d?.total === "number") setTotal(d.total);
      setProjects((m) => { const n = new Map(m); for (const w of got) for (const s of w.sittings) if (s.project) n.set(s.project, s.project_title || s.project); return n; });
      setEnd(got.every((w) => w.sittings.length === 0));
      setErr(null);
    } catch (e) { if (id === reqRef.current) { setErr(String(e)); setEnd(true); } }
    finally { if (id === reqRef.current) setLoading(false); }
  }, [vaultPath, qDebounced, tool, project]);

  // A receipt jump opens the page holding that prompt, with no filters.
  const focusBefore = focus ? focus.ts + 1 : null;
  useEffect(() => { void fetchPage(focusBefore, true); }, [fetchPage, focusBefore]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (focusTs == null) return;
    const el = document.querySelector(`[data-prompt-ts="${focusTs}"]`);
    if (el && "scrollIntoView" in el) (el as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
  }, [weeks, focusTs]);

  const oldest = useMemo(() => {
    let min = Infinity;
    for (const w of weeks) for (const s of w.sittings) min = Math.min(min, s.start_ts);
    return Number.isFinite(min) ? min : null;
  }, [weeks]);
  const loadOlder = useCallback(() => { if (!loading && !end && oldest != null) void fetchPage(oldest, false); }, [loading, end, oldest, fetchPage]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadOlder(); }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadOlder]);

  const clearFocus = () => { onClearFocus(); };
  const sel = "h-10 rounded-lg border border-border bg-surface px-3 text-[14px] text-text-secondary focus:border-accent-border focus:outline-none";

  return (
    <div className={phone ? "px-3 py-3" : "mx-auto max-w-4xl px-8 py-6"}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input value={q} onChange={(e) => { setQ(e.target.value); if (focus) clearFocus(); }} placeholder="Search every prompt" aria-label="Search prompts"
            className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-[15px] text-text-primary focus:border-accent-border focus:outline-none" />
        </label>
        <select aria-label="Tool" value={tool} onChange={(e) => { setTool(e.target.value); if (focus) clearFocus(); }} className={`${sel} max-sm:flex-1`}>
          <option value="">All tools</option>
          {tools.map((t) => <option key={t} value={t}>{toolLabel(t)}</option>)}
        </select>
        <select aria-label="Project" value={project} onChange={(e) => { setProject(e.target.value); if (focus) clearFocus(); }} className={`${sel} max-w-[14rem] max-sm:max-w-none max-sm:flex-1`}>
          <option value="">All projects</option>
          {[...projects.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([slug, title]) => <option key={slug} value={slug}>{title}</option>)}
        </select>
      </div>
      <div className="mb-4 flex items-center gap-3 text-[13px] text-text-muted">
        <span>{total ? `${total.toLocaleString()} prompts` : ""}</span>
        {focus && <button onClick={clearFocus} className="inline-flex items-center gap-1 font-medium text-accent hover:underline"><History className="h-3.5 w-3.5" />Back to newest</button>}
      </div>
      {err && <div className="mb-3 text-[13px] text-err">{err}</div>}
      {!loading && weeks.every((w) => w.sittings.length === 0) && (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center text-[15px] text-text-muted">
          {qDebounced || tool || project ? "No prompts match." : "No prompts captured yet. Turn on capture for your tools and they show up here as you work."}
        </div>
      )}
      <div className="space-y-8">
        {weeks.filter((w) => w.sittings.length > 0).map((w) => (
          <section key={w.week} data-testid="week">
            <div className="sticky top-0 z-10 -mx-2 mb-3 border-b border-border-subtle bg-background/95 px-2 py-3 backdrop-blur">
              <h2 className="font-display text-2xl font-semibold text-text-primary">{w.label}</h2>
              {w.intent_line && <p className="mt-0.5 text-[15px] leading-snug text-text-secondary">{w.intent_line}</p>}
            </div>
            <div className="space-y-3">
              {w.sittings.map((s) => <SittingCard key={s.id} s={s} focusTs={focusTs} phone={phone} />)}
            </div>
          </section>
        ))}
      </div>
      <div ref={sentinel} className="flex justify-center py-6">
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
          : !end && oldest != null ? <button onClick={loadOlder} className={`${btnGhost} h-10 px-4`}>Load older</button> : null}
      </div>
    </div>
  );
}
