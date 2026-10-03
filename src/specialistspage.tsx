// Specialists: the team the chief of staff staffs jobs with. SideSpine:
//   Jobs        Running, Waiting on you, Done (each job opens as its card)
//   Setup       the chief of staff: name, handoff, limits, never pull in, what
//               they learned
//   families    Know, Decide, Do, Grow, Deliver (the built-in specialists)
//   Yours       the user's own: made by talking, presets from a pack, outside agents
//   Off         any specialist turned off
// A specialist's detail: what it is for, how it works, its ceiling, budget
// and tools, its notebooks per domain, and the jobs it worked on.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChiefAvatar, SpecialistAvatar, useWorkingSpecialists } from "./specialistavatar";
import { dropSpecialist, startPillDrag } from "./dragref";
import { AlertTriangle, Archive, BookOpen, Briefcase, Check, ChevronRight, Clock, Globe, Hourglass, Loader2, Pencil, Plus, RotateCcw, Search, UserCog } from "lucide-react";
import { NewSpecialist, originLine } from "./specialistnew";
import { invoke } from "./bridge";
import { invalidateQueries, useInvokeQuery } from "./query";
import { SettingsHeader } from "./sectionutil";
import { SideSpine } from "./sidespine";
import { useIsPhone } from "./useisphone";
import { BODY, DETAIL_TITLE, META, ROW_TITLE, SECTION_TITLE } from "./typescale";
import { RowMenu, StatusDot } from "./ui";
import { JobCard } from "./jobcard";
import { AppRowLogo } from "./panels3";
import { useChiefOfStaff } from "./chiefofstaff";
import { CEILINGS, CEILING_LABEL, CEILING_SAYS, FAMILY_LABEL, HANDOFF_LABEL, RUNTIME_LABEL, SPECIALIST_TOOLS, ceilingRank, draftOf, editOf, jobGroups, jobStatusLabel, jobTone, label, loosens, scopeLabel, toolLabel, type Job, type Specialist, type SpecialistDraft } from "./plansmodel";

export const SPECIALISTS_FOCUS_KEY = "prevail.specialists.focus";
const input = "h-9 w-full max-w-sm rounded-md border border-border bg-background px-2.5 text-[14px] text-text-primary";

type Sel = "jobs:running" | "jobs:waiting" | "jobs:done" | "setup" | "new" | `spec:${string}`;

function readFocus(): Sel {
  try { const f = localStorage.getItem(SPECIALISTS_FOCUS_KEY); localStorage.removeItem(SPECIALISTS_FOCUS_KEY); if (f) return f as Sel; } catch { /* storage off */ }
  return "jobs:running";
}

