// Councils: the user's named groups of models that answer a question together,
// with a chair that writes the verdict. The column lists the councils; the
// detail is either the builder for a new one (pick models, see the cost, name
// it) or an open council (members, cost, use it in chat). Storage lives in
// council.tsx: one list plus the default id, with the legacy panel and chair
// keys mirrored from the Default council.
import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Crown, MessageSquare, Plus, Scale, Search, Star, Trash2, X } from "lucide-react";
import { invoke } from "./bridge";
import { DISCOVERED_MODELS, isHarnessRuntime } from "./constants";
import { isLocalCli } from "./helpers";
import { prettyModelId } from "./helpers2";
import { isBunkerOn } from "./storage";
import { Toggle } from "./ui";
import {
  councilModelsFor, councilSlotKey, fmtUsd, newCouncilId, readCouncils, requestCouncilInChat, seatCostUsd, seatIsLocal, useCouncils, writeCouncils,
  type Council,
} from "./council";
import { SettingsHeader } from "./sectionutil";
import { ProviderMark } from "./marks";
import { SideSpine } from "./sidespine";
import { useIsPhone } from "./useisphone";
import { DETAIL_TITLE, META, SECTION_TITLE } from "./typescale";
import type { CliInfo } from "./types";

type CatalogModel = { key: string; cli: string; runtime: string; label: string; blurb: string };

const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-muted";
const primaryBtn = "inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-semibold text-background transition-colors hover:bg-accent-hover disabled:opacity-50";
const secondaryBtn = "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3.5 text-sm font-medium text-text-primary transition-colors hover:border-accent-border hover:text-accent";
const AGGREGATORS = new Set(["openrouter", "bedrock"]);

// Label a seat for display, falling back to a tidy id when the model is not in
// the curated list (a discovered or retired one).
function modelLabel(key: string): string {
  const [cli, model] = key.split("::");
  const m = councilModelsFor(cli).find((x) => x.id === model) ?? (DISCOVERED_MODELS[cli] ?? []).find((x) => x.id === model);
  return m?.label ?? (prettyModelId(model || "") || "Default");
}
function runtimeLabel(key: string, clis: CliInfo[]): string {
  const cli = key.split("::")[0];
  return clis.find((c) => c.id === cli)?.label ?? cli;
}
const seatCost = (key: string) => seatCostUsd(key, modelLabel(key));
const seatLocal = (key: string) => seatIsLocal(key, modelLabel(key));

// The strongest seat by the cost tier (a flagship costs more), first on a tie.
function strongest(seats: string[]): string {
  let best = seats[0] ?? "";
  for (const k of seats) if (seatCost(k) > seatCost(best)) best = k;
  return best;
}

// A small stacked row of member logos: up to five, then +N.
export function LogoStack({ seats, size = 22 }: { seats: string[]; size?: number }) {
  const shown = seats.slice(0, 5);
  const more = seats.length - shown.length;
  if (seats.length === 0) return <span className={META}>No models yet</span>;
  return (
    <span data-testid="council-logos" className="inline-flex items-center">
      {shown.map((k, i) => (
        <span key={k} title={modelLabel(k)} className="rounded-full ring-2 ring-background" style={{ marginLeft: i ? -Math.round(size / 3) : 0, zIndex: 10 - i }}>
          <ProviderMark vendor={k.split("::")[0]} size={size} />
        </span>
      ))}
      {more > 0 && <span className="ml-1.5 text-[12px] font-medium text-text-muted">+{more}</span>}
    </span>
  );
}

// Live cost figures for a set of seats.
function CostInsight({ seats }: { seats: string[] }) {
  const per = seats.reduce((s, k) => s + seatCost(k), 0);
  const local = seats.filter(seatLocal).length;
  const cloud = seats.length - local;
  return (
    <div data-testid="council-cost" title="Rough estimate: about 6K tokens a seat at blended cloud rates. Local models are free. Actual prices vary."
      className="grid grid-cols-2 gap-3 rounded-xl border border-border-subtle bg-surface p-4 sm:grid-cols-4">
      <div><div className={META}>Per question</div><div data-testid="council-cost-per" className="mt-0.5 text-[17px] font-semibold text-text-primary">{per > 0 ? `about ${fmtUsd(per)}` : "Free"}</div></div>
      <div><div className={META}>Per 10 questions</div><div className="mt-0.5 text-[17px] font-semibold text-text-primary">{per > 0 ? `about ${fmtUsd(per * 10)}` : "Free"}</div></div>
      <div><div className={META}>Models</div><div data-testid="council-cost-seats" className="mt-0.5 text-[17px] font-semibold text-text-primary">{seats.length}</div></div>
      <div><div className={META}>Cloud and local</div><div className="mt-0.5 text-[17px] font-semibold text-text-primary">{cloud} cloud, {local} local</div></div>
    </div>
  );
}

