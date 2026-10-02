// Compass > Values (metrics plan M4): each value's "matters" (its rank, 1 to
// 5) beside "lived" (1 to 5 from the metrics that serve it over the last four
// weeks, and the weekly calm where it applies), with the metrics behind each.
// A value nothing measures says so plainly.
import { useInvokeQuery } from "./query";
import { META, SECTION_TITLE } from "./typescale";
import { barPct, type ValueLived } from "./qualmodel";

function Bar({ label, value, tone, testId }: { label: string; value: number | null; tone: "lived" | "matters"; testId: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-16 shrink-0 text-[13px] text-text-muted">{label}</span>
      <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-warm" aria-hidden>
        <span className={`block h-full rounded-full ${tone === "lived" ? "bg-accent" : "bg-text-muted/50"}`} style={{ width: `${barPct(value)}%` }} />
      </span>
      <span className="w-20 shrink-0 text-right text-[13px] tabular-nums text-text-secondary" data-testid={testId}>{value === null ? "unmeasured" : `${value} of 5`}</span>
    </div>
  );
}

export function MattersLived({ vaultPath }: { vaultPath: string }) {
  const q = useInvokeQuery<ValueLived[]>("engine_metrics", { vault: vaultPath, view: "lived", week: null }, { staleMs: 10 * 60_000 });
  const rows = Array.isArray(q.data) ? q.data : [];
  return (
    <section data-testid="matters-lived" className="mt-8 max-w-3xl">
      <h3 className={SECTION_TITLE}>Matters and lived</h3>
      <p className={`${META} mt-1`}>How much each value matters (its rank) beside how it was lived the last four weeks, from the metrics that serve it.</p>
      {!rows.length && !!q.data && <p className="mt-3 text-[15px] text-text-muted">Confirm your Compass values to see matters against lived.</p>}
      <ul className="mt-3 space-y-4">{rows.map((v) => (
        <li key={v.id} data-testid={`lived-${v.id}`}>
          <p className="break-words text-[15px] font-semibold text-text-primary">{v.title}</p>
          <div className="mt-1.5 space-y-1">
            <Bar label="Matters" value={v.matters} tone="matters" testId="lived-matters" />
            <Bar label="Lived" value={v.lived} tone="lived" testId="lived-lived" />
          </div>
          {v.metrics.length > 0
            ? <p className={`${META} mt-1 break-words`}>{v.metrics.map((m) => `${m.title}: ${m.basis}${m.paused ? ` (paused for ${m.paused})` : ""}`).join("; ")}{v.checkin !== undefined ? `; weekly calm ${v.checkin}` : ""}</p>
            : <p className={`${META} mt-1`}>Nothing measures this value yet.</p>}
        </li>
      ))}</ul>
    </section>
  );
}
