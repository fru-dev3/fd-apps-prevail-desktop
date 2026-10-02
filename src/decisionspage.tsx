// Decisions: every open decision in one place, nearest first, each a record in
// its owner domain (memory/decisions/<slug>.md). The gut call is asked in one
// line before the recommendation shows; deciding logs it; 90 days later the
// retro asks which call was right, and calibration keeps the score per domain.
import { useMemo, useState } from "react";
import { Check, Gavel, History, Loader2, Target } from "lucide-react";
import { invoke } from "./bridge";
import { invalidateQueries, useInvokeQuery } from "./query";
import { Markdown } from "./Markdown";
import { SettingsHeader } from "./sectionutil";
import { SideSpine } from "./sidespine";
import { useIsPhone } from "./useisphone";
import { BODY, DETAIL_TITLE, META, SECTION_TITLE } from "./typescale";
import { fmtDue, label, type DecisionRecord } from "./plansmodel";

const chip = "inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[12px] text-text-secondary";
const input = "h-9 w-full rounded-md border border-border bg-background px-2.5 text-[14px] text-text-primary";
const smallBtn = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50";
const SECTIONS = ["Context", "Options", "Trade-offs", "Recommendation", "Decision", "Retro"];

/** Calibration per domain from decided records: how often the gut and the recommendation were right. */
export function calibrate(records: DecisionRecord[]): { domain: string; retros: number; gut: number; rec: number }[] {
  const by = new Map<string, { domain: string; retros: number; gut: number; rec: number }>();
  for (const r of records) {
    if (r.status !== "decided" || !r.retroRight) continue;
    const s = by.get(r.domain) ?? { domain: r.domain, retros: 0, gut: 0, rec: 0 };
    s.retros++;
    if (r.retroRight === "gut" || r.retroRight === "both") s.gut++;
    if (r.retroRight === "recommendation" || r.retroRight === "both") s.rec++;
    by.set(r.domain, s);
  }
  return [...by.values()];
}

