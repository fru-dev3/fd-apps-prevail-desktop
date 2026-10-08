// The Work tab: one bar to fire prompts into, not a chat. The chief of staff
// splits each prompt into tasks, names each one, routes it (domain, project,
// person, app, folder), assembles the team and what the vault already knows,
// and runs it on its own (in the engine or in its own Herdr tab); nothing in
// a task asks the user. A switch inside the bar picks Queue or Backlog: what
// the list shows and what Send does. The queue fills the screen: one row per
// task (check box, short name, one meta line, a spinner while it is worked),
// newest at the bottom, dragged to reorder. Clicking a row slides open the
// item panel on the right (collapsed by default, remembered, resizable): its
// status, where it went, who is on it, a short outcome, plain activity, Open
// in Herdr and "Follow up or clarify". Never the agent's output.
// Data: `prevail work ...` through bridge.ts (src-tauri/src/work.rs), polled
// while the tab is on screen.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle, ArrowDown, ArrowDownToLine, ArrowLeft, ArrowUp, ArrowUpRight, ArrowUpToLine, BookOpen, Bot, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronsLeft, ChevronsRight,
  Circle, Clock, CornerDownRight, FileText, Folder, FolderKanban, Globe, GripVertical, Hand, Laptop, Layers, Lightbulb, ListChecks, ListPlus, ListTodo, Loader2, Mail,
  MessageSquareText, Mic, Pause, PenLine, Play, Plug, Plus, RotateCcw, Search, Send, Server, ShieldCheck, SlidersHorizontal, Sparkles, Split, Square, TerminalSquare, User, Users, X,
  type LucideIcon,
} from "lucide-react";
import { invoke } from "./bridge";
import { useChiefOfStaff } from "./chiefofstaff";
import { relTime, titleCase } from "./format";
import { openMission } from "./missions";
import { requestEntity, type EntityKindName } from "./entitystore";
import { transcribe } from "./phonevoice";
import { getSpeechRecognition, type SpeechRecognitionLike } from "./quickcapture";
import { SpineTabs } from "./sidespine";
import { SpecialistAvatar } from "./specialistavatar";
import { OwnerAvatar } from "./profileswitcher";
import { useInvokeQuery } from "./query";
import type { Specialist } from "./plansmodel";
import { TintIcon } from "./tint";
import { AppRowLogo } from "./panels3";
import { RowMenu, REVEAL, type RowMenuItem } from "./ui";
import { ResizeHandle } from "./widgets";
import type { EngineApp } from "./types";
import { lsGet, lsSet } from "./storage";
import {
  ACTION_LABEL, actionsFor, activityLines, asMachines, asPrompts, asQueue, asSettings, backlog, canDispatchTo, engineLacksWork, HERDR_STATE_LABEL,
  leaseElsewhere, machineLabel, moveInQueue, needsApproval, plainError, queueSummary, STATUS_LABEL, STATUS_TONE, statusLine, taskTitle,
  type ActivityIcon, type BacklogFilter, type DestKind, type Destination, type Machine, type QueueTask, type TaskUpdate, type WorkAction, type WorkPrompt, type WorkSettings, type WorkStatus, type WorkTask,
} from "./workqueuemodel";

const POLL_MS = 3_000;
// Which Mac new work goes to, remembered on this device (the engine keeps no default).
const MACHINE_KEY = "prevail.work.machine";
// Queue or Backlog, remembered on this device: what the list shows and what Send does.
const MODE_KEY = "prevail.work.mode";
const KIND_ICON: Record<DestKind, LucideIcon> = { domain: Layers, project: FolderKanban, entity: User, event: CalendarDays, app: Plug, folder: Folder };
const textBtn = "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";
const iconBtn = "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";
const primaryBtn = "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-background transition-opacity disabled:opacity-40";
const ACTION_ICON: Partial<Record<WorkAction, LucideIcon>> = { pause: Pause, continue: Play, start: Play, stop: Square, reopen: RotateCcw };
// A fact pill in the panel's top rows: it shrinks (its label truncates) before a row would wrap.
const factPill = "inline-flex h-7 shrink-0 items-center whitespace-nowrap gap-1.5 rounded-full border border-border-subtle bg-background px-2.5 text-[12.5px] text-text-secondary transition-colors hover:bg-surface-warm hover:text-text-primary";
const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const outlineBtn = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-text-secondary transition-colors hover:border-accent-border hover:text-accent disabled:opacity-40";

type Pending = WorkPrompt & { pending: true; error?: unknown; hold?: boolean };
type View = "queue" | "backlog";

/** Open the place a task was routed to. */
function openDestination(d: Destination) {
  if (d.kind === "domain") window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: d.id === "general" ? "" : d.id }));
  else if (d.kind === "project") openMission(d.id);
  else if (d.kind === "entity" || d.kind === "event") {
    const kind = (d.kind === "event" ? "event" : (d.entity?.split("/")[0] || "person")) as EntityKindName;
    requestEntity({ kind, value: d.entity?.split("/").pop() || d.id });
  } else if (d.kind === "app") {
    const app: EngineApp = { id: d.id, title: d.label, integration: "", status: "", configured: true, domains: d.owner ? [d.owner] : [], lastSuccessTs: null, lastError: null, account: null, refresh: null, community: false };
    window.dispatchEvent(new CustomEvent("prevail:open-app", { detail: app }));
  } else if (d.kind === "folder" && d.owner) window.dispatchEvent(new CustomEvent("prevail:open-domain", { detail: d.owner }));
}

/** Dictation for the composer: live words where the webview has speech recognition, else record and let the Mac transcribe. */
function useDictation(onText: (t: string, final: boolean) => void) {
  const [state, setState] = useState<"idle" | "listening" | "transcribing">("idle");
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const media = useRef<MediaRecorder | null>(null);
  const supported = !!getSpeechRecognition() || (typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia);
  const stop = useCallback(() => {
    try { rec.current?.stop(); } catch { /* already stopped */ }
    rec.current = null;
    if (media.current && media.current.state !== "inactive") media.current.stop(); else setState("idle");
  }, []);
  useEffect(() => () => { try { rec.current?.stop(); media.current?.stop(); } catch { /* gone */ } }, []);
  const start = async () => {
    setErr(null);
    const SR = getSpeechRecognition();
    if (SR) {
      const r = new SR();
      r.continuous = true; r.interimResults = true; r.lang = navigator.language || "en-US";
      let done = "";
      r.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const seg = e.results[i][0].transcript;
          if (e.results[i].isFinal) done += seg + " "; else interim += seg;
        }
        onText((done + interim).replace(/\s+/g, " ").trim(), false);
      };
      r.onerror = (e) => { setErr(e?.error === "not-allowed" ? "Microphone access is off." : "Voice capture stopped."); setState("idle"); };
      r.onend = () => { onText(done.trim(), true); setState("idle"); };
      try { r.start(); rec.current = r; setState("listening"); } catch { setErr("Could not start the microphone."); }
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        media.current = null;
        setState("transcribing");
        try { const out = await transcribe(new Blob(chunks, { type: mr.mimeType || "audio/webm" })); if (out.text?.trim()) onText(out.text.trim(), true); }
        catch (e) { setErr(`Could not transcribe: ${String(e)}`); }
        finally { setState("idle"); }
      };
      mr.start(); media.current = mr; setState("listening");
    } catch { setErr("Microphone access is off."); }
  };
  return { state, err, supported, start, stop };
}

const STATUS_ICON: Record<WorkStatus, LucideIcon> = {
  backlog: Lightbulb, routed: Circle, queued: Clock, "needs-you": Hand, running: Loader2, paused: Pause, done: CheckCircle2, failed: AlertCircle, closed: X,
};
const TONE_TEXT = { ok: "text-ok", warn: "text-warn", err: "text-err", accent: "text-accent", muted: "text-text-muted" } as const;
/** A start on a parked idea moves it to the end of the queue. */
const actionLabel = (a: WorkAction, t: Pick<WorkTask, "status">) => (a === "start" && t.status === "backlog" ? "Move to queue" : ACTION_LABEL[a]);
const KIND_LABEL: Record<DestKind, string> = { domain: "Domain", project: "Project", entity: "Person", event: "Event", app: "App", folder: "Project folder" };
const destKindLabel = (d: Destination) => (d.kind === "entity" ? titleCase((d.entity ?? "person").split("/")[0]!.replace(/s$/, "")) : KIND_LABEL[d.kind]);
const ACT_ICON: Record<ActivityIcon, LucideIcon> = {
  route: CornerDownRight, shield: ShieldCheck, terminal: TerminalSquare, mail: Mail, globe: Globe, file: FileText, pencil: PenLine, search: Search, helper: Users,
  steps: ListChecks, spark: Sparkles, you: MessageSquareText, ask: Hand, check: CheckCircle2, clock: Clock, pause: Pause, play: Play, split: Split, warn: AlertCircle, team: Users,
};

// The item panel: collapsed by default, remembered per device; its width too.
const PANEL_KEY = "prevail.work.panel";
const PANEL_W_KEY = "prevail.work.panel.width";
const PANEL_DEFAULT = 460;
const PANEL_MIN = 360;
const panelMax = () => Math.max(PANEL_MIN, Math.round(Math.min(760, (typeof window === "undefined" ? 1440 : window.innerWidth) * 0.6)));

