// Today T6: one place to put anything. A slim line on Home (and the phone):
// tell the chief of staff anything to keep, and code files it where it
// belongs (a task, a promise, a decision, a note...) with a receipt and Undo.
// "What am I forgetting?" opens the open loops inline, never in a drawer.
import { useState } from "react";
import { ArrowUp, Brain, Loader2, Undo2, X } from "lucide-react";
import { invoke } from "./bridge";
import { invalidateQueries, useInvokeQuery } from "./query";
import { META, ROW_TITLE } from "./typescale";
import { scopeLabel } from "./plansmodel";

export interface Told { id: string; kind: string; text: string; where: string; due?: string; undone?: number }
interface Forgetting { sections: { title: string; items: { text: string; why: string; domain?: string }[] }[]; count: number }
const iconSm = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";

export function TellBox({ vaultPath, surface = "desktop" }: { vaultPath: string; surface?: "desktop" | "phone" }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ told: Told; reply: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await invoke<{ told?: Told; reply?: string; error?: string }>("engine_tell", { vault: vaultPath, text: t, surface, domain: null, mission: null });
      if (!r?.told) throw new Error(r?.error ?? "not filed");
      setLast({ told: r.told, reply: r.reply ?? "Filed." }); setText("");
      invalidateQueries("engine_today"); invalidateQueries("engine_review");
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  const undo = async () => {
    if (!last) return;
    setBusy(true);
    try { await invoke("engine_tell_undo", { vault: vaultPath, id: last.told.id }); setLast({ ...last, told: { ...last.told, undone: Date.now() } }); invalidateQueries("engine_today"); }
    catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="mb-6" data-testid="tell-box">
      <div className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 focus-within:border-accent-border">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void send(); } }}
          placeholder="Tell me anything to keep" aria-label="Tell me anything to keep" data-testid="tell-input"
          className="h-9 min-w-0 flex-1 bg-transparent text-[15px] text-text-primary outline-none placeholder:text-text-muted" />
        <button onClick={() => setOpen((x) => !x)} title="What am I forgetting?" aria-label="What am I forgetting?" aria-expanded={open} data-testid="tell-forgetting" className={iconSm}><Brain className="h-4 w-4" /></button>
        <button onClick={() => void send()} disabled={busy || !text.trim()} title="File it" aria-label="File it" data-testid="tell-send" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-on-accent disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}</button>
      </div>
      {last && (
        <div className="mt-1.5 flex items-center gap-2 px-1" data-testid="tell-receipt">
          <p className={`${META} min-w-0 flex-1 truncate`} title={last.told.text}>{last.told.undone ? "Undone." : last.reply}</p>
          {!last.told.undone && <button onClick={() => void undo()} disabled={busy} title="Undo" aria-label="Undo" data-testid="tell-undo" className={iconSm}><Undo2 className="h-3.5 w-3.5" /></button>}
        </div>
      )}
      {err && <p className="mt-1 px-1 text-[13px] text-err">{err}</p>}
      {open && <ForgettingList vaultPath={vaultPath} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function ForgettingList({ vaultPath, onClose }: { vaultPath: string; onClose: () => void }) {
  const q = useInvokeQuery<Forgetting>("engine_forgetting", { vault: vaultPath }, { staleMs: 60_000 });
  const f = q.data && typeof q.data === "object" && Array.isArray(q.data.sections) ? q.data : null;
  return (
    <div className="mt-3 rounded-xl border border-border-subtle p-3" data-testid="forgetting">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[15px] font-semibold text-text-primary">{f ? (f.count ? `${f.count} open loop${f.count === 1 ? "" : "s"}` : "Nothing open") : "Looking..."}</p>
        <button onClick={onClose} title="Close" aria-label="Close" className={iconSm}><X className="h-4 w-4" /></button>
      </div>
      {f && !f.count && <p className={`${META} mt-1`}>No promises due, no one you are waiting on, no decision due, nothing slipping.</p>}
      {f?.sections.map((s) => (
        <div key={s.title} className="mt-3">
          <p className="text-[13px] font-medium text-text-muted">{s.title}</p>
          <ul>{s.items.map((x, i) => (
            <li key={`${s.title}-${i}`} className="border-b border-border-subtle py-1.5 last:border-b-0" data-testid="forgetting-item">
              <p title={x.text} className={`${ROW_TITLE} line-clamp-2`}>{x.text}</p>
              <p className={`${META} mt-0.5 truncate`}>{[x.why, x.domain ? scopeLabel(x.domain.replace(/^_mission-/, "mission/")) : ""].filter(Boolean).join(" · ")}</p>
            </li>
          ))}</ul>
        </div>
      ))}
    </div>
  );
}
