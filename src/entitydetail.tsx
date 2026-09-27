// One entity's detail: what the vault knows about one person, place, company
// or thing, shown in the Entities view's detail pane (never a side card).
// Everything comes from `prevail entities show`; the owner's notes are edited
// here and written back to the page's "Your notes" section only.
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Boxes, BookmarkCheck, BookmarkPlus, FileText, Loader2, MapPin, MessageSquare, MessagesSquare, Terminal } from "lucide-react";
import { invoke } from "./bridge";
import { CARD_KINDS, EntityChip, OrgMark, entityIdOf, openMap, type EntityKind } from "./entities";
import { entitySnapshot } from "./entitystore";
import { Markdown } from "./Markdown";
import { pickSkillColor } from "./sectionutil";
import { loadEntityThreads, type EntityThread } from "./entitythreads";

// The chat is the whole chat panel, so it loads only when opened.
const EntityChat = lazy(() => import("./entitychat").then((m) => ({ default: m.EntityChat })));

export interface EntityMention { source: "thread" | "prompt" | "brief"; ref: string; domain: string; project: string; title: string; tool?: string; ts: number; snippet: string }
export interface EntityDetail {
  found: boolean;
  query?: string;
  id: string; name: string; kind: EntityKind; aliases: string[]; kinds: EntityKind[];
  mention_count: number; conversations: number; last_ts: number;
  mentions: EntityMention[]; co_mentions: { id: string; name: string; kind: EntityKind; count: number }[];
  page?: string; page_path?: string; saved?: boolean; domain?: string; digest: string; notes: string;
}

const KIND_LABEL: Record<string, string> = { person: "Person", place: "Place", org: "Company or product", thing: "Thing" };
const fmtDay = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });

function fire(name: string, detail?: unknown) { window.dispatchEvent(new CustomEvent(name, { detail })); }

