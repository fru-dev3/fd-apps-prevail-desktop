// Possible duplicate entities: pairs the engine thinks are one person, place,
// org or thing but was not sure enough to merge (`entities duplicates`).
// The owner merges a pair (keeping the fuller name unless they flip it) or
// marks it "Not the same", which the engine remembers so it is never asked
// again. Merging never loses anything: the engine keeps the other name as an
// alias, appends its notes and archives its page.
import { useState } from "react";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { invoke } from "./bridge";
import { invokeCached, peekInvoke } from "./query";
import { KIND_LABEL, KindBadge } from "./entitydetail";
import { entitySnapshot, type EntityKindName } from "./entitystore";
import { DetailTitle } from "./typescale";

export interface DupSide { id: string; name: string; kind: EntityKindName; mentions: number }
export interface DupPair { pair: string; a: DupSide; b: DupSide; confidence: number; reason: string }

/** The pending pairs; an engine without the command answers none. */
const cleanPairs = (r: unknown): DupPair[] => (Array.isArray(r) ? (r as DupPair[]).filter((p) => p && p.a?.id && p.b?.id) : []);
/** The last loaded pairs, for painting a revisit at once. */
export function cachedDuplicates(vault: string): DupPair[] {
  return cleanPairs(peekInvoke("engine_entities_duplicates", { vault }));
}

export async function loadDuplicates(vault: string): Promise<DupPair[]> {
  const r = await invokeCached<DupPair[]>("engine_entities_duplicates", { vault }, { force: true }).catch(() => null);
  return cleanPairs(r);
}

function Side({ s, keep }: { s: DupSide; keep: boolean }) {
  return (
    <div className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg border px-3 py-2.5 ${keep ? "border-accent-border bg-accent-soft/40" : "border-border"}`}>
      <KindBadge kind={s.kind} name={s.name} size={36} entity={entitySnapshot().byId.get(s.id)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-text-primary">{s.name}</span>
        <span className="block text-[13px] text-text-muted">{KIND_LABEL[s.kind] ?? s.kind} · {s.mentions} {s.mentions === 1 ? "mention" : "mentions"}</span>
      </span>
      {keep && <span className="shrink-0 text-[12px] font-medium text-accent">Keep</span>}
    </div>
  );
}

function PairCard({ vault, p, onDone }: { vault: string; p: DupPair; onDone: (pair: string, merged: boolean) => void }) {
  // The engine lists the suggested keeper (the fuller name) as `a`.
  const [keep, setKeep] = useState<"a" | "b">("a");
  const [busy, setBusy] = useState<"merge" | "not" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (what: "merge" | "not") => {
    setBusy(what); setErr(null);
    try {
      if (what === "merge") {
        const [k, m] = keep === "a" ? [p.a, p.b] : [p.b, p.a];
        await invoke("engine_entities_merge", { vault, keep: k.id, merge: m.id });
      } else {
        await invoke("engine_entities_not_same", { vault, a: p.a.id, b: p.b.id });
      }
      onDone(p.pair, what === "merge");
    } catch (e) { setErr(String(e)); setBusy(null); }
  };
  const other = keep === "a" ? p.b : p.a;
  return (
    <li data-testid="dup-pair" className="rounded-xl border border-border p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Side s={p.a} keep={keep === "a"} />
        <ArrowLeftRight className="h-4 w-4 shrink-0 self-center text-text-muted" aria-hidden />
        <Side s={p.b} keep={keep === "b"} />
      </div>
      <p className="mt-3 text-[14px] text-text-secondary">{p.reason}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={() => void run("merge")} disabled={busy !== null} data-testid="dup-merge"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[14px] font-medium text-white hover:bg-accent-hover disabled:opacity-60">
          {busy === "merge" && <Loader2 className="h-4 w-4 animate-spin" />}Merge
        </button>
        <button onClick={() => void run("not")} disabled={busy !== null} data-testid="dup-not-same"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3.5 text-[14px] font-medium text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-60">
          {busy === "not" && <Loader2 className="h-4 w-4 animate-spin" />}Not the same
        </button>
        <button onClick={() => setKeep((k) => (k === "a" ? "b" : "a"))} disabled={busy !== null} data-testid="dup-flip"
          className="text-[13px] text-text-muted underline-offset-2 hover:text-accent hover:underline">
          Keep {other.name} instead
        </button>
      </div>
      {err && <p className="mt-2 text-[13px] text-err">{err}</p>}
    </li>
  );
}

export function DuplicatesPane({ vault, pairs, onDone }: { vault: string; pairs: DupPair[]; onDone: (pair: string, merged: boolean) => void }) {
  return (
    <div data-testid="entity-duplicates" className="min-h-0 flex-1 overflow-y-auto">
      <DetailTitle>Possible duplicates</DetailTitle>
      <p className="mt-1 text-[14px] text-text-muted">Each pair may be one entity. Merging keeps both names, every mention and your notes.</p>
      {pairs.length === 0
        ? <p className="mt-6 text-[15px] text-text-muted">Nothing left to review.</p>
        : <ul className="mt-5 flex flex-col gap-3">{pairs.map((p) => <PairCard key={p.pair} vault={vault} p={p} onDone={onDone} />)}</ul>}
    </div>
  );
}
