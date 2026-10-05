// What every first-class object shows beside its chat, notes and files
// (ia-plan.md): its links, from both sides, and the details its kind keeps.
//   Things   bought, warranty, value, maker (a Product), kept at (a Place),
//            and a service history.
//   Events   when, where, with whom, its project, and the calendar question,
//            which only the user's own click answers.
//   Products its app, when it has one: chat, activity, tools, connection
//            and skills, all on the product's own page.
// The engine owns every rule (`prevail entities set|link|links|service|
// event-calendar|event-project`); this draws them and sends the user's edits.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarCheck, CalendarX, ExternalLink, FolderKanban, Link2, Loader2, Pencil, Plus, Wrench, X } from "lucide-react";
import { invoke } from "./bridge";
import { requestEntity, slugifyName, useEntityStore, type EntityKindName } from "./entitystore";
import { openMission, useMissions } from "./missions";
import { AppLogo, SigninHelp, StatusPill } from "./appsmirror-parts";
import { RUNTIME_LABEL, RUNTIME_MARK, type MirrorApp, type MirrorList } from "./appsmirror-model";
import { ProviderMark } from "./marks";
import { useInvokeQuery } from "./query";
import { openApp } from "./appscope";
import { MirrorDetail } from "./appsmirror-detail";
import { AppScopeView } from "./appchat";
import { META } from "./typescale";
import { currentHead, fmtDay, kindOfId, KINDS, todayYmd, type AppRecord, type KindId, type LinkView, type ObjectFields } from "./ia";

const fire = (name: string) => window.dispatchEvent(new CustomEvent(name));
const iconBtn = "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40";
const textLink = "inline-flex h-8 shrink-0 items-center gap-1 text-[13px] font-medium text-accent hover:underline disabled:opacity-50 disabled:no-underline";
const inputCls = "h-8 min-w-0 rounded-lg border border-border bg-background px-2.5 text-[14px] text-text-primary outline-none focus:border-accent-border";

/** Open any object where it lives: an entity or event page, or a project. */
export function openObject(id: string): void {
  const [raw, ...rest] = id.split("/");
  const head = currentHead(raw ?? "");
  const slug = rest.join("/");
  if (head === "mission" || head === "project") { openMission(slug); return; }
  if (head === "app") { openApp({ id: slug, tab: "chat" }); return; }
  if (["person", "place", "product", "thing", "event"].includes(head!)) requestEntity({ kind: head as EntityKindName, value: slug });
}

/** A kind's icon for an id (person/..., event/..., mission/...). */
export function ObjectIcon({ id, className = "h-4 w-4" }: { id: string; className?: string }) {
  const k = kindOfId(id);
  if (!k) return null;
  return <k.icon aria-hidden className={className} />;
}

function Section({ title, right, children, testId }: { title: string; right?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="mt-7" data-testid={testId}>
      <div className="mb-2 flex items-center gap-2"><h3 className="min-w-0 flex-1 text-[15px] font-semibold text-text-primary">{title}</h3>{right}</div>
      {children}
    </section>
  );
}

// ── Links ───────────────────────────────────────────────────────────────────

const ROLE_LABEL: Record<string, string> = { place: "Where", maker: "Made by", project: "Project", people: "With", here: "Here", made: "Made", event: "Event", with: "With" };

