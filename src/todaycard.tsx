// Home is Today: the daily card (at most three things that matter, each with
// its thread back to a value or an honest "unlinked"), then the weekly review
// card when the week wants its check-in. Both come from the engine
// (`prevail today`, `prevail review week`); every tap goes back to it.
import { useState } from "react";
import { AlertTriangle, ArrowRight, CalendarClock, Check, ChevronDown, ChevronRight, CircleOff, Copy, Gavel, Handshake, Hourglass, Loader2, Mail, MessageSquare, RefreshCw, Scale, ThumbsUp, Undo2, X } from "lucide-react";
import { invoke } from "./bridge";
import { invalidateQueries, useInvokeQuery } from "./query";
import { BODY, DETAIL_TITLE, META, SECTION_TITLE } from "./typescale";
import { fmtDue, label, openDecision, personName, radarGroups, type Radar, type ReviewCard, type TimeReview, type TodayCard, type TodayItem } from "./plansmodel";
import { openMission } from "./missions";
import { WHO5_ITEMS, WHO5_SCALE } from "./qualmodel";
import { RowMenu } from "./ui";
import { TellBox } from "./tellbox";

const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";
const iconSm = "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";
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
      {/* Desktop Home stays clean: the chat composer below already files anything said to it. */}
      {phone && <TellBox vaultPath={vaultPath} surface="phone" />}
      {t && <TodayCardView card={t} vaultPath={vaultPath} onChanged={() => void today.refresh()} />}
      {r && (r.due || !t) && <div className="mt-8"><ReviewCardView card={r} vaultPath={vaultPath} onAsk={onAsk} onChanged={() => { invalidateQueries("engine_review"); void review.refresh(); }} /></div>}
    </div>
  );
}

function ItemRow({ x, n, busy, tap }: { x: TodayItem; n?: number; busy: string | null; tap: (key: string, a: string) => void }) {
  const open = x.kind === "decision" ? () => (x.ref.slug ? openDecision(`${x.ref.domain}/${x.ref.slug}`) : openSection("decisions"))
    : x.kind === "job" ? () => openSection("specialists")
    : x.kind === "mission" && x.ref.mission ? () => openMission(x.ref.mission!) : null;
  return (
    <li data-testid="today-item" data-kind={x.kind} className="group flex items-start gap-3 border-b border-border-subtle py-2.5 last:border-b-0">
      {n !== undefined && <span className="w-4 shrink-0 pt-px text-right text-[13px] tabular-nums text-text-muted">{n}</span>}
      <div className="min-w-0 flex-1">
        <p title={x.title} className="line-clamp-2 break-words text-[15px] font-medium leading-snug text-text-primary">{x.title}</p>
        <p className={`${META} mt-0.5 flex min-w-0 whitespace-pre`} title={`${x.thread.join(" > ")}${x.unlinked ? ", not linked to your Compass" : ""}`}>
          {x.due && <span className={/late/.test(fmtDue(x.due)) ? "text-warn" : ""}>{fmtDue(x.due)}</span>}
          {x.due && <span aria-hidden> · </span>}
          {x.kind === "commitment" && <span>Promise{x.person ? ` to ${label(x.person.split("/").pop() ?? "")}` : ""} · </span>}
          {x.kind === "waiting" && <span>Waiting{x.person ? ` on ${label(x.person.split("/").pop() ?? "")}` : ""} · </span>}
          {x.kind === "mission" && <span data-testid="today-mission-chip">Mission · </span>}
          <span data-testid="today-thread" className="min-w-0 truncate">{shortThread(x.thread, x.unlinked)}</span>
        </p>
      </div>
      {/* Progressive reveal: actions appear on hover (always on touch). */}
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
        {x.ref.id || x.ref.text ? (
          <button onClick={() => tap(x.key, "done")} disabled={!!busy} title="Done" aria-label={`Done: ${x.title}`} data-testid="today-done" className={iconSm}>{busy === `${x.key}:done` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}</button>
        ) : null}
        <RowMenu items={[
          ...(open ? [{ icon: ArrowRight, label: "Open", onClick: open }] : []),
          ...(x.ref.id || x.ref.text ? [{ icon: CalendarClock, label: "Move to tomorrow", onClick: () => tap(x.key, "move") }] : []),
          { icon: CircleOff, label: "Not important", onClick: () => tap(x.key, "not-important") },
        ]} />
      </span>
    </li>
  );
}

