// Specialists Phase 4, desktop side.
//
// New specialist: talk, don't fill fields (Fru, 2026-10-02). It opens as a
// conversation with the chief of staff; the engine drafts the fields behind
// the scenes (`specialists draft`, every field checked in code) and one quiet
// line shows what is settled. Nothing is made until the user says go. An
// address the user pastes makes an outside agent: it gets only the brief and
// asks before every call. A toggle shows the same draft as fields.
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Globe, ListChecks, Loader2, MessageSquare, Plus } from "lucide-react";
import { invoke } from "./bridge";
import { invalidateQueries } from "./query";
import { BODY, DETAIL_TITLE, META } from "./typescale";
import { ChiefAvatar, SpecialistAvatar } from "./specialistavatar";
import { useChiefOfStaff } from "./chiefofstaff";
import { CEILING_SAYS, FAMILY_LABEL, label } from "./plansmodel";

export interface SpecDraft {
  name?: string; family?: string; base?: string; returns?: string; ceiling?: string;
  mandate?: string; method?: string; never?: string; doneWhen?: string[]; tools?: string[];
  endpoint?: string; tool?: string; perDay?: number;
}
interface Turn { role: "user" | "assistant"; text: string }
interface DraftReply { draft: SpecDraft; filled: string[]; dropped: { field: string; value: string; why: string }[]; question: string | null; reply: string; ready: boolean; missing: string[]; go: boolean }

const STARTERS = ["A specialist that ", "Someone who checks ", "Add the outside agent at https://"];
const inputCls = "w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-text-primary focus:border-accent-border focus:outline-none";
const startBtn = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50";

const host = (u?: string) => { try { return u ? new URL(u).host : ""; } catch { return ""; } };

/** The settled fields as one quiet line. */
export function specBits(d: SpecDraft): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  if (d.name) out.push({ key: "name", text: d.name });
  if (d.endpoint) out.push({ key: "endpoint", text: `outside, at ${host(d.endpoint)}` });
  if (d.base) out.push({ key: "base", text: `built on the ${label(d.base)}` });
  if (d.family) out.push({ key: "family", text: FAMILY_LABEL[d.family as keyof typeof FAMILY_LABEL] ?? d.family });
  if (d.ceiling) out.push({ key: "ceiling", text: CEILING_SAYS[d.ceiling] ?? d.ceiling });
  if (d.doneWhen?.length) out.push({ key: "doneWhen", text: `${d.doneWhen.length} done-when line${d.doneWhen.length === 1 ? "" : "s"}` });
  return out;
}

