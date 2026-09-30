// "File N unfiled conversations": the engine's filing plan, shown in place.
//
// Each row proposes a home and other domains; both are editable. "File" (per
// row) or "File all" writes ONLY the thread's `routed:` frontmatter through
// thread_set_filing: the conversation text is never changed and no file moves.

import { useMemo, useState } from "react";
import { FolderInput, Loader2, X } from "lucide-react";
import { titleCase } from "./format";
import { isUserDomain } from "./helpers";
import { useEngineQuery, useInvokeQuery } from "./query";
import { DomainMenu } from "./routechips";
import { readFilePlan, saveFiling, type Filing, type FilePlanRow } from "./routing";

export const THREADS_CHANGED = "prevail:threads-changed";

export function useFilePlan(vaultPath: string, enabled = true) {
  return useEngineQuery(enabled ? `engine_file_plan:${vaultPath}` : null, () => readFilePlan(vaultPath), { staleMs: 60_000, invalidateOn: [THREADS_CHANGED] });
}

// A row whose current home is a real domain keeps it; General rows take the
// engine's pick.
function proposed(r: FilePlanRow): Filing {
  const own = r.current_home && r.current_home !== "general" ? r.current_home : null;
  const home = own ?? r.primary ?? null;
  return { home, also: r.secondary.filter((d) => d !== home) };
}