/** Pick any object to link: people, places, products, things, events and projects, by name. */
function LinkPicker({ vaultPath, self, have, onPick, onClose }: { vaultPath: string; self: string; have: Set<string>; onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const store = useEntityStore();
  const { missions } = useMissions(vaultPath);
  const all = useMemo(() => [
    ...(store.list?.entities ?? []).filter((e) => e.kind !== "project").map((e) => ({ id: e.id, name: e.name, n: e.conversations + (e.saved ? 100 : 0) })),
    ...missions.filter((m) => m.status !== "archived").map((m) => ({ id: `mission/${m.slug}`, name: m.name, n: 1000 })),
  ], [store.list, missions]);
  const needle = q.trim().toLowerCase();
  const hits = all.filter((x) => x.id !== self && !have.has(x.id) && (!needle || x.name.toLowerCase().includes(needle))).sort((a, b) => b.n - a.n).slice(0, 8);
  return (
    <div className="mt-2 rounded-lg border border-border bg-surface p-2" data-testid="link-picker">
      <div className="flex items-center gap-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Link to a person, place, product, thing, event or project" aria-label="Link to"
          onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "Enter" && hits[0]) onPick(hits[0].id); }}
          className={`${inputCls} flex-1`} />
        <button type="button" onClick={onClose} className={iconBtn} title="Close" aria-label="Close"><X className="h-4 w-4" /></button>
      </div>
      <ul className="mt-1">
        {hits.map((h) => (
          <li key={h.id}>
            <button type="button" onClick={() => onPick(h.id)} data-testid="link-option" className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[14px] text-text-primary hover:bg-surface-warm">
              <ObjectIcon id={h.id} className="h-4 w-4 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1 truncate">{h.name}</span>
              <span className={META}>{kindOfId(h.id)?.singular}</span>
            </button>
          </li>
        ))}
        {!hits.length && <li className={`${META} px-2 py-1.5`}>Nothing by that name.</li>}
      </ul>
    </div>
  );
}

