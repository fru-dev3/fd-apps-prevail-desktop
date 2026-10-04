// Missions (missions-plan.md): time-bound efforts you talk to. The page keeps
// the Intent template: the page header with Active / Paused / Completed /
// Archived / All, the SideSpine column (New mission, the missions, then prompt
// projects that could become one), and the picked mission full width: a
// sticky header (status, days, milestones, budget, who it brought in, tiny
// icon actions) over its tabs Chat, Milestones, Tasks, Calendar, Budget,
// Artifacts, Timeline and Setup. Bring in and Complete open inline under the
// header, never in a drawer.
import { SpecialistAvatar } from "./specialistavatar";
import { NewMission } from "./missionnew";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Archive, CalendarDays, Check, CheckCircle2, CircleDollarSign, Clock, FileText, Flag, FolderKanban, ListChecks, Loader2, MessageSquare,
  Pause, Play, Plus, RotateCcw, Settings2, Target, Undo2, X,
} from "lucide-react";
import { useInvokeQuery } from "./query";
import { titleCase } from "./format";
import { isUserDomain } from "./helpers";
import { SettingsHeader } from "./sectionutil";
import { SideSpine, SpineTabs } from "./sidespine";
import { useIsPhone, useStacked } from "./useisphone";
import { BODY, DETAIL_TITLE, META, SECTION_TITLE } from "./typescale";
import { StatusDot } from "./ui";
import { DomainChip } from "./linking";
import { useChatApps } from "./chatrefs";
import { displayTitle, nPrompts, type ProjectsIndex } from "./projectsview";
import { ChatPanel } from "./chatpanel";
import { useDetectedClis, useFrameworkLens } from "./hooks";
import type { ThreadMeta } from "./types";
import { parseCompass } from "./compassmodel";
import { useChainTree, walkUp, LEVEL_LABEL } from "./compasschain";
import {
  approveMissionEvent, attachToMission, CEILINGS, closeoutApply, closeoutPlan, closeoutUndo, createMission, createMissionEvent, daysLeftLabel, linkMissionPath, missionBudget, missionFor,
  MISSIONS_CHANGED, pendingLabel, trackMissionMetric, type MetricProposalM, type PendingEvent,
  missionMilestone, missionState, OPEN_MISSION_EVENT, ownerOf, rolesOf, setMissionField, takeOpenMission, useMission, useMissions,
  type CloseoutPlan, type Mission, type MissionStatus, type MissionTask, type Receipt,
} from "./missions";
import { TintIcon } from "./tint";
import { SourcesInUse } from "./knowledgesources";

