// The receipt under a chat reply when a promise told to the chief of staff
// was filed on a board (Today T2): what, for whom, when, which board, Undo.
import { useState } from "react";
import { Handshake, Hourglass, Loader2, Undo2 } from "lucide-react";
import { invoke } from "./bridge";
import { invalidateQueries, useInvokeQuery } from "./query";
import { LS, lsGet } from "./storage";
import { META } from "./typescale";
import { fmtDue, label, personName } from "./plansmodel";

interface Filed { id: string; kind: "commitment" | "waiting"; domain: string; text: string; due?: string; person?: string }
interface Open { id?: string; kind: "commitment" | "waiting"; domain: string; text: string; due?: string; person?: string }

export function FiledCard({ id, filed, vaultPath }: { id: string; filed?: Filed; vaultPath?: string }) {
  const vault = vaultPath ?? lsGet(LS.vault, "");
  // A reloaded thread has only the id: look it up among the open ones.
  const q = useInvokeQuery<Open[]>("engine_commitments", filed ? null : { vault, view: null }, { staleMs: 60_000 });
  const f: Open | undefined = filed ?? (Array.isArray(q.data) ? q.data.find((x) => x.id === id) : undefined);
  const [state, setState] = useState<"idle" | "busy" | "undone" | "error">("idle");
  const undo = async () => {
    setState("busy");
    try { await invoke("engine_commitment_undo", { vault, id }); invalidateQueries("engine_commitments"); invalidateQueries("engine_today"); setState("undone"); }
    catch { setState("error"); }
  };
  const Icon = f?.kind === "waiting" ? Hourglass : Handshake;
  return (
    <div data-testid="filed-card" className="mt-3 flex items-start gap-2.5 rounded-lg border border-border-subtle bg-background/40 px-3 py-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        {state === "undone" ? <p className="text-[14px] text-text-muted">Undone. The line is off the board.</p> : f ? (
          <>
            <p className="break-words text-[14px] font-medium text-text-primary">{f.text}</p>
            <p className={META}>{f.kind === "waiting" ? `Waiting on ${personName(f.person) || "someone"}` : `A promise${f.person ? ` to ${personName(f.person)}` : ""}`}{f.due ? `, due ${fmtDue(f.due)}` : ""}, on {label(f.domain.replace(/^_mission-/, ""))}'s board</p>
          </>
        ) : <p className="text-[14px] text-text-muted">Filed on a board (done or undone since).</p>}
        {state === "error" && <p className="text-[12px] text-err">Could not undo it.</p>}
      </div>
      {state !== "undone" && f && (
        <button onClick={() => void undo()} disabled={state === "busy"} title="Undo" aria-label="Undo" data-testid="filed-undo"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-accent disabled:opacity-40">
          {state === "busy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}
