// Linking: a conversation lives in one place but touches many. After a reply
// the engine names the other domains and your own entities it touched (the
// `touched` chat event) and writes one dated fact line to each of them
// (`prevail updates`). This file draws that reach: the quiet "Also noted in"
// line under a reply, "Across your life" on a domain and an entity, "Your
// things" on a domain, and the Yours / Reference split of entities.
import { useState, type ReactNode } from "react";
import { ArrowRight, MessagesSquare } from "lucide-react";
import { invoke } from "./bridge";
import { useInvokeQuery, invalidateQueries } from "./query";
import { titleCase } from "./format";
import { domainColor } from "./helpers";
import { domainIcon } from "./icons";
import { requestEntity, useEntityStore, type EntityKindName, type EntitySummary } from "./entitystore";
import { resolveThreadPath } from "./entitythreads";
import { BODY, META } from "./typescale";
import { REVEAL } from "./ui";

// Fired after a `touched` event, so every "Across your life" list refetches.
export const TOUCHED_EVENT = "prevail:touched";

export interface Touched { thread?: string; ts?: number; domains: { slug: string; fact?: string }[]; entities: string[] }

export interface UpdateLine {
  ts: string | number;
  from_domain: string;
  thread: string;
  fact: string;
  entities?: string[];
  target?: { kind: "domain"; slug: string } | { kind: "entity"; id: string };
}

export type Relation = "yours" | "reference";

// An entity counts as yours unless the engine says it is only a reference (an
// engine without relations yet leaves every entity where it was).
export const isYours = (e: { relation?: string } | null | undefined): boolean => e?.relation !== "reference";

// The `touched` event, cleaned: known shapes only, never the home domain twice.
export function parseTouched(ev: { thread?: string; ts?: unknown; domains?: unknown; entities?: unknown }): Touched | null {
  const domains = (Array.isArray(ev.domains) ? ev.domains : [])
    .map((d) => (typeof d === "string" ? { slug: d } : d && typeof d === "object" && typeof (d as { slug?: unknown }).slug === "string" ? { slug: (d as { slug: string }).slug, fact: typeof (d as { fact?: unknown }).fact === "string" ? (d as { fact: string }).fact : undefined } : null))
    .filter((d): d is { slug: string; fact?: string } => !!d && !!d.slug);
  const entities = (Array.isArray(ev.entities) ? ev.entities : []).filter((x): x is string => typeof x === "string" && x.includes("/"));
  if (!domains.length && !entities.length) return null;
  return { thread: ev.thread, ...(typeof ev.ts === "number" ? { ts: ev.ts } : {}), domains, entities };
}

