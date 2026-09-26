// Retrospect > Projects. Everything the user has been building, from their
// whole prompt history across every AI tool, each with a replay brief a future
// model can rebuild it from. The engine does the work (`prevail projects`);
// this view reads the index, shows a project's arc, and hands out the replay
// prompt. The raw prompts stay untouched in the capture streams; each pack
// keeps a readable copy (prompts.md) and an exact one (prompts.jsonl).
import { useEffect, useMemo, useState } from "react";
import {
  Bot, Check, ClipboardCopy, FileText, FolderPlus, History, Lightbulb, ListTodo, Loader2, Plug, RefreshCw,
  Repeat, Sparkles, Target, Timer, type LucideIcon,
} from "lucide-react";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { domainColor } from "./helpers";
import { domainIcon } from "./icons";
import { useIsPhone } from "./useisphone";

export interface ProjectIntent { title: string; goal: string; status: string }
export interface ProjectEntry {
  slug: string; title: string; domain: string; kind: string; summary: string;
  status: "active" | "dormant" | "done";
  prompt_count: number; first_ts: number; last_ts: number;
  monthly: Record<string, number>; tools: Record<string, number>;
  pack_dir: string; brief_model: string; brief_ts: number;
  intents: ProjectIntent[]; takeaways: string[]; ideas: string[]; open_questions: string[];
}
export interface Recommendation { kind: "task" | "skill" | "app" | "habit" | "automation" | "project"; title: string; why: string; domain?: string; project?: string }
export interface ProjectsIndex {
  generated_ts: number; model: string;
  stats?: { records: number; kept: number; internal: number; program?: number; projects: number; unassigned: number };
  months?: Record<string, number>;
  projects: ProjectEntry[]; recommendations: Recommendation[]; recommendations_model?: string;
}

const REC_ICON: Record<Recommendation["kind"], LucideIcon> = {
  task: ListTodo, skill: Sparkles, app: Plug, habit: Repeat, automation: Timer, project: FolderPlus,
};
const REC_LABEL: Record<Recommendation["kind"], string> = {
  task: "Tasks", skill: "Skills to write", app: "Apps to connect", habit: "Habits", automation: "Automations", project: "Projects",
};
const STATUS_TONE: Record<ProjectEntry["status"], string> = {
  active: "bg-ok/15 text-ok", dormant: "bg-surface-warm text-text-muted", done: "bg-accent-soft text-accent",
};

