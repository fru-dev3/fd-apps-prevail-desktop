// Compass: the one page for what the user lives by. It replaces Goals and
// Ideals. Three views, picked by the header tabs, each a SideSpine page:
//   Compass  the mission, ranked values, roles, life goals and rules from
//            build/compass.md (compassmodel.ts), every line in the user's
//            words with where it came from. Drafted lines wait as Proposed
//            until the user confirms or drops them; History lists the
//            earlier versions and every change.
//   Goals    each domain's goals (source/goals.md), as the Goals page had them.
//   Ideals   the constitution, Omega and every domain's ideal state.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, CheckCheck, Compass, Flag, History, LayoutList, Loader2, MessageSquare, Repeat, Scale, Sparkles, Star, Target, Users, X } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { SettingsHeader } from "./sectionutil";
import { SideSpine, SpineTabs } from "./sidespine";
import { useIsPhone, useStacked } from "./useisphone";
import { BODY, DETAIL_TITLE, META, SECTION_TITLE } from "./typescale";
import {
  confirmLines, dropLines, fieldOf, isProposed, items, missionOf, parseCompass, proposedCount, rankOf, serializeCompass,
  type CompassDoc, type CompassItem, type LedgerChange,
} from "./compassmodel";
import { DomainGoals } from "./goalspage";
import { IdealsSection } from "./idealspage";
import { useChiefOfStaff } from "./chiefofstaff";
import { MattersLived } from "./livedbars";
import { AlignNeedsYou, AlignRules, SaidVsDid } from "./alignpanel";
import { openMission } from "./missions";

type View = "compass" | "goals" | "ideals";
type Sel = "overview" | "mission" | "values" | "roles" | "goals" | "rules" | "routines" | "history";
export const COMPASS_FOCUS_KEY = "prevail.compass.focus";

