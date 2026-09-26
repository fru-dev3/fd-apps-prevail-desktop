// Mirror > Projects > Restart. What a newer model needs to redo a project
// properly, from `prevail projects restart`: the goal, the requirements (said
// by you or inferred), the rules you already had to give, decisions, dead ends
// and open questions. Untick anything that should not carry over, then copy
// the handoff prompt. "Check a rebuild" compares a folder against it.
import { useEffect, useMemo, useState } from "react";
import { Check, ClipboardCopy, FolderSearch, HelpCircle, Loader2, RotateCcw, X } from "lucide-react";
import { invoke, isBrowser } from "./bridge";
import { modelName } from "./projectsview";

export interface RestartDoc {
  slug: string; title: string; goal: string;
  requirements: { text: string; source: "you" | "inferred" }[];
  rules: string[]; decisions: string[]; dead_ends: string[]; open_questions: string[];
  brief_model?: string;
}
export interface DiffDoc { met: string[]; missed: string[]; unclear: string[] }

function CopyBtn({ label, get, primary, big }: { label: string; get: () => Promise<string>; primary?: boolean; big?: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "err">("idle");
  return (
    <button
      onClick={async () => {
        setState("busy");
        try { await navigator.clipboard.writeText(await get()); setState("done"); setTimeout(() => setState("idle"), 1800); }
        catch { setState("err"); setTimeout(() => setState("idle"), 2500); }
      }}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors ${big ? "h-12 w-full px-5 text-[15px]" : "h-10 px-4 text-[14px]"} ${primary ? "bg-accent text-background hover:bg-accent-hover" : "border border-border bg-background text-text-secondary hover:border-accent-border hover:text-accent"}`}
    >
      {state === "busy" ? <Loader2 className="h-4 w-4 animate-spin" /> : state === "done" ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
      {state === "done" ? "Copied" : state === "err" ? "Could not copy" : label}
    </button>
  );
}

type Row = { text: string; tag?: "you" | "inferred" };

function Section({ title, rows, excluded, toggle, readOnly }: { title: string; rows: Row[]; excluded: Set<string>; toggle: (t: string) => void; readOnly: boolean }) {
  if (!rows.length) return null;
  return (
    <section className="mt-5">
      <h4 className="mb-2 text-[16px] font-semibold text-text-primary">{title}</h4>
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const off = excluded.has(r.text);
          return (
            <li key={r.text}>
              <label className={`flex items-start gap-3 rounded-lg border border-border-subtle bg-background px-3 py-2.5 ${readOnly ? "" : "cursor-pointer hover:border-accent-border"}`}>
                {!readOnly && (
                  <input type="checkbox" checked={!off} onChange={() => toggle(r.text)} aria-label={`Include: ${r.text}`}
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]" />
                )}
                <span className={`min-w-0 flex-1 text-[15px] leading-snug ${off ? "text-text-muted line-through" : "text-text-primary"}`}>{r.text}</span>
                {r.tag && (
                  <span className={`shrink-0 rounded-md px-1.5 py-px text-[12px] font-medium ${r.tag === "you" ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"}`}>
                    {r.tag === "you" ? "you" : "inferred"}
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RebuildCheck({ vaultPath, slug }: { vaultPath: string; slug: string }) {
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<DiffDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pick = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const p = await open({ directory: true, multiple: false });
      if (typeof p === "string") setFolder(p);
    } catch { /* no native picker: type the path */ }
  };
  const run = async () => {
    setBusy(true); setErr(null);
    try { setDiff(await invoke<DiffDoc>("projects_diff", { vault: vaultPath, slug, against: folder.trim() })); }
    catch (e) { setErr(String(e)); setDiff(null); }
    finally { setBusy(false); }
  };
  const cols: { key: keyof DiffDoc; label: string; icon: typeof Check; tone: string }[] = [
    { key: "met", label: "Met", icon: Check, tone: "text-accent" },
    { key: "missed", label: "Missed", icon: X, tone: "text-err" },
    { key: "unclear", label: "Unclear", icon: HelpCircle, tone: "text-text-muted" },
  ];
  return (
    <section className="mt-6 rounded-xl border border-border-subtle bg-surface p-5" data-testid="rebuild-check">
      <h3 className="flex items-center gap-2 font-display text-xl font-semibold text-text-primary"><FolderSearch className="h-5 w-5 text-accent" />Check a rebuild</h3>
      <p className="mt-1 text-[14px] text-text-secondary">Point at the folder a model built from this brief. Prevail reads it and says which requirements it met. The folder is only read.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="/path/to/rebuild" aria-label="Rebuild folder"
          className="h-10 min-w-0 flex-1 basis-60 rounded-lg border border-border bg-background px-3 text-[14px] text-text-primary focus:border-accent-border focus:outline-none" />
        {!isBrowser() && <button onClick={() => void pick()} className="inline-flex h-10 items-center rounded-lg border border-border bg-background px-4 text-[14px] text-text-secondary hover:border-accent-border hover:text-accent">Choose folder</button>}
        <button onClick={() => void run()} disabled={busy || !folder.trim()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-[14px] font-medium text-background hover:bg-accent-hover disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? "Checking" : "Check"}
        </button>
      </div>
      {err && <div className="mt-2 text-[13px] text-err">{err}</div>}
      {diff && (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {cols.map(({ key, label, icon: Icon, tone }) => (
            <div key={key} className="rounded-lg border border-border-subtle bg-background p-3" data-testid={`diff-${key}`}>
              <div className={`mb-2 flex items-center gap-1.5 text-[15px] font-semibold ${tone}`}><Icon className="h-4 w-4" />{label} <span className="tabular-nums">{(diff[key] ?? []).length}</span></div>
              <ul className="space-y-1.5 text-[14px] leading-snug text-text-secondary">
                {(diff[key] ?? []).map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function RestartEditor({ vaultPath, slug, phone }: { vaultPath: string; slug: string; phone: boolean }) {
  const [doc, setDoc] = useState<RestartDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    setDoc(null); setErr(null); setExcluded(new Set());
    invoke<RestartDoc>("projects_restart", { vault: vaultPath, slug })
      .then((d) => { if (alive) setDoc(d); })
      .catch((e) => { if (alive) setErr(String(e)); });
    return () => { alive = false; };
  }, [vaultPath, slug]);
  const toggle = (t: string) => setExcluded((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const exclude = useMemo(() => [...excluded], [excluded]);
  const text = (format: "handoff" | "intent" | "raw") => () =>
    invoke<string>("projects_restart_text", { vault: vaultPath, slug, format, exclude: exclude.length ? exclude : null });

  const sections: { title: string; rows: Row[] }[] = doc ? [
    { title: "Goal", rows: doc.goal ? [{ text: doc.goal }] : [] },
    { title: "Requirements", rows: (doc.requirements ?? []).map((r) => ({ text: r.text, tag: r.source })) },
    { title: "Rules you already had to give", rows: (doc.rules ?? []).map((text) => ({ text })) },
    { title: "Decisions", rows: (doc.decisions ?? []).map((text) => ({ text })) },
    { title: "Dead ends", rows: (doc.dead_ends ?? []).map((text) => ({ text })) },
    { title: "Open questions", rows: (doc.open_questions ?? []).map((text) => ({ text })) },
  ] : [];

  return (
    <>
      <section className="mt-6 rounded-xl border border-accent-border bg-accent-soft/30 p-5" data-testid="restart">
        <h3 className="flex items-center gap-2 font-display text-2xl font-semibold text-text-primary"><RotateCcw className="h-5 w-5 text-accent" />Restart</h3>
        <p className="mt-1 text-[14px] leading-snug text-text-secondary">
          Everything a newer model needs to do this properly, without the back-and-forth.{!phone && " Untick what should not carry over."}
          {doc?.brief_model ? ` Distilled by ${modelName(doc.brief_model)}.` : ""}
        </p>
        <div className={`mt-4 flex flex-wrap gap-2 ${phone ? "" : ""}`}>
          <CopyBtn primary big={phone} label="Copy restart brief" get={text("handoff")} />
          {!phone && <CopyBtn label="Copy intent" get={text("intent")} />}
          {!phone && <CopyBtn label="Copy raw prompts" get={text("raw")} />}
        </div>
        {err && <div className="mt-3 text-[13px] text-err">{err}</div>}
        {!doc && !err && <div className="mt-4 flex items-center gap-2 text-[14px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" />Reading the project</div>}
        {sections.map((s) => <Section key={s.title} title={s.title} rows={s.rows} excluded={excluded} toggle={toggle} readOnly={phone} />)}
      </section>
      {!phone && <RebuildCheck vaultPath={vaultPath} slug={slug} />}
    </>
  );
}