export function NewSpecialist({ vaultPath, onCancel, onMade }: { vaultPath: string; onCancel: () => void; onMade: (id: string) => void }) {
  const chief = useChiefOfStaff(vaultPath);
  const [mode, setMode] = useState<"chat" | "fields">("chat");
  const [draft, setDraft] = useState<SpecDraft>({});
  const [turns, setTurns] = useState<Turn[]>([]);
  const [ready, setReady] = useState(false);
  const [fresh, setFresh] = useState<string[]>([]);
  const [busy, setBusy] = useState<"think" | "make" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!fresh.length) return; const t = window.setTimeout(() => setFresh([]), 2400); return () => window.clearTimeout(t); }, [fresh]);
  const opener = "What should this specialist do for you? Describe it in your own words. To add an outside agent, paste its https address.";
  const required = !!(draft.name && draft.mandate);

  const make = async (d: SpecDraft = draft) => {
    setBusy("make"); setErr(null);
    try {
      const r = await invoke<{ ok?: boolean; error?: string; spec?: { id: string } }>("engine_specialist_create", { vault: vaultPath, draft: d });
      if (!r?.ok || !r.spec) throw new Error(r?.error ?? "not made");
      invalidateQueries("engine_specialists");
      onMade(r.spec.id);
    } catch (e) { setErr(`Not added: ${String(e).replace(/^Error:\s*/, "")}`); } finally { setBusy(null); }
  };
  const send = async (raw: string) => {
    const t = raw.trim();
    if (!t || busy) return;
    const next: Turn[] = [...turns, { role: "user", text: t }];
    setTurns(next); setText(""); setBusy("think"); setErr(null);
    try {
      const r = await invoke<DraftReply>("engine_specialist_draft", { vault: vaultPath, turns: [{ role: "assistant", text: opener }, ...next], draft });
      setDraft(r.draft); setReady(r.ready); setFresh(r.filled);
      setTurns([...next, { role: "assistant", text: r.reply }]);
      setBusy(null);
      if (r.go && r.ready) await make(r.draft);
    } catch (e) {
      setTurns([...next, { role: "assistant", text: "I could not reach the engine just now. Try again in a moment." }]);
      setErr(String(e)); setBusy(null);
    }
    requestAnimationFrame(() => box.current?.focus());
  };

  const toggle = (
    <div role="group" aria-label="How to set it up" className="inline-flex shrink-0 overflow-hidden rounded-md border border-border-subtle">
      {([["chat", "Chat", MessageSquare], ["fields", "Fields", ListChecks]] as const).map(([k, t, I]) => (
        <button key={k} type="button" onClick={() => setMode(k)} aria-pressed={mode === k} data-testid={`specialist-mode-${k}`}
          className={`inline-flex h-7 items-center gap-1 px-2 text-[12px] ${mode === k ? "bg-surface-warm font-medium text-text-primary" : "text-text-muted hover:text-text-primary"}`}><I className="h-3.5 w-3.5" />{t}</button>
      ))}
    </div>
  );
  const bits = specBits(draft);
  return (
    <section data-testid="specialist-new" className="flex min-h-full max-w-3xl flex-col">
      <div className="flex items-center gap-3">
        <h2 className={`${DETAIL_TITLE} min-w-0 flex-1 truncate`}>New specialist</h2>
        {toggle}
      </div>
      {mode === "fields" ? (
        <FieldsForm draft={draft} onDraft={setDraft} busy={busy === "make"} onMake={() => void make()} onCancel={onCancel} err={err} />
      ) : (
        <>
          <div className="flex-1 pb-3">
            <Line name={chief}><p>{opener}</p></Line>
            {turns.length === 0 && (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 pl-10" data-testid="specialist-starters">
                {STARTERS.map((s) => (
                  <button key={s} type="button" onClick={() => { setText(s); requestAnimationFrame(() => { const b = box.current; if (b) { b.focus(); b.setSelectionRange(s.length, s.length); } }); }}
                    className="h-8 text-[13px] text-text-secondary underline decoration-border underline-offset-4 hover:text-accent hover:decoration-accent">{s.trim()}...</button>
                ))}
              </div>
            )}
            {turns.map((t, i) => t.role === "user"
              ? <div key={i} className="mt-4 flex justify-end"><p className={`${BODY} max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-surface-warm px-3.5 py-2 text-text-primary`}>{t.text}</p></div>
              : <Line key={i} name={chief} testId="specialist-chat-reply"><p>{t.text}</p></Line>)}
            {busy === "think" && <Line name={chief} working><p className="text-text-muted">Thinking</p></Line>}
          </div>
          <div className="sticky bottom-0 z-10 bg-background">
            {bits.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border-subtle py-2" data-testid="specialist-draft-summary">
                <p className={`${META} min-w-0 flex-1 basis-64`} title={draft.mandate ?? undefined}>
                  {draft.name && <SpecialistAvatar id={(draft.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-")} size={16} className="mr-1.5 inline-block translate-y-[3px]" />}
                  {bits.map((b, i) => <span key={b.key} className={`transition-colors duration-700 ${fresh.includes(b.key) ? "text-accent" : b.key === "name" ? "font-medium text-text-secondary" : ""}`}>{i > 0 && <span aria-hidden> · </span>}{b.text}</span>)}
                  {!required && <span className="text-text-muted/80">{" · "}still to settle: {[!draft.name && "a name", !draft.mandate && "what it is for"].filter(Boolean).join(", ")}</span>}
                </p>
                {(ready || required) && <button type="button" onClick={() => void make()} disabled={!!busy} data-testid="specialist-make" className={startBtn}>{busy === "make" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Add specialist</button>}
              </div>
            )}
            {err && <p className="pb-1 text-[13px] text-err">{err}</p>}
            <form className="pb-4 pt-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
              <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface px-3 py-2 transition-colors focus-within:border-accent">
                <textarea ref={box} autoFocus aria-label="Describe the specialist" data-testid="specialist-chat-input" rows={1} value={text} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text); } }}
                  placeholder={turns.length ? "Answer, or add anything" : "Describe it in a sentence or two"}
                  className="ring-in-box max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none" style={{ fieldSizing: "content" } as React.CSSProperties} />
                <button type="submit" disabled={!text.trim() || !!busy} aria-label="Send" title="Send" data-testid="specialist-chat-send"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent disabled:bg-surface-strong disabled:text-text-muted"><ArrowUp className="h-4 w-4" /></button>
              </div>
              <div className="mt-1.5 flex items-center gap-3">
                <p className={`${META} flex-1`}>Nothing is added until you say go. A specialist never acts on its own.</p>
                <button type="button" onClick={onCancel} className="text-[13px] text-text-muted hover:text-text-primary">Cancel</button>
              </div>
            </form>
          </div>
        </>
      )}
    </section>
  );
}

