// Specialists: the team the chief of staff staffs jobs with. SideSpine:
//   Jobs        Running, Waiting on you, Done (each job opens as its card)
//   Setup       the chief of staff: name, handoff, limits, never pull in, what
//               they learned
//   families    Know, Decide, Do, Deliver (the specialists that are on)
//   Off         the rest of the roster, coming in later phases
// A specialist's detail: what it is for, how it works, its ceiling, budget
// and tools, its notebooks per domain, and the jobs it worked on.
import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, BookOpen, Briefcase, ChartColumn, CircleDashed, Clock, Compass, FileText, FolderInput, Hammer, Hand, History, Hourglass, ListOrdered, Loader2, MessagesSquare, PenLine, Radar, Scale, Search, Settings2, ShieldQuestion, Sprout, UserCog, Wrench } from "lucide-react";
import { invoke } from "./bridge";
import { invalidateQueries, useInvokeQuery } from "./query";
import { SettingsHeader } from "./sectionutil";
import { SideSpine } from "./sidespine";
import { useIsPhone } from "./useisphone";
import { BODY, DETAIL_TITLE, META, SECTION_TITLE } from "./typescale";
import { JobCard } from "./jobcard";
import { useChiefOfStaff } from "./chiefofstaff";
import { FAMILY_LABEL, jobGroups, jobStatusLabel, label, type Job, type Specialist } from "./plansmodel";

export const SPECIALISTS_FOCUS_KEY = "prevail.specialists.focus";
const ICON: Record<string, typeof Search> = { search: Search, compass: Compass, "list-ordered": ListOrdered, scale: Scale, "file-text": FileText, "pen-line": PenLine, "chart-column": ChartColumn, history: History, radar: Radar, "badge-check": BadgeCheck, hammer: Hammer, "folder-input": FolderInput, hand: Hand, sprout: Sprout, "shield-question": ShieldQuestion, "messages-square": MessagesSquare, wrench: Wrench };
const CEILINGS = ["read", "write-vault", "draft", "act-ask", "act"];
const CEILING_LABEL: Record<string, string> = { read: "Read", "write-vault": "Write vault", draft: "Draft", "act-ask": "Ask, then act", act: "Act" };
const chip = "inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[12px] text-text-secondary";
const input = "h-9 w-full max-w-sm rounded-md border border-border bg-background px-2.5 text-[14px] text-text-primary";
const smallBtn = "inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[13px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50";

