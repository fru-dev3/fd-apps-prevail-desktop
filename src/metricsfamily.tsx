// Metrics M6, desktop side.
//   HouseholdMetrics  numbers a household shares, per person, last four
//                     weeks; a member who does not share shows "not shared"
//                     (never zero); log a number for yourself or for someone
//                     who shares theirs; add one by saying its name
//   PhoneGlance       the week at a glance, sized like a widget: the pinned
//                     numbers against your normal, the 1-5, and the next thing
//                     that matters. On the phone it heads the Work tab, and
//                     /?view=glance opens it alone (Add to Home Screen, or the
//                     manifest's "This week" shortcut).
// The engine enforces every consent rule; this file shows and asks.
import { useState } from "react";
import { Plus } from "lucide-react";
import { invoke } from "./bridge";
import { useInvokeQuery } from "./query";
import { BODY, DETAIL_TITLE, META, ROW_TITLE, SECTION_TITLE } from "./typescale";
import type { ReviewCard } from "./plansmodel";

interface FRow { person: string; name: string; shared: boolean; weeks: { week: string; value: number }[] }
interface FMetric { id: string; title: string; unit: string; people: FRow[] }
const field = "h-9 min-w-0 rounded-md border border-border bg-background px-2.5 text-[14px] text-text-primary focus:border-accent-border focus:outline-none";

export function HouseholdMetrics({ vaultPath }: { vaultPath: string }) {
  const q = useInvokeQuery<FMetric[]>("engine_metrics_family", { vault: vaultPath }, { staleMs: 30_000 });
  const ms = Array.isArray(q.data) ? q.data : [];
  const [title, setTitle] = useState("");
  const [log, setLog] = useState<{ id: string; person: string; value: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (cmd: string, args: Record<string, unknown>, ok: string) => {
    setMsg(null);
    try { const r = await invoke<{ ok?: boolean; error?: string }>(cmd, { vault: vaultPath, ...args }); if (r?.ok === false) throw new Error(r.error); setMsg(ok); await q.refresh(); return true; }
    catch (e) { setMsg(String(e).replace(/^Error:\s*/, "")); return false; }
  };
  const max = Math.max(1, ...ms.flatMap((m) => m.people.flatMap((p) => p.weeks.map((w) => w.value))));
  return (
    <section data-testid="metrics-household" className="max-w-4xl">
      <h2 className={DETAIL_TITLE}>Household</h2>
      <p className={`${META} mt-1`}>Numbers your household keeps together. Someone's numbers count only while they share them (Compass, Household); their numbers never mix into yours.</p>
      {msg && <p className={`${META} mt-3`} data-testid="household-metrics-msg">{msg}</p>}
      {!ms.length && <p className={`${META} mt-4`}>None yet. Name one below, for example "Dinners together".</p>}
      <ul className="mt-2">{ms.map((m) => (
        <li key={m.id} data-testid="family-metric" className="border-b border-border-subtle py-3 last:border-b-0">
          <p className={ROW_TITLE}>{m.title}</p>
          <ul className="mt-1.5 space-y-1">{m.people.map((p) => (
            <li key={p.person} className="group flex items-center gap-3" data-testid="family-person">
              <span className="w-24 shrink-0 truncate text-[13px] text-text-secondary">{p.name}</span>
              {p.shared ? (
                <span className="flex h-6 flex-1 items-end gap-0.5" title={p.weeks.map((w) => `${w.week}: ${w.value}`).join("\n")}>
                  {p.weeks.map((w) => <span key={w.week} className="w-2.5 rounded-[2px] bg-accent/70" style={{ height: `${Math.max(8, (w.value / max) * 100)}%`, opacity: w.value ? 1 : 0.25 }} />)}
                  <span className="ml-2 text-[13px] tabular-nums text-text-primary">{p.weeks.at(-1)?.value ?? 0}</span>
                </span>
              ) : <span className={`${META} flex-1`}>not shared</span>}
              {p.shared && (log?.id === m.id && log.person === p.person ? (
                <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void run("engine_metrics_say", { id: m.id, value: Number(log.value), member: p.person === "me" ? null : p.person }, `Logged ${log.value} for ${p.name}.`).then((ok) => ok && setLog(null)); }}>
                  <input autoFocus inputMode="decimal" aria-label={`This week for ${p.name}`} value={log.value} onChange={(e) => setLog({ ...log, value: e.target.value.replace(/[^0-9.]/g, "") })} className={`${field} w-20`} />
                  <button type="submit" disabled={!log.value} className="h-9 px-2 text-[13px] font-medium text-accent disabled:opacity-40">Log</button>
                </form>
              ) : (
                <button onClick={() => setLog({ id: m.id, person: p.person, value: "" })} data-testid="family-log" className="text-[13px] text-text-muted opacity-100 hover:text-accent [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">Log</button>
              ))}
            </li>
          ))}</ul>
        </li>
      ))}</ul>
      <form className="mt-3 flex items-center gap-2" data-testid="family-add" onSubmit={(e) => { e.preventDefault(); if (title.trim()) void run("engine_metrics_family_add", { title: title.trim() }, `Added ${title.trim()}.`).then((ok) => ok && setTitle("")); }}>
        <Plus className="h-4 w-4 shrink-0 text-text-muted" />
        <input aria-label="A number your household keeps" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name a number you keep together" className={`${field} flex-1`} />
      </form>
    </section>
  );
}

