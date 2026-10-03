// Apps A5, desktop side.
//   StackDiffView  said vs used: what tool-stack.md says against what you use
//                  (in use and not listed, listed and unused, a status the
//                  doctor contradicts). Nothing changes until Accept; the prior
//                  file is kept.
//   ImportsView    ChatGPT, claude.ai and Gemini: how to request the official
//                  export, the inbox it goes in, Import now, what came in, and
//                  the quarterly reminder (off unless you turn it on).
import { useState } from "react";
import { Check, Download, ExternalLink, FileDiff, Loader2, RefreshCw } from "lucide-react";
import { invoke } from "./bridge";
import { invalidateQueries, useInvokeQuery } from "./query";
import { BODY, DETAIL_TITLE, META, ROW_TITLE, SECTION_TITLE } from "./typescale";

interface DiffItem { kind: "missing" | "unused" | "status"; tool: string; detail: string; proposed: string }
interface StackDiff { month: string; items: DiffItem[]; accepted?: number }
const monthName = (m: string) => { const d = new Date(`${m}-15T12:00:00Z`); return Number.isNaN(d.getTime()) ? m : d.toLocaleDateString(undefined, { month: "long", year: "numeric" }); };
const KIND: Record<DiffItem["kind"], string> = { missing: "In use, not listed", unused: "Listed, not used in 30 days", status: "Status changes" };

export function StackDiffView({ vaultPath }: { vaultPath: string }) {
  const q = useInvokeQuery<StackDiff | null>("engine_apps_stack_diff", { vault: vaultPath }, { staleMs: 60_000 });
  const d = q.data ?? null;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const accept = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await invoke<{ ok?: boolean; error?: string; applied?: number }>("engine_apps_stack_diff_accept", { vault: vaultPath });
      if (r?.ok === false) throw new Error(r.error);
      setMsg(`Applied ${r?.applied ?? 0} to your stated stack; the earlier file is kept, and a task asks for the HTML views to be made again.`);
      invalidateQueries("engine_review");
      await q.refresh();
    } catch (e) { setMsg(`Not applied: ${String(e).replace(/^Error:\s*/, "")}`); } finally { setBusy(false); }
  };
  const waiting = !!d && !d.accepted && d.items.length > 0;
  return (
    <section data-testid="stack-diff" className="max-w-4xl">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className={DETAIL_TITLE}>Said vs used</h2>
          <p className={`${META} mt-1`}>Your tool stack note against what you actually use, {d?.month ? monthName(d.month) : "this month"}. Nothing changes until you accept.</p>
        </div>
        {waiting && <button onClick={() => void accept()} disabled={busy} data-testid="stack-diff-accept" className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Accept all</button>}
      </div>
      {msg && <p className={`${META} mt-3`} data-testid="stack-diff-msg">{msg}</p>}
      {!d && <p className={`${META} mt-4`}>No stated stack yet (General, source, tool-stack.md).</p>}
      {d && !d.items.length && <p className={`${META} mt-4`}>What you say and what you use agree.</p>}
      {d?.accepted && d.items.length > 0 && <p className={`${META} mt-4`}>Accepted on {new Date(d.accepted).toLocaleDateString()}.</p>}
      {(["missing", "unused", "status"] as const).map((k) => {
        const xs = d?.items.filter((i) => i.kind === k) ?? [];
        if (!xs.length) return null;
        return (
          <div key={k}>
            <h3 className={`${SECTION_TITLE} mt-6`}>{KIND[k]}</h3>
            <ul className="mt-1">{xs.map((i) => (
              <li key={`${k}:${i.tool}`} data-testid="stack-diff-item" className="flex items-start gap-2.5 border-b border-border-subtle py-2 last:border-b-0">
                <FileDiff className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                <div className="min-w-0"><p className={ROW_TITLE}>{i.tool}</p><p className={`${META} mt-0.5`}>{i.detail}</p></div>
              </li>
            ))}</ul>
          </div>
        );
      })}
    </section>
  );
}