type Tab = MissionStatus | "all";
type DTab = "chat" | "milestones" | "tasks" | "calendar" | "budget" | "artifacts" | "timeline" | "setup";
const D_TABS: { id: DTab; label: string; icon: typeof Target }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare }, { id: "milestones", label: "Milestones", icon: Flag },
  { id: "tasks", label: "Tasks", icon: ListChecks }, { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "budget", label: "Budget", icon: CircleDollarSign }, { id: "artifacts", label: "Artifacts", icon: FileText },
  { id: "timeline", label: "Timeline", icon: Clock }, { id: "setup", label: "Setup", icon: Settings2 },
];
const inputCls = "w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-text-primary focus:border-accent-border focus:outline-none";
const fieldLabel = "mb-1 block text-[13px] font-medium text-text-secondary";
const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";
// Quiet text actions instead of bordered secondary buttons; seg is one option of a segmented choice.
const textLink = "inline-flex h-8 shrink-0 items-center gap-1 text-[13px] font-medium text-accent hover:underline disabled:opacity-50 disabled:no-underline";
const seg = (on: boolean) => `inline-flex h-8 shrink-0 items-center px-2.5 text-[13px] ${on ? "bg-accent-soft font-medium text-accent" : "text-text-secondary hover:text-accent"}`;
const segGroup = "inline-flex max-w-full flex-wrap overflow-hidden rounded-md border border-border";
const fmtDate = (t?: string) => (t && /^\d{4}-\d{2}-\d{2}/.test(t) ? new Date(`${t.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: n % 1 ? 2 : 0 })}`;

export function missionMeta(m: Mission): string {
  const p = m.progress;
  return [
    titleCase(m.status),
    m.status === "active" && p?.days?.total ? `day ${p.days.day} of ${p.days.total}` : "",
    m.target ? `target ${fmtDate(m.target)}` : "",
    p?.milestones?.total ? `${p.milestones.done} of ${p.milestones.total} milestones` : "",
    p?.budget?.planned ? `${usd(p.budget.used)} of ${usd(p.budget.planned)}` : "",
  ].filter(Boolean).join(" · ");
}

// ── The page ────────────────────────────────────────────────────────────────

// `bare`: inside Activities > Projects, whose page header (the group's kind
// tabs and breadcrumbs) is drawn by the Activities page; the status tabs then
// sit at the top of the list column.
export function MissionsPage({ vaultPath, bare = false, onSelected, clearN = 0 }: { vaultPath: string; bare?: boolean; onSelected?: (name: string | null) => void; clearN?: number }) {
  const isPhone = useIsPhone();
  const stacked = useStacked();
  const phone = isPhone || stacked;
  const { missions, loading } = useMissions(vaultPath);
  const newDomains = useDomains(vaultPath);
  const prompts = useInvokeQuery<ProjectsIndex | null>("projects_index", { vault: vaultPath });
  const focus = () => { try { const f = localStorage.getItem("prevail.missions.focus"); localStorage.removeItem("prevail.missions.focus"); return f; } catch { return null; } };
  const first = focus();
  const [tab, setTab] = useState<Tab>(first === "paused" ? "paused" : first === "all" ? "all" : "active");
  const [sel, setSel] = useState<string | null>(() => takeOpenMission());
  const [picked, setPicked] = useState(() => sel !== null);
  const [adding, setAdding] = useState(first === "new");

  useEffect(() => {
    const take = (e: Event) => { const s = (e as CustomEvent<string>).detail; takeOpenMission(); if (s) { setSel(s); setPicked(true); setAdding(false); } };
    const onFocus = (e: Event) => {
      const f = (e as CustomEvent<string>).detail; focus();
      if (f === "new") { setAdding(true); setSel(null); setPicked(true); }
      else if (f === "paused" || f === "all") { setTab(f); setAdding(false); setSel(null); setPicked(false); }
    };
    window.addEventListener(OPEN_MISSION_EVENT, take);
    window.addEventListener("prevail:missions-focus", onFocus);
    return () => { window.removeEventListener(OPEN_MISSION_EVENT, take); window.removeEventListener("prevail:missions-focus", onFocus); };
  }, []);

  const count = (t: Tab) => missions.filter((m) => (t === "all" ? m.status !== "archived" : m.status === t)).length;
  const shown = useMemo(() => missions.filter((m) => (tab === "all" ? true : m.status === tab)), [missions, tab]);
  const suggested = useMemo(() => (prompts.data?.projects ?? []).filter((p) => !missionFor(missions, p.slug) && p.status !== "done" && p.prompt_count >= 3).sort((a, b) => b.last_ts - a.last_ts).slice(0, 6), [missions, prompts.data]);
  const cur = adding ? null : (missions.find((m) => m.slug === sel) ?? (phone || sel ? null : shown[0] ?? null));
  const curSlug = adding ? null : sel ?? cur?.slug ?? null;
  useEffect(() => { window.dispatchEvent(new CustomEvent("prevail:mission-shown", { detail: curSlug })); }, [curSlug]);
  const selName = adding ? "New project" : cur?.name ?? null;
  useEffect(() => { onSelected?.(selName); }, [selName]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (clearN) { setSel(null); setPicked(false); setAdding(false); } }, [clearN]);
  const pick = (slug: string) => { setSel(slug); setPicked(true); setAdding(false); };
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const startFromPrompts = async (slug: string, title: string) => {
    setBusy(slug); setErr(null);
    try { const m = await createMission(vaultPath, { name: displayTitle(title), fromPromptProject: slug }); setTab("active"); pick(m.slug); }
    catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };

  const rowCls = (on: boolean) => `mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`;
  const list = (
    <nav className="p-2" aria-label="Projects">
      {err && <p className="px-2.5 pb-2 text-[13px] text-err">{err}</p>}
      {loading && !missions.length ? <p className="px-2.5 py-1 text-[13px] text-text-muted">Reading your projects</p>
        : shown.length === 0 ? <p className="px-2.5 py-1 text-[13px] text-text-muted">{tab === "active" || tab === "all" ? "No projects yet." : `Nothing ${tab}.`}</p> : null}
      {shown.map((m) => {
        const on = m.slug === curSlug && (!phone || picked);
        const left = daysLeftLabel(m);
        return (
          <button key={m.slug} data-testid="mission-row" aria-current={on ? "true" : undefined} onClick={() => pick(m.slug)} className={rowCls(on)}>
            <TintIcon icon={FolderKanban} tint="projects" />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[14px] ${on ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{m.name}</span>
              <span className="block truncate text-[12px] text-text-muted">{m.progress?.milestones?.total ? `${m.progress.milestones.done} of ${m.progress.milestones.total} milestones` : titleCase(m.status)}</span>
            </span>
            {left && <span className="shrink-0 text-[12px] tabular-nums text-text-muted">{left}</span>}
          </button>
        );
      })}
      {suggested.length > 0 && (
        <section data-testid="missions-suggested" className="mt-3">
          <h3 className="px-2.5 pb-1 pt-2 text-[13px] font-semibold text-text-secondary">From your prompt groups</h3>
          {suggested.map((p) => (
            <div key={p.slug} data-testid="suggested-mission" className="flex items-center gap-2 rounded-lg px-2.5 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-text-secondary">{displayTitle(p.title)}</span>
                <span className="block truncate text-[12px] text-text-muted">{titleCase(p.domain)} · {nPrompts(p.prompt_count)}</span>
              </span>
              <button onClick={() => void startFromPrompts(p.slug, p.title)} disabled={busy !== null} data-testid="suggested-start" title="Start a project for this" aria-label={`Start a project for ${displayTitle(p.title)}`} className={iconBtn}>
                {busy === p.slug ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              </button>
            </div>
          ))}
        </section>
      )}
    </nav>
  );

  const detail = adding ? <NewMission vaultPath={vaultPath} domains={newDomains} onCancel={() => setAdding(false)} onMade={(slug) => { setTab("active"); pick(slug); }} />
    : curSlug ? <MissionDetail key={curSlug} vaultPath={vaultPath} slug={curSlug} />
    : (
      <div className={phone ? "px-4 py-4" : "w-full px-8 py-6"} data-testid="missions-empty">
        <h2 className={DETAIL_TITLE}>Your projects</h2>
        <p className={`${BODY} mt-2 max-w-2xl text-text-secondary`}>An effort with an outcome and an end: an instrument, a trip, a remodel. It brings in the domains, apps, agents and people it needs, you talk to it, and when it is done what it learned goes back to your domains.</p>
        <button onClick={() => setAdding(true)} data-testid="mission-new-cta" className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-[14px] font-semibold text-white hover:bg-accent-hover"><Plus className="h-4 w-4" />New project</button>
      </div>
    );

  const statusTabs = ([
    { id: "active", label: "Active", count: count("active") },
    { id: "paused", label: "Paused", count: count("paused") },
    { id: "completed", label: phone || bare ? "Done" : "Completed", count: count("completed") },
    { id: "archived", label: "Archived", count: count("archived") },
    { id: "all", label: "All", count: missions.length },
  ] as { id: Tab; label: string; count?: number }[]);
  // Inside Activities the list column carries the status as one compact choice.
  const statusPick = (
    <label className="flex h-9 items-center gap-2 rounded-lg bg-surface-warm px-2.5 text-[13px] text-text-secondary">
      <span className="shrink-0 text-text-muted">Show</span>
      <select aria-label="Which projects" data-testid="missions-status" value={tab} onChange={(e) => { setTab(e.target.value as Tab); setAdding(false); }}
        className="min-w-0 flex-1 bg-transparent font-medium text-text-primary outline-none">
        {statusTabs.map((t) => <option key={t.id} value={t.id}>{t.label}{t.count !== undefined ? ` (${t.count})` : ""}</option>)}
      </select>
    </label>
  );
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="missions-page">
      {!bare && <SettingsHeader title="Projects" icon={FolderKanban} subtitle="Efforts with an outcome and an end. Talk to each one; it files what it learns back to your domains."
        tabs={<SpineTabs label="Projects" value={tab} onChange={(t) => { setTab(t); setAdding(false); }} tabs={statusTabs.map((t) => (phone ? { id: t.id, label: t.label } : t))} />} />}
      <SideSpine storageKey="prevail.missions.spine" title="Projects" label="missions" testId="missions-list" toolbar={bare ? statusPick : undefined}
        actions={<button onClick={() => { setAdding(true); setPicked(true); }} title="New project" aria-label="New project" data-testid="mission-new" className={iconBtn}><Plus className="h-4 w-4" /></button>}
        phone={phone} phoneDetail={phone && picked && (adding || !!curSlug)} onBack={() => { setPicked(false); setAdding(false); }} backLabel="All projects"
        detail={detail}>
        {list}
      </SideSpine>
    </div>
  );
}

// ── New mission: one question, the rest drafted ─────────────────────────────

function useDomains(vaultPath: string) {
  const scan = useInvokeQuery<{ name: string }[]>("scan_vault", { path: vaultPath }, { staleMs: 60_000 });
  return (Array.isArray(scan.data) ? scan.data.map((x) => x.name) : []).filter(isUserDomain).filter((d) => d !== "general");
}

// ── One mission ─────────────────────────────────────────────────────────────

const plainChip = "inline-flex max-w-full items-center truncate rounded-md bg-surface-warm px-1.5 py-px text-[12px] font-medium text-text-secondary";
const personName = (p: string) => titleCase(p.replace(/^[a-z]+\//, "").replace(/-/g, " "));
const domainLink = "font-medium text-text-secondary hover:text-accent";

/** Who the mission brought in, as one muted line: each domain name opens the domain. */
function MissionWho({ m, owner, vaultPath }: { m: Mission; owner: string | null | undefined; vaultPath: string }) {
  // What the mission serves, walked up the Compass chain: initiative, goal, objective (vision on hover).
  const { tree } = useChainTree(vaultPath);
  const chain = walkUp(tree, `mission/${m.slug}`);
  const doms = (ds: string[]) => ds.map((d, i) => <span key={d}>{i > 0 && ", "}<button type="button" onClick={() => window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: d === "general" ? "" : d }))} className={domainLink}>{titleCase(d)}</button></span>);
  const bits: ReactNode[] = [
    <span key="o">Owner {owner ? doms([owner]) : "none yet"}</span>,
    rolesOf(m, "consulted").length > 0 && <span key="r">Reads {doms(rolesOf(m, "consulted"))}</span>,
    rolesOf(m, "informed").length > 0 && <span key="t">Tells {doms(rolesOf(m, "informed"))}</span>,
    m.apps.length > 0 && <span key="a">{m.apps.map(titleCase).join(", ")}</span>,
    m.specialists.length > 0 && <span key="s" data-testid="mission-team" className="inline-flex translate-y-[3px] items-center gap-1 align-baseline" title={m.specialists.map(titleCase).join(", ")}>
      <span className="inline-flex -space-x-1">{m.specialists.map((id) => <SpecialistAvatar key={id} id={id} size={16} className="rounded-full ring-1 ring-background" />)}</span>{m.specialists.length === 1 ? titleCase(m.specialists[0]) : `${m.specialists.length} specialists`}</span>,
    m.people.length > 0 && <span key="p">With {m.people.map(personName).join(", ")}</span>,
    chain.length
      ? <span key="v" data-testid="mission-chain" title={chain.map((n) => `${LEVEL_LABEL[n.level]}: ${n.title}`).join("\n")}>Serves {chain.filter((n) => n.level !== "vision").map((n) => n.title).join(" > ")}</span>
      : <span key="v" data-testid="mission-chain">Not linked to a goal</span>,
  ].filter(Boolean);
  return (
    <p data-testid="mission-chips" className={`${META} mt-0.5 line-clamp-2`}>
      {bits.map((b, i) => <span key={i}>{i > 0 && <span aria-hidden> · </span>}{b}</span>)}
    </p>
  );
}

export function MissionDetail({ vaultPath, slug }: { vaultPath: string; slug: string }) {
  const phone = useIsPhone();
  const q = useMission(vaultPath, slug);
  const m = q.data && typeof q.data === "object" && q.data.slug ? q.data : null;
  const [tab, setTab] = useState<DTab>("chat");
  const [panel, setPanel] = useState<"bring" | "complete" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = async (key: string, f: () => Promise<unknown>) => {
    setBusy(key); setErr(null);
    try { await f(); await q.refresh(); } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };
  if (!m) return <div className={phone ? "px-4 py-4" : "px-8 py-6"} data-testid="mission-detail"><p className={META}>{q.error ? `Could not read the project: ${String(q.error)}` : "Reading the project"}</p></div>;
  const open = m.status === "active" || m.status === "paused";
  const owner = ownerOf(m);
  const pad = phone ? "px-4" : "px-8";
  return (
    <div data-testid="mission-detail" className="flex h-full min-h-0 flex-col">
      <header data-testid="mission-header" className={`sticky top-0 z-10 shrink-0 border-b border-border-subtle bg-background ${pad} pb-0 ${phone ? "pt-3" : "pt-6"}`}>
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <h2 className={`${DETAIL_TITLE} min-w-[10rem] flex-1 break-words`}>{m.name}</h2>
          <div className="flex shrink-0 items-center gap-0.5" role="toolbar" aria-label="Project actions">
            {open && <button className={`${iconBtn} ${panel === "bring" ? "bg-accent-soft text-accent" : ""}`} title="Bring in" aria-label="Bring in" aria-expanded={panel === "bring"} data-testid="mission-bring" onClick={() => setPanel(panel === "bring" ? null : "bring")}><Plus className="h-4 w-4" /></button>}
            {m.status === "active" && <button className={iconBtn} title="Pause" aria-label="Pause" data-testid="mission-pause" disabled={!!busy} onClick={() => void act("pause", () => missionState(vaultPath, slug, "pause"))}><Pause className="h-4 w-4" /></button>}
            {m.status === "paused" && <button className={iconBtn} title="Resume" aria-label="Resume" data-testid="mission-resume" disabled={!!busy} onClick={() => void act("resume", () => missionState(vaultPath, slug, "resume"))}><Play className="h-4 w-4" /></button>}
            {open && <button className={`${iconBtn} ${panel === "complete" ? "bg-accent-soft text-accent" : ""}`} title="Complete" aria-label="Complete" aria-expanded={panel === "complete"} data-testid="mission-complete" onClick={() => setPanel(panel === "complete" ? null : "complete")}><CheckCircle2 className="h-4 w-4" /></button>}
            {m.status !== "archived" && <button className={iconBtn} title="Archive" aria-label="Archive" data-testid="mission-archive" disabled={!!busy} onClick={() => void act("archive", () => missionState(vaultPath, slug, "archive"))}><Archive className="h-4 w-4" /></button>}
            {!open && <button className={iconBtn} title="Reopen" aria-label="Reopen" data-testid="mission-reopen" disabled={!!busy} onClick={() => void act("reopen", () => missionState(vaultPath, slug, "reopen"))}><RotateCcw className="h-4 w-4" /></button>}
          </div>
        </div>
        <p data-testid="mission-meta" className={`${META} mt-1`}>{missionMeta(m)}{m.result ? ` · result ${m.result.replace("-", " ")}` : ""}</p>
        <MissionWho m={m} owner={owner} vaultPath={vaultPath} />
        {err && <p className="mt-2 text-[13px] text-err">{err}</p>}
        <div role="tablist" aria-label="Project" data-scroll-x className={`-mx-1 mt-3 flex gap-x-1 ${phone ? "overflow-x-auto" : "flex-wrap"}`} data-testid="mission-tabs">
          {D_TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} data-testid={`mission-tab-${t.id}`} onClick={() => setTab(t.id)}
              className={`inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-[14px] ${tab === t.id ? "border-accent font-semibold text-text-primary" : "border-transparent text-text-muted hover:text-text-secondary"}`}>
              <t.icon className="h-4 w-4 max-2xl:hidden" />{t.label}
            </button>
          ))}
        </div>
      </header>
      {panel === "bring" && <BringIn vaultPath={vaultPath} m={m} onDone={() => void q.refresh()} onClose={() => setPanel(null)} pad={pad} />}
      {panel === "complete" && <CloseOut vaultPath={vaultPath} m={m} onClose={() => { setPanel(null); void q.refresh(); }} pad={pad} />}
      {tab === "chat" ? (
        <div className="flex min-h-[28rem] flex-1 flex-col" data-testid="mission-chat"><MissionChat vaultPath={vaultPath} m={m} /></div>
      ) : (
        <div className={`min-h-0 flex-1 overflow-y-auto ${pad} py-5`}>
          {tab === "milestones" && <Milestones vaultPath={vaultPath} m={m} />}
          {tab === "tasks" && <Tasks vaultPath={vaultPath} slug={slug} />}
          {tab === "calendar" && <Calendar vaultPath={vaultPath} m={m} />}
          {tab === "budget" && <Budget vaultPath={vaultPath} m={m} />}
          {tab === "artifacts" && <Artifacts m={m} />}
          {tab === "timeline" && <Timeline vaultPath={vaultPath} m={m} />}
          {tab === "setup" && <Setup vaultPath={vaultPath} m={m} />}
        </div>
      )}
    </div>
  );
}

