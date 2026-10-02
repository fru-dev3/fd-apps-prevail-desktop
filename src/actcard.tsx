// Approvals in the flow of the conversation. When the gate holds a connector
// write, its deny reason carries [prevail-act:<id>]; the chat and council
// render this card right under that message so the user answers where the
// question came up, not on another screen. Allow and Always go through the
// same single-use approval token as the Inbox (loop_request_approval, then
// engine_acts_approve, which the backend re-verifies). Deny tells the agent
// the user said no. Every answer fires ACTS_CHANGED so the Inbox, the thread
// rows and the Home count clear together.
import { useCallback, useEffect, useState } from "react";
import { Check, Hourglass, Loader2, ShieldAlert, ShieldCheck, Trash2, X } from "lucide-react";
import { invoke } from "./bridge";
import { relTime } from "./format";
import { RowAction } from "./rowaction";
import { scopeLabel } from "./plansmodel";
import { announceActsChanged, type PendingAct, useWaitingState } from "./waiting";

export const APPROVED_FOLLOW_UP = "Approved. Go ahead.";

/** "mcp__claude_ai_PayPal__create_invoice" -> "PayPal: create invoice". */
export function friendlyTool(tool: string): string {
  if (!tool) return "";
  const parts = tool.split("__").filter(Boolean);
  if (parts[0] === "mcp" && parts.length >= 3) {
    const server = parts[1].replace(/^claude_ai_/, "").replace(/_/g, " ");
    return `${server}: ${parts.slice(2).join(" ").replace(/_/g, " ")}`;
  }
  return tool.replace(/_/g, " ");
}

type Outcome = "approved" | "always" | "declined";

// An engine refusal arrives as "prevail exited 1: {"ok":false,"error":"..."}";
// show the reason, not the plumbing.
export function engineError(e: unknown): string {
  const t = String(e);
  const m = /"error"\s*:\s*"([^"]+)"/.exec(t);
  return m ? m[1] : t.replace(/^Error:\s*/, "");
}

// Approve one held act. Shared by the card and the Inbox so both use the
// exact same token spine. Returns the engine's answer.
export async function approveAct(vaultPath: string, a: PendingAct, opts: { allowSensitive?: boolean; always?: boolean } = {}): Promise<{ ok?: boolean; error?: string }> {
  const approval = await invoke<string>("loop_request_approval", { domain: a.domain, action: a.summary });
  const res = await invoke<{ ok?: boolean; error?: string }>("engine_acts_approve", {
    vault: vaultPath, id: a.id, domain: a.domain, summary: a.summary, approval,
    allowSensitive: !!opts.allowSensitive, always: !!opts.always,
  });
  if (res?.ok) announceActsChanged();
  return res ?? {};
}

export async function denyAct(vaultPath: string, id: string): Promise<{ ok?: boolean; error?: string }> {
  const res = await invoke<{ ok?: boolean; error?: string }>("engine_acts_deny", { vault: vaultPath, id });
  announceActsChanged();
  return res ?? {};
}

