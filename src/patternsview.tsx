// Insights > Metrics > Patterns (metrics plan M4): what moves what, with time
// lags and chance controlled; passive proxies only once they predict your own
// check-ins; the themes of what you write and read, as words; seasons that
// pause targets; and the optional monthly WHO-5. Every line is a pattern, not
// proof.
import { useState } from "react";
import { invoke, isBrowser } from "./bridge";
import { invalidateQueries, useInvokeQuery } from "./query";
import { toast } from "./toast";
import { BODY, DETAIL_TITLE, META, SECTION_TITLE } from "./typescale";
import { seasonLine, type LagTest, type Proxy, type Season, type ThemeTrend } from "./qualmodel";
import { PatternsAndExperiments } from "./storiesview";

const chip = "inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[12px] text-text-secondary";

function Words({ label, xs }: { label: string; xs: string[] }) {
  if (!xs.length) return null;
  return <p className={`${BODY} break-words text-text-secondary`}><span className="font-semibold text-text-primary">{label}: </span>{xs.join(", ")}</p>;
}

export function PatternsView({ vaultPath }: { vaultPath: string }) {
  const q = (view: string) => ({ vault: vaultPath, view, week: null });
  const lags = useInvokeQuery<LagTest[]>("engine_metrics", q("lags"), { staleMs: 10 * 60_000 });
  const prox = useInvokeQuery<Proxy[]>("engine_metrics", q("proxies"), { staleMs: 10 * 60_000 });
  const themes = useInvokeQuery<ThemeTrend[]>("engine_metrics", q("themes"), { staleMs: 10 * 60_000 });
  const seasons = useInvokeQuery<Season[]>("engine_metrics", q("seasons"), { staleMs: 10 * 60_000 });
  const who5 = useInvokeQuery<boolean>("metrics_who5_state", { vault: vaultPath }, { staleMs: 60_000 });
  const [busy, setBusy] = useState(false);
  const arr = <T,>(d: unknown) => (Array.isArray(d) ? (d as T[]) : []);
  const toggle = async (on: boolean) => {
    setBusy(true);
    try { await invoke("engine_review_answer", { vault: vaultPath, kind: "who5-toggle", values: [on ? "on" : "off"] }); invalidateQueries("metrics_who5_state"); invalidateQueries("engine_review"); void who5.refresh(); }
    catch (e) { toast.error(String(e)); } finally { setBusy(false); }
  };
  const on = who5.data === true;
  return (
    <section data-testid="metrics-patterns">
      <h2 className={DETAIL_TITLE}>Patterns</h2>
      <p className={`${META} mt-1`}>A pattern, not proof. Chance is controlled across every test; an input that moves nothing is said plainly.</p>

      <h3 className={`${SECTION_TITLE} mt-6`}>What moves what</h3>
      <ul className="mt-2 max-w-4xl">{arr<LagTest>(lags.data).map((l) => (
        <li key={`${l.input}>${l.outcome}`} data-testid="pattern-lag" className="border-b border-border-subtle py-2.5 last:border-b-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><p className={`${BODY} min-w-0 flex-1 break-words text-text-primary`}>{l.text}</p><span className={chip}>{l.verdict}</span></div>
        </li>
      ))}</ul>
      {!arr(lags.data).length && <p className={`${BODY} mt-2 text-text-muted`}>No pairs to test yet.</p>}

      <PatternsAndExperiments vaultPath={vaultPath} />

      <h3 className={`${SECTION_TITLE} mt-6`}>Signals for how you feel</h3>
      <p className={`${META} mt-1`}>A passive signal is shown only once it predicts your own weekly check-ins.</p>
      <ul className="mt-2 max-w-4xl">{arr<Proxy>(prox.data).map((p) => (
        <li key={`${p.proxy}>${p.felt}`} data-testid="pattern-proxy" className="border-b border-border-subtle py-2.5 last:border-b-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><p className={`${BODY} min-w-0 flex-1 break-words text-text-primary`}>{p.text}</p><span className={chip}>{p.status === "promoted" ? "shown" : p.status}</span></div>
        </li>
      ))}</ul>

      <h3 className={`${SECTION_TITLE} mt-6`}>Themes</h3>
      <div className="mt-2 max-w-4xl space-y-3">{arr<ThemeTrend>(themes.data).map((t) => (
        <div key={t.kind} data-testid={`pattern-themes-${t.kind}`}>
          <p className="text-[16px] font-semibold text-text-primary">{t.kind === "writing" ? "What you write about" : "What you read about"}{t.month ? `, ${t.month}` : ""}</p>
          {t.topics.length ? <><Words label="New" xs={t.new} /><Words label="Steady" xs={t.steady} /><Words label="Gone" xs={t.gone} /></> : null}
          <p className={`${META} mt-0.5 break-words`}>{t.state}</p>
        </div>
      ))}</div>

      <h3 className={`${SECTION_TITLE} mt-6`}>Seasons</h3>
      <ul className="mt-2 max-w-4xl">{arr<Season>(seasons.data).map((s) => (
        <li key={s.id} data-testid="pattern-season" className="py-1.5"><span className="text-[15px] font-semibold text-text-primary">{s.title}</span> <span className={META}>{seasonLine(s)}</span></li>
      ))}</ul>
      {!arr(seasons.data).length && <p className={`${BODY} mt-2 text-text-muted`}>No season right now. A week away pauses work targets by itself; add one under ## Seasons in metrics.md.</p>}

      <h3 className={`${SECTION_TITLE} mt-6`}>Monthly WHO-5</h3>
      <div className="mt-2 flex max-w-4xl flex-wrap items-center gap-3">
        <p className={`${BODY} min-w-0 flex-1 basis-64 text-text-secondary`}>Five questions about the last two weeks, once a month on the review card. Optional; off unless you turn it on.</p>
        <button type="button" role="switch" aria-checked={on} aria-label="Monthly WHO-5" disabled={busy || isBrowser()} onClick={() => void toggle(!on)} data-testid="who5-toggle"
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-45 ${on ? "bg-accent" : "bg-surface-strong"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-[left] ${on ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>
    </section>
  );
}
