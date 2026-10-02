// The mission (ideal-state.md), easy to edit: click any section to edit just
// that section in place (Esc cancels, Cmd-Enter saves), or Edit all. Every
// save keeps the previous full text as a dated version (the backend does it,
// see idealstate.rs); the Versions tab lists them, newest first, and Restore
// saves an old text as a new latest version. Nothing is ever deleted.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, FilePen, Pencil, RotateCcw, X } from "lucide-react";
import { invoke } from "./bridge";
import { invokeCached, invokeKey, peekInvoke, setQueryData } from "./query";
import { Markdown } from "./Markdown";
import { SpineTabs } from "./sidespine";
import { BODY, DETAIL_TITLE, META } from "./typescale";

type Version = { name: string; path: string; ts?: number };
const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent";
const inputCls = "w-full resize-y rounded-lg border border-accent-border bg-background px-3 py-2 text-[14px] leading-normal text-text-primary focus:outline-none";

/** Split the document into an intro and one block per `## ` section. Joining
 *  the blocks with "\n" gives the document back exactly. */
export function missionBlocks(md: string): { heading: string | null; raw: string }[] {
  const lines = md.split("\n");
  const out: { heading: string | null; raw: string[] }[] = [{ heading: null, raw: [] }];
  for (const line of lines) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h) out.push({ heading: h[1].trim(), raw: [line] });
    else out[out.length - 1].raw.push(line);
  }
  return out.map((b) => ({ heading: b.heading, raw: b.raw.join("\n") })).filter((b, i) => i > 0 || b.raw.trim() !== "");
}
const joinBlocks = (blocks: { raw: string }[]) => blocks.map((b) => b.raw.replace(/\n+$/, "")).join("\n\n") + "\n";

/** A one-line account of what changed between two texts. */
export function changeSummary(prev: string, next: string): string {
  const a = new Map(missionBlocks(prev).map((b) => [b.heading ?? "Intro", b.raw.trim()]));
  const b = new Map(missionBlocks(next).map((x) => [x.heading ?? "Intro", x.raw.trim()]));
  const changed = [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k));
  // Name the sections when the document has any; else count words.
  if (b.size > 1 && changed.length > 0 && changed.length <= 3) return `Changed ${changed.join(", ")}`;
  const words = (s: string) => (s.match(/\S+/g) ?? []).length;
  const d = words(next) - words(prev);
  return d === 0 ? "Reworded" : `${d > 0 ? "+" : ""}${d} words`;
}

