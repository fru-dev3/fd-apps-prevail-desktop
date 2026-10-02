// Home is Today: the daily card (at most three things that matter, each with
// its thread back to a value or an honest "unlinked"), then the weekly review
// card when the week wants its check-in. Both come from the engine
// (`prevail today`, `prevail review week`); every tap goes back to it.
import { useState } from "react";
import { AlertTriangle, ArrowRight, CalendarClock, Check, ChevronDown, ChevronRight, CircleOff, Gavel, Loader2, MessageSquare, RefreshCw, Scale, ThumbsUp, X } from "lucide-react";
import { invoke } from "./bridge";
import { invalidateQueries, useInvokeQuery } from "./query";
import { BODY, META, SECTION_TITLE } from "./typescale";
import { fmtDue, label, type ReviewCard, type TodayCard, type TodayItem } from "./plansmodel";
import { WHO5_ITEMS, WHO5_SCALE } from "./qualmodel";

const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";
const chip = "inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[12px] text-text-secondary";
const smallBtn = "inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[13px] text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50";

function openSection(id: string) { window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: id })); }

/** The Home landing: Today, then the weekly review when it is due. Null until the engine has answered with something to show. */
export function TodayHome({ vaultPath, phone, onAsk, fallback }: { vaultPath: string; phone: boolean; onAsk: (text: string) => void; fallback: React.ReactNode }) {
  const today = useInvokeQuery<TodayCard>("engine_today", { vault: vaultPath, refresh: null }, { staleMs: 5 * 60_000 });
  const review = useInvokeQuery<ReviewCard>("engine_review", { vault: vaultPath }, { staleMs: 10 * 60_000 });
  const t = today.data && typeof today.data === "object" && Array.isArray(today.data.items) ? today.data : null;
  const r = review.data && typeof review.data === "object" && review.data.lines ? review.data : null;
  if (!t && !r) return <>{fallback}</>;
  return (
    <div data-testid="today-home" className={`mx-auto w-full max-w-3xl ${phone ? "px-4 py-4" : "px-6 py-8"}`}>
      {t && <TodayCardView card={t} vaultPath={vaultPath} onChanged={() => void today.refresh()} />}
      {r && (r.due || !t) && <div className="mt-8"><ReviewCardView card={r} vaultPath={vaultPath} onAsk={onAsk} onChanged={() => { invalidateQueries("engine_review"); void review.refresh(); }} /></div>}
    </div>
  );
}

function ItemRow({ x, n, busy, tap }: { x: TodayItem; n?: number; busy: string | null; tap: (key: string, a: string) => void }) {
  const open = x.kind === "decision" ? () => openSection("decisions") : x.kind === "job" ? () => openSection("specialists") : null;
  return (
    <li data-testid="today-item" data-kind={x.kind} className="flex items-start gap-3 border-b border-border-subtle py-3 last:border-b-0">
      {n !== undefined && <span className="w-5 shrink-0 pt-0.5 text-right text-[16px] font-semibold tabular-nums text-accent">{n}</span>}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="min-w-0 break-words text-[16px] font-semibold text-text-primary">{x.title}</span>
          {x.due && <span className={META}>{fmtDue(x.due)}</span>}
          {x.kind === "commitment" && <span className={chip}>Promise{x.person ? ` to ${label(x.person.split("/").pop() ?? "")}` : ""}</span>}
          {x.kind === "waiting" && <span className={chip}>Waiting{x.person ? ` on ${label(x.person.split("/").pop() ?? "")}` : ""}</span>}
        </div>
        <p className={`${META} mt-0.5`} data-testid="today-thread">{x.thread.join(" > ")}{x.unlinked ? ", unlinked to your Compass" : ""}</p>
      </div>
      <span className="flex shrink-0 items-center gap-0.5">
        {open && <button onClick={open} title="Open" aria-label={`Open ${x.title}`} className={iconBtn}><ArrowRight className="h-4 w-4" /></button>}
        {x.ref.id || x.ref.text ? (
          <>
            <button onClick={() => tap(x.key, "done")} disabled={!!busy} title="Done" aria-label={`Done: ${x.title}`} data-testid="today-done" className={iconBtn}>{busy === `${x.key}:done` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}</button>
            <button onClick={() => tap(x.key, "move")} disabled={!!busy} title="Move to tomorrow" aria-label={`Move to tomorrow: ${x.title}`} data-testid="today-move" className={iconBtn}><CalendarClock className="h-4 w-4" /></button>
          </>
        ) : null}
        <button onClick={() => tap(x.key, "not-important")} disabled={!!busy} title="Not important" aria-label={`Not important: ${x.title}`} data-testid="today-not-important" className={iconBtn}><CircleOff className="h-4 w-4" /></button>
      </span>
    </li>
  );
}

