// Work > Projects: the efforts you track, each with an outcome and an end
// (the entity kind `project`). Laid out like Goals: the page header with
// Active / Paused / Done / All, a column (New project, the tracked projects,
// then Intent projects not tracked yet under "Suggested from your prompts"),
// and the picked project in the detail pane, drawn by the entity detail with
// a project Overview and, for one made from Intent, its restart Brief.
// Intent > Projects stays the inferred view (projectsview.tsx).
import { noteCompassFocus } from "./navdefs";
import { useEffect, useMemo, useState } from "react";
import { Check, FolderKanban, FolderPlus, Loader2, Plus, Target, X } from "lucide-react";
import { useInvokeQuery } from "./query";
import { titleCase } from "./format";
import { isUserDomain } from "./helpers";
import { SettingsHeader } from "./sectionutil";
import { SideSpine, SpineTabs } from "./sidespine";
import { useIsPhone } from "./useisphone";
import { BODY, DETAIL_TITLE, META, SECTION_TITLE } from "./typescale";
import { EntityChip } from "./entities";
import { AvatarImg, useEntityPicture } from "./entityavatar";
import { EntityDetailView, type EntityDetail } from "./entitydetail";
import { AcrossYourLife, DomainChip } from "./linking";
import { displayTitle, IntentBrief, nPrompts, type ProjectsIndex } from "./projectsview";
import {
  createProject, OPEN_PROJECT_EVENT, PROJECT_STATUSES, setProject, slugOf, statusOf, takeOpenProject, useTrackedProjects,
  type ProjectStatus, type TrackedProject,
} from "./trackedprojects";