export function WorkQueue({ vaultPath, active = true, domains = [], phone = false }: {
  vaultPath: string; active?: boolean; domains?: string[]; phone?: boolean;
}) {
  const vault = vaultPath;
  const chiefName = useChiefOfStaff(vault || null) ?? "Chief of staff";
  // The queue: open tasks in the engine's order, first runs first, newest at the bottom; finished ones stay checked until cleared.
  const [queue, setQueue] = useState<QueueTask[]>([]);
  // Every prompt and its tasks, for the backlog.
  const [prompts, setPrompts] = useState<WorkPrompt[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  // Which list has answered at least once (so switching never flashes the empty face).
  const [loadedFor, setLoadedFor] = useState<View | null>(null);
  const [tooOld, setTooOld] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [mode, setModeState] = useState<View>(() => (lsGet(MODE_KEY, "queue") === "backlog" ? "backlog" : "queue"));
  const [filter, setFilter] = useState<BacklogFilter>("ideas");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [panelOpen, setPanelOpenState] = useState(() => lsGet(PANEL_KEY, "0") === "1");
  const [panelW, setPanelW] = useState(() => { const n = Number(lsGet(PANEL_W_KEY, "")); return n > 0 ? n : PANEL_DEFAULT; });
  // Ticked off here: the row shows checked at once and leaves with the next list.
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const [settings, setSettings] = useState<WorkSettings>({ herdr: false });
  const [machinePick, setMachinePick] = useState(() => lsGet(MACHINE_KEY, ""));
  const [machines, setMachines] = useState<Machine[]>([]);
  const [agentKinds, setAgentKinds] = useState<string[]>([]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [adding, setAdding] = useState<Machine | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // While a row is dragged, a poll must not reorder the list under the pointer.
  const dragging = useRef(false);
  const setMode = (m: View) => { setModeState(m); lsSet(MODE_KEY, m); setSel(null); };
  const setPanelOpen = (on: boolean) => { setPanelOpenState(on); lsSet(PANEL_KEY, on ? "1" : "0"); };
  /** Clicking an item opens the panel for it. */
  const openItem = (id: string) => {
    setSel(id); setPanelOpen(true);
    requestAnimationFrame(() => document.querySelector(`[data-queue-row][data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };

  const refresh = useCallback(async () => {
    if (!vault) return;
    try {
      const v = await invoke("engine_work_list", mode === "backlog" ? { vault, all: true } : { vault });
      if (mode === "backlog") setPrompts(asPrompts(v));
      else if (!dragging.current) {
        const q = asQueue(v);
        setQueue(q);
        // A ticked task the engine has cleared is gone; forget it.
        setTicked((s) => (s.size && [...s].some((id) => !q.some((t) => t.id === id)) ? new Set([...s].filter((id) => q.some((t) => t.id === id))) : s));
      }
      setErr(null); setTooOld(false);
    } catch (e) {
      if (engineLacksWork(e)) setTooOld(true); else setErr(e);
    } finally { setLoadedFor(mode); }
  }, [vault, mode]);

  const loadMachines = useCallback(async () => {
    try { const m = asMachines(await invoke("engine_work_machines", { vault })); setMachines(m.machines); setAgentKinds(m.agentKinds); }
    catch { /* the machine picker falls back to this Mac */ }
  }, [vault]);

  useEffect(() => {
    if (!active || !vault) return;
    void refresh();
    const t = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS);
    return () => clearInterval(t);
  }, [active, vault, refresh]);
  useEffect(() => {
    if (!active || !vault) return;
    invoke("engine_work_settings", { vault }).then((s) => setSettings((cur) => ({ ...cur, ...asSettings(s) }))).catch(() => {});
    void loadMachines();
  }, [active, vault, loadMachines]);

  const current = machines.find((m) => m.current);
  const pick = (machinePick && machines.some((m) => m.label === machinePick) ? machinePick : "") || current?.label || "local";

  // ── the bar ──
  const [text, setText] = useState("");
  const base = useRef("");
  const dict = useDictation((t, final) => { setText((base.current ? base.current + " " : "") + t); if (final) base.current = ""; });
  const n = useRef(0);
  const send = () => {
    const body = text.trim();
    if (!body) return;
    if (dict.state === "listening") dict.stop();
    setText(""); base.current = "";
    const hold = mode === "backlog";
    const id = `pending-${++n.current}`;
    const card: Pending = { id, ts: Date.now(), text: body, surface: "desktop", machine: pick, tasks: [], pending: true, hold };
    // New work goes to the bottom of the queue; in Backlog it is parked as ideas, never started.
    setPending((p) => [...p, card]);
    invoke<unknown>("engine_work_add", { vault, body: { text: body, surface: "desktop", ...(machines.length ? { machine: pick } : {}), ...(hold ? { hold: true } : {}) } })
      .then((res) => {
        const added = asPrompts(res)[0];
        setPending((p) => p.filter((x) => x.id !== id));
        if (added && !hold) {
          const rows = asQueue({ prompts: [added] });
          setQueue((q) => [...q.filter((t) => !rows.some((r) => r.id === t.id)), ...rows]);
          setSel((s) => (s === id ? rows[0]?.id ?? null : s));
        } else if (added) {
          setPrompts((ps) => [...ps.filter((p) => p.id !== added.id), added]);
          setSel((s) => (s === id ? added.tasks[0]?.id ?? null : s));
        }
        void refresh();
      })
      .catch((e) => setPending((p) => p.map((x) => (x.id === id ? { ...x, error: e } : x))));
  };

  // ── actions ──
  const run = async (key: string, cmd: string, args: Record<string, unknown>): Promise<boolean> => {
    setBusy(key); setErr(null);
    try { await invoke(cmd, { vault, ...args }); await refresh(); return true; }
    catch (e) { setErr(e); return false; }
    finally { setBusy(null); }
  };
  const setHerdr = (on: boolean) => { setSettings((s) => ({ ...s, herdr: on })); void run("settings", "engine_work_settings", { herdr: on }); };
  const setMachine = (id: string) => { setMachinePick(id); lsSet(MACHINE_KEY, id); };
  const connect = (m: Machine) => { setAdding(m); setOptionsOpen(true); };
  /** Move a task to insertion point `at`: the list moves at once, the engine keeps the order. */
  const move = (id: string, at: number) => {
    const r = moveInQueue(queue, id, at);
    if (!r) return;
    setQueue(r.list);
    void run(`${id}:reorder`, "engine_work_reorder", { id, ...r.args });
  };
  /** The check box: done in the engine (its Herdr tab closes); it shows checked at once and leaves with the next list. */
  const tick = (id: string) => {
    setTicked((s) => new Set(s).add(id));
    void run(`${id}:done`, "engine_work_action", { id, action: "done" }).then((ok) => {
      if (!ok) setTicked((s) => { const x = new Set(s); x.delete(id); return x; });
    });
  };

  const rows = mode === "backlog" ? backlog(prompts, filter, query) : [];
  const pendingHere = pending.filter((p) => !!p.hold === (mode === "backlog"));
  const pendingShown = pendingHere.find((p) => p.id === sel) ?? null;
  const shownId = mode === "queue" ? (pendingShown ? null : sel && queue.some((t) => t.id === sel) ? sel : queue[0]?.id ?? null) : sel ?? rows[0]?.id ?? null;
  const shown: QueueTask | null = mode === "queue"
    ? queue.find((t) => t.id === shownId) ?? null
    : (() => { const p = prompts.find((x) => x.tasks.some((t) => t.id === shownId)); const t = p?.tasks.find((x) => x.id === shownId); return p && t ? { ...t, prompt: { id: p.id, ts: p.ts, text: p.text, surface: p.surface } } : null; })();
  const loaded = loadedFor === mode;
  const empty = loaded && pendingHere.length === 0 && (mode === "queue" ? queue.length === 0 : backlog(prompts, "all").length === 0);
  const showPanel = panelOpen && (!!pendingShown || !!shown);

  if (tooOld) {
    return (
      <div data-testid="work-too-old" className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <TintIcon icon={ListTodo} tint="tasks" lg />
        <p className="mt-2 text-[17px] font-semibold text-text-primary">Update the engine to use Work mode</p>
        <p className="max-w-md text-[14px] text-text-muted">This version of the engine does not have the work queue yet. Update Prevail, then come back here.</p>
      </div>
    );
  }

  const bar = (
    <div className="shrink-0 px-4 pb-3 pt-4 sm:px-6">
      <div data-testid="work-bar" className="flex items-end gap-1.5 rounded-2xl border border-border bg-surface p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_-8px_rgba(0,0,0,0.12)] transition-colors focus-within:border-accent-border">
        <ModeSwitch value={mode} onChange={setMode} />
        <div className="min-w-0 flex-1 self-center">
          <textarea data-testid="work-input" value={text} rows={Math.min(6, Math.max(1, text.split("\n").length))}
            onChange={(e) => { setText(e.target.value); base.current = e.target.value; }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
            placeholder={mode === "backlog" ? "Park an idea for later" : "Ready for work"}
            aria-label={mode === "backlog" ? "New idea for the backlog" : "New work"}
            className="block min-h-[32px] w-full resize-none bg-transparent px-2 py-1 font-geist text-[15px] leading-6 text-text-primary outline-none placeholder:text-text-muted" />
        </div>
        <WorkOptions open={optionsOpen || !!adding} onOpen={() => setOptionsOpen(true)} onClose={() => { setOptionsOpen(false); setAdding(null); }}
          herdr={settings.herdr} onHerdr={setHerdr} machines={machines} pick={pick} current={current} onPick={setMachine} onConnect={connect}
          adding={adding} vault={vault} onAdded={(label) => { setAdding(null); if (label) setMachine(label); void loadMachines(); }} />
        {dict.supported && (
          <button type="button" data-testid="work-mic" onClick={() => (dict.state === "listening" ? dict.stop() : void dict.start())} disabled={dict.state === "transcribing"}
            title={dict.state === "listening" ? "Stop" : "Dictate"} aria-label={dict.state === "listening" ? "Stop dictating" : "Dictate"}
            className={`${iconBtn} h-8 w-8 rounded-lg ${dict.state === "listening" ? "bg-accent-soft text-accent" : ""}`}>
            {dict.state === "transcribing" ? <Loader2 className="h-4 w-4 animate-spin" /> : dict.state === "listening" ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
          </button>
        )}
        <button type="button" data-testid="work-send" onClick={send} disabled={!text.trim()} title={mode === "backlog" ? "Park in the backlog (Enter)" : "Send (Enter)"} aria-label={mode === "backlog" ? "Park in the backlog" : "Send"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-background transition-[opacity,box-shadow] hover:shadow-md hover:brightness-110 disabled:opacity-30 disabled:hover:shadow-none">
          {mode === "backlog" ? <Lightbulb className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
      {dict.err && <p className="mt-1 px-1 text-[12px] text-warn">{dict.err}</p>}
    </div>
  );

  const pendingRows = pendingHere.map((p) => <PendingRow key={p.id} p={p} on={showPanel && sel === p.id} onSelect={openItem} />);
  const list = mode === "queue" ? (
    <QueueList chiefName={chiefName} tasks={queue} pending={pendingRows} sel={showPanel ? (pendingShown ? pendingShown.id : shownId) : null} machines={machines} ticked={ticked}
      onSelect={openItem} onMove={move} onTick={tick} dragging={dragging} />
  ) : (
    <div className="px-2 pb-3 sm:px-4">
      {pendingRows}
      {rows.length === 0 && pendingRows.length === 0 && loaded && <p className="px-3 py-6 text-[14px] text-text-muted">{filter === "ideas" ? "No ideas parked." : "No tasks here."}</p>}
      {rows.map((t) => (
        <div key={t.id} data-testid="work-backlog-row" data-id={t.id} data-status={t.status}
          className={`group flex items-center gap-1 rounded-xl pr-1.5 transition-colors ${showPanel && shownId === t.id ? "bg-surface-warm" : "hover:bg-surface-warm/60"}`}>
          <button type="button" onClick={() => openItem(t.id)} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left">
            {(() => { const I = STATUS_ICON[t.status]; return <span title={STATUS_LABEL[t.status]} className="flex shrink-0"><I className={`h-4 w-4 shrink-0 ${TONE_TEXT[STATUS_TONE[t.status]]}`} aria-label={STATUS_LABEL[t.status]} /></span>; })()}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium leading-snug text-text-primary" title={t.text}>{taskTitle(t)}</span>
              <TaskMeta t={t} machines={machines} />
            </span>
          </button>
          {t.status === "backlog" && (
            <button type="button" data-testid="work-backlog-to-queue" title="Move to queue" aria-label={`Move to queue: ${taskTitle(t)}`} disabled={busy === `${t.id}:start`}
              onClick={() => void run(`${t.id}:start`, "engine_work_action", { id: t.id, action: "start" })}
              className={`${iconBtn} ${REVEAL}`}><ListTodo className="h-3.5 w-3.5" /></button>
          )}
        </div>
      ))}
    </div>
  );

  const panelBody = pendingShown ? (
    <div data-testid="work-pending" className="min-w-0 px-5 py-5">
      {!phone && <div className="flex justify-end"><PanelClose onClose={() => setPanelOpen(false)} /></div>}
      <p className="whitespace-pre-wrap break-words text-[18px] font-semibold leading-snug text-text-primary">{pendingShown.text}</p>
      <div className="mt-3 flex items-center gap-2 text-[14px] text-text-muted">
        {pendingShown.error ? <WorkError e={pendingShown.error} testId="work-pending-error" /> : <><Loader2 className="h-4 w-4 animate-spin" />{pendingShown.hold ? "Routing it into the backlog." : "The chief of staff is routing this."}</>}
      </div>
    </div>
  ) : shown ? (
    <TaskPanel key={shown.id} t={shown} machines={machines} agentKinds={agentKinds} domains={domains} host={current?.label ?? ""} busy={busy} vault={vault}
      run={run} onAddMachine={connect} onTick={tick} onClose={phone ? undefined : () => setPanelOpen(false)} related={[...queue, ...prompts.flatMap((p) => p.tasks)]} onOpen={openItem} />
  ) : null;

  const meta = mode === "queue" ? queueSummary(queue) : `${rows.length} ${rows.length === 1 ? (filter === "ideas" ? "idea" : "task") : (filter === "ideas" ? "ideas" : "tasks")}`;
  const listCol = (
    <div data-testid="work-list" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="w-full">
        <div className="flex items-center gap-3 px-5 pb-2 pt-4 sm:px-7">
          <h2 className="text-[15px] font-semibold text-text-primary">{mode === "queue" ? "Queue" : "Backlog"}</h2>
          <span data-testid="work-meta" className="min-w-0 truncate text-[13px] tabular-nums text-text-muted">{meta}</span>
          {!showPanel && (shown || pendingShown) && !phone && (
            <button type="button" data-testid="work-panel-open" onClick={() => setPanelOpen(true)} title="Show the item panel" aria-label="Show the item panel" className={`${iconBtn} ml-auto`}>
              <ChevronsLeft className="h-4 w-4" />
            </button>
          )}
        </div>
        {mode === "backlog" && (
          <div className="flex flex-wrap items-center gap-2 px-5 pb-2 sm:px-7">
            <label className="flex h-8 min-w-[12rem] flex-1 items-center gap-1.5 rounded-lg border border-border bg-background px-2 transition-colors focus-within:border-accent-border">
              <Search className="h-3.5 w-3.5 text-text-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a task" aria-label="Find a task" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
            </label>
            <SpineTabs label="Which tasks" value={filter} onChange={(f) => { setFilter(f); setSel(null); }} tabs={[{ id: "ideas", label: "Ideas", icon: Lightbulb }, { id: "done", label: "Done", icon: CheckCircle2 }, { id: "all", label: "All", icon: Layers }]} />
          </div>
        )}
        {list}
      </div>
    </div>
  );

  return (
    <div data-testid="work-queue" data-mode={mode} className="flex h-full min-h-0 flex-col">
      {bar}
      {err != null && <div className="shrink-0 px-6 pb-2"><WorkError e={err} /></div>}
      {empty ? <ReadyFace /> : phone && showPanel ? (
        <div data-testid="work-panel" className="min-h-0 flex-1 overflow-y-auto border-t border-border">
          <button type="button" onClick={() => setPanelOpen(false)} className="mx-4 mt-3 inline-flex h-10 items-center gap-1.5 rounded-md text-[15px] font-medium text-accent">
            <ArrowLeft className="h-4 w-4" />{mode === "queue" ? "Queue" : "Backlog"}
          </button>
          {panelBody}
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 border-t border-border">
          {listCol}
          {showPanel && (
            <>
              <ResizeHandle ariaLabel="Resize the item panel" testId="work-panel-resize" value={Math.min(panelW, panelMax())} min={PANEL_MIN} max={panelMax()}
                onChange={(dx) => setPanelW((w) => { const next = Math.round(Math.max(PANEL_MIN, Math.min(panelMax(), Math.min(w, panelMax()) - dx))); lsSet(PANEL_W_KEY, String(next)); return next; })}
                onReset={() => { setPanelW(PANEL_DEFAULT); lsSet(PANEL_W_KEY, String(PANEL_DEFAULT)); }} />
              <aside data-testid="work-panel" aria-label="Work item" style={{ width: Math.min(panelW, panelMax()) }}
                className="work-panel-in relative flex min-h-0 shrink-0 flex-col border-l border-border bg-surface">
                <div className="min-h-0 flex-1 overflow-y-auto">{panelBody}</div>
              </aside>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A prompt on its way to the engine: routing, or not sent (with why). */
function PendingRow({ p, on, onSelect }: { p: Pending; on: boolean; onSelect: (id: string) => void }) {
  return (
    <button type="button" data-testid="work-pending-row" onClick={() => onSelect(p.id)}
      className={`flex w-full items-center gap-3 rounded-xl py-2.5 pl-9 pr-3 text-left transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/60"}`}>
      {p.error ? <AlertCircle className="h-4 w-4 shrink-0 text-err" /> : <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-snug text-text-primary">{p.text}</span>
        <span className="mt-0.5 block text-[12px] text-text-muted">{p.error ? "Not sent" : "Routing"}</span>
      </span>
    </button>
  );
}

/** An error as one plain sentence; the raw text only behind Details. */
function WorkError({ e, testId = "work-error" }: { e: unknown; testId?: string }) {
  const { text, details } = plainError(e);
  return (
    <div data-testid={testId} className="min-w-0 text-[12px]">
      <span className="text-err">{text}</span>
      {details && details !== text && (
        <details className="mt-0.5 text-text-muted">
          <summary className="cursor-pointer select-none">Details</summary>
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-surface-warm p-2 font-mono text-[11px] [overflow-wrap:anywhere]">{details}</pre>
        </details>
      )}
    </div>
  );
}

/** Queue or Backlog, inside the bar: what the list shows and what Send does. */
function ModeSwitch({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  const opts: { id: View; label: string; title: string }[] = [
    { id: "queue", label: "Queue", title: "Send starts the work" },
    { id: "backlog", label: "Backlog", title: "Send parks it as an idea, not started" },
  ];
  return (
    <div role="radiogroup" aria-label="Send to" data-testid="work-mode" className="flex shrink-0 rounded-[10px] bg-surface-warm p-0.5">
      {opts.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} data-testid={`work-mode-${o.id}`} title={o.title} onClick={() => onChange(o.id)}
          className={`h-7 rounded-lg px-2.5 text-[13px] font-medium transition-colors ${value === o.id ? "bg-surface text-text-primary shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-text-muted hover:text-text-primary"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The one quiet meta line (the backlog): where it went (its own icon), the agent, the machine. No pills. */
function TaskMeta({ t, machines }: { t: WorkTask; machines: Machine[] }) {
  const DestIcon = t.dest ? KIND_ICON[t.dest.kind] ?? Layers : Layers;
  const look = machineLook(machines.find((m) => m.label === t.machine) ?? { label: t.machine });
  return (
    <span data-testid="work-row-meta" className="mt-1 flex min-w-0 items-center gap-3 text-[12px] text-text-muted">
      <span className="inline-flex min-w-0 items-center gap-1"><TintIcon icon={DestIcon} tint={t.dest?.kind === "domain" ? t.dest.id : t.dest?.kind ?? "general"} square={false} size={13} /><span className="truncate">{t.dest?.label ?? "General"}</span></span>
      <span className="inline-flex shrink-0 items-center gap-1"><Bot className="h-3.5 w-3.5" />{t.agentKind}</span>
      <span className="inline-flex min-w-0 items-center gap-1"><look.Icon className="h-3.5 w-3.5 shrink-0" style={{ color: look.color }} /><span className="truncate">{machineLabel(machines, t.machine)}</span></span>
    </span>
  );
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const span = (ms: number) => { const m = Math.max(0, Math.floor(ms / 60_000)); return m < 1 ? "just now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`; };
const lastAt = (t: WorkTask, evs: string[]) => [...t.log].reverse().find((l) => evs.includes(l.ev))?.ts;

/** The card's status phrase with its time: "Working · 2m", "Needs you", "Queued · 3rd", "Done · 5m ago". */
function cardStatus(t: WorkTask, queuedAt: number): { text: string; time: string } {
  const now = Date.now();
  switch (t.status) {
    case "running": { const at = lastAt(t, ["started", "starting", "again"]); return { text: "Working", time: at ? span(now - at) : "" }; }
    case "needs-you": return { text: "Needs you", time: "" };
    case "queued": return { text: "Queued", time: queuedAt ? ordinal(queuedAt) : "" };
    case "done": { const at = t.updates?.at(-1)?.ts ?? t.log.at(-1)?.ts; return { text: "Done", time: at ? relTime(at) : "" }; }
    case "failed": return { text: "Did not finish", time: "" };
    case "paused": return { text: "Paused", time: "" };
    default: return { text: "Starting", time: "" };
  }
}
const STATUS_TEXT: Partial<Record<WorkStatus, string>> = { running: "text-accent", "needs-you": "text-warn", done: "text-ok", failed: "text-err" };

/**
 * One line per card: the name first (it keeps at least about 14 characters),
 * then quiet metadata (the domain's tinted icon and name, the team as an
 * overlapping avatar stack with Ben first), and on the right the status with
 * its time and tiny agent and machine marks. As the column narrows the card
 * drops the machine, then the agent, the time and the avatars, never the name.
 */
function CardLine({ t, machines, chiefName, queuedAt, checked }: { t: WorkTask; machines: Machine[]; chiefName: string; queuedAt: number; checked: boolean }) {
  const DestIcon = t.dest ? KIND_ICON[t.dest.kind] ?? Layers : Layers;
  const look = machineLook(machines.find((m) => m.label === t.machine) ?? { label: t.machine });
  const st = cardStatus(t, queuedAt);
  const team = ["chief", ...t.specialists.slice(0, 3)];
  const working = t.status === "running";
  return (
    <>
      <span data-testid="work-row-title" className={`min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug ${checked ? "text-text-muted line-through decoration-text-muted/40" : "text-text-primary"}`}>{taskTitle(t)}</span>
      <span data-testid="work-row-meta" className="flex min-w-0 shrink-[4] items-center gap-3 overflow-hidden text-[12.5px] text-text-muted">
        <span className="inline-flex min-w-0 shrink items-center gap-1.5 @max-[22rem]:hidden" title={t.dest ? `${t.dest.label} (${destKindLabel(t.dest)})` : "General"}>
          <TintIcon icon={DestIcon} tint={t.dest?.kind === "domain" ? t.dest.id : t.dest?.kind ?? "general"} square={false} size={13} /><span className="truncate">{t.dest?.label ?? "General"}</span>
        </span>
        <span data-testid="work-row-team" className="flex shrink-0 -space-x-1.5 rounded-full transition-opacity hover:opacity-80 @max-[30rem]:hidden" title={t.specialists.length ? `${chiefName}, with ${andList(t.specialists.map((x) => titleCase(x)))}` : chiefName}>
          {team.map((x) => <SpecialistAvatar key={x} id={x} size={18} state={working ? "working" : "idle"} label={x === "chief" ? chiefName : titleCase(x)} />)}
        </span>
      </span>
      <span title={st.time ? `${st.text} · ${st.time}` : st.text} className={`inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-medium ${STATUS_TEXT[t.status] ?? "text-text-muted"}`}>
        {working ? <Loader2 data-testid="work-spinner" className="h-3.5 w-3.5 animate-spin" aria-label="Working on it" /> : t.status === "needs-you" ? <Hand className="h-3.5 w-3.5" /> : t.status === "queued" ? <Clock className="h-3.5 w-3.5" /> : t.status === "failed" ? <AlertCircle className="h-3.5 w-3.5" /> : null}
        <span data-testid="work-row-status" className={t.status === "needs-you" ? "@max-[22rem]:sr-only" : "sr-only"}>{st.text}</span>
        {st.time && <span className="font-normal text-text-muted @max-[34rem]:hidden">· {st.time}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-text-muted">
        <span data-testid="work-row-agent" title={`Agent: ${t.agentKind}`} className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-surface-strong hover:text-text-primary @max-[38rem]:hidden"><Bot className="h-3.5 w-3.5" /><span className="sr-only">{t.agentKind}</span></span>
        <span data-testid="work-row-machine" title={`Machine: ${machineLabel(machines, t.machine)}`} className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-surface-strong @max-[42rem]:hidden"><look.Icon className="h-3.5 w-3.5" style={{ color: look.color }} /><span className="sr-only">{machineLabel(machines, t.machine)}</span></span>
      </span>
    </>
  );
}

// A colour stripe down a card's left edge says its state at a glance.
const STATE_STRIPE: Partial<Record<WorkStatus, string>> = { running: "before:bg-accent", "needs-you": "before:bg-warn", done: "before:bg-ok", failed: "before:bg-err" };

/** The round check box: ticking it marks the task done (a finished task is already ticked; ticking it again clears it). */
function CheckBox({ t, ticked, onTick }: { t: WorkTask; ticked: boolean; onTick: (id: string) => void }) {
  const on = ticked || t.status === "done";
  return (
    <button type="button" role="checkbox" aria-checked={on} data-testid="work-check" data-rail-skip onClick={(e) => { e.stopPropagation(); onTick(t.id); }}
      title={t.status === "done" ? "Clear it from the queue" : "Mark it done"} aria-label={`${t.status === "done" ? "Clear" : "Mark done"}: ${taskTitle(t)}`}
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors ${on ? "border-accent bg-accent text-background" : "border-text-muted/50 hover:border-accent hover:bg-accent-soft"}`}>
      {on && <Check className="h-3 w-3" strokeWidth={3} />}
    </button>
  );
}

/** What the row shows at its end: a spinner while it is worked, else a quiet mark for a state that needs a glance. */

/**
 * The queue: one row per task, first runs first, full width. Each row: a
 * check box, the task's short name and one quiet meta line, and a spinner
 * while it is worked. Drag a row by its grip (a line shows where it lands),
 * or move it from the row's menu or with Alt+Arrow Up/Down on the focused row.
 */
function QueueList({ tasks, pending, sel, machines, ticked, onSelect, onMove, onTick, dragging, chiefName }: {
  chiefName: string; tasks: QueueTask[]; pending: React.ReactNode[]; sel: string | null; machines: Machine[]; ticked: Set<string>;
  onSelect: (id: string) => void; onMove: (id: string, at: number) => void; onTick: (id: string) => void; dragging: React.MutableRefObject<boolean>;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ id: string; at: number } | null>(null);
  // The insertion point under the pointer: before the first row whose middle is below it.
  const atFor = (y: number) => {
    const rs = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-queue-row]") ?? [])];
    const i = rs.findIndex((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
    return i < 0 ? rs.length : i;
  };
  const end = (commit: boolean) => {
    if (drag && commit) onMove(drag.id, drag.at);
    setDrag(null); dragging.current = false;
  };
  const from = drag ? tasks.findIndex((t) => t.id === drag.id) : -1;
  const showLine = (i: number) => !!drag && drag.at === i && i !== from && i !== from + 1;
  const line = (i: number) => showLine(i) && (
    <div data-testid="work-drop-indicator" aria-hidden className="relative h-0"><div className="absolute inset-x-3 -top-px h-0.5 rounded-full bg-accent" /></div>
  );
  return (
    <div ref={listRef} data-testid="work-queue-list" className="px-2 pb-6 sm:px-4">
      {tasks.map((t, i) => {
        const on = sel === t.id;
        const checked = ticked.has(t.id) || t.status === "done";
        const items: RowMenuItem[] = [
          { icon: ArrowUpToLine, label: "Move to top", disabled: i === 0, onClick: () => onMove(t.id, 0) },
          { icon: ArrowUp, label: "Move up", disabled: i === 0, onClick: () => onMove(t.id, i - 1) },
          { icon: ArrowDown, label: "Move down", disabled: i === tasks.length - 1, onClick: () => onMove(t.id, i + 2) },
          { icon: ArrowDownToLine, label: "Move to bottom", disabled: i === tasks.length - 1, onClick: () => onMove(t.id, tasks.length) },
          ...(t.dest ? [{ kind: "separator" as const }, { icon: ArrowUpRight, label: `Open ${t.dest.label}`, onClick: () => openDestination(t.dest!) }] : []),
        ];
        return (
          <div key={t.id}>
            {line(i)}
            <div data-queue-row data-testid="work-queue-row" data-id={t.id} data-status={t.status} data-checked={checked ? "true" : "false"}
              className={`group @container relative mb-2 flex h-14 items-center gap-2.5 overflow-hidden rounded-xl border bg-surface pl-3.5 pr-1.5 shadow-sm transition-[box-shadow,border-color,transform,opacity] before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${STATE_STRIPE[t.status] ?? "before:bg-border"} ${on ? "border-accent-border shadow-md" : "border-border-subtle hover:-translate-y-px hover:border-border hover:shadow-md"} ${drag?.id === t.id ? "opacity-50" : ""} ${ticked.has(t.id) ? "opacity-60" : ""}`}>
              <CheckBox t={t} ticked={ticked.has(t.id)} onTick={onTick} />
              <button type="button" onClick={() => onSelect(t.id)}
                onKeyDown={(e) => {
                  if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                  e.preventDefault();
                  onMove(t.id, e.key === "ArrowUp" ? i - 1 : i + 2);
                }}
                title={t.text}
                className="flex h-full min-w-0 flex-1 items-center gap-3 overflow-hidden text-left">
                <CardLine t={t} machines={machines} chiefName={chiefName} queuedAt={t.status === "queued" ? tasks.filter((x) => x.status === "queued").findIndex((x) => x.id === t.id) + 1 : 0} checked={checked} />
              </button>
              {checked && (
                <button type="button" data-rail-skip data-testid="work-dismiss" onClick={() => onTick(t.id)} title="Dismiss" aria-label={`Dismiss: ${taskTitle(t)}`}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-muted hover:bg-surface-warm hover:text-text-primary ${REVEAL}`}>
                  <X className="h-4 w-4" />
                </button>
              )}
              <button type="button" data-rail-skip data-testid="work-drag" aria-label={`Drag to reorder: ${taskTitle(t)}`} title="Drag to reorder"
                onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); dragging.current = true; setDrag({ id: t.id, at: i }); }}
                onPointerMove={(e) => { if (drag?.id === t.id) setDrag({ id: t.id, at: atFor(e.clientY) }); }}
                onPointerUp={() => end(true)} onPointerCancel={() => end(false)}
                className={`flex h-7 w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-warm hover:text-text-primary active:cursor-grabbing @max-[22rem]:hidden ${REVEAL}`}>
                <GripVertical className="h-3.5 w-3.5" />
              </button>
              <span data-rail-skip className={`shrink-0 ${checked ? "@max-[22rem]:hidden" : ""}`}><RowMenu items={items} reveal testId="work-row-menu" /></span>
            </div>
          </div>
        );
      })}
      {line(tasks.length)}
      {pending}
    </div>
  );
}

