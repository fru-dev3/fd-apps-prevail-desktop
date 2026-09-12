// Phone shell: the layout App.tsx renders instead of the desktop cockpit when
// the viewport is phone-width (useIsPhone). Same panels, different frame: a
// big legible header, one full-width surface, and a fixed bottom tab bar with
// four destinations (Chat, Domains, Needs you, Settings). The desktop `tab`
// state stays the source of truth for WHAT the conversation surface shows
// (chat / council / arena ...); this shell only decides WHICH screen is up.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  History,
  Inbox,
  Layers,
  LayoutGrid,
  MessageSquare,
  Plus,
  Scale,
  Settings as SettingsIcon,
  X,
  type LucideIcon,
} from "lucide-react";
import { invoke } from "./bridge";
import { scoreColor, titleCase } from "./format";
import { domainBlurb } from "./helpers";
import { domainIcon } from "./icons";
import { modelLabel } from "./helpers2";
import { LS, lsGet } from "./storage";
import { EDITOR_NAV } from "./navdefs";
import { DecisionInbox } from "./decisioninbox";
import type { CliInfo, Domain, DomainTab, LifeReadiness, TabId, ThreadMeta } from "./types";

export type PhoneScreen = "chat" | "domains" | "needs" | "settings";

const PHONE_TABS: { id: PhoneScreen; label: string; icon: LucideIcon }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "domains", label: "Domains", icon: LayoutGrid },
  { id: "needs", label: "Needs you", icon: Inbox },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

const cap9 = (n: number): string => (n > 9 ? "9+" : String(n));

function relTime(secs: number): string {
  const delta = Date.now() / 1000 - secs;
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  if (delta < 86400 * 7) return `${Math.floor(delta / 86400)}d ago`;
  return new Date(secs * 1000).toLocaleDateString();
}

// The model the next chat turn in this domain will use: the per-domain pick,
// else the global default, else the first available runtime.
function modelPill(domain: string | null, clis: CliInfo[]): string {
  const d = domain || "";
  const cli = (d && lsGet(`prevail.domain.${d}.cli`)) || lsGet(LS.defaultChatCli) || clis.find((c) => c.available)?.id || "";
  if (!cli) return "No model";
  const model = (d && lsGet(`prevail.domain.${d}.model`)) || lsGet(`prevail.model.${cli}`);
  const label = modelLabel(cli, model);
  return label || clis.find((c) => c.id === cli)?.label || titleCase(cli);
}