export function SpecialistsPage({ vaultPath }: { vaultPath: string }) {
  const phone = useIsPhone();
  const [sel, setSel] = useState<Sel>(readFocus);
  const [picked, setPicked] = useState(false);
  useEffect(() => {
    const on = () => { setSel(readFocus()); setPicked(true); };
    window.addEventListener("prevail:specialists-focus", on);
    return () => window.removeEventListener("prevail:specialists-focus", on);
  }, []);
  const specsQ = useInvokeQuery<Specialist[]>("engine_specialists", { vault: vaultPath }, { staleMs: 60_000 });
  const jobsQ = useInvokeQuery<Job[]>("engine_jobs", { vault: vaultPath }, { staleMs: 5_000 });
  const specs = useMemo(() => (Array.isArray(specsQ.data) ? specsQ.data : []), [specsQ.data]);
  const jobs = useMemo(() => (Array.isArray(jobsQ.data) ? jobsQ.data : []), [jobsQ.data]);
  const groups = jobGroups(jobs);
  const on = specs.filter((s) => s.on);
  const working = useWorkingSpecialists(vaultPath);
  const chief = useChiefOfStaff(vaultPath);
  const off = specs.filter((s) => !s.on);
  const [offOpen, setOffOpen] = useState(false);
  const choose = (s: Sel) => { setSel(s); setPicked(true); };
  const isOn = (s: Sel) => sel === s && (!phone || picked);
  const icon = (s: Sel, I: typeof Search) => <I className={`h-4 w-4 shrink-0 ${isOn(s) ? "text-accent" : "text-text-muted"}`} />;
  const row = (s: Sel, text: string, lead: ReactNode, count?: number, sub?: string, drag?: string) => (
    <button key={s} data-testid={`specialists-row-${s}`} aria-current={isOn(s) ? "true" : undefined} onClick={() => choose(s)}
      onMouseDown={drag ? (e) => startPillDrag(e, `@${drag}`, (ev) => { dropSpecialist(ev, drag); }) : undefined}
      title={drag ? `${text}: drag into a chat, or onto Home, a domain or a project in the sidebar, to hand it a message` : undefined}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${isOn(s) ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
      {lead}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[14px] ${isOn(s) ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{text}</span>
        {sub && <span className="block truncate text-[12px] text-text-muted">{sub}</span>}
      </span>
      {count !== undefined && <span className="shrink-0 text-[12px] tabular-nums text-text-muted">{count}</span>}
    </button>
  );
  const head = (t: string) => <div className="px-2.5 pb-1 pt-3 text-[13px] font-semibold text-text-secondary">{t}</div>;
  const builtOn = on.filter((s) => s.builtIn);
  const yours = on.filter((s) => !s.builtIn);
  const families = (["know", "decide", "do", "grow", "deliver"] as const).filter((f) => builtOn.some((s) => s.family === f));
  const column = (
    <nav className="space-y-0.5 p-2" aria-label="Specialists">
      {head("Jobs")}
      {row("jobs:running", "Running", icon("jobs:running", Clock), groups.running.length)}
      {row("jobs:waiting", "Waiting on you", icon("jobs:waiting", Hourglass), groups.waiting.length)}
      {row("jobs:done", "Done", icon("jobs:done", Briefcase), groups.done.length)}
      {row("setup", chief ?? "Chief of staff", <ChiefAvatar size={24} />, undefined, chief ? "Your chief of staff" : "Name, limits, handoff")}
      {families.map((f) => (
        <div key={f}>
          {head(FAMILY_LABEL[f])}
          {builtOn.filter((s) => s.family === f).map((s) => row(`spec:${s.id}`, s.name, <SpecialistAvatar id={s.id} size={24} state={working.has(s.id) ? "working" : "idle"} />, undefined, `Returns ${s.returns}`, s.name))}
        </div>
      ))}
      {yours.length > 0 && (
        <div>
          {head("Yours")}
          {yours.map((s) => row(`spec:${s.id}`, s.name, <SpecialistAvatar id={s.id} size={24} state={working.has(s.id) ? "working" : "idle"} />, undefined, s.outside ? "Outside agent, asks first" : s.base ? `Built on the ${label(s.base)}` : `Returns ${s.returns}`, s.name))}
        </div>
      )}
      {head("More")}
      {off.length > 0 && (
        <>
          <button onClick={() => setOffOpen((v) => !v)} aria-expanded={offOpen} className="w-full px-2.5 pb-1 pt-3 text-left text-[13px] font-semibold text-text-secondary hover:text-accent">Off ({off.length})</button>
          {offOpen && off.map((s) => row(`spec:${s.id}`, s.name, <SpecialistAvatar id={s.id} size={24} state="off" />, undefined, "Off"))}
        </>
      )}
    </nav>
  );

  let detail: React.ReactNode = null;
  if (sel.startsWith("jobs:")) {
    const k = sel.slice(5) as "running" | "waiting" | "done";
    const list = groups[k];
    detail = (
      <section data-testid="specialists-jobs">
        <h2 className={DETAIL_TITLE}>{k === "running" ? "Running" : k === "waiting" ? "Waiting on you" : "Done"}</h2>
        <p className={`${META} mt-1`}>Jobs your chief of staff staffed, and playbook runs.</p>
        {!list.length && <p className={`${META} mt-4`}>{k === "running" ? "Nothing is running." : k === "waiting" ? "Nothing waits on you." : "No finished jobs yet."}</p>}
        <ul className="mt-3 max-w-3xl">{list.map((j) => <JobRow key={j.id} job={j} vaultPath={vaultPath} />)}</ul>
      </section>
    );
  } else if (sel === "setup") {
    detail = <ChiefSetup vaultPath={vaultPath} />;
  } else if (sel === "new") {
    detail = <NewSpecialist vaultPath={vaultPath} onCancel={() => choose("jobs:running")} onMade={(id) => { void specsQ.refresh(); choose(`spec:${id}`); }} />;
  } else {
    const s = specs.find((x) => `spec:${x.id}` === sel);
    detail = s ? <SpecialistDetail s={s} vaultPath={vaultPath} jobs={jobs.filter((j) => j.team.some((t) => t.specialists.includes(s.id)))} /> : <p className={`${BODY} text-text-muted`}>Pick a specialist.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="specialists-page">
      <SettingsHeader title="Specialists" icon={UserCog} subtitle="The team your chief of staff staffs jobs with." />
      <SideSpine storageKey="prevail.specialists.spine" title="Specialists" label="specialists" testId="specialists-list"
        meta={<span>{on.length} on</span>} phone={phone}
        actions={<button onClick={() => choose("new")} title="New specialist" aria-label="New specialist" data-testid="specialist-new-open" className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-accent"><Plus className="h-4 w-4" /></button>} phoneDetail={phone && picked} onBack={() => setPicked(false)} backLabel="Specialists"
        detail={<div className={phone ? "px-4 py-4" : "w-full px-8 py-6"}>{detail}</div>}>
        {column}
      </SideSpine>
    </div>
  );
}

function JobRow({ job, vaultPath }: { job: Job; vaultPath: string }) {
  const [open, setOpen] = useState(false);
  const when = new Date(job.created).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <li data-testid="job-row" className="border-b border-border-subtle py-2.5 last:border-b-0">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-start gap-3 text-left">
        <span className="min-w-0 flex-1">
          <span title={job.ask} className={`${ROW_TITLE} line-clamp-2 break-words`}>{job.ask}</span>
          <span className={`${META} mt-0.5 block truncate`}>{job.playbook ? `Playbook ${label(job.playbook)}` : scopeLabel(job.domains.owner)} · {when}</span>
        </span>
        <StatusDot tone={jobTone(job)} label={jobStatusLabel(job)} className="mt-1" />
      </button>
      {open && !job.playbook && <JobCard id={job.id} vaultPath={vaultPath} embedded />}
      {open && job.playbook && <p className={`${BODY} mt-2 text-text-secondary`}>{job.why}</p>}
    </li>
  );
}

const field = "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[14px] text-text-primary focus:border-accent-border focus:outline-none";
const textLink = "inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline disabled:opacity-50 disabled:no-underline";
const quietLink = "inline-flex items-center gap-1 text-[13px] text-text-muted hover:text-text-primary disabled:opacity-50";
const iconAct = "flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-strong hover:text-text-primary";

function Segmented({ value, options, onChange, label: aria, disabledAbove }: { value: string; options: [string, string][]; onChange: (v: string) => void; label: string; disabledAbove?: number }) {
  return (
    <div role="group" aria-label={aria} className="inline-flex max-w-full flex-wrap overflow-hidden rounded-md border border-border">
      {options.map(([k, t], i) => (
        <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k} disabled={disabledAbove !== undefined && i > disabledAbove}
          className={`h-8 px-2.5 text-[13px] disabled:opacity-35 ${value === k ? "bg-accent-soft font-medium text-accent" : "text-text-secondary hover:text-accent"}`}>{t}</button>
      ))}
    </div>
  );
}

type SpecShow = { spec?: Specialist; notebooks?: { domain: string; lines: number; notes: boolean }[] };
type SaveReply = { ok?: boolean; error?: string; needsConfirm?: boolean; moved?: string | null };

function SpecialistDetail({ s, vaultPath, jobs }: { s: Specialist; vaultPath: string; jobs: Job[] }) {
  const show = useInvokeQuery<SpecShow>("engine_specialist_show", { vault: vaultPath, id: s.id, domain: null }, { staleMs: 60_000 });
  const full: Specialist = { ...s, ...(show.data?.spec ?? {}) };
  const notebooks = show.data?.notebooks ?? [];
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setEditing(false); setMsg(null); }, [s.id]);
  const refresh = async () => { invalidateQueries("engine_specialists"); invalidateQueries("engine_specialist_show"); await show.refresh(); };
  const reset = async () => {
    setMsg(null);
    try {
      const r = await invoke<SaveReply>("engine_specialist_reset", { vault: vaultPath, id: s.id });
      if (r?.ok === false) throw new Error(r.error ?? "not reset");
      setMsg("Back to the built-in. Your version is kept in the vault.");
      await refresh();
    } catch (e) { setMsg(`Not reset: ${String(e)}`); }
  };
  const summary: [string, string, string?][] = [
    ["Can", CEILING_SAYS[full.ceiling] ?? full.ceiling, "Enforced in code. Nothing a specialist does sends, buys or changes anything outside the vault."],
    ["Tools", [...full.tools.map(toolLabel), ...full.apps.map(label)].join(", ") || "None"],
    ["Budget", `${full.budget.minutes} min · $${full.budget.usd.toFixed(2)} · ${full.budget.passes} pass${full.budget.passes === 1 ? "" : "es"}`],
    ["Hands off", HANDOFF_LABEL[full.handoff] ?? label(full.handoff)],
  ];
  return (
    <section data-testid="specialist-detail" data-id={s.id} className="max-w-3xl">
      <div className="flex items-start gap-3">
        <SpecialistAvatar id={s.id} size={52} state={!s.on ? "off" : jobs.some((j) => j.status === "running") ? "working" : "idle"} label={s.name} className="-mt-1" />
        <div className="min-w-0 flex-1">
          <h2 className={DETAIL_TITLE}>{s.name}</h2>
          <p className={`${META} mt-0.5`}>{FAMILY_LABEL[s.family]} · Returns {s.returns}{s.source && s.builtIn ? " · Your version" : ""}{!s.builtIn ? " · Yours" : ""}{!s.on ? " · Off" : ""}</p>
          {originLine(s) && <p className={`${META} mt-0.5`} data-testid="specialist-origin" title={s.outside?.endpoint}>{originLine(s)}</p>}
        </div>
        {s.on && !editing && (
          <span className="flex shrink-0 items-center gap-0.5">
            <button onClick={() => { setEditing(true); setMsg(null); }} title="Edit" aria-label={`Edit ${s.name}`} data-testid="specialist-edit" className={iconAct}><Pencil className="h-4 w-4" /></button>
            {s.source && s.builtIn && <RowMenu items={[{ icon: RotateCcw, label: "Reset to built-in", hint: "Your version is kept", onClick: () => void reset() }]} />}
          </span>
        )}
      </div>
      {full.mandate && !editing && <p className={`${BODY} mt-3 text-text-secondary`}>{full.mandate}</p>}
      {msg && <p className={`${META} mt-2`} data-testid="specialist-msg">{msg}</p>}
      {s.on && editing && <SpecialistEditor s={full} vaultPath={vaultPath} onDone={async (m) => { setEditing(false); setMsg(m); await refresh(); }} onCancel={() => setEditing(false)} />}
      {s.on && !editing && (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-10" data-testid="specialist-summary">
            {summary.map(([k, v, tip]) => (
              <div key={k} className="min-w-0" title={tip}>
                <dt className={META}>{k}</dt>
                <dd className="mt-0.5 break-words text-[14px] text-text-primary sm:whitespace-nowrap" data-testid={k === "Can" ? "specialist-ceiling" : undefined}>{v}</dd>
              </div>
            ))}
          </dl>
          {full.doneWhen.length > 0 && (
            <>
              <h3 className={`${SECTION_TITLE} mt-7`}>Done when</h3>
              <ul className="mt-1.5 space-y-1">{full.doneWhen.map((d) => (
                <li key={d} className={`${BODY} flex items-start gap-2 text-text-secondary`}><Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-text-muted" />{d}</li>
              ))}</ul>
            </>
          )}
          {(full.method || full.never) && (
            <details className="group mt-6">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] text-text-muted hover:text-text-primary [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />How it works
              </summary>
              {full.method && <p className={`${BODY} mt-2 whitespace-pre-line text-text-secondary`}>{full.method}</p>}
              {full.never && <p className={`${BODY} mt-2 text-text-secondary`}><span className="text-text-muted">Never: </span>{full.never}</p>}
            </details>
          )}
          <Notebooks s={full} vaultPath={vaultPath} notebooks={notebooks} onSaved={refresh} />
          <h3 className={`${SECTION_TITLE} mt-7`}>Runs</h3>
          {jobs.length ? <ul className="mt-1">{jobs.slice(0, 20).map((j) => <JobRow key={j.id} job={j} vaultPath={vaultPath} />)}</ul>
            : <p className={`${META} mt-1`}>No runs yet. Type @{s.name} in any chat to hand it something.</p>}
        </>
      )}
    </section>
  );
}

