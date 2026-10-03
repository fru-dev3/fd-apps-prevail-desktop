// Compass lines (owner feedback round 1, 2026-10-02): every line is a row you
// can open, edit in place, chat with, and (when drafted) confirm or drop.
// Groups are shown by indentation and one thin vertical line under a small
// header, never by big headings or cards.
//   Group     a small header and its rows, indented behind a thin line
//   LineRow   one line: click opens it (its details and its history), the one
//             primary action shows on hover (Confirm while proposed, else
//             Chat), everything else is in the row menu
//   AddLine   "Add a value": a quiet link that turns into one input
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, Check, Loader2, MessageSquare, Pencil, Plus, Trash2, X } from "lucide-react";
import { META, ROW_TITLE } from "./typescale";
import { REVEAL, RowMenu, type RowMenuItem } from "./ui";
import { changeText, type LedgerRow } from "./compassmodel";

const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";
const fmtDay = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });

export function Group({ title, count, action, children, testId }: { title: string; count?: number; action?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="mt-5 first:mt-0" data-testid={testId ?? "compass-group"}>
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-text-secondary">{title}</h3>
        {count !== undefined && count > 0 && <span className="text-[12px] tabular-nums text-text-muted">{count}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      <div className="ml-[5px] mt-1 border-l border-border-subtle pl-4" data-testid="compass-group-body">{children}</div>
    </section>
  );
}

/** One line's history, newest first: what changed, before and after, when. */
export function LineHistory({ rows }: { rows: LedgerRow[] }) {
  if (!rows.length) return null;
  return (
    <ul className="mt-2 space-y-0.5" data-testid="line-history">
      {rows.slice(0, 12).map((l, i) => {
        const c = changeText(l);
        return (
          <li key={i} className={`${META} flex flex-wrap gap-x-1.5`}>
            <span className="text-text-secondary">{c.what}</span>
            {c.before && <span className="line-through decoration-text-muted/60" title={c.before}>{c.before.length > 80 ? `${c.before.slice(0, 77)}...` : c.before}</span>}
            {c.before && c.after && <span aria-hidden>to</span>}
            {c.after && c.what !== "Added" && <span title={c.after}>{c.after.length > 80 ? `${c.after.slice(0, 77)}...` : c.after}</span>}
            <span aria-hidden>·</span><span>{fmtDay(l.ts)}</span>
            {l.by && l.by !== "user" && <><span aria-hidden>·</span><span>by {l.by === "bootstrap" ? "the draft" : l.by}</span></>}
          </li>
        );
      })}
    </ul>
  );
}

export interface LineActions {
  onSave?: (text: string) => Promise<void> | void;
  onConfirm?: () => void;
  onDrop?: () => void;
  onChat?: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
  more?: RowMenuItem[];
}

export function LineRow({ id, title, display, meta, lead, proposed, archived, busy, multiline, history, startEditing, children, testId = "compass-item", plain = false, ...a }: LineActions & {
  plain?: boolean; id: string; title: string; display?: ReactNode; meta?: ReactNode; lead?: string; proposed?: boolean; archived?: boolean; busy?: boolean; multiline?: boolean;
  history?: LedgerRow[]; startEditing?: boolean; children?: ReactNode; testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(!!startEditing);
  const [draft, setDraft] = useState(title);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => { if (editing) { setDraft(title); requestAnimationFrame(() => ref.current?.focus()); } }, [editing, title]);
  const save = async () => { const t = draft.trim(); setEditing(false); if (t && t !== title) await a.onSave?.(t); };
  const menu: RowMenuItem[] = [
    ...(a.onChat && proposed ? [{ icon: MessageSquare, label: "Chat about it", onClick: a.onChat }] : []),
    ...(a.onSave ? [{ icon: Pencil, label: "Edit", onClick: () => setEditing(true) }] : []),
    ...(a.onDrop ? [{ icon: X, label: "Not mine", hint: "Leave this line out", onClick: a.onDrop }] : []),
    ...(a.more ?? []),
    ...(a.onArchive && !archived ? [{ icon: Archive, label: "Archive", hint: "Out of every chat, kept here", onClick: a.onArchive }] : []),
    ...(a.onRestore && archived ? [{ icon: ArchiveRestore, label: "Bring back", onClick: a.onRestore }] : []),
    ...(a.onDelete ? [{ icon: Trash2, label: "Delete", danger: true, onClick: a.onDelete }] : []),
  ];
  // In the Chain view a line sits inside the tree's own list item.
  const Tag = plain ? "div" : "li";
  const field = "w-full min-w-0 rounded-md border border-accent-border bg-background px-2 py-1 text-[15px] leading-snug text-text-primary focus:outline-none";
  return (
    <Tag data-testid={testId} data-id={id} className={`group ${plain ? "py-0.5" : "border-b border-border-subtle py-2 last:border-b-0"}`}>
      <div className="flex items-start gap-3">
        {lead && <span className="w-4 shrink-0 pt-0.5 text-right text-[13px] tabular-nums text-text-muted">{lead}</span>}
        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex items-start gap-1.5" data-testid="line-edit">
              {multiline
                ? <textarea ref={ref} value={draft} rows={3} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save(); }} aria-label={`Edit ${title || "this line"}`} className={`${field} resize-y`} />
                : <input ref={ref} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }} aria-label={`Edit ${title || "this line"}`} className={field} />}
              <button type="submit" title="Save" aria-label="Save" data-testid="line-save" className={iconBtn}><Check className="h-4 w-4" /></button>
              <button type="button" onClick={() => setEditing(false)} title="Cancel" aria-label="Cancel" className={iconBtn}><X className="h-4 w-4" /></button>
            </form>
          ) : (
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="line-open"
              className={`block w-full text-left ${ROW_TITLE} ${archived ? "text-text-muted" : ""} line-clamp-2 break-words hover:text-accent`} title={title}>
              {display ?? title}
            </button>
          )}
          {meta && !editing && <div className={`${META} mt-0.5 leading-relaxed`}>{meta}</div>}
          {open && !editing && (
            <div className="mt-1.5" data-testid="line-detail">
              {children}
              <LineHistory rows={history ?? []} />
            </div>
          )}
        </div>
        {!editing && (
          <span className={`flex shrink-0 items-center gap-0.5 ${REVEAL}`}>
            {busy ? <Loader2 className="m-2 h-4 w-4 animate-spin text-text-muted" />
              : proposed && a.onConfirm ? <button type="button" onClick={a.onConfirm} title="Confirm" aria-label={`Confirm ${title}`} data-testid="compass-confirm" className={iconBtn}><Check className="h-4 w-4" /></button>
              : a.onChat ? <button type="button" onClick={a.onChat} title="Chat about it" aria-label={`Chat about ${title}`} data-testid="line-chat" className={iconBtn}><MessageSquare className="h-4 w-4" /></button>
              : null}
            {menu.length > 0 && <RowMenu items={menu} label={`More for ${title}`} />}
          </span>
        )}
      </div>
    </Tag>
  );
}

