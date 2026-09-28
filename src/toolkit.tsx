// Toolkit: Skills, Tools and Frameworks on one page, laid out like Models. The
// page header comes first; below it the canonical SideSpine lists three
// collapsible groups (Skills by source, Tools, Frameworks and Lenses), all
// collapsed until opened, and the detail pane says what the picked item is
// (a type badge, its name, where it comes from) above its actions. Everything the three old
// pages did is here: view, reveal, use in chat, archive and upload a skill (plus
// turning it on or off), jump to where a tool is governed, and pick the
// framework and lens that shape answers.
import { useEffect, useMemo, useState } from "react";
import { VIRTUAL_MIN, VirtualRows } from "./virtualrows";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Archive, ArrowUpRight, Blocks, Brain, Check, ChevronRight, Code, Folder, GitBranch, Globe, Layers, MessageCircle, MessageSquarePlus, MousePointer, Pencil, Plug, Plus, RefreshCw, Repeat, Search, Sparkles, Upload, Wrench, X, type LucideIcon } from "lucide-react";
import { invoke } from "./bridge";
import { hasInvoke, invokeCached, invokeKey, peekInvoke, setQueryData, useEngineQuery, useInvokeQuery, useInvokeState } from "./query";
import { titleCase } from "./format";
import { isUserDomain } from "./helpers";
import { useFrameworkLens } from "./hooks";
import { FRAMEWORKS, LENSES } from "./constants";
import { Markdown } from "./Markdown";
import { SettingsHeader } from "./sectionutil";
import { metaValue, parseSkillDoc } from "./skilldoc";
import { SideSpine, STICKY_GROUP_HEAD } from "./sidespine";
import { RowMenu, Toggle, type RowMenuItem } from "./ui";
import { DetailTitle, META } from "./typescale";
import { useIsPhone } from "./useisphone";
import { lsSet } from "./storage";
import { TOOLKIT_FOCUS_KEY } from "./navdefs";
import { TOOL_STATE_LABEL, goTo, useToolList, type Tool } from "./toolspanel";
import type { SkillEntry } from "./types";

type Group = "skills" | "tools" | "frameworks";
type Pick = { group: "skills"; id: string } | { group: "tools"; id: string } | { group: "frameworks"; id: string };
type UsageRow = { domain: string; id: string; uses: number; lastTs: number | null; verdict: "active" | "dormant" | "unused" };
// Frameworks and lenses share one group; ids are prefixed so they never clash.
const fwId = (kind: "framework" | "lens", id: string) => `${kind}:${id}`;

