// Compass: the one page for what the user lives by. It replaces Goals and
// Ideals. Three views, picked by the header tabs, each a SideSpine page:
//   Compass  the chain from build/compass.md (compassmodel.ts): purpose,
//            values, mission statement, vision, objectives, life goals and
//            their initiatives, then roles, rules and routines. Groups read by
//            indentation and one thin vertical line under a small header.
//            Every line is interactive (compasslines.tsx): click opens it with
//            its history, edit in place, chat about it, and a drafted line can
//            be confirmed or dropped. A goal opens on its chain up. History is
//            one list of every change; the yearly review lists every year.
//   Goals    each domain's goals (source/goals.md), as the Goals page had them.
//   Ideals   the constitution, Omega and every domain's ideal state.
// Owner feedback round 1 (2026-10-02): no charts here for now, and Household
// and Packs are gone.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarHeart, CheckCheck, Compass, Download, Eye, Flag, GitFork, History, LayoutList, Link2, Loader2, MessageSquare, Milestone, Repeat, Scale, Sparkles, Star, Target, Users, X } from "lucide-react";
import { YearlyReviews, exportCompass } from "./compasslife";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { SettingsHeader } from "./sectionutil";
import { SideSpine, SpineTabs } from "./sidespine";
import { useIsPhone, useStacked } from "./useisphone";
import { BODY, DETAIL_TITLE, META } from "./typescale";
import {
  addLine, archiveLine, changeText, confirmLines, deleteLine, dropLines, editLine, fieldOf, isArchived, isProposed, items, missionOf, parseCompass, proposedCount, rankOf, serializeCompass,
  type CompassDoc, type CompassItem, type LedgerChange, type LedgerRow, type LineKind,
} from "./compassmodel";
import { DomainGoals } from "./goalspage";
import { IdealsSection } from "./idealspage";
import { useChiefOfStaff } from "./chiefofstaff";
import { AlignNeedsYou, AlignRules } from "./alignpanel";
import { Initiatives } from "./initiatives";
import { ChainUpList, ChainView, LEVEL_LABEL, chainBits, linkAction, notLinkedLine, useChainLinks, useChainTree, type ChainNode } from "./compasschain";
import { AddLine, Group, LineRow, Meta, type LineActions } from "./compasslines";
import { chatAbout } from "./chatabout";
import type { RowMenuItem } from "./ui";

type View = "compass" | "goals" | "ideals";
type Sel = "overview" | "chain" | "mission" | "values" | "statement" | "vision" | "objectives" | "roles" | "goals" | "rules" | "routines" | "history" | "yearly";
export const COMPASS_FOCUS_KEY = "prevail.compass.focus";

const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";
const KIND_WORD: Record<string, string> = { value: "value", statement: "mission statement", vision: "vision", objective: "objective", goal: "life goal", role: "role", rule: "non-negotiable", negotiable: "negotiable", routine: "routine", mission: "purpose" };

function readFocus(): { view: View; row: string | null } {
  try {
    const f = localStorage.getItem(COMPASS_FOCUS_KEY) ?? "";
    localStorage.removeItem(COMPASS_FOCUS_KEY);
    const [v, row] = f.split(":");
    if (v === "goals" || v === "ideals" || v === "compass") return { view: v, row: row || null };
  } catch { /* storage off */ }
  return { view: "compass", row: null };
}

/** A routine's cadence in words (weekly, 3x-week, 5d...). */
export function cadenceLabel(c: string): string {
  const m = /^(\d+)x-?week$/.exec(c);
  if (m) return `${m[1]} times a week`;
  const d = /^(\d+)d$/.exec(c);
  if (d) return `Every ${d[1]} days`;
  return c === "daily" ? "Every day" : c === "weekly" ? "Every week" : c === "monthly" ? "Every month" : c;
}

