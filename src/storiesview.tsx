// Insights > Metrics > Your year and This month (metrics plan M5), and the
// patterns-and-experiments part of Patterns. Every number is written by the
// engine's code from the user's own records; local-only domains, ~local
// Compass lines and local-only sources never reach a story. Places and photos
// are a record, shown as a celebration, never a target.
import { useMemo, useState } from "react";
import { CircleOff, FileDown, FlaskConical, Loader2, Play, Scale } from "lucide-react";
import { invoke, isBrowser } from "./bridge";
import { invalidateQueries, useInvokeQuery } from "./query";
import { RowMenu } from "./ui";
import { BODY, DETAIL_TITLE, META, SECTION_TITLE } from "./typescale";

export interface Place { region: string; place: string; country: string; trips: number; lat?: number; lon?: number }
export interface RecapLine { id: string; title: string; tier: string; value: number; prev: number; change: number | null; unit: string; documentary: boolean; from: string }
export interface MonthRecap { month: string; lines: RecapLine[]; surprise: string | null; topDomains: { domain: string; share: number }[]; partial?: boolean }
export interface YearStory {
  year: string; through: string;
  ai: { prompts: number; usd: number; tokens: number; sessions: number; peak: { month: string; share: number } | null; byTool: { tool: string; usd: number; tokens: number }[] };
  building: { commits: number; aiCommits: number; repos: number; shipped: number; codingDays: number };
  hour: number | null;
  exploration: { trips: number; places: Place[]; countries: number; photoDays: number; newPlaces: number; daysAway: number };
  time: { domain: string; share: number }[];
  values: { id: string; title: string; rank: number; months: { month: string; share: number }[] }[];
  race: { month: string; order: string[] }[];
  months: MonthRecap[];
  tools: { app: string; days: number }[];
  heat: { calm: { date: string; value: number }[]; focus: { date: string; value: number }[]; prompts: { date: string; value: number }[] };
  notes: string[];
}
export interface Pattern { key: string; a: string; b: string; aTitle: string; bTitle: string; lag: number; r: number; p: number; weeks: number; text: string }
export interface Experiment {
  id: string; status: "proposed" | "running" | "done" | "stopped"; inputTitle: string; outcomeTitle: string; hypothesis: string; instruction: string; start: string;
  weeks: { week: string; arm: "A" | "B" }[]; result?: { verdict: string; text: string };
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const int = (n: number) => Math.round(n).toLocaleString("en-US");
const monthLabel = (m: string, long = true) => new Date(`${m}-15T12:00:00`).toLocaleDateString("en-US", { month: long ? "long" : "short", ...(long ? { year: "numeric" } : {}) });
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;
const fmt = (v: number, unit: string) => (unit === "usd" ? money(v) : unit === "hours" ? `${Math.round(v * 10) / 10} h` : unit === "score" ? String(Math.round(v * 10) / 10) : int(v));
const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";
const TIER: Record<string, string> = { measured: "Measured", derived: "Derived", inferred: "Inferred", asked: "Asked" };

/** A year as 53 weeks of days; greener is more. */
export function HeatGrid({ cells, year, label }: { cells: { date: string; value: number }[]; year: string; label: string }) {
  const by = new Map(cells.map((c) => [c.date, c.value]));
  const max = Math.max(1, ...cells.map((c) => c.value));
  const first = new Date(`${year}-01-01T12:00:00`);
  const off = (first.getDay() + 6) % 7;
  const rects: React.ReactNode[] = [];
  for (let i = 0; i < 366; i++) {
    const d = new Date(first.getTime() + i * 86_400_000);
    if (String(d.getFullYear()) !== year) break;
    const key = d.toISOString().slice(0, 10);
    const v = by.get(key);
    const k = i + off;
    rects.push(<rect key={key} x={Math.floor(k / 7) * 11} y={(k % 7) * 11} width={9} height={9} rx={2} fill="#008000" fillOpacity={v == null ? 0.08 : 0.2 + 0.8 * (v / max)}><title>{`${key}${v != null ? `: ${Math.round(v * 10) / 10}` : ""}`}</title></rect>);
  }
  return <svg viewBox={`0 0 ${54 * 11} ${7 * 11}`} role="img" aria-label={label} className="block h-auto w-full max-w-3xl" data-testid="heat-grid">{rects}</svg>;
}

/** Places on a plain map: a graticule and one dot per region, sized by trips. */
export function PlacesMap({ places }: { places: Place[] }) {
  const W = 720; const H = 360;
  const x = (lon: number) => ((lon + 180) / 360) * W;
  const y = (lat: number) => ((90 - lat) / 180) * H;
  const max = Math.max(1, ...places.map((p) => p.trips));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Places you went" className="block h-auto w-full max-w-3xl rounded-lg" data-testid="places-map">
      <rect width={W} height={H} rx={8} className="fill-surface-warm" />
      {[-120, -60, 0, 60, 120].map((l) => <line key={`x${l}`} x1={x(l)} y1={0} x2={x(l)} y2={H} className="stroke-border" strokeWidth={1} />)}
      {[-60, -30, 0, 30, 60].map((l) => <line key={`y${l}`} x1={0} y1={y(l)} x2={W} y2={y(l)} className="stroke-border" strokeWidth={1} />)}
      {places.filter((p) => p.lat != null).map((p) => (
        <circle key={p.region} cx={x(p.lon!)} cy={y(p.lat!)} r={3 + 9 * Math.sqrt(p.trips / max)} fill="#008000" fillOpacity={0.55}><title>{`${p.region}: ${p.trips} trip${p.trips === 1 ? "" : "s"}`}</title></circle>
      ))}
    </svg>
  );
}