export function LinksPane({ vaultPath, id }: { vaultPath: string; id: string }) {
  const [links, setLinks] = useState<LinkView[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const r = await invoke<{ links: LinkView[] }>("ia_links", { vault: vaultPath, id }); setLinks(Array.isArray(r?.links) ? r.links : []); }
    catch (e) { setErr(String(e)); setLinks([]); }
  }, [vaultPath, id]);
  useEffect(() => { void load(); }, [load]);
  const link = async (other: string, remove = false) => {
    setErr(null);
    try { await invoke("ia_link", { vault: vaultPath, a: id, b: other, remove }); setAdding(false); await load(); fire("prevail:entities-changed"); }
    catch (e) { setErr(String(e)); }
  };
  const groups = KINDS.map((k) => ({ k, items: (links ?? []).filter((l) => l.kind === k.id) })).filter((g) => g.items.length);
  return (
    <div className="pt-4" data-testid="object-links">
      <div className="flex items-center gap-2">
        <p className={`${META} min-w-0 flex-1`}>{links === null ? "Reading links" : links.length ? "Linked both ways: each shows here and on the other side." : "Nothing linked yet."}</p>
        <button type="button" onClick={() => setAdding((v) => !v)} data-testid="link-add" className={textLink}><Plus className="h-3.5 w-3.5" />Link</button>
      </div>
      {adding && <LinkPicker vaultPath={vaultPath} self={id} have={new Set((links ?? []).map((l) => l.id))} onPick={(o) => void link(o)} onClose={() => setAdding(false)} />}
      {err && <p className="mt-2 text-[13px] text-err">{err}</p>}
      {groups.map(({ k, items }) => (
        <section key={k.id} className="mt-4">
          <h4 className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-text-secondary"><k.icon aria-hidden className="h-3.5 w-3.5 text-text-muted" />{k.label}</h4>
          <ul className="-mx-2">
            {items.map((l) => (
              <li key={l.id} className="group flex items-center rounded-lg hover:bg-surface-warm">
                <button type="button" onClick={() => openObject(l.id)} data-testid="object-link" className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-text-primary">{l.name}</span>
                  {l.role && <span className={`${META} shrink-0`}>{ROLE_LABEL[l.role] ?? l.role}</span>}
                  {l.via === "project" && !l.role && <span className={`${META} shrink-0`}>In the project</span>}
                </button>
                {l.via === "link" && (
                  <button type="button" onClick={() => void link(l.id, true)} title="Unlink" aria-label={`Unlink ${l.name}`}
                    className={`${iconBtn} mr-1 opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(pointer:coarse)]:opacity-100`}><X className="h-3.5 w-3.5" /></button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ── Fields ──────────────────────────────────────────────────────────────────

/** One detail row: a label, its value (a link when it names an object), a tiny pencil. */
function FieldRow({ label, value, objectId, edit, type = "text", onSave, testId }: {
  label: string; value: string; objectId?: string; edit?: string; type?: "text" | "date" | "time" | "number"; onSave: (v: string) => Promise<void>; testId?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await onSave(draft ?? ""); setDraft(null); } finally { setBusy(false); } };
  return (
    <div className="group flex min-h-9 items-center gap-3 border-b border-border-subtle/70 py-1" data-testid={testId}>
      <span className="w-32 shrink-0 text-[13px] text-text-muted">{label}</span>
      {draft !== null ? (
        <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <input autoFocus type={type} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={label} className={`${inputCls} flex-1`}
            onKeyDown={(e) => { if (e.key === "Escape") setDraft(null); }} />
          <button type="submit" disabled={busy} className={textLink}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save</button>
        </form>
      ) : (
        <>
          {value && objectId
            ? <button type="button" onClick={() => openObject(objectId)} className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left text-[14px] font-medium text-text-primary hover:text-accent"><ObjectIcon id={objectId} className="h-3.5 w-3.5 shrink-0 text-text-muted" />{value}</button>
            : <span className={`min-w-0 flex-1 truncate text-[14px] ${value ? "text-text-primary" : "text-text-muted"}`}>{value || "Not set"}</span>}
          <button type="button" onClick={() => setDraft(edit ?? "")} title={`Change ${label.toLowerCase()}`} aria-label={`Change ${label.toLowerCase()}`}
            className={`${iconBtn} opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(pointer:coarse)]:opacity-100`}><Pencil className="h-3.5 w-3.5" /></button>
        </>
      )}
    </div>
  );
}

const nameOfRef = (ref: string | undefined, known: (id: string) => string | undefined) => (ref ? known(ref) ?? ref.slice(ref.indexOf("/") + 1).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "");

function useNameOf() {
  const store = useEntityStore();
  return (id: string) => store.byId.get(id)?.name;
}

export function ThingDetails({ vaultPath, id, fields, onChanged }: { vaultPath: string; id: string; fields: ObjectFields; onChanged: () => Promise<void> }) {
  const known = useNameOf();
  const [err, setErr] = useState<string | null>(null);
  const [svc, setSvc] = useState<{ what: string; date: string; cost: string } | null>(null);
  const set = (field: string) => async (value: string) => {
    setErr(null);
    try { await invoke("ia_set_field", { vault: vaultPath, id, field, value }); await onChanged(); fire("prevail:entities-changed"); }
    catch (e) { setErr(String(e)); throw e; }
  };
  const addService = async () => {
    if (!svc?.what.trim()) return;
    setErr(null);
    try { await invoke("ia_service", { vault: vaultPath, id, what: svc.what, date: svc.date || null, cost: svc.cost || null }); setSvc(null); await onChanged(); }
    catch (e) { setErr(String(e)); }
  };
  const warrantyLeft = fields.warranty ? (fields.warranty >= todayYmd() ? "covered" : "ended") : "";
  return (
    <>
      <Section title="Details" testId="thing-details">
        <FieldRow label="Bought" value={fmtDay(fields.purchased)} edit={fields.purchased} type="date" onSave={set("purchased")} testId="thing-purchased" />
        <FieldRow label="Warranty until" value={fields.warranty ? `${fmtDay(fields.warranty)}, ${warrantyLeft}` : ""} edit={fields.warranty} type="date" onSave={set("warranty")} testId="thing-warranty" />
        <FieldRow label="Value" value={fields.value != null ? `$${fields.value.toLocaleString()}` : ""} edit={fields.value != null ? String(fields.value) : ""} onSave={set("value")} testId="thing-value" />
        <FieldRow label="Made by" value={nameOfRef(fields.maker, known)} objectId={fields.maker} edit={nameOfRef(fields.maker, known)} onSave={set("maker")} testId="thing-maker" />
        <FieldRow label="Kept at" value={nameOfRef(fields.place, known)} objectId={fields.place} edit={nameOfRef(fields.place, known)} onSave={set("place")} testId="thing-place" />
      </Section>
      <Section title="Service history" testId="thing-service"
        right={<button type="button" onClick={() => setSvc(svc ? null : { what: "", date: todayYmd(), cost: "" })} className={textLink} data-testid="thing-service-add"><Plus className="h-3.5 w-3.5" />Add</button>}>
        {svc && (
          <form className="mb-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void addService(); }}>
            <input autoFocus value={svc.what} onChange={(e) => setSvc({ ...svc, what: e.target.value })} placeholder="What was done" aria-label="What was done" className={`${inputCls} min-w-[12rem] flex-1`} />
            <input type="date" value={svc.date} onChange={(e) => setSvc({ ...svc, date: e.target.value })} aria-label="When" className={inputCls} />
            <input inputMode="decimal" value={svc.cost} onChange={(e) => setSvc({ ...svc, cost: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="Cost" aria-label="Cost" className={`${inputCls} w-24`} />
            <button type="submit" className={textLink}>Save</button>
          </form>
        )}
        {fields.service?.length ? (
          <ul>
            {[...fields.service].reverse().map((s, i) => (
              <li key={`${s.date}:${i}`} className="flex items-center gap-3 py-1.5">
                <Wrench aria-hidden className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1 truncate text-[14px] text-text-primary">{s.what}</span>
                <span className={`${META} shrink-0 tabular-nums`}>{fmtDay(s.date)}{s.cost != null ? ` · $${s.cost.toLocaleString()}` : ""}</span>
              </li>
            ))}
          </ul>
        ) : !svc && <p className={META}>No service yet.</p>}
      </Section>
      {err && <p className="mt-2 text-[13px] text-err">{err}</p>}
    </>
  );
}

export function EventDetails({ vaultPath, id, fields, onChanged }: { vaultPath: string; id: string; fields: ObjectFields; onChanged: () => Promise<void> }) {
  const known = useNameOf();
  const { missions } = useMissions(vaultPath);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pick, setPick] = useState(false);
  const run = async (key: string, f: () => Promise<unknown>) => {
    setBusy(key); setErr(null);
    try { await f(); await onChanged(); fire("prevail:entities-changed"); fire("prevail:events-changed"); fire("prevail:missions-changed"); }
    catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };
  const set = (field: string) => async (value: string) => { await run(field, () => invoke("ia_set_field", { vault: vaultPath, id, field, value })); };
  const project = fields.project ? missions.find((m) => `mission/${m.slug}` === fields.project) : undefined;
  const passed = !!fields.date && fields.date < todayYmd();
  const calendar = fields.calendar === "synced"
    ? <p className="flex items-center gap-1.5 text-[14px] text-text-secondary" data-testid="event-calendar-synced"><CalendarCheck aria-hidden className="h-4 w-4 text-ok" />On your calendar</p>
    : fields.calendar === "declined"
    ? <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-text-muted" data-testid="event-calendar-declined"><span className="inline-flex items-center gap-1.5"><CalendarX aria-hidden className="h-4 w-4" />Kept off your calendar</span>
        <button type="button" onClick={() => void run("cal", () => invoke("ia_event_calendar", { vault: vaultPath, id, answer: "yes" }))} className={textLink}>Add it after all</button></p>
    : passed ? null
    : (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="event-calendar-ask">
        <p className="min-w-0 flex-1 basis-56 text-[14px] text-text-secondary">Add it to your calendar? Nothing is added until you say yes.</p>
        <button type="button" disabled={!!busy || !fields.date} data-testid="event-calendar-yes" onClick={() => void run("cal", () => invoke("ia_event_calendar", { vault: vaultPath, id, answer: "yes" }))}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50">
          {busy === "cal" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarCheck className="h-3.5 w-3.5" />}Add to calendar
        </button>
        <button type="button" disabled={!!busy} data-testid="event-calendar-no" onClick={() => void run("cal", () => invoke("ia_event_calendar", { vault: vaultPath, id, answer: "no" }))} className="text-[13px] text-text-muted hover:text-text-primary">Not now</button>
      </div>
    );
  return (
    <>
      <Section title="When and where" testId="event-details">
        <FieldRow label="Date" value={fmtDay(fields.date)} edit={fields.date} type="date" onSave={set("date")} testId="event-date" />
        <FieldRow label="Time" value={fields.time ?? ""} edit={fields.time} type="time" onSave={set("time")} testId="event-time" />
        <FieldRow label="Ends" value={fields.end && fields.end !== fields.date ? fmtDay(fields.end) : ""} edit={fields.end} type="date" onSave={set("end")} />
        <FieldRow label="Where" value={nameOfRef(fields.place, known)} objectId={fields.place} edit={nameOfRef(fields.place, known)} onSave={set("place")} testId="event-place" />
        <FieldRow label="With" value={(fields.people ?? []).map((p) => nameOfRef(p, known)).join(", ")} edit={(fields.people ?? []).map((p) => nameOfRef(p, known)).join(", ")} onSave={set("people")} testId="event-people" />
      </Section>
      <Section title="Project" testId="event-project">
        {project || fields.project ? (
          <button type="button" onClick={() => openMission(fields.project!)} data-testid="event-project-open" className="inline-flex items-center gap-2 text-[14px] font-medium text-text-primary hover:text-accent">
            <FolderKanban aria-hidden className="h-4 w-4 text-accent" />{project?.name ?? nameOfRef(fields.project, () => undefined)}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {!passed && fields.date && (
              <button type="button" disabled={!!busy} onClick={() => void run("project", () => invoke("ia_event_project", { vault: vaultPath, id, project: null }))} data-testid="event-make-project" className={textLink}>
                {busy === "project" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderKanban className="h-3.5 w-3.5" />}Make it a project
              </button>
            )}
            <button type="button" onClick={() => setPick((v) => !v)} data-testid="event-link-project" className={textLink}><Link2 className="h-3.5 w-3.5" />Link to a project</button>
            {pick && (
              <select aria-label="Project" className={inputCls} defaultValue="" onChange={(e) => { const v = e.target.value; if (v) { setPick(false); void run("project", () => invoke("ia_event_project", { vault: vaultPath, id, project: `mission/${v}` })); } }}>
                <option value="">Choose a project</option>
                {missions.filter((m) => m.status === "active" || m.status === "paused").map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
              </select>
            )}
          </div>
        )}
      </Section>
      {calendar && <Section title="Calendar">{calendar}</Section>}
      {err && <p className="mt-2 text-[13px] text-err">{err}</p>}
    </>
  );
}

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "");
/** The connectors (from the user's AI runtimes) that are this product's apps: by id, or by name. */
export function connectorsFor(all: MirrorApp[], productName: string, apps: AppRecord[], slug?: string): MirrorApp[] {
  const names = new Set([productName, ...apps.map((a) => a.title)].map(norm).filter(Boolean));
  const ids = new Set([...apps.map((a) => a.id), ...(slug ? [slug] : [])]);
  return all.filter((m) => ids.has(m.id) || ids.has(m.id.split(":").pop() ?? "") || names.has(norm(m.name)));
}

/** Its connectors and app records, read once for the product's page. */
export function useProductApp(vaultPath: string, name: string, apps: AppRecord[], slug: string, enabled = true): { connector: MirrorApp | null; connectors: MirrorApp[]; app: AppRecord | null } {
  const q = useInvokeQuery<MirrorList>("apps_mirror_list", enabled ? { vault: vaultPath } : null, { staleMs: Infinity });
  const live = apps.filter((a) => !a.archived);
  const connectors = connectorsFor(Array.isArray(q.data?.apps) ? q.data!.apps : [], name, live, slug);
  return { connector: connectors[0] ?? null, connectors, app: live[0] ?? null };
}

/** The skills its folder carries (data/entities/products/<id>/skills), from the vault scan. */
export function ProductSkills({ vaultPath, appIds }: { vaultPath: string; appIds: string[] }) {
  const q = useInvokeQuery<{ domain: string; name: string; description?: string | null }[]>("scan_skills", appIds.length ? { vault: vaultPath } : null, { staleMs: 60_000 });
  const skills = (Array.isArray(q.data) ? q.data : []).filter((s) => appIds.includes(s.domain));
  if (!skills.length) return null;
  return (
    <Section title="Skills" testId="product-skills">
      <ul className="-mx-2">
        {skills.map((s) => (
          <li key={`${s.domain}/${s.name}`} data-testid="product-skill" className="flex items-center gap-3 rounded-lg px-2 py-1.5">
            <Wrench aria-hidden className="h-4 w-4 shrink-0 text-text-muted" />
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-text-primary" title={s.description ?? undefined}>{s.name}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * A product's connection on its overview: each connector it has in an AI
 * runtime, with its status, the runtime it comes through and how to sign in
 * when it needs to. The arrow opens the product's App tab.
 */
export function ProductConnection({ connectors, onOpen }: { connectors: MirrorApp[]; onOpen: (tab: "chat" | "connection") => void }) {
  if (!connectors.length) return null;
  return (
    <Section title="Connection" testId="product-connection">
      <ul className="-mx-2">
        {connectors.map((m) => (
          <li key={m.id} data-testid="product-connector" data-id={m.id} className="rounded-lg px-2 py-1.5">
            <div className="flex items-center gap-3">
              <span className="relative inline-flex shrink-0">
                <AppLogo name={m.name} url={m.url} size={22} />
                <span className="absolute -bottom-1 -right-1 rounded-[3px] ring-2 ring-surface" aria-hidden><ProviderMark vendor={RUNTIME_MARK[m.runtime] ?? m.runtime} size={9} /></span>
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-text-primary">{m.name}<span className={`${META} ml-2 font-normal`}>via {RUNTIME_LABEL[m.runtime] ?? m.runtime}</span></span>
              <StatusPill status={m.status} compact />
              <button type="button" onClick={() => onOpen("connection")} title={`Open ${m.name}'s connection`} aria-label={`Open ${m.name}'s connection`} data-testid="product-open-app"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-warm hover:text-accent">
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>
            {m.status !== "connected" && <div className="mt-1.5 pl-[34px]"><SigninHelp app={m} compact /></div>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * The product's App tab: the app's own chat, activity, tools and connection,
 * the view that used to live in a separate Apps area. A runtime connector
 * gets the full view (sync recipe, tools); an app kept only in the vault gets
 * its chat and activity, with its skills under Connection.
 */
export function ProductAppPane({ vaultPath, connector, app, name, domains = [] }: {
  vaultPath: string; connector: MirrorApp | null; app: AppRecord | null; name: string; domains?: string[];
}) {
  if (connector) return <MirrorDetail key={connector.id} app={connector} vaultPath={vaultPath} domains={domains} onChanged={() => {}} embedded />;
  if (!app) return null;
  return (
    <AppScopeView embedded vaultPath={vaultPath} app={{ id: app.id, name: app.title || name, url: app.domains[0] ? `https://${app.domains[0]}` : undefined }}
      subtitle="Kept in your vault"
      connection={<ProductSkills vaultPath={vaultPath} appIds={[app.id]} />} />
  );
}

/** A slug-only id for an entity kind: the entity view's target. */
export const targetOfId = (id: string) => ({ kind: id.split("/")[0] as EntityKindName, value: id.slice(id.indexOf("/") + 1) });
export const idOf = (kind: string, name: string) => `${kind}/${slugifyName(name)}`;
export type { KindId };
