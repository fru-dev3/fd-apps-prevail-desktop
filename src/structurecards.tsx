// Recommendations > Structure: what Prevail suggests adding to or taking out
// of the shape of your vault (a new domain, a project to track, a dormant
// domain to archive). Nothing changes without Accept; Not now hides one for
// 30 days and Never for good. The engine remembers every answer.
import { useState } from "react";
import { Archive, Check, FolderKanban, FolderPlus, Loader2, MessagesSquare } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { openUpdateThread } from "./linking";
import { CARD_HEADLINE, META } from "./typescale";
import { acceptedTarget, MISSIONS_CHANGED, openMission, STRUCTURE_CHANGED, type StructureSuggestion } from "./missions";

const fire = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));
const KIND_ICON = { domain: FolderPlus, project: FolderKanban, archive_domain: Archive } as const;
const tsMs = (ts: string | number) => (typeof ts === "number" ? (ts < 1e12 ? ts * 1000 : ts) : Date.parse(ts));
const fmtDay = (ts: string | number) => { const t = tsMs(ts); return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""; };
const btn = "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium disabled:opacity-60";

function StructureCard({ s, vaultPath, onGone }: { s: StructureSuggestion; vaultPath: string; onGone: (id: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const Icon = KIND_ICON[s.kind] ?? FolderPlus;
  const run = async (key: string, f: () => Promise<void>) => {
    setBusy(key); setErr(null);
    try { await f(); onGone(s.id); fire(STRUCTURE_CHANGED); }
    catch (e) { setErr(`Could not do that: ${String(e)}`); }
    finally { setBusy(null); }
  };
  const accept = () => run("accept", async () => {
    const res = await invoke("engine_suggest_accept", { vault: vaultPath, id: s.id });
    fire("prevail:domains-changed");
    fire(MISSIONS_CHANGED);
    const t = acceptedTarget(res, s);
    if (t && "mission" in t) openMission(t.mission);
    else if (t && "domain" in t) fire("prevail:open-domain", t.domain);
  });
  const dismiss = (forever: boolean) => run(forever ? "never" : "later", async () => {
    await invoke("engine_suggest_dismiss", { vault: vaultPath, id: s.id, forever });
  });
  const acceptLabel = s.kind === "archive_domain" ? "Archive" : "Accept";
  return (
    <li data-testid="structure-card" data-suggestion={s.id} className="py-3">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
        <div className="min-w-0 flex-1">
          <h3 className={CARD_HEADLINE}>{s.title}</h3>
          <p title={s.reason} className="mt-0.5 line-clamp-2 text-[14px] leading-snug text-text-secondary">{s.reason}</p>
          {s.evidence?.length > 0 && (
            <ul className="mt-2 space-y-0.5" data-testid="structure-evidence">
              {s.evidence.slice(0, 4).map((ev, i) => (
                <li key={`${ev.thread ?? ""}:${i}`}>
                  {ev.thread ? (
                    <button onClick={() => void openUpdateThread(vaultPath, { ts: ev.ts, from_domain: ev.domain, thread: ev.thread!, fact: "" })}
                      className="inline-flex max-w-full items-center gap-1.5 text-[13px] text-accent hover:underline">
                      <MessagesSquare className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">A conversation in {titleCase(ev.domain)}</span>
                      <span className="shrink-0 text-text-muted">{fmtDay(ev.ts)}</span>
                    </button>
                  ) : <span className={META}>{titleCase(ev.domain)} · {fmtDay(ev.ts)}</span>}
                </li>
              ))}
              {s.evidence.length > 4 && <li className={META}>and {s.evidence.length - 4} more</li>}
            </ul>
          )}
          {err && <p className="mt-2 text-[13px] text-err">{err}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3" role="group" aria-label="Decide">
            <button onClick={() => void accept()} disabled={busy !== null} data-testid="structure-accept" className={`${btn} bg-accent text-on-accent hover:bg-accent-hover`}>
              {busy === "accept" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{acceptLabel}
            </button>
            <button onClick={() => void dismiss(false)} disabled={busy !== null} data-testid="structure-later" title="Hide it for 30 days"
              className={`${btn} px-1 text-text-muted hover:text-text-primary`}>
              {busy === "later" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Not now
            </button>
            <button onClick={() => void dismiss(true)} disabled={busy !== null} data-testid="structure-never" title="Never suggest this again"
              className={`${btn} px-1 text-text-muted hover:text-err`}>
              {busy === "never" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Never
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

export function StructureCards({ suggestions, vaultPath }: { suggestions: StructureSuggestion[]; vaultPath: string }) {
  // Answered cards leave at once; the engine's next read agrees.
  const [gone, setGone] = useState<Set<string>>(new Set());
  const left = suggestions.filter((s) => !gone.has(s.id));
  if (!left.length) return <p className={META}>Nothing to change in your structure right now.</p>;
  return (
    <ul className="divide-y divide-border-subtle" data-testid="structure-list">
      {left.map((s) => <StructureCard key={s.id} s={s} vaultPath={vaultPath} onGone={(id) => setGone((g) => new Set(g).add(id))} />)}
    </ul>
  );
}