// ── Chat: the same ChatPanel, scoped to the mission ─────────────────────────

const NO_DOMAINS: never[] = [];
const NO_SET = new Set<string>();

function MissionChat({ vaultPath, m }: { vaultPath: string; m: Mission }) {
  const phone = useIsPhone();
  const clis = useDetectedClis();
  const fwLens = useFrameworkLens();
  const key = `_mission-${m.slug}`;
  const threads = useInvokeQuery<ThreadMeta[]>("list_threads", { vault: vaultPath, domain: key }, { invalidateOn: ["prevail:threads-changed"] });
  const list = Array.isArray(threads.data) ? [...threads.data].sort((a, b) => b.updated - a.updated) : [];
  const [path, setPath] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const pick = (p: string | null) => { setPath(p); setNonce((n) => n + 1); };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(list.length > 0 || m.links.threads.length > 0) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-1.5">
          <select aria-label="Conversation" data-testid="mission-thread-pick" value={path ?? ""} onChange={(e) => pick(e.target.value || null)}
            className="h-8 min-w-0 max-w-full flex-1 rounded-md border border-border bg-background px-2 text-[13px] text-text-secondary sm:max-w-sm">
            <option value="">New conversation</option>
            {list.map((t) => <option key={t.path} value={t.path}>{t.title || t.preview || t.slug}</option>)}
          </select>
          <button onClick={() => pick(null)} title="New conversation" aria-label="New conversation" className={iconBtn}><Plus className="h-4 w-4" /></button>
          {m.links.threads.length > 0 && <span className={META}>{m.links.threads.length} earlier chat{m.links.threads.length === 1 ? "" : "s"} in Timeline</span>}
        </div>
      )}
      <ChatPanel
        domain={null} domainPath={null} threadDomain={key} vaultPath={vaultPath} clis={clis} fwLens={fwLens}
        onSwitchToCouncil={() => {}} activeThreadPath={path} chatViewNonce={nonce}
        onActiveThreadChange={(p) => setPath(p)}
        onThreadsChanged={() => { void threads.refresh(); window.dispatchEvent(new Event("prevail:threads-changed")); }}
        onStreamStart={() => {}} onStreamEnd={() => {}}
        domains={NO_DOMAINS} domainStats={{}} runningDomains={NO_SET} finishedDomains={NO_SET} onPickDomain={() => {}}
        domainTab="chat" setDomainTab={() => {}} active={false} phone={phone}
        mission={{ slug: m.slug, name: m.name }}
        scope={{ kind: "mission", slug: m.slug, name: m.name }}
      />
    </div>
  );
}

