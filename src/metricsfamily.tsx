// Metrics M6, desktop side.
//   PhoneGlance       the week at a glance, sized like a widget: the pinned
//                     numbers against your normal, the 1-5, and the next thing
//                     that matters. On the phone it heads the Work tab, and
//                     /?view=glance opens it alone (Add to Home Screen, or the
//                     manifest's "This week" shortcut).
import { useState } from "react";
import { invoke } from "./bridge";
import { useInvokeQuery } from "./query";
import { BODY, META, SECTION_TITLE } from "./typescale";
import type { ReviewCard } from "./plansmodel";

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
