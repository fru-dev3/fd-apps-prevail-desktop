// The Work tab: one box to fire prompts into, not a chat. Each prompt becomes
// a card; the chief of staff splits it into goals and tasks, routes each one
// (domain, project, person, app, folder), staffs it and runs it, in the engine
// or in a Herdr tab. The queue holds open prompts, the backlog every task.
// Data: `prevail work ...` through bridge.ts (src-tauri/src/work.rs), polled
// while the tab is on screen.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppWindow, ArrowUpRight, Bot, CalendarDays, Check, Folder, FolderKanban, Layers, ListTodo, Loader2, Mic, Monitor, Pause, Play, Plug,
  RotateCcw, Search, Send, Square, TerminalSquare, User, X, type LucideIcon,
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
import { META, ROW_TITLE, SECTION_TITLE } from "./typescale";
import type { EngineApp } from "./types";
import { lsGet, lsSet } from "./storage";
import {
  ACTION_LABEL, actionsFor, asMachines, asPrompts, asSettings, asWorkspaces, backlog, canDispatchTo, engineLacksWork, groupByGoal, HERDR_STATE_LABEL,
  leaseElsewhere, machineAddCommand, machineLabel, mirrorTail, promptStatus, promptSummary, queuePrompts, STATUS_LABEL, STATUS_TONE,
  type BacklogFilter, type DestKind, type Destination, type Machine, type WorkAction, type WorkPrompt, type WorkSettings, type WorkTask,
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

export function WorkQueue({ vaultPath, active = true, domains = [], phone = false }: {
  vaultPath: string; active?: boolean; domains?: string[]; phone?: boolean;
}) {
  const vault = vaultPath;
  const [prompts, setPrompts] = useState<WorkPrompt[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tooOld, setTooOld] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<View>("queue");
  const [filter, setFilter] = useState<BacklogFilter>("open");
  const [query, setQuery] = useState("");
  const [selPrompt, setSelPrompt] = useState<string | null>(null);
  const [selTask, setSelTask] = useState<string | null>(null);
  const [settings, setSettings] = useState<WorkSettings>({ herdr: false });
  const [machinePick, setMachinePick] = useState(() => lsGet(MACHINE_KEY, ""));
  const [machines, setMachines] = useState<Machine[]>([]);
  const [agentKinds, setAgentKinds] = useState<string[]>([]);
  const [adding, setAdding] = useState<Machine | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!vault) return;
    try {
      const v = await invoke("engine_work_list", view === "backlog" ? { vault, all: true } : { vault });
      setPrompts(asPrompts(v)); setErr(null); setTooOld(false);
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
    invoke("engine_work_settings", { vault }).then((s) => setSettings(asSettings(s))).catch(() => {});
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
    setPending((p) => [card, ...p]);
    setSelPrompt(id); setSelTask(null); setView("queue");
    invoke<unknown>("engine_work_add", { vault, body: { text: body, surface: "desktop", ...(machines.length ? { machine: pick } : {}) } })
      .then((res) => {
        const added = asPrompts(res)[0];
        setPending((p) => p.filter((x) => x.id !== id));
        if (added) { setPrompts((ps) => [added, ...ps.filter((x) => x.id !== added.id)]); setSelPrompt((s) => (s === id ? added.id : s)); }
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
  const setMachine = (id: string) => { setMachinePick(id); lsSet(MACHINE_KEY, id); };

  const all: WorkPrompt[] = useMemo(() => [...pending, ...queuePrompts(prompts)], [pending, prompts]);
  const rows = view === "backlog" ? backlog(prompts, filter, query) : [];
  const shown = all.find((p) => p.id === selPrompt) ?? prompts.find((p) => p.id === selPrompt) ?? (view === "queue" ? all[0] : prompts.find((p) => p.id === rows[0]?.promptId)) ?? null;
  const curTask = selTask ?? (view === "backlog" ? rows[0]?.id ?? null : null);
  const needsYou = prompts.reduce((k, p) => k + p.tasks.filter((t) => t.status === "needs-you").length, 0);

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
          trigger={<><Monitor className="h-3.5 w-3.5" />{machineLabel(machines, pick)}</>}
          triggerClass="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-text-muted transition-colors hover:bg-surface-warm hover:text-text-secondary" />
        <span className="flex-1" />
        <SpineTabs label="Work view" value={view} onChange={(v) => { setView(v); setSelPrompt(null); setSelTask(null); }}
          tabs={[{ id: "queue", label: "Queue", icon: ListTodo }, { id: "backlog", label: "Backlog", icon: FolderKanban }]} />
      </div>
      {adding && <MachineAdd machine={adding} vault={vault} onDone={() => { setAdding(null); void loadMachines(); }} />}
    </div>
  );

  const list = view === "queue" ? (
    <div className="px-2 pb-3">
      {all.length === 0 && loaded && <p className="px-2 py-6 text-[13px] text-text-muted">Nothing in the queue. Send a prompt above.</p>}
      {all.map((p) => {
        const st = promptStatus(p);
        const pend = (p as Pending).pending ? (p as Pending) : null;
        const on = shown?.id === p.id;
        return (
          <button key={p.id} type="button" data-testid="work-prompt-row" onClick={() => { setSelPrompt(p.id); setSelTask(null); }}
            className={`flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/60"}`}>
            <span className="line-clamp-2 text-[14px] font-medium leading-snug text-text-primary">{p.text}</span>
            <span className="flex items-center gap-1.5">
              {pend ? (pend.error ? <StatusDot tone="err" label="Not sent" /> : <StatusDot tone="accent" label="Routing" />) : st && <StatusDot tone={STATUS_TONE[st]} label={promptSummary(p)} />}
            </span>
          </button>
        );
      })}
    </div>
  ) : (
    <div className="px-2 pb-3">
      {rows.length === 0 && loaded && <p className="px-2 py-6 text-[13px] text-text-muted">No tasks here.</p>}
      {rows.map((t) => (
        <button key={t.id} type="button" data-testid="work-backlog-row" onClick={() => { setSelPrompt(t.promptId); setSelTask(t.id); }}
          className={`flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors ${curTask === t.id ? "bg-surface-warm" : "hover:bg-surface-warm/60"}`}>
          <span className="line-clamp-2 text-[14px] font-medium leading-snug text-text-primary">{t.text}</span>
          <span className="flex min-w-0 items-center gap-1.5"><StatusDot tone={STATUS_TONE[t.status]} label={STATUS_LABEL[t.status]} />{t.dest && <span className="truncate text-[12px] text-text-muted">· {t.dest.label}</span>}</span>
        </button>
      ))}
    </div>
  );

  const detail = shown ? (
    <PromptDetail prompt={shown} pending={(shown as Pending).pending ? (shown as Pending) : null} selTask={curTask} onSelTask={setSelTask}
      machines={machines} agentKinds={agentKinds} domains={domains} host={current?.label ?? ""} busy={busy} vault={vault}
      run={run} onAddMachine={setAdding} />
  ) : (
    <div className="flex h-full items-center justify-center px-6 text-[14px] text-text-muted">{loaded ? "Send a prompt to start." : <Loader2 className="h-4 w-4 animate-spin" />}</div>
  );

  return (
    <div data-testid="work-queue" className="flex h-full min-h-0 flex-col">
      {composer}
      {err && <p data-testid="work-error" className="shrink-0 px-6 pt-2 text-[12px] text-err">{err}</p>}
      <div className="flex min-h-0 flex-1">
        <SideSpine storageKey="prevail.work.spine" title={view === "queue" ? "Queue" : "Backlog"} label="work" testId="work-spine"
          meta={view === "queue" ? `${all.length} ${all.length === 1 ? "prompt" : "prompts"}${needsYou ? ` · ${needsYou} need you` : ""}` : `${rows.length} ${rows.length === 1 ? "task" : "tasks"}`}
          toolbar={view === "backlog" ? (
            <div className="flex flex-col gap-1.5">
              <label className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2">
                <Search className="h-3.5 w-3.5 text-text-muted" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a task" aria-label="Find a task" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
              </label>
              <SpineTabs label="Task state" value={filter} onChange={setFilter} tabs={[{ id: "open", label: "Open" }, { id: "done", label: "Done" }, { id: "all", label: "All" }]} />
            </div>
          ) : undefined}
          phone={phone} phoneDetail={!!selPrompt} onBack={() => setSelPrompt(null)} backLabel="Queue"
          detail={detail}>
          {list}
        </SideSpine>
      </div>
    </div>
  );
}

function PromptDetail({ prompt, pending, selTask, onSelTask, machines, agentKinds, domains, host, busy, vault, run, onAddMachine }: {
  prompt: WorkPrompt; pending: Pending | null; selTask: string | null; onSelTask: (id: string | null) => void;
  machines: Machine[]; agentKinds: string[]; domains: string[]; host: string; busy: string | null; vault: string;
  run: (key: string, cmd: string, args: Record<string, unknown>) => Promise<void>; onAddMachine: (m: Machine) => void;
}) {
  const open = selTask ?? prompt.tasks[0]?.id ?? null;
  return (
    <div data-testid="work-prompt" className="min-w-0 px-4 py-4 sm:px-6">
      <p className="whitespace-pre-wrap break-words text-[17px] font-semibold leading-snug text-text-primary">{prompt.text}</p>
      <p className={`mt-1 ${META}`}>{[titleCase(prompt.surface), machineLabel(machines, prompt.machine), ago(prompt.ts)].join(" · ")}</p>
      {pending && (
        <p className="mt-4 flex items-center gap-2 text-[14px] text-text-muted">
          {pending.error ? <span className="text-err">{pending.error}</span> : <><Loader2 className="h-4 w-4 animate-spin" />The chief of staff is routing this.</>}
        </p>
      )}
      {groupByGoal(prompt.tasks).map((g) => (
        <section key={g.goal} className="mt-5">
          {/* A goal that is just its one task says it once. */}
          {!(g.tasks.length === 1 && g.tasks[0]!.text === g.goal) && <h3 className={`${SECTION_TITLE} text-text-secondary`}>{g.goal}</h3>}
          <div className="mt-1.5 border-l border-border-subtle pl-3">
            {g.tasks.map((t) => (
              <TaskRow key={t.id} t={t} open={open === t.id} onOpen={() => onSelTask(open === t.id ? "" : t.id)}
                machines={machines} agentKinds={agentKinds} domains={domains} host={host} busy={busy} vault={vault} run={run} onAddMachine={onAddMachine} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TaskRow({ t, open, onOpen, machines, agentKinds, domains, host, busy, vault, run, onAddMachine }: {
  t: WorkTask; open: boolean; onOpen: () => void; machines: Machine[]; agentKinds: string[]; domains: string[]; host: string; busy: string | null; vault: string;
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
    <div data-testid="work-task" data-status={t.status} data-executor={t.executor} className="group border-b border-border-subtle py-2.5 last:border-b-0">
      <div className="flex items-start gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className={`${ROW_TITLE} line-clamp-2 break-words`}>{t.text}</span>
        </button>
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

      {open && (
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
      )}
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
