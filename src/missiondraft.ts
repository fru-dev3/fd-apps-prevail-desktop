// The chat-first New mission, model side: the draft the engine fills as the
// user talks (`prevail missions draft`), and the one quiet summary line that
// shows what is settled so far. The engine checks every field; this file only
// shapes it for the page.
import { invoke } from "./bridge";
import { titleCase } from "./format";

export interface DraftTurn { role: "user" | "assistant"; text: string }
export interface MissionDraft {
  name?: string; outcome?: string; why?: string; start?: string; target?: string;
  owner?: string; consult?: string[]; inform?: string[];
  apps?: string[]; specialists?: string[]; people?: string[];
  budgetUsd?: number; hoursWk?: number;
  milestones?: { title: string; due?: string }[];
  match?: { calendar?: string[]; email_from?: string[]; merchants?: string[] };
}
export interface DraftReply {
  draft: MissionDraft; filled: string[]; dropped: { field: string; value: string; why: string }[];
  question: string | null; reply: string; ready: boolean; missing: string[]; go: boolean;
}

export const draftTurn = (vault: string, turns: DraftTurn[], draft: MissionDraft) =>
  invoke<DraftReply>("engine_missions_draft", { vault, turns, draft });

export const NEW_MODE_KEY = "prevail.missions.newMode";

/** Starters: tappable openings that go into the composer for the user to finish. */
export const STARTERS = [
  "I want to learn to ",
  "Plan a trip to ",
  "Fix up the ",
  "Ship my side project by ",
];

export function fmtDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
export const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const person = (id: string) => titleCase(id.replace(/^[a-z]+\//, "").replace(/-/g, " "));

/** The settled fields as short bits, in reading order, each keyed by its field. */
export function summaryBits(d: MissionDraft): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  if (d.name) out.push({ key: "name", text: d.name });
  if (d.target) out.push({ key: "target", text: `by ${fmtDate(d.target)}` });
  if (d.owner) out.push({ key: "owner", text: `${titleCase(d.owner)} owns it` });
  if (d.consult?.length) out.push({ key: "consult", text: `reads ${d.consult.map(titleCase).join(", ")}` });
  if (d.inform?.length) out.push({ key: "inform", text: `tells ${d.inform.map(titleCase).join(", ")}` });
  if (d.budgetUsd != null) out.push({ key: "budgetUsd", text: usd(d.budgetUsd) });
  if (d.hoursWk != null) out.push({ key: "hoursWk", text: `${d.hoursWk} h a week` });
  if (d.people?.length) out.push({ key: "people", text: `with ${d.people.map(person).join(", ")}` });
  if (d.apps?.length) out.push({ key: "apps", text: d.apps.map(titleCase).join(", ") });
  if (d.milestones?.length) out.push({ key: "milestones", text: `${d.milestones.length} milestone${d.milestones.length === 1 ? "" : "s"}` });
  return out;
}

/** What the Fields form needs to stay in step with the chat. */
export function draftFromFields(d: MissionDraft, f: { name: string; outcome: string; target: string; owner: string; budget: string }): MissionDraft {
  const b = Number(f.budget);
  const next: MissionDraft = { ...d, name: f.name.trim() || undefined, outcome: f.outcome.trim() || undefined, target: f.target || undefined, owner: f.owner || undefined, budgetUsd: f.budget && Number.isFinite(b) ? b : undefined };
  return Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as MissionDraft;
}