const tsOf = (t: string | number) => (typeof t === "number" ? t : Date.parse(t));
function fmtDay(t: string | number): string {
  const ms = tsOf(t);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

function fire(name: string, detail?: unknown) { window.dispatchEvent(new CustomEvent(name, { detail })); }

const entityName = (id: string, byId: Map<string, EntitySummary>) =>
  byId.get(id)?.name ?? titleCase(decodeURIComponent(id.slice(id.indexOf("/") + 1)));

function openEntityId(id: string) {
  const i = id.indexOf("/");
  requestEntity({ kind: id.slice(0, i) as EntityKindName, value: id.slice(i + 1) });
}

// The conversation an update came from, opened in its own domain.
export async function openUpdateThread(vaultPath: string, u: UpdateLine) {
  const path = await resolveThreadPath(vaultPath, { slug: u.thread, domain: u.from_domain, title: "", updated: 0, turns: 0 }).catch(() => null);
  const root = `${vaultPath.replace(/\/+$/, "")}/`;
  if (path && path.startsWith(root)) fire("prevail:open-thread", { domain: u.from_domain || "general", ref: path.slice(root.length) });
  else fire("prevail:open-domain", u.from_domain === "general" ? "" : u.from_domain);
}

/** A domain's or an entity's update lines, newest first, refreshed on each touch. */
export function useUpdates(vaultPath: string | null, target: { domain: string } | { entity: string } | null, limit = 50) {
  const q = useInvokeQuery<UpdateLine[] | { updates?: UpdateLine[] }>("engine_updates", vaultPath && target ? { vault: vaultPath, ...target, limit } : null, { invalidateOn: [TOUCHED_EVENT] });
  const raw = Array.isArray(q.data) ? q.data : q.data?.updates ?? [];
  const lines = raw.filter((u) => u && typeof u.fact === "string").sort((a, b) => tsOf(b.ts) - tsOf(a.ts));
  return { lines, loading: q.loading };
}

// A domain as a quiet label (its icon in the domain colour) that opens it.
// Text, not a tinted pill, so a row of them never reads as a row of chips.
export function DomainChip({ slug, still = false }: { slug: string; still?: boolean }) {
  const color = domainColor(slug);
  const Icon = domainIcon(slug);
  const inner = <>{Icon && <Icon size={12} aria-hidden style={{ color }} />}{titleCase(slug)}</>;
  // Inside another button (an entity row) it is a plain label, never a nested button.
  if (still) return <span data-testid="domain-chip" className="inline-flex shrink-0 items-center gap-1 text-[12px] text-text-secondary">{inner}</span>;
  return (
    <button type="button" data-testid="domain-chip" onClick={() => fire("prevail:open-domain", slug === "general" ? "" : slug)} title={`Open ${titleCase(slug)}`}
      className="inline-flex shrink-0 items-center gap-1 text-[12px] text-text-secondary hover:text-accent">
      {inner}
    </button>
  );
}

// Under a reply: "Noted in Content, Real Estate · Foo Way · Undo". Each name
// opens it; Undo takes back exactly the lines this turn wrote in those domains.
export function TouchedLine({ touched, onUndo, undone = false }: { touched: Touched; onUndo?: () => Promise<void> | void; undone?: boolean }) {
  const { byId } = useEntityStore();
  const [busy, setBusy] = useState(false);
  const link = "font-medium text-text-secondary underline decoration-border underline-offset-[3px] hover:text-accent hover:decoration-accent";
  if (undone && !touched.entities.length) return <p data-testid="touched-line" className="mt-1.5 px-1 text-[12px] text-text-muted">Taken back from {touched.domains.map((d) => titleCase(d.slug)).join(", ")}.</p>;
  const domains = undone ? [] : touched.domains;
  return (
    <p data-testid="touched-line" className="mt-1.5 flex flex-wrap items-baseline gap-x-1 px-1 text-[12px] text-text-muted">
      <span>{domains.length ? "Noted in" : "About"}</span>
      {domains.map((d, i) => (
        <span key={d.slug}>
          <button type="button" data-testid="touched-domain" title={d.fact} onClick={() => fire("prevail:open-domain", d.slug)} className={link}>{titleCase(d.slug)}</button>
          {i < domains.length - 1 ? "," : ""}
        </span>
      ))}
      {touched.entities.length > 0 && domains.length > 0 && <span aria-hidden>·</span>}
      {touched.entities.map((id, i) => (
        <span key={id}>
          <button type="button" data-testid="touched-entity" onClick={() => openEntityId(id)} className={link}>{entityName(id, byId)}</button>
          {i < touched.entities.length - 1 ? "," : ""}
        </span>
      ))}
      {onUndo && domains.length > 0 && touched.ts && (
        <>
          <span aria-hidden>·</span>
          <button type="button" data-testid="touched-undo" disabled={busy} onClick={() => { setBusy(true); void Promise.resolve(onUndo()).finally(() => setBusy(false)); }} className="hover:text-accent disabled:opacity-50">{busy ? "Undoing" : "Undo"}</button>
        </>
      )}
    </p>
  );
}

// Under a reply: "Saved a decision: Learn piano · Open · Undo".
export function DecisionReceipt({ decision, onUndo, undone = false }: { decision: { domain: string; slug: string; what: string }; onUndo?: () => Promise<void> | void; undone?: boolean }) {
  const [busy, setBusy] = useState(false);
  if (undone) return <p data-testid="decision-receipt" className="mt-1 px-1 text-[12px] text-text-muted">Decision taken back.</p>;
  const open = () => {
    try { localStorage.setItem("prevail.decisions.focus", `${decision.domain}/${decision.slug}`); } catch { /* storage off */ }
    fire("prevail:work-section", "decisions");
    fire("prevail:decisions-focus", `${decision.domain}/${decision.slug}`);
  };
  return (
    <p data-testid="decision-receipt" className="mt-1 flex flex-wrap items-baseline gap-x-1 px-1 text-[12px] text-text-muted">
      <span>Saved a decision:</span>
      <button type="button" onClick={open} title="Open it in Decisions" className="font-medium text-text-secondary underline decoration-border underline-offset-[3px] hover:text-accent hover:decoration-accent">{decision.what}</button>
      {onUndo && <><span aria-hidden>·</span><button type="button" data-testid="decision-undo" disabled={busy} onClick={() => { setBusy(true); void Promise.resolve(onUndo()).finally(() => setBusy(false)); }} className="hover:text-accent disabled:opacity-50">{busy ? "Undoing" : "Undo"}</button></>}
    </p>
  );
}

function UpdateRow({ u, vaultPath, showSource }: { u: UpdateLine; vaultPath: string; showSource: boolean }) {
  return (
    <li data-testid="update-row" className="group flex items-start gap-3 border-b border-border-subtle py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className={`${BODY} text-text-primary`}>{u.fact}</p>
        <div className={`${META} mt-0.5 flex flex-wrap items-center gap-x-1.5`}>
          <span>{fmtDay(u.ts)}</span>
          {showSource && u.from_domain && <><span aria-hidden>·</span><span>From</span><DomainChip slug={u.from_domain} /></>}
        </div>
      </div>
      {u.thread && (
        <button type="button" data-testid="update-open-thread" onClick={() => { void openUpdateThread(vaultPath, u); }} title="Open the conversation" aria-label="Open the conversation"
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-strong hover:text-accent ${REVEAL}`}>
          <MessagesSquare className="h-4 w-4" aria-hidden />
        </button>
      )}
    </li>
  );
}

// "Across your life": what conversations elsewhere noted for this domain or entity.
export function AcrossYourLife({ vaultPath, target, emptyName, wrap }: { vaultPath: string; target: { domain: string } | { entity: string }; emptyName: string; wrap?: (n: ReactNode) => ReactNode }) {
  const { lines, loading } = useUpdates(vaultPath, target);
  // Wrapped (an entity page), it shows only once there is something to show.
  if (wrap) return loading || !lines.length ? null : <>{wrap(<ul data-testid="across-list" className="max-w-3xl">{lines.map((u, i) => <UpdateRow key={`${u.ts}:${u.thread}:${i}`} u={u} vaultPath={vaultPath} showSource />)}</ul>)}</>;
  if (loading) return <p className={META}>Reading updates</p>;
  if (!lines.length) {
    return <p data-testid="across-empty" className={META}>Nothing from other domains yet. When a conversation somewhere else touches {emptyName}, it shows here.</p>;
  }
  return <ul data-testid="across-list" className="max-w-3xl">{lines.map((u, i) => <UpdateRow key={`${u.ts}:${u.thread}:${i}`} u={u} vaultPath={vaultPath} showSource />)}</ul>;
}

// The compact card on a domain chat's empty state. Nothing when there is nothing.
export function AcrossCard({ vaultPath, domain, onOpen }: { vaultPath: string; domain: string; onOpen: () => void }) {
  const { lines } = useUpdates(vaultPath, { domain });
  if (!lines.length) return null;
  const from = [...new Set(lines.map((u) => u.from_domain).filter(Boolean))].slice(0, 3).map(titleCase).join(", ");
  return (
    <button type="button" data-testid="across-card" onClick={onOpen}
      className="group mb-3 flex w-full items-center gap-3 border-b border-border-subtle pb-2.5 text-left">
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-text-primary group-hover:text-accent">{lines.length} {lines.length === 1 ? "update" : "updates"} from other domains</span>
        <span className={`${META} block truncate`} title={lines[0].fact}>{from ? `From ${from} · ` : ""}{lines[0].fact}</span>
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-muted group-hover:text-accent" aria-hidden />
    </button>
  );
}

// Your entities whose home is this domain.
export function yoursIn(entities: EntitySummary[], domain: string): EntitySummary[] {
  return entities.filter((e) => e.relation === "yours" && e.home_domain === domain)
    .sort((a, b) => b.conversations - a.conversations);
}

export async function setRelation(vaultPath: string, id: string, relation: Relation): Promise<void> {
  await invoke("engine_entities_set_relation", { vault: vaultPath, id, relation });
  invalidateQueries("entities_show");
  fire("prevail:entities-changed");
}

// ── Undo for the receipts under a reply ──────────────────────────────────
// The engine takes back exactly what that turn wrote; the thread keeps a
// note that it was undone (the chat panel listens for RECEIPT_UNDONE).
export const RECEIPT_UNDONE = "prevail:receipt-undone";
const vaultOf = () => { try { return localStorage.getItem("prevail.desktop.vaultPath") ?? ""; } catch { return ""; } };

export async function undoTouched(t: Touched): Promise<void> {
  if (!t.ts || !t.thread) return;
  await invoke("engine_touch_undo", { vault: vaultOf(), thread: t.thread, ts: t.ts, domains: t.domains.map((d) => d.slug) });
  invalidateQueries("engine_updates");
  fire(RECEIPT_UNDONE, { kind: "noted", ts: t.ts });
}

export async function undoDecision(d: { domain: string; slug: string }): Promise<void> {
  await invoke("engine_decision_undo", { vault: vaultOf(), domain: d.domain, slug: d.slug });
  invalidateQueries("engine_decisions");
  fire(RECEIPT_UNDONE, { kind: "decision", slug: d.slug });
}

