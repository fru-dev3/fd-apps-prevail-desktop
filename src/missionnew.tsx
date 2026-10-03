// New mission: talk, don't fill fields (Fru, 2026-10-02). It opens as a
// conversation with the chief of staff, who asks one question at a time; the
// engine drafts the mission's fields behind the scenes (`missions draft`,
// every field checked in code) and one quiet line shows what is settled. The
// mission starts only on the user's go: the Start button, or saying "go".
// A small toggle shows the same draft as fields, for anyone who wants them.
import { useEffect, useRef, useState } from "react";
import { ArrowUp, GraduationCap, Hammer, ListChecks, Loader2, MessageSquare, Plane, Play, ShoppingBag, Wrench } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { useIsPhone } from "./useisphone";
import { BODY, DETAIL_TITLE, META } from "./typescale";
import { ChiefAvatar, SpecialistAvatar } from "./specialistavatar";
import { useChiefOfStaff } from "./chiefofstaff";
import { createMission, MISSIONS_CHANGED, type Mission } from "./missions";
import { MISSION_DRAFT_KEY } from "./missioncards";
import { draftFromFields, draftTurn, NEW_MODE_KEY, STARTERS, summaryBits, type DraftTurn, type MissionDraft, type StarterKind } from "./missiondraft";

const KIND_ICON: Record<StarterKind, typeof Plane> = { trip: Plane, purchase: ShoppingBag, learning: GraduationCap, build: Hammer, remodel: Wrench };

const inputCls = "w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-text-primary focus:border-accent-border focus:outline-none";
const fieldLabel = "mb-1 block text-[13px] font-medium text-text-secondary";
const startBtn = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50";

/** A draft handed over from a chat card ("Adjust"), read once. */
function takeHandedDraft(): MissionDraft | null {
  try {
    const d = localStorage.getItem(MISSION_DRAFT_KEY);
    localStorage.removeItem(MISSION_DRAFT_KEY);
    if (!d) return null;
    const x = JSON.parse(d) as { name?: string; outcome?: string; owner?: string; target?: string; specialists?: string[]; consulted?: string[] };
    return Object.fromEntries(Object.entries({ name: x.name, outcome: x.outcome, owner: x.owner, target: x.target, specialists: x.specialists, consult: x.consulted }).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))) as MissionDraft;
  } catch { return null; }
}

