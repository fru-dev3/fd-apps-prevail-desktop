// Compass, Goals G3: what needs the user (conflicts as questions with their
// evidence, rules at risk or broken, goals gone quiet, plans a goal needs), the
// non-negotiables as code checks them, and said vs did (attention per value
// beside matters and lived). Data: `prevail compass align` (engine_compass_align),
// shared by every block on the page through the query cache.
import { useState } from "react";
import { CheckCircle2, Handshake, Loader2, Sparkles } from "lucide-react";
import { invoke } from "./bridge";
import { useInvokeQuery } from "./query";
import { BODY, META, SECTION_TITLE } from "./typescale";
import { RULE_STATE_LABEL, type Rollup } from "./plansmodel";

const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";
const chip = "inline-flex items-center rounded-full border px-2 py-0.5 text-[12px]";
const STATE_TONE: Record<string, string> = { ok: "border-accent-border text-accent", "at-risk": "border-warn/50 text-warn", broken: "border-err/50 text-err", unchecked: "border-border text-text-muted" };

function useRollup(vaultPath: string) {
  return useInvokeQuery<Rollup>("engine_compass_align", { vault: vaultPath, model: null }, { staleMs: 10 * 60_000 });
}

/** Needs you: conflicts with evidence (Accept the tension, Resolved), rules at risk, quiet goals, missing plans. */
export function AlignNeedsYou({ vaultPath }: { vaultPath: string }) {
  const q = useRollup(vaultPath);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const r = q.data && typeof q.data === "object" && Array.isArray(q.data.needsYou) ? q.data : null;
  const answer = async (key: string, ans: "accept" | "resolved") => {
    setBusy(key); setErr(null);
    try { await invoke("engine_compass_conflict", { vault: vaultPath, key, answer: ans }); await q.refresh(); }
    catch (e) { setErr(`Not saved: ${String(e)}`); } finally { setBusy(null); }
  };
  const model = async () => {
    setBusy("model"); setErr(null);
    try { await invoke("engine_compass_align", { vault: vaultPath, model: true }); await q.refresh(); }
    catch (e) { setErr(`The check did not run: ${String(e)}`); } finally { setBusy(null); }
  };
  const evidence = new Map((r?.conflicts ?? []).map((c) => [c.key, c]));
  return (
    <section className="mt-6 max-w-3xl" data-testid="align-needs-you">
      <div className="flex items-center gap-2">
        <h3 className={`${SECTION_TITLE} min-w-0 flex-1`}>Needs you</h3>
        <button onClick={() => void model()} disabled={!!busy} title="Check with the model" aria-label="Check with the model" data-testid="align-model" className={iconBtn}>
          {busy === "model" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        </button>
      </div>
      {err && <p className="mt-1 text-[13px] text-err">{err}</p>}
      {!r && <p className={`${BODY} mt-1 text-text-muted`}>{q.loading ? "Checking your Compass..." : "Could not check the Compass yet."}</p>}
      {r && !r.needsYou.length && <p className={`${BODY} mt-1 text-text-muted`}>Nothing needs you: no conflict with evidence, no rule at risk.</p>}
      {r && r.needsYou.length > 0 && (
        <ul className="mt-1">{r.needsYou.map((n) => {
          const c = n.kind === "conflict" ? evidence.get(n.key) : undefined;
          return (
            <li key={n.key} data-testid="align-need" data-kind={n.kind} className="flex items-start gap-2 border-b border-border-subtle py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className={`${BODY} break-words text-text-primary`}>{n.text}</p>
                {c && <p className={`${META} mt-0.5 break-words`} data-testid="align-evidence">{c.evidence.join("; ")}{c.asserted_by === "model" ? " (found by the model, from your words)" : ""}</p>}
              </div>
              {n.kind === "conflict" && (
                <>
                  <button onClick={() => void answer(n.key, "accept")} disabled={!!busy} title="Accept the tension" aria-label="Accept the tension" data-testid="align-accept" className={iconBtn}>{busy === n.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Handshake className="h-4 w-4" />}</button>
                  <button onClick={() => void answer(n.key, "resolved")} disabled={!!busy} title="Resolved" aria-label="Resolved" data-testid="align-resolved" className={iconBtn}><CheckCircle2 className="h-4 w-4" /></button>
                </>
              )}
            </li>
          );
        })}</ul>
      )}
    </section>
  );
}

/** Each confirmed rule as code checks it. */
export function AlignRules({ vaultPath }: { vaultPath: string }) {
  const r = useRollup(vaultPath).data;
  const rules = r && Array.isArray(r.rules) ? r.rules : [];
  if (!rules.length) return null;
  return (
    <section className="mt-6 max-w-3xl" data-testid="align-rules">
      <h3 className={SECTION_TITLE}>Checked in code</h3>
      <p className={`${META} mt-1`}>A rule with a check is read from your data; anything that would break a hard one is blocked before it runs.</p>
      <ul className="mt-2">{rules.map((x) => (
        <li key={x.id} data-testid="align-rule" data-state={x.state} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border-subtle py-2 last:border-b-0">
          <span className="min-w-[10rem] flex-1 break-words text-[15px] text-text-primary">{x.title}</span>
          <span className={`${chip} ${STATE_TONE[x.state]}`}>{RULE_STATE_LABEL[x.state]}</span>
          <span className={`${META} w-full break-words`}>{x.detail}</span>
        </li>
      ))}</ul>
    </section>
  );
}

/** Said vs did: the share of the month's activity that went to each value, beside its rank. */
export function SaidVsDid({ vaultPath }: { vaultPath: string }) {
  const r = useRollup(vaultPath).data;
  const values = r && Array.isArray(r.values) ? r.values : [];
  if (!values.length) return null;
  return (
    <section className="mt-8 max-w-3xl" data-testid="said-vs-did">
      <h3 className={SECTION_TITLE}>Said and did</h3>
      <p className={`${META} mt-1`}>Your rank for each value beside the share of this month's activity in the domains its goals live in.</p>
      {r!.saidVsDid.length > 0 && <ul className={`${BODY} mt-2 list-disc pl-5 text-text-secondary`}>{r!.saidVsDid.map((l) => <li key={l} className="break-words">{l}</li>)}</ul>}
      <ul className="mt-3 space-y-2">{values.map((v) => (
        <li key={v.id} data-testid="said-row" className="flex min-w-0 items-center gap-2">
          <span className="w-6 shrink-0 text-right text-[14px] font-semibold tabular-nums text-accent">{v.rank}</span>
          <span className="w-32 min-w-0 shrink truncate text-[14px] text-text-primary sm:w-48">{v.title}</span>
          <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-warm" aria-hidden><span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, v.attention))}%` }} /></span>
          <span className="w-12 shrink-0 text-right text-[13px] tabular-nums text-text-secondary">{v.attention}%</span>
        </li>
      ))}</ul>
    </section>
  );
}
