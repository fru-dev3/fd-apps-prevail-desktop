// Notes / logs (Work mode → Notes). Phase 3 of the 2026 redesign: a place to
// brain-dump ideas and search them. Persisted as a single JSON document at
// <vault>/build/notes.json via the generic read_text_file / write_text_file commands
// (no new engine command needed). Autosaves shortly after you stop typing.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Plus, Search, Trash2 } from "lucide-react";
import { relTime } from "./format";
import { SettingsHeader } from "./sectionutil";
import { SideSpine } from "./sidespine";
import { useIsPhone } from "./useisphone";
import { RowAction } from "./rowaction";
import { loadNotes, newNoteId as newId, saveNotes, type Note } from "./notesstore";
import { toast } from "./toast";
import { EmptyState } from "./emptystate";

export function NotesPanel({ vaultPath }: { vaultPath: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const phone = useIsPhone();
  // On a phone the list shows first; a pick (or a new note) opens the editor.
  const [phonePicked, setPhonePicked] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Real save state so the footer never claims "Saved" when the write failed
  // (a locked vault / full disk would otherwise lose the note silently).
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  // Guards the autosave effect from writing the file back during the initial load.
  const hydrating = useRef(true);

  // Load on mount / vault change.
  useEffect(() => {
    let alive = true;
    hydrating.current = true;
    setLoaded(false);
    (async () => {
      const list = await loadNotes(vaultPath);
      if (!alive) return;
      setNotes(list);
      setSelectedId(list[0]?.id ?? null);
      setLoaded(true);
      hydrating.current = false;
    })();
    return () => { alive = false; };
  }, [vaultPath]);

  // Autosave: debounce writes after notes change (skip the hydration write).
  // saveNotes does NOT broadcast, so this never loops with the listener below.
  useEffect(() => {
    if (hydrating.current || !loaded) return;
    setSaveState("saving");
    const id = window.setTimeout(() => {
      saveNotes(vaultPath, notes)
        .then(() => setSaveState("saved"))
        .catch((e) => { console.error("notes save", e); setSaveState("error"); });
    }, 600);
    return () => window.clearTimeout(id);
  }, [notes, loaded, vaultPath]);

  // Pick up notes added elsewhere (the Quick Capture ribbon) so they appear here
  // AND so our autosave doesn't later overwrite the file without them. Preserve
  // the in-memory selected note (it may have unsaved edits).
  useEffect(() => {
    const onChanged = () => {
      if (hydrating.current) return;
      void loadNotes(vaultPath).then((list) => {
        setNotes((cur) => {
          const sel = cur.find((n) => n.id === selectedId);
          if (!sel) return list;
          return list.some((n) => n.id === sel.id) ? list.map((n) => (n.id === sel.id ? sel : n)) : [sel, ...list];
        });
      });
    };
    window.addEventListener("prevail:notes-changed", onChanged);
    return () => window.removeEventListener("prevail:notes-changed", onChanged);
  }, [vaultPath, selectedId]);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? notes.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)) : notes;
    return [...list].sort((a, b) => b.updated - a.updated);
  }, [notes, query]);

  const createNote = useCallback(() => {
    const n: Note = { id: newId(), title: "", body: "", updated: Date.now() };
    setNotes((cur) => [n, ...cur]);
    setSelectedId(n.id);
    setPhonePicked(true);
  }, []);

  const updateSelected = (patch: Partial<Pick<Note, "title" | "body">>) => {
    if (!selectedId) return;
    setNotes((cur) => cur.map((n) => (n.id === selectedId ? { ...n, ...patch, updated: Date.now() } : n)));
  };

  const deleteNote = (id: string) => {
    setNotes((cur) => {
      const idx = cur.findIndex((n) => n.id === id);
      if (idx < 0) return cur;
      const removed = cur[idx];
      const next = cur.filter((n) => n.id !== id);
      if (id === selectedId) setSelectedId(next[0]?.id ?? null);
      // F4: notes used to hard-delete with no recovery. Offer an immediate undo
      // that restores the note in its original position (autosave persists the
      // removal, so undo re-adds and re-saves).
      toast("Note deleted.", {
        action: {
          label: "Undo",
          onClick: () => setNotes((c) => (c.some((n) => n.id === removed.id) ? c : [...c.slice(0, idx), removed, ...c.slice(idx)])),
        },
      });
      return next;
    });
  };

  const titleOf = (n: Note) => n.title.trim() || (n.body.trim().split("\n")[0] || "Untitled note").slice(0, 60);

  return (
    <>
      <SettingsHeader
        title="Notes"
        icon={FileText}
        subtitle="Quick notes, searchable, saved to your vault."
        right={
          <button onClick={createNote} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:bg-accent-hover">
            <Plus className="h-4 w-4" /> New note
          </button>
        }
      />
      <SideSpine storageKey="prevail.notes.spine" title="Notes" label="notes" testId="notes-list"
        toolbar={
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search notes…"
                className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
              />
            </div>
        }
        phone={phone} phoneDetail={phone && phonePicked && !!selected} onBack={() => setPhonePicked(false)} backLabel="All notes"
        detail={
          <div className="flex h-full min-h-[60vh] flex-col px-8 py-6">
          {selected ? (
            <div className="flex h-full flex-col">
              <input
                value={selected.title}
                onChange={(e) => updateSelected({ title: e.target.value })}
                placeholder="Title"
                className="mb-2 w-full bg-transparent font-display text-2xl font-bold text-text-primary placeholder:text-text-muted/50 focus:outline-none"
              />
              <textarea
                value={selected.body}
                onChange={(e) => updateSelected({ body: e.target.value })}
                placeholder="Start writing… ideas, logs, brain-dumps."
                className="min-h-0 flex-1 resize-none bg-transparent text-[15px] leading-relaxed text-text-secondary placeholder:text-text-muted/50 focus:outline-none"
              />
              <div className={`mt-2 border-t border-border-subtle pt-2 text-[11px] ${saveState === "error" ? "text-err" : "text-text-muted"}`}>
                {saveState === "error"
                  ? "Not saved — check that your vault is unlocked, then edit again to retry"
                  : saveState === "saving"
                    ? "Saving…"
                    : `Saved to vault · updated ${relTime(selected.updated)}`}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center text-text-muted">
              <FileText className="mb-3 h-8 w-8 opacity-40" />
              <p className="text-sm">Select a note, or create one to start writing.</p>
            </div>
          )}
          </div>
        }>
          <ul className="p-2">
            {filtered.length === 0 ? (
              <li>
                {notes.length === 0 ? (
                  <EmptyState icon={FileText} title="No notes yet" body="Capture a thought here, or hit the global capture hotkey from anywhere." action={{ label: "New note", onClick: createNote }} />
                ) : (
                  <EmptyState icon={Search} title="No matches" body="No notes match your search." />
                )}
              </li>
            ) : filtered.map((n) => (
              <li key={n.id} className="group relative">
                <span className="absolute right-1.5 top-1.5 z-10 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
                  <RowAction icon={Trash2} label="Delete note" onClick={() => deleteNote(n.id)} />
                </span>
                <button
                  onClick={() => { setSelectedId(n.id); setPhonePicked(true); }}
                  className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 pr-9 text-left transition-colors ${
                    n.id === selectedId ? "bg-surface-warm" : "hover:bg-surface-warm/50"
                  }`}
                >
                  <FileText className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${n.id === selectedId ? "text-accent" : "text-text-muted"}`} />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className={`truncate text-[14px] ${n.id === selectedId ? "font-semibold text-text-primary" : "font-medium text-text-primary"}`}>{titleOf(n)}</span>
                    <span className="truncate text-[12px] text-text-muted">{relTime(n.updated)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
      </SideSpine>
    </>
  );
}