const fmtDay = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtSpan = (a: number, b: number) => {
  const A = new Date(a); const B = new Date(b);
  const sameYear = A.getFullYear() === B.getFullYear();
  const left = A.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  return `${left} to ${fmtDay(b)}`;
};
// "claude-fable-5-1" -> "Fable 5.1", "gpt-6-astra" -> "GPT-6 Astra"
export function modelName(id: string): string {
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const g = id.match(/^gpt-(\d+(?:\.\d+)?)(?:-(.+))?$/i);
  if (g) return `GPT-${g[1]}${g[2] ? ` ${g[2].split("-").map(cap).join(" ")}` : ""}`;
  const m = id.replace(/^claude-/, "").match(/^([a-z]+)-(\d+)(?:-(\d+))?$/i);
  if (m) return `${cap(m[1])} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
  return id;
}

// Every month from the first to the last in `months`, so gaps show as gaps.
export function monthSpan(first: number, last: number): string[] {
  const out: string[] = [];
  const d = new Date(new Date(first).getFullYear(), new Date(first).getMonth(), 1);
  const end = new Date(new Date(last).getFullYear(), new Date(last).getMonth(), 1);
  while (d <= end && out.length < 120) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

function Sparkline({ monthly, months, color }: { monthly: Record<string, number>; months: string[]; color: string }) {
  const max = Math.max(1, ...months.map((m) => monthly[m] ?? 0));
  return (
    <div className="flex h-5 items-end gap-[2px]" aria-hidden>
      {months.map((m) => {
        const n = monthly[m] ?? 0;
        return <span key={m} className="w-1.5 rounded-sm" style={{ height: n ? `${Math.max(12, (n / max) * 100)}%` : "2px", backgroundColor: n ? color : "var(--color-border)" }} />;
      })}
    </div>
  );
}

function DomainPill({ domain }: { domain: string }) {
  const c = domainColor(domain);
  const Icon = domainIcon(domain);
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide" style={{ color: c, backgroundColor: `${c}1f` }}>
      {Icon && <Icon size={11} aria-hidden />}{titleCase(domain)}
    </span>
  );
}

function CopyButton({ label, busyLabel, get, primary }: { label: string; busyLabel: string; get: () => Promise<string>; primary?: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "err">("idle");
  return (
    <button
      onClick={async () => {
        setState("busy");
        try { await navigator.clipboard.writeText(await get()); setState("done"); setTimeout(() => setState("idle"), 1800); }
        catch { setState("err"); setTimeout(() => setState("idle"), 2500); }
      }}
      className={`inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13px] font-medium transition-colors ${primary ? "bg-accent text-background hover:bg-accent-hover" : "border border-border bg-background text-text-secondary hover:border-accent-border hover:text-accent"}`}
    >
      {state === "busy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state === "done" ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
      {state === "busy" ? busyLabel : state === "done" ? "Copied" : state === "err" ? "Could not copy" : label}
    </button>
  );
}

function ListBlock({ icon: Icon, title, items }: { icon: LucideIcon; title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section className="mt-7">
      <h3 className="mb-2.5 flex items-center gap-2 font-display text-lg font-semibold text-text-primary"><Icon className="h-4 w-4 text-accent" />{title}</h3>
      <ul className="space-y-1.5">
        {items.map((t, i) => <li key={i} className="flex gap-2.5 text-[14px] leading-snug text-text-secondary"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-text-muted" />{t}</li>)}
      </ul>
    </section>
  );
}

function Recommendations({ recs, vaultPath }: { recs: Recommendation[]; vaultPath: string }) {
  const [added, setAdded] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const order: Recommendation["kind"][] = ["task", "skill", "automation", "app", "habit", "project"];
    return order.map((k) => ({ kind: k, items: recs.filter((r) => r.kind === k) })).filter((g) => g.items.length);
  }, [recs]);
  if (!recs.length) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map(({ kind, items }) => {
        const Icon = REC_ICON[kind];
        return (
          <section key={kind} className="rounded-xl border border-border-subtle bg-surface p-4">
            <h3 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-text-primary"><Icon className="h-4 w-4 text-accent" />{REC_LABEL[kind]}</h3>
            <div className="space-y-3">
              {items.map((r) => {
                const key = `${r.kind}:${r.title}`;
                return (
                  <div key={key} className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-medium leading-snug text-text-primary">{r.title}</div>
                      <div className="mt-0.5 text-[13px] leading-snug text-text-muted">{r.why}{r.project ? <span className="text-text-secondary"> · {r.project}</span> : null}</div>
                    </div>
                    {kind === "task" && (
                      <button
                        disabled={added.has(key)}
                        onClick={() => {
                          void invoke("tasks_add", { vault: vaultPath, domain: r.domain || "general", text: r.title, source: "projects" })
                            .then(() => { setAdded((s) => new Set(s).add(key)); window.dispatchEvent(new Event("prevail:tasks-changed")); })
                            .catch(() => {});
                        }}
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] text-text-secondary transition-colors hover:border-accent-border hover:text-accent disabled:border-transparent disabled:text-ok"
                      >
                        {added.has(key) ? <><Check className="h-3.5 w-3.5" /> Added</> : "Add task"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function ProjectsView({ vaultPath }: { vaultPath: string }) {
  const phone = useIsPhone();
  const [idx, setIdx] = useState<ProjectsIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null); // slug, or "" = overview
  const [show, setShow] = useState<"active" | "all">("all");
  const [building, setBuilding] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    invoke<ProjectsIndex>("projects_index", { vault: vaultPath })
      .then((d) => { setIdx(d); setErr(null); })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  };
  useEffect(load, [vaultPath]);

  const build = async (slug?: string) => {
    setBuilding(slug ?? "all");
    try {
      const d = await invoke<ProjectsIndex>("projects_build", { vault: vaultPath, rebrief: !!slug, only: slug ? [slug] : null });
      setIdx(d); setErr(null);
    } catch (e) { setErr(String(e)); }
    finally { setBuilding(null); }
  };

  const projects = useMemo(() => (idx?.projects ?? []).filter((p) => show === "all" || p.status === "active"), [idx, show]);
  const months = useMemo(() => {
    const all = idx?.projects ?? [];
    if (!all.length) return [];
    return monthSpan(Math.min(...all.map((p) => p.first_ts)), Math.max(...all.map((p) => p.last_ts))).slice(-12);
  }, [idx]);
  const cur = (idx?.projects ?? []).find((p) => p.slug === sel) ?? null;
  const readPack = async (file: string) => invoke<string>("read_text_file", { path: `${vaultPath.replace(/\/+$/, "")}/${cur!.pack_dir}/${file}` });
  const openCanvas = (title: string, body: string) => window.dispatchEvent(new CustomEvent("prevail:open-canvas", { detail: { title, body } }));

  if (loading && !idx) return <div className="p-8 text-[13px] text-text-muted">Reading your projects…</div>;
  if (!idx || idx.projects.length === 0) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <h2 className="font-display text-2xl font-semibold text-text-primary">Turn your prompts into projects</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-text-secondary">
          Prevail reads every prompt you have typed, in every AI tool, groups them by what you were building, and writes each project a replay brief: one prompt that carries every requirement and correction, so a newer model can rebuild it without the back-and-forth. Your original prompts are never changed.
        </p>
        <button onClick={() => build()} disabled={!!building} className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-[14px] font-semibold text-background hover:bg-accent-hover disabled:opacity-60">
          {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {building ? "Building. This takes a while the first time." : "Build my projects"}
        </button>
        {err && <div className="mt-4 text-[13px] text-err">{err}</div>}
      </div>
    );
  }

  const list = (
    <div className={`${phone ? "" : "w-72 shrink-0 border-r border-border"} overflow-y-auto bg-surface/40 p-2`}>
      <div className="flex items-center gap-1 px-1.5 pb-2 pt-1">
        {(["all", "active"] as const).map((k) => (
          <button key={k} onClick={() => setShow(k)} className={`inline-flex h-7 items-center rounded-md px-2.5 text-[12px] ${show === k ? "bg-surface font-semibold text-text-primary shadow-sm ring-1 ring-black/5" : "text-text-muted hover:text-text-secondary"}`}>
            {k === "all" ? `All ${idx.projects.length}` : `Active ${idx.projects.filter((p) => p.status === "active").length}`}
          </button>
        ))}
      </div>
      <button onClick={() => setSel(null)} className={`mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left ${sel === null ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
        <Target className="h-4 w-4 shrink-0 text-accent" />
        <span className={`text-[13px] ${sel === null ? "font-semibold text-text-primary" : "text-text-secondary"}`}>Overview and recommendations</span>
      </button>
      {projects.map((p) => {
        const on = p.slug === sel;
        return (
          <button key={p.slug} onClick={() => setSel(p.slug)} className={`mb-1 flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
            <div className="min-w-0 flex-1">
              <div className={`truncate text-[13px] ${on ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{p.title}</div>
              <div className="mt-0.5 text-[11px] text-text-muted">{p.prompt_count} prompts · {new Date(p.last_ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
            </div>
            <Sparkline monthly={p.monthly} months={months} color={domainColor(p.domain)} />
          </button>
        );
      })}
    </div>
  );

  const header = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-subtle px-6 py-3 text-[12px] text-text-muted">
      <span>{idx.stats ? `${idx.stats.kept.toLocaleString()} of your prompts, ${idx.projects.length} projects` : `${idx.projects.length} projects`}</span>
      {idx.model && <span className="inline-flex items-center gap-1"><Bot className="h-3.5 w-3.5" /> briefs by {modelName(idx.model)}</span>}
      <span>updated {fmtDay(idx.generated_ts)}</span>
      <button onClick={() => build()} disabled={!!building} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-60">
        {building === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {building === "all" ? "Refreshing" : "Refresh"}
      </button>
    </div>
  );

  const detail = cur ? (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-center gap-2">
        <DomainPill domain={cur.domain} />
        <span className={`rounded-md px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide ${STATUS_TONE[cur.status]}`}>{cur.status}</span>
      </div>
      <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-text-primary">{cur.title}</h2>
      {cur.summary && <p className="mt-1.5 text-[15px] leading-snug text-text-secondary">{cur.summary}</p>}
      <div className="mt-2 text-[12px] text-text-muted">
        {cur.prompt_count} prompts · {fmtSpan(cur.first_ts, cur.last_ts)} · {Object.entries(cur.tools).sort((a, b) => b[1] - a[1]).map(([t]) => titleCase(t)).join(", ")}
      </div>

      <div className="mt-5 rounded-xl border border-border-subtle bg-surface p-4">
        <div className="mb-2 text-[12px] text-text-muted">Prompts per month</div>
        <div className="flex h-16 items-end gap-1.5">
          {monthSpan(cur.first_ts, cur.last_ts).map((m) => {
            const n = cur.monthly[m] ?? 0;
            const max = Math.max(1, ...Object.values(cur.monthly));
            return (
              <div key={m} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${m}: ${n}`}>
                <div className="w-full max-w-10 rounded-sm" style={{ height: n ? `${Math.max(8, (n / max) * 48)}px` : "2px", backgroundColor: n ? domainColor(cur.domain) : "var(--color-border)" }} />
                <span className="text-[10px] text-text-muted">{new Date(`${m}-15`).toLocaleDateString(undefined, { month: "short" })}</span>
              </div>
            );
          })}
        </div>
      </div>

      <section className="mt-6 rounded-xl border border-accent-border bg-accent-soft/40 p-4">
        <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-text-primary"><History className="h-4 w-4 text-accent" />Replay with a newer model</h3>
        <p className="mt-1 text-[13px] leading-snug text-text-secondary">
          {cur.brief_model
            ? <>The brief packs every requirement, correction and decision from these {cur.prompt_count} prompts into one prompt. Paste it into any model or coding agent to rebuild {cur.title}. Written by {modelName(cur.brief_model)} on {fmtDay(cur.brief_ts)}.</>
            : <>No brief yet: projects under five prompts get none. The prompts themselves are saved.</>}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {cur.brief_model && <CopyButton primary label="Copy replay brief" busyLabel="Copying" get={() => invoke<string>("projects_replay", { vault: vaultPath, slug: cur.slug, withPrompts: false })} />}
          {cur.brief_model && <CopyButton label="Brief and every prompt" busyLabel="Copying" get={() => invoke<string>("projects_replay", { vault: vaultPath, slug: cur.slug, withPrompts: true })} />}
          {cur.brief_model && (
            <button onClick={() => { void readPack("brief.md").then((b) => openCanvas(`${cur.title}: replay brief`, b.replace(/^<!--.*?-->\n/, ""))).catch(() => {}); }}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3.5 text-[13px] font-medium text-text-secondary hover:border-accent-border hover:text-accent">
              <FileText className="h-3.5 w-3.5" /> Read brief
            </button>
          )}
          <button onClick={() => { void readPack("prompts.md").then((b) => openCanvas(`${cur.title}: every prompt`, b)).catch(() => {}); }}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3.5 text-[13px] font-medium text-text-secondary hover:border-accent-border hover:text-accent">
            <FileText className="h-3.5 w-3.5" /> Every prompt
          </button>
          <button onClick={() => void build(cur.slug)} disabled={!!building}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3.5 text-[13px] font-medium text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-60">
            {building === cur.slug ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {building === cur.slug ? "Rewriting" : "Rewrite brief"}
          </button>
        </div>
      </section>

      {cur.intents.length > 0 && (
        <section className="mt-7">
          <h3 className="mb-2.5 flex items-center gap-2 font-display text-lg font-semibold text-text-primary"><Target className="h-4 w-4 text-accent" />Intents</h3>
          <div className="divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface">
            {cur.intents.map((it, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-text-primary">{it.title}</div>
                  <div className="mt-0.5 text-[13px] leading-snug text-text-muted">{it.goal}</div>
                </div>
                <span className={`shrink-0 rounded-md px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide ${STATUS_TONE[(it.status as ProjectEntry["status"]) in STATUS_TONE ? (it.status as ProjectEntry["status"]) : "dormant"]}`}>{it.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <ListBlock icon={Check} title="Takeaways" items={cur.takeaways} />
      <ListBlock icon={Lightbulb} title="Ideas not built yet" items={cur.ideas} />
      <ListBlock icon={Target} title="Open questions" items={cur.open_questions} />
    </div>
  ) : (
    <div className="max-w-5xl">
      <h2 className="font-display text-3xl font-semibold tracking-tight text-text-primary">What would move you forward</h2>
      <p className="mt-1.5 max-w-2xl text-[14px] leading-snug text-text-secondary">
        Read from all {idx.projects.length} projects and the {idx.stats?.kept.toLocaleString() ?? ""} prompts behind them{idx.recommendations_model ? `, by ${modelName(idx.recommendations_model)}` : ""}.
      </p>
      <div className="mt-6"><Recommendations recs={idx.recommendations} vaultPath={vaultPath} /></div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      {err && <div className="border-b border-border-subtle bg-surface px-6 py-2 text-[12px] text-err">{err}</div>}
      {phone ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sel === null && list}
          <div className="p-4">
            {sel !== null && <button onClick={() => setSel(null)} className="mb-3 text-[13px] text-accent">All projects</button>}
            {detail}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {list}
          <div className="min-w-0 flex-1 overflow-y-auto p-6">{detail}</div>
        </div>
      )}
    </div>
  );
}
