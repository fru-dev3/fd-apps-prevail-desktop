// Goals G4: a goal's initiatives (the plan calls them paths). The chief of
// staff proposes 2 or 3 ways to reach the goal, each scored against every
// value, with an even-swap sentence written by code; the ones that broke a
// rule, did not fit capacity or were beaten on every value are listed as left
// out, with why. The user only chooses: Choose installs its playbooks on a
// loop with a commit date, expectations and a stop rule; the weekly check
// says on track or missing, with a proposed change. Data: `prevail compass
// paths <goal>` (engine); the engine owns every file.
import { useState } from "react";
import { ArrowRight, Check, CircleOff, Loader2, Sparkles, Target, TestTube } from "lucide-react";
import { invoke } from "./bridge";
import { useInvokeQuery } from "./query";
import { RowMenu } from "./ui";
import { META } from "./typescale";
import { openMission } from "./missions";
import { openPlaybook } from "./plansmodel";

export interface Initiative {
  id: string; title: string; status: string; hours: number; usd: number; stress: number; kind?: string; until?: string;
  swap?: string; expect?: string; why?: string; because?: string; playbooks?: string; mission?: string;
  values: { id: string; effect: number }[];
  check?: { state: string; explanation: string; proposal: string };
}
export interface InitiativeMap { goal: string; title: string; paths: Initiative[]; left: { title: string; kind: string; reason?: string }[]; generated?: number }

export const KIND_LABEL: Record<string, string> = { "low-effort": "Low effort", capital: "Money", skill: "A skill", social: "With people", "change-target": "A smaller target", "do-nothing": "Do nothing", other: "Other" };
const STATUS_LABEL: Record<string, string> = { proposed: "Proposed", chosen: "Chosen", trial: "Trial", retired: "Retired", rejected: "Turned down" };
const CHECK_LABEL: Record<string, string> = { "on-track": "On track", missing: "Missing what you expected", "too-early": "Too early to tell", stop: "Hit its stop rule", unmeasured: "Not measured yet" };
const iconSm = "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-accent disabled:opacity-40";

/** "2 h a week · $40 a month · stress 1": what it takes, in one muted line. */
export function costLine(x: Pick<Initiative, "hours" | "usd" | "stress">): string {
  const bits = [x.hours ? `${x.hours} h a week` : "no time", x.usd ? `$${Math.round(x.usd).toLocaleString("en-US")} a month` : "", x.stress ? `stress ${x.stress} of 5` : ""];
  return bits.filter(Boolean).join(" · ");
}