function Bars({ rows }: { rows: { label: string; v: number; note?: string }[] }) {
  return (
    <div className="mt-2 grid max-w-3xl gap-2">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_4.5rem] items-center gap-3">
          <span className="truncate text-[14px] text-text-secondary" title={r.label}>{r.label}</span>
          <span className="h-3 overflow-hidden rounded bg-surface-warm"><span className="block h-full rounded bg-accent" style={{ width: `${Math.max(2, Math.min(100, r.v))}%` }} /></span>
          <span className="text-right text-[13px] tabular-nums text-text-muted">{r.note ?? `${r.v}%`}</span>
        </div>
      ))}
    </div>
  );
}

function SaveButton({ vaultPath, kind, period }: { vaultPath: string; kind: "year" | "recap"; period: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (isBrowser()) return null;
  return (
    <span className="flex items-center gap-2">
      {msg && <span className={META} data-testid="story-saved">{msg}</span>}
      <button onClick={() => void (async () => { setBusy(true); setMsg(null); try { await invoke("engine_story_write", { vault: vaultPath, kind, period }); setMsg("Saved in General's reviews"); } catch (e) { setMsg(`Not saved: ${String(e)}`); } finally { setBusy(false); } })()}
        disabled={busy} title="Save as a page in your vault" aria-label="Save as a page in your vault" data-testid="story-save" className={iconBtn}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
      </button>
    </span>
  );
}

export function YourYearView({ vaultPath }: { vaultPath: string }) {
  const thisYear = String(new Date().getFullYear());
  const [year, setYear] = useState(thisYear);
  const q = useInvokeQuery<YearStory>("engine_story", { vault: vaultPath, kind: "year", period: year }, { staleMs: 30 * 60_000 });
  const s = q.data && typeof q.data === "object" && q.data.ai ? q.data : null;
  const firstValue = s ? [...s.values].sort((a, b) => a.rank - b.rank)[0] : undefined;
  const tiles: [string, string][] = s ? [
    [int(s.ai.prompts), "prompts you wrote to AI tools"],
    [money(s.ai.usd), `in tokens at API prices${s.ai.peak ? `, ${s.ai.peak.share}% in ${monthLabel(s.ai.peak.month, false)}` : ""}`],
    [int(s.building.repos), `repos touched, ${int(s.building.shipped)} shipped`],
    [int(s.building.commits), `commits, ${int(s.building.aiCommits)} with an AI co-author`],
    ...(s.hour != null ? [[hourLabel(s.hour), "your most active hour"] as [string, string]] : []),
    [int(s.exploration.trips), `trips, ${s.exploration.places.length} places, ${s.exploration.countries} ${s.exploration.countries === 1 ? "country" : "countries"}`],
  ] : [];
  return (
    <section data-testid="metrics-year">
      <div className="flex items-start gap-3">
        <h2 className={`${DETAIL_TITLE} min-w-0 flex-1`}>{year}, your year</h2>
        <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year" className="h-8 rounded-md border border-border bg-background px-2 text-[13px] text-text-primary">
          {[0, 1, 2].map((n) => String(Number(thisYear) - n)).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <SaveButton vaultPath={vaultPath} kind="year" period={year} />
      </div>
      <p className={`${META} mt-1`}>{s ? `Through ${s.through}. ` : ""}Written by code from your own records, on your Mac. Places and photos are a record, never a target.</p>
      {q.error ? <p className="mt-3 text-[13px] text-err">Could not read the year: {String(q.error)}</p> : null}
      {!s && !q.error && <p className={`${BODY} mt-4 text-text-muted`}>Putting the year together...</p>}
      {s && (
        <>
          <div className="mt-4 grid max-w-4xl gap-3 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]" data-testid="year-tiles">
            {tiles.map(([n, l]) => (
              <div key={l} className="rounded-xl border border-border-subtle p-3">
                <div className="font-display text-[26px] font-semibold tabular-nums text-accent">{n}</div>
                <div className="text-[13px] leading-snug text-text-muted">{l}</div>
              </div>
            ))}
          </div>
          <h3 className={`${SECTION_TITLE} mt-8`}>Where your time went</h3>
          {s.time.length ? <Bars rows={s.time.map((t) => ({ label: t.domain.charAt(0).toUpperCase() + t.domain.slice(1), v: t.share }))} /> : <p className={`${BODY} mt-1 text-text-muted`}>No prompt projects yet.</p>}
          <h3 className={`${SECTION_TITLE} mt-8`}>Your values, month by month</h3>
          {firstValue && s.race.length && !s.values.every((v) => v.months.every((m) => m.share === 0)) ? (
            <>
              <p className={`${BODY} mt-1 text-text-secondary`}>You said {firstValue.title} comes first. Here is where each value ranked in your attention.</p>
              <div className="mt-2 max-w-4xl overflow-x-auto" data-scroll-x>
                <table className="w-full text-[13px]" data-testid="values-race">
                  <thead><tr><th className="py-1 text-left font-medium text-text-muted" />{s.race.map((r) => <th key={r.month} className="px-1 py-1 font-medium text-text-muted">{monthLabel(r.month, false)}</th>)}</tr></thead>
                  <tbody>{s.values.map((v) => <tr key={v.id} className="border-t border-border-subtle"><td className="py-1 pr-2 text-text-primary">{v.title}</td>{s.race.map((r) => <td key={r.month} className="px-1 py-1 text-center tabular-nums text-text-secondary">{r.order.indexOf(v.id) + 1}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </>
          ) : <p className={`${BODY} mt-1 text-text-muted`}>{s.notes.find((n) => /values race/.test(n)) ?? "Appears once your Compass values are confirmed."}</p>}
          <h3 className={`${SECTION_TITLE} mt-8`}>Places</h3>
          <div className="mt-2"><PlacesMap places={s.exploration.places} /></div>
          {s.exploration.places.length > 0 && <p className={`${META} mt-1 line-clamp-2`} title={s.exploration.places.map((p) => `${p.region} (${p.trips})`).join(", ")}>{s.exploration.places.slice(0, 6).map((p) => `${p.place} ${p.trips}`).join(" · ")}</p>}
          <h3 className={`${SECTION_TITLE} mt-8`}>Your days</h3>
          <p className={`${META} mt-1`}>Prompts by day</p>
          <div className="mt-1"><HeatGrid cells={s.heat.prompts} year={s.year} label="Prompts by day" /></div>
          {s.heat.calm.length > 0 && <><p className={`${META} mt-3`}>Weekly calm</p><div className="mt-1"><HeatGrid cells={s.heat.calm} year={s.year} label="Weekly calm" /></div></>}
          {s.heat.focus.length > 0 && <><p className={`${META} mt-3`}>Focus hours</p><div className="mt-1"><HeatGrid cells={s.heat.focus} year={s.year} label="Focus hours" /></div></>}
          <h3 className={`${SECTION_TITLE} mt-8`}>AI and tools</h3>
          {s.ai.byTool.length ? <Bars rows={s.ai.byTool.slice(0, 6).map((t) => ({ label: t.tool.charAt(0).toUpperCase() + t.tool.slice(1), v: s.ai.usd ? Math.round((t.usd / s.ai.usd) * 100) : 0, note: money(t.usd) }))} /> : <p className={`${BODY} mt-1 text-text-muted`}>No AI tool records yet.</p>}
          <h3 className={`${SECTION_TITLE} mt-8`}>Month by month</h3>
          <ul className="mt-1 max-w-4xl">{s.months.map((m) => (
            <li key={m.month} className="border-b border-border-subtle py-2 last:border-b-0" data-testid="year-month">
              <p className="text-[15px] font-medium text-text-primary">{monthLabel(m.month)}{m.partial ? ", so far" : ""}</p>
              <p className={`${META} mt-0.5 line-clamp-2`}>{m.lines.filter((l) => !l.documentary).slice(0, 4).map((l) => `${l.title} ${fmt(l.value, l.unit)}`).join(" · ") || "Nothing recorded"}{m.surprise ? ` · ${m.surprise}` : ""}</p>
            </li>
          ))}</ul>
        </>
      )}
    </section>
  );
}

export function MonthRecapView({ vaultPath }: { vaultPath: string }) {
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setDate(15); d.setMonth(d.getMonth() - i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }), []);
  const [month, setMonth] = useState(months[1]!);
  const q = useInvokeQuery<MonthRecap>("engine_story", { vault: vaultPath, kind: "recap", period: month }, { staleMs: 30 * 60_000 });
  const r = q.data && typeof q.data === "object" && Array.isArray(q.data.lines) ? q.data : null;
  return (
    <section data-testid="metrics-month">
      <div className="flex items-start gap-3">
        <h2 className={`${DETAIL_TITLE} min-w-0 flex-1`}>{monthLabel(month)}</h2>
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" className="h-8 rounded-md border border-border bg-background px-2 text-[13px] text-text-primary">
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <SaveButton vaultPath={vaultPath} kind="recap" period={month} />
      </div>
      <p className={`${META} mt-1`}>The month in short, against the month before.{r?.partial ? " The month is not over yet." : ""}</p>
      {!r && !q.error && <p className={`${BODY} mt-4 text-text-muted`}>Counting...</p>}
      {r && (
        <>
          <ul className="mt-3 max-w-4xl">{r.lines.map((l) => (
            <li key={l.id} className="border-b border-border-subtle py-2.5 last:border-b-0" data-testid="recap-line">
              <p className="text-[15px] font-medium text-text-primary">{l.title}: <span className="tabular-nums">{fmt(l.value, l.unit)}</span></p>
              <p className={`${META} mt-0.5 truncate`} title={l.from}>{[!l.documentary && !r.partial && l.change != null && l.prev >= 5 ? `${l.change >= 0 ? "+" : ""}${l.change}% on the month before` : l.documentary ? "A record, no target" : "", TIER[l.tier] ?? l.tier].filter(Boolean).join(" · ")}</p>
            </li>
          ))}</ul>
          {!r.lines.length && <p className={`${BODY} mt-3 text-text-muted`}>Nothing was recorded this month.</p>}
          {r.topDomains.length > 0 && <p className={`${BODY} mt-4 text-text-secondary`}>Where your prompts went: {r.topDomains.map((d) => `${d.domain} ${d.share}%`).join(" · ")}</p>}
          {r.surprise && <p className={`${BODY} mt-2 text-text-primary`} data-testid="recap-surprise"><span className="font-semibold">One surprise: </span>{r.surprise}</p>}
        </>
      )}
    </section>
  );
}

/** Patterns across every metric (false-discovery controlled) and the n-of-1 experiments they can become. */
export function PatternsAndExperiments({ vaultPath }: { vaultPath: string }) {
  const pq = useInvokeQuery<{ tests: number; found: Pattern[] }>("engine_story", { vault: vaultPath, kind: "patterns", period: null }, { staleMs: 30 * 60_000 });
  const eq = useInvokeQuery<{ experiments: Experiment[]; thisWeek: { id: string; arm: string; text: string } | null }>("engine_story", { vault: vaultPath, kind: "experiments", period: null }, { staleMs: 60_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const found = pq.data && Array.isArray(pq.data.found) ? pq.data.found : [];
  const exps = eq.data && Array.isArray(eq.data.experiments) ? eq.data.experiments : [];
  const act = async (key: string, args: Record<string, unknown>) => {
    setBusy(key); setMsg(null);
    try { await invoke("engine_experiment", { vault: vaultPath, ...args }); invalidateQueries("engine_review"); await eq.refresh(); }
    catch (e) { setMsg(String(e)); } finally { setBusy(null); }
  };
  const running = exps.some((e) => e.status === "running");
  return (
    <>
      <h3 className={`${SECTION_TITLE} mt-6`}>Across your metrics</h3>
      <p className={`${META} mt-1`}>Every pair of your weekly metrics, up to two weeks apart{pq.data ? `: ${pq.data.tests} tests` : ""}, with chance controlled across all of them. Pairs counted from the same records are left out.</p>
      <ul className="mt-2 max-w-4xl">{found.map((p) => (
        <li key={p.key} data-testid="pattern-across" className="group flex items-start gap-2 border-b border-border-subtle py-2.5 last:border-b-0">
          <p className={`${BODY} min-w-0 flex-1 break-words text-text-primary`}>{p.text}</p>
          {!running && !isBrowser() && (
            <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
              <RowMenu items={[{ icon: FlaskConical, label: "Try it as an experiment", onClick: () => void act(`p:${p.key}`, { action: "propose", id: null, key: p.key }) }]} />
            </span>
          )}
        </li>
      ))}</ul>
      {!found.length && <p className={`${BODY} mt-2 text-text-muted`}>{pq.data ? "Nothing survives the chance control yet." : "Testing..."}</p>}

      <h3 className={`${SECTION_TITLE} mt-6`}>Experiments</h3>
      <p className={`${META} mt-1`}>A pattern is a hypothesis; an experiment is evidence. Four weeks, alternating: A weeks do more, B weeks as usual. One at a time.</p>
      {eq.data?.thisWeek && <p className={`${BODY} mt-2 text-text-primary`} data-testid="experiment-this-week">This week: {eq.data.thisWeek.text}</p>}
      <ul className="mt-2 max-w-4xl">{exps.slice(0, 6).map((e) => (
        <li key={e.id} data-testid="experiment" data-status={e.status} className="group flex items-start gap-2 border-b border-border-subtle py-2.5 last:border-b-0">
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[15px] font-medium text-text-primary">{e.hypothesis}</p>
            <p className={`${META} mt-0.5 line-clamp-2`}>{[e.status === "proposed" ? `Starts ${e.start}` : e.status.charAt(0).toUpperCase() + e.status.slice(1), e.result?.text ?? e.instruction].join(" · ")}</p>
          </div>
          {e.status === "proposed" && <button onClick={() => void act(`s:${e.id}`, { action: "start", id: e.id, key: null })} disabled={!!busy} data-testid="experiment-start" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white disabled:opacity-50">{busy === `s:${e.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Start</button>}
          {(e.status === "running" || e.status === "proposed") && (
            <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
              <RowMenu items={[
                ...(e.status === "running" ? [{ icon: Scale, label: "Score it now", onClick: () => void act(`c:${e.id}`, { action: "score", id: e.id, key: null }) }] : []),
                { icon: CircleOff, label: "Stop it", onClick: () => void act(`x:${e.id}`, { action: "stop", id: e.id, key: null }) },
              ]} />
            </span>
          )}
        </li>
      ))}</ul>
      {!exps.length && <p className={`${BODY} mt-2 text-text-muted`}>None yet. Try one from a pattern above.</p>}
      {msg && <p className="mt-2 text-[13px] text-err">{msg}</p>}
    </>
  );
}