/** A small section of the panel: a quiet heading, then its lines. */
function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className="mt-6">
      <h3 className="mb-2.5 text-[13px] font-semibold text-text-secondary">{title}</h3>
      {children}
    </section>
  );
}

/**
 * The item panel: not a chat, and never the agent's output. The task, its
 * status, where it went (its own icon), who is on it (the chief of staff, the
 * specialists who joined with their avatars, the agent and the machine), what
 * the vault already knew, a short outcome when done, plain activity, Open in
 * Herdr, and one "Follow up or clarify" box.
 */
/** The one control that folds the item panel back to the right. */
function PanelClose({ onClose }: { onClose: () => void }) {
  return <button type="button" data-testid="work-panel-close" onClick={onClose} title="Close the panel" aria-label="Close the panel" className={iconBtn}><ChevronsRight className="h-4 w-4" /></button>;
}

function TaskPanel({ t, machines, agentKinds, domains, host, busy, vault, run, onAddMachine, onTick, onClose, related = [], onOpen }: {
  related?: WorkTask[]; onOpen?: (id: string) => void;
  t: QueueTask; machines: Machine[]; agentKinds: string[]; domains: string[]; host: string; busy: string | null; vault: string;
  run: (key: string, cmd: string, args: Record<string, unknown>) => Promise<boolean>; onAddMachine: (m: Machine) => void; onTick: (id: string) => void; onClose?: () => void;
}) {
  const act = (a: WorkAction | "continue-here" | "accept" | "focus" | "close", n?: number) => run(`${t.id}:${a}`, "engine_work_action", { id: t.id, action: a, ...(n !== undefined ? { n } : {}) });
  const route = (args: Record<string, unknown>) => run(`${t.id}:route`, "engine_work_route", { id: t.id, ...args });
  const lease = leaseElsewhere(t, host);
  const [confirmTake, setConfirmTake] = useState(false);
  const mine = busy?.startsWith(`${t.id}:`) ?? false;
  const I = STATUS_ICON[t.status];
  const tone = STATUS_TONE[t.status];
  const machine = machines.find((m) => m.label === t.machine);
  const look = machineLook(machine ?? { label: t.machine });
  const openSuggestions = t.suggestions.map((s, i) => ({ s, i })).filter(({ s }) => s.state === "open" && s.kind !== "specialist" && s.kind !== "machine");
  const destItems: RowMenuItem[] = [
    ...(t.dest ? [{ icon: ArrowUpRight, label: `Open ${t.dest.label}`, onClick: () => openDestination(t.dest!) }, { icon: RotateCcw, label: "Undo the route", onClick: () => void route({ undo: true }) }] : []),
    ...(openSuggestions.length ? [{ kind: "heading" as const, label: "Give it a home" }, ...openSuggestions.map(({ s, i }): RowMenuItem => ({ icon: Plus, label: `New ${s.kind}: ${s.name}`, onClick: () => void act("accept", i + 1) }))] : []),
    ...(t.alternatives.length ? [{ kind: "heading" as const, label: "Suggested" }, ...t.alternatives.map((d): RowMenuItem => ({ icon: KIND_ICON[d.kind], label: d.label, onClick: () => void route({ dest: `${d.kind}:${d.id}` }) }))] : []),
    ...(domains.length ? [{ kind: "heading" as const, label: "Domains" }, ...domains.filter((d) => !(t.dest?.kind === "domain" && t.dest.id === d)).map((d): RowMenuItem => ({ icon: Layers, label: titleCase(d), onClick: () => void route({ dest: `domain:${d}` }) }))] : []),
  ];
  const machineItems: RowMenuItem[] = machines.length === 0 ? [{ kind: "heading", label: "No other machines yet" }] : machines.map((m): RowMenuItem => canDispatchTo(m)
    ? { icon: tinted(machineLook(m).Icon, machineLook(m).color), label: m.label, hint: HERDR_STATE_LABEL[m.herdr], checked: m.label === t.machine, onClick: () => { if (m.label !== t.machine) void route({ machine: m.label }); } }
    : { icon: tinted(machineLook(m).Icon, machineLook(m).color), label: `Connect ${m.label}`, hint: HERDR_STATE_LABEL[m.herdr], onClick: () => onAddMachine(m) });
  const kindItems: RowMenuItem[] = agentKinds.map((k) => ({ icon: Bot, label: k, checked: k === t.agentKind, onClick: () => { if (k !== t.agentKind) void route({ agentKind: k }); } }));
  const more: RowMenuItem[] = [
    ...actionsFor(t).map((a): RowMenuItem => ({ icon: ACTION_ICON[a] ?? Play, label: actionLabel(a, t), onClick: () => void act(a) })),
    ...(t.status !== "done" && t.status !== "backlog" ? [{ icon: CheckCircle2, label: "Mark done", onClick: () => onTick(t.id) }] : t.status === "done" ? [{ icon: CheckCircle2, label: "Clear from the queue", onClick: () => onTick(t.id) }] : []),
    ...(t.herdr?.tabId ? [{ icon: X, label: "Close its Herdr tab", onClick: () => void act("close") }] : []),
    ...(t.status === "running" || t.status === "paused" || t.status === "needs-you" ? [{ kind: "separator" as const }, { icon: Square, label: "Stop", danger: true, onClick: () => void act("stop") }] : []),
  ];
  const lines = activityLines(t);
  const chiefName = useChiefOfStaff(vault || null) ?? "Chief of staff";
  // Every follow-up shows at once and gets visible feedback: thinking, then the engine's reply, or a failure with Retry.
  const [pending, setPending] = useState<SendState | null>(null);
  const send = (text: string, asTask = false) => {
    const at = Date.now();
    setPending({ text, asTask, at, state: "sending" });
    void run(`${t.id}:followup`, "engine_work_followup", { id: t.id, text, ...(asTask ? { asTask: true } : {}) }).then((ok) =>
      setPending((p) => (p?.at !== at ? p : ok ? { ...p, state: "waiting" } : { ...p, state: "failed", why: "That did not reach the task." })));
  };
  // The reply has come when the task says something after the owner's message (or the follow-up became its own task).
  const answeredAt = Math.max(0, ...(t.updates ?? []).filter((u) => u.from === "task").map((u) => u.ts));
  useEffect(() => {
    if (!pending || pending.state === "failed") return;
    if (answeredAt >= pending.at - 1_000 || (pending.asTask && pending.state === "waiting")) { setPending(null); return; }
    const left = pending.at + ANSWER_WAIT_MS - Date.now();
    const id = window.setTimeout(() => setPending((p) => (p?.at === pending.at && p.state !== "failed" ? { ...p, state: "failed", why: "No answer yet." } : p)), Math.max(0, left));
    return () => window.clearTimeout(id);
  }, [pending, answeredAt]);
  useEffect(() => { setPending(null); }, [t.id]);
  const team = t.specialists;
  const specs = useInvokeQuery<Specialist[]>("engine_specialists", vault ? { vault } : null, { staleMs: 60_000 }).data ?? [];
  const specName = (id: string) => specs.find((x) => x.id === id)?.name ?? titleCase(id);
  const chiefRole = `${chiefName}, chief of staff, leads it`;
  // The role in a few words: the first clause of its mandate ("Clerk, files and organizes").
  const roleOf = (id: string) => {
    const m = (specs.find((x) => x.id === id)?.mandate ?? "").split(/[:.;]/)[0]!.trim();
    return `${specName(id)}, ${m ? m.charAt(0).toLowerCase() + m.slice(1) : "helps with this task"}`;
  };
  // Every domain it touches besides the destination itself (the owner when the destination is a project or app), and its apps.
  const otherDomains = (t.domains ?? (t.dest && t.dest.kind !== "domain" && /^[a-z0-9-]+$/.test(t.dest.owner) ? [t.dest.owner] : [])).filter((d) => !(t.dest?.kind === "domain" && t.dest.id === d));
  const otherApps = (t.apps ?? []).filter((a) => !(t.dest?.kind === "app" && t.dest.id === a));
  return (
    <div data-testid="work-task" data-status={t.status} data-executor={t.executor} className="min-w-0 px-5 pt-4">
      {/* A balanced header: the ask on the left; its status (with time) and the people on it on the right. */}
      <div className="flex items-start gap-4">
        <div className="min-w-[10rem] flex-1">
          <h2 data-testid="work-task-title" className="break-words text-[20px] font-semibold leading-tight tracking-[-0.01em] text-text-primary">{taskTitle(t)}</h2>
          {t.name && t.name !== t.text && <p className="mt-1.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-text-secondary">{t.text}</p>}
          {t.parentId && (() => { const parent = related.find((x) => x.id === t.parentId); return (
            <button type="button" data-testid="work-parent-link" onClick={() => onOpen?.(t.parentId!)} className="mt-1.5 inline-flex items-center gap-1 rounded-md text-[13px] text-text-muted hover:text-text-primary">
              <CornerDownRight className="h-3.5 w-3.5" />From {parent ? taskTitle(parent) : "the task it came from"}
            </button>); })()}
        </div>
        <div data-testid="work-head-right" className="flex min-w-0 max-w-[55%] shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-0.5">
            <span className={`mr-1 inline-flex items-center gap-1.5 text-[13px] font-medium ${TONE_TEXT[tone]}`}>
              <I className={`h-3.5 w-3.5 shrink-0 ${t.status === "running" ? "animate-spin" : ""}`} />
              <span data-testid="work-status">{t.status === "needs-you" ? "Needs you" : statusLine(t)}</span>
              {cardStatus(t, 0).time && <span className="font-normal text-text-muted">· {cardStatus(t, 0).time}</span>}
            </span>
            {mine && <span title="Working on that" className="flex"><Loader2 className="mx-1 h-3.5 w-3.5 animate-spin text-text-muted" aria-label="Working on that" /></span>}
            {more.length > 0 && <RowMenu items={more} testId="work-task-menu" />}
            {onClose && <PanelClose onClose={onClose} />}
          </div>
          {/* Who is on it: each agent by name, Ben first, its role in the tooltip. */}
          <ul data-testid="work-team" aria-label="Who is on it" className="flex flex-wrap justify-end gap-x-1 gap-y-0.5">
            {["chief", ...team].map((x) => (
              <li key={x} data-testid={x === "chief" ? "work-chief" : "work-specialist"} title={x === "chief" ? chiefRole : roleOf(x)}
                className="flex cursor-default items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 text-[13px] text-text-secondary transition-colors hover:bg-surface-warm hover:text-text-primary">
                <SpecialistAvatar id={x} size={18} state={t.status === "running" ? "working" : "idle"} />
                <span className={x === "chief" ? "font-medium text-text-primary" : ""}>{x === "chief" ? chiefName : specName(x)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* The facts that do not change as it goes, as pills in two rows at most, no headings:
          who is on it (Ben first, then the specialists), then where it went and what it runs on. */}
      <div data-testid="work-facts" className="mt-4">
        <OverflowRow items={[
          { key: "dest", label: t.dest?.label ?? "General", node: (
            <span data-testid="work-destination" className="flex">
              <RowMenu items={destItems.length ? destItems : [{ kind: "heading", label: "No other places yet" }]} label={`${t.dest?.label ?? "General"} (${t.dest ? destKindLabel(t.dest) : "Domain"}): open or route it elsewhere`} testId="work-route"
                trigger={<>{t.dest?.kind === "app" ? <AppRowLogo app={{ id: t.dest.id, title: t.dest.label }} size={14} fallback="letter" /> : <TintIcon icon={t.dest ? KIND_ICON[t.dest.kind] ?? Layers : Layers} tint={t.dest?.kind === "domain" ? t.dest.id : t.dest?.kind ?? "general"} square={false} size={14} />}{t.dest?.label ?? "General"}<ChevronDown className="h-3 w-3 shrink-0 text-text-muted" /></>}
                triggerClass={`${factPill} text-text-primary`} />
            </span>) },
          ...otherDomains.map((d) => ({ key: `d:${d}`, label: titleCase(d), node: <span data-testid="work-domain" className={factPill} title={`${titleCase(d)} domain`}><TintIcon icon={Layers} tint={d} square={false} size={14} />{titleCase(d)}</span> })),
          ...otherApps.map((a) => ({ key: `a:${a}`, label: titleCase(a), node: <span data-testid="work-app" className={factPill} title={`${titleCase(a)} app`}><AppRowLogo app={{ id: a, title: titleCase(a) }} size={14} fallback="letter" />{titleCase(a)}</span> })),
          { key: "agent", label: `Agent: ${t.agentKind}`, node: <RowMenu items={kindItems} label="Agent" testId="work-agent" trigger={<><Bot className="h-3.5 w-3.5 shrink-0 text-text-muted" />{t.agentKind}</>} triggerClass={factPill} /> },
          { key: "machine", label: `Machine: ${machineLabel(machines, t.machine)}`, node: <RowMenu items={machineItems} label="Machine" testId="work-task-machine" trigger={<><look.Icon className="h-3.5 w-3.5 shrink-0" style={{ color: look.color }} />{machineLabel(machines, t.machine)}</>} triggerClass={factPill} /> },
          ...(t.children?.length ? [{ key: "subtasks", label: `Subtasks: ${t.children.length}`, node: (
            <RowMenu testId="work-subtasks" label="Subtasks" triggerClass={factPill}
              trigger={<><Split className="h-3.5 w-3.5 shrink-0 text-accent" />{t.children.length === 1 ? "1 subtask" : `${t.children.length} subtasks`}</>}
              items={t.children.map((c): RowMenuItem => { const x = related.find((r) => r.id === c); return { icon: x?.status === "running" ? Loader2 : x ? STATUS_ICON[x.status] : Circle, label: x ? taskTitle(x) : "A subtask", onClick: () => onOpen?.(c) }; })} />) }] : []),
          ...(t.executor === "herdr" && t.herdr?.workspaceLabel ? [{ key: "herdr", label: `Herdr: ${t.herdr.workspaceLabel}`, node: (
            <span data-testid="work-herdr-link" title={`Its own tab in the Herdr workspace ${t.herdr.workspaceLabel}`} className={factPill}>
              <img src="/herdr.png" alt="" className="h-3.5 w-3.5 shrink-0 rounded-[3px]" />{t.herdr.workspaceLabel}
            </span>) }] : []),
        ]} />
      </div>

      <Updates related={related} onOpen={onOpen} t={t} chiefName={chiefName} chiefRole={chiefRole} pending={pending} onSend={(x) => send(x)} onRetry={() => pending && send(pending.text, pending.asTask)} />

      {/* The work itself (what it knew, each step, the Herdr tab) stays out of the way: the panel shows
          what was asked and what came of it, and the steps sit behind one closed Details link. */}
      {((t.context?.length ?? 0) > 0 || lines.length > 0 || t.herdr?.tabId) && (
        <details data-testid="work-details" className="group/det mt-5">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-1 py-0.5 text-[13px] text-text-muted hover:text-text-secondary">
            Details<ChevronDown className="h-3 w-3 transition-transform group-open/det:rotate-180" />
          </summary>
      {t.context && t.context.length > 0 && (
          <Section title="What it already knows" testId="work-context">
            <ul className="space-y-1.5">
              {t.context.map((c) => (
                <li key={c.label} className="flex items-center gap-2 text-[14px] text-text-secondary"><BookOpen className="h-3.5 w-3.5 shrink-0 text-accent" /><span className="min-w-0 truncate" title={c.text}>{c.label}</span></li>
              ))}
            </ul>
          </Section>
        )}
  
        {lines.length > 0 && (
          <Section title="Activity" testId="work-activity">
            <ol className="space-y-0.5">
              {lines.map((l, i) => {
                const AI = ACT_ICON[l.icon];
                const row = <><AI className="h-3.5 w-3.5 shrink-0 text-text-muted" /><span className="min-w-0 flex-1 truncate">{l.text}</span><span className="shrink-0 tabular-nums text-[12px] text-text-muted">{clock(l.ts)}</span></>;
                return (
                  <li key={i} data-testid="work-activity-line">
                    {l.more ? (
                      <details className="group/act">
                        <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-md px-1.5 py-1 text-[14px] text-text-secondary hover:bg-surface-warm">{row}<ChevronDown className="h-3 w-3 shrink-0 text-text-muted transition-transform group-open/act:rotate-180" /></summary>
                        <p className="mb-1 ml-8 mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-muted [overflow-wrap:anywhere]">{l.more}</p>
                      </details>
                    ) : <div className="flex items-center gap-2.5 px-1.5 py-1 text-[14px] text-text-secondary">{row}</div>}
                  </li>
                );
              })}
            </ol>
          </Section>
        )}
  
          {t.herdr?.tabId && (
            <div className="mt-4">
              <button type="button" data-testid="work-open-herdr" disabled={mine} onClick={() => void act("focus")} className={outlineBtn}>
                <img src="/herdr.png" alt="" className="h-4 w-4 rounded-[4px]" />Open in Herdr
              </button>
            </div>
          )}
        </details>
      )}

      {lease.elsewhere && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {lease.elsewhere && (confirmTake ? (
            <><span className="text-[13px] text-text-secondary">On {machineLabel(machines, t.lease!.host)} now. Take it over here?</span>
              <button type="button" className={textBtn} onClick={() => { setConfirmTake(false); void act("continue-here"); }}>Yes</button>
              <button type="button" className={textBtn} onClick={() => setConfirmTake(false)}>Cancel</button></>
          ) : (
            <button type="button" data-testid="work-continue-here" className={outlineBtn} onClick={() => (lease.live ? setConfirmTake(true) : void act("continue-here"))}><Play className="h-3.5 w-3.5" />Continue here</button>
          ))}
        </div>
      )}

      {/* Always within reach: the box sits at the panel's foot while the rest scrolls. */}
      <div className="sticky bottom-0 -mx-5 mt-6 bg-surface px-5 pb-4 pt-2">
        {t.status !== "backlog" ? <FollowUp t={t} onSend={send} busy={mine} /> : <div className="h-2" />}
      </div>
    </div>
  );
}

/**
 * One row of pills that never wraps: the pills that fit show in order, the
 * rest fold into a "+N" pill whose tooltip names them. Measured after layout
 * and again whenever the row resizes.
 */
function OverflowRow({ items, testId, title }: { items: { key: string; label: string; node: React.ReactNode }[]; testId?: string; title?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(items.length);
  const sig = items.map((x) => x.key).join("|");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const kids = [...el.querySelectorAll<HTMLElement>(":scope > [data-pill]")];
      kids.forEach((k) => { k.style.display = ""; });
      const max = el.clientWidth;
      const PLUS = 44;
      let n = kids.length;
      for (let i = 0; i < kids.length; i++) {
        const right = kids[i]!.offsetLeft - el.offsetLeft + kids[i]!.offsetWidth;
        if (right > max - (i < kids.length - 1 ? PLUS : 0)) { n = i; break; }
      }
      kids.forEach((k, i) => { k.style.display = i < n ? "" : "none"; });
      setShown(n);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sig]);
  const hidden = items.slice(shown);
  return (
    <div ref={ref} data-testid={testId} title={title} className="flex min-w-0 items-center gap-1.5 overflow-hidden">
      {items.map((x) => <span key={x.key} data-pill className="flex shrink-0">{x.node}</span>)}
      {hidden.length > 0 && <span data-testid="work-facts-more" className={`${factPill} shrink-0`} title={hidden.map((x) => x.label).join(", ")}>+{hidden.length}</span>}
    </div>
  );
}

/** The task's updates, or what its state says when an older engine kept none. */
function updatesOf(t: WorkTask): TaskUpdate[] {
  if (t.updates?.length) return t.updates;
  const ts = t.log[t.log.length - 1]?.ts ?? 0;
  const say = (text: string): TaskUpdate => ({ ts, from: "task", text });
  switch (t.status) {
    case "running": return [say("Working on it, nothing needed from you.")];
    case "needs-you": return [say(t.waiting || "I need something from you.")];
    case "done": return [say(t.outcome ? `Done: ${t.outcome.replace(/^done[:.]?\s*/i, "")}` : "Done.")];
    case "failed": return [say(t.outcome || "I could not finish it.")];
    case "paused": return t.outcome ? [say(t.outcome)] : [];
    default: return [];
  }
}

/**
 * The light back-and-forth: short plain lines from the task in its own voice
 * (led by the chief of staff's avatar) and the user's replies on the right,
 * newest at the bottom. Never the agent's output. A finished task never asks
 * to close: it stays until the owner ticks it or says done or close.
 * Who speaks is plain at a glance: the agent's avatar on the left with its
 * lines on a soft tinted card, the owner's avatar on the right of a warm bubble.
 */
function Updates({ t, chiefName, chiefRole, pending, onSend, onRetry, related = [], onOpen }: { related?: WorkTask[]; onOpen?: (id: string) => void; t: WorkTask; chiefName: string; chiefRole: string; pending: SendState | null; onSend: (text: string) => void; onRetry: () => void }) {
  const ups = updatesOf(t);
  // The owner's message shows at once; it stays until the engine has recorded it.
  const mine = pending && !ups.some((u) => u.from === "you" && u.text === pending.text && u.ts >= pending.at - 60_000) ? [...ups, { ts: pending.at, from: "you" as const, text: pending.text }] : ups;
  if (!mine.length && !pending) return null;
  const avatar = (on: boolean) => <span data-testid="work-speaker" role="img" aria-label={chiefName} className="mt-1 shrink-0 cursor-default rounded-full transition-shadow hover:ring-2 hover:ring-accent-border" title={chiefRole}><SpecialistAvatar id="chief" size={20} state={on ? "working" : "idle"} /></span>;
  return (
    <ol data-testid="work-updates" className="mt-5 space-y-2.5">
      {mine.map((u, i) => (u.from === "you" ? (
        <li key={i} data-testid="work-update" data-from="you" className="flex items-end justify-end gap-2">
          <span className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-surface-warm px-3 py-1.5 text-[14px] leading-snug text-text-primary">{u.text}</span>
          <span data-testid="work-speaker" role="img" aria-label="You" title="You" className="shrink-0 cursor-default rounded-full transition-shadow hover:ring-2 hover:ring-border"><OwnerAvatar size={20} /></span>
        </li>
      ) : (
        <li key={i} data-testid="work-update" data-from="task" className="flex items-start gap-2">
          {avatar(t.status === "running" && i === mine.length - 1)}
          <span className="min-w-0 rounded-xl rounded-tl-md bg-accent-soft px-3 py-1.5">
            <span className={`block break-words text-[14px] leading-snug ${u.learned ? "text-text-secondary" : "text-text-primary"} ${t.status === "needs-you" && i === mine.length - 1 ? "font-medium" : ""}`}>{u.text}</span>
            {u.learned && !pending && (t.learned?.length || t.recurringOf?.length) ? (
              <button type="button" data-testid="work-forget" onClick={() => onSend("Forget that")}
                className="mt-0.5 text-[13px] text-text-muted underline-offset-2 transition-colors hover:text-text-primary hover:underline">Forget that</button>
            ) : null}
            {u.link && (() => { const c = related.find((x) => x.id === u.link); return (
              <button type="button" data-testid="work-subtask-chip" data-id={u.link} onClick={() => onOpen?.(u.link!)}
                className="mt-2 flex w-full max-w-sm items-center gap-2.5 rounded-xl border border-border-subtle bg-background px-3 py-2 text-left shadow-sm transition-[box-shadow,border-color] hover:border-border hover:shadow-md">
                {c?.status === "running" ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" /> : (() => { const I = c ? STATUS_ICON[c.status] : Circle; return <I className={`h-3.5 w-3.5 shrink-0 ${c ? TONE_TEXT[STATUS_TONE[c.status]] : "text-text-muted"}`} />; })()}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-text-primary">{c ? taskTitle(c) : "Subtask"}</span>
                  <span className="flex items-center gap-1 text-[12px] text-text-muted">{c?.dest && <TintIcon icon={KIND_ICON[c.dest.kind] ?? Layers} tint={c.dest.kind === "domain" ? c.dest.id : c.dest.kind} square={false} size={12} />}{c ? `${c.dest?.label ?? "General"} · ${c.status === "needs-you" ? "Needs you" : statusLine(c)}` : "Opening soon"}</span>
                </span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-text-muted" />
              </button>); })()}
            {u.questions && u.questions.length > 0 && (
              <ol data-testid="work-plan-questions" className="mt-1.5 list-decimal space-y-1 pl-5 text-[14px] leading-snug text-text-secondary marker:text-text-muted">
                {u.questions.map((q) => <li key={q}>{q}</li>)}
              </ol>
            )}
          </span>
        </li>
      )))}
      {pending && pending.state !== "failed" && (
        <li data-testid="work-thinking" className="flex items-center gap-2 text-[14px] text-text-muted">
          {avatar(true)}<span>{chiefName} is on it</span>
          <span aria-hidden className="flex gap-0.5">{[0, 1, 2].map((d) => <span key={d} className="h-1 w-1 animate-bounce rounded-full bg-text-muted" style={{ animationDelay: `${d * 150}ms` }} />)}</span>
        </li>
      )}
      {pending?.state === "failed" && (
        <li data-testid="work-send-failed" className="flex items-center gap-2 text-[14px] text-err">
          <AlertCircle className="h-4 w-4 shrink-0" /><span>{pending.why}</span>
          <button type="button" data-testid="work-retry" onClick={onRetry} className="ml-1 rounded-md px-1.5 py-0.5 text-[13px] font-medium text-text-primary underline-offset-2 hover:underline">Retry</button>
        </li>
      )}
    </ol>
  );
}

/** A follow-up on its way: shown at once, then "Ben is on it" until the engine answers; a failure or a long silence offers Retry. */
interface SendState { text: string; asTask: boolean; at: number; state: "sending" | "waiting" | "failed"; why?: string }
const ANSWER_WAIT_MS = 90_000;

/** "Follow up or clarify": appended to the task (to its agent, or it runs again); or added as a new task in the same work. */
function FollowUp({ t, onSend, busy }: { t: WorkTask; onSend: (text: string, asTask?: boolean) => void; busy: boolean }) {
  const [text, setText] = useState("");
  const send = (asTask = false) => {
    const body = text.trim();
    if (!body) return;
    setText("");
    onSend(body, asTask);
  };
  return (
    <div data-testid="work-followup" className="rounded-xl border border-border bg-background p-1.5 transition-colors focus-within:border-accent-border">
      <textarea data-testid="work-followup-input" value={text} rows={Math.min(5, Math.max(2, text.split("\n").length))} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
        placeholder={t.status === "needs-you" ? "Answer it" : (t.status === "done" || t.status === "failed") && !t.cleared ? "Reply, or say close it" : "Follow up or clarify"} aria-label="Follow up or clarify"
        className="block w-full resize-none bg-transparent px-2 py-1.5 text-[14px] leading-6 text-text-primary outline-none placeholder:text-text-muted" />
      <div className="flex items-center justify-end gap-1">
        <button type="button" data-testid="work-followup-new" disabled={!text.trim() || busy} onClick={() => send(true)} title="Add it as a new task in the same work" className={textBtn}>
          <ListPlus className="h-3.5 w-3.5" />New task
        </button>
        <button type="button" data-testid="work-followup-send" disabled={!text.trim() || busy} onClick={() => send()} title="Send (Enter)" aria-label="Send the follow-up"
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-background transition-[opacity,box-shadow] hover:shadow-md hover:brightness-110 disabled:opacity-30 disabled:hover:shadow-none"><Send className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

const clock = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });


// Each Mac gets its own colour and shape, so a glance tells them apart: the
// always-on hub (or a mini) is a server, the rest are laptops.
const MACHINE_COLORS = ["#2563eb", "#7c3aed", "#d97706", "#0d9488", "#db2777", "#16a34a"];
function machineLook(m: Pick<Machine, "label" | "hostname" | "role"> | undefined): { Icon: LucideIcon; color: string } {
  const key = `${m?.label ?? ""}`;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const server = m?.role === "hub" || /mini|studio|server|\bmm\b/i.test(`${m?.label ?? ""} ${m?.hostname ?? ""}`);
  return { Icon: server ? Server : Laptop, color: MACHINE_COLORS[h % MACHINE_COLORS.length]! };
}
/** A Lucide icon drawn in a fixed colour, for menus that take an icon component. */
function tinted(I: LucideIcon, color: string): LucideIcon {
  const C = ((p: React.ComponentProps<LucideIcon>) => <I {...p} style={{ ...(p.style ?? {}), color }} />) as unknown as LucideIcon;
  return C;
}
/** A Mac's icon on a soft disc of its own colour. */
function MachineBadge({ m, size = 28 }: { m: Pick<Machine, "label" | "hostname" | "role"> | undefined; size?: number }) {
  const { Icon, color } = machineLook(m);
  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full" style={{ width: size, height: size, background: `${color}1f` }}>
      <Icon style={{ color, width: size * 0.55, height: size * 0.55 }} />
    </span>
  );
}
const STATE_DOT: Record<Machine["herdr"], string> = { local: "bg-accent", saved: "bg-ok", disabled: "border border-text-muted", missing: "border border-text-muted" };
function MachineState({ m }: { m: Pick<Machine, "herdr"> }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-text-muted">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[m.herdr]}`} />{HERDR_STATE_LABEL[m.herdr]}
    </span>
  );
}

