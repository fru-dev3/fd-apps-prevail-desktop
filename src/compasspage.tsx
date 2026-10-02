// Compass: the one page for what the user lives by. It replaces Goals and
// Ideals. Three views, picked by the header tabs, each a SideSpine page:
//   Compass  the chain from build/compass.md (compassmodel.ts), top to
//            bottom: purpose, values, mission statement, vision, objectives,
//            life goals and their initiatives, then roles, rules and routines
//            beside it. Each line says what it serves (up) and what moves it
//            (down, unfolds); the Chain view draws the tree from the engine
//            (compasschain.tsx) and counts what is not linked per level.
//            Every line is in the user's words with where it came from. Drafted lines wait as Proposed
//            until the user confirms or drops them; History lists the
//            earlier versions and every change.
//   Goals    each domain's goals (source/goals.md), as the Goals page had them.
//   Ideals   the constitution, Omega and every domain's ideal state.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, CheckCheck, Compass, Eye, Flag, GitFork, History, LayoutList, Link2, Loader2, MessageSquare, Milestone, Repeat, Scale, Sparkles, Star, Target, Users, X } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { SettingsHeader } from "./sectionutil";
import { SideSpine, SpineTabs } from "./sidespine";
import { useIsPhone, useStacked } from "./useisphone";
import { BODY, DETAIL_TITLE, META, ROW_TITLE, SECTION_TITLE } from "./typescale";
import {
  confirmLines, dropLines, fieldOf, isProposed, items, missionOf, parseCompass, proposedCount, rankOf, serializeCompass,
  type CompassDoc, type CompassItem, type LedgerChange,
} from "./compassmodel";
import { DomainGoals } from "./goalspage";
import { IdealsSection } from "./idealspage";
import { useChiefOfStaff } from "./chiefofstaff";
import { MattersLived } from "./livedbars";
import { AlignNeedsYou, AlignRules, SaidVsDid } from "./alignpanel";
import { Initiatives } from "./initiatives";
import { ChainView, chainBits, linkAction, notLinkedLine, useChainLinks, useChainTree } from "./compasschain";
import { RowMenu, REVEAL } from "./ui";

type View = "compass" | "goals" | "ideals";
type Sel = "overview" | "chain" | "mission" | "values" | "statement" | "vision" | "objectives" | "roles" | "goals" | "rules" | "routines" | "history";
export const COMPASS_FOCUS_KEY = "prevail.compass.focus";

