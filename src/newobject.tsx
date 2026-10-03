// A new person, place, product, thing or event, by talking (Fru, 2026-10-02:
// "talk, don't fill fields"). The chief of staff asks one question at a time;
// the engine drafts the fields behind the scenes (`entities draft`, every
// field checked in code) and one quiet line shows what is settled. Nothing is
// saved until the user says so: the Save button, or saying "save it". A small
// toggle shows the same draft as fields.
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, ListChecks, Loader2, MessageSquare } from "lucide-react";
import { invoke } from "./bridge";
import { useIsPhone } from "./useisphone";
import { BODY, DETAIL_TITLE, META } from "./typescale";
import { ChiefAvatar } from "./specialistavatar";
import { useChiefOfStaff } from "./chiefofstaff";
import { fmtDay, kindDef, type KindId } from "./ia";

type DraftKind = "person" | "place" | "org" | "thing" | "event";
export interface ObjectDraft {
  name?: string; notes?: string; website?: string;
  date?: string; end?: string; time?: string; place?: string; people?: string[];
  purchased?: string; warranty?: string; value?: number; maker?: string;
}
interface DraftReply { draft: ObjectDraft; filled: string[]; reply: string; ready: boolean; missing: string[]; go: boolean }
type Turn = { role: "user" | "assistant"; text: string };

const KIND_OF: Partial<Record<KindId, DraftKind>> = { people: "person", places: "place", products: "org", things: "thing", events: "event" };
const OPENER: Record<DraftKind, string> = {
  person: "Who is it? A name and how you know them is plenty.",
  place: "Which place? A name, and what it is to you.",
  org: "Which company, app or service?",
  thing: "What is it? Say what you own, and anything you know: when you bought it, who made it, where it lives.",
  event: "What is happening, and when? Christmas, a birthday, a dinner: say it your way.",
};
const FIELDS: Record<DraftKind, { key: keyof ObjectDraft; label: string; type?: "date" | "time" | "number" }[]> = {
  person: [{ key: "name", label: "Name" }, { key: "notes", label: "Notes" }],
  place: [{ key: "name", label: "Name" }, { key: "notes", label: "Notes" }],
  org: [{ key: "name", label: "Name" }, { key: "website", label: "Website" }, { key: "notes", label: "Notes" }],
  thing: [{ key: "name", label: "Name" }, { key: "purchased", label: "Bought", type: "date" }, { key: "warranty", label: "Warranty until", type: "date" }, { key: "value", label: "Value ($)", type: "number" }, { key: "maker", label: "Made by" }, { key: "place", label: "Kept at" }, { key: "notes", label: "Notes" }],
  event: [{ key: "name", label: "Name" }, { key: "date", label: "Date", type: "date" }, { key: "time", label: "Time", type: "time" }, { key: "end", label: "Ends", type: "date" }, { key: "place", label: "Where" }, { key: "notes", label: "Notes" }],
};
const REQUIRED: Record<DraftKind, (keyof ObjectDraft)[]> = { person: ["name"], place: ["name"], org: ["name"], thing: ["name"], event: ["name", "date"] };

const inputCls = "w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-text-primary focus:border-accent-border focus:outline-none";
const saveBtn = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50";

/** What is settled, as one quiet line. */
export function draftBits(kind: DraftKind, d: ObjectDraft): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  if (d.name) out.push({ key: "name", text: d.name });
  if (d.date) out.push({ key: "date", text: `${fmtDay(d.date)}${d.time ? ` at ${d.time}` : ""}${d.end && d.end !== d.date ? ` to ${fmtDay(d.end)}` : ""}` });
  if (d.place) out.push({ key: "place", text: kind === "thing" ? `kept at ${d.place}` : `at ${d.place}` });
  if (d.people?.length) out.push({ key: "people", text: `with ${d.people.join(", ")}` });
  if (d.maker) out.push({ key: "maker", text: `made by ${d.maker}` });
  if (d.purchased) out.push({ key: "purchased", text: `bought ${fmtDay(d.purchased)}` });
  if (d.warranty) out.push({ key: "warranty", text: `warranty until ${fmtDay(d.warranty)}` });
  if (d.value != null) out.push({ key: "value", text: `$${d.value.toLocaleString()}` });
  if (d.website) out.push({ key: "website", text: d.website });
  return out;
}

