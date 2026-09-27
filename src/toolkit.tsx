// Toolkit: Skills, Tools and Frameworks on one page, laid out like Models. The
// page header comes first; below it the canonical SideSpine lists three
// collapsible groups (Skills by domain, Tools, Frameworks and Lenses) and the
// detail pane shows the picked item with its actions. Everything the three old
// pages did is here: view, reveal, use in chat, archive and upload a skill (plus
// turning it on or off), jump to where a tool is governed, and pick the
// framework and lens that shape answers.
import { useCallback, useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Archive, ArrowUpRight, Blocks, Brain, ChevronRight, Code, Folder, GitBranch, Globe, MessageSquarePlus, MousePointer, Plug, Plus, RefreshCw, Repeat, Search, Upload, Wrench, X, type LucideIcon } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { isUserDomain } from "./helpers";
import { useFrameworkLens } from "./hooks";
import { FRAMEWORKS, LENSES } from "./constants";
import { Markdown } from "./Markdown";
import { SettingsHeader } from "./sectionutil";
import { SideSpine } from "./sidespine";
import { Toggle } from "./ui";
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
function IconAction({ icon: Icon, label, onClick, tone }: { icon: LucideIcon; label: string; onClick: () => void; tone?: "warn" }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className={`${iconBtn} ${tone === "warn" ? "hover:text-warn" : ""}`}>
      <Icon className="h-4 w-4" />
    </button>
  );
}

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
  const [skills, setSkills] = useState<SkillEntry[] | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [focus] = useState<Group | null>(readFocus);
  const [closed, setClosed] = useState<Set<Group>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("prevail.toolkit.closed") || "[]") as Group[]); } catch { return new Set(); }
  });
  const [pick, setPick] = useState<Pick | null>(null);
  const [picked, setPicked] = useState(false);

  const rescan = useCallback(() => {
    invoke<SkillEntry[]>("scan_skills", { vault: vaultPath })
      .then((s) => setSkills(Array.isArray(s) ? s : []))
      .catch(() => setSkills([]));
  }, [vaultPath]);
  useEffect(() => { rescan(); }, [rescan]);
  // Usage per skill from the vault ledger: uses, last used, dormant or never.
  const [usage, setUsage] = useState<Map<string, UsageRow>>(new Map());
  const loadUsage = useCallback(() => {
    invoke<{ rows?: UsageRow[] }>("engine_skills_report")
      .then((rep) => {
        const m = new Map<string, UsageRow>();
        for (const r of rep?.rows ?? []) m.set(`${r.domain.toLowerCase()}/${r.id.toLowerCase()}`, r);
        setUsage(m);
      })
      .catch(() => setUsage(new Map()));
  }, []);
  useEffect(() => { loadUsage(); }, [vaultPath, loadUsage]);
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
    if (focus) setClosed((c) => { const n = new Set(c); n.delete(focus); return n; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills]);
  // A deep link while the page is already open.
  useEffect(() => {
    const onFocus = (e: Event) => {
      const g = (e as CustomEvent<string>).detail as Group;
      try { localStorage.removeItem(TOOLKIT_FOCUS_KEY); } catch { /* storage off */ }
      setClosed((c) => { const n = new Set(c); n.delete(g); return n; });
      const first = firstOf(g);
      if (first) { setPick(first); setPicked(true); }
    };
    window.addEventListener("prevail:toolkit-focus", onFocus);
    return () => window.removeEventListener("prevail:toolkit-focus", onFocus);
  });

  const toggleGroup = (g: Group) => setClosed((c) => {
    const n = new Set(c);
    if (n.has(g)) n.delete(g); else n.add(g);
    try { localStorage.setItem("prevail.toolkit.closed", JSON.stringify([...n])); } catch { /* storage off */ }
    return n;
  });
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
  function runSkillInChat(s: SkillEntry) {
    lsSet("prevail.compose.pending", `Run the "${s.name}" skill.`);
    const dom = s.domain && s.domain.toLowerCase() !== "general" ? s.domain : "";
    window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: dom }));
    window.dispatchEvent(new CustomEvent("prevail:compose-seed"));
  }
  // Upload a SKILL.md: pick the file, choose a domain, install it.
  const [allDomains, setAllDomains] = useState<string[]>([]);
  useEffect(() => {
    invoke<{ name: string }[]>("scan_vault", { path: vaultPath })
      .then((ds) => setAllDomains(Array.isArray(ds) ? ds.map((d) => d.name.toLowerCase()).filter(isUserDomain) : []))
      .catch(() => setAllDomains([]));
  }, [vaultPath]);
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
    const open = !closed.has(g);
    return (
      <button onClick={() => toggleGroup(g)} aria-expanded={open} data-testid={`toolkit-group-${g}`}
        className="flex w-full items-baseline justify-between rounded-md px-2.5 pb-1 pt-2 transition-colors hover:bg-surface-warm">
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

  const list = (
    <div className="space-y-3 p-2">
      <div>
        {groupHead("skills", "Skills", `${skillsOn} of ${allSkills.length} on`, allSkills.length)}
        {!closed.has("skills") && (
          skills === null ? <p className="px-2.5 py-1 text-[13px] text-text-muted">Reading your skills.</p>
          : skillsByDomain.length === 0 ? <p className="px-2.5 py-1 text-[13px] text-text-muted">{query ? "No skills match." : "No skills yet."}</p>
          : skillsByDomain.map(([d, list]) => (
            <div key={d} className="mt-1">
              <div className="px-2.5 pb-0.5 pt-1.5 text-[13px] font-medium text-text-muted">{titleCase(d)}</div>
              {list.map((s) => {
                const on = s.enabled !== false;
                return (
                  <button key={s.path} data-testid={`toolkit-skill-${s.name}`} onClick={() => choose({ group: "skills", id: s.path })} className={rowCls(isPick("skills", s.path))}>
                    <span className={`min-w-0 flex-1 truncate text-sm ${on ? "text-text-primary" : "text-text-muted"}`}>{s.name}</span>
                    <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-text-muted" title={on ? "On" : "Off"}>{!on && "Off"}{dot(on)}</span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
      <div>
        {groupHead("tools", "Tools", `${toolsOn} of ${tools.length} on`, tools.length)}
        {!closed.has("tools") && shownTools.map((t) => (
          <button key={t.name} data-testid={`toolkit-tool-${t.name}`} onClick={() => choose({ group: "tools", id: t.name })} className={rowCls(isPick("tools", t.name))}>
            {(() => { const I = TOOL_ICON[t.name] ?? Wrench; return <I className={`h-4 w-4 shrink-0 ${isPick("tools", t.name) ? "text-accent" : "text-text-muted"}`} />; })()}
            <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{t.name}</span>
            <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-text-muted">{t.state !== "on" && TOOL_STATE_LABEL[t.state]}{dot(t.state !== "soon")}</span>
          </button>
        ))}
      </div>
      <div>
        {groupHead("frameworks", "Frameworks", `${fwOnCount} of ${fwItems.length} on`, fwItems.length)}
        {!closed.has("frameworks") && shownFw.map((f, i) => (
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
    setBody(null);
    if (!skill) return;
    let live = true;
    invoke<string>("read_skill", { path: skill.path })
      .then((b) => { if (live) setBody(b || ""); })
      .catch((e) => { if (live) setBody(`Could not read this skill: ${String(e)}`); });
    return () => { live = false; };
  }, [skill?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const head = (title: string, sub: string | null, actions?: React.ReactNode) => (
    <div className="mb-4 flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-[26px] font-semibold leading-tight tracking-tight text-text-primary break-words">{title}</h2>
        {sub && <p className="mt-1 text-[14px] text-text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
  const usageLine = (s: SkillEntry) => {
    const u = usageOf(s);
    if (!u) return null;
    if (u.verdict === "unused") return "Never used";
    const days = u.lastTs ? Math.max(0, Math.floor((Date.now() - u.lastTs) / 86_400_000)) : null;
    return `${u.uses} use${u.uses === 1 ? "" : "s"}${days === null ? "" : days === 0 ? ", last today" : `, last ${days}d ago`}${u.verdict === "dormant" ? ", dormant" : ""}`;
  };
  const toolDetail = (t: Tool) => (
    <div data-testid="toolkit-detail-tool">
      {head(t.name, t.state === "on" ? "Available" : titleCase(TOOL_STATE_LABEL[t.state]))}
      <p className="text-[15px] leading-relaxed text-text-primary">{t.desc}</p>
      <p className="mt-3 text-[14px] leading-relaxed text-text-secondary">{t.governance}</p>
      {t.manage && (
        <button onClick={() => goTo(t.manage!.section)} className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-text-secondary hover:border-accent-border hover:text-accent">
          {t.manage.label} <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      )}
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
        {head(titleCase(f.label.toLowerCase()), f.kind === "framework" ? "Framework: how the answer is shaped" : "Lens: the angle the answer comes from")}
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-text-primary">Use this {f.kind}</div>
            <div className="mt-0.5 text-xs text-text-secondary">One {f.kind} at a time shapes every answer. Turning this on replaces the current one.</div>
          </div>
          <Toggle on={on} onChange={set} label={`Use ${f.label} ${f.kind}`} />
        </div>
        <p className="text-[15px] text-text-primary">{f.blurb}</p>
        {f.instruction && <p className="mt-3 text-[14px] leading-relaxed text-text-secondary">{f.instruction}</p>}
      </div>
    );
  };
  const skillDetail = (s: SkillEntry) => {
    const on = s.enabled !== false;
    return (
      <div data-testid="toolkit-detail-skill">
        {head(s.name, [titleCase(s.domain || "general"), usageLine(s)].filter(Boolean).join(" · "), (<>
          <IconAction icon={MessageSquarePlus} label="Use in a chat" onClick={() => runSkillInChat(s)} />
          <IconAction icon={Folder} label="Reveal in Finder" onClick={() => { void invoke("open_in_finder", { path: s.path }).catch(() => {}); }} />
          <IconAction icon={Archive} label="Archive this skill" tone="warn" onClick={() => void archiveSkill(s)} />
        </>))}
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-text-primary">{on ? "On" : "Off"}</div>
            <div className="mt-0.5 text-xs text-text-secondary">An off skill stays on disk but is left out of /skills and auto-attach.</div>
          </div>
          <Toggle on={on} onChange={(v) => void setSkillEnabled(s, v)} label={`${on ? "Turn off" : "Turn on"} ${s.name}`} />
        </div>
        {body === null ? <p className="text-[14px] text-text-muted">Reading the skill.</p>
          : <div data-testid="toolkit-skill-body" className="prose-sm max-w-3xl text-sm leading-relaxed text-text-primary"><Markdown source={body} /></div>}
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