/** Join meta bits with middle dots. */
export function Meta({ bits }: { bits: ReactNode[] }) {
  const xs = bits.filter(Boolean);
  // Plain inline text, so a long line wraps like a sentence (no stray dots at line starts).
  return <>{xs.map((b, i) => <span key={i}>{i > 0 && <span aria-hidden className="px-1.5">·</span>}{b}</span>)}</>;
}

export function AddLine({ label, onAdd, testId = "compass-add" }: { label: string; onAdd: (text: string) => Promise<void> | void; testId?: string }) {
  const [on, setOn] = useState(false);
  const [text, setText] = useState("");
  if (!on) return (
    <button type="button" onClick={() => setOn(true)} data-testid={testId} className="mt-1.5 inline-flex items-center gap-1 py-1 text-[13px] text-text-muted hover:text-accent">
      <Plus className="h-3.5 w-3.5" /> {label}
    </button>
  );
  return (
    <form className="mt-1.5 flex items-center gap-1.5" data-testid={`${testId}-form`} onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t) { void onAdd(t); setText(""); setOn(false); } }}>
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setOn(false); }} aria-label={label} placeholder={label}
        className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-[14px] text-text-primary focus:border-accent-border focus:outline-none" />
      <button type="submit" disabled={!text.trim()} title="Add" aria-label="Add" className={iconBtn}><Check className="h-4 w-4" /></button>
    </form>
  );
}