const fmtDay = (d: string | number) => { const x = typeof d === "number" ? new Date(d) : new Date(`${d}T12:00:00Z`); return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
const cleanPurpose = (t: string) => t.replace(/^>\s*/gm, "").replace(/\*\*/g, "");

/** The seed for "Chat about it": what the line is, where it sits, and what to do. */
export function lineSeed(kind: string, title: string, proposed: boolean): string {
  const what = KIND_WORD[kind] ?? "line";
  return proposed
    ? `Let's look at a ${what} drafted for my Compass from my notes: "${title}". Help me decide whether to keep it, change the words, or drop it.`
    : `Let's talk about my ${what} "${title}" from my Compass. `;
}

export function CompassPage({ vaultPath }: { vaultPath: string }) {
  // Below 1100px the detail beside the list is too narrow: stack like the phone.
  const isPhone = useIsPhone();
  const stacked = useStacked();
  const phone = isPhone || stacked;
  const chief = useChiefOfStaff(vaultPath);
  const [focus] = useState(readFocus);
  const [view, setView] = useState<View>(focus.view);
  const [idealRow, setIdealRow] = useState<string | null>(focus.row);
  const [sel, setSel] = useState<Sel>("overview");
  const [picked, setPicked] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);

  const load = useCallback(async () => {
    setText(await invoke<string>("compass_read", { vault: vaultPath }).catch(() => ""));
  }, [vaultPath]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    invoke<LedgerRow[]>("compass_ledger", { vault: vaultPath }).then((l) => setLedger(Array.isArray(l) ? l : [])).catch(() => setLedger([]));
  }, [vaultPath, text]);
  // A deep link (an old Goals or Ideals link) can switch the view while open.
  useEffect(() => {
    const on = () => { const f = readFocus(); setView(f.view); if (f.row) setIdealRow(f.row); };
    window.addEventListener("prevail:compass-focus", on);
    return () => window.removeEventListener("prevail:compass-focus", on);
  }, []);

  const doc: CompassDoc = useMemo(() => parseCompass(text ?? ""), [text]);
  const mission = missionOf(doc);
  const live = (k: LineKind) => items(doc, k).filter((x) => !isArchived(x));
  const values = live("value").sort((a, b) => rankOf(a) - rankOf(b));
  const roles = items(doc, "role");
  const goals = live("goal");
  const rules = live("rule");
  const negotiables = live("negotiable");
  const routines = live("routine");
  const statements = live("statement");
  const visions = live("vision");
  const objectives = live("objective");
  const { tree, refresh: refreshTree } = useChainTree(vaultPath);
  const { links, refresh: refreshLinks } = useChainLinks(vaultPath);
  const nodeOf = useMemo(() => new Map((tree?.nodes ?? []).map((n) => [n.id, n])), [tree]);
  const notLinked = (lvl: string) => tree?.levels.find((l) => l.level === lvl)?.notLinked ?? 0;
  const proposed = proposedCount(doc);
  const empty = !mission?.text && !items(doc).length;
  const valueTitle = new Map(values.map((v) => [v.id, v.title]));
  const historyOf = (id: string) => ledger.filter((l) => l.id === id);
  const sinceOf = (it: CompassItem) => it.tokens.added ?? (() => { const h = historyOf(it.id); return h.length ? h[h.length - 1].ts : null; })();

  const write = async (next: { doc: CompassDoc; changes: LedgerChange[] }, label: string) => {
    if (!next.changes.length) return;
    setErr(null); setBusy(label);
    try {
      const body = serializeCompass(next.doc);
      await invoke("compass_write", { vault: vaultPath, body, changes: next.changes });
      setText(body);
      void refreshTree();
    } catch (e) { setErr(`Could not save: ${String(e)}`); }
    finally { setBusy(null); }
  };
  const confirmIds = (ids: string[] | "all") => write(confirmLines(doc, ids), ids === "all" ? "all" : ids[0]);
  const dropIds = (ids: string[]) => write(dropLines(doc, ids), ids[0]);
  const add = (kind: LineKind) => (t: string) => write(addLine(doc, kind, t), `add:${kind}`);
  const draft = async () => {
    setErr(null); setBusy("draft");
    try { await invoke("engine_compass_bootstrap", { vault: vaultPath }); await load(); }
    catch (e) { setErr(`Could not draft: ${String(e)}`); }
    finally { setBusy(null); }
  };
  const draftChain = async () => {
    setErr(null); setBusy("chain");
    try { await invoke("engine_compass_bootstrap", { vault: vaultPath, chain: true }); await load(); void refreshTree(); void refreshLinks(); }
    catch (e) { setErr(`Could not draft: ${String(e)}`); }
    finally { setBusy(null); }
  };
  const link = async (action: "accept" | "decline" | "link", id: string, to?: string) => {
    setErr(null); setBusy(`link:${id}`);
    try { await linkAction(vaultPath, action, id, to); await load(); void refreshTree(); void refreshLinks(); }
    catch (e) { setErr(`Not linked: ${String(e).replace(/^Error: /, "")}`); }
    finally { setBusy(null); }
  };
  const draftRoutines = async () => {
    setErr(null); setBusy("routines");
    try { await invoke("engine_routines", { vault: vaultPath, bootstrap: true }); await load(); }
    catch (e) { setErr(`Could not draft routines: ${String(e)}`); }
    finally { setBusy(null); }
  };
  const talk = () => chatAbout("Let's set up my Compass");

  const choose = (s: Sel) => { setSel(s); setPicked(true); };
  const isOn = (s: Sel) => sel === s && (!phone || picked);
  const row = (s: Sel, label: string, Icon: typeof Compass, count?: number, sub?: string) => (
    <button key={s} data-testid={`compass-row-${s}`} aria-current={isOn(s) ? "true" : undefined} onClick={() => choose(s)}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${isOn(s) ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
      <Icon className={`h-4 w-4 shrink-0 ${isOn(s) ? "text-accent" : "text-text-muted"}`} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[14px] ${isOn(s) ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{label}</span>
        {sub && <span className="block truncate text-[12px] text-text-muted">{sub}</span>}
      </span>
      {count !== undefined && <span className="shrink-0 text-[12px] tabular-nums text-text-muted">{count}</span>}
    </button>
  );
  const list = (
    <nav className="space-y-0.5 p-2" aria-label="Compass">
      {row("overview", "Overview", LayoutList, undefined, proposed ? `${proposed} waiting for you` : undefined)}
      {row("chain", "Chain", GitFork, undefined, notLinkedLine(tree) ? `Not linked: ${notLinkedLine(tree)}` : undefined)}
      {row("mission", "Purpose", Compass, undefined, mission?.text ? cleanPurpose(mission.text).split("\n")[0] : "Not written yet")}
      {row("values", "Values", Star, values.length)}
      {row("statement", "Mission statement", Flag, statements.length)}
      {row("vision", "Vision", Eye, visions.length)}
      {row("objectives", "Objectives", Milestone, objectives.length)}
      {row("goals", "Life goals", Target, goals.length)}
      <div className="mx-2.5 my-1.5 border-t border-border-subtle" aria-hidden />
      {row("roles", "Roles", Users, roles.filter((r) => !isArchived(r)).length)}
      {row("rules", "Rules", Scale, rules.length + negotiables.length)}
      {row("routines", "Routines", Repeat, routines.length)}
      <div className="mx-2.5 my-1.5 border-t border-border-subtle" aria-hidden />
      {row("history", "History", History, undefined, "Every change")}
      {row("yearly", "Yearly review", CalendarHeart, undefined, "Once a year")}
    </nav>
  );

  const sourceLabel = (from: string) => {
    const m = from.match(/data\/domains\/([^/]+)\//);
    if (m) return `${titleCase(m[1])} notes`;
    if (from.includes("user.md")) return "Your profile";
    if (from.includes("constitution") || from.endsWith("ideal-state.md")) return "Your constitution";
    return from.split("/").pop() ?? from;
  };
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9$%+]+/g, " ").trim();

  // What a line can do, the same everywhere it is shown (its section, the
  // overview and the chain).
  const lineActions = (it: CompassItem): LineActions & { history: LedgerRow[] } => {
    const prop = isProposed(it);
    const proposedLink = links.find((l) => l.from === it.id && l.kind === "goal-objective");
    const node = nodeOf.get(it.id);
    const linkTargets = it.kind === "goal" && node && !node.parents.length ? objectives.filter((o) => !isProposed(o)).slice(0, 8) : [];
    const more: RowMenuItem[] = [
      ...(proposedLink ? [{ icon: Link2, label: `Link to ${proposedLink.toTitle}`, hint: `"${proposedLink.quote}"`, onClick: () => void link("accept", proposedLink.id) }, { icon: X, label: "Keep it apart", hint: `Not linked to ${proposedLink.toTitle}`, onClick: () => void link("decline", proposedLink.id) }] : []),
      ...linkTargets.filter((o) => o.id !== proposedLink?.to).map((o) => ({ icon: Link2, label: `Link to ${o.title}`, hint: "Moves this objective", onClick: () => void link("link", it.id, o.id) })),
    ];
    return {
      history: historyOf(it.id),
      onSave: (t) => write(editLine(doc, it.id, t), it.id),
      onChat: () => chatAbout(lineSeed(it.kind, it.title, prop)),
      ...(prop ? { onConfirm: () => void confirmIds([it.id]), onDrop: () => void dropIds([it.id]) } : { onDelete: () => void write(deleteLine(doc, it.id), it.id) }),
      ...(it.kind === "role" ? { onArchive: () => void write(archiveLine(doc, it.id), it.id), onRestore: () => void write(archiveLine(doc, it.id, false), it.id) } : {}),
      more,
    };
  };

  const itemRow = (it: CompassItem, lead?: string) => {
    const words = fieldOf(it, "words");
    const from = fieldOf(it, "from");
    const extra: [string, string][] = [];
    for (const k of ["enough", "hope", "fear", "why", "trade", "outcome", "obstacle", "plan"]) { const v = fieldOf(it, k); if (v) extra.push([k, v]); }
    const serves = (it.tokens.serves ?? "").split(",").map((id) => valueTitle.get(id)).filter(Boolean) as string[];
    const chain = chainBits({ node: nodeOf.get(it.id), tree });
    const prop = isProposed(it);
    const proposedLink = links.find((l) => l.from === it.id && l.kind === "goal-objective");
    const since = sinceOf(it);
    const bits: ReactNode[] = [
      prop ? <span className="font-medium text-accent" data-testid="compass-proposed">Proposed</span>
        : isArchived(it) ? <span>Archived</span>
        : it.tokens.status === "confirmed" && it.kind === "goal" ? <span data-testid="compass-needs-plan" title="It goes active once it has an outcome, an obstacle and an if-then plan">Yours, needs its plan</span>
        : it.tokens.status === "prototyping" ? <span>Small trial</span> : null,
      it.flags.includes("local") ? <span title="Never sent to a cloud model">Local only</span> : null,
      it.tokens.cadence ? <span data-testid="compass-cadence">{cadenceLabel(it.tokens.cadence)}</span> : null,
      chain.up ?? (serves.length ? <span>Serves {serves.join(", ")}</span> : null),
      it.tokens.metric ? <span>Measured by {it.tokens.metric}{it.tokens.target ? `, target ${it.tokens.target}` : ""}</span> : it.kind === "objective" ? <span title="An objective is measurable: name the metric that shows it">No measure yet</span> : null,
      proposedLink ? <span title={`"${proposedLink.quote}"`} className="text-accent">Moves {proposedLink.toTitle}?</span> : null,
      chain.down,
      it.tokens.due ? <span>By {it.tokens.due}</span> : null,
      it.tokens.domain ? <span>{titleCase(it.tokens.domain)}</span> : null,
      from ? <span title={from}>From {sourceLabel(from)}</span> : null,
      since && !prop ? <span>Since {fmtDay(since)}</span> : null,
    ];
    return (
      <LineRow key={it.id} id={it.id} title={it.title} lead={lead} proposed={prop} archived={isArchived(it)} busy={busy === it.id}
        meta={<Meta bits={bits} />} {...lineActions(it)}>
        {words && norm(words) !== norm(it.title) && <p className={`${BODY} text-text-secondary`}>"{words.replace(/^"|"$/g, "")}"</p>}
        {extra.map(([k, v]) => <p key={k} className={`${BODY} mt-0.5 text-text-secondary`}><span className="text-text-muted">{titleCase(k)}: </span>{v}</p>)}
        {it.kind === "goal" && <ChainUpList tree={tree} id={it.id} />}
        {it.kind !== "goal" && chain.list(true)}
        {it.kind === "goal" && !prop && <Initiatives goalId={it.id} vaultPath={vaultPath} values={valueTitle} missions={new Map(it.paths.flatMap((p) => { const m = nodeOf.get(p.id)?.mission; return m ? [[p.id, m] as const] : []; }))} />}
      </LineRow>
    );
  };
  const lines = (list: CompassItem[], ranked = false) => <ul>{list.map((it, i) => itemRow(it, ranked ? String(i + 1) : undefined))}</ul>;

  // The purpose: one line like the others, written together in chat or by hand.
  const purposeRow = (big = false) => {
    const t = mission?.text ? cleanPurpose(mission.text) : "";
    if (!t) return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2" data-testid="purpose-blank">
        <span className="text-[14px] text-text-muted">Not written yet.</span>
        <button type="button" onClick={() => chatAbout("Help me write my purpose, the one or two sentences my Compass serves. Ask me a question at a time and quote my own words back.")} data-testid="purpose-together" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline"><MessageSquare className="h-3.5 w-3.5" /> Write it together</button>
        <PurposeWrite onSave={(v) => write(editLine(doc, "mission", v), "mission")} />
      </div>
    );
    const prop = !!mission && isProposed(mission);
    return (
      <ul>
        <LineRow id="mission" title={t} multiline proposed={prop} busy={busy === "mission"} history={historyOf("mission")} testId="purpose-line"
          display={<span className={`font-display ${big ? "text-[20px]" : "text-[17px]"} leading-snug text-text-primary`}>{t}</span>}
          meta={prop ? <span className="font-medium text-accent">Proposed</span> : fieldOf(mission!, "from") ? <span title={fieldOf(mission!, "from")}>From {sourceLabel(fieldOf(mission!, "from"))}</span> : undefined}
          onSave={(v) => write(editLine(doc, "mission", v), "mission")}
          onChat={() => chatAbout(lineSeed("mission", t, prop))}
          {...(prop ? { onConfirm: () => void confirmIds(["mission"]), onDrop: () => void dropIds(["mission"]) } : {})} />
      </ul>
    );
  };

  const confirmAll = proposed > 0 ? (
    <button onClick={() => void confirmIds("all")} disabled={!!busy} data-testid="compass-confirm-all"
      className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline disabled:opacity-50">
      {busy === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />} Confirm all {proposed}
    </button>
  ) : null;

  const overview = (
    <section data-testid="compass-detail-overview">
      <h2 className={DETAIL_TITLE}>Your Compass</h2>
      <p className={`${META} mt-1`}>Every chat carries the lines you confirmed. Open any line to edit it, see its history or talk it through.</p>
      {text !== null && empty && (
        <div className="mt-5 max-w-2xl">
          <p className={`${BODY} text-text-secondary`}>No Compass yet. {chief ?? "Your chief of staff"} can draft one from your notes: your constitution, profile and memory. Every line keeps the words it came from, and nothing counts until you confirm it.</p>
          <button onClick={() => void draft()} disabled={!!busy} data-testid="compass-draft"
            className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50">
            {busy === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Draft from my notes
          </button>
        </div>
      )}
      {proposed > 0 && <p className="mt-3 text-[14px] text-text-secondary" data-testid="compass-needs-you"><span className="font-medium text-text-primary">{proposed} {proposed === 1 ? "line" : "lines"} drafted from your notes</span> wait for you below.</p>}
      {!empty && text !== null && <AlignNeedsYou vaultPath={vaultPath} />}
      <div className="mt-5">
        <Group title="Purpose" testId="overview-purpose">{purposeRow(true)}</Group>
        {values.length > 0 && <Group title="Values" count={values.length}>{lines(values.slice(0, 8), true)}</Group>}
        {statements.length > 0 && <Group title="Mission statement">{lines(statements)}</Group>}
        {visions.length > 0 && <Group title="Vision">{lines(visions)}</Group>}
        {objectives.length > 0 && <Group title="Objectives" count={objectives.length}>{lines(objectives)}</Group>}
        {goals.length > 0 && <Group title="Life goals" count={goals.length}>{lines(goals)}</Group>}
        {rules.length > 0 && <Group title="Non-negotiables" count={rules.length}>{lines(rules)}</Group>}
        {roles.filter((r) => !isArchived(r)).length > 0 && <Group title="Roles">{lines(roles.filter((r) => !isArchived(r)))}</Group>}
        {routines.length > 0 && <Group title="Routines">{lines(routines)}</Group>}
      </div>
    </section>
  );

  // A section: a title, one line saying what it is, its lines and Add.
  const sectionView = (testid: string, title: string, intro: string, body: ReactNode, action?: ReactNode) => (
    <section data-testid={`compass-detail-${testid}`}>
      <div className="flex items-start gap-3">
        <h2 className={`${DETAIL_TITLE} min-w-0 flex-1`}>{title}</h2>
        {action}
      </div>
      <p className={`${META} mt-1 mb-4`}>{intro}</p>
      {body}
    </section>
  );
  const listGroup = (title: string, list: CompassItem[], kind: LineKind, addLabel: string, ranked = false, testId?: string) => (
    <Group title={title} count={list.length} testId={testId}>
      {list.length ? lines(list, ranked) : <p className={`${META} py-1`}>None yet.</p>}
      <AddLine label={addLabel} onAdd={add(kind)} testId={`compass-add-${kind}`} />
    </Group>
  );
  const draftBtn = (onClick: () => void, key: string, label: string, testid: string) => (
    <button onClick={onClick} disabled={!!busy} title={label} aria-label={label} data-testid={testid} className={iconBtn}>
      {busy === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
    </button>
  );
  const chainDraft = !empty ? draftBtn(() => void draftChain(), "chain", "Draft the mission statement, vision and objectives from my notes", "compass-draft-chain") : null;

  const titleOf = (id: string) => id === "mission" ? "Purpose" : id === "compass" ? "The Compass" : items(doc).find((i) => i.id === id)?.title ?? ledger.find((l) => l.id === id && l.reason === "deleted")?.from ?? ledger.find((l) => l.id === id && l.reason === "added")?.to ?? id;
  const historyView = (
    <section data-testid="compass-detail-history">
      <h2 className={DETAIL_TITLE}>History</h2>
      <p className={`${META} mt-1 mb-4`}>Every change to your Compass: what, before, after and when.</p>
      {ledger.length ? (
        <ul data-testid="compass-ledger">{ledger.slice(0, 200).map((l, i) => {
          const c = changeText(l);
          return (
            <li key={i} className="border-b border-border-subtle py-2 last:border-b-0" data-testid="history-row">
              <p className="line-clamp-2 break-words text-[14px] font-medium text-text-primary" title={titleOf(l.id)}>{titleOf(l.id)}</p>
              <p className={`${META} mt-0.5 flex flex-wrap gap-x-1.5`}>
                <span className="text-text-secondary">{c.what}</span>
                {c.before && <span className="line-through decoration-text-muted/60" title={c.before}>{c.before.length > 90 ? `${c.before.slice(0, 87)}...` : c.before}</span>}
                {c.before && c.after && <span>to</span>}
                {c.after && c.what !== "Added" && <span title={c.after}>{c.after.length > 90 ? `${c.after.slice(0, 87)}...` : c.after}</span>}
                <span aria-hidden>·</span><span>{new Date(l.ts).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                {l.by && l.by !== "user" && <><span aria-hidden>·</span><span>by {l.by === "bootstrap" ? "the draft" : l.by}</span></>}
              </p>
            </li>
          );
        })}</ul>
      ) : <p className={META}>No changes yet.</p>}
    </section>
  );

  // The Chain view: every node backed by a Compass line acts like that line.
  const chainActions = (n: ChainNode) => {
    if (n.level === "purpose" && mission) {
      const prop = isProposed(mission);
      return { history: historyOf("mission"), onSave: (v: string) => write(editLine(doc, "mission", v), "mission"), onChat: () => chatAbout(lineSeed("mission", n.title, prop)), ...(prop ? { onConfirm: () => void confirmIds(["mission"]), onDrop: () => void dropIds(["mission"]) } : {}) };
    }
    const it = items(doc).find((x) => x.id === n.id);
    if (it) return lineActions(it);
    if (n.level === "goal" || n.level === "initiative") return { onChat: () => chatAbout(`Let's talk about the ${LEVEL_LABEL[n.level].toLowerCase()} "${n.title}" in my Compass chain. `) };
    return null;
  };
  const roleArchived = roles.filter(isArchived);

  const detail = (
    <div className={phone ? "px-4 py-4" : "w-full px-8 py-6"}>
      {err && <p className="mb-3 text-[13px] text-err">{err}</p>}
      {note && <p className={`${META} mb-3`} data-testid="compass-note">{note}</p>}
      {sel === "overview" && overview}
      {sel === "chain" && sectionView("chain", "Chain", "Each line serves the one above it, from your purpose down to the work. Open any line to edit it or talk it through.",
        <ChainView vaultPath={vaultPath} tree={tree} links={links} actions={chainActions}
          blankPurpose={<Group title="Purpose" testId="chain-purpose-blank">{purposeRow()}</Group>}
          onChanged={() => { void load(); void refreshTree(); void refreshLinks(); }} />,
        !statements.length && !visions.length && !objectives.length ? chainDraft : null)}
      {sel === "mission" && sectionView("mission", "Purpose", "The one or two sentences everything else serves, in your own words.", <Group title="Purpose">{purposeRow(true)}</Group>)}
      {sel === "values" && sectionView("values", "Values", "Directions, never done; most important first. Each may say what is enough.", listGroup("Most important first", values, "value", "Add a value", true))}
      {sel === "statement" && sectionView("statement", "Mission statement", "What you do, for whom, and the contribution you make.", listGroup("Mission statement", statements, "statement", "Add a mission statement"), !statements.length ? chainDraft : null)}
      {sel === "vision" && sectionView("vision", "Vision", "What you hope to become or to have built, long term.", listGroup("Vision", visions, "vision", "Add a vision"), !visions.length ? chainDraft : null)}
      {sel === "objectives" && sectionView("objectives", "Objectives", `The few measurable outcomes that show the vision is happening.${notLinked("objective") ? ` ${notLinked("objective")} not linked yet.` : ""}`, listGroup("Objectives", objectives, "objective", "Add an objective"), !objectives.length ? chainDraft : null)}
      {sel === "goals" && sectionView("goals", "Life goals", "Time-bound targets you set or confirmed, each moving an objective. Open one to see what it serves.",
        listGroup("Life goals", goals, "goal", "Add a life goal"),
        <button onClick={() => chatAbout("Suggest two or three new life goals for me from my notes and my Compass. Each should move one of my objectives; quote what you based it on, and I will say which to keep.")} title="Suggest new life goals" aria-label="Suggest new life goals" data-testid="compass-suggest-goals" className={iconBtn}><Sparkles className="h-4 w-4" /></button>)}
      {sel === "roles" && sectionView("roles", "Roles", "Who you are to the people in your life. Archive a role you have put down; it stays here.", <>
        {listGroup("Roles", roles.filter((r) => !isArchived(r)), "role", "Add a role")}
        {roleArchived.length > 0 && <Group title="Archived" count={roleArchived.length} testId="roles-archived">{lines(roleArchived)}</Group>}
      </>)}
      {sel === "rules" && sectionView("rules", "Rules", "Non-negotiables are never traded away; negotiables bend when they must.", <>
        {listGroup("Non-negotiables", rules, "rule", "Add a non-negotiable", false, "rules-group")}
        {listGroup("Negotiables", negotiables, "negotiable", "Add a negotiable")}
        <AlignRules vaultPath={vaultPath} />
      </>)}
      {sel === "routines" && sectionView("routines", "Routines", "What you do again and again, measured as a rolling rate, never a streak.", listGroup("Routines", routines, "routine", "Add a routine"), draftBtn(() => void draftRoutines(), "routines", "Draft routines from your domains", "compass-draft-routines"))}
      {sel === "history" && historyView}
      {sel === "yearly" && <YearlyReviews vaultPath={vaultPath} />}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="compass-page">
      <SettingsHeader title="Compass" icon={Compass} subtitle="What you live by, in your own words."
        right={<span className="flex items-center gap-3">
          {view === "compass" && confirmAll}
          <button onClick={() => void exportCompass(vaultPath).then((m) => setNote(m)).catch((e) => setErr(`Not exported: ${String(e)}`))} title="Export as a constitution any AI can read" aria-label="Export as a constitution any AI can read" data-testid="compass-export" className={iconBtn}><Download className="h-4 w-4" /></button>
          <button onClick={talk} title={`Talk to ${chief ?? "your chief of staff"}`} aria-label={`Talk to ${chief ?? "your chief of staff"}`} className={iconBtn}><MessageSquare className="h-4 w-4" /></button>
        </span>}
        tabs={<SpineTabs label="Compass" value={view} onChange={setView} tabs={[
          { id: "compass", label: "Compass", count: items(doc).length + (mission?.text ? 1 : 0) },
          { id: "goals", label: "Goals" },
          { id: "ideals", label: "Ideals" },
        ]} />} />
      {view === "compass" && (
        <SideSpine storageKey="prevail.compass.spine" title="Compass" label="the Compass" testId="compass-list"
          meta={proposed ? <span className="inline-flex items-center gap-1 text-accent"><Flag className="h-3 w-3" />{proposed} proposed</span> : undefined}
          phone={phone} phoneDetail={phone && picked} onBack={() => setPicked(false)} backLabel="Compass" detail={detail}>
          {list}
        </SideSpine>
      )}
      {view === "goals" && <DomainGoals vaultPath={vaultPath} />}
      {view === "ideals" && <IdealsSection vaultPath={vaultPath} initial={idealRow} />}
    </div>
  );
}

/** "Write it": the blank purpose turns into a box to type it. */
function PurposeWrite({ onSave }: { onSave: (t: string) => Promise<void> | void }) {
  const [on, setOn] = useState(false);
  const [t, setT] = useState("");
  if (!on) return <button type="button" onClick={() => setOn(true)} data-testid="purpose-write" className="text-[13px] text-text-muted hover:text-accent">Write it</button>;
  return (
    <form className="flex w-full items-start gap-1.5" onSubmit={(e) => { e.preventDefault(); if (t.trim()) { void onSave(t.trim()); setOn(false); } }} data-testid="purpose-form">
      <textarea autoFocus rows={2} value={t} onChange={(e) => setT(e.target.value)} aria-label="Your purpose" placeholder="The one or two sentences everything else serves"
        className="min-w-0 flex-1 resize-y rounded-md border border-accent-border bg-background px-2 py-1 text-[15px] leading-snug text-text-primary focus:outline-none" />
      <button type="submit" disabled={!t.trim()} className="h-8 rounded-md px-2 text-[13px] font-medium text-accent hover:bg-accent-soft disabled:opacity-40" data-testid="purpose-save">Save</button>
    </form>
  );
}
