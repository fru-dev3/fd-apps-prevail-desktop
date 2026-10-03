// Goals G5, desktop side: the Compass over a lifetime and beyond one person.
//   ValueRoleHistory  each value and role over the years: when it came, each
//                     rank change, when it was dropped (from versions + ledger)
//   YearlyReview      the yearly review page: values, roles, purpose and three
//                     odyssey lives; "Sketch from my notes" asks the engine,
//                     which keeps a sketch only when its quote is in the notes
//   exportCompass     the confirmed Compass as a constitution file
// The engine owns every rule; this file shows and asks.
import { useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { invoke } from "./bridge";
import { useInvokeQuery } from "./query";
import { BODY, DETAIL_TITLE, META, ROW_TITLE, SECTION_TITLE } from "./typescale";
import { RowMenu } from "./ui";

interface HistoryEvent { date: string; what: string; from?: string; to?: string; reason?: string }
interface HistoryLine { id: string; kind: "value" | "role"; title: string; now: boolean; rank?: number; first: string | null; events: HistoryEvent[] }

const fmt = (d: string) => { const x = new Date(`${d}T12:00:00Z`); return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString(undefined, { month: "short", year: "numeric" }); };
const said = (e: HistoryEvent) => e.what === "rank" ? `rank ${e.from || "?"} to ${e.to}` : e.what === "status" ? `${e.to}${e.reason ? `: ${e.reason}` : ""}` : e.what === "renamed" ? `renamed from ${e.from}` : e.what;

export function ValueRoleHistory({ vaultPath }: { vaultPath: string }) {
  const q = useInvokeQuery<HistoryLine[]>("engine_compass_history", { vault: vaultPath }, { staleMs: 60_000 });
  const rows = Array.isArray(q.data) ? q.data : [];
  if (!rows.length) return null;
  const group = (k: "value" | "role", title: string) => {
    const xs = rows.filter((r) => r.kind === k);
    if (!xs.length) return null;
    return (
      <>
        <h3 className={`${SECTION_TITLE} mt-5 mb-1`}>{title}</h3>
        <ul data-testid={`history-${k}s`}>{xs.map((r) => (
          <li key={r.id} className="border-b border-border-subtle py-2 last:border-b-0">
            <p className={`${ROW_TITLE} ${r.now ? "" : "text-text-muted line-through decoration-text-muted/60"}`}>{r.title}{r.now && r.rank ? <span className={`${META} ml-2 no-underline`}>rank {r.rank}</span> : null}</p>
            <p className={`${META} mt-0.5 line-clamp-2`} title={r.events.map((e) => `${e.date} ${said(e)}`).join("\n")}>
              {r.events.length ? r.events.slice(-4).map((e) => `${fmt(e.date)} ${said(e)}`).join(" · ") : r.first ? `Since ${fmt(r.first)}` : "Unchanged"}
            </p>
          </li>
        ))}</ul>
      </>
    );
  };
  return <div data-testid="compass-value-history">{group("value", "Values over the years")}{group("role", "Roles over the years")}</div>;
}

interface Sketch { key: string; sketch: string; quote: string; from: string }
interface Yearly { year: number; file: string; purpose: string | null; sketches: Sketch[]; text: string }

export function YearlyReview({ vaultPath }: { vaultPath: string }) {
  const [r, setR] = useState<Yearly | null>(null);
  const [busy, setBusy] = useState<"load" | "draft" | "save" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const q = useInvokeQuery<Yearly>("engine_compass_yearly", { vault: vaultPath }, { staleMs: 60_000 });
  const fresh = useInvokeQuery<{ starts?: { kind: string; text: string }[] }>("engine_compass_fresh", { vault: vaultPath }, { staleMs: 300_000 });
  const cur = r ?? q.data ?? null;
  const run = async (kind: "draft" | "save") => {
    setBusy(kind); setMsg(null);
    try {
      const x = await invoke<Yearly>("engine_compass_yearly", { vault: vaultPath, draft: kind === "draft", write: kind === "save" });
      setR(x);
      setMsg(kind === "save" ? "Saved in your General reviews. Answer under each question there, or tell your chief of staff." : x.sketches.length ? `Sketched ${x.sketches.length} of 3 from your notes; each quotes you.` : "Nothing in your notes to sketch from yet.");
    } catch (e) { setMsg(`Not done: ${String(e)}`); } finally { setBusy(null); }
  };
  const odyssey = cur?.text.split("## Three odyssey lives")[1]?.split("## One small prototype")[0] ?? "";
  const lives = odyssey.split("\n### ").slice(1).map((b) => { const [title, ...rest] = b.split("\n"); return { title: title!.trim(), ask: rest[0] ?? "" }; });
  return (
    <section data-testid="compass-detail-yearly" className="max-w-3xl">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className={DETAIL_TITLE}>Yearly review{cur ? `, ${cur.year}` : ""}</h2>
          <p className={`${META} mt-1`}>Thirty minutes: your values, roles and purpose, and three possible lives. Nothing here changes the Compass.</p>
        </div>
        <button onClick={() => void run("draft")} disabled={!!busy} title="Sketch the three lives from my notes" aria-label="Sketch the three lives from my notes" data-testid="yearly-draft" className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-accent disabled:opacity-50">{busy === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}</button>
        <RowMenu items={[{ icon: Check, label: "Save the page", hint: "General reviews; your answers are kept", onClick: () => void run("save") }]} />
      </div>
      {(fresh.data?.starts ?? []).length > 0 && <p className={`${BODY} mt-3 text-accent`} data-testid="yearly-fresh">{fresh.data!.starts![0]!.text}</p>}
      {msg && <p className={`${META} mt-3`} data-testid="yearly-msg">{msg}</p>}
      {cur?.purpose && <p className="mt-4 font-display text-[18px] leading-snug text-text-primary">{cur.purpose}</p>}
      <h3 className={`${SECTION_TITLE} mt-6`}>Three odyssey lives</h3>
      <ol className="mt-1">
        {lives.map((l, i) => {
          const s = cur?.sketches.find((x) => ["current", "vanished", "free"][i] === x.key);
          return (
            <li key={l.title} data-testid="yearly-life" className="border-b border-border-subtle py-2.5 last:border-b-0">
              <p className={ROW_TITLE}>{((t) => t.charAt(0).toUpperCase() + t.slice(1))(l.title.replace(/^Life \w+: /, ""))}</p>
              <p className={`${BODY} mt-0.5 text-text-secondary`}>{l.ask}</p>
              {s && <p className={`${BODY} mt-1 text-text-primary`} title={`"${s.quote}" (${s.from})`} data-testid="yearly-sketch">{s.sketch}<span className={`${META} ml-1.5`}>from your notes</span></p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Save the confirmed Compass as a constitution file; returns a line to show. */
export async function exportCompass(vaultPath: string): Promise<string> {
  const r = await invoke<{ file?: string; text?: string }>("engine_compass_export", { vault: vaultPath });
  try { if (r?.text) await navigator.clipboard.writeText(r.text); } catch { /* clipboard off */ }
  return r?.file ? `Saved as ${r.file.split("/").pop()} in your vault's exports, and copied. Paste it into any AI.` : "Not saved.";
}