export function ActApprovalCard({ vaultPath, actId, onFollowUp }: {
  vaultPath: string;
  actId: string;
  // Sends the short user turn that lets the agent retry and carry on.
  onFollowUp?: (text: string) => void;
}) {
  const { acts } = useWaitingState(vaultPath);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Remember the act once seen, so the settled card can still name it after
  // the engine drops it from the queue.
  const live = acts?.find((a) => a.id === actId) ?? null;
  const [seen, setSeen] = useState<PendingAct | null>(null);
  useEffect(() => { if (live) setSeen(live); }, [live]);
  const act = live ?? seen;

  const allow = useCallback(async (always: boolean) => {
    if (!act) return;
    setBusy(true); setErr(null);
    try {
      const sensitive = (act.categories?.length ?? 0) > 0;
      const res = await approveAct(vaultPath, act, { allowSensitive: sensitive, always });
      if (res.ok) {
        setOutcome(always ? "always" : "approved");
        onFollowUp?.(APPROVED_FOLLOW_UP);
      } else {
        setErr(res.error || "Approval failed.");
      }
    } catch (e) {
      setErr(`Approval failed: ${engineError(e)}`);
    } finally { setBusy(false); }
  }, [act, vaultPath, onFollowUp]);

  const deny = useCallback(async () => {
    if (!act) return;
    setBusy(true); setErr(null);
    try {
      await denyAct(vaultPath, act.id);
      setOutcome("declined");
    } catch (e) {
      setErr(`Could not decline: ${engineError(e)}`);
    } finally { setBusy(false); }
  }, [act, vaultPath]);

  // Not pending (answered elsewhere, expired, or never queued) and not answered
  // here: nothing to show.
  if (!act || (!live && !outcome)) return null;

  if (outcome) {
    const label = outcome === "declined" ? "Declined" : outcome === "always" ? "Allowed, and always allowed from now on" : "Allowed";
    return (
      <div data-testid="act-card" data-act={act.id} data-state={outcome}
        className="mb-6 flex items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[13px] text-text-secondary">
        {outcome === "declined" ? <X className="h-4 w-4 shrink-0 text-text-muted" /> : <Check className="h-4 w-4 shrink-0 text-accent" />}
        <span className="font-medium text-text-primary">{label}</span>
        <span className="min-w-0 truncate text-text-muted">{act.summary}</span>
      </div>
    );
  }

  const sensitive = (act.categories?.length ?? 0) > 0;
  const tool = friendlyTool(act.tool);
  // The summary usually names the tool already; say it once.
  const norm = (x: string) => x.toLowerCase().replace(/[_\s]+/g, " ").trim();
  const toolLine = tool && norm(tool) !== norm(act.summary) ? tool : "";
  return (
    <div data-testid="act-card" data-act={act.id} data-state="pending"
      className="mb-6 rounded-xl border border-warn/40 bg-surface px-3.5 py-3">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold leading-snug text-text-primary">{act.summary}</div>
          <div className="mt-0.5 text-[12px] text-text-muted">
            {toolLine && <span>{toolLine} · </span>}
            <span>{scopeLabel(act.domain || "general")}</span>
            {act.ts ? <span> · held {relTime(act.ts)}</span> : null}
          </div>
          {sensitive && (
            <div className="mt-1.5 text-[12px] leading-snug text-text-secondary">
              Carries {act.categories!.join("; ")}. Nothing has been sent.
            </div>
          )}
          {err && <div className="mt-1.5 text-[12px] text-err">{err}</div>}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {busy ? (
              <span className="inline-flex items-center gap-1 text-[12px] text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Working</span>
            ) : (
              <>
                <button onClick={() => void allow(false)} data-testid="act-allow"
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold ${sensitive ? "border border-warn/60 bg-warn/10 text-text-primary hover:bg-warn/20" : "bg-accent text-on-accent hover:bg-accent-hover"}`}>
                  <Check className="h-3.5 w-3.5" /> {sensitive ? "Approve including sensitive info" : "Allow"}
                </button>
                {act.alwaysEligible === true && !sensitive && (
                  <button onClick={() => void allow(true)} data-testid="act-always"
                    title={`Always allow ${tool || "this tool"} in ${scopeLabel(act.domain || "general")}`}
                    className="inline-flex items-center gap-1 text-[12px] text-text-muted hover:text-accent">
                    <ShieldCheck className="h-3.5 w-3.5" /> Always
                  </button>
                )}
                <button onClick={() => void deny()} data-testid="act-deny"
                  className="inline-flex items-center gap-1 text-[12px] text-text-muted hover:!text-err">
                  Deny
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Small status mark for rows (threads, tasks) that are held on the user.
export function WaitingChip({ label = "Waiting for you", compact = false }: { label?: string; compact?: boolean }) {
  return (
    <span data-testid="waiting-chip" title={label}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn/15 px-1.5 py-0 text-[11px] font-medium text-warn">
      <Hourglass className="h-3 w-3" />
      {!compact && label}
    </span>
  );
}

// Privacy page: the saved "Always" rules, one row each, with a tiny revoke.
type Rule = { tool: string; domain: string; ts?: number };
export function AlwaysAllowedCard({ vaultPath }: { vaultPath: string }) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const load = useCallback(() => {
    if (!vaultPath) { setRules([]); return; }
    invoke<Rule[]>("engine_acts_rules", { vault: vaultPath })
      .then((r) => setRules(Array.isArray(r) ? r : []))
      .catch(() => setRules([]));
  }, [vaultPath]);
  useEffect(() => {
    load();
    window.addEventListener("prevail:acts-changed", load);
    return () => window.removeEventListener("prevail:acts-changed", load);
  }, [load]);
  const revoke = async (r: Rule) => {
    await invoke("engine_acts_rule_revoke", { vault: vaultPath, tool: r.tool, domain: r.domain });
    setRules((cur) => (cur ?? []).filter((x) => !(x.tool === r.tool && x.domain === r.domain)));
    announceActsChanged();
  };
  return (
    <div data-testid="always-allowed">
      {rules === null ? (
        <div className="flex items-center gap-2 py-2 text-[13px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
      ) : rules.length === 0 ? (
        <div className="py-2 text-[13px] text-text-muted">Nothing yet. Choose Always on an approval to skip asking for that tool in that domain.</div>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {rules.map((r) => (
            <li key={`${r.tool}::${r.domain}`} data-rule={`${r.tool}::${r.domain}`} className="group flex items-center gap-3 py-2.5">
              <ShieldCheck className="h-4 w-4 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-text-primary" title={r.tool}>{friendlyTool(r.tool)}</div>
                <div className="text-[12px] text-text-muted">{scopeLabel(r.domain || "general")}{r.ts ? ` · added ${relTime(r.ts)}` : ""}</div>
              </div>
              <RowAction icon={Trash2} label="Revoke" doneLabel="Revoked" onClick={() => revoke(r)} testId="rule-revoke" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
