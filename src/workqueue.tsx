// The Work tab: one box to fire prompts into, not a chat. The chief of staff
// splits each prompt into goals and tasks, routes each one (domain, project,
// person, app, folder), staffs it and runs it, in the engine or in a Herdr
// tab. The queue is one ordered list of open tasks, newest at the bottom, that
// the user drags to reorder; the engine runs them in that order, several at
// once. The backlog holds every task. A task's detail shows the prompt it came from.
// Data: `prevail work ...` through bridge.ts (src-tauri/src/work.rs), polled
// while the tab is on screen.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle, AppWindow, ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpRight, ArrowUpToLine, Bot, CalendarDays, Check, CheckCircle2, Circle, Clock, Folder,
  FolderKanban, Gauge, GripVertical, Hand, Layers, ListTodo, Loader2, Mic, Monitor, Pause, Play, Plug, RotateCcw, Search, Send, Square, TerminalSquare, User, X,
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
  leaseElsewhere, machineAddCommand, machineLabel, mirrorTail, moveInQueue, queueSummary, STATUS_LABEL, STATUS_TONE,
  type BacklogFilter, type DestKind, type Destination, type Machine, type QueueTask, type WorkAction, type WorkPrompt, type WorkSettings, type WorkStatus, type WorkTask,
} from "./workqueuemodel";

const POLL_MS = 3_000;
// Which Mac new work goes to, remembered on this device (the engine keeps no default).
const MACHINE_KEY = "prevail.work.machine";
const KIND_ICON: Record<DestKind, LucideIcon> = { domain: Layers, project: FolderKanban, entity: User, event: CalendarDays, app: Plug, folder: Folder };
const chip = "inline-flex max-w-[16rem] items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-text-secondary transition-colors hover:bg-surface-warm hover:text-text-primary";
const textBtn = "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";
const iconBtn = "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";
const ACTION_ICON: Partial<Record<WorkAction, LucideIcon>> = { pause: Pause, continue: Play, start: Play, stop: Square, keep: Check, close: X, reopen: RotateCcw };

type Pending = WorkPrompt & { pending: true; error?: string };
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
  routed: Circle, queued: Clock, "needs-you": Hand, running: Loader2, paused: Pause, done: CheckCircle2, failed: AlertCircle, closed: X,
};
const TONE_TEXT = { ok: "text-ok", warn: "text-warn", err: "text-err", accent: "text-accent", muted: "text-text-muted" } as const;
const RUN_AT_ONCE = [1, 2, 3, 4, 5, 6];

