// A job in the thread: what the chief of staff staffed, live while it runs,
// then the result and a Filed list with Undo. Adjust opens inside the card
// (owner, the domains it reads and tells, the team, the effort); every change
// is logged and learned by the engine. Start is the user's yes; Stop works at
// any time. Data: `prevail job show <id>` (engine_job_show), polled while the
// job runs.
import { useEffect, useMemo, useState } from "react";
import { Check, FileText, FolderOpen, Loader2, Play, RotateCcw, SlidersHorizontal, Square, X } from "lucide-react";
import { invoke } from "./bridge";
import { useInvokeQuery, invalidateQueries } from "./query";
import { Markdown } from "./Markdown";
import { LS, lsGet } from "./storage";
import { elapsed, jobStatusLabel, label, stepState, type Job, type JobView } from "./plansmodel";

const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";
const smallBtn = "inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[13px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50";
const chipBase = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px]";
const STATE_CHIP: Record<string, string> = {
  done: "border-accent-border bg-accent-soft text-accent", now: "border-accent text-accent", next: "border-border text-text-muted", failed: "border-warn/50 text-warn",
};
const EFFORTS: Job["effort"][] = ["quick", "standard", "deep"];

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1 sm:flex-row sm:gap-3">
      <span className="w-16 shrink-0 text-[13px] font-medium text-text-muted">{k}</span>
      <div className="min-w-0 flex-1 text-[14px] text-text-primary">{children}</div>
    </div>
  );
}