// One big header row used by every screen: title on the left, an optional
// leading back button, and a right-side slot. Respects the iOS status bar.
function Header({ title, back, right, sub }: { title: string; back?: () => void; right?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="shrink-0 border-b border-border-subtle bg-background px-4 pt-[env(safe-area-inset-top)]">
      <div className="flex min-h-[60px] items-center gap-2">
        {back && (
          <button type="button" onClick={back} aria-label="Back" className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text-secondary active:bg-surface-warm">
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <h1 className="min-w-0 flex-1 truncate font-display text-[26px] font-semibold leading-tight tracking-tight text-text-primary">{title}</h1>
        {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
      </div>
      {sub && <div className="flex items-center gap-2 pb-3">{sub}</div>}
    </div>
  );
}

function Sheet({ title, onClose, children, action }: { title: string; onClose: () => void; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose} role="dialog" aria-label={title}>
      <div className="absolute inset-0 bg-black/60" aria-hidden />
      <div className="relative z-10 flex max-h-[75dvh] flex-col rounded-t-3xl border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" aria-hidden />
        <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3">
          <h2 className="min-w-0 flex-1 truncate font-display text-[22px] font-semibold leading-tight text-text-primary">{title}</h2>
          {action}
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text-secondary active:bg-surface-warm">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
      </div>
    </div>
  );
}

export function PhoneShell({
  vaultPath,
  domains,
  selectedDomain,
  onOpenDomain,
  onDomainCreated,
  scopeLabel,
  onCloseApp,
  tab,
  setTab,
  setDomainTab,
  clis,
  runningDomains,
  finishedDomains,
  threads,
  activeThreadPath,
  onPickThread,
  onNewThread,
  decisionsCount,
  onOpenSettingsAt,
  settingsJump,
  conversation,
  settings,
  footer,
}: {
  vaultPath: string;
  domains: Domain[];
  selectedDomain: string | null;
  onOpenDomain: (name: string) => void;
  onDomainCreated: (d: Domain) => void;
  // An open app's title (the conversation belongs to the app, not a domain).
  scopeLabel?: string | null;
  onCloseApp?: () => void;
  tab: TabId;
  setTab: (t: TabId) => void;
  setDomainTab: (t: DomainTab) => void;
  clis: CliInfo[];
  runningDomains: Set<string>;
  finishedDomains: Set<string>;
  threads: ThreadMeta[];
  activeThreadPath: string | null;
  onPickThread: (path: string) => void;
  onNewThread: () => void;
  decisionsCount: number;
  onOpenSettingsAt: (section: string) => void;
  settingsJump: { section: string; n: number } | null;
  // The desktop's center surfaces, rendered full-width here.
  conversation: ReactNode;
  settings: ReactNode;
  footer?: ReactNode;
}) {
  const [screen, setScreen] = useState<PhoneScreen>("chat");
  // Settings opens on the section list; a deep link (or a tap on a row) shows
  // the section itself with a back button to the list.
  const [settingsList, setSettingsList] = useState(true);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [newDomainOpen, setNewDomainOpen] = useState(false);
  // Collapsed by default: the conversation is why you opened this.
  const [navOpen, setNavOpen] = useState(false);

  // Follow the desktop tab state whenever something else navigates (a deep link
  // event, a domain pick, a council seed): the matching phone screen comes up.
  useEffect(() => {
    if (tab === "work") setScreen("needs");
    else if (tab === "settings") { setScreen("settings"); setSettingsList(false); }
    else setScreen("chat");
  }, [tab]);
  useEffect(() => {
    if (settingsJump) { setScreen("settings"); setSettingsList(false); }
  }, [settingsJump?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Readiness scores for the domain cards (a dot per domain when data exists).
  const [scores, setScores] = useState<Record<string, number>>({});
  useEffect(() => {
    let on = true;
    invoke<LifeReadiness>("engine_score_all", { vault: vaultPath })
      .then((lr) => {
        if (!on || !lr || !Array.isArray(lr.domains)) return;
        const m: Record<string, number> = {};
        for (const d of lr.domains) if (d && typeof d.score === "number") m[d.domain] = d.score;
        setScores(m);
      })
      .catch(() => {});
    return () => { on = false; };
  }, [vaultPath, domains.length]);

  const visibleDomains = useMemo(() => domains.filter((d) => !d.name.startsWith("_")), [domains]);
  const onGeneral = !selectedDomain;
  const title = scopeLabel ?? (onGeneral ? "General" : titleCase(selectedDomain!));
  const councilMode = tab === "council";
  const pill = councilMode ? "Council" : modelPill(selectedDomain, clis);

  const goTab = (id: PhoneScreen) => {
    if (id === "chat") {
      if (tab !== "chat" && tab !== "council") setTab("chat");
      setScreen("chat");
    } else if (id === "settings") {
      setSettingsList(true);
      setScreen("settings");
    } else {
      setScreen(id);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background text-text-primary">
      {/* ── Chat / Council ─────────────────────────────────────────────── */}
      {screen === "chat" && (
        <>
          <Header
            title={title}
            back={scopeLabel && onCloseApp ? onCloseApp : undefined}
            /* No model pill here: the composer carries one you can actually
               tap to change, and two of them on one screen (showing different
               halves of the same answer, "Opus 5" against "claude") reads as a
               bug. Council still names itself, since that is a mode, not a
               model. */
            right={councilMode ? (
              <span className="inline-flex h-8 max-w-[150px] items-center gap-1.5 truncate rounded-full border border-accent-border bg-accent-soft px-3 text-[12px] font-medium text-accent">
                <Scale className="h-3.5 w-3.5" />
                <span className="truncate">{pill}</span>
              </span>
            ) : undefined}
            sub={
              <>
                <div className="inline-flex rounded-xl bg-surface-warm p-1" role="tablist" aria-label="Conversation mode">
                  {([["chat", "Chat", MessageSquare], ["council", "Council", Scale]] as const).map(([id, label, Icon]) => {
                    const active = tab === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => { setTab(id); if (id === "chat") setDomainTab("chat"); }}
                        className={`flex h-9 items-center gap-1.5 rounded-lg px-4 text-[13px] font-semibold transition-colors ${active ? "bg-accent text-on-accent shadow-sm" : "text-text-muted"}`}
                      >
                        <Icon className="h-4 w-4" /> {label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => setThreadsOpen(true)}
                  className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold text-text-secondary active:bg-surface-warm"
                >
                  <History className="h-4 w-4" /> Threads
                  {threads.length > 0 && <span className="rounded-full bg-surface-strong px-1.5 py-px font-mono text-[10px] text-text-secondary">{threads.length}</span>}
                </button>
              </>
            }
          />
          {/* Composer padding tightened for the narrow width; transcript untouched. */}
          <div className="flex min-h-0 flex-1 flex-col [&_[data-tour=composer]]:px-3 [&_[data-tour=composer]]:pb-3">
            {conversation}
          </div>
        </>
      )}

      {/* ── Domains ────────────────────────────────────────────────────── */}
      {screen === "domains" && (
        <>
          <Header
            title="Domains"
            right={
              <button type="button" onClick={() => setNewDomainOpen(true)} className="flex h-11 items-center gap-1 rounded-xl px-3 text-[13px] font-semibold text-text-secondary active:bg-surface-warm">
                <Plus className="h-4 w-4" /> New
              </button>
            }
          />
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <ul className="flex flex-col gap-2">
              <DomainCard
                name=""
                label="General"
                blurb="Everything at once. Chat across every domain."
                icon={Layers}
                active={onGeneral && !scopeLabel}
                onClick={() => { onOpenDomain(""); setScreen("chat"); }}
              />
              {visibleDomains.map((d) => (
                <DomainCard
                  key={d.name}
                  name={d.name}
                  label={titleCase(d.name)}
                  blurb={domainBlurb(d.name)}
                  icon={domainIcon(d.name) ?? Layers}
                  active={selectedDomain === d.name && !scopeLabel}
                  score={scores[d.name]}
                  running={runningDomains.has(d.name)}
                  finished={finishedDomains.has(d.name)}
                  onClick={() => { onOpenDomain(d.name); setScreen("chat"); }}
                />
              ))}
            </ul>
            {visibleDomains.length === 0 && (
              <div className="mt-2 rounded-2xl border border-dashed border-border px-4 py-8 text-center text-[13px] text-text-muted">
                No domains yet. Tap New to create your first one.
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Needs you ──────────────────────────────────────────────────── */}
      {screen === "needs" && (
        <>
          <Header
            title="Needs you"
            right={decisionsCount > 0 ? <span className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-full bg-accent px-2 font-mono text-[12px] font-bold text-on-accent">{cap9(decisionsCount)}</span> : undefined}
          />
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <DecisionInbox vaultPath={vaultPath} />
          </div>
        </>
      )}

      {/* ── Settings ───────────────────────────────────────────────────── */}
      {screen === "settings" && settingsList && (
        <>
          <Header title="Settings" />
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {EDITOR_NAV.map((grp) => (
              <section key={grp.heading} className="mb-5">
                <h2 className="mb-2 px-1 text-[13px] font-semibold text-text-muted">{grp.heading}</h2>
                <ul className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
                  {grp.items.map((it, i) => {
                    const Icon = it.icon;
                    return (
                      <li key={it.id} className={i > 0 ? "border-t border-border-subtle" : ""}>
                        <button
                          type="button"
                          onClick={() => { setSettingsList(false); onOpenSettingsAt(it.id); }}
                          className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left active:bg-surface-warm"
                        >
                          <Icon className="h-5 w-5 shrink-0 text-text-secondary" />
                          <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-text-primary">{it.label}</span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
      {screen === "settings" && !settingsList && (
        <>
          <Header
            title={EDITOR_NAV.flatMap((g) => g.items).find((it) => it.id === settingsJump?.section)?.label ?? "Settings"}
            back={() => setSettingsList(true)}
          />
          {/* SettingsPanel pads for a wide pane; pull that in for the phone. */}
          <div className="flex min-h-0 flex-1 flex-col [&_.px-8]:px-4 [&_.py-10]:py-5">
            {settings}
          </div>
        </>
      )}

      {footer}

      {/* ── Bottom tab bar ─────────────────────────────────────────────── */}
      {/* The tab bar is 58px plus the home indicator, permanently, on a screen
          that is mostly conversation. Collapsed by default it is a 30px handle
          naming where you are; the chevron brings the full bar up, and picking
          a destination puts it away again. */}
      <nav aria-label="Primary" className="shrink-0 border-t border-border-subtle bg-surface pb-[env(safe-area-inset-bottom)]">
        {navOpen ? (
          <ul className="grid grid-cols-4">
            {PHONE_TABS.map((t) => {
              const active = screen === t.id;
              const Icon = t.icon;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => { goTab(t.id); setNavOpen(false); }}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex min-h-[58px] w-full flex-col items-center justify-center gap-1 ${active ? "text-accent" : "text-text-muted"}`}
                  >
                    <Icon className="h-6 w-6" strokeWidth={active ? 2.25 : 1.75} />
                    <span className="text-[11px] font-semibold leading-none">{t.label}</span>
                    {t.id === "needs" && decisionsCount > 0 && (
                      <span className="absolute left-1/2 top-2 ml-2 inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-bold leading-none text-on-accent">{cap9(decisionsCount)}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-expanded={false}
            aria-label="Show navigation"
            data-testid="phone-nav-handle"
            className="flex min-h-[34px] w-full items-center justify-center gap-2 text-text-muted active:bg-surface-warm"
          >
            <ChevronUp className="h-4 w-4" />
            <span className="text-[12px] font-semibold">{PHONE_TABS.find((t) => t.id === screen)?.label ?? "Menu"}</span>
            {decisionsCount > 0 && (
              <span className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-bold leading-none text-on-accent">{cap9(decisionsCount)}</span>
            )}
          </button>
        )}
      </nav>

      {threadsOpen && (
        <Sheet
          title="Threads"
          onClose={() => setThreadsOpen(false)}
          action={
            <button type="button" onClick={() => { onNewThread(); setThreadsOpen(false); }} className="flex h-11 items-center gap-1 rounded-xl px-3 text-[13px] font-semibold text-text-secondary active:bg-surface-warm">
              <Plus className="h-4 w-4" /> New
            </button>
          }
        >
          {threads.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-[13px] text-text-muted">No threads yet. Tap New to start one.</div>
          ) : (
            <ul className="flex flex-col gap-1">
              {threads.map((t) => {
                const active = t.path === activeThreadPath;
                return (
                  <li key={t.path}>
                    <button
                      type="button"
                      onClick={() => { onPickThread(t.path); setThreadsOpen(false); }}
                      className={`flex min-h-[56px] w-full flex-col justify-center rounded-xl px-3 py-2 text-left ${active ? "bg-accent-soft ring-1 ring-accent-border" : "active:bg-surface-warm"}`}
                    >
                      <span className={`truncate text-[15px] font-medium ${active ? "text-accent" : "text-text-primary"}`}>{t.title || "Untitled"}</span>
                      <span className="truncate text-[12px] text-text-muted">{relTime(t.updated)}{t.preview ? ` · ${t.preview}` : ""}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Sheet>
      )}

      {newDomainOpen && (
        <NewDomainSheet
          vaultPath={vaultPath}
          onClose={() => setNewDomainOpen(false)}
          onCreated={(d) => { setNewDomainOpen(false); onDomainCreated(d); setScreen("chat"); }}
        />
      )}
    </div>
  );
}

function DomainCard({ name, label, blurb, icon: Icon, active, score, running, finished, onClick }: {
  name: string;
  label: string;
  blurb: string;
  icon: LucideIcon;
  active: boolean;
  score?: number;
  running?: boolean;
  finished?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        data-domain={name || "general"}
        aria-current={active ? "true" : undefined}
        className={`flex min-h-[64px] w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${active ? "border-accent-border bg-accent-soft" : "border-border-subtle bg-surface active:bg-surface-warm"}`}
      >
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${active ? "bg-accent text-on-accent" : "bg-surface-warm text-text-secondary"}`}>
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={`truncate text-[16px] font-semibold ${active ? "text-accent" : "text-text-primary"}`}>{label}</span>
            {running && <span className="inline-flex items-center gap-1 rounded-full bg-ai-soft px-1.5 py-px text-[10px] font-semibold text-ai"><span className="pulse-soft h-1.5 w-1.5 rounded-full bg-ai" /> running</span>}
            {!running && finished && <span className="inline-flex items-center gap-1 rounded-full bg-ok/10 px-1.5 py-px text-[10px] font-semibold text-ok"><span className="h-1.5 w-1.5 rounded-full bg-ok" /> new reply</span>}
          </span>
          <span className="block truncate text-[13px] text-text-muted">{blurb}</span>
        </span>
        {typeof score === "number" && (
          <span className="flex shrink-0 items-center gap-1.5" title={`Readiness ${score}/100`}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: scoreColor(score) }} />
            <span className="font-mono text-[12px] text-text-secondary">{score}</span>
          </span>
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
      </button>
    </li>
  );
}

// Same backend call the desktop sidebar's "+" uses (create_domain).
function NewDomainSheet({ vaultPath, onClose, onCreated }: { vaultPath: string; onClose: () => void; onCreated: (d: Domain) => void }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    const n = name.trim().toLowerCase().replace(/\s+/g, "-");
    if (!n) return;
    setBusy(true); setErr(null);
    try {
      const d = await invoke<Domain>("create_domain", { vault: vaultPath, name: n });
      onCreated(d);
    } catch (e) {
      setErr(String(e));
    } finally { setBusy(false); }
  };
  return (
    <Sheet title="New domain" onClose={onClose}>
      <label className="block text-[13px] font-medium text-text-secondary" htmlFor="phone-new-domain">Name</label>
      <input
        id="phone-new-domain"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
        placeholder="e.g. wealth, health, travel"
        className="mt-1.5 h-12 w-full rounded-xl border border-border bg-background px-4 text-[16px] text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none"
      />
      {err && <p className="mt-2 text-[13px] text-err">{err}</p>}
      <button
        type="button"
        onClick={() => void create()}
        disabled={busy || !name.trim()}
        className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-accent text-[15px] font-semibold text-on-accent disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create domain"}
      </button>
    </Sheet>
  );
}
