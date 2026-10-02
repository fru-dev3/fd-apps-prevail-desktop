// Playbooks: the workflow layer (specialists-plan Phase 2). SideSpine groups
// Running, Yours, Drafts (saved from chat) and Built in. A playbook's detail:
// its goal and domain, what runs it (a loop, or by hand), the steps as
// numbered rows with the specialists, GATE and ASK markers and the typed
// result each returns, Run (in a domain, for a playbook that names none),
// Adopt for a draft, and its run history (each step's job opens its card).
// Data: `prevail playbook rows | show <id>`; the engine owns every file.
import { useEffect, useMemo, useState } from "react";
import { Check, CircleDot, FilePen, Hand, Library, Loader2, Play, Workflow } from "lucide-react";
import { invoke } from "./bridge";
import { invalidateQueries, useInvokeQuery } from "./query";
import { SettingsHeader } from "./sectionutil";
import { SideSpine } from "./sidespine";
import { useIsPhone, useStacked } from "./useisphone";
import { BODY, DETAIL_TITLE, META, SECTION_TITLE } from "./typescale";
import { JobCard } from "./jobcard";
import { label, PLAYBOOKS_FOCUS_KEY, PLAYBOOK_GROUPS, playbookGroups, triggerLine, type PlaybookGroup, type PlaybookRow, type PlaybookView } from "./plansmodel";

const GROUP_ICON: Record<PlaybookGroup, typeof Workflow> = { running: CircleDot, yours: Workflow, drafts: FilePen, "built-in": Library };
const chip = "inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[12px] text-text-secondary";
const mark = "inline-flex items-center rounded border px-1.5 py-0 text-[11px] font-semibold tracking-wide";
const smallBtn = "inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[13px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50";

function takeFocus(): string | null {
  try { const f = localStorage.getItem(PLAYBOOKS_FOCUS_KEY); localStorage.removeItem(PLAYBOOKS_FOCUS_KEY); return f; } catch { return null; }
}