type Sel = "jobs:running" | "jobs:waiting" | "jobs:done" | "setup" | `spec:${string}`;

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
  const off = specs.filter((s) => !s.on);
  const [offOpen, setOffOpen] = useState(false);
  const choose = (s: Sel) => { setSel(s); setPicked(true); };
  const isOn = (s: Sel) => sel === s && (!phone || picked);
  const row = (s: Sel, text: string, Icon: typeof Search, count?: number, sub?: string) => (
    <button key={s} data-testid={`specialists-row-${s}`} aria-current={isOn(s) ? "true" : undefined} onClick={() => choose(s)}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${isOn(s) ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
      <Icon className={`h-4 w-4 shrink-0 ${isOn(s) ? "text-accent" : "text-text-muted"}`} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[14px] ${isOn(s) ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{text}</span>
        {sub && <span className="block truncate text-[12px] text-text-muted">{sub}</span>}
      </span>
      {count !== undefined && <span className="shrink-0 text-[12px] tabular-nums text-text-muted">{count}</span>}
    </button>
  );
  const head = (t: string) => <div className="px-2.5 pb-1 pt-3 text-[13px] font-semibold text-text-secondary">{t}</div>;
  const families = (["know", "decide", "do", "grow", "deliver"] as const).filter((f) => on.some((s) => s.family === f));
  const column = (
    <nav className="space-y-0.5 p-2" aria-label="Specialists">
      {head("Jobs")}
      {row("jobs:running", "Running", Clock, groups.running.length)}
      {row("jobs:waiting", "Waiting on you", Hourglass, groups.waiting.length)}
      {row("jobs:done", "Done", Briefcase, groups.done.length)}
      {row("setup", "Chief of staff", Settings2, undefined, "Name, limits, handoff")}
      {families.map((f) => (
        <div key={f}>
          {head(FAMILY_LABEL[f])}
          {on.filter((s) => s.family === f).map((s) => row(`spec:${s.id}`, s.name, ICON[s.icon] ?? UserCog, undefined, `Returns ${s.returns}`))}
        </div>
      ))}
      {off.length > 0 && (
        <>
          <button onClick={() => setOffOpen((v) => !v)} aria-expanded={offOpen} className="w-full px-2.5 pb-1 pt-3 text-left text-[13px] font-semibold text-text-secondary hover:text-accent">Off ({off.length})</button>
          {offOpen && off.map((s) => row(`spec:${s.id}`, s.name, CircleDashed, undefined, "Coming later"))}
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
        {!list.length && <p className={`${BODY} mt-4 text-text-muted`}>{k === "running" ? "Nothing is running." : k === "waiting" ? "Nothing waits on you." : "No finished jobs yet."}</p>}
        <ul className="mt-3 max-w-3xl">{list.map((j) => <JobRow key={j.id} job={j} vaultPath={vaultPath} />)}</ul>
      </section>
    );
  } else if (sel === "setup") {
    detail = <ChiefSetup vaultPath={vaultPath} />;
  } else {
    const s = specs.find((x) => `spec:${x.id}` === sel);
    detail = s ? <SpecialistDetail s={s} vaultPath={vaultPath} jobs={jobs.filter((j) => j.team.some((t) => t.specialists.includes(s.id)))} /> : <p className={`${BODY} text-text-muted`}>Pick a specialist.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="specialists-page">
      <SettingsHeader title="Specialists" icon={UserCog} subtitle="The team your chief of staff staffs jobs with." />
      <SideSpine storageKey="prevail.specialists.spine" title="Specialists" label="specialists" testId="specialists-list"
        meta={<span>{on.length} on</span>} phone={phone} phoneDetail={phone && picked} onBack={() => setPicked(false)} backLabel="Specialists"
        detail={<div className={phone ? "px-4 py-4" : "w-full px-8 py-6"}>{detail}</div>}>
        {column}
      </SideSpine>
    </div>
  );
}

function JobRow({ job, vaultPath }: { job: Job; vaultPath: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li data-testid="job-row" className="border-b border-border-subtle py-2.5 last:border-b-0">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-start gap-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[15px] font-semibold text-text-primary">{job.ask}</span>
          <span className={META}>{job.playbook ? `Playbook ${job.playbook}` : label(job.domains.owner || "general")} · {new Date(job.created).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
        </span>
        <span className={chip}>{jobStatusLabel(job)}</span>
      </button>
      {open && !job.playbook && <JobCard id={job.id} vaultPath={vaultPath} />}
      {open && job.playbook && <p className={`${BODY} mt-2 text-text-secondary`}>{job.why}</p>}
    </li>
  );
}

function SpecialistDetail({ s, vaultPath, jobs }: { s: Specialist; vaultPath: string; jobs: Job[] }) {
  const show = useInvokeQuery<{ notebooks?: { domain: string; lines: number; notes: boolean }[] }>("engine_specialist_show", { vault: vaultPath, id: s.id, domain: null }, { staleMs: 60_000 });
  const [nbDomain, setNbDomain] = useState<string | null>(null);
  const nb = useInvokeQuery<{ notebook?: string[]; notes?: string }>("engine_specialist_show", nbDomain ? { vault: vaultPath, id: s.id, domain: nbDomain } : null, { staleMs: 60_000 });
  const notebooks = show.data?.notebooks ?? [];
  return (
    <section data-testid="specialist-detail" data-id={s.id} className="max-w-3xl">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className={DETAIL_TITLE}>{s.name}</h2>
        <span className={chip}>Returns {s.returns}</span>
        {!s.on && <span className={chip}>Off, coming later</span>}
      </div>
      {s.mandate && <p className={`${BODY} mt-2 text-text-secondary`}>{s.mandate}</p>}
      {s.on && (
        <>
          <h3 className={`${SECTION_TITLE} mt-6`}>Ceiling</h3>
          <div className="mt-2 flex flex-wrap gap-1.5" data-testid="specialist-ceiling">
            {CEILINGS.map((c) => <span key={c} className={`${chip} ${c === s.ceiling ? "border-accent-border bg-accent-soft font-medium text-accent" : ""}`}>{CEILING_LABEL[c]}</span>)}
          </div>
          <p className={`${META} mt-1`}>Enforced in code. Nothing a specialist does sends, buys or changes anything outside the vault.</p>
          {s.doneWhen.length > 0 && (<><h3 className={`${SECTION_TITLE} mt-6`}>Done when</h3><ul className={`${BODY} mt-1 list-disc pl-5 text-text-secondary`}>{s.doneWhen.map((d) => <li key={d}>{d}</li>)}</ul></>)}
          <h3 className={`${SECTION_TITLE} mt-6`}>Setup</h3>
          <dl className={`${BODY} mt-1 grid grid-cols-[7rem_minmax(0,1fr)] gap-y-1 text-text-secondary`}>
            <dt className="text-text-muted">Tools</dt><dd>{s.tools.length ? s.tools.map((t) => (t === "web" ? "Web" : t === "vault-read" ? "Vault read" : t)).join(", ") : "None"}</dd>
            <dt className="text-text-muted">Budget</dt><dd>{s.budget.minutes} min, ${s.budget.usd.toFixed(2)}, {s.budget.passes} pass{s.budget.passes === 1 ? "" : "es"}</dd>
            <dt className="text-text-muted">Handoff</dt><dd>{label(s.handoff)}</dd>
            {s.source && (<><dt className="text-text-muted">Your file</dt><dd className="break-all">{s.source}</dd></>)}
          </dl>
          <h3 className={`${SECTION_TITLE} mt-6`}>Notebooks</h3>
          {notebooks.length ? (
            <ul className="mt-1" data-testid="specialist-notebooks">{notebooks.map((n) => (
              <li key={n.domain}>
                <button onClick={() => setNbDomain(nbDomain === n.domain ? null : n.domain)} aria-expanded={nbDomain === n.domain} className={`${BODY} flex w-full items-center gap-2 py-1 text-left text-text-primary hover:text-accent`}>
                  <BookOpen className="h-4 w-4 shrink-0 text-text-muted" />{label(n.domain)}<span className={META}>{n.lines} line{n.lines === 1 ? "" : "s"}{n.notes ? ", your notes" : ""}</span>
                </button>
                {nbDomain === n.domain && (
                  <div className="mb-2 ml-6">
                    {nb.data?.notes && <p className={`${BODY} mb-1 text-text-secondary`}><span className="text-text-muted">Your instructions: </span>{nb.data.notes}</p>}
                    <ul className={`${BODY} list-disc pl-5 text-text-secondary`}>{(nb.data?.notebook ?? []).map((l) => <li key={l} className="break-words">{l}</li>)}</ul>
                  </div>
                )}
              </li>
            ))}</ul>
          ) : <p className={`${BODY} mt-1 text-text-muted`}>Nothing learned yet. After each job it keeps a short note of what worked, per domain.</p>}
          <h3 className={`${SECTION_TITLE} mt-6`}>Runs</h3>
          {jobs.length ? <ul className="mt-1">{jobs.slice(0, 20).map((j) => <JobRow key={j.id} job={j} vaultPath={vaultPath} />)}</ul> : <p className={`${BODY} mt-1 text-text-muted`}>No runs yet. Type @{s.name} in any chat to hand it something.</p>}
        </>
      )}
    </section>
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
      <label className="block text-[14px] font-medium text-text-primary" htmlFor={`cos-${k}`}>{title}</label>
      <div className="mt-1 flex items-center gap-2">
        <input id={`cos-${k}`} type={type} value={val(k, d)} onChange={(e) => setDraft((x) => ({ ...x, [k]: e.target.value }))} className={input} />
        <button onClick={() => void save(k, val(k, d))} disabled={!!busy || val(k, d) === d} className={smallBtn}>{busy === k ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Save</button>
      </div>
      <p className={`${META} mt-1`}>{hint}</p>
    </div>
  );
  return (
    <section data-testid="chief-setup" className="max-w-3xl">
      <h2 className={DETAIL_TITLE}>{name ?? "Your chief of staff"}</h2>
      <p className={`${BODY} mt-1 text-text-secondary`}>The one you talk to. They answer, or staff a job with specialists and run it within your limits.</p>
      {field("name", "Name", doc.name ?? "", "Shown on the Home row and in every chat.")}
      <div className="mt-4">
        <span className="block text-[14px] font-medium text-text-primary">Jobs from chat</span>
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
        : <p className={`${BODY} mt-1 text-text-muted`}>Nothing yet. When you adjust the same thing twice, it becomes a rule here.</p>}
    </section>
  );
}