// The searchable checklist of every model the user has set up, grouped by runtime.
function ModelChecklist({ catalog, picked, onToggle, clis }: { catalog: CatalogModel[]; picked: Set<string>; onToggle: (key: string) => void; clis: CliInfo[] }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const rows = useMemo(() => {
    const list = query ? catalog.filter((m) => `${m.label} ${m.runtime} ${m.blurb}`.toLowerCase().includes(query)) : catalog;
    // Discovered (live catalog) models only join when searching: aggregators
    // expose hundreds.
    if (query) {
      const have = new Set(list.map((m) => m.key));
      for (const c of clis) for (const d of DISCOVERED_MODELS[c.id] ?? []) {
        const key = councilSlotKey(c.id, d.id);
        if (have.has(key) || !`${d.id} ${d.label ?? ""}`.toLowerCase().includes(query)) continue;
        if (!catalog.some((m) => m.cli === c.id)) continue;
        list.push({ key, cli: c.id, runtime: c.label, label: d.label || d.id, blurb: "" });
        have.add(key);
        if (list.length > 80) break;
      }
    }
    const groups = new Map<string, CatalogModel[]>();
    for (const m of list) groups.set(m.runtime, [...(groups.get(m.runtime) ?? []), m]);
    return [...groups.entries()];
  }, [catalog, clis, query]);
  return (
    <div data-testid="council-checklist" className="rounded-xl border border-border-subtle bg-surface">
      <div className="relative border-b border-border-subtle p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" aria-label="Search models"
          className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none" />
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {rows.length === 0 && <p className={`${META} px-4 py-3`}>{catalog.length ? "No models match." : "No model app is ready on this Mac yet. Set one up on the Models page."}</p>}
        {rows.map(([runtime, models]) => (
          <div key={runtime}>
            <div className="sticky top-0 z-10 flex items-center gap-2 bg-surface px-4 pb-1 pt-3 text-[13px] font-semibold text-text-secondary">
              <ProviderMark vendor={models[0].cli} size={18} /> {runtime}
            </div>
            {models.map((m) => {
              const on = picked.has(m.key);
              const cost = seatCost(m.key);
              return (
                <button key={m.key} type="button" role="checkbox" aria-checked={on} data-council-model={m.key} onClick={() => onToggle(m.key)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-warm ${on ? "bg-accent-soft/60" : ""}`}>
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-accent bg-accent text-background" : "border-border-strong bg-background"}`}>
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm font-medium ${on ? "text-accent" : "text-text-primary"}`}>{m.label}</span>
                    {m.blurb && <span className="block truncate text-[12px] text-text-muted">{m.blurb}</span>}
                  </span>
                  <span className="shrink-0 text-[12px] tabular-nums text-text-muted">{cost > 0 ? fmtUsd(cost) : "Free"}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CouncilSettingsSection({ clis }: { clis: CliInfo[] }) {
  const phone = useIsPhone();
  const { councils, defaultId } = useCouncils();
  const available = useMemo(() => clis.filter((c) => c.available && (!isBunkerOn() || isLocalCli(c.id))), [clis]);
  // Every curated model of every runtime that is ready here.
  const catalog = useMemo<CatalogModel[]>(() => available.flatMap((c) => councilModelsFor(c.id).map((m) => ({
    key: councilSlotKey(c.id, m.id), cli: c.id, runtime: c.label, label: m.label, blurb: m.blurb ?? "",
  }))), [available]);
  // Quick picks, derived from the catalog: the first real model of each lab,
  // and the fast or cheap tier of each.
  const quickPicks = useMemo(() => {
    const labs = available.filter((c) => !isHarnessRuntime(c.id) && !AGGREGATORS.has(c.id));
    const firstReal = (id: string) => councilModelsFor(id).find((m) => m.id && m.id !== "auto");
    const each = labs.map((c) => firstReal(c.id) && councilSlotKey(c.id, firstReal(c.id)!.id)).filter(Boolean) as string[];
    const cheap = labs.map((c) => {
      const m = councilModelsFor(c.id).find((x) => x.id !== "auto" && /fast|cheap/i.test(x.blurb ?? ""));
      const local = isLocalCli(c.id) ? firstReal(c.id) : undefined;
      const pick = m ?? local;
      return pick ? councilSlotKey(c.id, pick.id) : "";
    }).filter(Boolean);
    return [
      each.length > 1 && { id: "each", label: "One from each lab", seats: each },
      cheap.length > 0 && { id: "cheap", label: "Fast and cheap", seats: cheap },
    ].filter(Boolean) as { id: string; label: string; seats: string[] }[];
  }, [available]);

  const save = (next: Council[], def = defaultId) => writeCouncils(next, def);
  const update = (id: string, patch: Partial<Council>) => save(councils.map((c) => {
    if (c.id !== id) return c;
    const n = { ...c, ...patch };
    // The chair always sits on the council.
    if (!n.seats.includes(n.chair)) n.chair = strongest(n.seats);
    return n;
  }));

  // First launch: an empty migrated Default council gets a sensible table.
  useEffect(() => {
    const { councils: cs, defaultId: d } = readCouncils();
    if (cs.length !== 1 || cs[0].seats.length > 0) return;
    const seed = quickPicks.find((p) => p.id === "each")?.seats.slice(0, 3) ?? catalog.slice(0, 1).map((m) => m.key);
    if (seed.length) writeCouncils([{ ...cs[0], seats: seed, chair: strongest(seed) }], d);
  }, [quickPicks, catalog]);

  // "new" is the builder; otherwise a council id.
  const [sel, setSel] = useState<string>(defaultId);
  const [picked, setPicked] = useState(false);
  const select = (id: string) => { setSel(id); setPicked(true); };
  const open = councils.find((c) => c.id === sel) ?? (sel === "new" ? null : councils.find((c) => c.id === defaultId) ?? councils[0]);

  // Builder draft.
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [draftName, setDraftName] = useState("");
  const [draftChair, setDraftChair] = useState("");
  const startNew = () => { setDraft(new Set()); setDraftName(""); setDraftChair(""); select("new"); };
  const suggestedName = (() => { let n = councils.length + 1; while (councils.some((c) => c.name === `Council ${n}`)) n++; return `Council ${n}`; })();
  const draftSeats = [...draft];
  const chairFor = draftSeats.includes(draftChair) ? draftChair : strongest(draftSeats);
  const create = () => {
    if (draftSeats.length === 0) return;
    const c: Council = { id: newCouncilId(), name: draftName.trim() || suggestedName, seats: draftSeats, chair: chairFor };
    save([...councils, c]);
    setSel(c.id);
  };

  // Global auto-council: high-stakes questions asked through any AI tool or the
  // Prevail chat go to the Default council.
  const [autoCouncil, setAutoCouncil] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  useEffect(() => { invoke<{ auto?: string }>("get_auto_council").then((m) => setAutoCouncil(m?.auto === "auto")).catch(() => {}); }, []);
  async function toggleAuto(on: boolean) {
    setAutoBusy(true); setAutoCouncil(on);
    try { await invoke("set_auto_council", { domain: "general", on }); } catch { setAutoCouncil(!on); } finally { setAutoBusy(false); }
  }

  const perQuestion = (seats: string[]) => seats.reduce((s, k) => s + seatCost(k), 0);
  const rowCls = (on: boolean) => `flex w-full items-center gap-2.5 rounded-lg border-l-2 px-2.5 py-2.5 text-left transition-colors ${on ? "border-l-accent bg-accent-soft shadow-sm ring-1 ring-accent-border" : "border-l-transparent ring-1 ring-transparent hover:bg-surface-warm"}`;
  const listEl = (
    <div className="space-y-1 p-2">
      {councils.map((c) => {
        const on = open?.id === c.id && sel !== "new" && (!phone || picked);
        const cost = perQuestion(c.seats);
        return (
          <button key={c.id} data-testid={`council-row-${c.id}`} data-council-name={c.name} aria-current={on ? "true" : undefined} onClick={() => select(c.id)} className={rowCls(on)}>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className={`truncate text-sm font-semibold ${on ? "text-accent" : "text-text-primary"}`}>{c.name}</span>
                {c.id === defaultId && <span data-testid="council-default-mark" className="inline-flex shrink-0 items-center gap-0.5 text-[12px] font-medium text-accent"><Star className="h-3 w-3" /> Default</span>}
              </span>
              <span className="mt-1 flex items-center gap-2">
                <LogoStack seats={c.seats} size={18} />
                <span className="truncate text-[12px] text-text-muted">{c.seats.length} model{c.seats.length === 1 ? "" : "s"} · {cost > 0 ? `${fmtUsd(cost)} a question` : "free"}</span>
              </span>
            </span>
          </button>
        );
      })}
      <button data-testid="council-new-row" onClick={startNew} className={`${rowCls(sel === "new" && (!phone || picked))} text-sm font-medium text-text-muted hover:text-accent`}>
        <Plus className="h-4 w-4" /> New council
      </button>
    </div>
  );

  const step = (n: number, title: string) => (
    <h3 className={`${SECTION_TITLE} flex items-center gap-2.5`}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent">{n}</span>{title}
    </h3>
  );
  const toggleDraft = (k: string) => setDraft((d) => { const n = new Set(d); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const builder = (
    <div data-testid="council-builder" className="max-w-3xl space-y-7">
      <div>
        <h2 className={DETAIL_TITLE}>New council</h2>
        <p className={`${META} mt-1`}>Pick the models that should answer together, check the cost, then name it.</p>
      </div>
      <section className="space-y-3">
        {step(1, "Pick models")}
        {quickPicks.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className={META}>Quick picks</span>
            {quickPicks.map((p) => (
              <button key={p.id} type="button" onClick={() => setDraft(new Set(p.seats))}
                className="rounded-full border border-border bg-background px-3 py-1 text-[13px] text-text-secondary transition-colors hover:border-accent-border hover:text-accent">{p.label}</button>
            ))}
          </div>
        )}
        <ModelChecklist catalog={catalog} picked={draft} onToggle={toggleDraft} clis={available} />
      </section>
      <section className="space-y-3">
        {step(2, "Cost insight")}
        <CostInsight seats={draftSeats} />
      </section>
      <section className="space-y-3">
        {step(3, "Name it")}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={META}>Name</span>
            <input data-testid="council-name-input" value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder={suggestedName}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none" />
          </label>
          <label className="block">
            <span className={META}>Chair, who writes the verdict</span>
            <select data-testid="council-chair-select" value={chairFor} disabled={draftSeats.length === 0} onChange={(e) => setDraftChair(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-text-primary focus:border-accent-border focus:outline-none disabled:opacity-50">
              {draftSeats.length === 0 && <option value="">Pick models first</option>}
              {draftSeats.map((k) => <option key={k} value={k}>{modelLabel(k)} ({runtimeLabel(k, clis)})</option>)}
            </select>
          </label>
        </div>
      </section>
      <button data-testid="council-create" onClick={create} disabled={draftSeats.length === 0} className={primaryBtn}>
        <Scale className="h-4 w-4" /> Create council
      </button>
    </div>
  );

  const [adding, setAdding] = useState(false);
  const [armedDelete, setArmedDelete] = useState(false);
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  useEffect(() => { setAdding(false); setArmedDelete(false); setNameEdit(null); }, [sel]);

  const detail = (c: Council) => {
    const isDefault = c.id === defaultId;
    const commitName = () => { const v = (nameEdit ?? "").trim(); if (v && v !== c.name) update(c.id, { name: v }); setNameEdit(null); };
    const duplicate = () => {
      const copy: Council = { ...c, id: newCouncilId(), name: `${c.name} copy` };
      save([...councils, copy]); setSel(copy.id);
    };
    const remove = () => {
      if (councils.length <= 1) return;
      if (!armedDelete) { setArmedDelete(true); return; }
      const rest = councils.filter((x) => x.id !== c.id);
      save(rest, isDefault ? rest[0].id : defaultId);
      setSel(isDefault ? rest[0].id : defaultId);
    };
    const toggleSeat = (k: string) => update(c.id, { seats: c.seats.includes(k) ? c.seats.filter((x) => x !== k) : [...c.seats, k] });
    return (
      <div data-testid="council-detail" className="max-w-3xl space-y-6">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <input data-testid="council-name" aria-label="Council name" value={nameEdit ?? c.name}
              onChange={(e) => setNameEdit(e.target.value)} onBlur={commitName}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setNameEdit(null); }}
              className={`${DETAIL_TITLE} min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 -ml-1 hover:border-border focus:border-accent-border focus:outline-none`} />
            <div className="flex shrink-0 items-center gap-0.5 pt-1">
              <button onClick={duplicate} title="Duplicate" aria-label="Duplicate council" data-testid="council-duplicate" className={iconBtn}><Copy className="h-4 w-4" /></button>
              <button onClick={remove} disabled={councils.length <= 1} data-testid="council-delete"
                title={councils.length <= 1 ? "Your last council cannot be deleted" : armedDelete ? "Click again to delete" : "Delete"}
                aria-label={armedDelete ? "Confirm delete council" : "Delete council"}
                className={`${iconBtn} ${armedDelete ? "bg-accent-soft text-accent" : ""}`}><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <LogoStack seats={c.seats} size={26} />
            {isDefault && <span className="inline-flex items-center gap-1 text-[13px] font-medium text-accent"><Star className="h-3.5 w-3.5" /> Default council</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button data-testid="council-use-in-chat" onClick={() => requestCouncilInChat(c.id)} disabled={c.seats.length === 0} className={primaryBtn}>
              <MessageSquare className="h-4 w-4" /> Use in chat
            </button>
            {!isDefault && <button data-testid="council-make-default" onClick={() => save(councils, c.id)} className={secondaryBtn}><Star className="h-4 w-4" /> Make default</button>}
          </div>
        </div>

        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <h3 className={SECTION_TITLE}>Members</h3>
            <span className={META}>{c.seats.length}</span>
            <button data-testid="council-add-models" onClick={() => setAdding((v) => !v)} className={`${secondaryBtn} ml-auto`}>
              {adding ? <><Check className="h-4 w-4" /> Done</> : <><Plus className="h-4 w-4" /> Add models</>}
            </button>
          </div>
          {adding && <ModelChecklist catalog={catalog} picked={new Set(c.seats)} onToggle={toggleSeat} clis={available} />}
          {c.seats.length === 0 ? (
            <p className={`${META} rounded-xl border border-dashed border-border px-4 py-4`}>No models on this council yet. Add some to use it.</p>
          ) : (
            <div data-testid="council-members" className="divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface">
              {c.seats.map((k) => {
                const isChair = k === c.chair;
                const cost = seatCost(k);
                const ready = available.some((x) => x.id === k.split("::")[0]);
                return (
                  <div key={k} data-council-member={k} className="flex items-center gap-3 px-4 py-2.5">
                    <ProviderMark vendor={k.split("::")[0]} size={26} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-text-primary">{modelLabel(k)}</span>
                        {isChair && <span data-testid="council-chair-mark" className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-accent"><Crown className="h-3 w-3" /> Chair</span>}
                      </div>
                      <div className="truncate text-[12px] text-text-muted">{runtimeLabel(k, clis)}{ready ? "" : " · not set up on this Mac"}</div>
                    </div>
                    <span className="shrink-0 text-[12px] tabular-nums text-text-muted">{cost > 0 ? fmtUsd(cost) : "Free"}</span>
                    <button onClick={() => update(c.id, { chair: k })} disabled={isChair} title={isChair ? "Chairs the council" : "Make chair"}
                      aria-label={isChair ? `${modelLabel(k)} is the chair` : `Make ${modelLabel(k)} the chair`} className={`${iconBtn} ${isChair ? "text-accent" : ""}`}>
                      <Crown className="h-4 w-4" />
                    </button>
                    <button onClick={() => toggleSeat(k)} title="Remove" aria-label={`Remove ${modelLabel(k)}`} className={iconBtn}><X className="h-4 w-4" /></button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className={SECTION_TITLE}>Cost insight</h3>
          <CostInsight seats={c.seats} />
        </section>

        <section data-testid="council-auto" className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-3">
          <Scale className={`h-4 w-4 shrink-0 ${autoCouncil ? "text-accent" : "text-text-muted"}`} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-text-primary">Auto-convene the Default council on high-stakes questions</div>
            <div className="mt-0.5 text-[13px] text-text-secondary">Applies to every chat, whichever council is open here. Routine questions stay single-model.</div>
          </div>
          <Toggle on={autoCouncil} disabled={autoBusy} onChange={toggleAuto} label="Auto-convene the Default council on high-stakes questions" />
        </section>
      </div>
    );
  };

  return (
    <>
      <SettingsHeader title="Councils" icon={Scale} subtitle="Groups of models that answer together. A chair writes the verdict."
        right={<button data-testid="council-new" onClick={startNew} className={primaryBtn}><Plus className="h-4 w-4" /> New council</button>} />
      <SideSpine storageKey="prevail.council.spine" title="Councils" label="councils" testId="council-list"
        actions={<button onClick={startNew} title="New council" aria-label="New council" className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"><Plus className="h-4 w-4" /></button>}
        phone={phone} phoneDetail={phone && picked} onBack={() => setPicked(false)} backLabel="All councils"
        detail={<div className={phone ? "px-4 py-4" : "w-full px-8 py-6"}>{sel === "new" || !open ? builder : detail(open)}</div>}>
        {listEl}
      </SideSpine>
    </>
  );
}