/**
 * One options button beside mic and Send. Its popover holds the Herdr switch
 * and the machine new work goes to, as a dropdown with each Mac's own icon
 * and whether it is connected. A dot on the button shows when either is not
 * the default, so the state is visible without opening it.
 */
function WorkOptions({ open, onOpen, onClose, herdr, onHerdr, machines, pick, current, onPick, onConnect, adding, vault, onAdded }: {
  open: boolean; onOpen: () => void; onClose: () => void;
  herdr: boolean; onHerdr: (on: boolean) => void;
  machines: Machine[]; pick: string; current: Machine | undefined; onPick: (label: string) => void; onConnect: (m: Machine) => void;
  adding: Machine | null; vault: string; onAdded: (label?: string) => void;
}) {
  const btn = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!open) { setMenu(false); return; }
    const place = () => { const r = btn.current?.getBoundingClientRect(); if (r) setPos({ top: Math.round(r.bottom + 8), right: Math.max(8, Math.round(window.innerWidth - r.right)) }); };
    place();
    const onDoc = (e: MouseEvent) => { const t = e.target as Element | null; if (!t?.closest?.("[data-work-options]") && !t?.closest?.("[data-rowmenu]")) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); window.removeEventListener("resize", place); };
  }, [open, onClose]);
  const picked = machines.find((m) => m.label === pick);
  const elsewhere = !!current && pick !== current.label;
  const label = machineLabel(machines, pick);
  return (
    <div data-work-options className="shrink-0">
      <button ref={btn} type="button" data-testid="work-options" onClick={() => (open ? onClose() : onOpen())} aria-haspopup="dialog" aria-expanded={open}
        title={["Options", herdr ? "Herdr on" : "", elsewhere ? `on ${label}` : ""].filter(Boolean).join(" · ")} aria-label="Work options"
        className={`${iconBtn} relative h-8 w-8 rounded-lg ${open ? "bg-surface-warm text-text-primary" : ""}`}>
        <SlidersHorizontal className="h-4 w-4" />
        {herdr && <img data-testid="work-options-herdr" src="/herdr.png" alt="" className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-[4px] ring-2 ring-surface" />}
        {elsewhere && <span data-testid="work-options-machine" aria-hidden className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface" style={{ background: machineLook(picked).color }} />}
      </button>
      {open && pos && createPortal(
        <div data-work-options role="dialog" aria-label="Work options" data-testid="work-options-panel" style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 w-[22rem] max-w-[calc(100vw-16px)] rounded-xl border border-border bg-surface p-1.5 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.35)]">
          <HerdrSwitch on={herdr} onChange={onHerdr} />
          <div className="mx-2 my-1 h-px bg-border-subtle" />
          <div className="px-2 pb-1.5 pt-1">
            <div id="work-machine-label" className="mb-1.5 text-[12px] font-medium text-text-muted">Machine</div>
            <button type="button" data-testid="work-machine" aria-haspopup="listbox" aria-expanded={menu} aria-labelledby="work-machine-label" onClick={() => setMenu((x) => !x)}
              className={`flex h-11 w-full items-center gap-2.5 rounded-lg border bg-background px-2 text-left transition-colors hover:border-accent-border ${menu ? "border-accent-border" : "border-border"}`}>
              <MachineBadge m={picked ?? { label: pick }} />
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-text-primary">{label}</span>
              {picked && <MachineState m={picked} />}
              <ChevronDown className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${menu ? "rotate-180" : ""}`} />
            </button>
            {menu && (
              <div role="listbox" aria-labelledby="work-machine-label" data-testid="work-machine-menu" className="mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-surface py-1">
                {machines.length === 0 && <p className="px-3 py-2 text-[13px] text-text-muted">Only this Mac for now.</p>}
                {machines.map((m) => {
                  const ok = canDispatchTo(m);
                  return (
                    <div key={m.id} role="option" aria-selected={m.label === pick} data-testid="work-machine-option" data-label={m.label}
                      onClick={() => { if (ok) { onPick(m.label); setMenu(false); } }}
                      className={`flex items-center gap-2.5 px-2 py-1.5 ${ok ? "cursor-pointer hover:bg-surface-warm" : ""}`}>
                      <MachineBadge m={m} size={26} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-[13px] font-medium ${ok ? "text-text-primary" : "text-text-secondary"}`}>{m.label}</span>
                        <MachineState m={m} />
                      </span>
                      {ok
                        ? m.label === pick && <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2.5} />
                        : <button type="button" data-testid="work-machine-connect" onClick={(e) => { e.stopPropagation(); setMenu(false); onConnect(m); }}
                            className="inline-flex h-7 shrink-0 items-center rounded-md border border-border px-2.5 text-[12px] font-medium text-text-secondary transition-colors hover:border-accent-border hover:text-accent">Connect</button>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {adding && <MachineAdd key={adding.label} machine={adding} vault={vault} onDone={onAdded} />}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Herdr, by its own mark, with a switch that slides on and off. */
function HerdrSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} data-testid="work-herdr" onClick={() => onChange(!on)}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-warm">
      <img src="/herdr.png" alt="" className="h-8 w-8 shrink-0 rounded-lg" />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-text-primary">Herdr</span>
        <span className="block text-[12px] leading-snug text-text-muted">{on ? "Work runs in a Herdr tab you can watch" : "Off: Prevail runs the work itself"}</span>
      </span>
      <span aria-hidden className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? "bg-accent" : "bg-text-muted/30"}`}>
        <span className={`absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}