function Line({ name, working, testId, children }: { name: string | null; working?: boolean; testId?: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 flex items-start gap-3" data-testid={testId}>
      <ChiefAvatar size={28} state={working ? "working" : "idle"} label={name ?? "Your chief of staff"} className="mt-0.5" />
      <div className={`${BODY} min-w-0 flex-1 break-words text-text-primary`}>{children}</div>
    </div>
  );
}

function FieldsForm({ draft, onDraft, busy, onMake, onCancel, err }: { draft: SpecDraft; onDraft: (d: SpecDraft) => void; busy: boolean; onMake: () => void; onCancel: () => void; err: string | null }) {
  const set = (k: keyof SpecDraft, v: string) => onDraft(Object.fromEntries(Object.entries({ ...draft, [k]: v.trim() ? v : undefined }).filter(([, x]) => x !== undefined)) as SpecDraft);
  const lbl = "mb-1 block text-[13px] font-medium text-text-secondary";
  return (
    <form data-testid="specialist-new-form" className="mt-4 grid gap-4" onSubmit={(e) => { e.preventDefault(); if (draft.name && draft.mandate) onMake(); }}>
      <label className="block"><span className={lbl}>Name</span><input aria-label="Specialist name" value={draft.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="Grant finder" className={inputCls} /></label>
      <label className="block"><span className={lbl}>What it is for</span><textarea aria-label="What it is for" rows={2} value={draft.mandate ?? ""} onChange={(e) => set("mandate", e.target.value)} placeholder="One or two sentences" className={inputCls} /></label>
      <label className="block"><span className={lbl}>Outside agent address (optional)</span><input aria-label="Outside agent address" value={draft.endpoint ?? ""} onChange={(e) => set("endpoint", e.target.value)} placeholder="https://" className={inputCls} /></label>
      {err && <p className="text-[13px] text-err">{err}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={!draft.name || !draft.mandate || busy} data-testid="specialist-create" className={startBtn}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Add specialist</button>
        <button type="button" onClick={onCancel} className="inline-flex h-9 items-center rounded-lg px-3 text-[13px] text-text-secondary hover:text-text-primary">Cancel</button>
      </div>
    </form>
  );
}

/** The one line under an outside agent's or a preset's name. */
export function originLine(s: { base?: string; outside?: { endpoint: string; perDay: number } }): string | null {
  if (s.outside) return `Outside agent at ${host(s.outside.endpoint)} · gets only the brief · asks before every call · ${s.outside.perDay} a day at most`;
  if (s.base) return `Built on the ${label(s.base)}`;
  return null;
}

export { Globe as OutsideIcon };