export function WorkQueue({ vaultPath, active = true, domains = [], phone = false }: {
  vaultPath: string; active?: boolean; domains?: string[]; phone?: boolean;
}) {
  const vault = vaultPath;
  // The queue: open tasks in the engine's order, first runs first, newest at the bottom.
  const [queue, setQueue] = useState<QueueTask[]>([]);
  // Every prompt and its tasks, for the backlog.
  const [prompts, setPrompts] = useState<WorkPrompt[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tooOld, setTooOld] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<View>("queue");
  const [filter, setFilter] = useState<BacklogFilter>("open");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [settings, setSettings] = useState<WorkSettings>({ herdr: false });
  const [machinePick, setMachinePick] = useState(() => lsGet(MACHINE_KEY, ""));
  const [machines, setMachines] = useState<Machine[]>([]);
  const [agentKinds, setAgentKinds] = useState<string[]>([]);
  const [adding, setAdding] = useState<Machine | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // While a row is dragged, a poll must not reorder the list under the pointer.
  const dragging = useRef(false);

  const refresh = useCallback(async () => {
    if (!vault) return;
    try {
      const v = await invoke("engine_work_list", view === "backlog" ? { vault, all: true } : { vault });
      if (view === "backlog") setPrompts(asPrompts(v));
      else if (!dragging.current) {
        setQueue(asQueue(v));
        const mr = (v as { maxRunning?: unknown } | null)?.maxRunning;
        if (typeof mr === "number") setSettings((s) => ({ ...s, maxRunning: mr }));
      }
      setErr(null); setTooOld(false);
    } catch (e) {
      if (engineLacksWork(e)) setTooOld(true); else setErr(String(e));
    } finally { setLoaded(true); }
  }, [vault, view]);

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

  // ── composer ──
  const [text, setText] = useState("");
  const base = useRef("");
  const dict = useDictation((t, final) => { setText((base.current ? base.current + " " : "") + t); if (final) base.current = ""; });
  const n = useRef(0);
  const send = () => {
    const body = text.trim();
    if (!body) return;
    if (dict.state === "listening") dict.stop();
    setText(""); base.current = "";
    const id = `pending-${++n.current}`;
    const card: Pending = { id, ts: Date.now(), text: body, surface: "desktop", machine: pick, tasks: [], pending: true };
    // New work goes to the bottom of the queue.
    setPending((p) => [...p, card]);
    setView("queue");
    invoke<unknown>("engine_work_add", { vault, body: { text: body, surface: "desktop", ...(machines.length ? { machine: pick } : {}) } })
      .then((res) => {
        const added = asPrompts(res)[0];
        setPending((p) => p.filter((x) => x.id !== id));
        if (added) {
          const rows = asQueue({ prompts: [added] });
          setQueue((q) => [...q.filter((t) => !rows.some((r) => r.id === t.id)), ...rows]);
          setSel((s) => (s === id ? rows[0]?.id ?? null : s));
        }
        void refresh();
      })
      .catch((e) => setPending((p) => p.map((x) => (x.id === id ? { ...x, error: engineLacksWork(e) ? "Update the engine to use Work mode" : String(e) } : x))));
  };

  // ── actions ──
  const run = async (key: string, cmd: string, args: Record<string, unknown>) => {
    setBusy(key); setErr(null);
    try { await invoke(cmd, { vault, ...args }); await refresh(); }
    catch (e) { setErr(String(e)); }
    finally { setBusy(null); }
  };
  const setHerdr = (on: boolean) => { setSettings((s) => ({ ...s, herdr: on })); void run("settings", "engine_work_settings", { herdr: on }); };
  const setMaxRunning = (k: number) => { setSettings((s) => ({ ...s, maxRunning: k })); void run("settings", "engine_work_settings", { maxRunning: k }); };
  const setMachine = (id: string) => { setMachinePick(id); lsSet(MACHINE_KEY, id); };
  /** Move a task to insertion point `at`: the list moves at once, the engine keeps the order. */
  const move = (id: string, at: number) => {
    const r = moveInQueue(queue, id, at);
    if (!r) return;
    setQueue(r.list);
    void run(`${id}:reorder`, "engine_work_reorder", { id, ...r.args });
  };

  const rows = view === "backlog" ? backlog(prompts, filter, query) : [];
  const pendingShown = pending.find((p) => p.id === sel) ?? null;
  const shownId = view === "queue" ? (pendingShown ? null : sel && queue.some((t) => t.id === sel) ? sel : queue[0]?.id ?? null) : sel ?? rows[0]?.id ?? null;
  const shown: QueueTask | null = view === "queue"
    ? queue.find((t) => t.id === shownId) ?? null
    : (() => { const p = prompts.find((x) => x.tasks.some((t) => t.id === shownId)); const t = p?.tasks.find((x) => x.id === shownId); return p && t ? { ...t, prompt: { id: p.id, ts: p.ts, text: p.text, surface: p.surface } } : null; })();
  // The tasks the shown one's prompt made, so the detail shows where it came from.
  const siblings = shown ? (view === "queue" ? queue : prompts.find((p) => p.id === shown.promptId)?.tasks ?? []).filter((t) => t.promptId === shown.promptId) : [];

  if (tooOld) {
    return (
      <div data-testid="work-too-old" className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <TintIcon icon={ListTodo} tint="tasks" lg />
        <p className="mt-2 text-[17px] font-semibold text-text-primary">Update the engine to use Work mode</p>
        <p className="max-w-md text-[14px] text-text-muted">This version of the engine does not have the work queue yet. Update Prevail, then come back here.</p>
      </div>
    );
  }

  const machineItems: RowMenuItem[] = [
    { kind: "heading", label: "Send work to" },
    ...(machines.length === 0 ? [{ kind: "heading" as const, label: "Only this Mac for now" }] : machines.map((m): RowMenuItem => canDispatchTo(m)
      ? { label: m.label, hint: [m.role ? titleCase(m.role) : "", HERDR_STATE_LABEL[m.herdr]].filter(Boolean).join(" · "), icon: Monitor, checked: m.label === pick, onClick: () => setMachine(m.label) }
      : { label: `Connect ${m.label}`, hint: [m.role ? titleCase(m.role) : "", HERDR_STATE_LABEL[m.herdr]].filter(Boolean).join(" · "), icon: Plug, onClick: () => setAdding(m) })),
  ];
  const atOnce = settings.maxRunning ?? 3;
  const atOnceItems: RowMenuItem[] = [
    { kind: "heading", label: "Tasks running at once" },
    ...RUN_AT_ONCE.map((k): RowMenuItem => ({ label: String(k), checked: k === atOnce, onClick: () => { if (k !== atOnce) setMaxRunning(k); } })),
  ];
  const chromeBtn = "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-text-muted transition-colors hover:bg-surface-warm hover:text-text-secondary";

  const composer = (
    <div className="shrink-0 border-b border-border px-4 pb-3 pt-3 sm:px-6">
      <div className="flex items-end gap-2 rounded-xl border border-border bg-surface px-3 py-2 focus-within:border-accent-border">
        <textarea data-testid="work-input" value={text} rows={Math.min(6, Math.max(1, text.split("\n").length))}
          onChange={(e) => { setText(e.target.value); base.current = e.target.value; }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
          placeholder="Say or type what needs doing. Several things at once is fine."
          aria-label="New work" className="min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[15px] leading-relaxed text-text-primary outline-none placeholder:text-text-muted" />
        {dict.supported && (
          <button type="button" data-testid="work-mic" onClick={() => (dict.state === "listening" ? dict.stop() : void dict.start())} disabled={dict.state === "transcribing"}
            title={dict.state === "listening" ? "Stop" : "Dictate"} aria-label={dict.state === "listening" ? "Stop dictating" : "Dictate"}
            className={`${iconBtn} h-8 w-8 ${dict.state === "listening" ? "bg-accent-soft text-accent" : ""}`}>
            {dict.state === "transcribing" ? <Loader2 className="h-4 w-4 animate-spin" /> : dict.state === "listening" ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
          </button>
        )}
        <button type="button" data-testid="work-send" onClick={send} disabled={!text.trim()} title="Send (Enter)" aria-label="Send"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-background transition-opacity disabled:opacity-30">
          <Send className="h-4 w-4" />
        </button>
      </div>
      {dict.err && <p className="mt-1 text-[12px] text-warn">{dict.err}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button type="button" data-testid="work-herdr" aria-pressed={settings.herdr} onClick={() => setHerdr(!settings.herdr)}
          title={settings.herdr ? "Herdr is on: work runs in a Herdr tab" : "Herdr is off: the engine runs the work"}
          className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] transition-colors ${settings.herdr ? "bg-accent-soft font-medium text-accent" : "text-text-muted hover:bg-surface-warm hover:text-text-secondary"}`}>
          <TerminalSquare className="h-3.5 w-3.5" />Herdr{settings.herdr ? " on" : " off"}
        </button>
        <RowMenu items={machineItems} label="Machine" testId="work-machine"
          trigger={<><Monitor className="h-3.5 w-3.5" />{machineLabel(machines, pick)}</>} triggerClass={chromeBtn} />
        <RowMenu items={atOnceItems} label="Tasks running at once" testId="work-at-once"
          trigger={<><Gauge className="h-3.5 w-3.5" />{atOnce} at once</>} triggerClass={chromeBtn} />
        <span className="flex-1" />
        <SpineTabs label="Work view" value={view} onChange={(v) => { setView(v); setSel(null); }}
          tabs={[{ id: "queue", label: "Queue", icon: ListTodo }, { id: "backlog", label: "Backlog", icon: FolderKanban }]} />
      </div>
      {adding && <MachineAdd machine={adding} vault={vault} onDone={() => { setAdding(null); void loadMachines(); }} />}
    </div>
  );

  const list = view === "queue" ? (
    <QueueList tasks={queue} pending={pending} sel={pendingShown ? pendingShown.id : shownId} loaded={loaded} machines={machines}
      onSelect={setSel} onMove={move} dragging={dragging} />
  ) : (
    <div className="px-2 pb-3">
      {rows.length === 0 && loaded && <p className="px-2 py-6 text-[13px] text-text-muted">No tasks here.</p>}
      {rows.map((t) => (
        <button key={t.id} type="button" data-testid="work-backlog-row" onClick={() => setSel(t.id)}
          className={`flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors ${shownId === t.id ? "bg-surface-warm" : "hover:bg-surface-warm/60"}`}>
          <span className="line-clamp-2 text-[14px] font-medium leading-snug text-text-primary">{t.text}</span>
          <span className="flex min-w-0 items-center gap-1.5"><StatusDot tone={STATUS_TONE[t.status]} label={STATUS_LABEL[t.status]} />{t.dest && <span className="truncate text-[12px] text-text-muted">· {t.dest.label}</span>}</span>
        </button>
      ))}
    </div>
  );

  const detail = pendingShown ? (
    <div data-testid="work-pending" className="min-w-0 px-4 py-4 sm:px-6">
      <p className="whitespace-pre-wrap break-words text-[17px] font-semibold leading-snug text-text-primary">{pendingShown.text}</p>
      <p className="mt-3 flex items-center gap-2 text-[14px] text-text-muted">
        {pendingShown.error ? <span className="text-err">{pendingShown.error}</span> : <><Loader2 className="h-4 w-4 animate-spin" />The chief of staff is routing this.</>}
      </p>
    </div>
  ) : shown ? (
    <div data-testid="work-detail" className="min-w-0 px-4 py-4 sm:px-6">
      <TaskRow key={shown.id} t={shown} machines={machines} agentKinds={agentKinds} domains={domains} host={current?.label ?? ""} busy={busy} vault={vault}
        run={run} onAddMachine={setAdding} />
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
    <div className="flex h-full items-center justify-center px-6 text-[14px] text-text-muted">{loaded ? "Send a prompt to start." : <Loader2 className="h-4 w-4 animate-spin" />}</div>
  );

  return (
    <div data-testid="work-queue" className="flex h-full min-h-0 flex-col">
      {composer}
      {err && <p data-testid="work-error" className="shrink-0 px-6 pt-2 text-[12px] text-err">{err}</p>}
      <div className="flex min-h-0 flex-1">
        <SideSpine storageKey="prevail.work.spine" wide title={view === "queue" ? "Queue" : "Backlog"} label="work" testId="work-spine"
          meta={view === "queue" ? queueSummary(queue) : `${rows.length} ${rows.length === 1 ? "task" : "tasks"}`}
          toolbar={view === "backlog" ? (
            <div className="flex flex-col gap-1.5">
              <label className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2">
                <Search className="h-3.5 w-3.5 text-text-muted" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a task" aria-label="Find a task" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
              </label>
              <SpineTabs label="Task state" value={filter} onChange={setFilter} tabs={[{ id: "open", label: "Open" }, { id: "done", label: "Done" }, { id: "all", label: "All" }]} />
            </div>
          ) : undefined}
          phone={phone} phoneDetail={!!sel} onBack={() => setSel(null)} backLabel={view === "queue" ? "Queue" : "Backlog"}
          detail={detail}>
          {list}
        </SideSpine>
      </div>
    </div>
  );
}

/**
 * The queue: one row per task, first runs first. Drag a row by its grip (a
 * line shows where it lands), or move it from the row's menu or with
 * Alt+Arrow Up/Down on the focused row.
 */
function QueueList({ tasks, pending, sel, loaded, machines, onSelect, onMove, dragging }: {
  tasks: QueueTask[]; pending: Pending[]; sel: string | null; loaded: boolean; machines: Machine[];
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
      {tasks.length === 0 && pending.length === 0 && loaded && <p className="px-2 py-6 text-[13px] text-text-muted">Nothing in the queue. Send a prompt above.</p>}
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
      {pending.map((p) => (
        <button key={p.id} type="button" data-testid="work-pending-row" onClick={() => onSelect(p.id)}
          className={`flex w-full items-start gap-2 rounded-lg py-2 pl-7 pr-2 text-left transition-colors ${sel === p.id ? "bg-surface-warm" : "hover:bg-surface-warm/60"}`}>
          {p.error ? <AlertCircle className="mt-[3px] h-3.5 w-3.5 shrink-0 text-err" /> : <Loader2 className="mt-[3px] h-3.5 w-3.5 shrink-0 animate-spin text-accent" />}
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 break-words text-[14px] font-medium leading-snug text-text-primary">{p.text}</span>
            <span className="mt-0.5 block text-[12px] text-text-muted">{p.error ? "Not sent" : "Routing"}</span>
          </span>
        </button>
      ))}
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
    ? { icon: Monitor, label: m.label, hint: HERDR_STATE_LABEL[m.herdr], checked: m.label === t.machine, onClick: () => { if (m.label !== t.machine) void route({ machine: m.label }); } }
    : { icon: Plug, label: `Connect ${m.label}`, hint: HERDR_STATE_LABEL[m.herdr], onClick: () => onAddMachine(m) });
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
            return <button key={a} type="button" data-testid={`work-act-${a}`} disabled={mine} onClick={() => void act(a)} className={textBtn}>{I && <I className="h-3.5 w-3.5" />}{ACTION_LABEL[a]}</button>;
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
        <RowMenu items={machineItems} label="Machine" testId="work-task-machine" trigger={<><Monitor className="h-3.5 w-3.5" />{machineLabel(machines, t.machine)}</>} triggerClass={chip} />
        {t.specialists.length > 0 && (
          <span className="ml-1 flex items-center -space-x-1" title={t.specialists.map(titleCase).join(", ")}>
            {t.specialists.map((s) => <SpecialistAvatar key={s} id={s} size={20} state={t.status === "running" ? "working" : "idle"} label={titleCase(s)} />)}
          </span>
        )}
        {t.executor === "herdr" && <span className="ml-1 inline-flex items-center gap-1 text-[12px] text-text-muted"><TerminalSquare className="h-3.5 w-3.5" />{t.herdr?.workspaceLabel || "Herdr"}</span>}
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

/** Connect a Mac to Herdr: the command is shown, the user types the SSH target and confirms. Nothing runs before that. */
function MachineAdd({ machine, vault, onDone }: { machine: Machine; vault: string; onDone: () => void }) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true); setErr(null);
    try { await invoke("engine_work_machine_add", { vault, label: machine.label, target: target.trim() }); onDone(); }
    catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  };
  return (
    <div data-testid="work-machine-add" className="mt-2 rounded-lg border border-border-subtle bg-surface px-3 py-2.5">
      <div className="flex items-start gap-2">
        <AppWindow className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-text-primary">{machine.label} is not connected to Herdr</p>
          <p className="mt-0.5 text-[13px] text-text-muted">Connecting runs this once on this Mac:</p>
          <code data-testid="work-machine-add-command" className="mt-1.5 block overflow-x-auto whitespace-nowrap rounded-md bg-surface-warm px-2 py-1 font-mono text-[12px] text-text-secondary">{machineAddCommand(machine, target)}</code>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder={machine.hostname ? `SSH target, like ${machine.hostname}` : "SSH target"} aria-label="SSH target"
              className="h-8 min-w-[12rem] flex-1 rounded-md border border-border bg-background px-2 text-[13px] outline-none focus:border-accent-border" />
            <button type="button" data-testid="work-machine-add-confirm" disabled={busy || !target.trim()} onClick={() => void confirm()}
              className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-[13px] font-medium text-background disabled:opacity-40">Connect</button>
            <button type="button" onClick={onDone} className={textBtn}>Cancel</button>
          </div>
          {err && <p className="mt-1 text-[12px] text-err">{err}</p>}
        </div>
      </div>
    </div>
  );
}