/** The whole specialist, edited in place: the same fields as build/specialists/<id>.md. */
function SpecialistEditor({ s, vaultPath, onDone, onCancel }: { s: Specialist; vaultPath: string; onDone: (msg: string) => void; onCancel: () => void }) {
  const [d, setD] = useState<SpecialistDraft>(() => draftOf(s));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const appsQ = useInvokeQuery<{ id: string; title?: string }[]>("engine_apps_list", { vault: vaultPath }, { staleMs: 60_000 });
  const apps = [...new Map([...(Array.isArray(appsQ.data) ? appsQ.data : []).map((a) => [a.id, a.title ?? label(a.id)] as const), ...s.apps.map((a) => [a, label(a)] as const)]).entries()];
  const set = <K extends keyof SpecialistDraft>(k: K, v: SpecialistDraft[K]) => { setD((x) => ({ ...x, [k]: v })); setConfirm(null); setErr(null); };
  const toggle = (k: "tools" | "apps", id: string) => set(k, d[k].includes(id) ? d[k].filter((x) => x !== id) : [...d[k], id]);
  const save = async (confirmRaise = false) => {
    const edit = editOf(s, d);
    if (typeof edit === "string") { setErr(edit); return; }
    if (!Object.keys(edit).length) { onCancel(); return; }
    setBusy(true); setErr(null);
    try {
      const r = await invoke<SaveReply>("engine_specialist_save", { vault: vaultPath, id: s.id, edit, confirmRaise });
      if (r?.needsConfirm) { setConfirm(r.error ?? "This raises the ceiling. Confirm to save."); return; }
      if (r?.ok === false) throw new Error(r.error ?? "not saved");
      onDone("Saved. The earlier version is kept in the vault.");
    } catch (e) { setErr(`Not saved: ${String(e)}`); } finally { setBusy(false); }
  };
  const area = (k: "mandate" | "method" | "never", title: string, hint: string, rows: number) => (
    <label className="mt-5 block">
      <span className="block text-[13px] font-medium text-text-primary">{title}</span>
      <span className={`${META} block`}>{hint}</span>
      <textarea value={d[k]} rows={rows} onChange={(e) => set(k, e.target.value)} data-testid={`spec-edit-${k}`} className={`${field} mt-1.5 resize-y leading-normal`} />
    </label>
  );
  const builtInRank = ceilingRank(s.ceiling);
  return (
    <div data-testid="specialist-editor" className="mt-4 border-t border-border-subtle pt-1">
      {area("mandate", "Mandate", "What it is for, in a line.", 2)}
      {area("method", "Method", "How it works, step by step. This and the two around it are its instructions.", 5)}
      {area("never", "Never", "What it must not do.", 2)}
      <div className="mt-5">
        <span className="block text-[13px] font-medium text-text-primary">Ceiling</span>
        <span className={`${META} block`}>The most it may do, enforced in code. A higher one than {CEILING_LABEL[s.ceiling]} asks you first.</span>
        <div className="mt-1.5"><Segmented label="Ceiling" value={d.ceiling} onChange={(v) => set("ceiling", v)} options={CEILINGS.map((c) => [c, CEILING_LABEL[c]!] as [string, string])} /></div>
        {ceilingRank(d.ceiling) > builtInRank && <p className="mt-1 text-[12px] text-warn">Above what it has today.</p>}
      </div>
      <fieldset className="mt-5">
        <legend className="text-[13px] font-medium text-text-primary">Tools and apps</legend>
        {/* Each tool or app is a tile with its real icon; selected tiles carry the accent. */}
        <div className="mt-2 flex flex-wrap gap-2" data-testid="spec-edit-tools">
          {[...SPECIALIST_TOOLS.map((t) => ({ kind: "tools" as const, id: t.id, title: t.label })), ...apps.map(([id, title]) => ({ kind: "apps" as const, id, title }))].map((t) => {
            const on = (t.kind === "tools" ? d.tools : d.apps).includes(t.id);
            const Icon = t.kind === "tools" ? (t.id === "web" ? Globe : Archive) : null;
            return (
              <button key={`${t.kind}:${t.id}`} type="button" role="checkbox" aria-checked={on} aria-label={t.title} onClick={() => toggle(t.kind, t.id)}
                className={`inline-flex h-9 items-center gap-2 rounded-lg border pl-1.5 pr-3 text-[13px] transition-colors ${on ? "border-accent-border bg-accent-soft text-text-primary" : "border-border-subtle text-text-secondary hover:border-border hover:bg-surface-warm"}`}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface">
                  {Icon ? <Icon className={`h-3.5 w-3.5 ${on ? "text-accent" : "text-text-muted"}`} /> : <AppRowLogo app={{ id: t.id, title: t.title }} size={20} fallback="letter" />}
                </span>
                <span className="truncate">{t.title}</span>
                {on && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="mt-5 grid grid-cols-3 gap-3 sm:max-w-md">
        {([["minutes", "Minutes"], ["usd", "Dollars"], ["passes", "Passes"]] as const).map(([k, t]) => (
          <label key={k} className="block min-w-0"><span className={`${META} block`}>{t}</span>
            <input type="number" inputMode="decimal" min={k === "usd" ? 0 : 1} step={k === "usd" ? 0.05 : 1} value={d[k]} onChange={(e) => set(k, e.target.value)} data-testid={`spec-edit-${k}`} className={`${field} mt-1 tabular-nums`} /></label>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-x-8 gap-y-4">
        <div><span className="block text-[13px] font-medium text-text-primary">Hands off</span>
          <div className="mt-1.5"><Segmented label="Hands off" value={d.handoff} onChange={(v) => set("handoff", v)} options={Object.entries(HANDOFF_LABEL)} /></div></div>
        <div><span className="block text-[13px] font-medium text-text-primary">Runtime</span>
          <div className="mt-1.5"><Segmented label="Runtime" value={d.runtime} onChange={(v) => set("runtime", v)} options={Object.entries(RUNTIME_LABEL)} /></div></div>
      </div>
      <label className="mt-5 block">
        <span className="block text-[13px] font-medium text-text-primary">Done when</span>
        <span className={`${META} block`}>One check per line. A run is not done until each is true.</span>
        <textarea value={d.doneWhen} rows={3} onChange={(e) => set("doneWhen", e.target.value)} data-testid="spec-edit-done" className={`${field} mt-1.5 resize-y`} />
      </label>
      {err && <p className="mt-3 text-[13px] text-err">{err}</p>}
      {confirm && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-warn" data-testid="spec-confirm">
          <AlertTriangle className="h-3.5 w-3.5" />{confirm}
          <button onClick={() => void save(true)} disabled={busy} className={textLink} data-testid="spec-confirm-raise">Raise it and save</button>
        </p>
      )}
      <div className="mt-5 flex items-center gap-4">
        <button onClick={() => void save(false)} disabled={busy} data-testid="spec-save" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save</button>
        <button onClick={onCancel} disabled={busy} className={quietLink}>Cancel</button>
      </div>
    </div>
  );
}

/** What it learned per domain, and the user's instructions there (tighten-only). */
function Notebooks({ s, vaultPath, notebooks, onSaved }: { s: Specialist; vaultPath: string; notebooks: { domain: string; lines: number; notes: boolean }[]; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const doms = useInvokeQuery<{ name: string }[]>("scan_vault", adding ? { path: vaultPath } : null, { staleMs: 60_000 });
  const rows = open && !notebooks.some((n) => n.domain === open) ? [...notebooks, { domain: open, lines: 0, notes: false }] : notebooks;
  const others = (Array.isArray(doms.data) ? doms.data : []).map((d) => d.name).filter((d) => !d.startsWith("_") && !rows.some((n) => n.domain === d));
  return (
    <>
      <div className="mt-7 flex items-baseline gap-3">
        <h3 className={SECTION_TITLE}>Notebooks</h3>
        {!adding ? <button onClick={() => setAdding(true)} className={quietLink} data-testid="specialist-add-domain"><Plus className="h-3.5 w-3.5" />Instructions for a domain</button>
          : <select autoFocus aria-label="Domain" defaultValue="" onChange={(e) => { if (e.target.value) { setOpen(e.target.value); setAdding(false); } }} onBlur={() => setAdding(false)} className="h-7 rounded-md border border-border bg-background px-1.5 text-[13px] text-text-primary">
              <option value="" disabled>Pick a domain</option>
              {others.map((d) => <option key={d} value={d}>{scopeLabel(d)}</option>)}
            </select>}
      </div>
      {rows.length ? (
        <ul className="mt-1" data-testid="specialist-notebooks">{rows.map((n) => (
          <li key={n.domain} className="border-b border-border-subtle last:border-b-0">
            <button onClick={() => setOpen(open === n.domain ? null : n.domain)} aria-expanded={open === n.domain} className="flex w-full items-center gap-2.5 py-2 text-left">
              <BookOpen className="h-4 w-4 shrink-0 text-text-muted" />
              <span className="text-[14px] text-text-primary">{scopeLabel(n.domain)}</span>
              <span className={`${META} min-w-0 truncate`}>{[n.lines ? `${n.lines} line${n.lines === 1 ? "" : "s"}` : "", n.notes ? "your instructions" : ""].filter(Boolean).join(" · ") || "No notes yet"}</span>
              <ChevronRight className={`ml-auto h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${open === n.domain ? "rotate-90" : ""}`} />
            </button>
            {open === n.domain && <DomainNotes s={s} domain={n.domain} vaultPath={vaultPath} onSaved={onSaved} />}
          </li>
        ))}</ul>
      ) : <p className={`${META} mt-1`}>Nothing learned yet. After each job it keeps a short note of what worked, per domain.</p>}
    </>
  );
}

function DomainNotes({ s, domain, vaultPath, onSaved }: { s: Specialist; domain: string; vaultPath: string; onSaved: () => Promise<void> }) {
  const q = useInvokeQuery<{ spec?: Specialist; notebook?: string[]; notes?: string }>("engine_specialist_show", { vault: vaultPath, id: s.id, domain }, { staleMs: 60_000 });
  const [edit, setEdit] = useState<{ ceiling: string; tools: string[]; notes: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const here = q.data?.spec;
  const start = () => { setMsg(null); setEdit({ ceiling: here?.ceiling ?? s.ceiling, tools: here?.tools ?? s.tools, notes: q.data?.notes ?? "" }); };
  const problem = edit ? loosens(s, edit) : null;
  const save = async () => {
    if (!edit || problem) return;
    setBusy(true); setMsg(null);
    try {
      const r = await invoke<SaveReply>("engine_specialist_domain_save", { vault: vaultPath, id: s.id, domain, edit: { ceiling: edit.ceiling, tools: edit.tools, notes: edit.notes } });
      if (r?.ok === false) throw new Error(r.error ?? "not saved");
      setEdit(null); setMsg("Saved."); invalidateQueries("engine_specialist_show"); await q.refresh(); await onSaved();
    } catch (e) { setMsg(`Not saved: ${String(e)}`); } finally { setBusy(false); }
  };
  const tightened = here && (here.ceiling !== s.ceiling || here.tools.length < s.tools.length);
  return (
    <div className="mb-3 ml-6.5 pl-0.5" data-testid="specialist-domain">
      {!edit && (
        <>
          {q.data?.notes && <p className={`${BODY} text-text-secondary`}><span className="text-text-muted">Your instructions: </span>{q.data.notes}</p>}
          {tightened && <p className={`${META} mt-1`}>Here it {CEILING_SAYS[here!.ceiling]?.toLowerCase()} with {here!.tools.map(toolLabel).join(", ") || "no tools"}.</p>}
          {(q.data?.notebook ?? []).length > 0 && <ul className={`${BODY} mt-1 list-disc pl-5 text-text-secondary`}>{(q.data?.notebook ?? []).map((l) => <li key={l} className="break-words">{l}</li>)}</ul>}
          <button onClick={start} className={`${textLink} mt-1.5`} data-testid="specialist-domain-edit">{q.data?.notes || tightened ? "Edit instructions" : `Add instructions for ${label(domain)}`}</button>
          {msg && <span className={`${META} ml-3`}>{msg}</span>}
        </>
      )}
      {edit && (
        <div className="pt-1">
          <p className={META}>In a domain it can only be tightened: a lower ceiling, fewer tools. Never more than it has.</p>
          <div className="mt-2"><Segmented label={`Ceiling in ${label(domain)}`} value={edit.ceiling} onChange={(v) => setEdit({ ...edit, ceiling: v })} disabledAbove={ceilingRank(s.ceiling)} options={CEILINGS.map((c) => [c, CEILING_LABEL[c]!] as [string, string])} /></div>
          {s.tools.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">{s.tools.map((t) => (
              <label key={t} className="inline-flex items-center gap-2 text-[14px] text-text-secondary"><input type="checkbox" checked={edit.tools.includes(t)} onChange={() => setEdit({ ...edit, tools: edit.tools.includes(t) ? edit.tools.filter((x) => x !== t) : [...edit.tools, t] })} className="accent-[var(--color-accent)]" />{toolLabel(t)}</label>
            ))}</div>
          )}
          <textarea value={edit.notes} rows={3} placeholder={`How ${s.name} should work in ${label(domain)}`} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} data-testid="spec-domain-notes" className={`${field} mt-2 resize-y`} />
          {problem && <p className="mt-1 text-[12px] text-err">{problem}</p>}
          {msg && <p className="mt-1 text-[12px] text-err">{msg}</p>}
          <div className="mt-2 flex items-center gap-4">
            <button onClick={() => void save()} disabled={busy || !!problem} className={textLink} data-testid="spec-domain-save">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save</button>
            <button onClick={() => setEdit(null)} disabled={busy} className={quietLink}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ChiefDoc { name: string | null; handoff: string; limits: { usd: number; minutes: number }; neverRead: string[]; learned: string[] }

/** Parse what the setup page shows from build/chief-of-staff.md (the engine owns the file). */
export function parseChief(text: string): ChiefDoc {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text ?? "")?.[1] ?? "";
  const field = (k: string) => new RegExp(`^${k}:\\s*(.*)$`, "m").exec(fm)?.[1]?.trim() ?? "";
  const sec = (h: string) => {
    const part = (text ?? "").split(/^##\s+/m).find((x) => x.toLowerCase().startsWith(h.toLowerCase()));
    return part ? part.split("\n").slice(1).map((l) => /^\s*-\s+(.*\S)/.exec(l)?.[1] ?? "").filter(Boolean) : [];
  };
  const lim = sec("Limits");
  const num = (k: string, d: number) => Number(lim.find((l) => l.startsWith(`${k}:`))?.split(":")[1]) || d;
  return { name: field("name") || null, handoff: field("handoff") || "auto", limits: { usd: num("usd", 1), minutes: num("minutes", 10) }, neverRead: sec("Never pull in"), learned: sec("What I've learned") };
}

function ChiefSetup({ vaultPath }: { vaultPath: string }) {
  const name = useChiefOfStaff(vaultPath);
  const q = useInvokeQuery<string>("chief_of_staff_read", { vault: vaultPath }, { staleMs: 30_000 });
  const doc = parseChief(typeof q.data === "string" ? q.data : "");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const val = (k: string, d: string) => draft[k] ?? d;
  const save = async (key: string, value: string) => {
    setBusy(key); setMsg(null);
    try {
      const r = await invoke<{ ok?: boolean; error?: string }>("engine_chief_set", { vault: vaultPath, key, value });
      if (r && r.ok === false) throw new Error(r.error ?? "not saved");
      invalidateQueries("chief_of_staff_read"); invalidateQueries("chief-of-staff"); await q.refresh(); setMsg("Saved.");
    } catch (e) { setMsg(`Not saved: ${String(e)}`); } finally { setBusy(null); }
  };
  const field = (k: string, title: string, d: string, hint: string, type = "text") => (
    <div className="mt-4">
      <label className="block text-[13px] font-medium text-text-primary" htmlFor={`cos-${k}`}>{title}</label>
      <div className="mt-1 flex items-center gap-2">
        <input id={`cos-${k}`} type={type} value={val(k, d)} onChange={(e) => setDraft((x) => ({ ...x, [k]: e.target.value }))} className={input} />
        {val(k, d) !== d && <button onClick={() => void save(k, val(k, d))} disabled={!!busy} className={textLink}>{busy === k ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Save</button>}
      </div>
      <p className={`${META} mt-1`}>{hint}</p>
    </div>
  );
  return (
    <section data-testid="chief-setup" className="max-w-3xl">
      <div className="flex items-center gap-3">
        <ChiefAvatar size={52} label={name ?? "Your chief of staff"} />
        <h2 className={DETAIL_TITLE}>{name ?? "Your chief of staff"}</h2>
      </div>
      <p className={`${BODY} mt-2 text-text-secondary`}>The one you talk to. They answer, or staff a job with specialists and run it within your limits.</p>
      {field("name", "Name", doc.name ?? "", "Shown on the Home row and in every chat.")}
      <div className="mt-4">
        <span className="block text-[13px] font-medium text-text-primary">Jobs from chat</span>
        <div className="mt-1 inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Jobs from chat">
          {[["auto", "Start within my limits"], ["offer", "Always ask"], ["off", "Only when I @ a specialist"]].map(([k, t]) => (
            <button key={k} onClick={() => void save("handoff", k!)} aria-pressed={doc.handoff === k} className={`h-9 px-3 text-[13px] ${doc.handoff === k ? "bg-accent-soft font-medium text-accent" : "text-text-secondary hover:text-accent"}`}>{t}</button>
          ))}
        </div>
      </div>
      {field("usd", "Starts alone up to (dollars a job)", String(doc.limits.usd), "Over this, they ask first. Anything that moves money, contacts a person, or changes where you live or who you are always asks.", "number")}
      {field("minutes", "And up to (minutes a job)", String(doc.limits.minutes), "Budgets stop a run in code, not only in a prompt.", "number")}
      {field("never", "Never pull in", doc.neverRead.join(", "), "Domains they leave out unless you name them, separated by commas.")}
      {msg && <p className={`${META} mt-3`}>{msg}</p>}
      <h3 className={`${SECTION_TITLE} mt-6`}>What I've learned</h3>
      {doc.learned.length ? <ul className={`${BODY} mt-1 list-disc pl-5 text-text-secondary`}>{doc.learned.map((l) => <li key={l}>{l}</li>)}</ul>
        : <p className={`${META} mt-1`}>Nothing yet. When you adjust the same thing twice, it becomes a rule here.</p>}
    </section>
  );
}
