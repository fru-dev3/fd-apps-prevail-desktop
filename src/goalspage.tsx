// Domain goals, the Goals view of the Compass page: a column (Overview, then
// every domain's goals, filtered All / Active / Done) and the picked one in
// the detail pane. Goals live in each domain's source/goals.md (goalsmodel.ts
// has the format). Everything edits in place. The mission moved to the
// Compass itself; the constitution is under the Ideals view.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Check, Circle, CircleCheck, LayoutList, Plus, Target } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { isUserDomain } from "./helpers";
import { SideSpine, SpineTabs } from "./sidespine";
import { useIsPhone } from "./useisphone";
import { BODY, DETAIL_TITLE, META, SECTION_TITLE } from "./typescale";
import {
  goalsOf, newGoalId, parseGoals, removeGoal, serializeGoals, upsertGoal,
  type Goal, type GoalsDoc,
} from "./goalsmodel";
import type { BoardTask } from "./types";
import { openTrackedProject, slugOf, useTrackedProjects } from "./trackedprojects";

type Tab = "all" | "active" | "done";
type Sel = "overview" | `goal:${string}`;
const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent";
const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-[15px] text-text-primary focus:border-accent-border focus:outline-none";
const DAY = 86_400_000;

export function DomainGoals({ vaultPath }: { vaultPath: string }) {
  const phone = useIsPhone();
  const [docs, setDocs] = useState<Record<string, GoalsDoc>>({});
  const [domains, setDomains] = useState<string[]>(["general"]);
  const [tab, setTab] = useState<Tab>("active");
  const [sel, setSel] = useState<Sel>("overview");
  const [picked, setPicked] = useState(false);
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [projects, setProjects] = useState<{ slug: string; title: string; domain: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const tracked = useTrackedProjects(vaultPath).projects;

  const load = useCallback(async () => {
    const files = await invoke<{ domain: string; body: string }[]>("goals_files_read", { vault: vaultPath }).catch(() => []);
    const next: Record<string, GoalsDoc> = {};
    for (const f of Array.isArray(files) ? files : []) next[f.domain] = parseGoals(f.domain, f.body ?? "");
    setDocs(next);
  }, [vaultPath]);
  useEffect(() => {
    void load();
    invoke<{ name: string }[]>("scan_vault", { path: vaultPath })
      .then((ds) => setDomains(["general", ...(Array.isArray(ds) ? ds.map((d) => d.name).filter((n) => isUserDomain(n) && n !== "general") : [])]))
      .catch(() => {});
    invoke<BoardTask[]>("tasks_read_all", { vault: vaultPath, limit: 500 }).then((t) => setTasks(Array.isArray(t) ? t : [])).catch(() => {});
    invoke<{ projects?: { slug: string; title: string; domain: string }[] }>("projects_index", { vault: vaultPath })
      .then((r) => setProjects(Array.isArray(r?.projects) ? r!.projects! : [])).catch(() => {});
  }, [vaultPath, load]);

  const all = useMemo(() => Object.values(docs).flatMap(goalsOf), [docs]);
  const live = all.filter((g) => g.status !== "archived");
  const shown = live.filter((g) => tab === "all" || (tab === "done" ? g.status === "done" : g.status === "active"));
  const choose = (s: Sel) => { setSel(s); setPicked(true); };

  // Write one goal back to its domain's file (moving it when the domain changed).
  const save = async (g: Goal, fromDomain?: string) => {
    setErr(null);
    try {
      const writes: Record<string, GoalsDoc> = {};
      if (fromDomain && fromDomain !== g.domain) writes[fromDomain] = removeGoal(docs[fromDomain] ?? parseGoals(fromDomain, ""), g.id);
      writes[g.domain] = upsertGoal(docs[g.domain] ?? parseGoals(g.domain, ""), g);
      for (const [d, doc] of Object.entries(writes)) {
        await invoke("goals_file_write", { vault: vaultPath, domain: d, body: serializeGoals(doc) });
      }
      setDocs((cur) => ({ ...cur, ...writes }));
    } catch (e) { setErr(`Could not save: ${String(e)}`); }
  };
  const addGoal = async () => {
    const g: Goal = { id: newGoalId(), domain: "general", title: "New goal", status: "active", due: null, progress: null, why: "" };
    await save(g);
    if (tab === "done") setTab("active");
    choose(`goal:${g.id}`);
  };

  const soon = live.filter((g) => g.status === "active" && g.due && Date.parse(g.due) - Date.now() < 30 * DAY)
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
  const current = sel.startsWith("goal:") ? all.find((g) => g.id === sel.slice(5)) ?? null : null;

  const rowCls = (on: boolean) => `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`;
  const isOn = (s: Sel) => sel === s && (!phone || picked);
  const fixedRow = (s: Sel, label: string, Icon: typeof Target, sub?: string) => (
    <button key={s} data-testid={`goal-row-${s}`} aria-current={isOn(s) ? "true" : undefined} onClick={() => choose(s)} className={rowCls(isOn(s))}>
      <Icon className={`h-4 w-4 shrink-0 ${isOn(s) ? "text-accent" : "text-text-muted"}`} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[14px] ${isOn(s) ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{label}</span>
        {sub && <span className="block truncate text-[12px] text-text-muted">{sub}</span>}
      </span>
    </button>
  );
  const list = (
    <nav className="space-y-0.5 p-2" aria-label="Goals">
      {fixedRow("overview", "Overview", LayoutList)}
      <div className="px-2.5 pb-1 pt-3 text-[13px] font-semibold text-text-secondary">Goals</div>
      {shown.length === 0 && <p className="px-2.5 py-1 text-[13px] text-text-muted">{tab === "done" ? "Nothing done yet." : "No goals yet."}</p>}
      {shown.map((g) => {
        const s: Sel = `goal:${g.id}`;
        return (
          <button key={g.id} data-testid="goal-row" aria-current={isOn(s) ? "true" : undefined} onClick={() => choose(s)} className={rowCls(isOn(s))}>
            {g.status === "done" ? <CircleCheck className="h-4 w-4 shrink-0 text-ok" /> : <Circle className="h-4 w-4 shrink-0 text-text-muted" />}
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[14px] ${isOn(s) ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{g.title}</span>
              <span className="block truncate text-[12px] text-text-muted">{titleCase(g.domain)}{g.due ? ` · ${g.due}` : ""}</span>
            </span>
            {g.progress !== null && g.status !== "done" && <span className="shrink-0 text-[12px] tabular-nums text-accent">{g.progress}%</span>}
          </button>
        );
      })}
    </nav>
  );

  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
  const goalDetail = (g: Goal) => {
    const w = words(g.title);
    const linkedTasks = tasks.filter((t) => !t.trashed && t.domain.toLowerCase() === g.domain.toLowerCase() && [...words(t.text)].some((x) => w.has(x))).slice(0, 8);
    const linkedProjects = projects.filter((p) => p.domain?.toLowerCase() === g.domain.toLowerCase()).slice(0, 6);
    const set = (patch: Partial<Goal>) => void save({ ...g, ...patch }, patch.domain ? g.domain : undefined);
    return (
      <section data-testid="goal-detail" key={g.id}>
        <div className="flex items-start gap-3">
          <input aria-label="Goal title" defaultValue={g.title} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== g.title) set({ title: e.target.value }); }}
            className={`${DETAIL_TITLE} min-w-0 flex-1 rounded-md bg-transparent px-1 -mx-1 focus:bg-background focus:outline focus:outline-1 focus:outline-accent-border`} />
          <button onClick={() => set({ status: g.status === "done" ? "active" : "done", progress: g.status === "done" ? g.progress : 100 })}
            title={g.status === "done" ? "Mark active" : "Mark done"} aria-label={g.status === "done" ? "Mark active" : "Mark done"} className={iconBtn}>
            {g.status === "done" ? <Circle className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          </button>
          <button onClick={() => { set({ status: "archived" }); setSel("overview"); }} title="Archive" aria-label="Archive goal" className={`${iconBtn} hover:text-warn`}>
            <Archive className="h-4 w-4" />
          </button>
        </div>
        <p className={`${META} mt-1`}>{titleCase(g.domain)} · source/goals.md</p>
        <div className="mt-5 grid max-w-3xl gap-4">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-text-secondary">Why it matters</span>
            <textarea aria-label="Why it matters" defaultValue={g.why} rows={3} onBlur={(e) => { if (e.target.value !== g.why) set({ why: e.target.value }); }} className={inputCls} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-text-secondary">Target date</span>
              <input type="date" aria-label="Target date" value={g.due ?? ""} onChange={(e) => set({ due: e.target.value || null })} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-text-secondary">Domain</span>
              <select aria-label="Domain" value={g.domain} onChange={(e) => set({ domain: e.target.value })} className={inputCls}>
                {[...new Set([...domains, g.domain])].map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-text-secondary">Status</span>
              <select aria-label="Status" value={g.status} onChange={(e) => set({ status: e.target.value as Goal["status"] })} className={inputCls}>
                <option value="active">Active</option><option value="done">Done</option><option value="archived">Archived</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-text-secondary">Project</span>
              <select aria-label="Project" data-testid="goal-project" value={g.project ?? ""} onChange={(e) => set({ project: e.target.value || null })} className={inputCls}>
                <option value="">None</option>
                {g.project && !tracked.some((p) => slugOf(p.id) === g.project) && <option value={g.project}>{g.project}</option>}
                {tracked.map((p) => <option key={p.id} value={slugOf(p.id)}>{p.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-text-secondary">Progress {g.progress ?? 0}%</span>
              <input type="range" min={0} max={100} step={5} aria-label="Progress" value={g.progress ?? 0} onChange={(e) => set({ progress: Number(e.target.value) })} className="w-full accent-[var(--color-accent)]" />
            </label>
          </div>
        </div>
        {g.project && (
          <button onClick={() => openTrackedProject(g.project!)} data-testid="goal-project-open" className={`${BODY} mt-4 text-left text-accent hover:underline`}>
            Open {tracked.find((p) => slugOf(p.id) === g.project)?.name ?? g.project}
          </button>
        )}
        <h3 className={`${SECTION_TITLE} mt-8 mb-2`}>From your prompts</h3>
        {linkedProjects.length ? (
          <ul className="space-y-1">{linkedProjects.map((p) => (
            <li key={p.slug}><button onClick={() => { try { localStorage.setItem("prevail.intent.project", p.slug); localStorage.setItem("prevail.mirror.view", "projects"); } catch { /* storage off */ } window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "projects" })); }}
              className={`${BODY} text-left text-text-primary hover:text-accent`}>{p.title}</button></li>
          ))}</ul>
        ) : <p className={`${BODY} text-text-muted`}>No projects in {titleCase(g.domain)} yet.</p>}
        <h3 className={`${SECTION_TITLE} mt-6 mb-2`}>Tasks</h3>
        {linkedTasks.length ? (
          <ul className="space-y-1">{linkedTasks.map((t) => (
            <li key={`${t.domain}:${t.id}`}><button onClick={() => { try { if (t.id) localStorage.setItem("prevail.board.openTask", t.id); } catch { /* storage off */ } window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: "task-list" })); }}
              className={`${BODY} text-left text-text-primary hover:text-accent ${t.status === "done" ? "line-through text-text-muted" : ""}`}>{t.text}</button></li>
          ))}</ul>
        ) : <p className={`${BODY} text-text-muted`}>No tasks mention it yet.</p>}
      </section>
    );
  };

  const overview = (
    <section data-testid="goal-detail-overview">
      <h2 className={DETAIL_TITLE}>Overview</h2>
      <p className={`${BODY} mt-2 text-text-secondary`}>
        {live.filter((g) => g.status === "active").length} active, {live.filter((g) => g.status === "done").length} done, across {new Set(live.map((g) => g.domain)).size || 0} domains.
      </p>
      <h3 className={`${SECTION_TITLE} mt-6 mb-2`}>Due soon</h3>
      {soon.length ? (
        <ul className="space-y-1">{soon.map((g) => (
          <li key={g.id}><button onClick={() => choose(`goal:${g.id}`)} className={`${BODY} text-left text-text-primary hover:text-accent`}>{g.title}<span className={`${META} ml-2`}>{g.due}</span></button></li>
        ))}</ul>
      ) : <p className={`${BODY} text-text-muted`}>Nothing due in the next 30 days.</p>}
    </section>
  );

  const statusTabs = (
    <SpineTabs label="Goals" value={tab} onChange={setTab} tabs={[
      { id: "all", label: "All", count: live.length },
      { id: "active", label: "Active", count: live.filter((g) => g.status === "active").length },
      { id: "done", label: "Done", count: live.filter((g) => g.status === "done").length },
    ]} />
  );
  return (
    <SideSpine storageKey="prevail.goals.spine" title="Domain goals" label="goals" testId="goals-list" toolbar={statusTabs}
      actions={<button onClick={() => void addGoal()} title="New goal" aria-label="New goal" data-testid="goal-new" className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"><Plus className="h-4 w-4" /></button>}
      phone={phone} phoneDetail={phone && picked} onBack={() => setPicked(false)} backLabel="All goals"
      detail={
        <div data-testid="goals-page" className={phone ? "px-4 py-4" : "w-full px-8 py-6"}>
          {err && <p className="mb-3 text-[13px] text-err">{err}</p>}
          {sel === "overview" && overview}
          {current && goalDetail(current)}
        </div>
      }>
      {list}
    </SideSpine>
  );
}
