// Group chat (ux ask 5, 2026-10-02): a thread can have several specialists as
// members. Each reply records, when it is written, who spoke, who was in the
// thread, the scope and the context it used (stored with the turn, so it
// survives later membership changes), and shows that in one quiet line: the
// speaker's face and name, a tiny stack of member faces, the scope and "+N
// context", with the full list on hover. Joins and leaves are one muted line
// in the transcript.
import { useState } from "react";
import { UserMinus, X } from "lucide-react";
import { ChiefAvatar, SpecialistAvatar } from "./specialistavatar";
import { titleCase } from "./format";

export interface TurnMeta {
  /** "chief" or a specialist id. */
  speaker: string;
  /** The speaker's name when the reply was written. */
  name?: string;
  members?: string[];
  /** The scope's display name: a domain, a project, an entity, or General. */
  scope?: string;
  /** What came along on the turn: apps, people, domains, files. */
  context?: string[];
  /** The model behind the reply (shown on hover only). */
  model?: string;
}

const ID = /^[a-z][a-z0-9-]{0,40}$/;
export const memberName = (id: string) => titleCase(id);

/** A turn's metadata from the thread file (a JSON string), or undefined. */
export function decodeTurnMeta(raw: string | null | undefined): TurnMeta | undefined {
  if (!raw) return undefined;
  try {
    const m = JSON.parse(raw) as TurnMeta;
    if (!m || typeof m.speaker !== "string") return undefined;
    return {
      speaker: m.speaker, ...(typeof m.name === "string" ? { name: m.name } : {}),
      ...(Array.isArray(m.members) ? { members: m.members.filter((x) => typeof x === "string" && ID.test(x)) } : {}),
      ...(typeof m.scope === "string" ? { scope: m.scope } : {}),
      ...(Array.isArray(m.context) ? { context: m.context.filter((x) => typeof x === "string").slice(0, 40) } : {}),
      ...(typeof m.model === "string" ? { model: m.model } : {}),
    };
  } catch { return undefined; }
}

/** One join or leave: `+researcher@3` (joined before message 3), `-planner@6`. */
export interface MemberMark { id: string; joined: boolean; at: number }
export function parseMemberLog(log: string | null | undefined): MemberMark[] {
  return (log ?? "").split(";").map((p) => /^([+-])([a-z][a-z0-9-]{0,40})@(\d+)$/.exec(p.trim())).filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ id: m[2], joined: m[1] === "+", at: Number(m[3]) }));
}
export function appendMemberLog(log: string, id: string, joined: boolean, at: number): string {
  const marks = parseMemberLog(log);
  // A join and a leave before the same message cancel out.
  const last = marks[marks.length - 1];
  if (last && last.id === id && last.at === at && last.joined !== joined) return marks.slice(0, -1).map(markText).join(";");
  return [...marks, { id, joined, at }].map(markText).join(";");
}
const markText = (m: MemberMark) => `${m.joined ? "+" : "-"}${m.id}@${m.at}`;

export function SpeakerFace({ id, size = 28, working = false }: { id: string; size?: number; working?: boolean }) {
  return id === "chief" ? <ChiefAvatar size={size} state={working ? "working" : "idle"} /> : <SpecialistAvatar id={id} size={size} state={working ? "working" : "idle"} />;
}

/** Overlapping faces, at most four, then "+N". */
export function FaceStack({ ids, size = 16 }: { ids: string[]; size?: number }) {
  const shown = ids.slice(0, 4);
  return (
    <span className="inline-flex items-center" aria-hidden>
      {shown.map((id, i) => (
        <span key={id} className="inline-flex rounded-full ring-2 ring-surface" style={{ marginLeft: i ? -size * 0.3 : 0 }}><SpecialistAvatar id={id} size={size} /></span>
      ))}
      {ids.length > shown.length && <span className="ml-1 text-[12px] text-text-muted">+{ids.length - shown.length}</span>}
    </span>
  );
}

/**
 * The reply's quiet meta line: members, scope, "+N context". Hover (or focus)
 * opens the full list in place; nothing slides in from the side.
 */
