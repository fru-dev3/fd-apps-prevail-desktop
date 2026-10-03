// Goals G5, desktop side: the Compass over a lifetime and beyond one person.
//   ValueRoleHistory  each value and role over the years: when it came, each
//                     rank change, when it was dropped (from versions + ledger)
//   YearlyReview      the yearly review page: values, roles, purpose and three
//                     odyssey lives; "Sketch from my notes" asks the engine,
//                     which keeps a sketch only when its quote is in the notes
//   Household         members with consent per person (only the member can say
//                     yes, by typing their own name), shared goals and the
//                     conflicts between people, each with its evidence
//   exportCompass     the confirmed Compass as a constitution file
// The engine owns every rule; this file shows and asks.
import { useState } from "react";
import { AlertTriangle, Check, Loader2, Plus, Sparkles, Trash2, UserPlus } from "lucide-react";
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

interface HMember { id: string; name: string; relation: string; added: string; consent: Record<"compass" | "metrics", boolean>; hasCompass: boolean }
interface HShared { id: string; title: string; members: string[]; names: string[]; hours?: number; done: boolean }
interface HConflict { kind: string; who: string; goal: string; question: string; evidence: string[] }
interface HView { members: HMember[]; shared: HShared[]; conflicts: HConflict[]; projects?: { slug: string; name: string; members: string[] }[] }

const field = "h-9 min-w-0 rounded-md border border-border bg-background px-2.5 text-[14px] text-text-primary focus:border-accent-border focus:outline-none";