export function NewMission({ vaultPath, domains, onCancel, onMade }: { vaultPath: string; domains: string[]; onCancel: () => void; onMade: (slug: string) => void }) {
  const phone = useIsPhone();
  const chief = useChiefOfStaff(vaultPath);
  const [handed] = useState(takeHandedDraft);
  const [mode, setMode] = useState<"chat" | "fields">(() => { try { return localStorage.getItem(NEW_MODE_KEY) === "fields" ? "fields" : "chat"; } catch { return "chat"; } });
  useEffect(() => { try { localStorage.setItem(NEW_MODE_KEY, mode); } catch { /* storage off */ } }, [mode]);
  const [draft, setDraft] = useState<MissionDraft>(handed ?? {});
  const [turns, setTurns] = useState<DraftTurn[]>([]);
  const [ready, setReady] = useState(false);
  const [fresh, setFresh] = useState<string[]>([]);
  const [busy, setBusy] = useState<"think" | "start" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<StarterKind | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (turns.length) end.current?.scrollIntoView({ block: "end" }); }, [turns.length, busy]);
  useEffect(() => { if (!fresh.length) return; const t = window.setTimeout(() => setFresh([]), 2400); return () => window.clearTimeout(t); }, [fresh]);
  const required = !!(draft.name && draft.outcome && draft.target);

  const opener = handed?.name
    ? `Here is what I have for ${handed.name}. Anything to change or add? Say go when it looks right.`
    : "What do you want to get done? Say it in your own words, and I will work out the details with you.";

  const start = async (d: MissionDraft = draft) => {
    setBusy("start"); setErr(null);
    try {
      const m = await invoke<Mission & { dropped?: unknown[] }>("engine_missions_create_from_draft", { vault: vaultPath, draft: d });
      window.dispatchEvent(new Event(MISSIONS_CHANGED));
      onMade(m.slug);
    } catch (e) { setErr(`Not started: ${String(e)}`); } finally { setBusy(null); }
  };

  const send = async (raw: string) => {
    const t = raw.trim();
    if (!t || busy) return;
    const next: DraftTurn[] = [...turns, { role: "user", text: t }];
    setTurns(next); setText(""); setBusy("think"); setErr(null);
    try {
      const r = await draftTurn(vaultPath, [{ role: "assistant", text: opener }, ...next], draft, kind);
      setDraft(r.draft); setReady(r.ready); setFresh(r.filled);
      setTurns([...next, { role: "assistant", text: r.reply }]);
      setBusy(null);
      if (r.go && r.ready) await start(r.draft);
    } catch (e) {
      setTurns([...next, { role: "assistant", text: "I could not reach the engine just now. Try again in a moment." }]);
      setErr(String(e)); setBusy(null);
    }
    requestAnimationFrame(() => box.current?.focus());
  };

  const toggle = (
    <div role="group" aria-label="How to set it up" className="inline-flex shrink-0 overflow-hidden rounded-md border border-border-subtle">
      {([["chat", "Chat", MessageSquare], ["fields", "Fields", ListChecks]] as const).map(([k, t, I]) => (
        <button key={k} type="button" onClick={() => setMode(k)} aria-pressed={mode === k} data-testid={`mission-mode-${k}`} title={k === "chat" ? "Describe it; the fields fill themselves" : "See and edit the fields"}
          className={`inline-flex h-7 items-center gap-1 px-2 text-[12px] ${mode === k ? "bg-surface-warm font-medium text-text-primary" : "text-text-muted hover:text-text-primary"}`}><I className="h-3.5 w-3.5" />{t}</button>
      ))}
    </div>
  );
  const pad = phone ? "px-4" : "px-8";
  const head = (
    <div className={`flex shrink-0 items-center gap-3 ${pad} pb-2 pt-5`}>
      <h2 className={`${DETAIL_TITLE} min-w-0 flex-1 truncate`}>New project</h2>
      {toggle}
    </div>
  );

  if (mode === "fields") return (
    <div className="flex h-full min-h-0 flex-col">
      {head}
      <FieldsForm key="fields" draft={draft} domains={domains} pad={pad} vaultPath={vaultPath} onDraft={setDraft} onCancel={onCancel} onMade={onMade} />
    </div>
  );

  const bits = summaryBits(draft);
  return (
    // The pane scrolls; the draft line and the composer stay pinned at its foot.
    <div className="flex min-h-full flex-col" data-testid="mission-new-chat">
      {head}
      <div className={`flex-1 ${pad} pb-3`}>
        <div className="max-w-3xl">
          <Line who="chief" name={chief}><p>{opener}</p></Line>
          {turns.length === 0 && !handed && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 pl-10" data-testid="mission-starters">
              {STARTERS.map((s) => {
                const I = KIND_ICON[s.kind];
                return (
                  <button key={s.kind} type="button" data-testid={`mission-starter-${s.kind}`} aria-pressed={kind === s.kind}
                    onClick={() => { setKind(s.kind); setText(s.opening); requestAnimationFrame(() => { const b = box.current; if (b) { b.focus(); b.setSelectionRange(s.opening.length, s.opening.length); } }); }}
                    className={`inline-flex h-8 items-center gap-1.5 text-[13px] underline-offset-4 hover:text-accent ${kind === s.kind ? "text-accent" : "text-text-secondary"}`}>
                    <I className="h-3.5 w-3.5" aria-hidden />{s.label}
                  </button>
                );
              })}
            </div>
          )}
          {turns.map((t, i) => t.role === "user"
            ? <div key={i} data-testid="mission-chat-user" className="mt-4 flex justify-end"><p className={`${BODY} max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-surface-warm px-3.5 py-2 text-text-primary`}>{t.text}</p></div>
            : <Line key={i} who="chief" name={chief} testId="mission-chat-reply"><p>{t.text}</p></Line>)}
          {busy === "think" && <Line who="chief" name={chief} working><p className="text-text-muted">Thinking</p></Line>}
          <div ref={end} className="scroll-mb-48" />
        </div>
      </div>
      <div className="sticky bottom-0 z-10 bg-background">
      {(bits.length > 0 || draft.specialists?.length) && (
        <div className={`border-t border-border-subtle ${pad} py-2`} data-testid="mission-draft-summary">
          <div className="flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1.5">
            <p className={`${META} min-w-0 flex-1 basis-64`} title={draft.outcome ? `Done when: ${draft.outcome}` : undefined}>
              {draft.specialists?.length ? (
                <span className="mr-1.5 inline-flex translate-y-[3px] -space-x-1" title={draft.specialists.map(titleCase).join(", ")}>
                  {draft.specialists.map((s) => <SpecialistAvatar key={s} id={s} size={16} className="rounded-full ring-1 ring-background" />)}
                </span>
              ) : null}
              {bits.map((b, i) => (
                <span key={b.key} data-field={b.key} className={`transition-colors duration-700 ${fresh.includes(b.key) ? "text-accent" : b.key === "name" ? "font-medium text-text-secondary" : ""}`}>{i > 0 && <span aria-hidden> · </span>}{b.text}</span>
              ))}
              {!required && <span className="text-text-muted/80">{bits.length ? " · " : ""}still to settle: {[!draft.name && "a name", !draft.outcome && "what done looks like", !draft.target && "a date"].filter(Boolean).join(", ")}</span>}
            </p>
            {(ready || required) && <button type="button" onClick={() => void start()} disabled={!!busy} data-testid="mission-start-draft" className={startBtn}>{busy === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}Start project</button>}
          </div>
        </div>
      )}
      {err && <p className={`${pad} pb-1 text-[13px] text-err`}>{err}</p>}
      <form className={`${pad} pb-4 pt-2`} onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <div className="flex max-w-3xl items-end gap-2 rounded-2xl border border-border bg-surface px-3 py-2 transition-colors focus-within:border-accent">
          <textarea ref={box} autoFocus aria-label="Describe the project" data-testid="mission-chat-input" rows={1} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text); } }}
            placeholder={turns.length ? "Answer, or add anything" : "Describe it in a sentence or two"}
            className="ring-in-box max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none" style={{ fieldSizing: "content" } as React.CSSProperties} />
          <button type="submit" disabled={!text.trim() || !!busy} aria-label="Send" title="Send" data-testid="mission-chat-send"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent disabled:bg-surface-strong disabled:text-text-muted"><ArrowUp className="h-4 w-4" /></button>
        </div>
        <div className="mt-1.5 flex max-w-3xl items-center gap-3">
          <p className={`${META} flex-1`}>Nothing starts until you say go.</p>
          <button type="button" onClick={onCancel} className="text-[13px] text-text-muted hover:text-text-primary">Cancel</button>
        </div>
      </form>
      </div>
    </div>
  );
}