export function Initiatives({ goalId, vaultPath, values }: { goalId: string; vaultPath: string; values: Map<string, string> }) {
  const q = useInvokeQuery<InitiativeMap>("engine_initiatives", { vault: vaultPath, goal: goalId }, { staleMs: 30_000 });
  const m = q.data && typeof q.data === "object" && Array.isArray(q.data.paths) ? q.data : null;
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showLeft, setShowLeft] = useState(false);
  const run = async (key: string, cmd: string, args: Record<string, unknown>, done?: (r: Record<string, unknown>) => string) => {
    setBusy(key); setMsg(null);
    try { const r = await invoke<Record<string, unknown>>(cmd, { vault: vaultPath, ...args }); if (done) setMsg(done(r ?? {})); await q.refresh(); }
    catch (e) { setMsg(`Not done: ${String(e)}`); } finally { setBusy(null); }
  };
  const live = (m?.paths ?? []).filter((p) => p.status !== "rejected");
  const effects = (p: Initiative) => p.values.filter((v) => v.effect !== 0).map((v) => `${values.get(v.id) ?? v.id} ${v.effect > 0 ? "+" : ""}${v.effect}`).join(", ");
  return (
    <div className="mt-2 border-l-2 border-border-subtle pl-3" data-testid="initiatives" data-goal={goalId}>
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[13px] font-medium text-text-muted">Initiatives{live.length ? ` (${live.length})` : ""}</p>
        <button onClick={() => void run("gen", "engine_initiatives_generate", { goal: goalId }, (r) => `Proposed ${(r.candidates as unknown[] | undefined)?.filter((c) => (c as { verdict: string }).verdict === "survivor").length ?? 0}; the rest are left out with the reason.`)} disabled={!!busy}
          title="Find initiatives: 2 or 3 ways to reach this goal, each weighed against all your values. You only choose." aria-label="Find initiatives" data-testid="initiatives-generate" className={iconSm}>
          {busy === "gen" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        </button>
      </div>
      {busy === "gen" && <p className={META}>Thinking through six to eight ways, then checking them against your rules and capacity. About a minute.</p>}
      <ul>{live.map((p) => {
        const st = p.status;
        const meta = [STATUS_LABEL[st] ?? st, KIND_LABEL[p.kind ?? ""] ?? "", costLine(p), p.until && (st === "chosen" || st === "trial") ? `until ${p.until}` : ""].filter(Boolean);
        const check = p.check && (st === "chosen" || st === "trial") ? p.check : null;
        return (
          <li key={p.id} data-testid="initiative" data-status={st} className="group flex items-start gap-2 border-b border-border-subtle py-2 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p title={p.why ?? p.title} className="line-clamp-2 break-words text-[15px] font-medium leading-snug text-text-primary">{p.title}</p>
              <p className={`${META} mt-0.5 truncate`} title={[effects(p) ? `Values: ${effects(p)}` : "", p.expect ? `Expect: ${p.expect}` : "", p.because ? `Because: ${p.because}` : ""].filter(Boolean).join(". ")}>{meta.join(" · ")}</p>
              {st === "proposed" && p.swap && <p className={`${META} mt-0.5 line-clamp-2`} data-testid="initiative-swap">{p.swap}</p>}
              {check && <p className={`${META} mt-0.5 line-clamp-2 ${check.state === "missing" || check.state === "stop" ? "text-warn" : ""}`} data-testid="initiative-check" title={check.explanation}>{CHECK_LABEL[check.state] ?? check.state}{check.proposal ? ` · ${check.proposal}` : ""}</p>}
            </div>
            {st === "proposed" && (
              <button onClick={() => void run(`c:${p.id}`, "engine_initiative_choose", { id: p.id, until: null, trial: null }, (r) => `Chosen. ${(r.playbooks as unknown[] | undefined)?.length ?? 0} playbook${(r.playbooks as unknown[] | undefined)?.length === 1 ? "" : "s"} now run on their own${r.mission ? ", and a mission started" : ""}.`)}
                disabled={!!busy} data-testid="initiative-choose" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white disabled:opacity-50">
                {busy === `c:${p.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Choose
              </button>
            )}
            <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
              <RowMenu items={[
                ...(st === "proposed" ? [{ icon: TestTube, label: "Try it as a small trial", onClick: () => void run(`t:${p.id}`, "engine_initiative_choose", { id: p.id, until: null, trial: true }, () => "Started as a trial.") }] : []),
                ...(p.mission ? [{ icon: Target, label: "Open its mission", onClick: () => openMission(p.mission!) }]
                  : st === "chosen" || st === "trial" ? [{ icon: Target, label: "Start a mission for it", onClick: () => void (async () => { setBusy(`m:${p.id}`); try { const r = await invoke<{ slug?: string }>("engine_missions_from_path", { vault: vaultPath, path: p.id }); await q.refresh(); if (r?.slug) openMission(r.slug); } catch (e) { setMsg(`Not started: ${String(e)}`); } finally { setBusy(null); } })() }] : []),
                ...((p.playbooks ?? "").split(",").map((x) => x.trim()).filter(Boolean).map((id) => ({ icon: ArrowRight, label: `Open playbook ${id}`, onClick: () => openPlaybook(id) }))),
                ...(st === "proposed" || st === "chosen" || st === "trial" ? [{ icon: CircleOff, label: st === "proposed" ? "Not for me" : "Retire it", onClick: () => void run(`r:${p.id}`, "engine_initiative_retire", { id: p.id, because: st === "proposed" ? "not for me" : "retired from the Compass page" }, () => (st === "proposed" ? "Turned down." : "Retired; its playbooks stopped.")) }] : []),
              ]} />
            </span>
          </li>
        );
      })}</ul>
      {(m?.left.length ?? 0) > 0 && (
        <div className="mt-1">
          <button onClick={() => setShowLeft((x) => !x)} aria-expanded={showLeft} data-testid="initiatives-left" className={`${META} hover:text-accent`}>Left out ({m!.left.length})</button>
          {showLeft && <ul className="mt-1">{m!.left.map((x) => <li key={x.title} className={`${META} py-0.5`}><span className="text-text-secondary">{x.title}</span>{x.reason ? ` · ${x.reason}` : ""}</li>)}</ul>}
        </div>
      )}
      {msg && <p className={`${META} mt-1`} data-testid="initiatives-msg">{msg}</p>}
    </div>
  );
}