export function Household({ vaultPath }: { vaultPath: string }) {
  const q = useInvokeQuery<HView>("engine_household", { vault: vaultPath }, { staleMs: 10_000 });
  const v: HView = q.data ?? { members: [], shared: [], conflicts: [] };
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [with_, setWith] = useState<string[]>([]);
  const [asking, setAsking] = useState<{ id: string; scope: "compass" | "metrics" } | null>(null);
  const [typed, setTyped] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const call = async (cmd: string, args: Record<string, unknown>, ok?: string) => {
    setMsg(null);
    try {
      const r = await invoke<{ ok?: boolean; error?: string }>(cmd, { vault: vaultPath, ...args });
      if (r && r.ok === false) throw new Error(r.error);
      if (ok) setMsg(ok);
      await q.refresh();
      return true;
    } catch (e) { setMsg(String(e).replace(/^Error:\s*/, "")); return false; }
  };
  const SCOPE = { compass: "Their Compass", metrics: "Their numbers" } as const;
  return (
    <section data-testid="compass-detail-household" className="max-w-3xl">
      <h2 className={DETAIL_TITLE}>Household</h2>
      <p className={`${META} mt-1`}>Each person keeps their own Compass. Nothing of theirs is read until they say yes themselves, and they can take it back any time.</p>
      {msg && <p className={`${META} mt-3`} data-testid="household-msg">{msg}</p>}
      <ul className="mt-3">
        {v.members.map((m) => (
          <li key={m.id} data-testid="household-member" className="group border-b border-border-subtle py-2.5 last:border-b-0">
            <div className="flex items-start gap-3">
              <span aria-hidden className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[12px] font-semibold text-accent">{m.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <p className={ROW_TITLE}>{m.name}</p>
                <p className={`${META} mt-0.5`}>{m.relation} · {(["compass", "metrics"] as const).map((s) => `${SCOPE[s]}: ${m.consent[s] ? "yes" : "not shared"}`).join(" · ")}</p>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                  {(["compass", "metrics"] as const).map((s) => m.consent[s]
                    ? <button key={s} onClick={() => void call("engine_household_consent", { id: m.id, scope: s, on: false, confirm: null }, `${SCOPE[s]} is no longer read.`)} data-testid={`consent-off-${s}`} className="text-[13px] text-text-muted hover:text-text-primary">Stop sharing {s === "compass" ? "their Compass" : "their numbers"}</button>
                    : <button key={s} onClick={() => { setAsking({ id: m.id, scope: s }); setTyped(""); }} data-testid={`consent-ask-${s}`} className="text-[13px] font-medium text-accent hover:underline">Ask {m.name.split(" ")[0]} to share {s === "compass" ? "their Compass" : "their numbers"}</button>)}
                </div>
                {asking?.id === m.id && (
                  <form className="mt-2 flex flex-wrap items-center gap-2" data-testid="consent-form" onSubmit={(e) => { e.preventDefault(); void call("engine_household_consent", { id: m.id, scope: asking.scope, on: true, confirm: typed }, `${m.name} said yes.`).then((ok) => ok && setAsking(null)); }}>
                    <span className={`${BODY} basis-full text-text-secondary`}>Hand the device to {m.name}. {m.name.split(" ")[0]}, type your name to agree:</span>
                    <input aria-label={`${m.name} types their name`} value={typed} onChange={(e) => setTyped(e.target.value)} className={`${field} w-56`} autoFocus />
                    <button type="submit" disabled={!typed.trim()} data-testid="consent-agree" className="h-9 rounded-md bg-accent px-3 text-[13px] font-semibold text-on-accent disabled:opacity-50">I agree</button>
                    <button type="button" onClick={() => setAsking(null)} className="h-9 px-2 text-[13px] text-text-muted hover:text-text-primary">Not now</button>
                  </form>
                )}
              </div>
              <span className="opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
                <RowMenu items={[{ icon: Trash2, label: `Remove ${m.name}`, hint: "Their folder is kept in an archive", onClick: () => void call("engine_household_remove", { id: m.id }, `${m.name} is out of the household; their folder is archived.`) }]} />
              </span>
            </div>
          </li>
        ))}
      </ul>
      <form className="mt-3 flex flex-wrap items-center gap-2" data-testid="household-add" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void call("engine_household_add", { name: name.trim(), relation: null }, `Added ${name.trim()}. Nothing of theirs is read until they say yes.`).then((ok) => ok && setName("")); }}>
        <UserPlus className="h-4 w-4 shrink-0 text-text-muted" />
        <input aria-label="Someone in your household" value={name} onChange={(e) => setName(e.target.value)} placeholder="Add someone: their name" className={`${field} min-w-0 flex-1`} />
      </form>

      <h3 className={`${SECTION_TITLE} mt-7`}>Shared goals</h3>
      {v.shared.length ? (
        <ul className="mt-1">{v.shared.map((g) => (
          <li key={g.id} data-testid="shared-goal" className="border-b border-border-subtle py-2 last:border-b-0">
            <p className={`${ROW_TITLE} ${g.done ? "text-text-muted line-through" : ""}`}>{g.title}</p>
            <p className={`${META} mt-0.5`}>{g.names.join(", ")}{g.hours ? ` · ${g.hours} hours a week` : ""}</p>
          </li>
        ))}</ul>
      ) : <p className={`${META} mt-1`}>None yet.</p>}
      {v.members.length > 0 && (
        <form className="mt-2 flex flex-wrap items-center gap-2" data-testid="shared-add" onSubmit={(e) => { e.preventDefault(); if (goal.trim() && with_.length) void call("engine_household_shared_add", { title: goal.trim(), members: with_, hours: null }, "Shared goal added.").then((ok) => { if (ok) { setGoal(""); setWith([]); } }); }}>
          <Plus className="h-4 w-4 shrink-0 text-text-muted" />
          <input aria-label="A shared goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Say a goal you share" className={`${field} min-w-0 flex-1 basis-56`} />
          <span className="flex flex-wrap gap-1.5">{v.members.map((m) => (
            <button key={m.id} type="button" aria-pressed={with_.includes(m.id)} onClick={() => setWith((w) => (w.includes(m.id) ? w.filter((x) => x !== m.id) : [...w, m.id]))}
              className={`h-7 rounded-full border px-2.5 text-[12px] ${with_.includes(m.id) ? "border-accent-border bg-accent-soft font-medium text-accent" : "border-border text-text-secondary"}`}>{m.name.split(" ")[0]}</button>
          ))}</span>
          <button type="submit" disabled={!goal.trim() || !with_.length} className="h-9 rounded-md px-3 text-[13px] font-medium text-accent hover:bg-accent-soft disabled:opacity-40">Add</button>
        </form>
      )}

      {(v.projects ?? []).length > 0 && (
        <>
          <h3 className={`${SECTION_TITLE} mt-7`}>Shared projects</h3>
          <ul className="mt-1">{v.projects!.map((p) => (
            <li key={p.slug} data-testid="shared-project" className="border-b border-border-subtle py-2 last:border-b-0">
              <p className={ROW_TITLE}>{p.name}</p>
              <p className={`${META} mt-0.5`}>With {p.members.map((id) => v.members.find((m) => m.id === id)?.name ?? id).join(", ")}</p>
            </li>
          ))}</ul>
        </>
      )}
      {v.conflicts.length > 0 && (
        <>
          <h3 className={`${SECTION_TITLE} mt-7`}>Between people</h3>
          <ul className="mt-1">{v.conflicts.map((c, i) => (
            <li key={i} data-testid="people-conflict" className="flex items-start gap-2.5 border-b border-border-subtle py-2 last:border-b-0">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
              <div className="min-w-0">
                <p className={`${BODY} text-text-primary`}>{c.question}</p>
                <p className={`${META} mt-0.5 line-clamp-2`} title={c.evidence.join("\n")}>{c.evidence.join(" · ")}</p>
              </div>
            </li>
          ))}</ul>
        </>
      )}
    </section>
  );
}

/** Save the confirmed Compass as a constitution file; returns a line to show. */
export async function exportCompass(vaultPath: string): Promise<string> {
  const r = await invoke<{ file?: string; text?: string }>("engine_compass_export", { vault: vaultPath });
  try { if (r?.text) await navigator.clipboard.writeText(r.text); } catch { /* clipboard off */ }
  return r?.file ? `Saved as ${r.file.split("/").pop()} in your vault's exports, and copied. Paste it into any AI.` : "Not saved.";
}