export function PlaybooksPage({ vaultPath }: { vaultPath: string }) {
  const isPhone = useIsPhone();
  const stacked = useStacked();
  const phone = isPhone || stacked;
  const q = useInvokeQuery<PlaybookRow[]>("engine_playbook_rows", { vault: vaultPath }, { staleMs: 10_000 });
  const rows = useMemo(() => (Array.isArray(q.data) ? q.data : []), [q.data]);
  const groups = playbookGroups(rows);
  const [sel, setSel] = useState<string | null>(takeFocus);
  const [picked, setPicked] = useState(sel !== null);
  useEffect(() => {
    const on = (e: Event) => { const id = (e as CustomEvent<string>).detail; takeFocus(); if (id) { setSel(id); setPicked(true); } };
    window.addEventListener("prevail:playbooks-focus", on);
    return () => window.removeEventListener("prevail:playbooks-focus", on);
  }, []);
  const current = sel ?? rows[0]?.id ?? null;
  const isOn = (id: string) => current === id && (!phone || picked);
  const column = (
    <nav className="space-y-0.5 p-2" aria-label="Playbooks">
      {PLAYBOOK_GROUPS.map((g) => {
        const Icon = GROUP_ICON[g.id];
        const list = groups[g.id];
        return (
          <div key={g.id}>
            <div className="flex items-center gap-2 px-2.5 pb-1 pt-3 text-[13px] font-semibold text-text-secondary">
              <Icon className="h-3.5 w-3.5" />{g.label}<span className="ml-auto tabular-nums text-text-muted">{list.length}</span>
            </div>
            {list.map((r) => (
              <button key={r.id} data-testid={`playbook-row-${r.id}`} aria-current={isOn(r.id) ? "true" : undefined} onClick={() => { setSel(r.id); setPicked(true); }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${isOn(r.id) ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[14px] ${isOn(r.id) ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{r.name}</span>
                  <span className="block truncate text-[12px] text-text-muted">{r.steps} step{r.steps === 1 ? "" : "s"}{r.domain ? ` · ${label(r.domain)}` : ""}</span>
                </span>
                {r.running && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />}
              </button>
            ))}
          </div>
        );
      })}
    </nav>
  );
  const detail = current
    ? <PlaybookDetail key={current} id={current} vaultPath={vaultPath} onChanged={() => void q.refresh()} />
    : <p className={`${BODY} text-text-muted`}>{q.loading ? "Reading playbooks..." : "No playbooks yet. Save one from a finished job in chat."}</p>;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="playbooks-page">
      <SettingsHeader title="Playbooks" icon={Workflow} subtitle="Specialists in order, each result feeding the next, with gates." />
      <SideSpine storageKey="prevail.playbooks.spine" title="Playbooks" label="playbooks" testId="playbooks-list"
        meta={<span>{rows.length}</span>} phone={phone} phoneDetail={phone && picked} onBack={() => setPicked(false)} backLabel="Playbooks"
        detail={<div className={phone ? "px-4 py-4" : "w-full px-8 py-6"}>{detail}</div>}>
        {column}
      </SideSpine>
    </div>
  );
}

// A run record (the whole playbook) ends in its start time; a step's job does not.
const isRunRecord = (id: string) => /-\d{10,}$/.test(id);

function PlaybookDetail({ id, vaultPath, onChanged }: { id: string; vaultPath: string; onChanged: () => void }) {
  const q = useInvokeQuery<PlaybookView>("engine_playbook_show", { vault: vaultPath, id }, { staleMs: 5_000 });
  const doms = useInvokeQuery<{ name: string }[]>("scan_vault", { path: vaultPath }, { staleMs: 60_000 });
  const domains = useMemo(() => (Array.isArray(doms.data) ? doms.data.map((d) => d.name).filter((d) => !d.startsWith("_")) : []), [doms.data]);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const pb = q.data && typeof q.data === "object" && Array.isArray(q.data.rows) ? q.data : null;
  if (!pb) return <p className={`${BODY} text-text-muted`}>{q.error ? `Could not read the playbook: ${String(q.error)}` : "Reading the playbook..."}</p>;
  const run = async () => {
    setBusy("run"); setMsg(null);
    try {
      const r = await invoke<{ ok?: boolean; note?: string; error?: string }>("engine_playbook_run", { vault: vaultPath, id, domain: pb.domain ? null : domain || null });
      setMsg(r?.note ? `Ran: ${r.note}.` : r?.error ? `Not run: ${r.error}` : "Ran.");
      invalidateQueries("engine_jobs"); await q.refresh(); onChanged();
    } catch (e) { setMsg(`Not run: ${String(e)}`); } finally { setBusy(null); }
  };
  const adopt = async () => {
    setBusy("adopt"); setMsg(null);
    try { await invoke("engine_playbook_adopt", { vault: vaultPath, id }); await q.refresh(); onChanged(); setMsg("It is one of yours now."); }
    catch (e) { setMsg(`Not adopted: ${String(e)}`); } finally { setBusy(null); }
  };
  const needsDomain = !pb.domain;
  return (
    <section data-testid="playbook-detail" data-id={pb.id} className="max-w-3xl">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className={`${DETAIL_TITLE} break-words`}>{pb.name}</h2>
        {pb.draft && <span className={chip}>Draft</span>}
        {pb.source === "built-in" && <span className={chip}>Built in</span>}
      </div>
      <p className={`${BODY} mt-2 break-words text-text-secondary`}>{pb.goal}</p>
      <dl className={`${BODY} mt-3 grid grid-cols-[6rem_minmax(0,1fr)] gap-y-1 text-text-secondary`}>
        <dt className="text-text-muted">Domain</dt><dd>{pb.domain ? label(pb.domain) : "The one you run it in"}</dd>
        <dt className="text-text-muted">Runs</dt><dd data-testid="playbook-triggers">{triggerLine(pb.triggers)}</dd>
        {pb.from && (<><dt className="text-text-muted">From</dt><dd className="break-all">job {pb.from}</dd></>)}
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {needsDomain && (
          <select value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Run in domain" data-testid="playbook-domain" className="h-8 rounded-md border border-border bg-background px-2 text-[13px] text-text-primary">
            <option value="">Run in General</option>
            {domains.map((d) => <option key={d} value={d}>Run in {label(d)}</option>)}
          </select>
        )}
        <button onClick={() => void run()} disabled={!!busy} data-testid="playbook-run" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white disabled:opacity-50">
          {busy === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run
        </button>
        {pb.draft && <button onClick={() => void adopt()} disabled={!!busy} data-testid="playbook-adopt" className={smallBtn}>{busy === "adopt" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Adopt</button>}
      </div>
      {busy === "run" && <p className={`${META} mt-1`}>Running each step in turn. A specialist step can take a few minutes.</p>}
      {msg && <p className={`${META} mt-1`} data-testid="playbook-msg">{msg}</p>}

      <h3 className={`${SECTION_TITLE} mt-6`}>Steps</h3>
      <ol className="mt-2" data-testid="playbook-steps">
        {pb.rows.map((r) => (
          <li key={r.n} data-testid="playbook-step" className="flex items-start gap-3 border-b border-border-subtle py-2 last:border-b-0">
            <span className="w-5 shrink-0 pt-0.5 text-right text-[13px] tabular-nums text-text-muted">{r.n}</span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-[14px] font-semibold text-text-primary">{r.specialists.length ? r.specialists.map(label).join(" + ") : r.kind === "task" ? "For you" : label(r.kind)}</span>
                {r.gate && <span className={`${mark} border-accent-border text-accent`}>GATE</span>}
                {r.ask && <span className={`${mark} border-warn/50 text-warn`}>ASK</span>}
              </span>
              <span className="block break-words text-[13px] text-text-secondary">{r.label}</span>
            </span>
            <span className="shrink-0 pt-0.5 text-right text-[12px] text-text-muted">{r.kind === "task" ? <Hand className="inline h-3.5 w-3.5" aria-label="task" /> : label(r.returns.join(", "))}</span>
          </li>
        ))}
      </ol>
      <p className={`${META} mt-1`}>GATE stops the playbook when the check says it does not fit. ASK waits for your yes.</p>

      <h3 className={`${SECTION_TITLE} mt-6`}>Runs</h3>
      {pb.runs.length ? (
        <ul className="mt-1" data-testid="playbook-runs">{pb.runs.map((r) => (
          <li key={r.id} className="border-b border-border-subtle py-2 last:border-b-0">
            <button onClick={() => setOpenRun(openRun === r.id ? null : r.id)} aria-expanded={openRun === r.id} className="flex w-full items-start gap-3 text-left">
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[14px] text-text-primary">{r.summary ?? r.id}</span>
                <span className={META}>{isRunRecord(r.id) ? "Whole run" : "Step"} · {new Date(r.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              </span>
              <span className={chip}>{label(r.status)}</span>
            </button>
            {openRun === r.id && !isRunRecord(r.id) && <JobCard id={r.id} vaultPath={vaultPath} />}
          </li>
        ))}</ul>
      ) : <p className={`${BODY} mt-1 text-text-muted`}>Not run yet.</p>}
    </section>
  );
}
