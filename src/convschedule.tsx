// Conversation schedules: run a prompt as a new turn in THIS conversation on a
// timer, so the answer lands in the thread you asked it in. The chat header's
// Schedule action opens SchedulePanel in the flow above the transcript: it
// lists this conversation's schedules (run now, pause or resume, remove) above
// the form that adds one. The engine owns the schedule file and fires it on
// the hub machine only.
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Loader2, Pause, Play, RotateCw, Trash2, X } from "lucide-react";
import { invoke } from "./bridge";
import { relTime } from "./format";
import { RowAction } from "./rowaction";

export type Frequency = "daily" | "weekdays" | "weekly" | "custom";
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Map a friendly pick to a 5-field cron. "HH:MM" local time; weekday 0 = Sunday. */
export function toCron(freq: Frequency, time: string, weekday = 1, custom = ""): string | null {
  if (freq === "custom") {
    const c = custom.trim().replace(/\s+/g, " ");
    return c.split(" ").length === 5 ? c : null;
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  if (freq === "daily") return `${min} ${h} * * *`;
  if (freq === "weekdays") return `${min} ${h} * * 1-5`;
  const d = Math.max(0, Math.min(6, Math.floor(weekday)));
  return `${min} ${h} * * ${d}`;
}

/** A short plain reading of the crons this page writes; anything else as is. */
export function describeCron(cron: string): string {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return cron;
  const [min, h, dom, mon, dow] = p;
  if (!/^\d+$/.test(min) || !/^\d+$/.test(h) || dom !== "*" || mon !== "*") return cron;
  const hh = Number(h); const mm = Number(min);
  const t = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
  if (dow === "*") return `Daily at ${t}`;
  if (dow === "1-5") return `Weekdays at ${t}`;
  if (/^[0-6]$/.test(dow)) return `${WEEKDAYS[Number(dow)]}s at ${t}`;
  return cron;
}

export type ScheduleEntry = {
  id: string;
  name: string;
  cron: string;
  command?: string;
  enabled: boolean;
  last_run: number | null;
  next_run?: number | null;
  created_at?: number;
  thread?: { domain: string; session: string };
  prompt?: string;
};

export function normalizeList(raw: unknown): ScheduleEntry[] {
  const arr = Array.isArray(raw) ? raw : Array.isArray((raw as { schedules?: unknown })?.schedules) ? (raw as { schedules: unknown[] }).schedules : [];
  return (arr as ScheduleEntry[]).filter((s) => s && typeof s.id === "string");
}

// The schedule form, in the flow of the chat (never a pop-up).
export function SchedulePanel({ vaultPath, domain, session, defaultPrompt, onClose }: {
  vaultPath: string;
  // The engine's domain for this chat ("general" for General).
  domain: string;
  // The thread's id (its slug).
  session: string;
  defaultPrompt: string;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [freq, setFreq] = useState<Frequency>("daily");
  const [time, setTime] = useState("08:00");
  const [weekday, setWeekday] = useState(1);
  const [custom, setCustom] = useState("0 8 * * *");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const cron = toCron(freq, time, weekday, custom);
  const save = async () => {
    if (!cron || !prompt.trim()) return;
    setBusy(true); setErr(null);
    try {
      const name = prompt.trim().replace(/\s+/g, " ").slice(0, 60);
      await invoke("engine_schedule_thread_add", { vault: vaultPath, domain, session, prompt: prompt.trim(), cron, name });
      setSaved(describeCron(cron));
      window.dispatchEvent(new Event("prevail:schedules-changed"));
    } catch (e) {
      setErr(`Could not schedule: ${String(e)}`);
    } finally { setBusy(false); }
  };
  const FREQS: Array<[Frequency, string]> = [["daily", "Daily"], ["weekdays", "Weekdays"], ["weekly", "Weekly"], ["custom", "Custom"]];
  return (
    <div data-testid="schedule-panel" className="shrink-0 border-b border-border-subtle bg-surface px-4 py-4">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-3 flex items-center gap-2.5">
          <CalendarClock className="h-5 w-5 shrink-0 text-accent" />
          <h3 className="flex-1 text-[15px] font-semibold text-text-primary">Schedule this conversation</h3>
          <button onClick={onClose} title="Close" aria-label="Close schedule"
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-text-primary">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ThreadSchedules vaultPath={vaultPath} domain={domain} session={session} />
        {saved ? (
          <div className="flex items-center gap-3 text-sm text-text-secondary">
            <span data-testid="schedule-saved">Scheduled: {saved}. Replies land in this thread.</span>
            <button onClick={onClose} className="ml-auto rounded-md border border-border px-2.5 py-1 text-[13px] text-text-secondary hover:border-accent-border hover:text-accent">Done</button>
          </div>
        ) : (
          <>
            <label className="mb-1 block text-[13px] font-medium text-text-secondary" htmlFor="schedule-prompt">Prompt</label>
            <textarea id="schedule-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2}
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none" />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="flex overflow-hidden rounded-lg border border-border" role="radiogroup" aria-label="How often">
                {FREQS.map(([k, label], i) => (
                  <button key={k} role="radio" aria-checked={freq === k} onClick={() => setFreq(k)}
                    className={`px-3 py-1.5 text-[13px] font-medium transition-colors ${i > 0 ? "border-l border-border" : ""} ${freq === k ? "bg-accent text-background" : "bg-background text-text-secondary hover:bg-surface-warm"}`}>
                    {label}
                  </button>
                ))}
              </div>
              {freq === "weekly" && (
                <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} aria-label="Day"
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-[13px] text-text-primary focus:border-accent-border focus:outline-none">
                  {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              )}
              {freq === "custom" ? (
                <input value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Cron" placeholder="0 8 * * *"
                  className="w-40 rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-[13px] text-text-primary focus:border-accent-border focus:outline-none" />
              ) : (
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time"
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-[13px] text-text-primary focus:border-accent-border focus:outline-none" />
              )}
              <span className="text-[13px] text-text-muted">{cron ? describeCron(cron) : "Needs five cron fields"}</span>
              <button onClick={() => void save()} disabled={busy || !cron || !prompt.trim()} data-testid="schedule-save"
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-background hover:bg-accent-hover disabled:opacity-50">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />} Schedule
              </button>
            </div>
            {err && <div className="mt-2 text-[13px] text-err">{err}</div>}
          </>
        )}
      </div>
    </div>
  );
}

// This conversation's schedules, each with tiny icon actions: run now, pause
// or resume, remove. Nothing renders until there is one.
export function ThreadSchedules({ vaultPath, domain, session }: { vaultPath: string; domain: string; session: string }) {
  const [list, setList] = useState<ScheduleEntry[] | null>(null);
  const load = useCallback(() => {
    invoke<unknown>("engine_schedule_list", { vault: vaultPath })
      .then((r) => setList(normalizeList(r)))
      .catch(() => setList([]));
  }, [vaultPath]);
  useEffect(() => {
    load();
    window.addEventListener("prevail:schedules-changed", load);
    return () => window.removeEventListener("prevail:schedules-changed", load);
  }, [load]);
  const mine = useMemo(
    () => (list ?? []).filter((s) => s.thread?.session === session && (s.thread.domain || "general") === (domain || "general")),
    [list, session, domain],
  );
  if (mine.length === 0) return null;

  const toggle = async (s: ScheduleEntry) => {
    await invoke("engine_schedule_set_enabled", { vault: vaultPath, id: s.id, enabled: !s.enabled });
    setList((cur) => (cur ?? []).map((x) => (x.id === s.id ? { ...x, enabled: !s.enabled } : x)));
  };
  // Run it now; the reply lands in this thread.
  const runNow = async (s: ScheduleEntry) => {
    const r = await invoke<{ ok?: boolean; error?: string }>("engine_schedule_run", { vault: vaultPath, id: s.id });
    if (r && r.ok === false) throw new Error(r.error || "run failed");
    load();
  };
  const remove = async (s: ScheduleEntry) => {
    await invoke("engine_schedule_remove", { vault: vaultPath, id: s.id });
    setList((cur) => (cur ?? []).filter((x) => x.id !== s.id));
  };

  return (
    <div data-testid="thread-schedules" className="mb-4 divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle">
      {mine.map((s) => (
        <div key={s.id} data-schedule={s.id} className="flex items-center gap-3 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className={`truncate text-sm font-medium ${s.enabled ? "text-text-primary" : "text-text-muted"}`}>{s.prompt || s.name}</div>
            <div className="mt-0.5 text-xs text-text-muted">
              {describeCron(s.cron)}
              {!s.enabled && " · paused"}
              {s.enabled && s.next_run ? ` · next ${new Date(s.next_run).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}
              {s.last_run ? ` · last ran ${relTime(s.last_run)}` : ""}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <RowAction icon={RotateCw} label="Run now" doneLabel="Ran" onClick={() => runNow(s)} />
            <RowAction icon={s.enabled ? Pause : Play} label={s.enabled ? "Pause" : "Resume"} onClick={() => toggle(s)} />
            <RowAction icon={Trash2} label="Remove" doneLabel="Removed" onClick={() => remove(s)} />
          </div>
        </div>
      ))}
    </div>
  );
}