export function FilingPlan({ vaultPath }: { vaultPath: string }) {
  const { data, loading } = useFilePlan(vaultPath);
  const scan = useInvokeQuery<{ name: string }[]>("scan_vault", { path: vaultPath });
  const domains = useMemo(
    () => (scan.data ?? []).map((d) => d.name.toLowerCase()).filter((n) => isUserDomain(n) && n !== "general"),
    [scan.data],
  );
  const [edits, setEdits] = useState<Record<string, Filing>>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = data?.rows ?? [];
  const pending = rows.filter((r) => !done.has(r.thread));
  const filingOfRow = (r: FilePlanRow) => edits[r.thread] ?? proposed(r);
  const edit = (r: FilePlanRow, f: Filing) => setEdits((e) => ({ ...e, [r.thread]: f }));

  const apply = async (list: FilePlanRow[]) => {
    setBusy(true);
    setError(null);
    const ok = new Set(done);
    for (const r of list) {
      const f = filingOfRow(r);
      if (!f.home) continue;
      try {
        await saveFiling(vaultPath, r.thread, f, null, r.title);
        ok.add(r.thread);
      } catch (e) {
        setError(String(e));
      }
    }
    setDone(ok);
    setBusy(false);
    window.dispatchEvent(new Event(THREADS_CHANGED));
  };

  if (loading && !data) {
    return <div className="flex items-center gap-2 py-3 text-[13px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" />Reading your conversations</div>;
  }
  const ready = pending.filter((r) => filingOfRow(r).home);
  return (
    <div data-testid="filing-plan" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
        <span>
          {pending.length === 0 ? "Every conversation has a home." : `${pending.length} to file`}
          {data && data.skipped > 0 ? ` · ${data.skipped} skipped: incognito, local-only or Bunker Mode` : ""}
        </span>
        {done.size > 0 && <span data-testid="filing-done" className="text-accent">Filed {done.size} conversation{done.size === 1 ? "" : "s"}</span>}
        {ready.length > 0 && (
          <button type="button" disabled={busy} onClick={() => void apply(ready)}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-background hover:bg-accent/90 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderInput className="h-3.5 w-3.5" />}File all {ready.length}
          </button>
        )}
      </div>
      {error && <div className="text-[13px] text-warn">{error}</div>}
      <ul className="divide-y divide-border-subtle rounded-xl border border-border bg-surface">
        {pending.map((r) => {
          const f = filingOfRow(r);
          const locked = !!r.current_home && r.current_home !== "general";
          return (
            <li key={r.thread} data-testid="filing-row" className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-text-primary">{r.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-text-muted">
                  <span>Home</span>
                  <span className="relative">
                    <button type="button" disabled={locked} data-testid="filing-row-home" onClick={() => setMenu(`h:${r.thread}`)}
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] ${f.home ? "border-accent-border bg-accent-soft text-accent" : "border-dashed border-border"} disabled:cursor-default`}>
                      {f.home ? titleCase(f.home) : "Choose"}
                    </button>
                    {menu === `h:${r.thread}` && (
                      <DomainMenu label="Home" domains={domains} exclude={f.home ? [f.home] : []} onClose={() => setMenu(null)}
                        onPick={(d) => edit(r, { home: d, also: f.also.filter((x) => x !== d) })} />
                    )}
                  </span>
                  {!f.home && r.candidates.slice(0, 3).map((c) => (
                    <button key={c.slug} type="button" onClick={() => edit(r, { home: c.slug, also: [] })}
                      className="rounded-full border border-dashed border-border px-2 py-0.5 hover:border-accent-border hover:text-accent">{titleCase(c.slug)}</button>
                  ))}
                  {f.home && f.also.length > 0 && <span>Also</span>}
                  {f.home && f.also.map((d) => (
                    <span key={d} className="inline-flex items-center gap-1 rounded-full border border-border py-0.5 pl-2 pr-1 text-text-secondary">
                      {titleCase(d)}
                      <button type="button" aria-label={`Remove ${titleCase(d)}`} onClick={() => edit(r, { home: f.home, also: f.also.filter((x) => x !== d) })}
                        className="flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-surface-warm"><X className="h-2.5 w-2.5" /></button>
                    </span>
                  ))}
                  {f.home && (
                    <span className="relative">
                      <button type="button" onClick={() => setMenu(`a:${r.thread}`)} className="rounded-full border border-dashed border-border px-2 py-0.5 hover:border-accent-border hover:text-accent">Add</button>
                      {menu === `a:${r.thread}` && (
                        <DomainMenu label="Also file in" domains={domains} exclude={[f.home, ...f.also]} onClose={() => setMenu(null)}
                          onPick={(d) => edit(r, { home: f.home, also: [...f.also, d] })} />
                      )}
                    </span>
                  )}
                </div>
              </div>
              <button type="button" disabled={busy || !f.home} onClick={() => void apply([r])}
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-border px-3 text-[13px] hover:border-accent-border hover:text-accent disabled:opacity-40">
                File
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The For You card: shown only while something is unfiled. Opens the plan in place. */
export function FilingCard({ vaultPath }: { vaultPath: string }) {
  const { data } = useFilePlan(vaultPath);
  const [open, setOpen] = useState(false);
  const n = data?.rows.length ?? 0;
  if (n === 0 && !open) return null;
  return (
    <section data-testid="filing-card" className="mb-6 rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center gap-3">
        <FolderInput className="h-5 w-5 text-accent" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] font-semibold text-text-primary">File {n} unfiled conversation{n === 1 ? "" : "s"}</h3>
          <p className="text-[13px] text-text-muted">Give each one a home domain so it shows where you look for it.</p>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[13px] hover:border-accent-border hover:text-accent">
          {open ? "Hide" : "Review"}
        </button>
      </div>
      {open && <div className="mt-4"><FilingPlan vaultPath={vaultPath} /></div>}
    </section>
  );
}


/** Settings > Behavior: the same plan, reviewed in place. */
export function FilingSettings({ vaultPath }: { vaultPath: string }) {
  const n = useFilePlan(vaultPath).data?.rows.length ?? 0;
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="filing-settings" className="rounded-lg border border-border bg-surface px-5 py-4">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-text-primary">File unfiled conversations</div>
          <div className="mt-0.5 text-[12px] text-text-muted">
            {n > 0 ? `${n} conversation${n === 1 ? " has" : "s have"} no home domain yet. Review where each goes, then file.` : "Every conversation has a home domain."}
          </div>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="inline-flex h-8 shrink-0 items-center rounded-lg border border-border px-3 text-[13px] hover:border-accent-border hover:text-accent">
          {open ? "Hide" : "Review"}
        </button>
      </div>
      {open && <div className="mt-4"><FilingPlan vaultPath={vaultPath} /></div>}
    </div>
  );
}
