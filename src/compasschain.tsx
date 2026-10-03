// The Compass chain (goals-plan.md G1b): purpose, values, mission statement,
// vision, objectives, goals, initiatives, missions and tasks, each linked to
// the one above. The engine builds the tree (`prevail compass tree --json`):
// every node with its parents and children and how many are not linked per
// level. This file reads it, walks a line up ("what it serves") and draws the
// Chain view: one indented tree, no drawers, nothing rendered when empty.
import { useState, type ReactNode } from "react";
import { ChevronRight, Link2, Loader2, X } from "lucide-react";
import { invoke } from "./bridge";
import { invalidateQueries, useInvokeQuery } from "./query";
import { META, ROW_TITLE } from "./typescale";
import { REVEAL, RowMenu } from "./ui";
import { openMission } from "./missions";
import { LineRow, type LineActions } from "./compasslines";
import type { LedgerRow } from "./compassmodel";

export type Level = "purpose" | "value" | "statement" | "vision" | "objective" | "goal" | "initiative" | "mission" | "task";
export interface ChainNode {
  id: string; level: Level; title: string; status: string; parents: string[]; children: string[]; linked: boolean;
  implicit?: boolean; domain?: string; metric?: string; target?: string; due?: string; needs?: string[];
  mission?: { slug: string; name: string; status: string }; local?: boolean;
}
export interface ChainTree {
  schema: number; nodes: ChainNode[];
  levels: { level: Level; label: string; count: number; notLinked: number }[];
  domainGoals: { total: number; linked: number }; tasks: { open: number; linked: number };
}
export interface LinkProposal { id: string; kind: string; from: string; to: string; fromTitle: string; toTitle: string; quote: string; source: string; by: string; status: string; domain?: string }

/** One noun per level, singular and plural, for meta lines ("2 goals"). */
export const LEVEL_NOUN: Record<Level, [string, string]> = {
  purpose: ["purpose", "purposes"], value: ["value", "values"], statement: ["mission statement", "mission statements"], vision: ["vision", "visions"],
  objective: ["objective", "objectives"], goal: ["goal", "goals"], initiative: ["initiative", "initiatives"], mission: ["project", "projects"], task: ["task", "tasks"],
};
export const LEVEL_LABEL: Record<Level, string> = {
  purpose: "Purpose", value: "Value", statement: "Mission statement", vision: "Vision", objective: "Objective", goal: "Goal", initiative: "Initiative", mission: "Project", task: "Task",
};
export const count = (n: number, l: Level) => `${n} ${LEVEL_NOUN[l][n === 1 ? 0 : 1]}`;

export function isTree(x: unknown): x is ChainTree {
  return !!x && typeof x === "object" && Array.isArray((x as ChainTree).nodes) && Array.isArray((x as ChainTree).levels);
}

export function useChainTree(vaultPath: string) {
  const q = useInvokeQuery<ChainTree>("engine_compass_tree", { vault: vaultPath }, { staleMs: 30_000 });
  return { tree: isTree(q.data) ? q.data : null, refresh: q.refresh };
}

export function useChainLinks(vaultPath: string) {
  const q = useInvokeQuery<LinkProposal[]>("engine_compass_links", { vault: vaultPath }, { staleMs: 30_000 });
  return { links: Array.isArray(q.data) ? q.data.filter((l) => l.status === "proposed") : [], refresh: q.refresh };
}

/** Walk up from a node: initiative, goal, objective, vision (the first parent wins; stops at the vision). */
export function walkUp(tree: ChainTree | null, id: string): ChainNode[] {
  if (!tree) return [];
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const out: ChainNode[] = [];
  const seen = new Set([id]);
  let cur = byId.get(id);
  while (cur && cur.parents.length) {
    const up = byId.get(cur.parents[0]);
    if (!up || seen.has(up.id)) break;
    out.push(up); seen.add(up.id);
    if (up.level === "vision" || up.level === "value" || up.level === "purpose") break;
    cur = up;
  }
  return out;
}

/** "Not linked: 2 goals · 1 mission": only the levels that have some. */
export function notLinkedLine(tree: ChainTree | null): string {
  if (!tree) return "";
  const bits = tree.levels.filter((l) => l.notLinked > 0).map((l) => count(l.notLinked, l.level));
  return bits.join(" · ");
}