// ── The phone glance ────────────────────────────────────────────────────────

const fmt = (v: number, unit: string) => unit === "usd" ? `$${v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(0)}` : unit === "hours" ? `${Math.round(v * 10) / 10}h` : unit === "minutes" ? `${Math.round(v)}m` : `${Math.round(v * 10) / 10}`;

export function PhoneGlance({ vaultPath, standalone = false }: { vaultPath: string; standalone?: boolean }) {
  const q = useInvokeQuery<ReviewCard>("engine_review", { vault: vaultPath }, { staleMs: 5 * 60_000 });
  const t = useInvokeQuery<{ items?: { key: string; title: string; why?: string }[] }>("engine_today", { vault: vaultPath }, { staleMs: 5 * 60_000 });
  const [calm, setCalm] = useState<number | null>(null);
  const card = q.data;
  const rows = (card?.glance ?? []).slice(0, 4);
  const next = t.data?.items?.[0];
  const answered = calm ?? card?.checkin?.calm ?? null;
  const tap = async (n: number) => { setCalm(n); try { await invoke("engine_review_checkin", { vault: vaultPath, calm: n, note: null }); } catch { setCalm(null); } };
  return (
    <section data-testid="phone-glance" className={`${standalone ? "min-h-screen px-4 pb-8 pt-[max(16px,env(safe-area-inset-top))]" : "mx-4 mt-3"} rounded-2xl border border-border bg-surface p-4`}>
      <p className={`${SECTION_TITLE}`}>This week</p>
      {!card && <p className={`${META} mt-1`}>Counting...</p>}
      {rows.length > 0 && (
        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2.5">{rows.map((r) => {
          const out = !r.documentary && !r.normal.learning && (r.value < r.normal.lo || r.value > r.normal.hi);
          return (
            <li key={r.id} data-testid="glance-tile" className="min-w-0">
              <p className={`text-[22px] font-semibold tabular-nums leading-tight ${out ? "text-accent" : "text-text-primary"}`}>{r.documentary ? (r.record ?? "a record") : fmt(r.value, r.unit)}</p>
              <p className={`${META} truncate`} title={r.normal.learning ? "still learning your normal" : `normal ${fmt(r.normal.lo, r.unit)} to ${fmt(r.normal.hi, r.unit)}`}>{r.title}</p>
            </li>
          );
        })}</ul>
      )}
      {card && (
        <div className="mt-3 border-t border-border-subtle pt-3">
          <p className={`${BODY} text-text-secondary`}>How calm was this week?</p>
          <div className="mt-1.5 flex gap-1.5" role="group" aria-label="How calm was this week, 1 to 5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => void tap(n)} aria-pressed={answered === n} data-testid={`glance-calm-${n}`}
                className={`h-10 flex-1 rounded-lg text-[15px] font-semibold ${answered === n ? "bg-accent text-on-accent" : "bg-surface-warm text-text-secondary"}`}>{n}</button>
            ))}
          </div>
        </div>
      )}
      {next && <p className={`${META} mt-3 line-clamp-2`} data-testid="glance-next"><span className="text-text-secondary">Next: </span>{next.title}</p>}
    </section>
  );
}

/** The standalone glance URL: /?view=glance. */
export const isGlanceView = () => { try { return new URLSearchParams(window.location.search).get("view") === "glance"; } catch { return false; } };