export function KindBadge({ kind, name, domain, size = 44 }: { kind: EntityKind; name: string; domain?: string; size?: number }) {
  const box = { width: size, height: size };
  if (kind === "person") {
    const { bg, fg } = pickSkillColor(name);
    const words = name.replace(/[^\p{L}\p{N}\s]/gu, "").trim().split(/\s+/).filter(Boolean);
    const ini = words.length ? (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase() : "?";
    return <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full font-bold" style={{ ...box, backgroundColor: bg, color: fg, fontSize: size * 0.36 }}>{ini}</span>;
  }
  if (kind === "org") return <span aria-hidden className="flex shrink-0 items-center justify-center rounded-xl border border-border bg-surface-warm text-text-secondary" style={box}><OrgMark name={name} host={domain} size={Math.round(size * 0.6)} /></span>;
  const Icon = kind === "place" ? MapPin : Boxes;
  return <span aria-hidden className="flex shrink-0 items-center justify-center rounded-xl border border-accent-border bg-accent-soft text-accent" style={box}><Icon style={{ width: size * 0.5, height: size * 0.5 }} /></span>;
}

// A still, drawn map tile for a place (no map service is contacted until the
// owner opens the real map).
function PlaceMap({ name }: { name: string }) {
  return (
    <button type="button" onClick={() => openMap(name)} title={`Open ${name} in Maps`} data-testid="entity-map"
      className="group relative block h-36 w-full overflow-hidden rounded-xl border border-border bg-surface-warm text-left">
      <svg aria-hidden className="absolute inset-0 h-full w-full text-border" preserveAspectRatio="none" viewBox="0 0 400 144">
        <path d="M0 40 H400 M0 96 H400 M70 0 V144 M190 0 V144 M320 0 V144" stroke="currentColor" strokeWidth="1" fill="none" />
        <path d="M-10 130 C 90 80, 150 120, 230 60 S 360 10, 410 30" stroke="currentColor" strokeWidth="7" fill="none" opacity="0.7" />
        <path d="M120 -10 C 140 50, 110 90, 160 160" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.6" />
      </svg>
      <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-[70%] flex-col items-center">
        <MapPin className="h-8 w-8 fill-accent-soft text-accent drop-shadow" />
      </span>
      <span className="absolute bottom-2 left-2 right-2 truncate rounded-md bg-background/90 px-2 py-1 text-[13px] font-medium text-text-primary group-hover:text-accent">{name}</span>
    </button>
  );
}

function openMention(m: EntityMention) {
  if (m.source === "prompt") {
    try { localStorage.setItem("prevail.intent.focus", String(m.ts)); } catch { /* storage off */ }
    fire("prevail:open-settings", "intent");
    fire("prevail:intent-focus", m.ts);
    return;
  }
  if (m.source === "thread" && m.domain && !m.domain.startsWith("_")) {
    fire("prevail:open-thread", { domain: m.domain, ref: m.ref });
    return;
  }
  fire("prevail:open-vault-file", m.ref);
}

function MentionRow({ m }: { m: EntityMention }) {
  const Icon = m.source === "prompt" ? Terminal : m.source === "brief" ? FileText : MessagesSquare;
  const where = m.source === "prompt"
    ? `${m.tool ? `${m.tool[0].toUpperCase()}${m.tool.slice(1)}` : "Prompt"}${m.title && m.title !== "Other" ? ` · ${m.title}` : ""}`
    : m.title || m.ref.split("/").pop();
  return (
    <li>
      <button type="button" onClick={() => openMention(m)} data-testid="entity-mention"
        className="flex w-full gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-warm">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-text-primary">{where}</span>
            <span className="shrink-0 text-[12px] text-text-muted">{fmtDay(m.ts)}</span>
          </span>
          {m.snippet && <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-text-secondary">{m.snippet}</span>}
        </span>
      </button>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h3 className="text-[19px] font-semibold text-text-primary mb-3">{title}</h3>
      {children}
    </section>
  );
}

export function EntityDetailView({ vaultPath, target }: { vaultPath: string; target: { kind: EntityKind; value: string } }) {
  const id = entityIdOf({ kind: target.kind, value: target.value });
  const [d, setD] = useState<EntityDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"save" | "notes" | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  // A slug-only chip (prevail://person/sam-rivera) shows the page's own name.
  const known = entitySnapshot().byId.get(id);
  const displayName = d?.found ? d.name : (known?.name ?? target.value);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await invoke<EntityDetail>("entities_show", { vault: vaultPath, id: `${target.kind}/${target.value}` });
      setD(r);
      setNotes(r.found ? r.notes : "");
    } catch (e) { setErr(String(e)); }
  }, [vaultPath, target.kind, target.value]);
  useEffect(() => { setD(null); void load(); }, [load]);

  const writeId = d?.found ? d.id : `${target.kind}/${target.value}`;
  function writeIdOf() { return d?.found ? d.id : `${target.kind}/${target.value}`; }
  const save = async () => {
    setBusy("save");
    try {
      const r = await invoke<EntityDetail>("entities_save", { vault: vaultPath, id: writeId, name: displayName });
      setD({ ...r, found: true });
      fire("prevail:entities-changed");
    } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };
  const saveNotes = async () => {
    setBusy("notes");
    try {
      const r = await invoke<EntityDetail>("entities_note", { vault: vaultPath, id: writeId, text: notes, name: displayName });
      setD({ ...r, found: true });
      setSavedNote(true);
      window.setTimeout(() => setSavedNote(false), 1800);
      fire("prevail:entities-changed");
    } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };
  // Entity chat opens in this pane. `chat` holds the conversation to open:
  // undefined continues the most recent, null starts a new one.
  const [chat, setChat] = useState<{ thread?: string | null } | null>(null);
  const [threads, setThreads] = useState<EntityThread[] | null>(null);
  useEffect(() => {
    let alive = true;
    const pull = () => { void loadEntityThreads(vaultPath, writeIdOf()).then((l) => { if (alive) setThreads(l); }); };
    pull();
    window.addEventListener("prevail:threads-changed", pull);
    return () => { alive = false; window.removeEventListener("prevail:threads-changed", pull); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath, target.kind, target.value, d?.id]);

  const kind = (d?.found ? d.kind : target.kind) as EntityKind;
  const hasPage = !!(d?.found && d.page_path);
  const notesDirty = notes !== (d?.found ? d.notes : "");

  if (chat) {
    return (
      <Suspense fallback={<div className="flex items-center gap-2 py-8 text-[14px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" />Opening the chat</div>}>
        <EntityChat vaultPath={vaultPath} entity={{ id: writeId, name: displayName }} initial={chat.thread} onBack={() => setChat(null)} />
      </Suspense>
    );
  }

  return (
    <div data-testid="entity-detail">
      <div className="flex items-start gap-4">
        <KindBadge kind={kind} name={displayName} domain={d?.found ? d.domain : known?.domain} size={56} />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[26px] font-semibold leading-tight tracking-tight text-text-primary [overflow-wrap:anywhere]">{displayName}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[14px] text-text-muted">
            <span>{KIND_LABEL[kind] ?? kind}</span>
            {d?.found && d.conversations > 0 && <><span aria-hidden>·</span><span>{d.conversations} {d.conversations === 1 ? "conversation" : "conversations"}</span></>}
            {d?.found && d.saved && <span className="inline-flex items-center gap-1 text-ok"><span data-vault-dot className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />Saved</span>}
          </div>
          {d?.found && d.aliases.length > 0 && <div className="mt-1 truncate text-[14px] text-text-muted" title={d.aliases.join(", ")}>Also {d.aliases.slice(0, 4).join(", ")}</div>}
          {hasPage && <div className="mt-1 truncate text-[13px] text-text-muted" title={d!.page_path}>{d!.page_path}</div>}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {d?.found && d.saved
          ? <span className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-accent-border bg-accent-soft px-3.5 text-[14px] font-medium text-accent"><BookmarkCheck className="h-4 w-4" />Saved</span>
          : <button onClick={save} disabled={!d || busy !== null} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[14px] font-medium text-white hover:bg-accent-hover disabled:opacity-60">
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookmarkPlus className="h-4 w-4" />}Save to vault
            </button>}
        <button onClick={() => setChat({})} disabled={!d} data-testid="entity-chat-open" className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3.5 text-[14px] font-medium text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-60">
          <MessageSquare className="h-4 w-4" />Chat
        </button>
        {kind === "place" && (
          <button onClick={() => openMap(displayName)} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3.5 text-[14px] font-medium text-text-secondary hover:border-accent-border hover:text-accent">
            <MapPin className="h-4 w-4" />Open map
          </button>
        )}
      </div>

      {kind === "place" && <div className="mt-5"><PlaceMap name={displayName} /></div>}
      {err && <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[13px] text-red-600">{err}</div>}
      {!d && !err && <div className="flex items-center gap-2 py-8 text-[14px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" />Reading your vault</div>}
      {d && (
        <>
          <Section title="In your vault">
            {d.found && d.digest
              ? <div className="text-[15px] leading-relaxed text-text-primary"><Markdown source={d.digest} /></div>
              : <p className="text-[14px] text-text-muted">{!hasPage ? "Not in your vault yet. Save it, or add a note, to give it a page."
                  : d.saved || d.conversations >= 3 ? "No summary yet. It is written on the next refresh."
                  : "No summary yet. One is written once it comes up in 3 conversations, or when you save it."}</p>}
            <label className="mt-4 block text-[14px] font-medium text-text-secondary" htmlFor="entity-notes">Your notes</label>
            <textarea id="entity-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Anything you want remembered. Only you write here."
              className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-text-primary outline-none focus:border-accent-border" />
            <div className="mt-2 flex items-center gap-2">
              <button onClick={saveNotes} disabled={!notesDirty || busy !== null} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-50">
                {busy === "notes" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save notes
              </button>
              {savedNote && <span className="min-w-0 truncate text-[13px] text-accent">Saved to {d.page_path}</span>}
            </div>
          </Section>
          <Section title="Your conversations">
            {threads && threads.length > 0 ? (
              <ul className="-mx-2" data-testid="entity-conversations">
                {threads.slice(0, 20).map((t) => (
                  <li key={t.slug}>
                    <button type="button" onClick={() => setChat({ thread: t.slug })} data-testid="entity-conversation"
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-warm">
                      <MessageSquare className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-text-primary">{t.title || "Untitled"}</span>
                      <span className="shrink-0 text-[12px] text-text-muted">{t.turns} {t.turns === 1 ? "turn" : "turns"} · {fmtDay(t.updated)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[14px] text-text-muted">{threads ? "No conversations yet. Start one with Chat." : "Reading your conversations"}</p>}
          </Section>
          <Section title="Mentioned in">
            {d.found && d.mentions.length
              ? <ul className="-mx-2">{d.mentions.slice(0, 40).map((m, i) => <MentionRow key={`${m.source}:${m.ref}:${i}`} m={m} />)}</ul>
              : <p className="text-[14px] text-text-muted">No conversations mention it yet.</p>}
          </Section>
          {d.found && d.co_mentions.length > 0 && (
            <Section title="Often mentioned with">
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-[15px]">
                {d.co_mentions.filter((c) => CARD_KINDS.has(c.kind)).slice(0, 8).map((c) => (
                  <EntityChip key={c.id} entity={{ kind: c.kind, value: c.id.slice(c.id.indexOf("/") + 1) }}>{c.name}</EntityChip>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