export function DecisionsPage({ vaultPath }: { vaultPath: string }) {
  const phone = useIsPhone();
  const q = useInvokeQuery<DecisionRecord[]>("engine_decisions", { vault: vaultPath, all: true }, { staleMs: 30_000 });
  const all = useMemo(() => (Array.isArray(q.data) ? q.data : []), [q.data]);
  const open = all.filter((r) => r.status !== "decided");
  const decided = all.filter((r) => r.status === "decided");
  const [sel, setSel] = useState<string>("calibration");
  const [picked, setPicked] = useState(false);
  const key = (r: DecisionRecord) => `${r.domain}/${r.slug}`;
  const current = all.find((r) => key(r) === sel) ?? null;
  const choose = (s: string) => { setSel(s); setPicked(true); };
  const isOn = (s: string) => sel === s && (!phone || picked);
  const row = (r: DecisionRecord) => (
    <button key={key(r)} data-testid="decision-row" aria-current={isOn(key(r)) ? "true" : undefined} onClick={() => choose(key(r))}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${isOn(key(r)) ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
      <Gavel className={`h-4 w-4 shrink-0 ${isOn(key(r)) ? "text-accent" : "text-text-muted"}`} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[14px] ${isOn(key(r)) ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{r.question}</span>
        <span className="block truncate text-[12px] text-text-muted">{label(r.domain)}{r.due && r.status !== "decided" ? `, ${fmtDue(r.due)}` : r.decided ? `, decided ${r.decided}` : ""}</span>
      </span>
    </button>
  );
  const head = (t: string, n: number) => <div className="px-2.5 pb-1 pt-3 text-[13px] font-semibold text-text-secondary">{t} <span className="font-normal tabular-nums text-text-muted">{n}</span></div>;
  const column = (
    <nav className="space-y-0.5 p-2" aria-label="Decisions">
      <button data-testid="decision-row-calibration" aria-current={isOn("calibration") ? "true" : undefined} onClick={() => choose("calibration")}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${isOn("calibration") ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
        <Target className={`h-4 w-4 ${isOn("calibration") ? "text-accent" : "text-text-muted"}`} /><span className="text-[14px] text-text-secondary">Calibration</span>
      </button>
      {head("Open", open.length)}
      {open.map(row)}
      {head("Decided", decided.length)}
      {decided.map(row)}
    </nav>
  );
  const cal = calibrate(all);
  const detail = current ? <DecisionDetail r={current} vaultPath={vaultPath} onChanged={() => { invalidateQueries("engine_decisions"); invalidateQueries("engine_today"); void q.refresh(); }} /> : (
    <section data-testid="decisions-calibration" className="max-w-3xl">
      <h2 className={DETAIL_TITLE}>Calibration</h2>
      <p className={`${BODY} mt-1 text-text-secondary`}>Ninety days after a decision, you say which call was right: your gut, the recommendation, both or neither. Per domain, you learn which to trust.</p>
      {cal.length ? (
        <table className="mt-4 w-full max-w-xl text-left text-[14px]">
          <thead><tr className="text-text-muted"><th className="py-1 font-medium">Domain</th><th className="font-medium">Retros</th><th className="font-medium">Gut right</th><th className="font-medium">Recommendation right</th></tr></thead>
          <tbody>{cal.map((c) => <tr key={c.domain} className="border-t border-border-subtle"><td className="py-1.5">{label(c.domain)}</td><td className="tabular-nums">{c.retros}</td><td className="tabular-nums">{c.gut}</td><td className="tabular-nums">{c.rec}</td></tr>)}</tbody>
        </table>
      ) : <p className={`${BODY} mt-4 text-text-muted`}>No retros yet. {open.length ? `${open.length} decision${open.length === 1 ? " is" : "s are"} open.` : "No open decisions."}</p>}
    </section>
  );
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="decisions-page">
      <SettingsHeader title="Decisions" icon={Gavel} subtitle="Every open decision, with your gut call, a recommendation and a retro." />
      <SideSpine storageKey="prevail.decisions.spine" title="Decisions" label="decisions" testId="decisions-list"
        meta={<span>{open.length} open</span>} phone={phone} phoneDetail={phone && picked} onBack={() => setPicked(false)} backLabel="Decisions"
        detail={<div className={phone ? "px-4 py-4" : "w-full px-8 py-6"}>{detail}</div>}>
        {column}
      </SideSpine>
    </div>
  );
}

function DecisionDetail({ r, vaultPath, onChanged }: { r: DecisionRecord; vaultPath: string; onChanged: () => void }) {
  const [text, setText] = useState("");
  const [why, setWhy] = useState("");
  const [right, setRight] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const act = async (action: string, t: string, extra: Record<string, unknown> = {}) => {
    setBusy(true); setErr(null);
    try { await invoke("engine_decision_action", { vault: vaultPath, target: `${r.domain}/${r.slug}`, action, text: t, why: null, right: null, ...extra }); setText(""); setWhy(""); onChanged(); }
    catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  const retroDue = r.status === "decided" && !r.retroRight && r.retroDue && r.retroDue <= new Date().toISOString().slice(0, 10);
  return (
    <section data-testid="decision-detail" className="max-w-3xl">
      <h2 className={DETAIL_TITLE}>{r.question}</h2>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className={chip}>{label(r.domain)}</span>
        {r.due && r.status !== "decided" && <span className={chip}>Due {fmtDue(r.due)}</span>}
        {r.consulted.map((d) => <span key={d} className={chip}>Reads {label(d)}</span>)}
        {r.status === "decided" && <span className={`${chip} border-accent-border text-accent`}>Decided {r.decided}</span>}
      </div>
      {r.status !== "decided" && !r.gut && (
        <div className="mt-5 rounded-lg border border-accent-border bg-accent-soft/40 p-3" data-testid="decision-gut">
          <p className={`${BODY} text-text-primary`}>Before the recommendation: what does your gut say, in one line?</p>
          <div className="mt-2 flex gap-2"><input value={text} onChange={(e) => setText(e.target.value)} aria-label="Your gut call" className={input} /><button onClick={() => void act("gut", text)} disabled={busy || !text.trim()} className={smallBtn}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Save</button></div>
        </div>
      )}
      {r.gut && <p className={`${BODY} mt-4 text-text-secondary`}><span className="text-text-muted">Your gut: </span>{r.gut}</p>}
      {r.gut && r.recommendation && <p className={`${BODY} mt-1 text-text-secondary`}><span className="text-text-muted">Recommendation: </span>{r.recommendation}{r.confidence ? ` (confidence ${r.confidence})` : ""}</p>}
      {SECTIONS.filter((s) => r.sections[s]?.trim() && (s !== "Recommendation" || r.gut)).map((s) => (
        <div key={s} className="mt-5"><h3 className={SECTION_TITLE}>{s}</h3><div className={`${BODY} mt-1 text-text-secondary`}><Markdown source={r.sections[s]!} /></div></div>
      ))}
      {r.status !== "decided" && r.gut && (
        <div className="mt-6" data-testid="decision-decide">
          <h3 className={SECTION_TITLE}>Decide</h3>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="What you chose" aria-label="What you chose" className={input} /><input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why, in a line" aria-label="Why" className={input} /><button onClick={() => void act("decide", text, { why })} disabled={busy || !text.trim()} className={smallBtn}>Decide</button></div>
        </div>
      )}
      {retroDue && (
        <div className="mt-6" data-testid="decision-retro">
          <h3 className={`${SECTION_TITLE} flex items-center gap-1.5`}><History className="h-4 w-4 text-text-muted" />How did it play out?</h3>
          <input value={text} onChange={(e) => setText(e.target.value)} aria-label="How it played out" className={`${input} mt-2`} />
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Which call was right">
            {["gut", "recommendation", "both", "neither"].map((k) => <button key={k} onClick={() => setRight(k)} aria-pressed={right === k} className={`${chip} h-8 px-3 ${right === k ? "border-accent-border bg-accent-soft text-accent" : ""}`}>{label(k)}</button>)}
            <button onClick={() => void act("retro", text, { right })} disabled={busy || !text.trim() || !right} className={smallBtn}>Save</button>
          </div>
        </div>
      )}
      {r.status === "decided" && !retroDue && !r.retroRight && r.retroDue && <p className={`${META} mt-6`}>The retro is due {r.retroDue}.</p>}
      {err && <p className="mt-2 text-[13px] text-err">{err}</p>}
      <p className={`${META} mt-6 break-all`}>{r.file}</p>
    </section>
  );
}