export function JobCard({ id, vaultPath }: { id: string; vaultPath?: string }) {
  const vault = vaultPath ?? lsGet(LS.vault, "");
  const q = useInvokeQuery<JobView>("engine_job_show", vault ? { vault, id } : null, { staleMs: 2_000 });
  const v = q.data && typeof q.data === "object" && q.data.job ? q.data : null;
  const job = v?.job;
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adjust, setAdjust] = useState(false);
  const [showPage, setShowPage] = useState(false);
  const [, tick] = useState(0);
  // Live while it runs: re-read the record every two seconds.
  useEffect(() => {
    if (job?.status !== "running" && !(job?.status === "proposed" && busy === "start")) return;
    const t = setInterval(() => { tick((n) => n + 1); void q.refresh(); }, 2_000);
    return () => clearInterval(t);
  }, [job?.status, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (key: string, cmd: string, args: Record<string, unknown>) => {
    setBusy(key); setErr(null);
    try { await invoke(cmd, { vault, id, ...args }); invalidateQueries("engine_jobs"); await q.refresh(); }
    catch (e) { setErr(String(e)); }
    finally { setBusy((b) => (b === key && key !== "start" ? null : b)); }
  };
  useEffect(() => { if (busy === "start" && job?.status === "running") setBusy(null); }, [busy, job?.status]);
  if (!vault) return null;
  if (!v || !job) return <div data-testid="job-card" className="mt-3 rounded-xl border border-border p-3 text-[13px] text-text-muted">{q.error ? `Could not read the job: ${String(q.error)}` : "Reading the job..."}</div>;
  const running = job.status === "running";
  const waiting = job.status === "proposed" || job.status === "needs-approval";
  const done = job.status === "done";
  return (
    <div data-testid="job-card" data-status={job.status} className="mt-3 rounded-xl border border-border bg-background/40 p-3 sm:p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-text-primary">{done ? "Done" : "Job"}: <span className="break-words">{job.ask}</span></p>
          <p className="mt-0.5 text-[12px] text-text-muted"><span data-testid="job-status">{jobStatusLabel(job)}</span>{job.started ? ` · ${elapsed(job)}` : ""}{job.cost ? ` · about $${job.cost.usd.toFixed(2)}` : ""}</p>
        </div>
        {running && <button onClick={() => void act("stop", "engine_job_action", { action: "stop" })} disabled={!!busy} title="Stop" aria-label="Stop the job" data-testid="job-stop" className={iconBtn}><Square className="h-4 w-4" /></button>}
      </div>
      {!done && (
        <div className="mt-2 border-t border-border-subtle pt-1">
          <Row k="Owner">{label(job.domains.owner)}</Row>
          {job.domains.consulted.length > 0 && <Row k="Reads">{job.domains.consulted.map(label).join(", ")}</Row>}
          {job.domains.informed.length > 0 && <Row k="Tells">{job.domains.informed.map(label).join(", ")}</Row>}
          <Row k="Team">
            <span className="flex flex-wrap gap-1.5">{job.team.flatMap((s) => s.specialists.map((sp) => {
              const st = stepState(job, sp, v.steps);
              return <span key={`${s.step}-${sp}`} data-testid="job-team-chip" data-state={st} className={`${chipBase} ${STATE_CHIP[st]}`}>{st === "now" && <Loader2 className="h-3 w-3 animate-spin" />}{st === "done" && <Check className="h-3 w-3" />}{label(sp)}{s.gate ? " (gate)" : ""}</span>;
            }))}</span>
          </Row>
          <Row k="Effort">{label(job.effort)}, up to ${job.budget.usd} and {job.budget.minutes} minutes</Row>
        </div>
      )}
      {waiting && (
        <div className="mt-2">
          {job.askReason && <p className="text-[13px] text-text-secondary">Asking first: {job.askReason}.</p>}
          {job.note && <p className="text-[13px] text-text-secondary">{job.note}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => void act("start", "engine_job_action", { action: "start" })} disabled={!!busy} data-testid="job-start" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white disabled:opacity-50">{busy === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Start</button>
            <button onClick={() => setAdjust((x) => !x)} aria-expanded={adjust} data-testid="job-adjust" className={smallBtn}><SlidersHorizontal className="h-3.5 w-3.5" /> Adjust</button>
            <button onClick={() => void act("stop", "engine_job_action", { action: "stop" })} disabled={!!busy} className={smallBtn}><X className="h-3.5 w-3.5" /> Not now</button>
          </div>
        </div>
      )}
      {waiting && adjust && <AdjustPanel job={job} vault={vault} onSaved={() => { setAdjust(false); void q.refresh(); }} />}
      {(job.status === "failed" || job.status === "stopped") && (
        <div className="mt-2">
          <p className="text-[13px] text-text-secondary">{job.note ?? "It did not finish."}</p>
          <button onClick={() => void act("start", "engine_job_action", { action: "start" })} disabled={!!busy} className={`${smallBtn} mt-2`}><Play className="h-3.5 w-3.5" /> Run again</button>
        </div>
      )}
      {done && job.result && (
        <div className="mt-2" data-testid="job-result">
          <p className="break-words text-[15px] text-text-primary">{job.result.summary}</p>
          {job.result.verdict && <p className="mt-1 text-[13px] text-text-muted">Steward: {job.result.verdict}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {v.body && <button onClick={() => setShowPage((x) => !x)} aria-expanded={showPage} data-testid="job-open-page" className={smallBtn}><FileText className="h-3.5 w-3.5" /> {showPage ? "Hide page" : "Open page"}</button>}
            {job.result.page && <button onClick={() => void invoke("open_in_finder", { path: `${vault}/${job.result!.page}` }).catch(() => {})} title="Show the file" aria-label="Show the file" className={iconBtn}><FolderOpen className="h-4 w-4" /></button>}
          </div>
          {showPage && <div className="mt-3 max-h-[60vh] overflow-y-auto rounded-lg border border-border-subtle bg-surface p-3 text-[14px]"><Markdown source={v.body} /></div>}
        </div>
      )}
      {v.filed.length > 0 && (
        <div className="mt-3 border-t border-border-subtle pt-2" data-testid="job-filed">
          <p className="text-[13px] font-medium text-text-muted">Filed</p>
          <ul>{v.filed.map((r) => (
            <li key={r.n} data-testid="job-filed-row" className="flex items-start gap-2 py-1">
              <span className="w-24 shrink-0 truncate text-[13px] font-medium text-text-primary">{label(r.domain)}</span>
              <span className={`min-w-0 flex-1 break-words text-[13px] ${r.undone ? "text-text-muted line-through" : "text-text-secondary"}`}>{r.text}</span>
              {!r.undone && <button onClick={() => void act(`undo${r.n}`, "engine_job_undo", { n: r.n })} disabled={!!busy} title="Undo" aria-label={`Undo: ${r.text}`} data-testid="job-undo" className={iconBtn}>{busy === `undo${r.n}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}</button>}
            </li>
          ))}</ul>
        </div>
      )}
      {err && <p className="mt-2 text-[13px] text-err">{err}</p>}
    </div>
  );
}

/** A new specialist joins as its own step, before the Editor (who always delivers last). */
export function addStep(team: string[][], id: string): string[][] {
  const at = team.findIndex((s) => s.includes("editor"));
  return at < 0 ? [...team, [id]] : [...team.slice(0, at), [id], ...team.slice(at)];
}

function AdjustPanel({ job, vault, onSaved }: { job: Job; vault: string; onSaved: () => void }) {
  const doms = useInvokeQuery<{ name: string }[]>("scan_vault", { path: vault }, { staleMs: 60_000 });
  const specs = useInvokeQuery<{ id: string; name: string; on: boolean }[]>("engine_specialists", { vault }, { staleMs: 60_000 });
  const domains = useMemo(() => (Array.isArray(doms.data) ? doms.data.map((d) => d.name).filter((d) => !d.startsWith("_")) : []), [doms.data]);
  const [owner, setOwner] = useState(job.domains.owner);
  const [roles, setRoles] = useState<Record<string, "reads" | "tells">>(() => Object.fromEntries([...job.domains.consulted.map((d) => [d, "reads"]), ...job.domains.informed.map((d) => [d, "tells"])]));
  const [team, setTeam] = useState<string[][]>(job.team.map((s) => s.specialists));
  const [effort, setEffort] = useState(job.effort);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const onSpecs = (Array.isArray(specs.data) ? specs.data : []).filter((s) => s.on);
  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await invoke("engine_job_adjust", {
        vault, id: job.id, owner, effort,
        consulted: Object.entries(roles).filter(([, r]) => r === "reads").map(([d]) => d),
        informed: Object.entries(roles).filter(([, r]) => r === "tells").map(([d]) => d),
        team: team.filter((s) => s.length),
      });
      onSaved();
    } catch (e) { setErr(String(e)); } finally { setSaving(false); }
  };
  const sel = "h-8 rounded-md border border-border bg-background px-2 text-[13px] text-text-primary";
  return (
    <div data-testid="job-adjust-panel" className="mt-3 rounded-lg border border-border-subtle p-3">
      <Row k="Owner">
        <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner domain" className={sel}>
          {[...new Set([job.domains.owner, ...domains])].map((d) => <option key={d} value={d}>{label(d)}</option>)}
        </select>
      </Row>
      <Row k="Domains">
        <span className="flex flex-wrap items-center gap-1.5">
          {Object.entries(roles).map(([d, r]) => (
            <span key={d} className={`${chipBase} border-border text-text-secondary`}>
              {label(d)}
              <button onClick={() => setRoles((x) => ({ ...x, [d]: r === "reads" ? "tells" : "reads" }))} className="text-accent" aria-label={`${label(d)}: ${r}; switch`}>[{r}]</button>
              <button onClick={() => setRoles((x) => { const n = { ...x }; delete n[d]; return n; })} aria-label={`Remove ${label(d)}`}><X className="h-3 w-3" /></button>
            </span>
          ))}
          <select value="" onChange={(e) => e.target.value && setRoles((x) => ({ ...x, [e.target.value]: "reads" }))} aria-label="Add a domain" className={sel}>
            <option value="">Add</option>
            {domains.filter((d) => d !== owner && !roles[d]).map((d) => <option key={d} value={d}>{label(d)}</option>)}
          </select>
        </span>
      </Row>
      <Row k="Team">
        <span className="flex flex-wrap items-center gap-1.5">
          {team.flatMap((s, i) => s.map((sp) => (
            <span key={`${i}-${sp}`} className={`${chipBase} border-border text-text-secondary`}>{label(sp)}
              <button onClick={() => setTeam((t) => t.map((x, j) => (j === i ? x.filter((y) => y !== sp) : x)))} aria-label={`Remove ${label(sp)}`}><X className="h-3 w-3" /></button>
            </span>
          )))}
          <select value="" onChange={(e) => { const id = e.target.value; if (id) setTeam((t) => addStep(t, id)); }} aria-label="Add a specialist" className={sel}>
            <option value="">Add</option>
            {onSpecs.filter((s) => !team.flat().includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </span>
      </Row>
      <Row k="Effort">
        <span className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Effort">
          {EFFORTS.map((e) => <button key={e} onClick={() => setEffort(e)} aria-pressed={effort === e} className={`h-8 px-2.5 text-[13px] ${effort === e ? "bg-accent-soft font-medium text-accent" : "text-text-secondary hover:text-accent"}`}>{label(e)}</button>)}
        </span>
      </Row>
      {err && <p className="mt-1 text-[13px] text-err">{err}</p>}
      <button onClick={() => void save()} disabled={saving} data-testid="job-adjust-save" className={`${smallBtn} mt-2`}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save</button>
    </div>
  );
}