interface ImportApp { id: string; name: string; how: string; url: string; inbox: string; waiting: number }
interface ImportStatus { reminder: boolean; apps: ImportApp[]; last: { ts: number; app: string; file: string; prompts: number; written: number; titles: number; error?: string }[]; line: string | null }

export function ImportsView({ vaultPath }: { vaultPath: string }) {
  const q = useInvokeQuery<ImportStatus>("engine_apps_imports", { vault: vaultPath }, { staleMs: 30_000 });
  const s = q.data;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await invoke<{ app: string; written: number; prompts: number; error?: string }[]>("engine_apps_imports_run", { vault: vaultPath });
      setMsg(r.length ? r.map((x) => `${x.app}: ${x.error ?? `${x.written} new of ${x.prompts} prompts`}`).join(" · ") : "Nothing waiting in the inboxes.");
      await q.refresh();
    } catch (e) { setMsg(`Not imported: ${String(e)}`); } finally { setBusy(false); }
  };
  const remind = async (on: boolean) => { try { await invoke("engine_apps_imports_reminder", { vault: vaultPath, on }); await q.refresh(); } catch (e) { setMsg(String(e)); } };
  const waiting = (s?.apps ?? []).reduce((a, x) => a + x.waiting, 0);
  return (
    <section data-testid="apps-imports" className="max-w-4xl">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className={DETAIL_TITLE}>Imports</h2>
          <p className={`${META} mt-1`}>Chats in these apps live on their servers. Request the official export, drop the file in the app's inbox, and only what you typed comes in, as quoted history. Nothing in it ever runs.</p>
        </div>
        <button onClick={() => void run()} disabled={busy} title="Import what is waiting" aria-label="Import what is waiting" data-testid="imports-run" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-accent disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</button>
      </div>
      {msg && <p className={`${META} mt-3`} data-testid="imports-msg">{msg}</p>}
      <ul className="mt-3">{(s?.apps ?? []).map((a) => (
        <li key={a.id} data-testid="import-app" className="flex items-start gap-2.5 border-b border-border-subtle py-2.5 last:border-b-0">
          <Download className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
          <div className="min-w-0 flex-1">
            <p className={ROW_TITLE}>{a.name}{a.waiting ? <span className={`${META} ml-2`}>{a.waiting} waiting</span> : null}</p>
            <p className={`${META} mt-0.5`} title={`Drop the file in ${a.inbox}`}>{a.how} · drop it in the {a.name} inbox</p>
          </div>
          <a href={a.url} target="_blank" rel="noreferrer" title={`Open ${a.name}'s export page`} aria-label={`Open ${a.name}'s export page`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-accent"><ExternalLink className="h-4 w-4" /></a>
        </li>
      ))}</ul>
      <div className="mt-5 flex items-center gap-3" data-testid="imports-reminder">
        <button role="switch" aria-checked={!!s?.reminder} onClick={() => void remind(!s?.reminder)} data-testid="imports-reminder-toggle"
          className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${s?.reminder ? "bg-accent" : "bg-surface-strong"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${s?.reminder ? "left-[18px]" : "left-0.5"}`} />
        </button>
        <p className={`${BODY} text-text-secondary`}>Remind me once a quarter, in the weekly review</p>
      </div>
      {(s?.last ?? []).length > 0 && (
        <>
          <h3 className={`${SECTION_TITLE} mt-6`}>Imported</h3>
          <ul className="mt-1">{s!.last.slice().reverse().map((x, i) => (
            <li key={i} className={`${META} py-1`}>{new Date(x.ts).toLocaleDateString()} · {x.app} · {x.error ?? `${x.written} new prompts, ${x.titles} titles`}</li>
          ))}</ul>
        </>
      )}
      {!waiting && !(s?.last ?? []).length && <p className={`${META} mt-4`}>Nothing imported yet.</p>}
    </section>
  );
}
