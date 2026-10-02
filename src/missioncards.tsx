// The two cards a chat turn can carry for missions (missions-plan.md):
//   BringInCard       a mission turn reached outside the mission. Nothing was
//                     read. For this question (the domain rides along on this
//                     one message), for the mission (it is attached), or no.
//   MissionStartCard  a message that sounds like a mission. Start makes it
//                     (the user's yes); Adjust opens the Missions page form
//                     with the draft filled in. Never started without a tap.
import { useState } from "react";
import { Check, Loader2, Play, SlidersHorizontal, Target, X } from "lucide-react";
import { LS, lsGet } from "./storage";
import { titleCase } from "./format";
import { attachToMission, createMission, daysLeftLabel, openMission, useMissions } from "./missions";
import type { ChatMessage } from "./types";

// One filled primary action per card; the rest are quiet text links.
const primary = "inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50";
const quiet = "inline-flex h-8 items-center gap-1 px-1 text-[13px] text-text-muted hover:text-text-primary disabled:opacity-50";
const card = "mt-3 rounded-xl border border-border bg-surface p-3";

/** Ask the mission's chat panel to resend the last question with these domains for this one turn. */
export const BRING_IN_EVENT = "prevail:bring-in";

export function BringInCard({ b, lastUser }: { b: NonNullable<ChatMessage["bringIn"]>; lastUser: string }) {
  const vault = lsGet(LS.vault, "");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const names = b.domains.map(titleCase).join(" and ");
  const ask = () => window.dispatchEvent(new CustomEvent(BRING_IN_EVENT, { detail: { mission: b.mission, domains: b.domains, text: lastUser } }));
  const forMission = async () => {
    setBusy("mission"); setErr(null);
    try { for (const d of b.domains) await attachToMission(vault, b.mission, "domain", `${d}:consulted`); setDone("mission"); ask(); }
    catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };
  if (done === "no") return <p data-testid="bring-in-card" className="mt-2 text-[13px] text-text-muted">Left out. Nothing from {names} was read.</p>;
  return (
    <div data-testid="bring-in-card" className={card}>
      <p className="text-[14px] text-text-primary"><span className="font-semibold">Bring in {names}?</span> {b.never ? "It is on your never-read list. " : ""}Nothing from {b.domains.length === 1 ? "it" : "them"} was read.</p>
      {done === "mission" ? <p className="mt-2 text-[13px] text-accent">Added to the project. Send the question again below.</p> : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className={primary} disabled={!!busy} onClick={() => { setDone("turn"); ask(); }} data-testid="bring-in-turn"><Check className="h-3.5 w-3.5" />For this question</button>
          <button className={quiet} disabled={!!busy} onClick={() => void forMission()} data-testid="bring-in-mission">{busy === "mission" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Target className="h-3.5 w-3.5" />}For the project</button>
          <button className={quiet} disabled={!!busy} onClick={() => setDone("no")} data-testid="bring-in-no"><X className="h-3.5 w-3.5" />No</button>
        </div>
      )}
      {done === "turn" && <p className="mt-2 text-[13px] text-accent">{names} rides along on the question below. Send it when ready.</p>}
      {err && <p className="mt-2 text-[13px] text-err">{err}</p>}
    </div>
  );
}

export const MISSION_DRAFT_KEY = "prevail.missions.draft";

export function MissionStartCard({ d }: { d: NonNullable<ChatMessage["missionDraft"]> }) {
  const vault = lsGet(LS.vault, "");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const [no, setNo] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const start = async () => {
    setBusy(true); setErr(null);
    try {
      const m = await createMission(vault, { name: d.name, outcome: d.outcome, target: d.target, owner: d.owner, consult: d.consulted, specialists: d.specialists });
      setMade(m.slug);
      openMission(m.slug);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  const adjust = () => {
    try { localStorage.setItem(MISSION_DRAFT_KEY, JSON.stringify(d)); localStorage.setItem("prevail.missions.focus", "new"); } catch { /* storage off */ }
    window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "missions" }));
    window.dispatchEvent(new CustomEvent("prevail:missions-focus", { detail: "new" }));
  };
  if (no) return <p data-testid="mission-start-card" className="mt-2 text-[13px] text-text-muted">No project started.</p>;
  return (
    <div data-testid="mission-start-card" className={card}>
      <div className="flex items-center gap-2"><Target className="h-4 w-4 shrink-0 text-accent" /><span className="min-w-0 truncate text-[15px] font-semibold text-text-primary">{d.name}</span></div>
      <dl className="mt-2 grid gap-1 text-[13px] sm:grid-cols-[6rem_1fr]">
        <dt className="text-text-muted">Outcome</dt><dd className="text-text-primary">{d.outcome}</dd>
        {d.owner && <><dt className="text-text-muted">Owner</dt><dd className="text-text-primary">{titleCase(d.owner)}</dd></>}
        <dt className="text-text-muted">Target</dt><dd className="text-text-primary">{d.target ?? "proposed: 90 days from today"}</dd>
        {d.specialists.length > 0 && <><dt className="text-text-muted">Agents</dt><dd className="text-text-primary">{d.specialists.map(titleCase).join(", ")}</dd></>}
      </dl>
      {made ? <p className="mt-2 text-[13px] text-accent">Started. It is in Projects.</p> : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className={primary} disabled={busy} onClick={() => void start()} data-testid="mission-start">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}Start</button>
          <button className={quiet} disabled={busy} onClick={adjust} data-testid="mission-adjust"><SlidersHorizontal className="h-3.5 w-3.5" />Adjust</button>
          <button className={quiet} disabled={busy} onClick={() => setNo(true)} data-testid="mission-not-now"><X className="h-3.5 w-3.5" />Not now</button>
        </div>
      )}
      {err && <p className="mt-2 text-[13px] text-err">{err}</p>}
    </div>
  );
}

/** A domain page's active missions, as rows that open them. Absent when there are none. */
export function DomainMissions({ vaultPath, domain }: { vaultPath: string; domain: string }) {
  const { missions } = useMissions(vaultPath);
  const mine = missions.filter((m) => m.status === "active" && m.domains.some((d) => d.slug === domain));
  if (!mine.length) return null;
  return (
    <section data-testid="domain-missions" className="mb-4">
      <h3 className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-text-primary"><Target className="h-4 w-4 text-text-muted" />Projects</h3>
      <ul className="flex flex-col">
        {mine.map((m) => (
          <li key={m.slug}>
            <button onClick={() => openMission(m.slug)} data-testid={`domain-mission-${m.slug}`} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-surface-warm/60">
              <span className="min-w-0 flex-1 truncate text-[14px] text-text-primary">{m.name}</span>
              <span className="shrink-0 text-[12px] text-text-muted">{m.domains.find((d) => d.slug === domain)?.role === "owner" ? "owns" : m.domains.find((d) => d.slug === domain)?.role === "consulted" ? "reads" : "tells"}{daysLeftLabel(m) ? ` · ${daysLeftLabel(m)}` : ""}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
