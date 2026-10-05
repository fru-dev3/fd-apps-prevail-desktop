// The Work tab: one bar to fire prompts into, not a chat. The chief of staff
// splits each prompt into goals and tasks, routes each one (domain, project,
// person, app, folder), staffs it and runs it, in the engine or in a Herdr
// tab. A two-way switch inside the bar picks Queue or Backlog: it decides
// what the list below shows and what Send does (Queue starts work, Backlog
// parks the prompt as ideas that never start until moved to the queue). The
// queue is one ordered list of open tasks, newest at the bottom, that the
// user drags to reorder; the engine runs them in that order, several at once
// (how many is in Settings > Work). One options button holds the Herdr switch
// and the machine. An empty list shows a small living face, nothing else.
// Data: `prevail work ...` through bridge.ts (src-tauri/src/work.rs), polled
// while the tab is on screen.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle, ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpRight, ArrowUpToLine, Bot, CalendarDays, Check, CheckCircle2, ChevronDown, Circle, Clock, Folder,
  FolderKanban, GripVertical, Hand, Laptop, Layers, Lightbulb, ListTodo, Loader2, Mic, Pause, Play, Plug, RotateCcw, Search, Send, Server, SlidersHorizontal, Square, TerminalSquare, User, X,
  type LucideIcon,
} from "lucide-react";
import { invoke } from "./bridge";
import { titleCase } from "./format";
import { JobCard } from "./jobcard";
import { openMission } from "./missions";
import { requestEntity, type EntityKindName } from "./entitystore";
import { transcribe } from "./phonevoice";
import { getSpeechRecognition, type SpeechRecognitionLike } from "./quickcapture";
import { SideSpine, SpineTabs } from "./sidespine";
import { SpecialistAvatar } from "./specialistavatar";
import { TintIcon } from "./tint";
import { RowMenu, StatusDot, REVEAL, type RowMenuItem } from "./ui";
import { META, SECTION_TITLE } from "./typescale";
import type { EngineApp } from "./types";
import { lsGet, lsSet } from "./storage";
import {
  ACTION_LABEL, actionsFor, asMachines, asPrompts, asQueue, asSettings, asWorkspaces, backlog, canDispatchTo, engineLacksWork, groupByGoal, HERDR_STATE_LABEL,
  leaseElsewhere, machineLabel, mirrorTail, moveInQueue, needsApproval, plainError, queueSummary, STATUS_LABEL, STATUS_TONE,
  type BacklogFilter, type DestKind, type Destination, type Machine, type QueueTask, type WorkAction, type WorkPrompt, type WorkSettings, type WorkStatus, type WorkTask,
} from "./workqueuemodel";

const POLL_MS = 3_000;
// Which Mac new work goes to, remembered on this device (the engine keeps no default).
const MACHINE_KEY = "prevail.work.machine";
// Queue or Backlog, remembered on this device: what the list shows and what Send does.
const MODE_KEY = "prevail.work.mode";
const KIND_ICON: Record<DestKind, LucideIcon> = { domain: Layers, project: FolderKanban, entity: User, event: CalendarDays, app: Plug, folder: Folder };
const chip = "inline-flex max-w-[16rem] items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-text-secondary transition-colors hover:bg-surface-warm hover:text-text-primary";
const textBtn = "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";
const iconBtn = "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";
const primaryBtn = "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-background transition-opacity disabled:opacity-40";
const ACTION_ICON: Partial<Record<WorkAction, LucideIcon>> = { pause: Pause, continue: Play, start: Play, stop: Square, keep: Check, close: X, reopen: RotateCcw };

type Pending = WorkPrompt & { pending: true; error?: unknown; hold?: boolean };
type View = "queue" | "backlog";

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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