type Tab = "active" | "paused" | "done" | "all";
const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-[15px] text-text-primary focus:border-accent-border focus:outline-none";
const fieldLabel = "mb-1 block text-[13px] font-medium text-text-secondary";
const iconBtn = "rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-warm hover:text-accent";
const fmtTarget = (t?: string) => (t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? new Date(`${t}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
export const projectMeta = (p: { status?: string; target?: string }) => [titleCase(statusOf(p)), p.target ? `Target ${fmtTarget(p.target)}` : ""].filter(Boolean).join(" · ");

function ProjectMark({ p, size = 28 }: { p: TrackedProject; size?: number }) {
  const src = useEntityPicture({ id: p.id, kind: "project", picture: p.picture });
  if (src) return <AvatarImg src={src} size={size} round={false} />;
  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-lg border border-border bg-surface-warm text-text-secondary" style={{ width: size, height: size }}>
      <FolderKanban className="h-3.5 w-3.5" />
    </span>
  );
}

// The Overview of one project: its outcome, status, target and domains, all
// edited in place, then its goals, the entities it comes up with, and what
// other conversations noted about it.
function ProjectOverview({ vaultPath, d, reload, summary }: { vaultPath: string; d: EntityDetail; reload: () => Promise<void>; summary?: TrackedProject }) {
  const status = statusOf({ status: d.status ?? summary?.status });
  const outcome = d.outcome ?? summary?.outcome ?? "";
  const target = d.target ?? summary?.target ?? "";
  const domains = d.domains ?? summary?.domains ?? [];
  const [err, setErr] = useState<string | null>(null);
  const scan = useInvokeQuery<{ name: string }[]>("scan_vault", { path: vaultPath }, { staleMs: 60_000 });
  const allDomains = (Array.isArray(scan.data) ? scan.data.map((x) => x.name) : []).filter(isUserDomain);
  const set = async (patch: Parameters<typeof setProject>[2]) => {
    setErr(null);
    try { await setProject(vaultPath, d.id, patch); await reload(); }
    catch (e) { setErr(`Could not save: ${String(e)}`); }
  };
  return (
    <div data-testid="project-overview" className="pb-6">
      {err && <p className="mt-4 text-[13px] text-err">{err}</p>}
      <div className="mt-5 grid max-w-3xl gap-4">
        <label className="block">
          <span className={fieldLabel}>Outcome</span>
          <input key={outcome} aria-label="Outcome" defaultValue={outcome} placeholder="What done looks like, in one line"
            onBlur={(e) => { if (e.target.value.trim() !== outcome) void set({ outcome: e.target.value.trim() }); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} className={inputCls} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={fieldLabel}>Status</span>
            <select aria-label="Status" data-testid="project-status" value={status} onChange={(e) => void set({ status: e.target.value as ProjectStatus })} className={inputCls}>
              {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabel}>Target date</span>
            <input type="date" aria-label="Target date" value={target} onChange={(e) => void set({ target: e.target.value })} className={inputCls} />
          </label>
        </div>
        <div>
          <span className={fieldLabel}>Domains</span>
          <div className="flex flex-wrap items-center gap-2" data-testid="project-domains">
            {domains.map((slug) => (
              <span key={slug} className="inline-flex items-center gap-0.5">
                <DomainChip slug={slug} />
                <button onClick={() => void set({ domains: domains.filter((x) => x !== slug) })} aria-label={`Remove ${titleCase(slug)}`} title="Remove" className="rounded p-0.5 text-text-muted hover:text-err">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            <select aria-label="Add a domain" value="" onChange={(e) => { if (e.target.value) void set({ domains: [...domains, e.target.value] }); }}
              className="h-8 rounded-lg border border-border bg-background px-2 text-[13px] text-text-secondary focus:border-accent-border focus:outline-none">
              <option value="">Add a domain</option>
              {allDomains.filter((x) => !domains.includes(x)).map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}
            </select>
          </div>
        </div>
      </div>

      <h3 className={`${SECTION_TITLE} mt-8 mb-2`}>Goals</h3>
      {d.goals?.length ? (
        <ul className="space-y-1" data-testid="project-goals">{d.goals.map((g, i) => (
          <li key={i}><button onClick={() => { noteCompassFocus("goals"); window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "compass" })); }}
            className={`${BODY} text-left text-text-primary hover:text-accent ${g.status === "done" ? "text-text-muted line-through" : ""}`}>
            {g.title}<span className={`${META} ml-2`}>{titleCase(g.domain)}</span>
          </button></li>
        ))}</ul>
      ) : <p className={`${BODY} text-text-muted`}>No goals name it yet. Link one from its goal's Project picker.</p>}

      {d.co_mentions?.length > 0 && (
        <>
          <h3 className={`${SECTION_TITLE} mt-8 mb-2`}>Related</h3>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-[15px]">
            {d.co_mentions.slice(0, 10).map((c) => <EntityChip key={c.id} entity={{ kind: c.kind, value: slugOf(c.id) }}>{c.name}</EntityChip>)}
          </div>
        </>
      )}

      <h3 className={`${SECTION_TITLE} mt-8 mb-3`}>Across your life</h3>
      <AcrossYourLife vaultPath={vaultPath} target={{ entity: d.id }} emptyName={d.name} />
    </div>
  );
}

export function ProjectsPage({ vaultPath }: { vaultPath: string }) {
  const phone = useIsPhone();
  const { projects, loading } = useTrackedProjects(vaultPath);
  const intent = useInvokeQuery<ProjectsIndex | null>("projects_index", { vault: vaultPath });
  const [tab, setTab] = useState<Tab>("active");
  const [sel, setSel] = useState<string | null>(() => takeOpenProject());
  const [picked, setPicked] = useState(() => sel !== null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const take = (e: Event) => { const id = (e as CustomEvent<string>).detail; takeOpenProject(); if (id) { setSel(id); setPicked(true); } };
    window.addEventListener(OPEN_PROJECT_EVENT, take);
    return () => window.removeEventListener(OPEN_PROJECT_EVENT, take);
  }, []);

  const count = (t: Tab) => projects.filter((p) => t === "all" ? statusOf(p) !== "archived" : statusOf(p) === t).length;
  const shown = useMemo(() => projects.filter((p) => (tab === "all" ? true : statusOf(p) === tab))
    .sort((a, b) => (b.last_ts ?? 0) - (a.last_ts ?? 0)), [projects, tab]);
  const suggested = useMemo(() => {
    const taken = new Set(projects.map((p) => p.intent_project).filter(Boolean));
    return (intent.data?.projects ?? []).filter((p) => !taken.has(p.slug) && p.status !== "done").sort((a, b) => b.last_ts - a.last_ts).slice(0, 8);
  }, [projects, intent.data]);
  // Desktop opens on the first project; a phone opens on the list.
  // A project just made (or accepted) opens before the list has caught up.
  const fresh: TrackedProject | null = sel ? { id: sel, name: titleCase(slugOf(sel).replace(/-/g, " ")), kind: "project", aliases: [], mention_count: 0, conversations: 0, last_ts: 0, saved: true, has_page: true } : null;
  const cur = projects.find((p) => p.id === sel) ?? fresh ?? (phone ? null : shown[0] ?? null);
  const curId = sel ?? cur?.id ?? null;

  const pick = (id: string) => { setSel(id); setPicked(true); };
  const create = async (a: Parameters<typeof createProject>[1], key: string) => {
    setBusy(key); setErr(null);
    try {
      const made = await createProject(vaultPath, a);
      if (made?.id) { if (tab !== "all" && tab !== "active") setTab("active"); pick(made.id); }
      setAdding(false); setName("");
    } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };

  const rowCls = (on: boolean) => `mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`;
  const list = (
    <nav className="p-2" aria-label="Projects">
      {adding && (
        <form data-testid="project-new-form" className="mb-2 flex items-center gap-1.5 px-1" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void create({ name: name.trim() }, "new"); }}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" aria-label="Project name"
            onKeyDown={(e) => { if (e.key === "Escape") { setAdding(false); setName(""); } }}
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-[14px] text-text-primary outline-none focus:border-accent-border" />
          <button type="submit" disabled={!name.trim() || busy === "new"} aria-label="Create project" title="Create" className={`${iconBtn} disabled:opacity-40`}>
            {busy === "new" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </button>
          <button type="button" onClick={() => { setAdding(false); setName(""); }} aria-label="Cancel" title="Cancel" className={iconBtn}><X className="h-4 w-4" /></button>
        </form>
      )}
      {err && <p className="px-2.5 pb-2 text-[13px] text-err">{err}</p>}
      {loading && !projects.length ? <p className="px-2.5 py-1 text-[13px] text-text-muted">Reading your projects</p>
        : shown.length === 0 ? <p className="px-2.5 py-1 text-[13px] text-text-muted">{tab === "active" || tab === "all" ? "No projects yet." : `Nothing ${tab}.`}</p> : null}
      {shown.map((p) => {
        const on = p.id === curId && (!phone || picked);
        return (
          <button key={p.id} data-testid="project-row" aria-current={on ? "true" : undefined} onClick={() => pick(p.id)} className={rowCls(on)}>
            <ProjectMark p={p} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[14px] ${on ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{p.name}</span>
              <span className="block truncate text-[12px] text-text-muted">{projectMeta(p)}</span>
            </span>
          </button>
        );
      })}
      {suggested.length > 0 && (
        <section data-testid="projects-suggested" className="mt-3">
          <h3 className="px-2.5 pb-1 pt-2 text-[13px] font-semibold text-text-secondary">Suggested from your prompts</h3>
          {suggested.map((p) => (
            <div key={p.slug} data-testid="suggested-project" className="flex items-center gap-2 rounded-lg px-2.5 py-1.5">
              <Target className="h-4 w-4 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-text-secondary">{displayTitle(p.title)}</span>
                <span className="block truncate text-[12px] text-text-muted">{titleCase(p.domain)} · {nPrompts(p.prompt_count)}</span>
              </span>
              <button onClick={() => void create({ name: displayTitle(p.title), fromIntent: p.slug }, p.slug)} disabled={busy !== null} data-testid="suggested-track"
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-[12px] font-medium text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-60">
                {busy === p.slug ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderPlus className="h-3.5 w-3.5" />}Track
              </button>
            </div>
          ))}
        </section>
      )}
    </nav>
  );

  const detail = cur ? (
    <div className={`flex min-h-0 flex-col ${phone ? "px-4 py-4" : "h-full px-8 py-6"}`}>
      <EntityDetailView key={cur.id} vaultPath={vaultPath} target={{ kind: "project", value: slugOf(cur.id) }} meta={projectMeta(cur)}
        overview={(d, reload) => <ProjectOverview vaultPath={vaultPath} d={d} reload={reload} summary={cur} />}
        brief={cur.intent_project ? <IntentBrief vaultPath={vaultPath} slug={cur.intent_project} /> : undefined} />
    </div>
  ) : (
    <div className={phone ? "px-4 py-4" : "w-full px-8 py-6"} data-testid="projects-empty">
      <h2 className={DETAIL_TITLE}>Your projects</h2>
      <p className={`${BODY} mt-2 max-w-2xl text-text-secondary`}>
        An effort with an outcome and an end: a trip, an instrument, an app. Chat with it, keep its notes and files, and link your goals to it.
      </p>
      <button onClick={() => setAdding(true)} className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-[14px] font-semibold text-white hover:bg-accent-hover">
        <Plus className="h-4 w-4" />New project
      </button>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="projects-page">
      <SettingsHeader title="Projects" icon={FolderKanban} subtitle="The efforts you are carrying through, each with an outcome and an end."
        tabs={<SpineTabs label="Projects" value={tab} onChange={setTab} tabs={[
          { id: "active", label: "Active", count: count("active") },
          { id: "paused", label: "Paused", count: count("paused") },
          { id: "done", label: "Done", count: count("done") },
          { id: "all", label: "All", count: projects.length },
        ]} />} />
      <SideSpine storageKey="prevail.projects.spine" title="Projects" label="projects" testId="tracked-projects-list"
        actions={<button onClick={() => { setAdding(true); setPicked(false); }} title="New project" aria-label="New project" data-testid="project-new" className={iconBtn}><Plus className="h-4 w-4" /></button>}
        phone={phone} phoneDetail={phone && picked && !!cur} onBack={() => setPicked(false)} backLabel="All projects"
        detail={detail}>
        {list}
      </SideSpine>
    </div>
  );
}
