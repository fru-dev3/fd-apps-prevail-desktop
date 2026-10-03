// Events (Activities > Events): dated happenings, first class. The list sits
// in the SideSpine column; the detail column opens on a week strip of the
// calendar (event pages, the connected calendar, every project's dated
// milestones and holds, from `entities events`) over the picked event: its
// chat, links, notes and files, like any entity. A calendar entry, a
// milestone or a hold becomes an event page the first time it is opened, so
// anything on the strip can be talked to. New events are made by talking.
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Flag, Loader2, Plus } from "lucide-react";
import { invoke } from "./bridge";
import { useInvokeQuery } from "./query";
import { SideSpine } from "./sidespine";
import { useIsPhone, useStacked } from "./useisphone";
import { EntityDetailView } from "./entitydetail";
import { NewObject } from "./newobject";
import { peekRequestedEntity, registerEntitiesView, takeRequestedEntity } from "./entitystore";
import { fmtDay, takeNew, todayYmd, type EventRow } from "./ia";
import { META } from "./typescale";

export const EVENTS_CHANGED = "prevail:events-changed";
const DAY = 864e5;
const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const atNoon = (ymd: string) => new Date(`${ymd}T12:00:00`);
/** Monday of the week holding `ymd`. */
const weekStart = (ymd: string) => { const d = atNoon(ymd); const back = (d.getDay() + 6) % 7; return ymdOf(new Date(d.getTime() - back * DAY)); };
const addDays = (ymd: string, n: number) => ymdOf(new Date(atNoon(ymd).getTime() + n * DAY));

const SOURCE_NOTE: Record<EventRow["source"], (e: EventRow) => string> = {
  prevail: (e) => (e.project ? e.project.name : ""),
  calendar: (e) => `From your calendar${e.account ? ` (${e.account})` : ""}`,
  milestone: (e) => `Milestone of ${e.project?.name ?? "a project"}`,
  hold: (e) => `A hold for ${e.project?.name ?? "a project"}`,
};

function metaOf(e: EventRow): string {
  return [fmtDay(e.date) || "No date yet", e.time, e.place?.name, SOURCE_NOTE[e.source](e)].filter(Boolean).join(" · ");
}