// ── Bring in: inline under the header, the mission's own suggestions first ──

const SUGGEST: [RegExp, string[]][] = [
  [/\b(learn|practice|lesson|class|course)\b/i, ["tutor", "coach", "researcher"]],
  [/\b(buy|purchase|house|property|car)\b/i, ["researcher", "analyst", "steward"]],
  [/\b(trip|travel|visit|fly)\b/i, ["researcher", "planner"]],
  [/\b(build|ship|launch|app)\b/i, ["builder", "auditor"]],
  [/\b(remodel|renovate|repair|paint)\b/i, ["researcher", "analyst", "liaison"]],
];

function BringIn({ vaultPath, m, onDone, onClose, pad }: { vaultPath: string; m: Mission; onDone: () => void; onClose: () => void; pad: string }) {
  const domains = useDomains(vaultPath);
  const apps = useChatApps(vaultPath);
  const specs = useInvokeQuery<{ id: string; name: string; on: boolean }[]>("engine_specialists", { vault: vaultPath }, { staleMs: 5 * 60_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [person, setPerson] = useState("");
  const run = async (key: string, kind: string, value: string, detach = false) => {
    setBusy(key); setErr(null);
    try { await attachToMission(vaultPath, m.slug, kind, value, detach); onDone(); } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };
  const have = new Set(m.domains.map((d) => d.slug));
  const text = `${m.name} ${m.outcome}`;
  const suggestedAgents = [...new Set(SUGGEST.filter(([re]) => re.test(text)).flatMap(([, ids]) => ids))].filter((id) => !m.specialists.includes(id) && (specs.data ?? []).some((s) => s.id === id));
  const suggestedDomains = ["money"].filter((d) => (m.budget.total_usd || m.budget.lines.length) && domains.includes(d) && !have.has(d));
  const roleSel = (slug: string, role: string) => (
    <select aria-label={`${titleCase(slug)} role`} value={role} disabled={!!busy} onChange={(e) => void run(`d:${slug}`, "domain", `${slug}:${e.target.value}`)}
      className="h-7 rounded-md border border-border bg-background px-1 text-[12px] text-text-secondary">
      <option value="owner">owner</option><option value="consulted">reads</option><option value="informed">tells</option>
    </select>
  );
  const row = (label: string, children: ReactNode) => (
    <div className="flex flex-col gap-1.5 py-1.5 sm:flex-row sm:items-start sm:gap-3">
      <span className="w-28 shrink-0 pt-1 text-[13px] font-medium text-text-muted">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
  const addSel = (label: string, options: { id: string; name: string }[], onPick: (id: string) => void) => (
    <select aria-label={label} value="" disabled={!!busy} onChange={(e) => { if (e.target.value) onPick(e.target.value); }}
      className="h-8 max-w-full rounded-md border border-border bg-background px-2 text-[13px] text-text-secondary">
      <option value="">{label}</option>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
  const removeBtn = (key: string, kind: string, value: string, name: string) => (
    <button onClick={() => void run(key, kind, value, true)} disabled={!!busy} title={`Remove ${name}`} aria-label={`Remove ${name}`} className="rounded p-0.5 text-text-muted hover:text-err"><X className="h-3.5 w-3.5" /></button>
  );
  return (
    <section data-testid="mission-bring-panel" className={`shrink-0 border-b border-border-subtle bg-surface-warm/40 ${pad} py-3`}>
      <div className="flex items-center gap-2"><h3 className={`${SECTION_TITLE} flex-1`}>Bring in</h3><button onClick={onClose} title="Close" aria-label="Close" className={iconBtn}><X className="h-4 w-4" /></button></div>
      {(suggestedAgents.length > 0 || suggestedDomains.length > 0) && row("Suggested", <>
        {suggestedDomains.map((d) => <button key={d} className={textLink} disabled={!!busy} onClick={() => void run(`s:${d}`, "domain", `${d}:consulted`)}><Plus className="h-3.5 w-3.5" />{titleCase(d)}: reads</button>)}
        {suggestedAgents.map((id) => <button key={id} className={textLink} disabled={!!busy} onClick={() => void run(`s:${id}`, "specialist", id)}><SpecialistAvatar id={id} size={18} />{titleCase(id)}</button>)}
      </>)}
      {row("Domains", <>
        {m.domains.map((d) => <span key={d.slug} className="inline-flex items-center gap-1"><DomainChip slug={d.slug} />{roleSel(d.slug, d.role)}{removeBtn(`d:${d.slug}`, "domain", d.slug, titleCase(d.slug))}</span>)}
        {addSel("Add a domain", domains.filter((d) => !have.has(d)).map((d) => ({ id: d, name: titleCase(d) })), (d) => void run(`d:${d}`, "domain", `${d}:${m.domains.some((x) => x.role === "owner") ? "consulted" : "owner"}`))}
      </>)}
      {row("Apps", <>
        {m.apps.map((a) => <span key={a} className="inline-flex items-center gap-0.5"><span className={plainChip}>{titleCase(a)}</span>{removeBtn(`a:${a}`, "app", a, a)}</span>)}
        {addSel("Add an app", apps.filter((a) => !m.apps.includes(a.id)).map((a) => ({ id: a.id, name: a.name })), (a) => void run(`a:${a}`, "app", a))}
      </>)}
      {row("Agents", <>
        {m.specialists.map((a) => <span key={a} className="inline-flex items-center gap-1"><SpecialistAvatar id={a} size={20} /><span className="text-[13px] text-text-secondary">{titleCase(a)}</span>{removeBtn(`s:${a}`, "specialist", a, a)}</span>)}
        {addSel("Add an agent", (specs.data ?? []).filter((s) => s.on && !m.specialists.includes(s.id)).map((s) => ({ id: s.id, name: s.name })), (s) => void run(`s:${s}`, "specialist", s))}
      </>)}
      {row("People", <>
        {m.people.map((p) => <span key={p} className="inline-flex items-center gap-0.5"><span className={plainChip}>{personName(p)}</span>{removeBtn(`p:${p}`, "person", p, p)}</span>)}
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); const v = person.trim().toLowerCase().replace(/[^a-z0-9/]+/g, "-"); if (v) { void run(`p:${v}`, "person", v.includes("/") ? v : `person/${v}`); setPerson(""); } }}>
          <input aria-label="Add a person" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Add a person" className="h-8 w-40 rounded-md border border-border bg-background px-2 text-[13px]" />
        </form>
      </>)}
      {busy && <p className={META}><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />Saving</p>}
      {err && <p className="mt-1 text-[13px] text-err">{err}</p>}
    </section>
  );
}

// ── Close-out: full-width steps on the page ─────────────────────────────────

const RESULTS: { id: string; label: string }[] = [{ id: "met", label: "Met" }, { id: "partly", label: "Partly" }, { id: "not-met", label: "Not met" }, { id: "changed", label: "Changed" }];
const KIND_LABEL: Record<string, string> = { summary: "Summary", lesson: "Lesson", note: "Note", money: "Money", person: "Person", file: "File", task: "Open task", routine: "Routine" };

function CloseOut({ vaultPath, m, onClose, pad }: { vaultPath: string; m: Mission; onClose: () => void; pad: string }) {
  const [result, setResult] = useState("partly");
  const [note, setNote] = useState("");
  const [plan, setPlan] = useState<CloseoutPlan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filed, setFiled] = useState<Receipt[] | null>(null);
  const draft = async () => {
    setBusy("draft"); setErr(null);
    try { setPlan(await closeoutPlan(vaultPath, m.slug, result, note)); } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };
  useEffect(() => { void draft(); }, [result]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (n: number) => setPlan((p) => p && { ...p, filings: p.filings.map((f) => (f.n === n ? { ...f, apply: !f.apply } : f)) });
  const setAction = (n: number, action: "move" | "drop" | "carry") => setPlan((p) => p && { ...p, filings: p.filings.map((f) => (f.n === n ? { ...f, action } : f)) });
  const complete = async () => {
    if (!plan) return;
    setBusy("apply"); setErr(null);
    try { const r = await closeoutApply(vaultPath, { ...plan, result, resultNote: note }); setFiled(r.receipts ?? []); } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };
  const groups = (k: string[]) => (plan?.filings ?? []).filter((f) => k.includes(f.kind));
  const step = (n: number, title: string, body: ReactNode) => (
    <div className="flex gap-3 py-3">
      <span className="w-5 shrink-0 pt-px text-right text-[13px] font-semibold tabular-nums text-text-muted">{n}</span>
      <div className="min-w-0 flex-1"><h4 className="text-[15px] font-semibold text-text-primary">{title}</h4><div className="mt-1.5">{body}</div></div>
    </div>
  );
  const line = (f: CloseoutPlan["filings"][number]) => (
    <label key={f.n} className="flex items-start gap-2 py-1">
      <input type="checkbox" checked={f.apply} onChange={() => toggle(f.n)} className="mt-1 accent-[var(--color-accent)]" aria-label={`File ${KIND_LABEL[f.kind] ?? f.kind} to ${f.domain}`} />
      <span className="min-w-0 flex-1 text-[14px]"><span className="font-medium text-text-primary">{titleCase(f.domain.replace(/^[a-z]+\//, ""))}</span> <span className="text-text-muted">{KIND_LABEL[f.kind] ?? f.kind}</span><span className="block break-words text-text-secondary">{f.text}</span></span>
    </label>
  );
  if (filed) {
    return (
      <section data-testid="mission-closeout-done" className={`shrink-0 border-b border-border-subtle bg-surface-warm/40 ${pad} py-4`}>
        <h3 className={SECTION_TITLE}>Completed</h3>
        <p className={`${BODY} mt-1 text-text-secondary`}>{filed.length} line{filed.length === 1 ? "" : "s"} filed to your domains. Each can be undone for 7 days from the Timeline tab.</p>
        <button className={`${textLink} mt-2`} onClick={onClose}><Check className="h-3.5 w-3.5" />Done</button>
      </section>
    );
  }
  return (
    <section data-testid="mission-closeout" className={`max-h-[70vh] shrink-0 overflow-y-auto border-b border-border-subtle bg-surface-warm/40 ${pad} py-3`}>
      <div className="flex items-center gap-2"><h3 className={`${SECTION_TITLE} min-w-0 flex-1 truncate`}>Complete: {m.name}</h3><button onClick={onClose} title="Close" aria-label="Close" className={iconBtn}><X className="h-4 w-4" /></button></div>
      {step(1, "Result", <div className="flex flex-wrap items-center gap-2">
        <span className={segGroup} role="group" aria-label="Result">{RESULTS.map((r) => <button key={r.id} data-testid={`closeout-result-${r.id}`} aria-pressed={result === r.id} onClick={() => setResult(r.id)} className={seg(result === r.id)}>{r.label}</button>)}</span>
        <input aria-label="In your words" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => void draft()} placeholder="In your words (optional)" className="h-8 min-w-0 flex-1 basis-48 rounded-md border border-border bg-background px-2 text-[13px]" />
      </div>)}
      {!plan ? <p className={META}>{busy ? "Drafting the close-out" : ""}</p> : <>
        {step(2, "Lessons", groups(["lesson"]).length ? groups(["lesson"]).map(line) : <p className={META}>Nothing written down as learned. Add lines to the project's memory, or say them in chat.</p>)}
        {step(3, "Open tasks", groups(["task"]).length ? groups(["task"]).map((f) => (
          <div key={f.n} className="flex flex-wrap items-center gap-2 py-1">
            <span className="min-w-0 flex-1 basis-48 text-[14px] text-text-primary">{f.text.replace(/\s+[~@+]\S+/g, "")}</span>
            <span className={segGroup} role="group" aria-label={`What happens to ${f.text}`}>{(["move", "drop", "carry"] as const).map((a) => <button key={a} aria-pressed={(f.action ?? "move") === a} onClick={() => setAction(f.n, a)} className={seg((f.action ?? "move") === a)}>{a === "move" ? `Move to ${titleCase(f.domain)}` : titleCase(a)}</button>)}</span>
          </div>
        )) : <p className={META}>No open project tasks.</p>)}
        {step(4, "Filing", <div>{groups(["summary", "note", "money", "person", "file", "routine"]).map(line)}</div>)}
        <div className="flex flex-wrap items-center gap-3 py-2 pl-8">
          <button data-testid="closeout-apply" onClick={() => void complete()} disabled={!!busy} className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-[14px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50">{busy === "apply" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Complete project</button>
          <span className={META}>Nothing is deleted. Each line keeps a receipt and an Undo for 7 days.</span>
        </div>
      </>}
      {err && <p className="mt-1 text-[13px] text-err">{err}</p>}
    </section>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────────

function Milestones({ vaultPath, m }: { vaultPath: string; m: Mission }) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (key: string, f: () => Promise<unknown>) => { setBusy(key); setErr(null); try { await f(); } catch (e) { setErr(String(e)); } finally { setBusy(null); } };
  const p = m.progress.milestones;
  return (
    <section data-testid="mission-milestones">
      {p.total > 0 && <p className={META}>{p.done} of {p.total} done{p.overdue.length ? ` · ${p.overdue.length} overdue` : ""}</p>}
      <ul className="mt-1 divide-y divide-border-subtle">
        {m.milestones.map((x) => (
          <li key={x.id} className="flex items-center gap-3 py-2">
            <button onClick={() => void run(x.id, () => missionMilestone(vaultPath, m.slug, x.done ? "undone" : "done", { id: x.id }))} disabled={!!busy} aria-label={x.done ? `Reopen ${x.title}` : `Mark ${x.title} done`} title={x.done ? "Reopen" : "Mark done"}
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${x.done ? "border-accent bg-accent text-white" : "border-border hover:border-accent"}`}>{x.done && <Check className="h-3.5 w-3.5" />}</button>
            <span title={x.check ? `${x.title}. Done when: ${x.check}` : x.title} className={`min-w-0 flex-1 line-clamp-2 break-words text-[15px] ${x.done ? "text-text-muted line-through" : "text-text-primary"}`}>{x.title}</span>
            <span className="shrink-0 text-[13px] tabular-nums text-text-muted">{fmtDate(x.doneOn ?? x.due)}</span>
          </li>
        ))}
      </ul>
      {m.milestones.length === 0 && <p className={META}>No milestones yet. Two or three checkpoints on the way to the outcome are enough.</p>}
      <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) void run("add", async () => { await missionMilestone(vaultPath, m.slug, "add", { title: title.trim(), due: due || undefined }); setTitle(""); setDue(""); }); }}>
        <input aria-label="New milestone" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New milestone" className="h-9 min-w-0 flex-1 basis-48 rounded-lg border border-border bg-background px-2.5 text-[14px]" />
        <input type="date" aria-label="Due" value={due} onChange={(e) => setDue(e.target.value)} className="h-9 rounded-lg border border-border bg-background px-2 text-[14px]" />
        <button type="submit" disabled={!title.trim() || !!busy} title="Add milestone" aria-label="Add milestone" className={iconBtn}>{busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}</button>
      </form>
      {err && <p className="mt-2 text-[13px] text-err">{err}</p>}
    </section>
  );
}

function Tasks({ vaultPath, slug }: { vaultPath: string; slug: string }) {
  const q = useInvokeQuery<MissionTask[]>("engine_missions_show", { vault: vaultPath, slug, part: "tasks" }, { invalidateOn: ["prevail:missions-changed"] });
  const tasks = Array.isArray(q.data) ? q.data : [];
  const open = tasks.filter((t) => !t.done);
  return (
    <section data-testid="mission-tasks">
      {tasks.length > 0 && <p className={META} title="The project's own tasks, and tasks in any domain marked for it">{open.length} open</p>}
      {tasks.length === 0 ? <p className={META}>No tasks yet. Jobs this project runs add the next step here.</p> : (
        <ul className="mt-1 divide-y divide-border-subtle">{tasks.map((t, i) => (
          <li key={`${t.id ?? i}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
            <span title={t.text} className={`min-w-0 flex-1 basis-48 line-clamp-2 break-words text-[15px] ${t.done ? "text-text-muted line-through" : "text-text-primary"}`}>{t.text}</span>
            {(t.due || !t.own) && <span className={`${META} tabular-nums`}>{[!t.own ? titleCase(t.domain) : "", fmtDate(t.due)].filter(Boolean).join(" · ")}</span>}
          </li>
        ))}</ul>
      )}
    </section>
  );
}

function Calendar({ vaultPath, m }: { vaultPath: string; m: Mission }) {
  const ev = m.links.calendar;
  const pq = useInvokeQuery<PendingEvent[]>("engine_missions_progress", { vault: vaultPath, sub: "events-pending", slug: m.slug }, { invalidateOn: [MISSIONS_CHANGED] });
  const pending = new Map((Array.isArray(pq.data) ? pq.data : []).map((p) => [p.id, p]));
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (key: string, f: () => Promise<unknown>) => { setBusy(key); setErr(null); try { await f(); await pq.refresh(); } catch (e) { setErr(String(e)); } finally { setBusy(null); } };
  const attendees = who.split(",").map((x) => x.trim()).filter(Boolean);
  return (
    <section data-testid="mission-calendar">
      <p className={META}>Events that match the project count on their own. A hold on your calendar waits for your yes; an event with other people stays a draft you send.</p>
      {ev.length === 0 ? null : (
        <ul className="mt-3 divide-y divide-border-subtle">{ev.map((e) => {
          const p = pending.get(e.event);
          return (
            <li key={e.event} data-testid="mission-event" className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="w-32 shrink-0 text-[13px] tabular-nums text-text-muted">{fmtDate(e.start)}{e.start.length > 10 ? ` ${e.start.slice(11, 16)}` : ""}</span>
              <span className="min-w-0 flex-1 basis-40 break-words text-[15px] text-text-primary">{e.title}</span>
              <span className={META} data-testid="mission-event-state">{p ? pendingLabel(p) : e.source === "created" ? "created" : "matched"}</span>
              {p?.status === "ask" && <button onClick={() => void run(p.id, () => approveMissionEvent(vaultPath, m.slug, p.id))} disabled={!!busy} title="Put the hold on my calendar" aria-label={`Approve ${e.title}`} data-testid="mission-event-approve" className={iconBtn}>{busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}</button>}
            </li>
          );
        })}</ul>
      )}
      <form className="mt-4 flex flex-wrap items-center gap-2" data-testid="mission-event-form" onSubmit={(e) => { e.preventDefault(); if (title.trim() && start) void run("create", async () => { await createMissionEvent(vaultPath, m.slug, { title: title.trim(), start, attendees }); setTitle(""); setStart(""); setWho(""); }); }}>
        <input aria-label="Event title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A practice block, a viewing" className="h-9 min-w-0 flex-1 basis-48 rounded-lg border border-border bg-background px-2.5 text-[14px]" />
        <input type="datetime-local" aria-label="Starts" value={start} onChange={(e) => setStart(e.target.value)} className="h-9 min-w-0 rounded-lg border border-border bg-background px-2 text-[14px]" />
        <input aria-label="With (emails, optional)" value={who} onChange={(e) => setWho(e.target.value)} placeholder="With (emails, optional)" className="h-9 min-w-0 flex-1 basis-40 rounded-lg border border-border bg-background px-2.5 text-[14px]" />
        <button type="submit" disabled={!title.trim() || !start || !!busy} className={textLink}>{busy === "create" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}{attendees.length ? "Draft invite" : "Draft a hold"}</button>
      </form>
      {err && <p className="mt-2 text-[13px] text-err">{err}</p>}
    </section>
  );
}

function Budget({ vaultPath, m }: { vaultPath: string; m: Mission }) {
  const b = m.progress.budget;
  const [line, setLine] = useState("");
  const [amount, setAmount] = useState("");
  const [what, setWhat] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const record = async (op: "spend" | "set-line") => {
    const n = Number(amount);
    if (!line.trim() || !Number.isFinite(n) || n <= 0) { setErr("A line and an amount, please."); return; }
    setBusy(true); setErr(null);
    try { await missionBudget(vaultPath, m.slug, op, line.trim(), n, what.trim() || undefined); setAmount(""); setWhat(""); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  return (
    <section data-testid="mission-budget">
      <p className={META}>{b.planned ? `${usd(b.used)} of ${usd(b.planned)} · ${Math.round(b.share * 100)}%` : b.used ? `${usd(b.used)} spent, no plan set` : "No budget set"}</p>
      {b.planned > 0 && <div className="mt-3 h-2 w-full max-w-xl overflow-hidden rounded-full bg-surface-warm" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(b.share * 100)}><div className={`h-full ${b.share > 1 ? "bg-err" : b.share >= 0.8 ? "bg-warn" : "bg-accent"}`} style={{ width: `${Math.min(100, b.share * 100)}%` }} /></div>}
      {b.byLine.length > 0 && (
        <ul className="mt-3 max-w-xl divide-y divide-border-subtle">{b.byLine.map((l) => (
          <li key={l.id} className="flex items-center gap-3 py-2"><span className="min-w-0 flex-1 truncate text-[15px] text-text-primary">{l.label}</span><span className="text-[14px] tabular-nums text-text-secondary">{usd(l.used)} of {usd(l.planned)}</span></li>
        ))}</ul>
      )}
      <h3 className={`${SECTION_TITLE} mt-6`}>Record a spend or plan a line</h3>
      <p className={META}>A spend is recorded here, never paid. A charge already recorded counts once.</p>
      <div className="mt-2 flex max-w-2xl flex-wrap items-center gap-2">
        <input aria-label="Line" value={line} onChange={(e) => setLine(e.target.value)} placeholder="Line (lessons)" className="h-9 min-w-0 flex-1 basis-32 rounded-lg border border-border bg-background px-2.5 text-[14px]" />
        <input aria-label="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="$" className="h-9 w-24 rounded-lg border border-border bg-background px-2.5 text-[14px]" />
        <input aria-label="What" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="What (optional)" className="h-9 min-w-0 flex-1 basis-40 rounded-lg border border-border bg-background px-2.5 text-[14px]" />
        <button className={textLink} disabled={busy} onClick={() => void record("spend")}>Spent</button>
        <button className={textLink} disabled={busy} onClick={() => void record("set-line")}>Plan line</button>
      </div>
      {err && <p className="mt-2 text-[13px] text-err">{err}</p>}
    </section>
  );
}

function Artifacts({ m }: { m: Mission }) {
  const a = m.artifacts ?? [];
  const KIND = { artifact: "Made here", file: "Added by you", brief: "Job page" } as const;
  return (
    <section data-testid="mission-artifacts">
      {a.length === 0 ? <p className={META}>Nothing yet. Pages jobs write, plans and drafts land here, newest first.</p> : (
        <ul className="divide-y divide-border-subtle">{a.map((x) => (
          <li key={x.path} className="flex flex-wrap items-center gap-x-3 py-2">
            <FileText className="h-4 w-4 shrink-0 text-text-muted" />
            <span className="min-w-0 flex-1 basis-48 truncate text-[15px] text-text-primary" title={x.path}>{x.name}</span>
            <span className={META}>{KIND[x.kind]} · {new Date(x.mtime).toLocaleDateString()}</span>
          </li>
        ))}</ul>
      )}
    </section>
  );
}

function Timeline({ vaultPath, m }: { vaultPath: string; m: Mission }) {
  const jobs = useInvokeQuery<{ id: string; ask: string; status: string; created: number; domains: { owner: string } }[]>("engine_jobs", { vault: vaultPath }, { staleMs: 10_000 });
  const filed = useInvokeQuery<Receipt[]>("engine_missions_show", { vault: vaultPath, slug: m.slug, part: "filed" }, { invalidateOn: ["prevail:missions-changed"] });
  const mine = (Array.isArray(jobs.data) ? jobs.data : []).filter((j) => j.domains?.owner === m.id);
  const receipts = Array.isArray(filed.data) ? filed.data : [];
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const undo = async (n: number) => { setBusy(n); setErr(null); try { await closeoutUndo(vaultPath, m.slug, n); await filed.refresh(); } catch (e) { setErr(String(e)); } finally { setBusy(null); } };
  return (
    <section data-testid="mission-timeline" className="space-y-6">
      {receipts.length > 0 && <div>
        <h3 className={SECTION_TITLE}>Filed at close-out</h3>
        <ul className="mt-2 divide-y divide-border-subtle">{receipts.map((r) => (
          <li key={r.n} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
            <span className={`min-w-0 flex-1 basis-48 break-words text-[14px] ${r.undone ? "text-text-muted line-through" : "text-text-primary"}`}><span className="font-medium">{titleCase(r.domain.replace(/^[a-z]+\//, ""))}</span> {r.text}</span>
            {!r.undone && Date.now() - r.ts < 7 * 864e5 && <button onClick={() => void undo(r.n)} disabled={busy !== null} title="Undo" aria-label={`Undo ${r.text}`} className={iconBtn}>{busy === r.n ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}</button>}
          </li>
        ))}</ul>
        {err && <p className="mt-1 text-[13px] text-err">{err}</p>}
      </div>}
      {mine.length > 0 && <div>
        <h3 className={SECTION_TITLE}>Jobs</h3>
        <ul className="mt-2 divide-y divide-border-subtle">{mine.map((j) => (
          <li key={j.id} className="flex flex-wrap items-center gap-x-3 py-2"><span className="min-w-0 flex-1 basis-48 break-words text-[14px] text-text-primary">{j.ask}</span><span className={META}>{new Date(j.created).toLocaleDateString()}</span><StatusDot tone={j.status === "done" ? "ok" : j.status === "running" ? "accent" : j.status === "failed" ? "err" : j.status === "proposed" || j.status === "needs-approval" ? "warn" : "muted"} label={titleCase(j.status.replace("-", " "))} /></li>
        ))}</ul>
      </div>}
      <div>
        <h3 className={SECTION_TITLE}>Log</h3>
        {(m.log ?? []).length === 0 ? <p className={`${META} mt-1`}>Nothing logged yet.</p> : (
          <ul className="mt-2 space-y-1">{(m.log ?? []).map((l, i) => <li key={i} className="break-words text-[14px] text-text-secondary"><span className="mr-2 tabular-nums text-text-muted">{l.slice(0, 10)}</span>{l.slice(11)}</li>)}</ul>
        )}
      </div>
      {m.links.threads.length > 0 && <div>
        <h3 className={SECTION_TITLE}>Earlier chats</h3>
        <ul className="mt-2 space-y-1">{m.links.threads.map((t) => <li key={t.thread} className="text-[14px] text-text-secondary">{t.title || t.thread} <span className={META}>in {titleCase(t.domain)}</span></li>)}</ul>
      </div>}
    </section>
  );
}

function Setup({ vaultPath, m }: { vaultPath: string; m: Mission }) {
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const set = async (field: string, value: string) => {
    setErr(null);
    try { await setMissionField(vaultPath, m.slug, field, value); setSaved(field); window.setTimeout(() => setSaved(null), 1500); } catch (e) { setErr(String(e)); }
  };
  const text = (field: string, label: string, value: string, placeholder = "", area = false) => (
    <label className="block">
      <span className={fieldLabel}>{label}{saved === field && <span className="ml-2 text-accent">saved</span>}</span>
      {area ? <textarea key={value} aria-label={label} defaultValue={value} placeholder={placeholder} rows={3} onBlur={(e) => { if (e.target.value.trim() !== value) void set(field, e.target.value.trim()); }} className={inputCls} />
        : <input key={value} aria-label={label} defaultValue={value} placeholder={placeholder} onBlur={(e) => { if (e.target.value.trim() !== value) void set(field, e.target.value.trim()); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} className={inputCls} />}
    </label>
  );
  return (
    <section data-testid="mission-setup" className="grid max-w-3xl gap-4">
      <SourcesInUse vaultPath={vaultPath} project={m.slug} />
      {text("name", "Name", m.name)}
      {text("outcome", "Outcome", m.outcome, "What done looks like, in one line")}
      {text("why", "Why, in your words", m.why, "", true)}
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block"><span className={fieldLabel}>Target date</span><input type="date" aria-label="Target date" value={m.target} onChange={(e) => e.target.value && void set("target", e.target.value)} className={inputCls} /></label>
        <label className="block"><span className={fieldLabel}>Check-in</span>
          <select aria-label="Check-in" value={m.cadence} onChange={(e) => void set("cadence", e.target.value)} className={inputCls}>{["daily", "weekly", "biweekly", "monthly"].map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</select></label>
        <label className="block"><span className={fieldLabel}>Ceiling</span>
          <select aria-label="Ceiling" value={m.ceiling} onChange={(e) => void set("ceiling", e.target.value)} className={inputCls}>{CEILINGS.map((c) => <option key={c} value={c}>{c.replace("-", " ")}</option>)}</select></label>
      </div>
      <p className={META}>The ceiling only tightens: a read project never drafts, and acting, sending, spending or anything touching other people always asks you.</p>
      <p className={META} data-testid="mission-telegram">Practice and spends told on the phone or Telegram that name this project count here (practice goes here on its own when it is your only learning project). On Telegram, /m {m.slug} pins a chat to it.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        {text("budget-usd", "Budget ($)", m.budget.total_usd != null ? String(m.budget.total_usd) : "", "none")}
        {text("hours-wk", "Hours a week", m.budget.hours_wk != null ? String(m.budget.hours_wk) : "", "none")}
        <label className="flex items-center gap-2 pt-6"><input type="checkbox" checked={m.privacy.localOnly} onChange={(e) => void set("local-only", e.target.checked ? "true" : "false")} className="accent-[var(--color-accent)]" /><span className="text-[14px] text-text-secondary">Local models only{m.localOnly && !m.privacy.localOnly ? " (a domain already requires it)" : ""}</span></label>
      </div>
      {text("notes", "Your notes", m.notes, "Never overwritten", true)}
      {err && <p className="text-[13px] text-err">{err}</p>}
      <Progress vaultPath={vaultPath} m={m} />
    </section>
  );
}

/** The Compass paths a mission can carry out: chosen or in trial, with their goal. */
export function chosenPaths(compassText: string): { id: string; title: string; goal: string }[] {
  const doc = parseCompass(compassText);
  return doc.sections.filter((x) => x.kind === "goal").flatMap((x) => x.blocks.flatMap((b) => ("item" in b ? b.item.paths.filter((p) => ["chosen", "trial"].includes(p.tokens.status ?? "")).map((p) => ({ id: p.id, title: p.title, goal: b.item.title })) : [])));
}

/** What counts toward the mission without data entry: its match rules, its metrics, and the Compass path it carries out. */
function Progress({ vaultPath, m }: { vaultPath: string; m: Mission }) {
  const pq = useInvokeQuery<MetricProposalM[]>("engine_missions_progress", { vault: vaultPath, sub: "metrics", slug: m.slug }, { invalidateOn: [MISSIONS_CHANGED] });
  const cq = useInvokeQuery<string>("compass_read", { vault: vaultPath }, { staleMs: 60_000 });
  const props = Array.isArray(pq.data) ? pq.data : [];
  const tracked = new Set(m.metrics ?? []);
  const paths = chosenPaths(typeof cq.data === "string" ? cq.data : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (key: string, f: () => Promise<unknown>) => { setBusy(key); setErr(null); try { await f(); await pq.refresh(); } catch (e) { setErr(String(e)); } finally { setBusy(null); } };
  const rules: [string, string, string[] | undefined, string][] = [["Calendar titles", "match-calendar", m.match?.calendar, "cello lesson, recital"], ["Mail from", "match-email-from", m.match?.email_from, "@school.example"], ["Card charges from", "match-merchants", m.match?.merchants, "MUSIC SCHOOL"]];
  const [draft, setDraft] = useState<Record<string, string>>({});
  const saveRule = (field: string, cur: string) => { const v = draft[field]; if (v === undefined || v === cur) return; void run(field, () => setMissionField(vaultPath, m.slug, field, v)); };
  return (
    <div className="grid gap-4 border-t border-border-subtle pt-4" data-testid="mission-progress">
      <div>
        <h3 className={SECTION_TITLE}>What counts on its own</h3>
        <dl className="mt-2 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-y-1 text-[14px]">
          {rules.flatMap(([k, field, v, hint]) => [<dt key={`${k}-t`} className="self-center text-text-muted">{k}</dt>, <dd key={`${k}-d`} className="min-w-0">
            <input aria-label={k} data-testid={`mission-${field}`} value={draft[field] ?? (v ?? []).join(", ")} placeholder={hint} disabled={!!busy}
              onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))} onBlur={() => saveRule(field, (v ?? []).join(", "))}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className={inputCls} />
          </dd>])}
        </dl>
      </div>
      <div>
        <h3 className={SECTION_TITLE}>Metrics</h3>
        {props.length === 0 ? <p className={`${META} mt-1`}>Nothing to propose for this kind of project yet.</p> : (
          <ul className="mt-2 divide-y divide-border-subtle">{props.map((p) => (
            <li key={p.key} data-testid="mission-metric" className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
              <span className="min-w-0 flex-1 basis-48"><span className="block break-words text-[15px] text-text-primary">{p.title}</span><span title={p.why} className={`${META} block line-clamp-2 break-words`}>{p.why}</span></span>
              {tracked.has(p.id) ? <span className={META} data-testid="mission-metric-tracked">Tracking</span>
                : <button onClick={() => void run(p.key, () => trackMissionMetric(vaultPath, m.slug, p.key))} disabled={!!busy} className={textLink} data-testid="mission-metric-track">{busy === p.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Track</button>}
            </li>
          ))}</ul>
        )}
      </div>
      <label className="block">
        <span className={fieldLabel}>Carries out a Compass path</span>
        <select aria-label="Compass path" data-testid="mission-path" value={m.path ?? ""} disabled={!!busy || !paths.length}
          onChange={(e) => e.target.value && void run("path", () => linkMissionPath(vaultPath, m.slug, e.target.value))} className={inputCls}>
          <option value="">{paths.length ? "Not linked" : "No chosen paths in your Compass"}</option>
          {paths.map((p) => <option key={p.id} value={p.id}>{p.goal}: {p.title}</option>)}
        </select>
      </label>
      {err && <p className="text-[13px] text-err">{err}</p>}
    </div>
  );
}