export function TodayCardView({ card, vaultPath, onChanged }: { card: TodayCard; vaultPath: string; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tap = async (key: string, action: string) => {
    setBusy(`${key}:${action}`); setErr(null);
    try { await invoke("engine_today_tap", { vault: vaultPath, key, action }); invalidateQueries("engine_today"); onChanged(); }
    catch (e) { setErr(`Could not save that: ${String(e)}`); }
    finally { setBusy(null); }
  };
  const refresh = async () => { setBusy("refresh"); try { await invoke("engine_today", { vault: vaultPath, refresh: true }); invalidateQueries("engine_today"); onChanged(); } finally { setBusy(null); } };
  const handled = new Set(card.feedback.filter((f) => f.action !== "right" && f.action !== "right-list").map((f) => f.key));
  const items = card.items.filter((x) => !handled.has(x.key));
  const day = new Date(`${card.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  return (
    <section data-testid="today-card">
      <div className="flex items-start gap-3">
        <h2 className="min-w-0 flex-1 font-display text-[28px] font-semibold leading-tight tracking-tight text-text-primary">Today, {day}</h2>
        {card.calm !== null && <span className={`${chip} mt-2`}>calm {card.calm}</span>}
        <button onClick={() => void refresh()} disabled={!!busy} title="Look again" aria-label="Look again" className={`${iconBtn} mt-1`}>{busy === "refresh" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</button>
      </div>
      {err && <p className="mt-2 text-[13px] text-err">{err}</p>}
      <h3 className={`${SECTION_TITLE} mt-5`}>What matters today</h3>
      {items.length ? (
        <ul className="mt-1">{items.map((x, i) => <ItemRow key={x.key} x={x} n={i + 1} busy={busy} tap={(k, a) => void tap(k, a)} />)}</ul>
      ) : <p className={`${BODY} mt-1 text-text-muted`}>Nothing with a date is pressing. A good day to move a goal.</p>}
      {items.length > 0 && !card.feedback.some((f) => f.action === "right-list") && (
        <button onClick={() => void tap("list", "right-list")} disabled={!!busy} data-testid="today-right-list" className={`${smallBtn} mt-2`}><ThumbsUp className="h-3.5 w-3.5" /> The right three</button>
      )}
      {card.fallingBehind && (
        <div className="mt-6" data-testid="today-falling-behind">
          <h3 className={SECTION_TITLE}>Falling behind</h3>
          <p className={`${BODY} mt-1 flex items-start gap-2 text-text-secondary`}><AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-warn" /><span className="min-w-0 break-words">{card.fallingBehind.text}</span></p>
        </div>
      )}
      {card.decisionDue && (
        <div className="mt-6" data-testid="today-decision">
          <h3 className={SECTION_TITLE}>Decision due</h3>
          <div className="mt-1 flex items-start gap-2">
            <Gavel className="mt-1 h-4 w-4 shrink-0 text-text-muted" />
            <p className={`${BODY} min-w-0 flex-1 break-words text-text-secondary`}>{card.decisionDue.question}{card.decisionDue.due ? ` Due ${fmtDue(card.decisionDue.due)}.` : ""}{card.decisionDue.recommendation ? " A recommendation is ready." : ""}</p>
            <button onClick={() => openSection("decisions")} title="Open decisions" aria-label="Open decisions" className={iconBtn}><ArrowRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}
      <div className="mt-6">
        <h3 className={SECTION_TITLE}>Your day</h3>
        <p className={`${BODY} mt-1 text-text-muted`} data-testid="today-your-day">{card.yourDay.note}</p>
      </div>
      {card.alsoDue.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setMore((v) => !v)} aria-expanded={more} data-testid="today-also-due" className={`${SECTION_TITLE} inline-flex items-center gap-1.5 hover:text-accent`}>
            Also due ({card.alsoDue.length}) {more ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {more && <ul className="mt-1">{card.alsoDue.filter((x) => !handled.has(x.key)).map((x) => <ItemRow key={x.key} x={x} busy={busy} tap={(k, a) => void tap(k, a)} />)}</ul>}
        </div>
      )}
    </section>
  );
}

const fmtVal = (v: number, unit: string) => unit === "usd" ? `$${v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2)}` : unit === "tokens" ? (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${Math.round(v / 1e3)}k`) : unit === "minutes" ? `${Math.round(v)} min` : String(Math.round(v * 10) / 10);

/** The weekly review card: the Compass check-in and the metrics glance in one. */
export function ReviewCardView({ card, vaultPath, onAsk, onChanged }: { card: ReviewCard; vaultPath: string; onAsk: (text: string) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (key: string, cmd: string, args: Record<string, unknown>) => {
    setBusy(key); setErr(null);
    try { await invoke(cmd, { vault: vaultPath, ...args }); onChanged(); }
    catch (e) { setErr(`Could not save that: ${String(e)}`); }
    finally { setBusy(null); }
  };
  const week = new Date(`${card.week}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const line = (title: string, xs: string[], empty: string) => (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3"><span className="w-20 shrink-0 text-[14px] font-semibold text-text-primary">{title}</span><span className={`${BODY} min-w-0 break-words text-text-secondary`}>{xs.length ? xs.join("; ") : empty}</span></div>
  );
  return (
    <section data-testid="review-card" className="rounded-xl border border-border p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="min-w-0 flex-1 font-display text-[24px] font-semibold leading-tight text-text-primary">Week of {week}</h2>
        {card.checkin && <span className={chip}>calm {card.checkin.calm}{card.calmNormal ? ` (normal ${card.calmNormal})` : ""}</span>}
      </div>
      {err && <p className="mt-2 text-[13px] text-err">{err}</p>}
      <div className="mt-3 space-y-1.5">
        {line("Moved", card.lines.moved, "Nothing past your normal.")}
        {line("Drifted", card.lines.drifted, "Nothing below your normal.")}
        {line("Conflict", [card.lines.conflict], "")}
      </div>
      {card.glance.length > 0 && (
        <ul className="mt-4 border-t border-border-subtle pt-3" data-testid="review-glance">
          {card.glance.map((g) => (
            <li key={g.id} className="flex flex-wrap items-baseline gap-x-3 py-1">
              <span className="min-w-0 flex-1 text-[15px] text-text-primary">{g.title}</span>
              {g.paused ? <span className={META} data-testid="review-paused">paused for {g.paused}</span> : g.documentary ? <span className={META}>{g.record ?? "a record, no target"}</span>
                : <><span className="text-[16px] font-semibold tabular-nums text-text-primary">{fmtVal(g.value, g.unit)}</span><span className={META}>{g.normal.learning ? "learning your normal" : `normal ${fmtVal(g.normal.lo, g.unit)} to ${fmtVal(g.normal.hi, g.unit)}`}</span></>}
            </li>
          ))}
          {card.surprise && <li className={`${BODY} pt-1 text-text-secondary`}><span className="font-semibold text-text-primary">One surprise: </span>{card.surprise}</li>}
        </ul>
      )}
      {card.candidates.length > 0 && (
        <div className="mt-4 border-t border-border-subtle pt-3" data-testid="review-candidates">
          <h3 className="text-[15px] font-semibold text-text-primary">You said</h3>
          <ul>{card.candidates.map((c) => (
            <li key={c.key} data-testid="review-candidate" className="flex items-start gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className={`${BODY} break-words text-text-secondary`}>"{c.quote}"</p>
                <p className={`${META} mt-0.5`}>Make "{c.title}" a {c.kind === "rule" ? "rule you never trade" : c.kind}? Heard {c.count} time{c.count === 1 ? "" : "s"}.</p>
              </div>
              <button onClick={() => void run(c.key, "engine_review_candidate", { key: c.key, answer: "yes" })} disabled={!!busy} title="Yes" aria-label={`Yes: ${c.title}`} className={iconBtn}><Check className="h-4 w-4" /></button>
              <button onClick={() => void run(c.key, "engine_review_candidate", { key: c.key, answer: "no" })} disabled={!!busy} title="Not now" aria-label={`Not now: ${c.title}`} className={iconBtn}><X className="h-4 w-4" /></button>
            </li>
          ))}</ul>
        </div>
      )}
      {card.metricProposals.length > 0 && (
        <div className="mt-4 border-t border-border-subtle pt-3" data-testid="review-metric-proposals">
          <h3 className="text-[15px] font-semibold text-text-primary">New metric?</h3>
          <ul>{card.metricProposals.map((p) => (
            <li key={p.key} className="flex items-start gap-3 py-2">
              <div className="min-w-0 flex-1"><p className="break-words text-[15px] text-text-primary">{p.title}</p><p className={`${META} mt-0.5 break-words`}>{p.why}</p></div>
              <button onClick={() => void run(p.key, "engine_metric_answer", { key: p.key, answer: "track" })} disabled={!!busy} title="Track" aria-label={`Track ${p.title}`} className={iconBtn}><Check className="h-4 w-4" /></button>
              <button onClick={() => void run(p.key, "engine_metric_answer", { key: p.key, answer: "dismiss" })} disabled={!!busy} title="Not useful" aria-label={`Not useful: ${p.title}`} className={iconBtn}><X className="h-4 w-4" /></button>
            </li>
          ))}</ul>
        </div>
      )}
      {(card.woop[0] || card.question) && (
        <div className="mt-4 border-t border-border-subtle pt-3">
          <p className={`${BODY} text-text-secondary`}>{card.woop[0] ? `Your goal "${card.woop[0].title}" needs its plan before it goes active.` : card.question!.text}</p>
          <button onClick={() => onAsk("Let's continue my Compass")} className={`${smallBtn} mt-2`} data-testid="review-continue"><MessageSquare className="h-3.5 w-3.5" /> Answer in chat</button>
        </div>
      )}
      {card.apps && <p className={`${BODY} mt-3 break-words text-text-secondary`} data-testid="review-apps">{card.apps}</p>}
      {(card.guardrails ?? []).map((g) => <p key={g} className={`${BODY} mt-2 break-words text-warn`} data-testid="review-guardrail">Guardrail: {g}</p>)}
      {card.hypothesis && (
        <div className="mt-4 flex items-start gap-3 border-t border-border-subtle pt-3" data-testid="review-hypothesis">
          <p className={`${BODY} min-w-0 flex-1 break-words text-text-primary`}>{card.hypothesis.text}</p>
          <button onClick={() => void run("hyp-yes", "engine_review_answer", { kind: "hypothesis", values: [card.hypothesis!.key, "yes"] })} disabled={!!busy} title="Yes" aria-label="Yes" data-testid="hypothesis-yes" className={iconBtn}><Check className="h-4 w-4" /></button>
          <button onClick={() => void run("hyp-no", "engine_review_answer", { kind: "hypothesis", values: [card.hypothesis!.key, "no"] })} disabled={!!busy} title="No" aria-label="No" data-testid="hypothesis-no" className={iconBtn}><X className="h-4 w-4" /></button>
        </div>
      )}
      {card.asked?.ladder && <LadderAsk busy={!!busy} onSave={(now, future) => void run("ladder", "engine_review_answer", { kind: "ladder", values: [String(now), String(future)] })} />}
      {card.asked?.who5 && <Who5Ask busy={!!busy} onSave={(xs) => void run("who5", "engine_review_answer", { kind: "who5", values: xs.map(String) })} />}
      {card.waited.length > 0 && <p className={`${META} mt-3`}>Waited for this review: {card.waited.map((w) => w.text).join("; ")}</p>}
      <div className="mt-4 border-t border-border-subtle pt-3" data-testid="review-checkin">
        {card.checkin ? (
          <p className={`${BODY} text-text-secondary`}>You said calm {card.checkin.calm} this week.</p>
        ) : (
          <>
            <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-text-primary"><Scale className="h-4 w-4 text-text-muted" /> How calm was this week?</h3>
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="How calm was this week, 1 to 5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => void run(`calm${n}`, "engine_review_checkin", { calm: n, note: null })} disabled={!!busy} data-testid={`review-calm-${n}`}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-[16px] font-semibold tabular-nums text-text-primary hover:border-accent-border hover:bg-accent-soft hover:text-accent disabled:opacity-50">{busy === `calm${n}` ? <Loader2 className="h-4 w-4 animate-spin" /> : n}</button>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Stepper({ label: l, value, onChange, testId }: { label: string; value: number; onChange: (n: number) => void; testId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 flex-1 basis-40 text-[15px] text-text-secondary">{l}</span>
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} aria-label={`${l}: lower`} className={iconBtn}>-</button>
      <span className="w-8 text-center text-[18px] font-semibold tabular-nums text-text-primary" data-testid={testId}>{value}</span>
      <button type="button" onClick={() => onChange(Math.min(10, value + 1))} aria-label={`${l}: higher`} className={iconBtn}>+</button>
    </div>
  );
}

/** Once a quarter: the Cantril ladder, now and in five years, 0 to 10. */
function LadderAsk({ busy, onSave }: { busy: boolean; onSave: (now: number, future: number) => void }) {
  const [now, setNow] = useState(5);
  const [future, setFuture] = useState(5);
  return (
    <div className="mt-4 border-t border-border-subtle pt-3" data-testid="review-ladder">
      <h3 className="text-[15px] font-semibold text-text-primary">Once a quarter: your ladder</h3>
      <p className={`${META} mt-0.5`}>0 is the worst possible life for you, 10 the best possible.</p>
      <div className="mt-2 max-w-md space-y-1.5">
        <Stepper label="Where you stand now" value={now} onChange={setNow} testId="ladder-now" />
        <Stepper label="Where you will stand in five years" value={future} onChange={setFuture} testId="ladder-future" />
      </div>
      <button onClick={() => onSave(now, future)} disabled={busy} className={`${smallBtn} mt-2`} data-testid="ladder-save"><Check className="h-3.5 w-3.5" /> Save</button>
    </div>
  );
}

/** The optional monthly WHO-5: five statements about the last two weeks, 0 to 5 each. */
function Who5Ask({ busy, onSave }: { busy: boolean; onSave: (xs: number[]) => void }) {
  const [xs, setXs] = useState<(number | null)[]>([null, null, null, null, null]);
  return (
    <div className="mt-4 border-t border-border-subtle pt-3" data-testid="review-who5">
      <h3 className="text-[15px] font-semibold text-text-primary">This month: the last two weeks</h3>
      <ul className="mt-2 space-y-2">{WHO5_ITEMS.map((item, i) => (
        <li key={item} className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 basis-56 text-[15px] text-text-secondary">{item}</span>
          <select aria-label={item} data-testid={`who5-${i}`} value={xs[i] ?? ""} onChange={(e) => setXs(xs.map((x, j) => (j === i ? Number(e.target.value) : x)))}
            className="h-9 min-w-0 max-w-full rounded-md border border-border bg-background px-2 text-[14px] text-text-primary">
            <option value="" disabled>Pick one</option>
            {WHO5_SCALE.map((s, n) => <option key={s} value={n}>{s}</option>)}
          </select>
        </li>
      ))}</ul>
      <button onClick={() => onSave(xs as number[])} disabled={busy || xs.some((x) => x === null)} className={`${smallBtn} mt-2`} data-testid="who5-save"><Check className="h-3.5 w-3.5" /> Save</button>
    </div>
  );
}