export function NewObject({ vaultPath, kind: kindId, onCancel, onMade }: { vaultPath: string; kind: KindId; onCancel: () => void; onMade: (id: string) => void }) {
  const kind = KIND_OF[kindId]!;
  const def = kindDef(kindId);
  const phone = useIsPhone();
  const chief = useChiefOfStaff(vaultPath);
  const [mode, setMode] = useState<"chat" | "fields">("chat");
  const [draft, setDraft] = useState<ObjectDraft>({});
  const [turns, setTurns] = useState<Turn[]>([]);
  const [fresh, setFresh] = useState<string[]>([]);
  const [busy, setBusy] = useState<"think" | "save" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (turns.length) end.current?.scrollIntoView?.({ block: "end" }); }, [turns.length, busy]);
  useEffect(() => { if (!fresh.length) return; const t = window.setTimeout(() => setFresh([]), 2400); return () => window.clearTimeout(t); }, [fresh]);
  const ready = REQUIRED[kind].every((k) => draft[k] != null && draft[k] !== "");
  const opener = OPENER[kind];

  const save = async (d: ObjectDraft = draft) => {
    setBusy("save"); setErr(null);
    try {
      const r = await invoke<{ id: string }>("ia_create", { vault: vaultPath, kind, draft: d });
      window.dispatchEvent(new CustomEvent("prevail:entities-changed"));
      window.dispatchEvent(new CustomEvent("prevail:events-changed"));
      onMade(r.id);
    } catch (e) { setErr(`Not saved: ${String(e)}`); } finally { setBusy(null); }
  };

  const send = async (raw: string) => {
    const t = raw.trim();
    if (!t || busy) return;
    const next: Turn[] = [...turns, { role: "user", text: t }];
    setTurns(next); setText(""); setBusy("think"); setErr(null);
    try {
      const r = await invoke<DraftReply>("ia_draft", { vault: vaultPath, kind, turns: [{ role: "assistant", text: opener }, ...next], draft });
      setDraft(r.draft); setFresh(r.filled);
      setTurns([...next, { role: "assistant", text: r.reply }]);
      setBusy(null);
      if (r.go && r.ready) await save(r.draft);
    } catch (e) {
      setTurns([...next, { role: "assistant", text: "I could not reach the engine just now. Try again in a moment." }]);
      setErr(String(e)); setBusy(null);
    }
    requestAnimationFrame(() => box.current?.focus());
  };

  const pad = phone ? "px-4" : "px-8";
  const toggle = (
    <div role="group" aria-label="How to add it" className="inline-flex shrink-0 overflow-hidden rounded-md border border-border-subtle">
      {([["chat", "Chat", MessageSquare], ["fields", "Fields", ListChecks]] as const).map(([k, t, I]) => (
        <button key={k} type="button" onClick={() => setMode(k)} aria-pressed={mode === k} data-testid={`new-object-mode-${k}`} title={k === "chat" ? "Describe it; the fields fill themselves" : "See and edit the fields"}
          className={`inline-flex h-7 items-center gap-1 px-2 text-[12px] ${mode === k ? "bg-surface-warm font-medium text-text-primary" : "text-text-muted hover:text-text-primary"}`}><I className="h-3.5 w-3.5" />{t}</button>
      ))}
    </div>
  );
  const head = (
    <div className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 ${pad} pb-2 pt-5`}>
      <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent-border bg-accent-soft text-accent"><def.icon className="h-4 w-4" /></span>
      <h2 className={`${DETAIL_TITLE} min-w-[8rem] flex-1 truncate`}>New {def.singular.toLowerCase()}</h2>
      {toggle}
    </div>
  );

  if (mode === "fields") return (
    <div className="flex min-h-full flex-col" data-testid="new-object-fields">
      {head}
      <form className={`${pad} pb-6`} onSubmit={(e) => { e.preventDefault(); if (ready) void save(); }}>
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          {FIELDS[kind].map((f) => (
            <label key={f.key} className={`block ${f.key === "notes" || f.key === "name" ? "sm:col-span-2" : ""}`}>
              <span className="mb-1 block text-[13px] font-medium text-text-secondary">{f.label}</span>
              <input type={f.type ?? "text"} aria-label={f.label} value={draft[f.key] == null ? "" : String(draft[f.key])} inputMode={f.type === "number" ? "decimal" : undefined}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: f.type === "number" ? (e.target.value === "" ? undefined : Number(e.target.value.replace(/[^0-9.]/g, ""))) : e.target.value || undefined }))}
                className={inputCls} />
            </label>
          ))}
        </div>
        {err && <p className="mt-3 text-[13px] text-err">{err}</p>}
        <div className="mt-5 flex gap-2">
          <button type="submit" disabled={!ready || !!busy} data-testid="new-object-save" className={saveBtn}>{busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Save</button>
          <button type="button" onClick={onCancel} className="inline-flex h-9 items-center rounded-lg px-3 text-[13px] text-text-secondary hover:text-text-primary">Cancel</button>
        </div>
      </form>
    </div>
  );

  const bits = draftBits(kind, draft);
  return (
    <div className="flex min-h-full flex-col" data-testid="new-object-chat">
      {head}
      <div className={`flex-1 ${pad} pb-3`}>
        <div className="max-w-3xl">
          <Line name={chief}><p>{opener}</p></Line>
          {turns.map((t, i) => t.role === "user"
            ? <div key={i} data-testid="new-object-user" className="mt-4 flex justify-end"><p className={`${BODY} max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-surface-warm px-3.5 py-2 text-text-primary`}>{t.text}</p></div>
            : <Line key={i} name={chief} testId="new-object-reply"><p>{t.text}</p></Line>)}
          {busy === "think" && <Line name={chief} working><p className="text-text-muted">Thinking</p></Line>}
          <div ref={end} className="scroll-mb-48" />
        </div>
      </div>
      <div className="sticky bottom-0 z-10 bg-background">
        {bits.length > 0 && (
          <div className={`border-t border-border-subtle ${pad} py-2`} data-testid="new-object-summary">
            <div className="flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1.5">
              <p className={`${META} min-w-0 flex-1 basis-64`}>
                {bits.map((b, i) => (
                  <span key={b.key} className={`transition-colors duration-700 ${fresh.includes(b.key) ? "text-accent" : b.key === "name" ? "font-medium text-text-secondary" : ""}`}>{i > 0 && <span aria-hidden> · </span>}{b.text}</span>
                ))}
                {!ready && <span className="text-text-muted/80"> · still to settle: {REQUIRED[kind].filter((k) => !draft[k]).map((k) => (k === "date" ? "a date" : "a name")).join(", ")}</span>}
              </p>
              {ready && <button type="button" onClick={() => void save()} disabled={!!busy} data-testid="new-object-save" className={saveBtn}>{busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Save</button>}
            </div>
          </div>
        )}
        {err && <p className={`${pad} pb-1 text-[13px] text-err`}>{err}</p>}
        <form className={`${pad} pb-4 pt-2`} onSubmit={(e) => { e.preventDefault(); void send(text); }}>
          <div className="flex max-w-3xl items-end gap-2 rounded-2xl border border-border bg-surface px-3 py-2 transition-colors focus-within:border-accent">
            <textarea ref={box} autoFocus aria-label={`Describe the ${def.singular.toLowerCase()}`} data-testid="new-object-input" rows={1} value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text); } }}
              placeholder={turns.length ? "Answer, or add anything" : "Say it in a sentence"}
              className="ring-in-box max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none" style={{ fieldSizing: "content" } as React.CSSProperties} />
            <button type="submit" disabled={!text.trim() || !!busy} aria-label="Send" title="Send" data-testid="new-object-send"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent disabled:bg-surface-strong disabled:text-text-muted"><ArrowUp className="h-4 w-4" /></button>
          </div>
          <div className="mt-1.5 flex max-w-3xl items-center gap-3">
            <p className={`${META} flex-1`}>Nothing is saved until you say so.</p>
            <button type="button" onClick={onCancel} className="text-[13px] text-text-muted hover:text-text-primary">Cancel</button>
          </div>
        </form>
      </div>
    </div>
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
