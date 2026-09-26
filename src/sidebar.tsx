// The app sidebar, extracted from App.tsx. Prop-driven (collapse state,
// domains, active selection, and a set of callbacks).
//
// Home mode (everything that is not the Editor) reads top to bottom:
//   profile header (switcher + settings button), search (opens the command
//   palette), Home / Inbox / the Home surfaces, WORK (board, projects, tasks,
//   goals), DOMAINS (Pinned / All / Archived).
// Editor mode keeps the same header and swaps the list for the configuration
// nav, with a way back to Home at the top.
import { Fragment, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";
import { Activity, Archive, ArrowLeft, ChevronRight, Folder, House, Inbox, Loader2, MoreVertical, PanelLeftClose, PanelLeftOpen, Pin, Plus, RotateCcw, Search, Settings as SettingsIcon, Sparkles, X } from "lucide-react";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { lsGet, lsSet } from "./storage";
import { SidebarGatewayLive, SidebarMcpLive } from "./panels";
import { ProfileSwitcher } from "./profileswitcher";
import { EDITOR_NAV, WORK_NAV } from "./navdefs";
import { domainIcon } from "./icons";
import { SidebarBackupActive, SidebarBenchmarkRuns, SidebarBenchScheduled, SidebarProcesses } from "./cards";
import { useProcesses } from "./processes";
import { BENCH_SCHED, useBenchBatches } from "./bench";
import { BACKUP_CFG } from "./backup";
import type { Domain, TabId } from "./types";

// Active row: a light accent tint, accent text, and a short accent bar on the
// left edge. Every selectable row in the sidebar uses it.
const ACTIVE_ROW = "bg-accent-soft font-semibold text-accent before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-accent";
const IDLE_ROW = "text-text-secondary hover:bg-surface-warm hover:text-text-primary";
const SECTION_LABEL = "text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted";
const cap99 = (n: number) => (n > 99 ? "99+" : String(n));

function CountPill({ n, active }: { n: number; active: boolean }) {
  if (n <= 0) return null;
  return (
    <span className={`ml-auto shrink-0 rounded-full px-1.5 text-[11px] font-semibold tabular-nums leading-[18px] ${active ? "bg-accent text-on-accent" : "bg-surface-warm text-text-muted"}`}>
      {cap99(n)}
    </span>
  );
}

// One nav row. Collapsed, it is an icon button with the label as its tooltip.
function NavRow({ icon: Icon, label, active, count = 0, collapsed, onClick, testId }: {
  icon: typeof House; label: string; active: boolean; count?: number; collapsed: boolean; onClick: () => void; testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? (count > 0 ? `${label} (${count})` : label) : undefined}
      aria-current={active ? "page" : undefined}
      data-testid={testId}
      className={`relative flex w-full items-center rounded-lg text-left text-[14px] transition-colors ${
        collapsed ? "h-10 justify-center" : "h-9 gap-3 px-3"
      } ${active ? ACTIVE_ROW : IDLE_ROW}`}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && <CountPill n={count} active={active} />}
      {collapsed && count > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" />}
    </button>
  );
}

function Divider() {
  return <div className="mx-3 my-2 h-px bg-border-subtle" />;
}

