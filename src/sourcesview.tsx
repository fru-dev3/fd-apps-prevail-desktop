// Insights > Metrics > Sources (metrics plan M3): every source Prevail can
// read, with this Mac's consent. Each says what it reads and what it never
// reads, whether it stays on this Mac, needs a local model or Full Disk
// Access, its state and last sync. Turning on a wave 3 or 4 source shows that
// text and its connect step first and asks to confirm. Sync now reads it once.
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { invoke, isBrowser } from "./bridge";
import { invalidateQueries, useInvokeQuery } from "./query";
import { toast } from "./toast";
import { BODY, META, SECTION_TITLE } from "./typescale";
import { WAVE_LABEL, needsConfirm, sourceState, type SourceRow } from "./stackmodel";

const chip = "inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[12px] text-text-secondary";
const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";

function Toggle({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onChange} data-testid="source-toggle"
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-45 ${on ? "bg-accent" : "bg-surface-strong"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-[left] ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function SourceItem({ s, vaultPath, onChanged }: { s: SourceRow; vaultPath: string; onChanged: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<"consent" | "sync" | null>(null);
  const desktop = !isBrowser();
  const consent = async (on: boolean) => {
    setBusy("consent");
    try { await invoke("engine_source_consent", { vault: vaultPath, id: s.id, on }); setAsking(false); onChanged(); }
    catch (e) { toast.error(String(e)); } finally { setBusy(null); }
  };
  const flip = () => (needsConfirm(s, !s.on) ? setAsking(true) : void consent(!s.on));
  const sync = async () => {
    setBusy("sync");
    try { const r = await invoke<{ state?: string; note?: string }>("engine_source_sync", { vault: vaultPath, id: s.id }); toast.success(`${s.title}: ${r?.note ?? r?.state ?? "done"}`); onChanged(); }
    catch (e) { toast.error(String(e)); } finally { setBusy(null); }
  };
  return (
    <li data-testid={`consent-row-${s.id}`} className="border-b border-border-subtle py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className={SECTION_TITLE}>{s.title}</h3>
            <span className={META}>{sourceState(s)}{s.last_sync ? `, last read ${s.last_sync.slice(0, 10)}` : ""}</span>
          </div>
          <p className={`${BODY} mt-0.5 break-words text-text-secondary`}>Reads {s.reads}. Never {s.never}.</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {s.localOnly && <span className={chip}>Stays on this Mac</span>}
            {s.localModel && <span className={chip}>Local model</span>}
            {s.fda && <span className={chip}>Needs Full Disk Access</span>}
          </div>
          {s.note && s.on && <p className={`${META} mt-1 break-words`}>{s.note}</p>}
        </div>
        <span className="flex shrink-0 items-center gap-1">
          {s.on && s.wave >= 2 && (
            <button type="button" onClick={() => void sync()} disabled={!!busy || !desktop} title="Read it now" aria-label={`Read ${s.title} now`} data-testid="source-sync" className={iconBtn}>
              {busy === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
          )}
          <Toggle on={s.on} label={`${s.title} on this Mac`} disabled={!!busy || !desktop} onChange={flip} />
        </span>
      </div>
      {asking && (
        <div data-testid="source-confirm" className="mt-2 rounded-lg border border-accent-border bg-accent-soft p-3">
          <p className={`${BODY} break-words text-text-primary`}>Turn on {s.title} on this Mac? It reads {s.reads}. It never reads {s.never}.{s.localOnly ? " Its numbers stay on this Mac." : ""}</p>
          {s.connect && <p className={`${META} mt-1 break-words`}>Then: {s.connect}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => void consent(true)} disabled={!!busy} data-testid="source-confirm-on" className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-[14px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-45">Turn it on</button>
            <button type="button" onClick={() => setAsking(false)} className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[14px] text-text-secondary">Not now</button>
          </div>
        </div>
      )}
    </li>
  );
}

export function SourcesConsent({ vaultPath }: { vaultPath: string }) {
  const q = useInvokeQuery<SourceRow[]>("engine_sources", { vault: vaultPath }, { staleMs: 60_000 });
  const rows = Array.isArray(q.data) ? q.data : [];
  const changed = () => { invalidateQueries("engine_sources"); invalidateQueries("engine_metrics"); void q.refresh(); };
  const waves = [1, 2, 3, 4].map((w) => ({ w, rows: rows.filter((r) => r.wave === w) })).filter((x) => x.rows.length);
  return (
    <div data-testid="sources-consent" className="max-w-4xl">
      {!!q.error && <p className="text-[13px] text-err">Could not read the sources: {String(q.error)}</p>}
      {waves.map(({ w, rows: rs }) => (
        <section key={w} className="mt-5">
          <h3 className="text-[15px] font-semibold text-text-secondary">{WAVE_LABEL[w]}</h3>
          <ul>{rs.map((s) => <SourceItem key={s.id} s={s} vaultPath={vaultPath} onChanged={changed} />)}</ul>
        </section>
      ))}
    </div>
  );
}