/** The week strip: seven days, each with its events; arrows move a week. */
export function CalendarStrip({ rows, selected, onPick }: { rows: EventRow[]; selected: string | null; onPick: (e: EventRow) => void }) {
  const phone = useIsPhone();
  const today = todayYmd();
  const [start, setStart] = useState(() => weekStart(today));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const byDay = useMemo(() => {
    const m = new Map<string, EventRow[]>();
    for (const r of rows) {
      if (!r.date) continue;
      const last = r.end && r.end > r.date ? r.end : r.date;
      for (const d of days) if (d >= r.date && d <= last) (m.get(d) ?? m.set(d, []).get(d)!).push(r);
    }
    return m;
  }, [rows, days]);
  const label = `${fmtDay(days[0])} to ${fmtDay(days[6])}`;
  return (
    <section aria-label="Calendar" data-testid="calendar-strip" className="shrink-0">
      <div className="mb-2 flex items-center gap-1">
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text-primary">{label}</h3>
        {start !== weekStart(today) && <button type="button" onClick={() => setStart(weekStart(today))} className="mr-1 text-[13px] font-medium text-accent hover:underline">This week</button>}
        <button type="button" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week" title="Previous week" data-testid="strip-prev"
          className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-text-primary"><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" onClick={() => setStart(addDays(start, 7))} aria-label="Next week" title="Next week" data-testid="strip-next"
          className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-text-primary"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <ol className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const evs = byDay.get(d) ?? [];
          const dt = atNoon(d);
          const isToday = d === today;
          return (
            <li key={d} data-testid="strip-day" data-day={d}
              className={`flex min-h-[5.5rem] min-w-0 flex-col rounded-lg border px-1 pb-1 pt-1.5 ${isToday ? "border-accent-border bg-accent-soft/50" : "border-border-subtle"}`}>
              <span className="flex items-baseline justify-center gap-1 text-center">
                <span className="text-[12px] text-text-muted">{dt.toLocaleDateString(undefined, { weekday: phone ? "narrow" : "short" })}</span>
                <span className={`text-[14px] tabular-nums ${isToday ? "font-semibold text-accent" : "font-medium text-text-primary"}`}>{dt.getDate()}</span>
              </span>
              <span className="mt-1 flex min-w-0 flex-col gap-0.5">
                {evs.slice(0, phone ? 3 : 2).map((e) => (
                  <button key={e.id} type="button" onClick={() => onPick(e)} title={`${e.name}\n${metaOf(e)}`} data-testid="strip-event"
                    className={`flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left text-[12px] leading-tight transition-colors ${
                      selected === e.id ? "bg-accent text-on-accent" : e.source === "prevail" ? "bg-accent-soft text-accent hover:bg-accent/20" : "bg-surface-warm text-text-secondary hover:text-text-primary"}`}>
                    {phone ? <span aria-hidden className="mx-auto h-1.5 w-1.5 rounded-full bg-current" /> : <span className="min-w-0 truncate">{e.name}</span>}
                  </button>
                ))}
                {evs.length > (phone ? 3 : 2) && <span className="text-center text-[12px] text-text-muted">+{evs.length - (phone ? 3 : 2)}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function EventsView({ vaultPath, onSelected, clearN = 0 }: { vaultPath: string; onSelected?: (name: string | null) => void; clearN?: number }) {
  // Below 1100px the detail would be too narrow beside the list: list, then detail, like a phone.
  const isPhone = useIsPhone();
  const phone = useStacked() || isPhone;
  const q = useInvokeQuery<{ events: EventRow[] } | null>("ia_events", { vault: vaultPath }, { invalidateOn: [EVENTS_CHANGED, "prevail:entities-changed", "prevail:missions-changed"] });
  const rows = useMemo(() => (Array.isArray(q.data?.events) ? q.data!.events : []), [q.data]);
  const today = todayYmd();
  const coming = rows.filter((r) => !r.date || (r.end ?? r.date) >= today);
  const earlier = rows.filter((r) => r.date && (r.end ?? r.date) < today).reverse();
  const [showEarlier, setShowEarlier] = useState(false);
  const [adding, setAdding] = useState(() => takeNew("events"));
  const [sel, setSel] = useState<{ slug: string; n: number } | null>(() => {
    const t = peekRequestedEntity();
    if (t?.kind !== "event") return null;
    takeRequestedEntity();
    return { slug: t.value, n: 0 };
  });
  const [opening, setOpening] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (clearN) { setSel(null); setAdding(false); } }, [clearN]);
  useEffect(() => {
    const off = registerEntitiesView();
    const onOpen = () => { if (peekRequestedEntity()?.kind !== "event") return; const t = takeRequestedEntity(); if (t) { setAdding(false); setSel((p) => ({ slug: t.value, n: (p?.n ?? 0) + 1 })); } };
    const onNew = (e: Event) => { if ((e as CustomEvent<string>).detail === "events" && takeNew("events")) setAdding(true); };
    window.addEventListener("prevail:open-entity", onOpen);
    window.addEventListener("prevail:ia-new", onNew);
    return () => { off(); window.removeEventListener("prevail:open-entity", onOpen); window.removeEventListener("prevail:ia-new", onNew); };
  }, []);

  // On a wide screen the detail opens on the next event until one is picked.
  const firstPage = coming.find((r) => r.has_page) ?? null;
  const curSlug = adding ? null : sel?.slug ?? (!phone && firstPage ? firstPage.id.slice(6) : null);
  const selectedId = curSlug ? `event/${curSlug}` : null;
  const selName = adding ? "New event" : curSlug ? (rows.find((r) => r.id === `event/${curSlug}`)?.name ?? curSlug.replace(/-/g, " ")) : null;
  useEffect(() => { onSelected?.(selName); }, [selName]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = useCallback(async (e: EventRow) => {
    setAdding(false); setErr(null);
    if (e.has_page) { setSel((p) => ({ slug: e.id.slice(6), n: (p?.n ?? 0) + 1 })); return; }
    // A calendar entry, a milestone or a hold: give it a page, then open it.
    setOpening(e.id);
    try {
      const r = await invoke<{ id: string }>("ia_event_adopt", { vault: vaultPath, row: e.id });
      setSel((p) => ({ slug: r.id.slice(r.id.indexOf("/") + 1), n: (p?.n ?? 0) + 1 }));
      void q.refresh();
      window.dispatchEvent(new CustomEvent("prevail:entities-changed"));
    } catch (x) { setErr(String(x)); } finally { setOpening(null); }
  }, [vaultPath, q]);

  const row = (e: EventRow) => {
    const on = e.id === selectedId;
    const Icon = e.source === "milestone" ? Flag : CalendarDays;
    return (
      <li key={e.id}>
        <button type="button" onClick={() => void pick(e)} data-testid="event-row" aria-current={on ? "true" : undefined}
          className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${on ? "bg-surface-warm" : "hover:bg-surface-warm/50"}`}>
          <span aria-hidden className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border ${e.source === "prevail" ? "border-accent-border bg-accent-soft text-accent" : "border-border bg-surface-warm text-text-muted"}`}>
            {opening === e.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-[14px] ${on ? "font-semibold" : "font-medium"} ${e.done ? "text-text-muted line-through" : "text-text-primary"}`}>{e.name}</span>
            <span className="block truncate text-[12px] text-text-muted" title={metaOf(e)}>{metaOf(e)}</span>
          </span>
        </button>
      </li>
    );
  };

  const list = (
    <div className="p-2" data-testid="events-list-body">
      {phone && <div className="px-1 pb-3"><CalendarStrip rows={rows} selected={selectedId} onPick={(e) => void pick(e)} /></div>}
      {q.loading && !rows.length && <p className="flex items-center gap-2 px-2.5 py-2 text-[13px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" />Reading your events</p>}
      {!q.loading && !rows.length && (
        <div className="px-2 py-8 text-center">
          <p className="text-[14px] font-medium text-text-primary">No events yet</p>
          <p className="mt-1 text-[12px] text-text-muted">Add one by talking, or connect a calendar. A project's dated milestones show here too.</p>
        </div>
      )}
      {coming.length > 0 && <ul aria-label="Coming up">{coming.map(row)}</ul>}
      {earlier.length > 0 && (
        <section className="mt-3">
          <button type="button" onClick={() => setShowEarlier((v) => !v)} aria-expanded={showEarlier} className="flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-[13px] font-semibold text-text-secondary hover:text-text-primary">
            <ChevronRight aria-hidden className={`h-3.5 w-3.5 transition-transform ${showEarlier ? "rotate-90" : ""}`} />Earlier<span className="font-normal tabular-nums text-text-muted">{earlier.length}</span>
          </button>
          {showEarlier && <ul>{earlier.slice(0, 60).map(row)}</ul>}
        </section>
      )}
    </div>
  );

  const body = adding
    ? <NewObject vaultPath={vaultPath} kind="events" onCancel={() => setAdding(false)} onMade={(id) => { setAdding(false); setSel((p) => ({ slug: id.slice(6), n: (p?.n ?? 0) + 1 })); void q.refresh(); }} />
    : (
      <div className={isPhone ? "p-4" : "flex h-full min-h-0 flex-col px-6 pb-4 pt-5"}>
        {!phone && <div className="mb-5"><CalendarStrip rows={rows} selected={selectedId} onPick={(e) => void pick(e)} /></div>}
        {err && <p className="mb-3 text-[13px] text-err">{err}</p>}
        {curSlug
          ? <div className="flex min-h-0 flex-1 flex-col"><EntityDetailView key={`${curSlug}:${sel?.n ?? 0}`} vaultPath={vaultPath} target={{ kind: "event", value: curSlug }} /></div>
          : !phone && <p className={META}>Pick an event, or add one with the +.</p>}
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="events-view">
      <SideSpine storageKey="prevail.events.spine" title="Events" label="events" testId="events-list"
        meta={rows.length ? `${coming.length} coming up` : undefined}
        actions={<button type="button" onClick={() => { setAdding(true); }} data-testid="events-new" title="New event, by talking" aria-label="New event"
          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"><Plus className="h-4 w-4" /></button>}
        phone={phone} phoneDetail={adding || sel !== null} onBack={() => { setSel(null); setAdding(false); }} backLabel="All events"
        detail={body}>
        {list}
      </SideSpine>
    </div>
  );
}