function SectionHeader({ label, count, open, onToggle, onAdd, addTitle, tour }: {
  label: string; count?: number; open: boolean; onToggle: () => void; onAdd?: () => void; addTitle?: string; tour?: string;
}) {
  return (
    <div data-tour={tour} className="group/h flex items-center gap-1 px-3 pb-1 pt-1">
      <button onClick={onToggle} aria-expanded={open} className={`flex flex-1 items-center gap-1.5 text-left transition-colors hover:text-text-secondary ${SECTION_LABEL}`}>
        <span>{label}</span>
        {typeof count === "number" && <span className="font-medium tabular-nums text-text-muted/70">{count}</span>}
        <ChevronRight className={`h-3 w-3 shrink-0 opacity-0 transition group-hover/h:opacity-100 ${open ? "rotate-90" : ""}`} strokeWidth={2.5} />
      </button>
      {onAdd && (
        <button
          onClick={onAdd}
          title={addTitle}
          aria-label={addTitle}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"
        >
          <Plus className="h-4 w-4" strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}

export function Sidebar({
  collapsed,
  setCollapsed,
  vaultPath,
  domains,
  vaultError,
  selectedDomain,
  setSelectedDomain,
  openInFinder,
  tab,
  setTab,
  onDomainCreated,
  runningDomains,
  finishedDomains,
  domainStats,
  railWidth,
  onOpenOnboarding,
  onDomainsChanged,
  inboxCount,
}: {
  collapsed: boolean;
  setCollapsed: (v: boolean | ((cur: boolean) => boolean)) => void;
  vaultPath: string;
  domains: Domain[];
  vaultError: string | null;
  selectedDomain: string | null;
  setSelectedDomain: (n: string) => void;
  openInFinder: (p: string | null) => void;
  tab: TabId;
  setTab: (t: TabId) => void;
  onDomainCreated: (d: Domain) => void;
  runningDomains: Set<string>;
  finishedDomains: Set<string>;
  domainStats: Record<string, number>;
  railWidth: number;
  onOpenOnboarding: () => void;
  onDomainsChanged: () => void;
  // Actions waiting on your approval (the board's "Needs you" view).
  inboxCount: number;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  // Pinned domains live in localStorage as a comma-separated slug list.
  const PIN_KEY = "prevail.desktop.pinnedDomains";
  const [pinned, setPinned] = useState<Set<string>>(() => {
    try {
      const raw = lsGet(PIN_KEY);
      return new Set(raw ? raw.split(",").filter(Boolean) : []);
    } catch { return new Set(); }
  });
  // Group collapse - Pinned vs All. Persisted so collapsing survives restarts.
  const [pinnedOpen, setPinnedOpen] = useState<boolean>(() => lsGet("prevail.sidebar.pinnedOpen") !== "0");
  // "All" starts collapsed so Domains opens one level deep (Pinned + the All
  // header with its count) rather than listing every domain.
  const [allOpen, setAllOpen] = useState<boolean>(() => lsGet("prevail.sidebar.allOpen") === "1");
  useEffect(() => { lsSet("prevail.sidebar.pinnedOpen", pinnedOpen ? "1" : "0"); }, [pinnedOpen]);
  useEffect(() => { lsSet("prevail.sidebar.allOpen", allOpen ? "1" : "0"); }, [allOpen]);
  const togglePin = (name: string) => {
    setPinned((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      lsSet(PIN_KEY, Array.from(next).join(","));
      return next;
    });
  };
  // Real domains only: internal / app-scope pseudo-domains ("_meta",
  // "_app-...") never show here. Pinned first.
  const sortedDomains = useMemo(() => {
    const filtered = domains.filter((d) => !d.name.startsWith("_"));
    return [...filtered.filter((d) => pinned.has(d.name)), ...filtered.filter((d) => !pinned.has(d.name))];
  }, [domains, pinned]);
  const pinnedCount = sortedDomains.filter((d) => pinned.has(d.name)).length;
  const [addError, setAddError] = useState<string | null>(null);

  async function createDomain() {
    setAddError(null);
    try {
      const d = await invoke<Domain>("create_domain", { vault: vaultPath, name: newName });
      onDomainCreated(d);
      setNewName("");
      setAdding(false);
    } catch (e) {
      setAddError(String(e));
    }
  }

  const [domainsOpen, setDomainsOpen] = useState<boolean>(() => lsGet("prevail.sidebar.domainsOpen") !== "0");
  useEffect(() => { lsSet("prevail.sidebar.domainsOpen", domainsOpen ? "1" : "0"); }, [domainsOpen]);
  const [workOpen, setWorkOpen] = useState<boolean>(() => lsGet("prevail.sidebar.workOpen") !== "0");
  useEffect(() => { lsSet("prevail.sidebar.workOpen", workOpen ? "1" : "0"); }, [workOpen]);

  // Which Editor / Work section is active, kept in sync with the events the
  // content panels listen to.
  const [editorActive, setEditorActive] = useState("general");
  // Editor nav groups fold away and the choice is remembered. A group holding
  // the active section always opens, so where you are stays visible.
  const NAV_GROUPS_LS = "prevail.editorNav.closed";
  const [closedNavGroups, setClosedNavGroups] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(NAV_GROUPS_LS) || "[]") as string[]); }
    catch { return new Set(); }
  });
  const toggleNavGroup = (heading: string) => setClosedNavGroups((prev) => {
    const next = new Set(prev);
    if (next.has(heading)) next.delete(heading); else next.add(heading);
    try { localStorage.setItem(NAV_GROUPS_LS, JSON.stringify([...next])); } catch { /* ignore */ }
    return next;
  });
  const [workActive, setWorkActive] = useState("tasks");
  useEffect(() => {
    const onEd = (e: Event) => { const d = (e as CustomEvent<string>).detail || "general"; setEditorActive(d.split(":")[0]); };
    const onWk = (e: Event) => { const d = (e as CustomEvent<string>).detail || "tasks"; setWorkActive(d); };
    window.addEventListener("prevail:settings-section", onEd as EventListener);
    // Deep links elsewhere in the app dispatch open-settings, which App routes
    // to the right mode; the highlight follows.
    const onOpen = (e: Event) => {
      const d = ((e as CustomEvent<string>).detail || "").split(":")[0];
      if (!d) return;
      if (d === "inbox" || WORK_NAV.some((g) => g.items.some((i) => i.id === d)) || d === "loopboard") setWorkActive(d === "loopboard" ? "automations" : d);
      else setEditorActive(d);
    };
    window.addEventListener("prevail:open-settings", onOpen as EventListener);
    window.addEventListener("prevail:work-section", onWk as EventListener);
    return () => {
      window.removeEventListener("prevail:settings-section", onEd as EventListener);
      window.removeEventListener("prevail:open-settings", onOpen as EventListener);
      window.removeEventListener("prevail:work-section", onWk as EventListener);
    };
  }, []);
  // App owns the mode switch + section jump; the sidebar reflects the choice
  // and announces it.
  const selectEditor = (id: string) => { setEditorActive(id); window.dispatchEvent(new CustomEvent("prevail:settings-section", { detail: id })); };
  const selectWork = (id: string) => { setWorkActive(id); window.dispatchEvent(new CustomEvent("prevail:work-section", { detail: id })); };
  const goHome = () => { setSelectedDomain(""); setTab("chat"); };
  const newTask = () => {
    try { localStorage.setItem("prevail.board.openAdd", "1"); } catch { /* storage off */ }
    selectWork("tasks");
    window.dispatchEvent(new Event("prevail:board-add"));
  };

  // Counts for the Work rows, read from the same sources their screens use:
  // open tasks across every domain, and the Projects index.
  const [openTasks, setOpenTasks] = useState(0);
  const [projectCount, setProjectCount] = useState(0);
  useEffect(() => {
    if (!vaultPath) return;
    let alive = true;
    const pull = () => {
      invoke<{ open?: number }>("work_count", { vault: vaultPath, today: new Date().toISOString().slice(0, 10), domain: null })
        .then((r) => { if (alive) setOpenTasks(r?.open ?? 0); }).catch(() => {});
      invoke<{ projects?: unknown[] } | null>("projects_index", { vault: vaultPath })
        .then((r) => { if (alive) setProjectCount(Array.isArray(r?.projects) ? r!.projects!.length : 0); }).catch(() => {});
    };
    pull();
    const id = window.setInterval(pull, 120000);
    window.addEventListener("prevail:tasks-changed", pull);
    return () => { alive = false; window.clearInterval(id); window.removeEventListener("prevail:tasks-changed", pull); };
  }, [vaultPath]);
  const workCounts: Record<string, number> = { "task-list": openTasks, projects: projectCount };

  // Archived domains - fetched from the engine, shown under Domains, each with
  // a Restore action.
  const [archived, setArchived] = useState<string[]>([]);
  const [archivedOpen, setArchivedOpen] = useState<boolean>(() => lsGet("prevail.sidebar.archivedOpen") === "1");
  useEffect(() => { lsSet("prevail.sidebar.archivedOpen", archivedOpen ? "1" : "0"); }, [archivedOpen]);
  const [restoring, setRestoring] = useState<string | null>(null);
  // Which domain's kebab menu is open (one at a time).
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest("[data-domain-menu]")) setMenuOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);
  const refreshArchived = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const list = await invoke<string[]>("engine_list_archived", { vault: vaultPath });
      // A null (older engine, empty JSON body) must not crash the shell.
      setArchived(Array.isArray(list) ? list : []);
    } catch {
      setArchived([]);
    }
  }, [vaultPath]);
  useEffect(() => { void refreshArchived(); }, [refreshArchived, domains.length]);

  async function restoreDomain(name: string) {
    setRestoring(name);
    try {
      await invoke("engine_vault_restore", { vault: vaultPath, domain: name });
      await refreshArchived();
      onDomainsChanged();
    } catch (e) {
      console.error("restore domain", e);
    } finally {
      setRestoring(null);
    }
  }

  // Archive a domain from its row. Nothing is deleted: it moves to Archived
  // and can be restored any time.
  async function archiveDomain(name: string) {
    try {
      const ok = await tauriConfirm(
        `Hide "${titleCase(name)}" from the active list? Nothing is deleted. Restore it any time from the Archived section.`,
        { title: "Archive domain", kind: "warning" },
      );
      if (!ok) return;
      await invoke("engine_vault_archive", { vault: vaultPath, domain: name });
      await refreshArchived();
      onDomainsChanged();
    } catch (e) {
      console.error("archive domain", e);
    }
  }

  // Manual drag of a domain row into the chat (WKWebView's HTML5 DnD does not
  // reliably fire dragstart). On mouseup after moving, the chat panel's global
  // attach hook takes the domain as context.
  const startDomainDrag = (e: ReactMouseEvent, name: string) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let pill: HTMLDivElement | null = null;
    const onMove = (ev: MouseEvent) => {
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
      if (!dragging) {
        dragging = true;
        pill = document.createElement("div");
        pill.textContent = titleCase(name);
        pill.style.cssText =
          "position:fixed;z-index:9999;pointer-events:none;padding:6px 10px;border-radius:9999px;" +
          "background:var(--color-accent);color:var(--color-on-accent,#fff);font-size:12px;font-weight:600;" +
          "box-shadow:0 6px 20px rgba(0,0,0,0.2);transform:translate(-50%,-50%);";
        document.body.appendChild(pill);
        document.body.style.userSelect = "none";
      }
      if (pill) { pill.style.left = ev.clientX + "px"; pill.style.top = ev.clientY + "px"; }
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      if (pill) { pill.remove(); pill = null; }
      if (!dragging) return; // a click: let onClick fire
      ev.preventDefault();
      ev.stopPropagation();
      const hook = (window as unknown as { __prevailAttach?: (n: string, mode?: "light" | "full" | "folder") => void }).__prevailAttach;
      if (hook) hook(name, ev.altKey ? "folder" : ev.shiftKey ? "full" : "light");
      else console.warn("[prevail/drag] no attach hook registered: drop fell outside chat panel");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const openDomainRow = (name: string) => { setSelectedDomain(name); if (tab === "work") setTab("chat"); };

  const editorMode = tab === "settings";
  const homeActive = !editorMode && tab !== "work" && !selectedDomain;

  const settingsButton = (
    <button
      onClick={() => (editorMode ? goHome() : setTab("settings"))}
      title={editorMode ? "Close settings" : "Settings"}
      aria-label={editorMode ? "Close settings" : "Settings"}
      aria-pressed={editorMode}
      data-tour="settings"
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
        editorMode ? "border-accent-border bg-accent-soft text-accent" : "border-border-subtle bg-surface text-text-secondary hover:border-accent-border hover:text-accent"
      }`}
    >
      {editorMode ? <X className="h-4 w-4" /> : <SettingsIcon className="h-4 w-4" />}
    </button>
  );

  const groupHeader = (label: string, open: boolean, onToggle: () => void, count: number, icon?: ReactNode) => (
    <li key={`${label}-header`}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex h-8 w-full items-center gap-2 rounded-lg px-3 text-left text-[13px] text-text-muted transition-colors hover:bg-surface-warm hover:text-text-secondary"
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2.2} />
        {icon}
        <span className="flex-1">{label}</span>
        <span className="tabular-nums text-[12px] text-text-muted/80">{count}</span>
      </button>
    </li>
  );

  const domainRow = (d: Domain) => {
    const active = d.name === selectedDomain && tab !== "work" && !editorMode;
    const Icon = domainIcon(d.name);
    const isPinned = pinned.has(d.name);
    const stat = domainStats[d.name] ?? 0;
    if (collapsed) {
      return (
        <li key={d.name}>
          <button
            onClick={() => openDomainRow(d.name)}
            title={titleCase(d.name)}
            className={`relative flex h-10 w-full items-center justify-center rounded-lg transition-colors ${active ? ACTIVE_ROW : IDLE_ROW}`}
          >
            {Icon ? <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} /> : (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-warm text-[11px] font-semibold text-text-secondary ring-1 ring-border">
                {titleCase(d.name).charAt(0)}
              </span>
            )}
          </button>
        </li>
      );
    }
    return (
      <li key={d.name} className="group relative flex items-center">
        <button
          onMouseDown={(e) => startDomainDrag(e, d.name)}
          onClick={() => openDomainRow(d.name)}
          title="Click to enter · drag to chat as context (plain: state · ⇧ full · ⌥ entire folder)"
          aria-current={active ? "page" : undefined}
          className={`relative flex h-9 min-w-0 flex-1 cursor-grab items-center gap-3 rounded-lg pl-8 pr-9 text-left text-[14px] transition-colors active:cursor-grabbing ${active ? ACTIVE_ROW : IDLE_ROW}`}
        >
          {Icon ? <Icon className="h-4 w-4 shrink-0" strokeWidth={1.9} /> : <span className="h-4 w-4 shrink-0 rounded-full bg-surface-warm ring-1 ring-border" />}
          <span className="min-w-0 flex-1 truncate">{titleCase(d.name)}</span>
          {runningDomains.has(d.name) ? (
            <span className="pulse-soft inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warn" title="A reply is streaming in this domain" />
          ) : finishedDomains.has(d.name) ? (
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-ok" title="Just finished: open to view" />
          ) : null}
          {stat > 0 && <span title={`${stat} imports`} className="shrink-0 text-[12px] tabular-nums text-text-muted group-hover:opacity-0">{cap99(stat)}</span>}
        </button>
        {/* Row actions behind one kebab: pin, open in Finder, archive. */}
        <div className="absolute right-1 shrink-0" data-domain-menu>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((cur) => (cur === d.name ? null : d.name)); }}
            className={`flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-accent ${
              menuOpen === d.name ? "opacity-100" : "opacity-0 focus:opacity-100 group-hover:opacity-100"
            }`}
            title="Domain actions"
            aria-label={`${titleCase(d.name)} actions`}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen === d.name && (
            <div className="absolute right-0 top-8 z-50 w-40 rounded-lg border border-border bg-surface p-1 shadow-xl">
              <button
                onClick={(e) => { e.stopPropagation(); togglePin(d.name); setMenuOpen(null); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-text-primary hover:bg-surface-warm"
              >
                <Pin className={`h-3.5 w-3.5 shrink-0 ${isPinned ? "fill-accent text-accent" : ""}`} /> {isPinned ? "Unpin" : "Pin to top"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); openInFinder(d.path); setMenuOpen(null); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-text-primary hover:bg-surface-warm"
              >
                <Folder className="h-3.5 w-3.5 shrink-0" /> Open in Finder
              </button>
              <div className="my-1 h-px bg-border-subtle" />
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpen(null); void archiveDomain(d.name); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-warn hover:bg-warn/10"
              >
                <Archive className="h-3.5 w-3.5 shrink-0" /> Archive
              </button>
            </div>
          )}
        </div>
      </li>
    );
  };

  const pinnedDomains = sortedDomains.filter((d) => pinned.has(d.name));
  const otherDomains = sortedDomains.filter((d) => !pinned.has(d.name));

  return (
    <aside
      data-testid="app-sidebar"
      className="flex shrink-0 flex-col border-r border-border-subtle bg-surface-strong"
      style={{ width: collapsed ? 64 : railWidth }}
    >
      <ProfileSwitcher collapsed={collapsed} trailing={settingsButton} />

      {/* Search opens the command palette (it searches every screen, action
          and domain). */}
      <div className={collapsed ? "px-2 pb-2" : "px-3 pb-2"}>
        <button
          onClick={() => window.dispatchEvent(new Event("prevail:open-palette"))}
          title="Search (⌘K)"
          aria-label="Search"
          className={`flex w-full items-center rounded-lg border border-border-subtle bg-background text-text-muted transition-colors hover:border-accent-border hover:text-text-secondary ${
            collapsed ? "h-10 justify-center" : "h-9 gap-2 px-3"
          }`}
        >
          <Search className="h-4 w-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left text-[14px]">Search</span>
              <kbd className="rounded-md border border-border-subtle bg-surface px-1.5 text-[11px] font-medium leading-[18px] text-text-muted">⌘K</kbd>
            </>
          )}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2">
        {editorMode ? (
          <div className={collapsed ? "px-2" : "px-3"}>
            <NavRow icon={ArrowLeft} label="Back to Home" active={false} collapsed={collapsed} onClick={goHome} />
            <Divider />
            {EDITOR_NAV.map((group) => {
              const holdsActive = group.items.some((i) => i.id === editorActive);
              const open = collapsed || holdsActive || !closedNavGroups.has(group.heading);
              return (
                <div key={group.heading} className="mb-1.5">
                  {!collapsed && (
                    <button
                      onClick={() => toggleNavGroup(group.heading)}
                      aria-expanded={open}
                      className={`mb-0.5 mt-2 flex w-full items-center gap-1.5 rounded px-3 py-0.5 transition-colors hover:text-text-secondary ${SECTION_LABEL}`}
                    >
                      <span className="flex-1 text-left">{group.heading}</span>
                      {!open && <span className="font-medium tabular-nums text-text-muted/70">{group.items.length}</span>}
                      <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2.5} />
                    </button>
                  )}
                  {open && (
                    <div className="space-y-0.5">
                      {group.items.map((it) => (
                        <NavRow key={it.id} icon={it.icon} label={it.label} active={editorActive === it.id} collapsed={collapsed} onClick={() => selectEditor(it.id)} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <>
            <nav aria-label="Home" className={`space-y-0.5 ${collapsed ? "px-2" : "px-3"}`}>
              <NavRow icon={House} label="Home" active={homeActive} collapsed={collapsed} onClick={goHome} testId="nav-home" />
              <NavRow icon={Inbox} label="Inbox" count={inboxCount} active={tab === "work" && workActive === "inbox"} collapsed={collapsed} onClick={() => selectWork("inbox")} testId="nav-inbox" />
              {WORK_NAV[0].items.map((it) => (
                <NavRow key={it.id} icon={it.icon} label={it.label} active={tab === "work" && workActive === it.id} collapsed={collapsed} onClick={() => selectWork(it.id)} />
              ))}
            </nav>

            <Divider />
            {!collapsed && <SectionHeader label="Work" open={workOpen} onToggle={() => setWorkOpen((v) => !v)} onAdd={newTask} addTitle="New task" />}
            {(collapsed || workOpen) && (
              <nav aria-label="Work" className={`space-y-0.5 ${collapsed ? "px-2" : "px-3"}`}>
                {WORK_NAV.slice(1).flatMap((g) => g.items).map((it) => (
                  <NavRow key={it.id} icon={it.icon} label={it.label} count={workCounts[it.id] ?? 0} active={tab === "work" && workActive === it.id} collapsed={collapsed} onClick={() => selectWork(it.id)} />
                ))}
              </nav>
            )}

            <Divider />
            {!collapsed && (
              <SectionHeader
                label="Domains"
                count={sortedDomains.length}
                open={domainsOpen}
                onToggle={() => setDomainsOpen((v) => !v)}
                onAdd={() => { setDomainsOpen(true); setAdding(true); }}
                addTitle="New domain"
                tour="domains"
              />
            )}
            {vaultError && !collapsed && domainsOpen && (
              <div className="mx-3 my-2 rounded-lg border border-warn/40 bg-warn/10 p-2 text-[13px] text-warn">{vaultError}</div>
            )}
            {sortedDomains.length === 0 && !vaultError && !collapsed && domainsOpen && (
              <div className="px-3 py-2">
                <p className="mb-2 text-[13px] text-text-muted">No domains yet. Let Prevail suggest a starter set, or add one with the + above.</p>
                <button
                  onClick={onOpenOnboarding}
                  className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 text-[14px] font-semibold text-on-accent transition-opacity hover:opacity-90"
                >
                  <Sparkles className="h-4 w-4" />
                  Set up domains
                </button>
              </div>
            )}
            {collapsed ? (
              <ul className="space-y-0.5 px-2">{sortedDomains.map(domainRow)}</ul>
            ) : domainsOpen && (
              <ul className="space-y-0.5 px-3">
                {pinnedDomains.length > 0 && (
                  <Fragment>
                    {groupHeader("Pinned", pinnedOpen, () => setPinnedOpen((v) => !v), pinnedCount)}
                    {pinnedOpen && pinnedDomains.map(domainRow)}
                  </Fragment>
                )}
                {otherDomains.length > 0 && (
                  <Fragment>
                    {groupHeader("All", allOpen, () => setAllOpen((v) => !v), otherDomains.length)}
                    {allOpen && otherDomains.map(domainRow)}
                  </Fragment>
                )}
                {archived.length > 0 && (
                  <Fragment>
                    {groupHeader("Archived", archivedOpen, () => setArchivedOpen((v) => !v), archived.length)}
                    {archivedOpen && archived.map((name) => (
                      <li key={`archived-${name}`} className="group flex h-9 items-center gap-3 rounded-lg pl-8 pr-2 text-text-muted">
                        <Archive className="h-4 w-4 shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1 truncate text-[14px]">{titleCase(name)}</span>
                        <button
                          onClick={() => restoreDomain(name)}
                          disabled={restoring === name}
                          title={`Restore ${titleCase(name)}`}
                          className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[12px] text-text-muted opacity-0 hover:border-accent-border hover:text-accent focus:opacity-100 group-hover:opacity-100 disabled:opacity-100"
                        >
                          {restoring === name ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                          Restore
                        </button>
                      </li>
                    ))}
                  </Fragment>
                )}
              </ul>
            )}
            {!collapsed && domainsOpen && adding && (
              <div className="mt-2 px-3">
                <div className="rounded-lg border border-border bg-background p-2">
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") createDomain();
                      if (e.key === "Escape") { setAdding(false); setNewName(""); setAddError(null); }
                    }}
                    placeholder="e.g. travel"
                    aria-label="New domain name"
                    className="w-full bg-transparent px-1 py-0.5 text-[14px] focus:outline-none"
                  />
                  {addError && <div className="mt-1 text-[12px] text-err">{addError}</div>}
                  <div className="mt-2 flex gap-1.5">
                    <button
                      onClick={createDomain}
                      disabled={!newName.trim()}
                      className="rounded-md bg-accent px-2.5 py-1 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:bg-surface-warm disabled:text-text-muted"
                    >
                      Create
                    </button>
                    <button
                      onClick={() => { setAdding(false); setNewName(""); setAddError(null); }}
                      className="rounded-md border border-border px-2.5 py-1 text-[13px] text-text-muted hover:bg-surface-warm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* One slim footer line: collapse, and the background-work popover. */}
      <div className={`flex shrink-0 items-center border-t border-border-subtle ${collapsed ? "flex-col gap-1 py-2" : "gap-1 px-3 py-2"}`}>
        <button
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expand sidebar (⌘B)" : "Collapse sidebar (⌘B)"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
        {!collapsed && <div className="flex-1" />}
        <FooterProcesses collapsed={collapsed} setTab={setTab} />
      </div>
    </aside>
  );
}

// Footer "Processes" control: one small icon (with a live count badge) that
// replaces the old stack of always-visible status strips. Clicking it opens a
// modal listing everything happening in the background, so the sidebar corner
// stays minimal until the user actually wants the detail.
function FooterProcesses({ collapsed, setTab }: { collapsed: boolean; setTab: (t: TabId) => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const procs = useProcesses();
  const runningBench = useBenchBatches().filter((b) => b.running);
  const count = procs.length + runningBench.length;
  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        title={count > 0
          ? `${count} background process${count === 1 ? "" : "es"} running (click for details)`
          : "Background processes: scheduled benchmarks, backups & live activity"}
        className={`relative flex ${collapsed ? "h-8 w-8" : "h-6 w-6"} shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-warm hover:text-accent ${open ? "bg-surface-warm text-accent" : ""}`}
      >
        <Activity className={collapsed ? "h-4 w-4" : "h-3.5 w-3.5"} />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-bold leading-none text-background">
            {count}
          </span>
        )}
      </button>
      {open && <ProcessesPopover anchorRef={btnRef} onClose={() => setOpen(false)} setTab={setTab} />}
    </>
  );
}

// The consolidated background-activity popover. Anchored to the footer
// Activity icon (bottom-left of the sidebar) and rises upward from it, so it
// appears where the user clicked rather than centered on screen. Reuses the
// existing strip components (they self-hide when inactive) so nothing about how
// a process, benchmark, backup, or connection renders had to be reimplemented.
function ProcessesPopover(
  { anchorRef, onClose, setTab }:
  { anchorRef: RefObject<HTMLButtonElement | null>; onClose: () => void; setTab: (t: TabId) => void },
) {
  const procs = useProcesses();
  const runningBench = useBenchBatches().filter((b) => b.running);
  const benchSched = lsGet(BENCH_SCHED.enabled, "0") === "1";
  const backupOn = lsGet(BACKUP_CFG.enabled, "0") === "1";
  const empty = procs.length === 0 && runningBench.length === 0 && !benchSched && !backupOn;
  // A small live count of the actively running work (processes + benchmark
  // runs) for the header badge. Scheduled/armed items are not counted here since
  // they are waiting, not running.
  const runningCount = procs.length + runningBench.length;

  // Anchor to the trigger: fixed positioning (so sidebar overflow never clips
  // it), left-aligned to the icon, bottom sitting just above it so the card
  // grows upward from the bottom-left footer corner.
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.max(8, r.left);
      const bottom = Math.max(8, window.innerHeight - r.top + 8);
      setPos({ left, bottom });
    };
    place();
    // Entrance feel: mount slightly offset/faded, then settle on next frame.
    const raf = requestAnimationFrame(() => setShown(true));
    window.addEventListener("resize", place);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("keydown", onKey);
    };
  }, [anchorRef, onClose]);

  return (
    // Transparent click-away backdrop.
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Background processes"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          left: pos?.left ?? 8,
          bottom: pos?.bottom ?? 8,
          width: 320,
          visibility: pos ? "visible" : "hidden",
          transformOrigin: "bottom left",
          transform: shown ? "translateY(0) scale(1)" : "translateY(6px) scale(0.98)",
          opacity: shown ? 1 : 0,
          transition: "opacity 140ms ease-out, transform 140ms ease-out",
        }}
        className="overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl ring-1 ring-black/5"
      >
        <div className="flex items-center justify-between border-b border-border-subtle/70 px-4 pb-3 pt-3.5">
          <span className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Activity className="h-4 w-4" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-[13px] font-semibold text-text-primary">Background work</span>
              <span className="text-[10px] text-text-muted">Live and scheduled activity</span>
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            {runningCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                {runningCount} live
              </span>
            )}
            <button
              onClick={onClose}
              title="Close"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-warm hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </span>
        </div>
        <div className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
          {empty ? (
            <div className="flex flex-col items-center gap-2.5 px-4 py-9 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-warm text-text-muted">
                <Activity className="h-5 w-5" />
              </span>
              <span className="text-[13px] font-medium text-text-secondary">All quiet</span>
              <span className="max-w-[220px] text-[11px] leading-relaxed text-text-muted">
                Scheduled benchmarks, automatic backups, and live activity like chats, council, and loops will show up here.
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <SidebarProcesses collapsed={false} setTab={setTab} />
              <SidebarBenchmarkRuns collapsed={false} />
              <SidebarBenchScheduled collapsed={false} />
              <SidebarBackupActive collapsed={false} />
              <SidebarGatewayLive collapsed={false} />
              <SidebarMcpLive collapsed={false} setTab={setTab} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// One floating life-domain chip: parallaxes with the cursor (via shared
// springs) and gently bobs. Icons only - never emojis.