export function ReplyMetaLine({ meta, phone }: { meta: TurnMeta; phone?: boolean }) {
  const members = (meta.members ?? []).filter((m) => m !== meta.speaker);
  const ctx = meta.context ?? [];
  if (!members.length && !meta.scope && !ctx.length && !meta.model) return null;
  return (
    <span data-testid="reply-meta" tabIndex={0} className="group/meta relative inline-flex min-w-0 items-center gap-1.5 rounded text-[12px] text-text-muted outline-none focus-visible:ring-2 focus-visible:ring-accent-border">
      {members.length > 0 && <FaceStack ids={members} size={phone ? 14 : 16} />}
      {meta.scope && <span className="truncate">{members.length ? "· " : ""}{meta.scope}</span>}
      {ctx.length > 0 && <span className="whitespace-nowrap">· +{ctx.length} context</span>}
      <span role="tooltip" data-testid="reply-meta-full" className="pointer-events-none invisible absolute left-0 top-full z-30 mt-1 w-64 max-w-[80vw] rounded-lg border border-border bg-surface p-3 text-[12px] leading-relaxed text-text-secondary opacity-0 shadow-[0_6px_20px_-6px_rgb(0_0_0/0.25)] transition-opacity duration-150 group-hover/meta:visible group-hover/meta:opacity-100 group-focus/meta:visible group-focus/meta:opacity-100">
        <MetaRow label="Spoke">{meta.name ?? memberName(meta.speaker)}</MetaRow>
        {(meta.members ?? []).length > 0 && <MetaRow label="In the chat">{(meta.members ?? []).map(memberName).join(", ")}</MetaRow>}
        {meta.scope && <MetaRow label="Scope">{meta.scope}</MetaRow>}
        {ctx.length > 0 && <MetaRow label="Context">{ctx.join(", ")}</MetaRow>}
        {meta.model && <MetaRow label="Model">{meta.model}</MetaRow>}
      </span>
    </span>
  );
}
function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <span className="block"><span className="text-text-muted">{label}: </span><span className="text-text-primary">{children}</span></span>;
}

/** "Researcher joined", one muted line in the transcript. */
export function MemberMarker({ m }: { m: MemberMark }) {
  return (
    <div data-testid="member-marker" className="mx-auto mb-6 flex w-full max-w-3xl items-center gap-2 px-4 text-[12px] text-text-muted">
      <span className="h-px flex-1 bg-border-subtle" />
      <SpecialistAvatar id={m.id} size={14} />
      <span>{memberName(m.id)} {m.joined ? "joined" : "left"}</span>
      <span className="h-px flex-1 bg-border-subtle" />
    </div>
  );
}

/**
 * The chat's members, in its header: a face stack that opens a short list
 * in place, each with a remove button, and "Just you" to clear them all.
 */
export function MemberBar({ members, onRemove, onClear }: { members: string[]; onRemove: (id: string) => void; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  if (!members.length) return null;
  return (
    <div className="relative shrink-0" data-testid="chat-members">
      <button
        type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        title={`In this chat: ${members.map(memberName).join(", ")}`}
        className="inline-flex h-7 items-center gap-1.5 rounded-full px-1.5 text-[12px] text-text-secondary transition-colors hover:bg-surface-warm hover:text-text-primary"
      >
        <FaceStack ids={members} size={20} />
        <span className="hidden sm:inline">{members.length === 1 ? memberName(members[0]) : `${members.length} members`}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-56 rounded-lg border border-border bg-surface p-1 shadow-[0_8px_24px_-8px_rgb(0_0_0/0.3)]">
          {members.map((id) => (
            <div key={id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-text-primary hover:bg-surface-warm">
              <SpecialistAvatar id={id} size={20} />
              <span className="flex-1 truncate">{memberName(id)}</span>
              <button type="button" data-testid={`member-remove-${id}`} onClick={() => onRemove(id)} title={`Remove ${memberName(id)} from this chat`} aria-label={`Remove ${memberName(id)}`}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-surface hover:text-text-primary">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button type="button" data-testid="members-clear" onClick={() => { onClear(); setOpen(false); }}
            className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-border-subtle px-2 py-1.5 text-left text-[13px] text-text-secondary hover:bg-surface-warm hover:text-text-primary">
            <UserMinus className="h-3.5 w-3.5" /> Just you
          </button>
        </div>
      )}
    </div>
  );
}