// "2026-09-27T14-05-03Z" or the older "2026-09-27_140503" to a local date and time.
function versionWhen(v: Version): string {
  const m = /(\d{4})-(\d{2})-(\d{2})[T_](\d{2})-?(\d{2})-?(\d{2})/.exec(v.name);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date(v.ts ?? 0);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function MissionEditor({ vaultPath, title = "Your constitution" }: { vaultPath: string; title?: string }) {
  const [body, setBody] = useState<string | null>(() => {
    const c = peekInvoke<string>("read_ideal_state", { vault: vaultPath });
    return c === undefined ? null : c || "";
  });
  const [tab, setTab] = useState<"current" | "versions">("current");
  const [editing, setEditing] = useState<number | "all" | null>(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string>("latest");

  const loadVersions = useCallback(async () => {
    const list = await invoke<Version[]>("ideal_state_versions", { vault: vaultPath }).catch(() => []);
    setVersions(Array.isArray(list) ? list : []);
  }, [vaultPath]);
  useEffect(() => {
    invokeCached<string>("read_ideal_state", { vault: vaultPath }, { force: true }).then((s) => setBody(s || "")).catch(() => setBody(""));
    void loadVersions();
  }, [vaultPath, loadVersions]);
  // Version texts, read when the Versions tab is open (for the summaries).
  useEffect(() => {
    if (tab !== "versions") return;
    let alive = true;
    void (async () => {
      const next: Record<string, string> = {};
      for (const v of versions.slice(0, 60)) {
        if (texts[v.path] !== undefined) { next[v.path] = texts[v.path]; continue; }
        next[v.path] = await invoke<string>("ideal_state_version_read", { vault: vaultPath, path: v.path }).catch(() => "");
      }
      if (alive) setTexts(next);
    })();
    return () => { alive = false; };
  }, [tab, versions]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocks = useMemo(() => missionBlocks(body ?? ""), [body]);
  const save = async (next: string) => {
    setErr(null);
    try {
      await invoke("write_ideal_state", { vault: vaultPath, body: next });
      setBody(next);
      setQueryData(invokeKey("read_ideal_state", { vault: vaultPath }), next);
      setEditing(null);
      await loadVersions();
    } catch (e) { setErr(`Could not save: ${String(e)}`); }
  };
  const startEdit = (i: number | "all") => { setEditing(i); setDraft(i === "all" ? body ?? "" : blocks[i].raw); };
  const commit = () => {
    if (editing === "all") return void save(draft);
    if (typeof editing === "number") return void save(joinBlocks(blocks.map((b, i) => (i === editing ? { raw: draft } : b))));
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
  };
  const editor = (
    <div data-testid="mission-editor" className="rounded-lg border border-accent-border bg-surface p-2">
      <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={keys}
        rows={editing === "all" ? 20 : Math.min(18, Math.max(4, draft.split("\n").length + 1))} aria-label="Edit the constitution" className={inputCls} />
      <div className="mt-1 flex items-center justify-end gap-1">
        <span className={`${META} mr-auto`}>Cmd-Enter saves, Esc cancels. The old text is kept as a version.</span>
        <button onClick={commit} title="Save" aria-label="Save" data-testid="mission-save" className={iconBtn}><Check className="h-4 w-4" /></button>
        <button onClick={() => setEditing(null)} title="Cancel" aria-label="Cancel" className={iconBtn}><X className="h-4 w-4" /></button>
      </div>
    </div>
  );

  // Versions: the current text first ("Latest"), then each kept version.
  const rows = [{ key: "latest", when: "Current text", text: body ?? "", latest: true }, ...versions.map((v) => ({ key: v.path, when: versionWhen(v), text: texts[v.path], latest: false }))];
  const pickedRow = rows.find((r) => r.key === picked) ?? rows[0];

  return (
    <section data-testid="mission-editor-page">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className={`${DETAIL_TITLE} min-w-0 flex-1`}>{title}</h2>
        <SpineTabs label="Constitution view" value={tab} onChange={(t) => { setTab(t); setEditing(null); }}
          tabs={[{ id: "current", label: "Current" }, { id: "versions", label: "Versions", count: versions.length + 1 }]} />
        {tab === "current" && editing === null && (
          <button onClick={() => startEdit("all")} title="Edit all" aria-label="Edit all" data-testid="mission-edit-all" className={iconBtn}><FilePen className="h-4 w-4" /></button>
        )}
      </div>
      {err && <p className="mb-3 text-[13px] text-err">{err}</p>}
      {body === null && <p className={META}>Reading your constitution</p>}
      {body !== null && tab === "current" && (
        editing === "all" ? editor : (
          <div className="max-w-3xl space-y-1">
            {blocks.length === 0 && <button onClick={() => startEdit("all")} className={`${BODY} text-text-muted hover:text-accent`}>Nothing written yet. Click to start.</button>}
            {blocks.map((b, i) => editing === i ? <div key={i}>{editor}</div> : (
              <div key={i} role="button" tabIndex={0} data-testid="mission-section" data-heading={b.heading ?? ""}
                onClick={() => startEdit(i)} onKeyDown={(e) => { if (e.key === "Enter") startEdit(i); }}
                title="Click to edit this section"
                className="group relative cursor-text rounded-lg px-3 py-2 transition-colors hover:bg-surface-warm/60">
                <Pencil className="absolute right-2 top-2 h-4 w-4 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                <div className={`${BODY} text-text-primary`}><Markdown source={b.raw} /></div>
              </div>
            ))}
          </div>
        )
      )}
      {body !== null && tab === "versions" && (
        <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          <ul className="space-y-0.5" data-testid="mission-versions">
            {rows.map((r, i) => {
              const older = rows[i + 1]?.text;
              const summary = r.text !== undefined && older !== undefined ? changeSummary(older, r.text) : i === rows.length - 1 ? "Oldest kept" : "";
              const on = r.key === pickedRow.key;
              return (
                <li key={r.key}>
                  <button onClick={() => setPicked(r.key)} data-testid="version-row" aria-current={on ? "true" : undefined}
                    className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
                    <span className="flex items-center gap-2">
                      <span className={`min-w-0 flex-1 truncate text-[14px] ${on ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{r.when}</span>
                      {r.latest && <span data-testid="version-latest" className="shrink-0 text-[12px] font-medium text-accent">Latest</span>}
                    </span>
                    {summary && <span className="block truncate text-[12px] text-text-muted">{summary}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div data-testid="version-detail" className="min-w-0">
            {!pickedRow.latest && (
              <div className="mb-3 flex items-center gap-2">
                <span className={`${META} flex-1`}>Read only. Restore saves it as the new latest version; the current text is kept too.</span>
                <button onClick={() => { if (pickedRow.text !== undefined) { void save(pickedRow.text).then(() => setPicked("latest")); } }}
                  disabled={pickedRow.text === undefined} data-testid="version-restore"
                  className="inline-flex h-8 items-center gap-1 text-[13px] font-medium text-accent hover:underline disabled:opacity-50">
                  <RotateCcw className="h-3.5 w-3.5" />Restore
                </button>
              </div>
            )}
            <div className={`${BODY} max-w-3xl text-text-primary`}>{pickedRow.text === undefined ? <span className="text-text-muted">Reading this version</span> : <Markdown source={pickedRow.text} />}</div>
          </div>
        </div>
      )}
    </section>
  );
}