/** "Money · Peace of mind": where it lives and what it serves; the full chain is on hover. */
function shortThread(thread: string[], unlinked?: boolean): string {
  if (!thread.length) return unlinked ? "Not linked" : "";
  const head = thread[0];
  const tail = thread.length > 1 ? thread[thread.length - 1] : "";
  return unlinked ? `${head} · Not linked` : tail && tail !== head ? `${head} · ${tail}` : head;
}

export function TodayCardView({ card, vaultPath, onChanged }: { card: TodayCard; vaultPath: string; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [radarOpen, setRadarOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tap = async (key: string, action: string) => {
    setBusy(`${key}:${action}`); setErr(null);
    try { await invoke("engine_today_tap", { vault: vaultPath, key, action }); invalidateQueries("engine_today"); onChanged(); }
    catch (e) { setErr(`Could not save that: ${String(e)}`); }
    finally { setBusy(null); }
  };
  const refresh = async () => { setBusy("refresh"); try { await invoke("engine_today", { vault: vaultPath, refresh: true }); invalidateQueries("engine_today"); onChanged(); } finally { setBusy(null); } };
  const undoAdded = async (id: string) => {
    setBusy(`undo:${id}`); setErr(null);
    try { await invoke("engine_commitment_undo", { vault: vaultPath, id }); await invoke("engine_today", { vault: vaultPath, refresh: true }); invalidateQueries("engine_today"); onChanged(); }
    catch (e) { setErr(`Could not undo that: ${String(e)}`); }
    finally { setBusy(null); }
  };
  const handled = new Set(card.feedback.filter((f) => f.action !== "right" && f.action !== "right-list").map((f) => f.key));
  const items = card.items.filter((x) => !handled.has(x.key));
  const day = new Date(`${card.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  return (
    <section data-testid="today-card">
      <div className="flex items-start gap-3">
        <h2 className={`min-w-0 flex-1 break-words ${DETAIL_TITLE}`}>Today, {day}</h2>
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
      {card.promises && card.promises.length > 0 && (
        <div className="mt-6" data-testid="today-promises">
          <h3 className={SECTION_TITLE}>Promises this week</h3>
          <ul className="mt-1">{card.promises.map((p) => (
            <li key={p.key} data-testid="today-promise" data-slipping={p.slipping ? "true" : undefined} className="flex items-start gap-2.5 border-b border-border-subtle py-2 last:border-b-0">
              {p.kind === "waiting" ? <Hourglass className="mt-1 h-4 w-4 shrink-0 text-text-muted" /> : <Handshake className={`mt-1 h-4 w-4 shrink-0 ${p.slipping ? "text-warn" : "text-text-muted"}`} />}
              <div className="min-w-0 flex-1">
                <p className="break-words text-[15px] text-text-primary">{p.title}</p>
                <p className={`${META} ${p.slipping ? "text-warn" : ""}`}>{p.kind === "waiting" ? `Waiting on ${personName(p.person) || "someone"}` : `To ${personName(p.person) || "someone"}`}, {p.why}</p>
              </div>
            </li>
          ))}</ul>
        </div>
      )}
      {card.added && card.added.length > 0 && (
        <div className="mt-6" data-testid="today-added">
          <h3 className={SECTION_TITLE}>Added from your mail and notes</h3>
          <ul className="mt-1">{card.added.map((a) => (
            <li key={a.id} className="flex items-start gap-2.5 py-1.5">
              <Mail className="mt-1 h-4 w-4 shrink-0 text-text-muted" />
              <p className={`${BODY} min-w-0 flex-1 break-words text-text-secondary`}>{a.text} <span className={META}>on {label(a.domain)}'s board, from {a.src === "meeting" ? "meeting notes" : "sent mail"}</span></p>
              <button onClick={() => void undoAdded(a.id)} disabled={!!busy} title="Undo" aria-label={`Undo: ${a.text}`} data-testid="today-added-undo" className={iconBtn}>{busy === `undo:${a.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}</button>
            </li>
          ))}</ul>
        </div>
      )}
      {card.fallingBehind && (
        <div className="mt-6" data-testid="today-falling-behind">
          <h3 className={SECTION_TITLE}>Falling behind</h3>
          <p className={`${BODY} mt-1 flex items-start gap-2 text-text-secondary`}><AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-warn" /><span className="min-w-0 break-words">{card.fallingBehind.text}</span></p>
          {(card.fallingBehind.count ?? 0) > 1 && (
            <button onClick={() => setRadarOpen((v) => !v)} aria-expanded={radarOpen} data-testid="today-radar-more" className={`${smallBtn} mt-2`}>
              {radarOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} And {(card.fallingBehind.count ?? 1) - 1} more
            </button>
          )}
          {radarOpen && <RadarList vaultPath={vaultPath} />}
        </div>
      )}
      {card.decisionDue && (
        <div className="mt-6" data-testid="today-decision">
          <h3 className={SECTION_TITLE}>Decision due</h3>
          <div className="mt-1 flex items-start gap-2">
            <Gavel className="mt-1 h-4 w-4 shrink-0 text-text-muted" />
            <p className={`${BODY} min-w-0 flex-1 break-words text-text-secondary`}>{card.decisionDue.question}{card.decisionDue.due ? ` Due ${fmtDue(card.decisionDue.due)}.` : ""}{card.decisionDue.recommendation ? " A recommendation is ready." : ""}</p>
            <button onClick={() => openDecision(`${card.decisionDue!.domain}/${card.decisionDue!.slug}`)} title="Open the decision" aria-label="Open the decision" data-testid="today-decision-open" className={iconBtn}><ArrowRight className="h-4 w-4" /></button>
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

/** Everything the radar holds, grouped by kind, each with its evidence (the Sentinel's one list). */
export function RadarList({ vaultPath }: { vaultPath: string }) {
  const q = useInvokeQuery<Radar>("engine_radar", { vault: vaultPath, refresh: null }, { staleMs: 5 * 60_000 });
  const [busy, setBusy] = useState(false);
  const refresh = async () => { setBusy(true); try { await invoke("engine_radar", { vault: vaultPath, refresh: true }); invalidateQueries("engine_radar"); await q.refresh(); } finally { setBusy(false); } };
  const items = q.data && Array.isArray(q.data.items) ? q.data.items : [];
  return (
    <div data-testid="radar-list" className="mt-3">
      <div className="flex items-center gap-2">
        <span className={`${META} min-w-0 flex-1`}>{q.data?.computed ? `Checked ${new Date(q.data.computed).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : q.loading ? "Looking..." : ""}</span>
        <button onClick={() => void refresh()} disabled={busy} title="Look again" aria-label="Look again at what is falling behind" data-testid="radar-refresh" className={iconBtn}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</button>
      </div>
      {!items.length && !q.loading && <p className={`${BODY} text-text-muted`}>Nothing is falling behind.</p>}
      {radarGroups(items).map((g) => (
        <div key={g.kind} className="mt-3" data-testid="radar-group" data-kind={g.kind}>
          <h4 className="text-[15px] font-semibold text-text-primary">{g.label}</h4>
          <ul>{g.items.map((x) => (
            <li key={x.key} className="border-b border-border-subtle py-1.5 last:border-b-0">
              <p className="break-words text-[15px] text-text-secondary">{x.text}</p>
              <p className={`${META} break-words`}>{x.evidence}{x.domain && x.domain !== "general" ? `, ${label(x.domain)}` : ""}</p>
            </li>
          ))}</ul>
        </div>
      ))}
    </div>
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
        <h2 className={`min-w-0 flex-1 ${DETAIL_TITLE}`}>Week of {week}</h2>
        {card.checkin && <span className={chip}>calm {card.checkin.calm}{card.calmNormal ? ` (normal ${card.calmNormal})` : ""}</span>}
      </div>
      {err && <p className="mt-2 text-[13px] text-err">{err}</p>}
      <div className="mt-3 space-y-1.5">
        {line("Moved", card.lines.moved, "Nothing past your normal.")}
        {line("Drifted", card.lines.drifted, "Nothing below your normal.")}
        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3" data-testid="review-conflict">
          <span className="w-20 shrink-0 text-[14px] font-semibold text-text-primary">Conflict</span>
          <div className="min-w-0 flex-1">
            <span className={`${BODY} break-words text-text-secondary`}>{card.lines.conflict}</span>
            {card.conflict?.evidence.length ? <p className={`${META} mt-0.5 break-words`} data-testid="review-conflict-evidence">{card.conflict.evidence.join("; ")}</p> : null}
          </div>
          {card.conflict?.key && <button onClick={() => void run("conflict", "engine_compass_conflict", { key: card.conflict!.key, answer: "accept" })} disabled={!!busy} title="Accept the tension" aria-label="Accept the tension" data-testid="review-conflict-accept" className={iconBtn}><Handshake className="h-4 w-4" /></button>}
        </div>
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
      {card.commitments && card.commitments.length > 0 && (
        <div className="mt-4 border-t border-border-subtle pt-3" data-testid="review-commitments">
          <h3 className="text-[15px] font-semibold text-text-primary">A promise?</h3>
          <ul>{card.commitments.map((c) => (
            <li key={c.src} data-testid="review-commitment" className="flex items-start gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className={`${BODY} break-words text-text-secondary`}>"{c.quote}"</p>
                <p className={`${META} mt-0.5 break-words`}>Track "{c.text}"{c.person ? ` for ${personName(c.person)}` : ""}{c.due ? `, due ${fmtDue(c.due)}` : ""}?</p>
              </div>
              <button onClick={() => void run(c.src, "engine_commitment_answer", { src: c.src, yes: true, domain: null })} disabled={!!busy} title="Yes" aria-label={`Yes: ${c.text}`} data-testid="review-commitment-yes" className={iconBtn}><Check className="h-4 w-4" /></button>
              <button onClick={() => void run(c.src, "engine_commitment_answer", { src: c.src, yes: false, domain: null })} disabled={!!busy} title="Not now" aria-label={`Not now: ${c.text}`} className={iconBtn}><X className="h-4 w-4" /></button>
            </li>
          ))}</ul>
        </div>
      )}
      {card.missions && card.missions.length > 0 && (
        <div className="mt-4 border-t border-border-subtle pt-3" data-testid="review-missions">
          <h3 className="text-[15px] font-semibold text-text-primary">Missions</h3>
          <ul>{card.missions.map((m) => <li key={m} className="break-words py-1 text-[15px] text-text-secondary">{m}</li>)}</ul>
        </div>
      )}
      {((card.initiatives ?? []).some((x) => x.state === "missing" || x.state === "stop") || card.quarterly || card.experiment) && (
        <div className="mt-4 border-t border-border-subtle pt-3" data-testid="review-initiatives">
          <h3 className="text-[15px] font-semibold text-text-primary">Initiatives</h3>
          <ul>
            {(card.initiatives ?? []).filter((x) => x.state === "missing" || x.state === "stop").map((x) => (
              <li key={x.id} className="py-1">
                <p className="line-clamp-2 text-[15px] font-medium text-text-primary" title={x.explanation}>{x.title}</p>
                <p className={`${META} mt-0.5 line-clamp-2`}>{x.proposal}</p>
              </li>
            ))}
            {card.quarterly && <li className={`${META} py-1`}>The quarterly review is due: keep, switch or drop each initiative.</li>}
            {card.experiment && <li className="py-1 text-[15px] text-text-secondary" data-testid="review-experiment">Experiment: {card.experiment.text}</li>}
          </ul>
        </div>
      )}
      {card.time && (card.time.thisWeek.connected || card.time.warning || card.time.holds.length > 0 || card.time.declines.length > 0) && <TimeBlock t={card.time} vaultPath={vaultPath} onChanged={onChanged} />}
      {card.radar && card.radar.length > 0 && (
        <div className="mt-4 border-t border-border-subtle pt-3" data-testid="review-radar">
          <h3 className="text-[15px] font-semibold text-text-primary">Falling behind</h3>
          <ul>{card.radar.map((x) => (
            <li key={x.key} className="py-1">
              <p className="break-words text-[15px] text-text-secondary">{x.text}</p>
              <p className={`${META} break-words`}>{x.evidence}</p>
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

/**
 * Today T5 on the weekly card: this week's calendar by value against rank,
 * next week against capacity (warned before it starts), protected blocks
 * that wait for a yes, and declines drafted for meetings that serve nothing
 * (yours to send; Prevail never sends).
 */
function TimeBlock({ t, vaultPath, onChanged }: { t: TimeReview; vaultPath: string; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const w = t.thisWeek;
  const answer = async (id: string, action: "approve" | "decline") => {
    setBusy(id);
    try { await invoke("engine_time_hold", { vault: vaultPath, id, action }); invalidateQueries("engine_review"); onChanged(); } finally { setBusy(null); }
  };
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  return (
    <div className="mt-4 border-t border-border-subtle pt-3" data-testid="review-time">
      <h3 className="text-[15px] font-semibold text-text-primary">Time</h3>
      {w.connected && (
        <>
          <p className={`${META} mt-0.5`}>{w.hours} h on the calendar · {w.meetings} h meetings · {w.focus} h focus{w.afterHours ? ` · ${w.afterHours} h after hours` : ""}</p>
          <ul className="mt-1">{w.byValue.filter((v) => v.hours > 0 || v.rank <= 2).slice(0, 4).map((v) => (
            <li key={v.id} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3.5rem] items-center gap-3 py-0.5" title={`Rank ${v.rank}; its rank would give it about ${v.expected}%`}>
              <span className="truncate text-[14px] text-text-secondary">{v.title}</span>
              <span className="h-2.5 overflow-hidden rounded bg-surface-warm"><span className="block h-full rounded bg-accent" style={{ width: `${Math.max(2, v.share)}%` }} /></span>
              <span className="text-right text-[13px] tabular-nums text-text-muted">{v.share}%</span>
            </li>
          ))}</ul>
          {w.lines.map((l) => <p key={l} className={`${BODY} mt-1 text-text-secondary`}>{l}</p>)}
        </>
      )}
      {t.warning && <p className={`${BODY} mt-2 text-warn`} data-testid="review-time-warning">{t.warning}</p>}
      {t.holds.length > 0 && <ul className="mt-2">{t.holds.map((h) => (
        <li key={h.id} className="group flex items-start gap-2 py-1.5" data-testid="review-hold">
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[15px] font-medium text-text-primary">{h.title}</p>
            <p className={`${META} mt-0.5`}>A protected block, {when(h.start)} · waits for your yes{h.note ? ` · ${h.note}` : ""}</p>
          </div>
          <button onClick={() => void answer(h.id, "approve")} disabled={!!busy} data-testid="review-hold-approve" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white disabled:opacity-50">{busy === h.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Hold it</button>
          <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"><RowMenu items={[{ icon: X, label: "Not this week", onClick: () => void answer(h.id, "decline") }]} /></span>
        </li>
      ))}</ul>}
      {t.declines.length > 0 && <ul className="mt-2">{t.declines.map((d) => (
        <li key={d.id} className="group flex items-start gap-2 py-1.5" data-testid="review-decline">
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[15px] font-medium text-text-primary">Decline "{d.title}"?</p>
            <p className={`${META} mt-0.5 line-clamp-2`} title={d.body}>{when(d.start)} · serves nothing your Compass names · a draft, yours to send</p>
          </div>
          <button onClick={() => { void navigator.clipboard?.writeText(d.body).then(() => setCopied(d.id)).catch(() => {}); }} title="Copy the draft" aria-label={`Copy the draft for ${d.title}`} className={iconBtn}>{copied === d.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button>
        </li>
      ))}</ul>}
    </div>
  );
}