export function WorkQueue({ vaultPath, active = true, domains = [], phone = false }: {
  vaultPath: string; active?: boolean; domains?: string[]; phone?: boolean;
}) {
  const vault = vaultPath;
  // The queue: open tasks in the engine's order, first runs first, newest at the bottom.
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

  const refresh = useCallback(async () => {
    if (!vault) return;
    try {
      const v = await invoke("engine_work_list", mode === "backlog" ? { vault, all: true } : { vault });
      if (mode === "backlog") setPrompts(asPrompts(v));
      else if (!dragging.current) setQueue(asQueue(v));
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
  const run = async (key: string, cmd: string, args: Record<string, unknown>) => {
    setBusy(key); setErr(null);
    try { await invoke(cmd, { vault, ...args }); await refresh(); }
    catch (e) { setErr(e); }
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

  const rows = mode === "backlog" ? backlog(prompts, filter, query) : [];
  const pendingHere = pending.filter((p) => !!p.hold === (mode === "backlog"));
  const pendingShown = pendingHere.find((p) => p.id === sel) ?? null;
  const shownId = mode === "queue" ? (pendingShown ? null : sel && queue.some((t) => t.id === sel) ? sel : queue[0]?.id ?? null) : sel ?? rows[0]?.id ?? null;
  const shown: QueueTask | null = mode === "queue"
    ? queue.find((t) => t.id === shownId) ?? null
    : (() => { const p = prompts.find((x) => x.tasks.some((t) => t.id === shownId)); const t = p?.tasks.find((x) => x.id === shownId); return p && t ? { ...t, prompt: { id: p.id, ts: p.ts, text: p.text, surface: p.surface } } : null; })();
  // The tasks the shown one's prompt made, so the detail shows where it came from.
  const siblings = shown ? (mode === "queue" ? queue : prompts.find((p) => p.id === shown.promptId)?.tasks ?? []).filter((t) => t.promptId === shown.promptId) : [];
  const loaded = loadedFor === mode;
  const empty = loaded && pendingHere.length === 0 && (mode === "queue" ? queue.length === 0 : backlog(prompts, "all").length === 0);

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
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-background transition-opacity disabled:opacity-30">
          {mode === "backlog" ? <Lightbulb className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
      {dict.err && <p className="mt-1 px-1 text-[12px] text-warn">{dict.err}</p>}
    </div>
  );

  const pendingRows = pendingHere.map((p) => <PendingRow key={p.id} p={p} on={sel === p.id} onSelect={setSel} />);
  const list = mode === "queue" ? (
    <QueueList tasks={queue} pending={pendingRows} sel={pendingShown ? pendingShown.id : shownId} machines={machines}
      onSelect={setSel} onMove={move} dragging={dragging} />
  ) : (
    <div className="px-2 pb-3">
      {pendingRows}
      {rows.length === 0 && pendingRows.length === 0 && loaded && <p className="px-2 py-6 text-[13px] text-text-muted">{filter === "ideas" ? "No ideas parked." : "No tasks here."}</p>}
      {rows.map((t) => (
        <div key={t.id} data-testid="work-backlog-row" data-id={t.id} data-status={t.status}
          className={`group flex items-start gap-1 rounded-lg pr-1 transition-colors ${shownId === t.id ? "bg-surface-warm" : "hover:bg-surface-warm/60"}`}>
          <button type="button" onClick={() => setSel(t.id)} className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2 text-left">
            <span className="line-clamp-2 break-words text-[14px] font-medium leading-snug text-text-primary">{t.text}</span>
            <span className="flex min-w-0 items-center gap-1.5"><StatusDot tone={STATUS_TONE[t.status]} label={STATUS_LABEL[t.status]} />{t.dest && <span className="truncate text-[12px] text-text-muted">· {t.dest.label}</span>}</span>
          </button>
          {t.status === "backlog" && (
            <button type="button" data-testid="work-backlog-to-queue" title="Move to queue" aria-label={`Move to queue: ${t.text}`} disabled={busy === `${t.id}:start`}
              onClick={() => void run(`${t.id}:start`, "engine_work_action", { id: t.id, action: "start" })}
              className={`${iconBtn} mt-1.5 ${REVEAL}`}><ListTodo className="h-3.5 w-3.5" /></button>
          )}
        </div>
      ))}
    </div>
  );

  const detail = pendingShown ? (
    <div data-testid="work-pending" className="min-w-0 px-4 py-4 sm:px-6">
      <p className="whitespace-pre-wrap break-words text-[17px] font-semibold leading-snug text-text-primary">{pendingShown.text}</p>
      <div className="mt-3 flex items-center gap-2 text-[14px] text-text-muted">
        {pendingShown.error ? <WorkError e={pendingShown.error} testId="work-pending-error" /> : <><Loader2 className="h-4 w-4 animate-spin" />{pendingShown.hold ? "Routing it into the backlog." : "The chief of staff is routing this."}</>}
      </div>
    </div>
  ) : shown ? (
    <div data-testid="work-detail" className="min-w-0 px-4 py-4 sm:px-6">
      <TaskRow key={shown.id} t={shown} machines={machines} agentKinds={agentKinds} domains={domains} host={current?.label ?? ""} busy={busy} vault={vault}
        run={run} onAddMachine={connect} />
      {shown.prompt && (
        <section data-testid="work-from-prompt" className="mt-6 border-t border-border-subtle pt-4">
          <h3 className={`${SECTION_TITLE} text-text-secondary`}>From this prompt</h3>
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-[14px] text-text-secondary" title={shown.prompt.text}>{shown.prompt.text}</p>
          <p className={`mt-0.5 ${META}`}>{[shown.prompt.surface ? titleCase(shown.prompt.surface) : "", ago(shown.prompt.ts)].filter(Boolean).join(" · ")}</p>
          {siblings.length > 1 && groupByGoal(siblings).map((g) => (
            <div key={g.goal} className="mt-2">
              {!(g.tasks.length === 1 && g.tasks[0]!.text === g.goal) && <p className="text-[13px] font-medium text-text-secondary">{g.goal}</p>}
              <div className="mt-0.5 border-l border-border-subtle pl-3">
                {g.tasks.map((t) => (
                  <button key={t.id} type="button" data-testid="work-sibling" onClick={() => setSel(t.id)} disabled={t.id === shown.id}
                    className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors hover:bg-surface-warm disabled:hover:bg-transparent">
                    <StatusDot tone={STATUS_TONE[t.status]} label={STATUS_LABEL[t.status]} />
                    <span className={`min-w-0 flex-1 truncate ${t.id === shown.id ? "font-medium text-text-primary" : "text-text-secondary"}`}>{t.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  ) : (
    <div className="flex h-full items-center justify-center px-6 text-[14px] text-text-muted">{loaded ? null : <Loader2 className="h-4 w-4 animate-spin" />}</div>
  );

  return (
    <div data-testid="work-queue" data-mode={mode} className="flex h-full min-h-0 flex-col">
      {bar}
      {err != null && <div className="shrink-0 px-6 pb-2"><WorkError e={err} /></div>}
      {empty ? <ReadyFace /> : <div className="flex min-h-0 min-w-0 flex-1 border-t border-border">
        <SideSpine storageKey="prevail.work.spine" wide resizable title={mode === "queue" ? "Queue" : "Backlog"} label="work" testId="work-spine"
          meta={mode === "queue" ? queueSummary(queue) : `${rows.length} ${rows.length === 1 ? (filter === "ideas" ? "idea" : "task") : (filter === "ideas" ? "ideas" : "tasks")}`}
          toolbar={mode === "backlog" ? (
            <div className="flex flex-col gap-1.5">
              <label className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2 transition-colors focus-within:border-accent-border">
                <Search className="h-3.5 w-3.5 text-text-muted" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a task" aria-label="Find a task" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
              </label>
              <SpineTabs label="Which tasks" value={filter} onChange={(f) => { setFilter(f); setSel(null); }} tabs={[{ id: "ideas", label: "Ideas", icon: Lightbulb }, { id: "done", label: "Done", icon: CheckCircle2 }, { id: "all", label: "All", icon: Layers }]} />
            </div>
          ) : undefined}
          phone={phone} phoneDetail={!!sel} onBack={() => setSel(null)} backLabel={mode === "queue" ? "Queue" : "Backlog"}
          detail={detail}>
          {list}
        </SideSpine>
      </div>}
    </div>
  );
}

/** A prompt on its way to the engine: routing, or not sent (with why). */
function PendingRow({ p, on, onSelect }: { p: Pending; on: boolean; onSelect: (id: string) => void }) {
  return (
    <button type="button" data-testid="work-pending-row" onClick={() => onSelect(p.id)}
      className={`flex w-full items-start gap-2 rounded-lg py-2 pl-7 pr-2 text-left transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/60"}`}>
      {p.error ? <AlertCircle className="mt-[3px] h-3.5 w-3.5 shrink-0 text-err" /> : <Loader2 className="mt-[3px] h-3.5 w-3.5 shrink-0 animate-spin text-accent" />}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 break-words text-[14px] font-medium leading-snug text-text-primary">{p.text}</span>
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

/**
 * The queue: one row per task, first runs first. Drag a row by its grip (a
 * line shows where it lands), or move it from the row's menu or with
 * Alt+Arrow Up/Down on the focused row.
 */
function QueueList({ tasks, pending, sel, machines, onSelect, onMove, dragging }: {
  tasks: QueueTask[]; pending: React.ReactNode[]; sel: string | null; machines: Machine[];
  onSelect: (id: string) => void; onMove: (id: string, at: number) => void; dragging: React.MutableRefObject<boolean>;
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
    <div data-testid="work-drop-indicator" aria-hidden className="relative h-0"><div className="absolute inset-x-2 -top-px h-0.5 rounded-full bg-accent" /></div>
  );
  return (
    <div ref={listRef} data-testid="work-queue-list" className="px-2 pb-3">
      {tasks.map((t, i) => {
        const I = STATUS_ICON[t.status];
        const on = sel === t.id;
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
            <div data-queue-row data-testid="work-queue-row" data-id={t.id} data-status={t.status}
              className={`group relative flex items-start gap-1 rounded-lg py-2 pl-1 pr-1 transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/60"} ${drag?.id === t.id ? "opacity-50" : ""}`}>
              <button type="button" data-rail-skip data-testid="work-drag" aria-label={`Drag to reorder: ${t.text}`} title="Drag to reorder"
                onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); dragging.current = true; setDrag({ id: t.id, at: i }); }}
                onPointerMove={(e) => { if (drag?.id === t.id) setDrag({ id: t.id, at: atFor(e.clientY) }); }}
                onPointerUp={() => end(true)} onPointerCancel={() => end(false)}
                className={`mt-0.5 flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-text-muted active:cursor-grabbing ${REVEAL}`}>
                <GripVertical className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => onSelect(t.id)}
                onKeyDown={(e) => {
                  if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                  e.preventDefault();
                  onMove(t.id, e.key === "ArrowUp" ? i - 1 : i + 2);
                }}
                title="Alt+Arrow Up or Down moves it"
                className="flex min-w-0 flex-1 items-start gap-2 text-left">
                <I className={`mt-[3px] h-3.5 w-3.5 shrink-0 ${TONE_TEXT[STATUS_TONE[t.status]]} ${t.status === "running" ? "animate-spin" : ""}`} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 break-words text-[14px] font-medium leading-snug text-text-primary">{t.text}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-text-muted">
                    {[STATUS_LABEL[t.status], t.dest?.label ?? "Not routed", t.agentKind, machineLabel(machines, t.machine)].join(" · ")}
                  </span>
                </span>
              </button>
              <span data-rail-skip className="shrink-0"><RowMenu items={items} reveal testId="work-row-menu" /></span>
            </div>
          </div>
        );
      })}
      {line(tasks.length)}
      {pending}
    </div>
  );
}

/** One task in the detail pane: its title, actions, chips, question, suggestions, and its run (job card or Herdr output) and log. */
function TaskRow({ t, machines, agentKinds, domains, host, busy, vault, run, onAddMachine }: {
  t: WorkTask; machines: Machine[]; agentKinds: string[]; domains: string[]; host: string; busy: string | null; vault: string;
  run: (key: string, cmd: string, args: Record<string, unknown>) => Promise<void>; onAddMachine: (m: Machine) => void;
}) {
  const act = (a: WorkAction | "continue-here" | "accept" | "decline", n?: number) => run(`${t.id}:${a}`, "engine_work_action", { id: t.id, action: a, ...(n !== undefined ? { n } : {}) });
  const route = (args: Record<string, unknown>) => run(`${t.id}:route`, "engine_work_route", { id: t.id, ...args });
  const answer = (a: string, workspace?: string) => run(`${t.id}:answer`, "engine_work_answer", { id: t.id, answer: a, ...(workspace ? { workspace } : {}) });
  const lease = leaseElsewhere(t, host);
  const [confirmTake, setConfirmTake] = useState(false);
  const mine = busy?.startsWith(`${t.id}:`) ?? false;
  const DestIcon = t.dest ? KIND_ICON[t.dest.kind] ?? Layers : Layers;
  const destItems: RowMenuItem[] = [
    ...(t.alternatives.length ? [{ kind: "heading" as const, label: "Suggested" }, ...t.alternatives.map((d): RowMenuItem => ({ icon: KIND_ICON[d.kind], label: d.label, hint: d.why, onClick: () => void route({ dest: `${d.kind}:${d.id}` }) }))] : []),
    ...(domains.length ? [{ kind: "heading" as const, label: "Domains" }, ...domains.filter((d) => !(t.dest?.kind === "domain" && t.dest.id === d)).map((d): RowMenuItem => ({ icon: Layers, label: titleCase(d), onClick: () => void route({ dest: `domain:${d}` }) }))] : []),
  ];
  const machineItems: RowMenuItem[] = machines.length === 0 ? [{ kind: "heading", label: "No other machines yet" }] : machines.map((m): RowMenuItem => canDispatchTo(m)
    ? { icon: tinted(machineLook(m).Icon, machineLook(m).color), label: m.label, hint: HERDR_STATE_LABEL[m.herdr], checked: m.label === t.machine, onClick: () => { if (m.label !== t.machine) void route({ machine: m.label }); } }
    : { icon: tinted(machineLook(m).Icon, machineLook(m).color), label: `Connect ${m.label}`, hint: HERDR_STATE_LABEL[m.herdr], onClick: () => onAddMachine(m) });
  const kindItems: RowMenuItem[] = agentKinds.map((k) => ({ icon: Bot, label: k, checked: k === t.agentKind, onClick: () => { if (k !== t.agentKind) void route({ agentKind: k }); } }));
  const acts = actionsFor(t);
  const more: RowMenuItem[] = [
    ...(t.dest ? [{ icon: ArrowUpRight, label: `Open ${t.dest.label}`, onClick: () => openDestination(t.dest!) }] : []),
    ...(t.status === "running" || t.status === "paused" ? [{ icon: Square, label: "Stop", danger: true, onClick: () => void act("stop") }] : []),
  ];
  const openSuggestions = t.suggestions.map((s, i) => ({ s, i })).filter(({ s }) => s.state === "open");
  return (
    <div data-testid="work-task" data-status={t.status} data-executor={t.executor} className="group">
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[17px] font-semibold leading-snug text-text-primary">{t.text}</h2>
        <div className="flex shrink-0 items-center gap-0.5">
          {mine && <Loader2 className="mx-1 h-3.5 w-3.5 animate-spin text-text-muted" />}
          {acts.map((a) => {
            const I = ACTION_ICON[a];
            return <button key={a} type="button" data-testid={`work-act-${a}`} disabled={mine} onClick={() => void act(a)} className={textBtn}>{I && <I className="h-3.5 w-3.5" />}{actionLabel(a, t)}</button>;
          })}
          {more.length > 0 && <RowMenu items={more} reveal />}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5">
        <StatusDot tone={STATUS_TONE[t.status]} label={STATUS_LABEL[t.status]} className="mr-1" />
        <RowMenu items={destItems.length ? destItems : [{ kind: "heading", label: "No other places yet" }]} label="Route to" testId="work-route"
          trigger={<>{t.dest ? <TintIcon icon={DestIcon} tint={t.dest.kind === "domain" ? t.dest.id : t.dest.kind} square={false} size={13} /> : <Layers className="h-3.5 w-3.5" />}<span className="truncate">{t.dest?.label ?? "Not routed"}</span></>}
          triggerClass={`${chip} font-medium`} />
        {t.dest && (
          <button type="button" data-testid="work-route-undo" onClick={() => void route({ undo: true })} title="Undo the route" aria-label="Undo the route" className={`${iconBtn} h-6 w-6 ${REVEAL}`}>
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
        <RowMenu items={kindItems} label="Agent" testId="work-agent" trigger={<><Bot className="h-3.5 w-3.5" />{t.agentKind}</>} triggerClass={chip} />
        <RowMenu items={machineItems} label="Machine" testId="work-task-machine" trigger={<>{(() => { const l = machineLook(machines.find((m) => m.label === t.machine) ?? { label: t.machine }); return <l.Icon className="h-3.5 w-3.5" style={{ color: l.color }} />; })()}{machineLabel(machines, t.machine)}</>} triggerClass={chip} />
        {t.specialists.length > 0 && (
          <span className="ml-1 flex items-center -space-x-1" title={t.specialists.map(titleCase).join(", ")}>
            {t.specialists.map((s) => <SpecialistAvatar key={s} id={s} size={20} state={t.status === "running" ? "working" : "idle"} label={titleCase(s)} />)}
          </span>
        )}
        {t.executor === "herdr" && <span className="ml-1 inline-flex items-center gap-1 text-[12px] text-text-muted"><img src="/herdr.png" alt="" className="h-3.5 w-3.5 rounded-[3px]" />{t.herdr?.workspaceLabel || "Herdr"}</span>}
      </div>

      {t.ask && <Ask t={t} vault={vault} machines={machines} answer={answer} onAddMachine={onAddMachine} busy={mine} />}

      {lease.elsewhere && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
          <span>On {machineLabel(machines, t.lease!.host)} now</span>
          {confirmTake ? (
            <><span className="text-text-secondary">Take it over here?</span>
              <button type="button" className={textBtn} onClick={() => { setConfirmTake(false); void act("continue-here"); }}>Yes</button>
              <button type="button" className={textBtn} onClick={() => setConfirmTake(false)}>Cancel</button></>
          ) : (
            <button type="button" data-testid="work-continue-here" className={textBtn} onClick={() => (lease.live ? setConfirmTake(true) : void act("continue-here"))}><Play className="h-3.5 w-3.5" />Continue here</button>
          )}
        </div>
      )}

      {openSuggestions.map(({ s, i }) => (
        <div key={i} data-testid="work-suggestion" className="mt-2 flex items-center gap-x-2 text-[13px]">
          <span className="shrink-0 text-text-muted">New {s.kind}:</span>
          <span className="shrink-0 font-medium text-text-primary">{s.name}</span>
          <span className="min-w-0 flex-1 truncate text-text-muted" title={s.why}>{s.why}</span>
          <button type="button" data-testid="work-suggest-accept" disabled={mine} onClick={() => void act("accept", i + 1)} className={textBtn}><Check className="h-3.5 w-3.5" />Accept</button>
          <button type="button" disabled={mine} onClick={() => void act("decline", i + 1)} className={textBtn}>Decline</button>
        </div>
      ))}

      <div data-testid="work-task-detail" className="mt-3">
        {t.executor === "engine" && t.jobId && <JobCard id={t.jobId} vaultPath={vault} embedded controls={false} />}
        {t.executor === "herdr" && (
          t.herdr?.lastRead
            ? <pre data-testid="work-herdr-output" className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg bg-surface-warm p-3 font-mono text-[12px] leading-relaxed text-text-secondary">{mirrorTail(t.herdr.lastRead)}</pre>
            : <p className={META}>Nothing from the Herdr tab yet.</p>
        )}
        {t.log.length > 0 && (
          <ol className="mt-3 space-y-1">
            {t.log.slice(-12).map((l, i) => (
              <li key={i} className="flex gap-2 text-[13px]">
                <span className="w-16 shrink-0 tabular-nums text-text-muted">{new Date(l.ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                <span className="text-text-secondary">{l.ev}{l.detail ? <span className="text-text-muted"> · {l.detail}</span> : null}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function Ask({ t, vault, machines, answer, onAddMachine, busy }: {
  t: WorkTask; vault: string; machines: Machine[]; answer: (a: string, workspace?: string) => Promise<void>; onAddMachine: (m: Machine) => void; busy: boolean;
}) {
  const ask = t.ask!;
  const [spaces, setSpaces] = useState<string[] | null>(null);
  useEffect(() => {
    if (ask.kind !== "herdr-workspace") return;
    invoke("engine_work_herdr_workspaces", { vault, machine: t.machine }).then((v) => setSpaces(asWorkspaces(v))).catch(() => setSpaces([]));
  }, [ask.kind, vault, t.machine]);
  const btn = (label: string, a: string, primary = false, workspace?: string) => (
    <button key={workspace ?? a} type="button" data-testid={`work-answer-${workspace ? "workspace" : a}`} disabled={busy} onClick={() => void answer(a, workspace)}
      className={primary ? "inline-flex h-7 items-center rounded-md bg-accent px-2.5 text-[13px] font-medium text-background disabled:opacity-40" : textBtn}>{label}</button>
  );
  const m = machines.find((x) => x.label === t.machine);
  return (
    <div data-testid="work-ask" data-kind={ask.kind} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-accent-soft/60 px-3 py-2 text-[13px]">
      <span className="min-w-0 flex-1 text-text-primary">{ask.detail}</span>
      {ask.kind === "start" && <>{btn("Start", "yes", true)}{btn("Not now", "no")}</>}
      {ask.kind === "keep-close" && <>{btn("Keep", "keep", true)}{btn("Close", "close")}</>}
      {ask.kind === "herdr-workspace" && <>
        {(spaces ?? []).map((s) => btn(s, "yes", false, s))}
        {btn(spaces?.length ? "Create one" : "Create it", "yes", true)}
        {btn("Not now", "no")}
      </>}
      {ask.kind === "machine-add" && <>
        {m && <button type="button" className="inline-flex h-7 items-center rounded-md bg-accent px-2.5 text-[13px] font-medium text-background" onClick={() => onAddMachine(m)}>Connect {m.label}</button>}
        {btn("Not now", "no")}
      </>}
    </div>
  );
}


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