/** Accept or turn down a proposed link, or link a goal to an objective; then everything that shows the chain reloads. */
export async function linkAction(vaultPath: string, action: "accept" | "decline" | "link", id: string, to?: string): Promise<void> {
  const r = await invoke<{ ok?: boolean; why?: string; error?: string }>("engine_compass_link", { vault: vaultPath, action, id, to: to ?? null });
  if (r && r.ok === false) throw new Error(r.why ?? r.error ?? "not done");
  invalidateQueries("engine_compass");
  invalidateQueries("engine_today");
}

/**
 * The Chain view: the whole chain as one indented tree from the purpose down.
 * A line with more than one parent is drawn once, under its first. Levels
 * below goals start folded. What is not linked is listed after, per level.
 */
export function ChainView({ vaultPath, tree, links, onChanged, actions, blankPurpose }: {
  vaultPath: string; tree: ChainTree | null; links: LinkProposal[]; onChanged: () => void;
  /** What a line can do here (open, edit, chat, confirm, drop): the same as on its own section. */
  actions?: (n: ChainNode) => (LineActions & { history?: LedgerRow[] }) | null;
  /** Drawn at the top when the chain has no purpose yet (write it, or write it together). */
  blankPurpose?: ReactNode;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (!tree) return <p className={META}>Reading the chain.</p>;
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const placed = new Set<string>();
  const folded = (n: ChainNode) => (n.id in open ? !open[n.id] : !["purpose", "value", "statement", "vision", "objective"].includes(n.level));
  // Values are drawn as one line under the purpose (most serve the same
  // statement, and a run of eight childless rows would push the chain down);
  // the statements they serve hang under that line.
  const values = tree.nodes.filter((n) => n.level === "value");
  const VALUES = "values:group";
  if (values.length) byId.set(VALUES, {
    id: VALUES, level: "value", title: values.map((v) => v.title).join(" · "), status: "confirmed", parents: [], linked: true,
    children: [...new Set(values.flatMap((v) => v.children))],
  });
  const childrenOf = (n: ChainNode) => n.level === "purpose" && values.length ? [VALUES, ...n.children.filter((c) => byId.get(c)?.level !== "value")] : n.children;
  const line = (n: ChainNode, depth: number): ReactNode => {
    if (placed.has(n.id) || depth > 10) return null;
    placed.add(n.id);
    if (n.id === VALUES) values.forEach((v) => placed.add(v.id));
    const kids = childrenOf(n).map((c) => byId.get(c)).filter((c): c is ChainNode => !!c && !placed.has(c.id));
    const isOpen = kids.length > 0 && !folded(n);
    const meta = [n.id === VALUES ? `Values · ${values.length}` : LEVEL_LABEL[n.level], n.status === "proposed" ? "Proposed" : "", n.level === "objective" && n.needs?.includes("metric") ? "No measure yet" : "", n.mission ? `Runs as ${n.mission.name}` : "", !isOpen && kids.length ? `${kids.length} below` : ""].filter(Boolean);
    const title = n.level === "mission"
      ? <button type="button" onClick={() => openMission(n.id.replace(/^mission\//, ""))} className="text-left hover:text-accent">{n.title}</button>
      : n.title;
    return (
      <li key={n.id} data-testid="chain-node" data-level={n.level} data-id={n.id}>
        <div className="flex items-start gap-1.5 py-1">
          {kids.length ? (
            <button type="button" onClick={() => setOpen((o) => ({ ...o, [n.id]: !isOpen }))} aria-expanded={isOpen} aria-label={`${isOpen ? "Fold" : "Unfold"} ${n.title}`} className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted hover:text-accent">
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
            </button>
          ) : <span className="w-5 shrink-0" aria-hidden />}
          {(() => {
            const act = n.id === VALUES ? null : actions?.(n);
            if (act) return (
              <div className="min-w-0 flex-1">
                <LineRow plain id={n.id} title={n.title} testId="chain-line" proposed={n.status === "proposed"} multiline={n.level === "purpose"}
                  display={n.level === "purpose" ? <span className="font-display text-[17px] leading-snug">{n.title}</span> : undefined}
                  meta={<span className="truncate">{meta.join(" · ")}</span>} {...act} />
              </div>
            );
            return (
              <div className="min-w-0 flex-1">
                <p title={n.title} className={`${n.level === "purpose" ? "font-display text-[17px] leading-snug text-text-primary" : n.level === "task" ? "text-[14px] leading-snug text-text-secondary" : ROW_TITLE} line-clamp-2 break-words`}>{title}</p>
                <p className={`${META} mt-0.5 truncate`}>{meta.join(" · ")}</p>
              </div>
            );
          })()}
        </div>
        {isOpen && <ul className="ml-2.5 border-l border-border-subtle pl-3">{kids.map((k) => line(k, depth + 1))}</ul>}
      </li>
    );
  };
  const roots = tree.nodes.filter((n) => n.linked && !n.parents.length);
  if (!roots.some((n) => n.level === "purpose") && values.length) roots.unshift(byId.get(VALUES)!);
  const body = roots.map((n) => line(n, 0));
  // What is not linked: per level, folded under one line each (tasks only counted).
  const loose = tree.levels.filter((l) => l.notLinked > 0 && l.level !== "task" && l.level !== "purpose").map((l) => ({ l, nodes: tree.nodes.filter((n) => n.level === l.level && !n.linked && !placed.has(n.id) && !["rejected", "retired", "achieved", "released"].includes(n.status)) }));
  const nl = notLinkedLine(tree);
  const run = async (key: string, f: () => Promise<void>, done: string) => {
    setBusy(key); setMsg(null);
    try { await f(); setMsg(done); onChanged(); } catch (e) { setMsg(`Not done: ${String(e).replace(/^Error: /, "")}`); } finally { setBusy(null); }
  };
  return (
    <div data-testid="chain-view">
      {nl && <p className={`${META} mt-1`} data-testid="chain-not-linked" title="Links are never forced: a line that is not linked still counts.">Not linked: {nl}</p>}
      {links.length > 0 && (
        <section className="mt-5" data-testid="chain-links">
          <h3 className="text-[15px] font-semibold text-text-primary">Links to check</h3>
          <ul className="mt-1">{links.map((l) => (
            <li key={l.id} data-testid="chain-link" className="group flex items-start gap-2 border-b border-border-subtle py-2 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className={`${ROW_TITLE} line-clamp-2 break-words`} title={`${l.fromTitle} moves ${l.toTitle}`}>{l.fromTitle}</p>
                <p className={`${META} mt-0.5 line-clamp-2`} title={`"${l.quote}"`}>Moves {l.toTitle} · from {l.by === "code" ? "the same words" : l.by === "conversation" ? "your Compass conversation" : "your notes"}</p>
              </div>
              <span className={`flex shrink-0 items-center gap-0.5 ${REVEAL}`}>
                <button onClick={() => void run(l.id, () => linkAction(vaultPath, "accept", l.id), "Linked.")} disabled={!!busy} data-testid="chain-link-accept" className="inline-flex h-7 items-center gap-1 px-1 text-[13px] font-medium text-accent hover:underline disabled:opacity-50">
                  {busy === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} Link
                </button>
                <RowMenu items={[{ icon: X, label: "Not linked", hint: "Keep them apart", onClick: () => void run(l.id, () => linkAction(vaultPath, "decline", l.id), "Left apart.") }]} />
              </span>
            </li>
          ))}</ul>
        </section>
      )}
      {msg && <p className={`${META} mt-2`} data-testid="chain-msg">{msg}</p>}
      {!tree.nodes.some((n) => n.level === "purpose") && blankPurpose}
      {body.length > 0 && <ul className="mt-4" data-testid="chain-tree">{body}</ul>}
      {loose.some((x) => x.nodes.length) && (
        <section className="mt-6" data-testid="chain-loose">
          <h3 className="text-[15px] font-semibold text-text-primary">Not linked yet</h3>
          {loose.filter((x) => x.nodes.length).map(({ l, nodes }) => (
            <details key={l.level} className="mt-1">
              <summary className={`${META} cursor-pointer py-1 hover:text-accent`}>{l.label} ({nodes.length})</summary>
              <ul className="ml-2.5 border-l border-border-subtle pl-3">{nodes.map((n) => line(n, 1))}</ul>
            </details>
          ))}
        </section>
      )}
      {!body.length && !loose.some((x) => x.nodes.length) && <p className={`${META} mt-4`}>Nothing in the chain yet.</p>}
    </div>
  );
}

/** What a line serves and what moves it, for a Compass row: one meta fragment each, and the children on demand. */
export function chainBits({ node, tree }: { node: ChainNode | undefined; tree: ChainTree | null }): { up: ReactNode | null; down: ReactNode | null; list: (open: boolean) => ReactNode } {
  if (!node || !tree) return { up: null, down: null, list: () => null };
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const ups = node.parents.map((p) => byId.get(p)).filter((x): x is ChainNode => !!x);
  const chainLevel = ["statement", "vision", "objective", "goal"].includes(node.level);
  const upWord = node.level === "statement" ? "Serves" : "Toward";
  const full = walkUp(tree, node.id).map((n) => n.title).join(" > ");
  const up = ups.length
    ? <span data-testid="chain-up" title={full}>{upWord} {ups.map((u) => u.title).join(", ")}</span>
    : chainLevel ? <span data-testid="chain-not-linked-row">Not linked{node.level === "goal" ? " to an objective" : ""}</span> : null;
  const kids = node.children.map((c) => byId.get(c)).filter((x): x is ChainNode => !!x);
  const byLevel = new Map<Level, number>();
  for (const k of kids) byLevel.set(k.level, (byLevel.get(k.level) ?? 0) + 1);
  const downText = [...byLevel].map(([l, n]) => count(n, l)).join(", ");
  return {
    up,
    down: kids.length ? <span data-testid="chain-down">Moved by {downText}</span> : null,
    list: (open) => open && kids.length ? (
      <ul className="mt-1.5 border-l border-border-subtle pl-3" data-testid="chain-children">
        {kids.map((k) => <li key={k.id} className="py-0.5 text-[14px] leading-snug text-text-secondary"><span className="line-clamp-2 break-words" title={k.title}>{k.title}</span><span className={META}>{LEVEL_LABEL[k.level]}{k.mission ? ` · Runs as ${k.mission.name}` : ""}{k.status === "proposed" ? " · Proposed" : ""}</span></li>)}
      </ul>
    ) : null,
  };
}


/** A line's whole way up, nearest first, to the purpose: goal > objective > vision > mission statement > purpose (values skipped). */
export function chainUp(tree: ChainTree | null, id: string): ChainNode[] {
  if (!tree) return [];
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const out: ChainNode[] = [];
  const seen = new Set([id]);
  let cur = byId.get(id);
  while (cur) {
    const up: ChainNode | undefined = cur.parents.map((p) => byId.get(p)).find((p): p is ChainNode => !!p && !seen.has(p.id));
    if (!up) break;
    seen.add(up.id);
    if (up.level !== "value") out.push(up);
    cur = up;
  }
  const purpose = tree.nodes.find((n) => n.level === "purpose");
  if (purpose && !out.some((n) => n.id === purpose.id) && id !== purpose.id) out.push(purpose);
  return out;
}

/** The chain up as a short vertical list under an opened line. */
export function ChainUpList({ tree, id }: { tree: ChainTree | null; id: string }) {
  const up = chainUp(tree, id);
  if (!up.length) return <p className={`${META} mt-1`} data-testid="chain-up-none">Not linked to anything above yet.</p>;
  return (
    <ol className="mt-1.5 ml-[5px] border-l border-border-subtle pl-4" data-testid="chain-up-list" aria-label="What it serves">
      {up.map((n) => (
        <li key={n.id} className="py-0.5">
          <span className="block text-[12px] text-text-muted">{LEVEL_LABEL[n.level]}</span>
          <span className="line-clamp-2 break-words text-[14px] leading-snug text-text-secondary" title={n.title}>{n.title}</span>
        </li>
      ))}
    </ol>
  );
}