// A real icon per tool, sized like the Models side rows.
const TOOL_ICON: Record<string, LucideIcon> = {
  Connectors: Plug, Browser: Globe, Memory: Brain, Loops: Repeat, "Web search": Search,
  "Computer use": MousePointer, "Code execution": Code, Delegation: GitBranch,
};
const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent";
// A labeled primary action in a detail header ("Chat with it", "Edit").
function ActionButton({ icon: Icon, label, onClick, primary, tone, testId }: { icon: LucideIcon; label: string; onClick: () => void; primary?: boolean; tone?: "warn"; testId?: string }) {
  const cls = primary
    ? "bg-accent text-background hover:bg-accent-hover"
    : `border border-border bg-surface text-text-secondary ${tone === "warn" ? "hover:border-warn hover:text-warn" : "hover:border-accent-border hover:text-accent"}`;
  return (
    <button data-testid={testId} onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${cls}`}>
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}
// A skill directory name as people read it: "foo-review" is "Foo Review".
const displayName = (name: string) => titleCase(name);
const sameName = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");

function IconAction({ icon: Icon, label, onClick, tone }: { icon: LucideIcon; label: string; onClick: () => void; tone?: "warn" }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className={`${iconBtn} ${tone === "warn" ? "hover:text-warn" : ""}`}>
      <Icon className="h-4 w-4" />
    </button>
  );
}

const OPEN_KEY = "prevail.toolkit.open";

function readFocus(): Group | null {
  try {
    const v = localStorage.getItem(TOOLKIT_FOCUS_KEY);
    localStorage.removeItem(TOOLKIT_FOCUS_KEY);
    return v === "skills" || v === "tools" || v === "frameworks" ? v : null;
  } catch { return null; }
}

export function ToolkitSection({ vaultPath }: { vaultPath: string }) {
  const phone = useIsPhone();
  const tools = useToolList();
  const fw = useFrameworkLens();
  // Through the shared cache: a revisit paints the last list at once and
  // refreshes behind it; in-place edits write through.
  const skillsQ = useInvokeState<SkillEntry[]>("scan_skills", { vault: vaultPath });
  const skills: SkillEntry[] | null = Array.isArray(skillsQ.data) ? skillsQ.data : skillsQ.loading && !skillsQ.error ? null : [];
  const setSkills = skillsQ.set;
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [focus] = useState<Group | null>(readFocus);
  // Which of the three groups are open. All start collapsed; the user's
  // choice is remembered after that.
  const [opened, setOpened] = useState<Set<Group>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || "[]") as Group[]); } catch { return new Set(); }
  });
  // Skill sources (an app or a domain) opened in the column, collapsed by default.
  const [openSrc, setOpenSrc] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState<Pick | null>(null);
  const [picked, setPicked] = useState(false);

  const rescan = () => { void skillsQ.refresh(); };
  // Usage per skill from the vault ledger: uses, last used, dormant or never.
  const usageQ = useEngineQuery(`engine_skills_report:${vaultPath}`, () => invoke<{ rows?: UsageRow[] }>("engine_skills_report"));
  const usage = useMemo(() => {
    const m = new Map<string, UsageRow>();
    if (usageQ.error && !usageQ.fetching) return m;
    for (const r of usageQ.data?.rows ?? []) m.set(`${r.domain.toLowerCase()}/${r.id.toLowerCase()}`, r);
    return m;
  }, [usageQ.data, usageQ.error, usageQ.fetching]);
  const loadUsage = () => { void usageQ.refresh(); };
  const usageOf = (s: SkillEntry) => usage.get(`${s.domain.toLowerCase()}/${s.name.toLowerCase()}`);

  const query = q.trim().toLowerCase();
  const hit = (...parts: Array<string | null | undefined>) => !query || parts.some((p) => (p ?? "").toLowerCase().includes(query));
  const skillsByDomain = useMemo(() => {
    const m = new Map<string, SkillEntry[]>();
    for (const s of skills ?? []) {
      if (!hit(s.name, s.domain, s.description)) continue;
      const d = s.domain.toLowerCase() || "general";
      m.set(d, [...(m.get(d) ?? []), s]);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills, query]);
  const shownTools = tools.filter((t) => hit(t.name, t.desc, t.governance));
  const fwItems = useMemo(() => [
    ...FRAMEWORKS.filter((f) => f.id !== "none").map((f) => ({ id: fwId("framework", f.id), kind: "framework" as const, raw: f.id, label: f.label, blurb: f.blurb, instruction: f.instruction })),
    ...LENSES.filter((l) => l.id !== "none").map((l) => ({ id: fwId("lens", l.id), kind: "lens" as const, raw: l.id, label: l.label, blurb: l.blurb, instruction: l.instruction })),
  ], []);
  const shownFw = fwItems.filter((f) => hit(f.label, f.blurb));
  const fwOn = (f: (typeof fwItems)[number]) => (f.kind === "framework" ? fw.framework : fw.lens) === f.raw;

  // Where the page opens: an old deep link's group and its first item, else
  // the first skill, tool or framework there is.
  const firstOf = (g: Group): Pick | null => {
    if (g === "skills") { const s = skillsByDomain[0]?.[1][0]; return s ? { group: "skills", id: s.path } : null; }
    if (g === "tools") return shownTools[0] ? { group: "tools", id: shownTools[0].name } : null;
    return shownFw[0] ? { group: "frameworks", id: shownFw[0].id } : null;
  };
  useEffect(() => {
    if (pick || skills === null) return;
    const start = focus ? firstOf(focus) : (firstOf("skills") ?? firstOf("tools"));
    if (start) setPick(start);
    if (focus) setOpened((c) => new Set(c).add(focus));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills]);
  // A deep link while the page is already open.
  useEffect(() => {
    const onFocus = (e: Event) => {
      const g = (e as CustomEvent<string>).detail as Group;
      try { localStorage.removeItem(TOOLKIT_FOCUS_KEY); } catch { /* storage off */ }
      setOpened((c) => new Set(c).add(g));
      const first = firstOf(g);
      if (first) { setPick(first); setPicked(true); }
    };
    window.addEventListener("prevail:toolkit-focus", onFocus);
    return () => window.removeEventListener("prevail:toolkit-focus", onFocus);
  });

  const toggleGroup = (g: Group) => setOpened((c) => {
    const n = new Set(c);
    if (n.has(g)) n.delete(g); else n.add(g);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...n])); } catch { /* storage off */ }
    return n;
  });
  const toggleSrc = (d: string) => setOpenSrc((c) => { const n = new Set(c); if (n.has(d)) n.delete(d); else n.add(d); return n; });
  // A search opens every group that has a match.
  const isOpen = (g: Group) => !!query || opened.has(g);
  const choose = (p: Pick) => { setPick(p); setPicked(true); };

  // Skill actions, as on the old Skills page.
  async function setSkillEnabled(s: SkillEntry, enabled: boolean) {
    setSkills((cur) => (cur ?? []).map((x) => (x.path === s.path ? { ...x, enabled } : x)));
    try {
      await invoke("skill_set_enabled", { vault: vaultPath, domain: s.domain, name: s.name, enabled });
      window.dispatchEvent(new Event("prevail:context-changed"));
    } catch (e) {
      setSkills((cur) => (cur ?? []).map((x) => (x.path === s.path ? { ...x, enabled: !enabled } : x)));
      setMsg(`Could not change ${s.name}: ${String(e).slice(0, 140)}`);
    }
  }
  async function archiveSkill(s: SkillEntry) {
    try {
      const r = await invoke<{ ok?: boolean; error?: string }>("engine_skill_archive", { domain: s.domain, skill: s.name, restore: null });
      if (r && r.ok === false) { setMsg(r.error ?? "archive failed"); return; }
      setSkills((cur) => (cur ?? []).filter((x) => x.path !== s.path));
      setPick(null);
      setMsg(`Archived ${s.name}. Restore any time: prevail skill-usage unarchive ${s.domain} ${s.name}`);
      loadUsage();
    } catch (e) { setMsg(`archive failed: ${String(e).slice(0, 140)}`); }
  }
  function runSkillInChat(s: SkillEntry, seed = `Run the "${s.name}" skill.`) {
    lsSet("prevail.compose.pending", seed);
    const dom = s.domain && s.domain.toLowerCase() !== "general" ? s.domain : "";
    window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: dom }));
    window.dispatchEvent(new CustomEvent("prevail:compose-seed"));
  }
  // Upload a SKILL.md: pick the file, choose a domain, install it.
  const domainsQ = useInvokeQuery<{ name: string }[]>("scan_vault", { path: vaultPath });
  const allDomains = useMemo(() => (Array.isArray(domainsQ.data) ? domainsQ.data.map((d) => d.name.toLowerCase()).filter(isUserDomain) : []), [domainsQ.data]);
  const [upload, setUpload] = useState<{ name: string; body: string } | null>(null);
  const [uploadDomain, setUploadDomain] = useState("general");
  async function pickSkillFile() {
    setMsg(null);
    try {
      const f = await openDialog({ filters: [{ name: "Skill", extensions: ["md"] }], multiple: false });
      if (!f || typeof f !== "string") return;
      const body = await invoke<string>("read_text_file", { path: f });
      const parts = f.split("/");
      const file = parts.pop() ?? "";
      const parent = parts.pop() ?? "";
      const name = /^skill\.md$/i.test(file) ? parent : file.replace(/\.md$/i, "");
      setUpload({ name: name || "skill", body });
    } catch (e) { setMsg(`Could not read that file: ${e}`); }
  }
  async function installSkill() {
    if (!upload) return;
    try {
      await invoke("skill_create", { vault: vaultPath, domain: uploadDomain === "general" ? null : uploadDomain, name: upload.name, body: upload.body });
      setMsg(`Installed ${upload.name} into ${titleCase(uploadDomain)}.`);
      setUpload(null);
      rescan();
    } catch (e) { setMsg(`Install failed: ${e}`); }
  }

  // ── the column ───────────────────────────────────────────────────────────
  const allSkills = skills ?? [];
  const skillsOn = allSkills.filter((s) => s.enabled !== false).length;
  const toolsOn = tools.filter((t) => t.state !== "soon").length;
  const fwOnCount = fwItems.filter(fwOn).length;
  const groupHead = (g: Group, label: string, summary: string, count: number) => {
    const open = isOpen(g);
    return (
      <button onClick={() => toggleGroup(g)} aria-expanded={open} data-testid={`toolkit-group-${g}`} data-sticky-head
        className={`flex w-full items-baseline justify-between px-2.5 pb-1 pt-2 transition-colors hover:text-accent ${STICKY_GROUP_HEAD} ${phone ? "bg-background" : "spine-sticky-head"}`}>
        <span className="flex items-center gap-1.5 text-[15px] font-semibold text-text-primary">
          <ChevronRight className={`h-3.5 w-3.5 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2.5} />
          {label} <span className="text-[13px] font-normal text-text-muted">{count}</span>
        </span>
        <span className="text-[12px] text-text-muted">{summary}</span>
      </button>
    );
  };
  const rowCls = (on: boolean) => `flex w-full items-center gap-2.5 rounded-lg border-l-2 px-2.5 py-2 text-left transition-colors ${on ? "border-l-accent bg-accent-soft ring-1 ring-accent-border" : "border-l-transparent hover:bg-surface-warm"}`;
  const isPick = (g: Group, id: string) => pick?.group === g && pick.id === id && (!phone || picked);
  const dot = (on: boolean) => <span className={`h-2 w-2 shrink-0 rounded-full ${on ? "bg-ok" : "bg-text-muted/40"}`} />;

  const onDot = (s: SkillEntry) => {
    const on = s.enabled !== false;
    return <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-text-muted" title={on ? "On" : "Off"}>{!on && "Off"}{dot(on)}</span>;
  };
  const singleRow = (d: string, s: SkillEntry) => (
    <button key={d} data-testid={`toolkit-skill-${s.name}`} data-single="1" onClick={() => choose({ group: "skills", id: s.path })} className={`${rowCls(isPick("skills", s.path))} mt-0.5`}>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm ${s.enabled !== false ? "text-text-primary" : "text-text-muted"}`}>{displayName(s.name)}</span>
        <span className="block truncate text-[12px] text-text-muted">{d}</span>
      </span>
      {onDot(s)}
    </button>
  );
  const srcHead = (d: string, n: number, srcOpen: boolean) => (
    <button data-testid={`toolkit-src-${d}`} aria-expanded={srcOpen} onClick={() => toggleSrc(d)}
      className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-warm">
      <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${srcOpen ? "rotate-90" : ""}`} strokeWidth={2.5} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{titleCase(d)}</span>
      <span className="shrink-0 text-[12px] text-text-muted">{n}</span>
    </button>
  );
  const skillRow = (s: SkillEntry) => (
    <button key={s.path} data-testid={`toolkit-skill-${s.name}`} onClick={() => choose({ group: "skills", id: s.path })} className={rowCls(isPick("skills", s.path))}>
      <span className={`min-w-0 flex-1 truncate text-sm ${s.enabled !== false ? "text-text-primary" : "text-text-muted"}`}>{displayName(s.name)}</span>
      {onDot(s)}
    </button>
  );
  // The skill column as flat rows, for the windowed path.
  type SkillRow = { kind: "single"; d: string; s: SkillEntry } | { kind: "src"; d: string; n: number; open: boolean } | { kind: "skill"; s: SkillEntry };
  const skillRows: SkillRow[] = [];
  for (const [d, list] of skillsByDomain) {
    if (list.length === 1 && sameName(list[0].name, d)) { skillRows.push({ kind: "single", d, s: list[0] }); continue; }
    const srcOpen = !!query || openSrc.has(d);
    skillRows.push({ kind: "src", d, n: list.length, open: srcOpen });
    if (srcOpen) for (const sk of list) skillRows.push({ kind: "skill", s: sk });
  }

  const list = (
    <div className="space-y-3 p-2">
      <div>
        {groupHead("skills", "Skills", `${skillsOn} of ${allSkills.length} on`, allSkills.length)}
        {isOpen("skills") && (
          skills === null ? <p className="px-2.5 py-1 text-[13px] text-text-muted">Reading your skills.</p>
          : skillsByDomain.length === 0 ? <p className="px-2.5 py-1 text-[13px] text-text-muted">{query ? "No skills match." : "No skills yet."}</p>
          : skillRows.length > VIRTUAL_MIN
            // A large vault (a search opens every source): one windowed list of
            // source headers and skill rows, drawn the same way.
            ? <VirtualRows items={skillRows} estimate={37} getKey={(r) => (r.kind === "skill" ? r.s.path : `src:${r.d}`)}
                render={(r) => r.kind === "single" ? singleRow(r.d, r.s) : r.kind === "src" ? <div className="mt-0.5">{srcHead(r.d, r.n, r.open)}</div> : <div className="ml-4 border-l border-border-subtle pl-1.5">{skillRow(r.s)}</div>} />
            : skillsByDomain.map(([d, list]) => {
            // One skill named like its source: one row, the source as a subline.
            if (list.length === 1 && sameName(list[0].name, d)) return singleRow(d, list[0]);
            const srcOpen = !!query || openSrc.has(d);
            return (
              <div key={d} className="mt-0.5">
                {srcHead(d, list.length, srcOpen)}
                {srcOpen && (
                  <div className="ml-4 border-l border-border-subtle pl-1.5">
                    {list.map((s) => skillRow(s))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      <div>
        {groupHead("tools", "Tools", `${toolsOn} of ${tools.length} on`, tools.length)}
        {isOpen("tools") && shownTools.map((t) => (
          <button key={t.name} data-testid={`toolkit-tool-${t.name}`} onClick={() => choose({ group: "tools", id: t.name })} className={rowCls(isPick("tools", t.name))}>
            {(() => { const I = TOOL_ICON[t.name] ?? Wrench; return <I className={`h-4 w-4 shrink-0 ${isPick("tools", t.name) ? "text-accent" : "text-text-muted"}`} />; })()}
            <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{t.name}</span>
            <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-text-muted">{t.state !== "on" && TOOL_STATE_LABEL[t.state]}{dot(t.state !== "soon")}</span>
          </button>
        ))}
      </div>
      <div>
        {groupHead("frameworks", "Frameworks", `${fwOnCount} of ${fwItems.length} on`, fwItems.length)}
        {isOpen("frameworks") && shownFw.map((f, i) => (
          <div key={f.id}>
            {/* The group header already says Frameworks; only the lenses get
                their own line, and only when both kinds are listed. */}
            {f.kind === "lens" && i > 0 && shownFw[i - 1].kind === "framework" && (
              <div className="px-2.5 pb-0.5 pt-1.5 text-[13px] font-medium text-text-muted">Lenses</div>
            )}
            <button data-testid={`toolkit-fw-${f.id}`} onClick={() => choose({ group: "frameworks", id: f.id })} className={rowCls(isPick("frameworks", f.id))}>
              <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{titleCase(f.label.toLowerCase())}</span>
              {dot(fwOn(f))}
            </button>
          </div>
        ))}
      </div>
    </div>
  );

  // ── the detail ───────────────────────────────────────────────────────────
  const skill = pick?.group === "skills" ? allSkills.find((s) => s.path === pick.id) ?? null : null;
  const tool = pick?.group === "tools" ? tools.find((t) => t.name === pick.id) ?? null : null;
  const fwPick = pick?.group === "frameworks" ? fwItems.find((f) => f.id === pick.id) ?? null : null;
  const [body, setBody] = useState<string | null>(null);
  useEffect(() => {
    // A skill opened before paints its text at once while it re-reads.
    setBody(skill && hasInvoke("read_skill", { path: skill.path }) ? (peekInvoke<string>("read_skill", { path: skill.path }) || "") : null);
    if (!skill) return;
    let live = true;
    invokeCached<string>("read_skill", { path: skill.path }, { force: true })
      .then((b) => { if (live) setBody(b || ""); })
      .catch((e) => { if (live) setBody(`Could not read this skill: ${String(e)}`); });
    return () => { live = false; };
  }, [skill?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every detail opens the same way: what it is (a type badge), its name,
  // where it comes from, one line on what it does, then labeled actions.
  // One compact header row: a small type tile, the name over one meta line
  // ("Skill · From Career"), and the actions on the right; the rest of the
  // actions sit in a "..." menu.
  const head = (type: string, title: string, from: string | null, desc: string | null, actions?: React.ReactNode, menu?: RowMenuItem[]) => {
    const TypeIcon = type === "Skill" ? Sparkles : type === "Tool" ? Wrench : Layers;
    return (
      <div className="mb-5">
        <div className="flex flex-wrap items-center gap-3" data-testid="toolkit-header">
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-warm text-text-secondary"><TypeIcon className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <DetailTitle className="break-words">{title}</DetailTitle>
            <p className={META}><span data-testid="toolkit-type">{type}</span>{from && ` · ${from}`}</p>
          </div>
          {(actions || menu) && (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {actions}
              {menu && menu.length > 0 && <RowMenu label="More actions" items={menu} />}
            </div>
          )}
        </div>
        {desc && <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-text-primary">{desc}</p>}
      </div>
    );
  };
  const usageLine = (s: SkillEntry) => {
    const u = usageOf(s);
    if (!u) return null;
    if (u.verdict === "unused") return "Never used";
    const days = u.lastTs ? Math.max(0, Math.floor((Date.now() - u.lastTs) / 86_400_000)) : null;
    return `${u.uses} use${u.uses === 1 ? "" : "s"}${days === null ? "" : days === 0 ? ", last today" : `, last ${days}d ago`}${u.verdict === "dormant" ? ", dormant" : ""}`;
  };
  const props = (rows: [string, string][]) => rows.length === 0 ? null : (
    <div className="mb-5">
      <h3 className="mb-2 text-[19px] font-semibold text-text-primary">Details</h3>
      <dl data-testid="toolkit-details" className="divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-4 px-4 py-2">
            <dt className="w-28 shrink-0 text-[13px] text-text-muted">{titleCase(k)}</dt>
            <dd className="min-w-0 flex-1 break-words text-[13px] text-text-primary">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
  const onOffCard = (title: string, sub: string, toggle: React.ReactNode) => (
    <div className="mb-5 flex items-center gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-text-primary">{title}</div>
        <div className="mt-0.5 text-xs text-text-secondary">{sub}</div>
      </div>
      {toggle}
    </div>
  );
  const toolDetail = (t: Tool) => (
    <div data-testid="toolkit-detail-tool">
      {head("Tool", t.name, `Built in, ${t.state === "on" ? "available" : TOOL_STATE_LABEL[t.state].toLowerCase()}`, t.desc,
        t.manage ? <ActionButton icon={ArrowUpRight} label={t.manage.label} primary onClick={() => goTo(t.manage!.section)} /> : undefined)}
      {props([["Governed by", t.governance], ["State", titleCase(TOOL_STATE_LABEL[t.state])]])}
    </div>
  );
  const fwDetail = (f: (typeof fwItems)[number]) => {
    const on = fwOn(f);
    const set = (v: boolean) => {
      const next = v ? f.raw : "none";
      if (f.kind === "framework") fw.setFramework(next); else fw.setLens(next);
    };
    return (
      <div data-testid="toolkit-detail-fw">
        {head("Framework", titleCase(f.label.toLowerCase()), f.kind === "framework" ? "Built in framework: how the answer is shaped" : "Built in lens: the angle the answer comes from", f.blurb)}
        {onOffCard(`Use this ${f.kind}`, `One ${f.kind} at a time shapes every answer. Turning this on replaces the current one.`,
          <Toggle on={on} onChange={set} label={`Use ${f.label} ${f.kind}`} />)}
        {f.instruction && props([["Instruction", f.instruction]])}
      </div>
    );
  };
  // Edit a SKILL.md in place; save writes the file back.
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => { setDraft(null); }, [skill?.path]);
  async function saveSkill(s: SkillEntry) {
    if (draft === null) return;
    try {
      await invoke("write_text_file", { path: `${s.path}/SKILL.md`, contents: draft });
      setBody(draft);
      setQueryData(invokeKey("read_skill", { path: s.path }), draft);
      setDraft(null);
      setMsg(`Saved ${displayName(s.name)}.`);
      rescan();
    } catch (e) { setMsg(`Could not save: ${String(e).slice(0, 140)}`); }
  }
  const skillDetail = (s: SkillEntry) => {
    const on = s.enabled !== false;
    const doc = parseSkillDoc(body ?? "");
    const desc = metaValue(doc, "description") ?? s.description;
    const fmName = metaValue(doc, "name");
    // A leading "# Title" that repeats the name above is dropped.
    const h1 = doc.body.match(/^#\s+(.+)\n*/);
    if (h1 && (sameName(h1[1], s.name) || (fmName && sameName(h1[1], fmName)))) doc.body = doc.body.slice(h1[0].length);
    const rows = doc.meta.filter(([k]) => k.toLowerCase() !== "description");
    if (!rows.some(([k]) => k.toLowerCase() === "type")) rows.splice(fmName ? 1 : 0, 0, ["type", "Skill"]);
    const use = usageLine(s);
    if (use) rows.push(["usage", use]);
    const from = s.domain && s.domain.toLowerCase() !== "general" ? titleCase(s.domain) : "General";
    return (
      <div data-testid="toolkit-detail-skill">
        {head("Skill", displayName(fmName ?? s.name), `From ${from}`, desc, (<>
          <ActionButton testId="toolkit-chat-with" icon={MessageCircle} label="Chat with it" primary
            onClick={() => { window.dispatchEvent(new Event("prevail:new-chat")); runSkillInChat(s, `Using the "${s.name}" skill, `); }} />
          <ActionButton testId="toolkit-edit" icon={Pencil} label="Edit" onClick={() => setDraft(body ?? "")} />
        </>), [
          { icon: MessageSquarePlus, label: "Use in chat", onClick: () => runSkillInChat(s) },
          { icon: Folder, label: "Reveal in Finder", hint: s.path, onClick: () => { void invoke("open_in_finder", { path: s.path }).catch(() => {}); } },
          { kind: "separator" },
          { icon: Archive, label: "Archive", danger: true, onClick: () => void archiveSkill(s) },
        ])}
        {onOffCard(on ? "On" : "Off", "An off skill stays on disk but is left out of /skills and auto-attach.",
          <Toggle on={on} onChange={(v) => void setSkillEnabled(s, v)} label={`${on ? "Turn off" : "Turn on"} ${s.name}`} />)}
        {draft !== null ? (
          <div data-testid="toolkit-skill-editor" className="space-y-2">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="SKILL.md" spellCheck={false}
              className="min-h-[420px] w-full rounded-xl border border-border bg-background px-4 py-3 text-[13px] leading-relaxed text-text-primary focus:border-accent-border focus:outline-none" />
            <div className="flex items-center gap-2">
              <ActionButton testId="toolkit-save" icon={Check} label="Save" primary onClick={() => void saveSkill(s)} />
              <ActionButton icon={X} label="Cancel" onClick={() => setDraft(null)} />
            </div>
          </div>
        ) : body === null ? <p className="text-[14px] text-text-muted">Reading the skill.</p> : (<>
          {props(rows)}
          {doc.body && <div data-testid="toolkit-skill-body" className="prose-sm max-w-3xl text-sm leading-relaxed text-text-primary"><Markdown source={doc.body} /></div>}
        </>)}
      </div>
    );
  };

  const detail = (
    <div className={phone ? "px-4 py-4" : "w-full px-8 py-6"}>
      {upload && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-accent-border bg-accent-soft/30 px-3 py-2.5">
          <span className="text-sm text-text-primary">Install <span className="font-semibold">{upload.name}</span> into</span>
          <select value={uploadDomain} onChange={(e) => setUploadDomain(e.target.value)} aria-label="Install into"
            className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-accent-border focus:outline-none">
            <option value="general">General (vault root)</option>
            {allDomains.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
          </select>
          <button onClick={() => void installSkill()} className="rounded-md bg-accent px-3 py-1 text-sm font-semibold text-background hover:bg-accent-hover">Install</button>
          <IconAction icon={X} label="Cancel" onClick={() => setUpload(null)} />
        </div>
      )}
      {msg && <div className="mb-4 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[13px] text-text-secondary">{msg}</div>}
      {skill ? skillDetail(skill) : tool ? toolDetail(tool) : fwPick ? fwDetail(fwPick)
        : <p className="text-[14px] text-text-muted">Pick a skill, tool or framework.</p>}
    </div>
  );

  return (
    <>
      <SettingsHeader title="Toolkit" icon={Blocks} subtitle="Skills, tools and frameworks your models can use."
        right={
          <div className="flex items-center gap-1.5">
            <button onClick={() => void pickSkillFile()} title="Upload a skill from a SKILL.md file"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] font-medium text-text-secondary hover:border-accent-border hover:text-accent">
              <Upload className="h-4 w-4" /> Upload skill
            </button>
            <button onClick={() => goTo("mcp")} title="Add a capability by connecting an MCP server or an app"
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-background hover:bg-accent-hover">
              <Plus className="h-4 w-4" /> Add tool
            </button>
          </div>
        } />
      <SideSpine storageKey="prevail.toolkit.spine" title="Toolkit" label="toolkit" testId="toolkit-list"
        actions={<button onClick={() => { rescan(); loadUsage(); }} title="Re-scan skills" aria-label="Re-scan skills" className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"><RefreshCw className="h-4 w-4" /></button>}
        toolbar={
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the toolkit" aria-label="Search the toolkit"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none" />
          </div>
        }
        phone={phone} phoneDetail={phone && picked} onBack={() => setPicked(false)} backLabel="All of the toolkit"
        detail={detail}>
        {list}
      </SideSpine>
    </>
  );
}