const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";

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
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setText(await invoke<string>("compass_read", { vault: vaultPath }).catch(() => ""));
  }, [vaultPath]);
  useEffect(() => { void load(); }, [load]);
  // A deep link (an old Goals or Ideals link) can switch the view while open.
  useEffect(() => {
    const on = () => { const f = readFocus(); setView(f.view); if (f.row) setIdealRow(f.row); };
    window.addEventListener("prevail:compass-focus", on);
    return () => window.removeEventListener("prevail:compass-focus", on);
  }, []);

  const doc: CompassDoc = useMemo(() => parseCompass(text ?? ""), [text]);
  const mission = missionOf(doc);
  const values = items(doc, "value").sort((a, b) => rankOf(a) - rankOf(b));
  const roles = items(doc, "role");
  const goals = items(doc, "goal");
  const rules = items(doc, "rule");
  const negotiables = items(doc, "negotiable");
  const routines = items(doc, "routine");
  const statements = items(doc, "statement");
  const visions = items(doc, "vision");
  const objectives = items(doc, "objective");
  // The chain as the engine sees it: parents, children, what is not linked.
  const { tree, refresh: refreshTree } = useChainTree(vaultPath);
  const { links, refresh: refreshLinks } = useChainLinks(vaultPath);
  const nodeOf = useMemo(() => new Map((tree?.nodes ?? []).map((n) => [n.id, n])), [tree]);
  const notLinked = (lvl: string) => tree?.levels.find((l) => l.level === lvl)?.notLinked ?? 0;
  const [unfolded, setUnfolded] = useState<Record<string, boolean>>({});
  const proposed = proposedCount(doc);
  const empty = !mission?.text && !items(doc).length;
  const valueTitle = new Map(values.map((v) => [v.id, v.title]));

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
  const draft = async () => {
    setErr(null); setBusy("draft");
    try { await invoke("engine_compass_bootstrap", { vault: vaultPath }); await load(); }
    catch (e) { setErr(`Could not draft: ${String(e)}`); }
    finally { setBusy(null); }
  };
  // The rest of the chain (mission statement, vision, objectives) drafted from the
  // notes and every domain's ideal state, quoted, with proposed links.
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
  // Routines drafted from each domain's Habits and routines, as proposed lines.
  const draftRoutines = async () => {
    setErr(null); setBusy("routines");
    try { await invoke("engine_routines", { vault: vaultPath, bootstrap: true }); await load(); }
    catch (e) { setErr(`Could not draft routines: ${String(e)}`); }
    finally { setBusy(null); }
  };
  // Talk it through: Home, with the Compass conversation ready to start.
  const talk = () => {
    window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: "" }));
    setTimeout(() => window.dispatchEvent(new CustomEvent("prevail:compose", { detail: "Let's set up my Compass" })), 50);
  };

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
      {row("mission", "Purpose", Compass, undefined, mission?.text ? mission.text.split("\n")[0] : "Not written yet")}
      {row("values", "Values", Star, values.length)}
      {row("statement", "Mission statement", Flag, statements.length, notLinked("statement") ? `${notLinked("statement")} not linked` : undefined)}
      {row("vision", "Vision", Eye, visions.length, notLinked("vision") ? `${notLinked("vision")} not linked` : undefined)}
      {row("objectives", "Objectives", Milestone, objectives.length, notLinked("objective") ? `${notLinked("objective")} not linked` : undefined)}
      {row("goals", "Life goals", Target, goals.length, notLinked("goal") ? `${notLinked("goal")} not linked` : undefined)}
      <div className="mx-2.5 my-1.5 border-t border-border-subtle" aria-hidden />
      {row("roles", "Roles", Users, roles.length)}
      {row("rules", "Rules", Scale, rules.length + negotiables.length)}
      {row("routines", "Routines", Repeat, routines.length)}
      {row("history", "History", History)}
    </nav>
  );

  // One primary action per row (confirm a drafted line, or accept the link
  // proposed for it); everything else is in the row menu.
  const actions = (x: { id: string; title: string; tokens: Record<string, string>; kind?: string }) => {
    const proposedLink = links.find((l) => l.from === x.id && l.kind === "goal-objective");
    const node = nodeOf.get(x.id);
    const linkTargets = x.kind === "goal" && node && !node.parents.length ? objectives.filter((o) => !isProposed(o)).slice(0, 8) : [];
    const menu = [
      ...(isProposed(x) ? [{ icon: X, label: "Not mine", hint: "Leave this line out", onClick: () => void dropIds([x.id]) }] : []),
      ...(proposedLink ? [{ icon: X, label: "Keep it apart", hint: `Not linked to ${proposedLink.toTitle}`, onClick: () => void link("decline", proposedLink.id) }] : []),
      ...linkTargets.filter((o) => o.id !== proposedLink?.to).map((o) => ({ icon: Link2, label: `Link to ${o.title}`, hint: "Moves this objective", onClick: () => void link("link", x.id, o.id) })),
    ];
    if (!isProposed(x) && !proposedLink && !menu.length) return null;
    return (
      <span className={`flex shrink-0 items-center gap-0.5 ${REVEAL}`}>
        {isProposed(x) ? (
          <button onClick={() => void confirmIds([x.id])} disabled={!!busy} title="Confirm" aria-label={`Confirm ${x.title}`} data-testid="compass-confirm" className={iconBtn}><Check className="h-4 w-4" /></button>
        ) : proposedLink ? (
          <button onClick={() => void link("accept", proposedLink.id)} disabled={!!busy} title={`"${proposedLink.quote}"`} aria-label={`Link ${x.title} to ${proposedLink.toTitle}`} data-testid="compass-link-accept" className="inline-flex h-8 items-center gap-1 px-1 text-[13px] font-medium text-accent hover:underline disabled:opacity-50">
            {busy === `link:${proposedLink.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} Link
          </button>
        ) : null}
        {menu.length > 0 && <RowMenu items={menu} label={`More for ${x.title}`} />}
      </span>
    );
  };
  // One quiet meta line instead of a row of pills: state, what it serves,
  // dates and where it came from, separated by middle dots.
  const status = (x: { tokens: Record<string, string> }) => isProposed(x)
    ? <span className="font-medium text-accent" data-testid="compass-proposed">Proposed</span>
    : x.tokens.status === "confirmed" ? <span data-testid="compass-needs-plan" title="It goes active once it has an outcome, an obstacle and an if-then plan">Yours, needs its plan</span>
    : x.tokens.status === "prototyping" ? <span>Small trial</span> : null;
  const sourceLabel = (from: string) => {
    const m = from.match(/data\/domains\/([^/]+)\//);
    if (m) return `${titleCase(m[1])} notes`;
    if (from.includes("user.md")) return "Your profile";
    if (from.includes("constitution") || from.endsWith("ideal-state.md")) return "Your constitution";
    return from.split("/").pop() ?? from;
  };
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9$%+]+/g, " ").trim();

  const itemRow = (it: CompassItem, lead?: string) => {
    const words = fieldOf(it, "words");
    const from = fieldOf(it, "from");
    const extra: [string, string][] = [];
    for (const k of ["enough", "hope", "fear", "why", "trade", "outcome", "obstacle", "plan"]) { const v = fieldOf(it, k); if (v) extra.push([k, v]); }
    const serves = (it.tokens.serves ?? "").split(",").map((id) => valueTitle.get(id)).filter(Boolean) as string[];
    const chain = chainBits({ node: nodeOf.get(it.id), tree });
    const open = !!unfolded[it.id];
    const proposedLink = links.find((l) => l.from === it.id && l.kind === "goal-objective");
    return (
      <li key={it.id} data-testid="compass-item" data-id={it.id} className="group flex items-start gap-3 border-b border-border-subtle py-2.5 last:border-b-0">
        {lead && <span className="w-4 shrink-0 pt-px text-right text-[13px] tabular-nums text-text-muted">{lead}</span>}
        <div className="min-w-0 flex-1">
          <p title={it.title} className={`${ROW_TITLE} line-clamp-2 break-words`}>{it.title}</p>
          {words && norm(words) !== norm(it.title) && (
            <p className="mt-0.5 line-clamp-2 text-[14px] leading-snug text-text-secondary">{words}</p>
          )}
          {extra.map(([k, v]) => <p key={k} className={`${BODY} mt-0.5 text-text-secondary`}><span className="text-text-muted">{titleCase(k)}: </span>{v}</p>)}
          {(() => {
            const bits: ReactNode[] = [];
            const st = status(it);
            if (st) bits.push(st);
            if (it.flags.includes("local")) bits.push(<span title="Never sent to a cloud model">Local only</span>);
            if (it.tokens.cadence) bits.push(<span data-testid="compass-cadence">{cadenceLabel(it.tokens.cadence)}</span>);
            if (chain.up) bits.push(chain.up);
            else if (serves.length) bits.push(<span>Serves {serves.join(", ")}</span>);
            if (it.tokens.metric) bits.push(<span>Measured by {it.tokens.metric}{it.tokens.target ? `, target ${it.tokens.target}` : ""}</span>);
            else if (it.kind === "objective") bits.push(<span title="An objective is measurable: name the metric that shows it">No measure yet</span>);
            if (proposedLink) bits.push(<span title={`"${proposedLink.quote}"`} className="text-accent">Moves {proposedLink.toTitle}?</span>);
            if (chain.down) bits.push(<button type="button" onClick={() => setUnfolded((u) => ({ ...u, [it.id]: !open }))} aria-expanded={open} className="hover:text-accent">{chain.down}</button>);
            if (it.tokens.due) bits.push(<span>By {it.tokens.due}</span>);
            if (it.tokens.domain) bits.push(<span>{titleCase(it.tokens.domain)}</span>);
            if (from) bits.push(<span title={from}>From {sourceLabel(from)}</span>);
            return bits.length ? (
              <p className={`${META} mt-1.5 flex flex-wrap items-center gap-x-1.5`}>
                {bits.map((b, i) => <span key={i} className="inline-flex items-center gap-1.5">{i > 0 && <span aria-hidden className="text-text-muted">·</span>}{b}</span>)}
              </p>
            ) : null;
          })()}
          {it.kind !== "goal" && chain.list(open)}
          {it.kind === "goal" && !isProposed(it) ? <Initiatives goalId={it.id} vaultPath={vaultPath} values={valueTitle} missions={new Map(it.paths.flatMap((p) => { const m = nodeOf.get(p.id)?.mission; return m ? [[p.id, m] as const] : []; }))} /> : it.paths.length > 0 && (
            <ul className="mt-2 border-l-2 border-border-subtle pl-3" data-testid="compass-paths">
              {it.paths.map((p) => <li key={p.id} className="py-1 text-[14px] text-text-secondary">{p.title}</li>)}
            </ul>
          )}
        </div>
        {actions(it)}
      </li>
    );
  };
  const section = (title: string, list: CompassItem[], ranked = false, emptyText = "Nothing here yet.") => (
    <section className="mt-6 first:mt-0">
      <h3 className={`${SECTION_TITLE} mb-1`}>{title}</h3>
      {list.length ? <ul>{list.map((it, i) => itemRow(it, ranked ? String(i + 1) : undefined))}</ul>
        : <p className={META}>{emptyText}</p>}
    </section>
  );

  const confirmAll = proposed > 0 ? (
    <button onClick={() => void confirmIds("all")} disabled={!!busy} data-testid="compass-confirm-all"
      className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline disabled:opacity-50">
      {busy === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />} Confirm all {proposed}
    </button>
  ) : null;

  const overview = (
    <section data-testid="compass-detail-overview">
      <h2 className={DETAIL_TITLE}>Your Compass</h2>
      <p className={`${META} mt-1`}>Every chat carries the lines you confirmed.</p>
      {text !== null && empty && (
        <div className="mt-5 max-w-2xl">
          <p className={`${BODY} text-text-secondary`}>No Compass yet. {chief ?? "Your chief of staff"} can draft one from your notes: your constitution, profile and memory. Every line keeps the words it came from, and nothing counts until you confirm it.</p>
          <button onClick={() => void draft()} disabled={!!busy} data-testid="compass-draft"
            className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50">
            {busy === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Draft from my notes
          </button>
        </div>
      )}
      {proposed > 0 && (
        <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1" data-testid="compass-needs-you">
          <p className="min-w-0 text-[14px] text-text-secondary"><span className="font-medium text-text-primary">{proposed} {proposed === 1 ? "line" : "lines"} drafted from your notes</span> wait for you.</p>
          <button onClick={() => choose("values")} className="text-[13px] font-medium text-accent hover:underline">Review one by one</button>
        </div>
      )}
      {!empty && text !== null && <AlignNeedsYou vaultPath={vaultPath} />}
      {mission?.text && (
        <section className="mt-6">
          <h3 className={`${SECTION_TITLE} mb-1`}>Purpose</h3>
          <p className="font-display text-[20px] leading-snug text-text-primary">{mission.text.replace(/^>\s*/gm, "").replace(/\*\*/g, "")}</p>
        </section>
      )}
      {values.length > 0 && section("Values, most important first", values.slice(0, 8), true)}
      {statements.length > 0 && section("Mission statement", statements)}
      {visions.length > 0 && section("Vision", visions)}
      {objectives.length > 0 && section("Objectives", objectives)}
      {rules.length > 0 && section("Non-negotiables", rules)}
    </section>
  );
  // A chain level's page: its lines, and the tiny draft action while the level is empty.
  const chainLevel = (testid: string, title: string, intro: string, list: CompassItem[], emptyText: string) => (
    <section data-testid={`compass-detail-${testid}`}>
      <div className="flex items-start gap-3">
        <h2 className={`${DETAIL_TITLE} min-w-0 flex-1`}>{title}</h2>
        {!list.length && !empty && (
          <button onClick={() => void draftChain()} disabled={!!busy} title="Draft from my notes" aria-label="Draft the mission statement, vision and objectives from my notes" data-testid="compass-draft-chain" className={iconBtn}>
            {busy === "chain" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          </button>
        )}
      </div>
      <p className={`${META} mt-1 mb-4`}>{intro}</p>
      {section(title, list, false, emptyText)}
    </section>
  );

  const missionView = (
    <section data-testid="compass-detail-mission">
      <div className="flex items-start gap-3">
        <h2 className={`${DETAIL_TITLE} min-w-0 flex-1`}>Purpose</h2>
        {mission && actions({ id: "mission", title: "the purpose", tokens: mission.tokens })}
      </div>
      {mission?.text ? (
        <>
          <p className={`${META} mt-2`}>{status(mission)}</p>
          <p className="mt-3 max-w-3xl font-display text-[20px] leading-snug text-text-primary">{mission.text.replace(/^>\s*/gm, "").replace(/\*\*/g, "")}</p>
          {fieldOf(mission, "from") && <p className={`${META} mt-2`} title={fieldOf(mission, "from")}>From {sourceLabel(fieldOf(mission, "from")!)}</p>}
        </>
      ) : <p className={`${META} mt-2`}>Not written yet. It comes last, drawn from your own words.</p>}
    </section>
  );

  const [versions, setVersions] = useState<{ name: string }[]>([]);
  const [ledger, setLedger] = useState<{ ts: number; id: string; from: string; to: string; reason: string }[]>([]);
  const [version, setVersion] = useState<{ name: string; text: string } | null>(null);
  useEffect(() => {
    if (sel !== "history") return;
    invoke<{ name: string }[]>("compass_versions", { vault: vaultPath }).then((v) => setVersions(Array.isArray(v) ? v : [])).catch(() => setVersions([]));
    invoke<typeof ledger>("compass_ledger", { vault: vaultPath }).then((l) => setLedger(Array.isArray(l) ? l : [])).catch(() => setLedger([]));
  }, [sel, vaultPath, text]);
  const titleOf = (id: string) => id === "mission" ? "Purpose" : id === "compass" ? "The Compass" : items(doc).find((i) => i.id === id)?.title ?? id;
  const historyView = (
    <section data-testid="compass-detail-history">
      <h2 className={DETAIL_TITLE}>History</h2>
      <h3 className={`${SECTION_TITLE} mt-5 mb-1`}>Changes</h3>
      {ledger.length ? (
        <ul data-testid="compass-ledger">{ledger.slice(0, 60).map((l, i) => (
          <li key={i} className={`${BODY} flex flex-wrap items-baseline gap-x-2 border-b border-border-subtle py-1.5 last:border-b-0`}>
            <span className="text-text-primary">{titleOf(l.id)}</span>
            <span className="text-text-secondary">{l.from} to {l.to}</span>
            <span className={META}>{new Date(l.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
          </li>
        ))}</ul>
      ) : <p className={META}>No changes yet.</p>}
      <h3 className={`${SECTION_TITLE} mt-6 mb-1`}>Earlier versions</h3>
      {versions.length ? (
        <ul data-testid="compass-versions">{versions.map((v) => (
          <li key={v.name}><button onClick={() => void invoke<string>("compass_version_read", { vault: vaultPath, name: v.name }).then((t) => setVersion({ name: v.name, text: t }))}
            className={`${BODY} py-1 text-left text-text-primary hover:text-accent`}>{v.name.replace(/T(\d\d)-(\d\d)-(\d\d)Z.*/, " $1:$2")}</button></li>
        ))}</ul>
      ) : <p className={META}>None yet. Each change keeps the file as it was.</p>}
      {version && <pre data-testid="compass-version-text" className="mt-3 max-w-3xl overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-surface p-3 text-[13px] text-text-secondary">{version.text}</pre>}
    </section>
  );

  const detail = (
    <div className={phone ? "px-4 py-4" : "w-full px-8 py-6"}>
      {err && <p className="mb-3 text-[13px] text-err">{err}</p>}
      {sel === "overview" && overview}
      {sel === "chain" && (
        <section data-testid="compass-detail-chain">
          <div className="flex items-start gap-3">
            <h2 className={`${DETAIL_TITLE} min-w-0 flex-1`}>Chain</h2>
            {!empty && !statements.length && !visions.length && !objectives.length && (
              <button onClick={() => void draftChain()} disabled={!!busy} title="Draft the mission statement, vision and objectives from my notes" aria-label="Draft the mission statement, vision and objectives from my notes" data-testid="compass-draft-chain" className={iconBtn}>
                {busy === "chain" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              </button>
            )}
          </div>
          <p className={`${META} mt-1`}>Each line serves the one above it, from your purpose down to the work.</p>
          <ChainView vaultPath={vaultPath} tree={tree} links={links} onChanged={() => { void load(); void refreshTree(); void refreshLinks(); }} />
        </section>
      )}
      {sel === "statement" && chainLevel("statement", "Mission statement", "What you do, for whom, and the contribution you make. Each serves your values.", statements, "Not written yet. Draft it from your notes, or say it to your chief of staff.")}
      {sel === "vision" && chainLevel("vision", "Vision", "What you hope to become or to have built, long term.", visions, "Not written yet.")}
      {sel === "objectives" && chainLevel("objectives", "Objectives", "The few measurable outcomes that show the vision is happening. Goals move them.", objectives, "None yet.")}
      {sel === "mission" && missionView}
      {sel === "values" && <section data-testid="compass-detail-values"><h2 className={DETAIL_TITLE}>Values</h2><p className={`${META} mt-1 mb-4`}>Directions, never done. Each may say what is enough.</p>{section("Most important first", values, true, "No values yet.")}<MattersLived vaultPath={vaultPath} /><SaidVsDid vaultPath={vaultPath} /></section>}
      {sel === "roles" && <section data-testid="compass-detail-roles"><h2 className={DETAIL_TITLE}>Roles</h2><p className={`${META} mt-1 mb-4`}>Who you are to the people in your life.</p>{section("Roles", roles, false, "No roles yet.")}</section>}
      {sel === "goals" && <section data-testid="compass-detail-goals"><h2 className={DETAIL_TITLE}>Life goals</h2><p className={`${META} mt-1 mb-4`}>Time-bound targets, each moving an objective. Initiatives under each are the work that gets them there; domain goals are under Goals.</p>{section("Goals", goals, false, "No life goals yet.")}</section>}
      {sel === "routines" && (
        <section data-testid="compass-detail-routines">
          <div className="flex items-start gap-3">
            <h2 className={`${DETAIL_TITLE} min-w-0 flex-1`}>Routines</h2>
            <button onClick={() => void draftRoutines()} disabled={!!busy} title="Draft from your domains" aria-label="Draft routines from your domains" data-testid="compass-draft-routines" className={iconBtn}>{busy === "routines" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}</button>
          </div>
          <p className={`${BODY} mt-1 text-text-secondary`}>What you do again and again, measured as a rolling rate (never a streak). The radar says when one slips two times running.</p>
          {section("Your routines", routines, false, "None yet. Draft them from the Habits and routines in your domains; each keeps your words and waits for your yes.")}
        </section>
      )}
      {sel === "rules" && <section data-testid="compass-detail-rules"><h2 className={DETAIL_TITLE}>Rules</h2>{section("Non-negotiables", rules, false, "None yet.")}{section("Negotiables", negotiables, false, "None yet.")}<AlignRules vaultPath={vaultPath} /></section>}
      {sel === "history" && historyView}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="compass-page">
      <SettingsHeader title="Compass" icon={Compass} subtitle="What you live by, in your own words."
        right={<span className="flex items-center gap-3">
          {view === "compass" && confirmAll}
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