/** Ready for work: a soft green character that bobs, blinks and glances about. Still under reduced motion. */
function ReadyFace() {
  return (
    <div data-testid="work-ready" className="flex min-h-0 flex-1 items-center justify-center px-6 pb-16">
      <div className="work-face" aria-hidden>
        <svg width="136" height="146" viewBox="0 0 160 172">
          <defs>
            <radialGradient id="wf-skin" cx="36%" cy="28%" r="82%">
              <stop offset="0" stopColor="#8ee89c" />
              <stop offset="0.5" stopColor="#2fb653" />
              <stop offset="1" stopColor="#0a7a1c" />
            </radialGradient>
            <radialGradient id="wf-shine" cx="50%" cy="50%" r="50%">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.75" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse className="wf-shadow" cx="80" cy="162" rx="42" ry="6" fill="#000" />
          <g className="wf-body">
            <path d="M80 12c38 0 66 22 66 64 0 44-28 70-66 70S14 120 14 76c0-42 28-64 66-64z" fill="url(#wf-skin)" />
            <ellipse cx="58" cy="44" rx="30" ry="18" fill="url(#wf-shine)" />
            <g className="wf-cheeks">
              <ellipse cx="44" cy="100" rx="10" ry="6" fill="#ff7f9e" />
              <ellipse cx="116" cy="100" rx="10" ry="6" fill="#ff7f9e" />
            </g>
            <g className="wf-look">
              <g className="wf-eyes">
                <rect x="50" y="62" width="16" height="26" rx="8" fill="#0c2a13" />
                <rect x="94" y="62" width="16" height="26" rx="8" fill="#0c2a13" />
                <circle cx="61" cy="69" r="3.6" fill="#ffffff" />
                <circle cx="105" cy="69" r="3.6" fill="#ffffff" />
              </g>
              <path d="M68 101q12 11 24 0" fill="none" stroke="#0c2a13" strokeWidth="4.5" strokeLinecap="round" />
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}

/**
 * Connect a Mac to Herdr in one click: Prevail runs it behind the scenes and
 * only asks for an address it does not know. When that Mac's Herdr needs an
 * update first, the user approves it in Terminal, then checks again.
 */
function MachineAdd({ machine, vault, onDone }: { machine: Machine; vault: string; onDone: (label?: string) => void }) {
  const [target, setTarget] = useState(machine.hostname ?? "");
  const [state, setState] = useState<"ask" | "busy" | "err" | "approve" | "approved">(machine.hostname ? "busy" : "ask");
  const [err, setErr] = useState<unknown>(null);
  const connect = useCallback(async (to: string) => {
    setState("busy"); setErr(null);
    try {
      const res = await invoke("engine_work_machine_add", { vault, label: machine.label, target: to.trim() });
      if (needsApproval(res)) { setTarget(to.trim()); setState("approve"); return; }
      onDone(machine.label);
    } catch (e) { setErr(e); setState("err"); }
  }, [vault, machine.label, onDone]);
  const approve = async () => {
    setState("busy"); setErr(null);
    try { await invoke("engine_work_machine_approve", { vault, label: machine.label, target }); setState("approved"); }
    catch (e) { setErr(e); setState("approve"); }
  };
  // Known address: connect straight away, nothing to copy or type.
  const started = useRef(false);
  useEffect(() => { if (machine.hostname && !started.current) { started.current = true; void connect(machine.hostname); } }, [machine.hostname, connect]);
  return (
    <div data-testid="work-machine-add" data-state={state} className="mx-1 mb-1 mt-1 rounded-lg bg-surface-warm/70 p-2.5">
      <div className="flex items-center gap-2.5">
        <MachineBadge m={machine} size={26} />
        <span className="min-w-0 flex-1 text-[13px] text-text-primary">
          {state === "busy" ? <span className="flex items-center gap-2 text-text-secondary"><Loader2 className="h-3.5 w-3.5 animate-spin" />Connecting {machine.label}</span>
            : state === "approve" ? <>{machine.label} needs a Herdr update on that Mac first. Approving restarts Herdr there.</>
            : state === "approved" ? <>Approve the update in the Terminal window, then check again.</>
            : state === "err" ? <>Could not connect {machine.label}.</>
            : <>Where is {machine.label}?</>}
        </span>
      </div>
      {(state === "ask" || state === "err") && (
        <div className="mt-2 flex items-center gap-1.5">
          <input value={target} onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && target.trim()) void connect(target); }}
            placeholder="its address, like mini.local" aria-label="Machine address"
            className="ring-in-box h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-[13px] outline-none focus:border-accent" />
          <button type="button" data-testid="work-machine-add-confirm" disabled={!target.trim()} onClick={() => void connect(target)} className={primaryBtn}>{state === "err" ? "Try again" : "Connect"}</button>
        </div>
      )}
      {err != null && <div className="mt-1.5"><WorkError e={err} testId="work-machine-add-error" /></div>}
      <div className="mt-2 flex items-center justify-end gap-1">
        <button type="button" onClick={() => onDone()} className={textBtn}>{state === "busy" ? "Hide" : "Cancel"}</button>
        {state === "approve" && <button type="button" data-testid="work-machine-approve" onClick={() => void approve()} className={primaryBtn}><TerminalSquare className="h-3.5 w-3.5" />Approve in Terminal</button>}
        {state === "approved" && <button type="button" data-testid="work-machine-recheck" onClick={() => void connect(target)} className={primaryBtn}><RotateCcw className="h-3.5 w-3.5" />Check again</button>}
      </div>
    </div>
  );
}