const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";
const chip = "inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[12px] text-text-secondary";

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
      {row("mission", "Purpose", Compass, undefined, mission?.text ? mission.text.split("\n")[0] : "Not written yet")}
      {row("values", "Values", Star, values.length)}
      {row("roles", "Roles", Users, roles.length)}
      {row("goals", "Life goals", Target, goals.length)}
      {row("rules", "Rules", Scale, rules.length + negotiables.length)}
      {row("routines", "Routines", Repeat, routines.length)}
      {row("history", "History", History)}
    </nav>
  );

  const actions = (x: { id: string; title: string; tokens: Record<string, string> }) => isProposed(x) ? (
    <span className="flex shrink-0 items-center gap-0.5">
      <button onClick={() => void confirmIds([x.id])} disabled={!!busy} title="Confirm" aria-label={`Confirm ${x.title}`} data-testid="compass-confirm" className={iconBtn}><Check className="h-4 w-4" /></button>
      <button onClick={() => void dropIds([x.id])} disabled={!!busy} title="Not mine" aria-label={`Drop ${x.title}`} data-testid="compass-drop" className={`${iconBtn} hover:text-warn`}><X className="h-4 w-4" /></button>
    </span>
  ) : null;
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
    if (from.includes("constitution")) return "Your constitution";
    return from.split("/").pop() ?? from;
  };
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9$%+]+/g, " ").trim();

  const startMission = async (pathId: string) => {
    setBusy(`m:${pathId}`);
    try { const m = await invoke<{ slug?: string }>("engine_missions_from_path", { vault: vaultPath, path: pathId }); await load(); if (m?.slug) openMission(m.slug); }
    catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };
  const itemRow = (it: CompassItem, lead?: string) => {
    const words = fieldOf(it, "words");
    const from = fieldOf(it, "from");
    const extra: [string, string][] = [];
    for (const k of ["enough", "hope", "fear", "why", "trade", "outcome", "obstacle", "plan"]) { const v = fieldOf(it, k); if (v) extra.push([k, v]); }
    const serves = (it.tokens.serves ?? "").split(",").map((id) => valueTitle.get(id)).filter(Boolean) as string[];
    return (
      <li key={it.id} data-testid="compass-item" data-id={it.id} className="flex items-start gap-3 border-b border-border-subtle py-3 last:border-b-0">
        {lead && <span className="w-6 shrink-0 pt-0.5 text-right text-[15px] font-semibold tabular-nums text-accent">{lead}</span>}
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold leading-snug text-text-primary">{it.title}</p>
          {words && norm(words) !== norm(it.title) && (
            <p className={`${BODY} mt-1 border-l-2 border-border pl-3 italic text-text-secondary`}>{words}</p>
          )}
          {extra.map(([k, v]) => <p key={k} className={`${BODY} mt-0.5 text-text-secondary`}><span className="text-text-muted">{titleCase(k)}: </span>{v}</p>)}
          {(() => {
            const bits: ReactNode[] = [];
            const st = status(it);
            if (st) bits.push(st);
            if (it.flags.includes("local")) bits.push(<span title="Never sent to a cloud model">Local only</span>);
            if (it.tokens.cadence) bits.push(<span data-testid="compass-cadence">{cadenceLabel(it.tokens.cadence)}</span>);
            if (it.tokens.metric) bits.push(<span>Measured by {it.tokens.metric}</span>);
            if (serves.length) bits.push(<span>Serves {serves.join(", ")}</span>);
            if (it.tokens.due) bits.push(<span>By {it.tokens.due}</span>);
            if (it.tokens.domain) bits.push(<span>{titleCase(it.tokens.domain)}</span>);
            if (from) bits.push(<span title={from}>From {sourceLabel(from)}</span>);
            return bits.length ? (
              <p className={`${META} mt-1.5 flex flex-wrap items-center gap-x-1.5`}>
                {bits.map((b, i) => <span key={i} className="inline-flex items-center gap-1.5">{i > 0 && <span aria-hidden className="text-text-muted">·</span>}{b}</span>)}
              </p>
            ) : null;
          })()}
          {it.paths.length > 0 && (
            <ul className="mt-2 border-l-2 border-border-subtle pl-3" data-testid="compass-paths">
              {it.paths.map((p) => {
                const mission = p.fields.find((f) => f.key === "mission")?.value;
                const pst = p.tokens.status ?? "proposed";
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 py-1">
                    <span className="min-w-0 break-words text-[14px] text-text-secondary">{p.title}</span>
                    <span className={chip}>{titleCase(pst)}</span>
                    {mission ? <button onClick={() => openMission(mission)} className={`${chip} hover:text-accent`} data-testid="compass-path-mission">Mission {titleCase(mission)}</button>
                      : pst === "chosen" ? <button onClick={() => void startMission(p.id)} disabled={!!busy} title="Start a mission for this path" aria-label={`Start a mission for ${p.title}`} data-testid="compass-path-start"
                        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-text-muted hover:bg-surface-warm hover:text-accent disabled:opacity-40">{busy === `m:${p.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Target className="h-3.5 w-3.5" />}Start a mission</button> : null}
                  </li>
                );
              })}
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
        : <p className={`${BODY} text-text-muted`}>{emptyText}</p>}
    </section>
  );

  const confirmAll = proposed > 0 ? (
    <button onClick={() => void confirmIds("all")} disabled={!!busy} data-testid="compass-confirm-all"
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-2.5 text-[13px] font-medium text-accent hover:bg-accent hover:text-white disabled:opacity-50">
      {busy === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />} Confirm all {proposed}
    </button>
  ) : null;

  const overview = (
    <section data-testid="compass-detail-overview">
      <h2 className={DETAIL_TITLE}>Your Compass</h2>
      <p className={`${BODY} mt-1 text-text-secondary`}>What you live by, in your own words. Every chat carries the lines you confirmed.</p>
      {text !== null && empty && (
        <div className="mt-6 max-w-2xl rounded-lg border border-border p-4">
          <p className={`${BODY} text-text-primary`}>No Compass yet. {chief ?? "Your chief of staff"} can draft one from your notes: your constitution, profile and memory. Every line keeps the words it came from, and nothing counts until you confirm it.</p>
          <button onClick={() => void draft()} disabled={!!busy} data-testid="compass-draft"
            className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-[14px] font-medium text-white disabled:opacity-50">
            {busy === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Draft from my notes
          </button>
        </div>
      )}
      {proposed > 0 && (
        <div className="mt-6 max-w-2xl rounded-lg border border-accent-border bg-accent-soft/40 p-4" data-testid="compass-needs-you">
          <h3 className={SECTION_TITLE}>Needs you</h3>
          <p className={`${BODY} mt-1 text-text-secondary`}>{proposed} {proposed === 1 ? "line was" : "lines were"} drafted from your notes. Each keeps your words and where they came from. Confirm the ones that are yours; drop the rest.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {confirmAll}
            <button onClick={() => choose("values")} className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[13px] text-text-secondary hover:text-accent">Review one by one</button>
          </div>
        </div>
      )}
      {!empty && text !== null && <AlignNeedsYou vaultPath={vaultPath} />}
      {mission?.text && (
        <section className="mt-6">
          <h3 className={`${SECTION_TITLE} mb-1`}>Purpose</h3>
          <p className="font-display text-[22px] leading-snug text-text-primary">{mission.text.replace(/^>\s*/gm, "").replace(/\*\*/g, "")}</p>
        </section>
      )}
      {values.length > 0 && section("Values, most important first", values.slice(0, 8), true)}
      {rules.length > 0 && section("Non-negotiables", rules)}
    </section>
  );

  const missionView = (
    <section data-testid="compass-detail-mission">
      <div className="flex items-start gap-3">
        <h2 className={`${DETAIL_TITLE} min-w-0 flex-1`}>Purpose</h2>
        {mission && actions({ id: "mission", title: "the mission", tokens: mission.tokens })}
      </div>
      {mission?.text ? (
        <>
          <p className={`${META} mt-2`}>{status(mission)}</p>
          <p className="mt-3 max-w-3xl font-display text-[22px] leading-snug text-text-primary">{mission.text.replace(/^>\s*/gm, "").replace(/\*\*/g, "")}</p>
          {fieldOf(mission, "from") && <p className={`${META} mt-2`} title={fieldOf(mission, "from")}>From {sourceLabel(fieldOf(mission, "from")!)}</p>}
        </>
      ) : <p className={`${BODY} mt-2 text-text-muted`}>Not written yet. It comes last, drawn from your own words.</p>}
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
  const titleOf = (id: string) => id === "mission" ? "Purpose" : items(doc).find((i) => i.id === id)?.title ?? id;
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
      ) : <p className={`${BODY} text-text-muted`}>No changes yet.</p>}
      <h3 className={`${SECTION_TITLE} mt-6 mb-1`}>Earlier versions</h3>
      {versions.length ? (
        <ul data-testid="compass-versions">{versions.map((v) => (
          <li key={v.name}><button onClick={() => void invoke<string>("compass_version_read", { vault: vaultPath, name: v.name }).then((t) => setVersion({ name: v.name, text: t }))}
            className={`${BODY} py-1 text-left text-text-primary hover:text-accent`}>{v.name.replace(/T(\d\d)-(\d\d)-(\d\d)Z.*/, " $1:$2")}</button></li>
        ))}</ul>
      ) : <p className={`${BODY} text-text-muted`}>None yet. Each change keeps the file as it was.</p>}
      {version && <pre data-testid="compass-version-text" className="mt-3 max-w-3xl overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-surface p-3 text-[13px] text-text-secondary">{version.text}</pre>}
    </section>
  );

  const detail = (
    <div className={phone ? "px-4 py-4" : "w-full px-8 py-6"}>
      {err && <p className="mb-3 text-[13px] text-err">{err}</p>}
      {sel === "overview" && overview}
      {sel === "mission" && missionView}
      {sel === "values" && <section data-testid="compass-detail-values"><h2 className={DETAIL_TITLE}>Values</h2><p className={`${META} mt-1 mb-4`}>Directions, never done. Each may say what is enough.</p>{section("Most important first", values, true, "No values yet.")}<MattersLived vaultPath={vaultPath} /><SaidVsDid vaultPath={vaultPath} /></section>}
      {sel === "roles" && <section data-testid="compass-detail-roles"><h2 className={DETAIL_TITLE}>Roles</h2><p className={`${META} mt-1 mb-4`}>Who you are to the people in your life.</p>{section("Roles", roles, false, "No roles yet.")}</section>}
      {sel === "goals" && <section data-testid="compass-detail-goals"><h2 className={DETAIL_TITLE}>Life goals</h2><p className={`${META} mt-1 mb-4`}>Destinations with a done, each serving values. Domain goals are under Goals.</p>{section("Goals", goals, false, "No life goals yet.")}</section>}
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
        right={<span className="flex items-center gap-1">
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