function Line({ who, name, working, testId, children }: { who: "chief"; name: string | null; working?: boolean; testId?: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 flex items-start gap-3" data-testid={testId}>
      {who === "chief" && <ChiefAvatar size={28} state={working ? "working" : "idle"} label={name ?? "Your chief of staff"} className="mt-0.5" />}
      <div className={`${BODY} min-w-0 flex-1 break-words text-text-primary`}>{children}</div>
    </div>
  );
}

function FieldsForm({ draft, domains, pad, vaultPath, onDraft, onCancel, onMade }: { draft: MissionDraft; domains: string[]; pad: string; vaultPath: string; onDraft: (d: MissionDraft) => void; onCancel: () => void; onMade: (slug: string) => void }) {
  const [name, setName] = useState(draft.name ?? "");
  const [outcome, setOutcome] = useState(draft.outcome ?? "");
  const [target, setTarget] = useState(draft.target ?? "");
  const [owner, setOwner] = useState(draft.owner ?? "");
  const [budget, setBudget] = useState(draft.budgetUsd != null ? String(draft.budgetUsd) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Edits flow back into the draft, so the chat picks up where the fields left off.
  useEffect(() => { onDraft(draftFromFields(draft, { name, outcome, target, owner, budget })); }, [name, outcome, target, owner, budget]); // eslint-disable-line react-hooks/exhaustive-deps
  const make = async () => {
    setBusy(true); setErr(null);
    try {
      const b = Number(budget);
      const m = await createMission(vaultPath, {
        name: name.trim(), outcome: outcome.trim() || undefined, target: target || undefined, owner: owner || undefined,
        budgetUsd: budget && Number.isFinite(b) ? b : undefined,
        consult: draft.consult?.length ? draft.consult : undefined, inform: draft.inform?.length ? draft.inform : undefined,
        apps: draft.apps?.length ? draft.apps : undefined, specialists: draft.specialists?.length ? draft.specialists : undefined,
        milestones: draft.milestones?.length ? draft.milestones.map((x) => x.title) : undefined,
      });
      onMade(m.slug);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  return (
    <form data-testid="mission-new-form" className={`min-h-0 flex-1 overflow-y-auto ${pad} pb-6`} onSubmit={(e) => { e.preventDefault(); if (name.trim()) void make(); }}>
      <p className={`${BODY} max-w-3xl text-text-secondary`}>What do you want done, and by when? Leave the date empty and one is proposed.</p>
      <div className="mt-5 grid max-w-3xl gap-4">
        <label className="block"><span className={fieldLabel}>Name</span><input aria-label="Project name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Learn the cello" className={inputCls} /></label>
        <label className="block"><span className={fieldLabel}>Outcome</span><input aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What done looks like, in your words" className={inputCls} /></label>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block"><span className={fieldLabel}>Target date</span><input type="date" aria-label="Target date" value={target} onChange={(e) => setTarget(e.target.value)} className={inputCls} /></label>
          <label className="block"><span className={fieldLabel}>Owner domain</span>
            <select aria-label="Owner domain" value={owner} onChange={(e) => setOwner(e.target.value)} className={inputCls}>
              <option value="">Choose later</option>
              {domains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
            </select>
          </label>
          <label className="block"><span className={fieldLabel}>Budget ($)</span><input inputMode="decimal" aria-label="Budget" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="optional" className={inputCls} /></label>
        </div>
        {draft.specialists?.length ? (
          <div className={`${META} flex flex-wrap items-center gap-2`}>From the chat:
            {draft.specialists.map((s) => <span key={s} className="inline-flex items-center gap-1 text-text-secondary"><SpecialistAvatar id={s} size={18} />{titleCase(s)}</span>)}
            {draft.consult?.length ? <span>· reads {draft.consult.map(titleCase).join(", ")}</span> : null}
          </div>
        ) : null}
      </div>
      {err && <p className="mt-3 text-[13px] text-err">{err}</p>}
      <div className="mt-5 flex gap-2">
        <button type="submit" disabled={!name.trim() || busy} data-testid="mission-create" className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-[14px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Start project</button>
        <button type="button" onClick={onCancel} className="inline-flex h-10 items-center rounded-lg px-3 text-[14px] text-text-secondary hover:text-text-primary">Cancel</button>
      </div>
    </form>
  );
}
