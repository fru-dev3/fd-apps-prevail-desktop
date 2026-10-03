// One entity's detail: what the vault knows about one person, place, company
// or thing, shown in the Entities view's detail pane (never a side card).
// Everything comes from `prevail entities show`; the owner's notes are edited
// here and written back to the page's "Your notes" section only.
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { Bookmark, BookOpen, CalendarDays, Check, Copy, FileText, FolderKanban, FolderOpen, GitMerge, Globe, Image as ImageIcon, Loader2, PenLine, MapPin, MessageSquare, MessagesSquare, Package, Plus, RefreshCw, Terminal, User, Watch } from "lucide-react";
import { invoke } from "./bridge";
import { invokeCached, peekInvoke } from "./query";
import { CARD_KINDS, EntityChip, OrgMark, entityIdOf, openMap, type EntityKind } from "./entities";
import { entitySnapshot } from "./entitystore";
import { Markdown } from "./Markdown";
import { pickSkillColor } from "./sectionutil";
import { loadEntityThreads, type EntityThread } from "./entitythreads";
import { useIsPhone } from "./useisphone";
import { AvatarImg, ENCRYPTED_NOTE, useEntityPicture, useVaultEncrypted, type AvatarEntity } from "./entityavatar";

import { DetailTitle, META } from "./typescale";
import { RowMenu, type RowMenuItem } from "./ui";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { EntityFiles } from "./entityfiles";
import { AppActivity } from "./appactivity";
import type { EntityChatRequest } from "./entitychat";
import { AcrossYourLife, DomainChip, isYours, setRelation, type Relation } from "./linking";
import { EventDetails, LinksPane, ProductApps, ProductConnection, ThingDetails } from "./objectparts";
import type { AppRecord, ObjectFields } from "./ia";

// The chat is the whole chat panel, so it is its own chunk. A detail starts
// fetching it as it mounts, so the Chat tab paints at once when clicked.
const loadChat = () => import("./entitychat");
const EntityChat = lazy(() => loadChat().then((m) => ({ default: m.EntityChat })));

type Tab = "overview" | "chat" | "links" | "notes" | "conversations" | "files" | "brief";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "chat", label: "Chat" }, { id: "links", label: "Links" }, { id: "notes", label: "Notes" },
  { id: "conversations", label: "Conversations" }, { id: "files", label: "Files" },
];
// A project's detail: its own Overview, and a Brief tab when it came from Intent.
const PROJECT_TABS: Tab[] = ["overview", "chat", "notes", "files"];
const PICTURE_TYPES = ["png", "jpg", "jpeg", "webp", "svg"];

// The entity's folder in the vault, from its page path: data/entities/<kind>/
// <slug>/entity.md, or an old flat <slug>.md not yet moved into a folder.
export function entityFolder(pagePath: string | undefined): string | null {
  if (!pagePath) return null;
  return pagePath.endsWith("/entity.md") ? pagePath.slice(0, -"/entity.md".length) : pagePath.replace(/\.md$/, "");
}

// A dropped file as base64 (no data: prefix) or as a data: URI.
function readDropped(f: File, asUri: boolean): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => { const v = String(r.result ?? ""); res(asUri ? v : v.slice(v.indexOf(",") + 1)); };
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
}

// What the Chat tab shows while its chunk arrives: the chat's shape, not a blank.
function ChatSkeleton() {
  return (
    <div data-testid="entity-chat-skeleton" aria-busy="true" className="flex min-h-0 flex-1 flex-col justify-end gap-3 py-4">
      <div className="h-4 w-2/3 animate-pulse rounded bg-surface-warm" />
      <div className="ml-auto h-4 w-1/2 animate-pulse rounded bg-surface-warm" />
      <div className="h-24 animate-pulse rounded-xl border border-border bg-surface-warm/60" />
    </div>
  );
}

export interface EntityMention { source: "thread" | "prompt" | "brief"; ref: string; domain: string; project: string; title: string; tool?: string; ts: number; snippet: string }
export interface EntityDetail {
  found: boolean;
  query?: string;
  id: string; name: string; kind: EntityKind; aliases: string[]; kinds: EntityKind[];
  mention_count: number; conversations: number; last_ts: number;
  mentions: EntityMention[]; co_mentions: { id: string; name: string; kind: EntityKind; count: number }[];
  page?: string; page_path?: string; saved?: boolean; domain?: string; digest: string; notes: string;
  picture?: string; website?: string;
  relation?: Relation; relation_confidence?: number; home_domain?: string;
  // A project (kind "project"): its frontmatter and the goals that name it.
  status?: string; outcome?: string; target?: string; domains?: string[]; intent_project?: string;
  goals?: { title: string; status: string; domain: string }[];
  // Entities and Activities: a thing's or an event's fields, a product's app records.
  fields?: ObjectFields;
  apps?: AppRecord[];
  // What was merged into it, oldest first (the engine's provenance).
  merged_from?: { id: string; name: string; ts: string; auto: boolean }[];
}

export const KIND_LABEL: Record<string, string> = { person: "Person", place: "Place", org: "Product", thing: "Thing", event: "Event", project: "Project" };
const KIND_ICON = { person: User, place: MapPin, org: Package, thing: Watch, event: CalendarDays, project: FolderKanban } as const;

// Aliases worth showing: those that differ from the name (and each other)
// beyond case, punctuation and spacing.
const squash = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export function distinctAliases(name: string, aliases: string[]): string[] {
  const seen = new Set([squash(name)]);
  return aliases.filter((a) => { const k = squash(a); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}
const fmtDay = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });

function fire(name: string, detail?: unknown) { window.dispatchEvent(new CustomEvent(name, { detail })); }

export function KindBadge({ kind, name, domain, size = 44, entity }: { kind: EntityKind; name: string; domain?: string; size?: number; entity?: AvatarEntity }) {
  const box = { width: size, height: size };
  const src = useEntityPicture(entity ? { ...entity, kind } : null);
  if (src) return <AvatarImg src={src} size={size} round={kind === "person"} />;
  if (kind === "person") {
    const { bg, fg } = pickSkillColor(name);
    const words = name.replace(/[^\p{L}\p{N}\s]/gu, "").trim().split(/\s+/).filter(Boolean);
    const ini = words.length ? (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase() : "?";
    return <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full font-bold" style={{ ...box, backgroundColor: bg, color: fg, fontSize: size * 0.36 }}>{ini}</span>;
  }
  if (kind === "org") return <span aria-hidden className="flex shrink-0 items-center justify-center rounded-xl border border-border bg-surface-warm text-text-secondary" style={box}><OrgMark name={name} host={domain} size={Math.round(size * 0.6)} /></span>;
  const Icon = kind === "place" ? MapPin : kind === "event" ? CalendarDays : Watch;
  return <span aria-hidden className="flex shrink-0 items-center justify-center rounded-xl border border-accent-border bg-accent-soft text-accent" style={box}><Icon style={{ width: size * 0.5, height: size * 0.5 }} /></span>;
}

// A still, drawn map tile for a place (no map service is contacted until the
// owner opens the real map).
function PlaceMap({ name }: { name: string }) {
  return (
    <button type="button" onClick={() => openMap(name)} title={`Open ${name} in Maps`} data-testid="entity-map"
      className="group relative block h-36 w-full overflow-hidden rounded-xl border border-border bg-surface-warm text-left">
      <svg aria-hidden className="absolute inset-0 h-full w-full text-border" preserveAspectRatio="none" viewBox="0 0 400 144">
        <path d="M0 40 H400 M0 96 H400 M70 0 V144 M190 0 V144 M320 0 V144" stroke="currentColor" strokeWidth="1" fill="none" />
        <path d="M-10 130 C 90 80, 150 120, 230 60 S 360 10, 410 30" stroke="currentColor" strokeWidth="7" fill="none" opacity="0.7" />
        <path d="M120 -10 C 140 50, 110 90, 160 160" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.6" />
      </svg>
      <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-[70%] flex-col items-center">
        <MapPin className="h-8 w-8 fill-accent-soft text-accent drop-shadow" />
      </span>
      <span className="absolute bottom-2 left-2 right-2 truncate rounded-md bg-background/90 px-2 py-1 text-[13px] font-medium text-text-primary group-hover:text-accent">{name}</span>
    </button>
  );
}

function openMention(m: EntityMention) {
  if (m.source === "prompt") {
    try { localStorage.setItem("prevail.intent.focus", String(m.ts)); } catch { /* storage off */ }
    fire("prevail:open-settings", "intent");
    fire("prevail:intent-focus", m.ts);
    return;
  }
  if (m.source === "thread" && m.domain && !m.domain.startsWith("_")) {
    fire("prevail:open-thread", { domain: m.domain, ref: m.ref });
    return;
  }
  fire("prevail:open-vault-file", m.ref);
}

function MentionRow({ m }: { m: EntityMention }) {
  const Icon = m.source === "prompt" ? Terminal : m.source === "brief" ? FileText : MessagesSquare;
  const where = m.source === "prompt"
    ? `${m.tool ? `${m.tool[0].toUpperCase()}${m.tool.slice(1)}` : "Prompt"}${m.title && m.title !== "Other" ? ` · ${m.title}` : ""}`
    : m.title || m.ref.split("/").pop();
  return (
    <li>
      <button type="button" onClick={() => openMention(m)} data-testid="entity-mention"
        className="flex w-full gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-warm">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-text-primary">{where}</span>
            <span className="shrink-0 text-[12px] text-text-muted">{fmtDay(m.ts)}</span>
          </span>
          {m.snippet && <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-text-secondary">{m.snippet}</span>}
        </span>
      </button>
    </li>
  );
}

// Apps used: a section only when an app was called about it.
function AppsUsed({ vaultPath, entity }: { vaultPath: string; entity: string }) {
  return <AppActivity vaultPath={vaultPath} filter={{ entity, limit: 50 }} showApp hideEmpty empty="" heading={<h3 className="mb-2 mt-7 text-[15px] font-semibold text-text-primary">Apps used</h3>} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h3 className="mb-2 text-[15px] font-semibold text-text-primary">{title}</h3>
      {children}
    </section>
  );
}

// `overview` replaces the Overview body (a project draws its own), `brief`
// adds a Brief tab, and `meta` replaces the line under the name.
export function EntityDetailView({ vaultPath, target, overview, brief, meta }: {
  vaultPath: string; target: { kind: EntityKind; value: string };
  overview?: (d: EntityDetail, reload: () => Promise<void>) => ReactNode; brief?: ReactNode; meta?: string;
}) {
  const id = entityIdOf({ kind: target.kind, value: target.value });
  const phone = useIsPhone();
  const [d, setD] = useState<EntityDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"save" | "notes" | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [dropping, setDropping] = useState(false);
  const [filesSeen, setFilesSeen] = useState(false);
  const [briefSeen, setBriefSeen] = useState(false);
  const [linksSeen, setLinksSeen] = useState(false);
  useEffect(() => { if (tab === "files") setFilesSeen(true); if (tab === "brief") setBriefSeen(true); if (tab === "links") setLinksSeen(true); }, [tab]);
  // The website field (orgs), open while not null.
  const [site, setSite] = useState<string | null>(null);
  // The rename field, open while not null.
  const [rename, setRename] = useState<string | null>(null);
  // null until the Chat tab is first opened; then the panel stays mounted so
  // switching tabs never loses the conversation or a draft.
  const [chatReq, setChatReq] = useState<EntityChatRequest | null>(null);
  const [chatSlug, setChatSlug] = useState<string | null>(null);
  // A slug-only chip (prevail://person/sam-rivera) shows the page's own name.
  const known = entitySnapshot().byId.get(id);
  const displayName = d?.found ? d.name : (known?.name ?? target.value);

  useEffect(() => { const t = window.setTimeout(() => { void loadChat(); }, 0); return () => window.clearTimeout(t); }, []);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await invokeCached<EntityDetail>("entities_show", { vault: vaultPath, id: `${target.kind}/${target.value}` }, { force: true });
      setD(r);
      setNotes(r.found ? r.notes : "");
    } catch (e) { setErr(String(e)); }
  }, [vaultPath, target.kind, target.value]);
  // A card seen before paints from the shared cache while it reloads.
  useEffect(() => {
    const c = peekInvoke<EntityDetail>("entities_show", { vault: vaultPath, id: `${target.kind}/${target.value}` }) ?? null;
    setD(c);
    if (c) setNotes(c.found ? c.notes : "");
    void load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const writeId = d?.found ? d.id : `${target.kind}/${target.value}`;
  const pic = useEntityPicture(d?.found ? { id: d.id, kind: d.kind, picture: d.picture, website: d.website } : known ?? null);
  // null while unknown; pictures and files stay off until it is known false.
  const encrypted = useVaultEncrypted(vaultPath);
  const afterWrite = async () => { await load(); fire("prevail:entities-changed"); };
  const setPicture = async (args: { file?: string; dataUri?: string }) => {
    setErr(null);
    try { await invoke("engine_entities_set_picture", { vault: vaultPath, id: writeId, ...args }); await afterWrite(); }
    catch (e) { setErr(String(e)); }
  };
  const pickPicture = async () => {
    const f = await openDialog({ multiple: false, filters: [{ name: "Picture", extensions: PICTURE_TYPES }] }).catch(() => null);
    if (typeof f === "string" && f) await setPicture({ file: f });
  };
  const dropPicture = async (f: File) => {
    if (encrypted !== false) { setErr(ENCRYPTED_NOTE); return; }
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(f.type)) { setErr("A picture must be a PNG, JPEG, WebP or SVG file."); return; }
    if (f.size > 5 * 1024 * 1024) { setErr("A picture can be up to 5 MB."); return; }
    await setPicture({ dataUri: await readDropped(f, true) });
  };
  const saveWebsite = async () => {
    setErr(null);
    try { await invoke("engine_entities_set_website", { vault: vaultPath, id: writeId, url: (site ?? "").trim() }); setSite(null); await afterWrite(); }
    catch (e) { setErr(String(e)); }
  };
  const saveName = async () => {
    const name = (rename ?? "").trim();
    if (!name) return;
    setErr(null);
    try {
      const r = await invoke<EntityDetail>("engine_entities_rename", { vault: vaultPath, id: writeId, name });
      setD({ ...r, found: true }); setRename(null);
      fire("prevail:entities-changed");
    } catch (e) { setErr(String(e)); }
  };
  const save = async () => {
    setBusy("save");
    try {
      const r = await invoke<EntityDetail>("entities_save", { vault: vaultPath, id: writeId, name: displayName });
      setD({ ...r, found: true });
      fire("prevail:entities-changed");
    } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };
  const saveNotes = async () => {
    setBusy("notes");
    try {
      const r = await invoke<EntityDetail>("entities_note", { vault: vaultPath, id: writeId, text: notes, name: displayName });
      setD({ ...r, found: true });
      setSavedNote(true);
      window.setTimeout(() => setSavedNote(false), 1800);
      fire("prevail:entities-changed");
    } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };

  // The conversations about it, fetched alongside the detail (never after
  // it): the engine resolves the target id itself, and a merged id resolves
  // to its keeper.
  const [threads, setThreads] = useState<EntityThread[] | null>(null);
  const threadsId = d?.found ? d.id : `${target.kind}/${target.value}`;
  const pullThreads = useCallback(() => loadEntityThreads(vaultPath, threadsId).then((l) => { setThreads(l); return l; }), [vaultPath, threadsId]);
  useEffect(() => {
    let alive = true;
    const pull = () => { void loadEntityThreads(vaultPath, threadsId).then((l) => { if (alive) setThreads(l); }); };
    pull();
    window.addEventListener("prevail:threads-changed", pull);
    return () => { alive = false; window.removeEventListener("prevail:threads-changed", pull); };
  }, [vaultPath, threadsId]);

  const openChat = (thread?: string | null) => {
    setChatReq((p) => (thread === undefined && p ? p : { thread, n: (p?.n ?? 0) + 1 }));
    setTab("chat");
  };

  const kind = (d?.found ? d.kind : target.kind) as EntityKind;
  const hasPage = !!(d?.found && d.page_path);
  const notesDirty = notes !== (d?.found ? d.notes : "");
  const KindIcon = KIND_ICON[kind as keyof typeof KIND_ICON] ?? Watch;
  const isProject = kind === "project";
  const tabs = isProject ? [...TABS.filter((t) => PROJECT_TABS.includes(t.id)), ...(brief ? [{ id: "brief" as Tab, label: "Brief" }] : [])] : TABS;
  const aliases = d?.found ? distinctAliases(d.name, d.aliases) : [];
  const root = vaultPath.replace(/\/+$/, "");
  const absPath = hasPage ? `${root}/${d!.page_path}` : null;
  const folder = hasPage ? entityFolder(d!.page_path) : null;
  const absFolder = folder ? `${root}/${folder}` : null;
  // Yours or a reference: the engine's call, or the owner's override.
  const relation: Relation = isYours(d?.found ? d : known) ? "yours" : "reference";
  const homeDomain = (d?.found ? d.home_domain : undefined) ?? known?.home_domain;
  const markAs = async (r: Relation) => {
    setErr(null);
    try { await setRelation(vaultPath, writeId, r); await load(); }
    catch (e) { setErr(String(e)); }
  };
  const menu: RowMenuItem[] = [
    ...(phone ? [{ icon: MessageSquare, label: "Chat", onClick: () => openChat() }] : []),
    ...(isProject ? [] : [{ icon: PenLine, label: "Rename", hint: "The old name stays as another name", onClick: () => setRename(displayName) }]),
    { icon: ImageIcon, label: "Set picture", hint: encrypted ? "Off for encrypted vaults" : undefined, disabled: encrypted !== false, onClick: () => { void pickPicture(); } },
    ...(kind === "org" ? [{ icon: Globe, label: d?.found && d.website ? "Change website" : "Set website", hint: d?.found ? d.website || undefined : undefined, onClick: () => setSite(d?.found ? d.website ?? "" : "") }] : []),
    ...(absFolder ? [{ icon: FolderOpen, label: "Reveal folder", hint: "Its folder in your vault", onClick: () => { void invoke("open_in_finder", { path: absFolder }).catch(() => {}); } }] : []),
    ...(absPath ? [
      { icon: Copy, label: "Copy path", onClick: () => { void navigator.clipboard?.writeText(absPath).catch(() => {}); } },
    ] : []),
    ...(kind === "place" ? [{ icon: MapPin, label: "Open map", onClick: () => openMap(displayName) }] : []),
    ...(isProject || kind === "event" ? [] : [relation === "reference"
      ? { icon: Bookmark, label: "This is mine", onClick: () => { void markAs("yours"); } }
      : { icon: BookOpen, label: "Just a reference", onClick: () => { void markAs("reference"); } }]),
    { icon: RefreshCw, label: "Refresh", onClick: () => { void load(); void pullThreads(); } },
  ];
  const loading = !d && !err && <div className="flex items-center gap-2 py-8 text-[13px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" />Reading your vault</div>;
  // Each tab body keeps its state when hidden (no remount on switch).
  const pane = (t: Tab) => `${tab === t ? "" : "hidden"} ${phone ? "" : "min-h-0 flex-1 overflow-y-auto"}`;

  return (
    <div data-testid="entity-detail" className={`flex min-h-0 flex-col ${phone ? "" : "h-full"}`}>
      <div className="shrink-0">
        <div className="flex items-center gap-3" data-testid="entity-header">
          <span data-testid="entity-avatar" title="Drop a picture here to set it"
            onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDropping(true); } }}
            onDragLeave={() => setDropping(false)}
            onDrop={(e) => { e.preventDefault(); setDropping(false); const f = e.dataTransfer.files[0]; if (f) void dropPicture(f); }}
            className={`shrink-0 rounded-lg ${dropping ? "ring-2 ring-accent" : ""}`}>
            {pic ? <AvatarImg src={pic} size={32} round={kind === "person"} /> : (
              <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-warm text-text-secondary">
                <KindIcon className="h-4 w-4" />
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <DetailTitle className="truncate">{displayName}</DetailTitle>
            <p className={`${META} truncate`}>
              {meta ?? <>{KIND_LABEL[kind] ?? kind}
              {d?.found && d.conversations > 0 && ` · ${d.conversations} ${d.conversations === 1 ? "conversation" : "conversations"}`}
              {d?.found && d.saved && " · Saved"}
              {relation === "reference" && !phone && " · Reference"}</>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {homeDomain && !phone && !isProject && <span data-testid="entity-home-domain"><DomainChip slug={homeDomain} /></span>}
            {!phone && (
              <button onClick={() => openChat()} onMouseEnter={() => { void loadChat(); }} data-testid="entity-chat-open"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover">
                <MessageSquare className="h-3.5 w-3.5" />Chat
              </button>
            )}
            {isProject ? null : d?.found && d.saved
              ? <span data-testid="entity-saved" className="inline-flex h-8 items-center gap-1 px-2 text-[13px] text-text-muted"><Check className="h-3.5 w-3.5 text-ok" />Saved</span>
              : <button onClick={save} disabled={!d || busy !== null} data-testid="entity-save" title="Give it a page in your vault"
                  className="inline-flex h-8 items-center gap-1.5 px-2 text-[13px] font-medium text-accent hover:underline disabled:opacity-60 disabled:no-underline">
                  {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save
                </button>}
            <RowMenu label="More entity actions" items={menu} />
          </div>
        </div>
        {rename !== null && (
          <form data-testid="entity-rename-form" className="mt-3 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void saveName(); }}>
            <input autoFocus value={rename} onChange={(e) => setRename(e.target.value)} aria-label="Name" maxLength={120}
              className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-[14px] text-text-primary outline-none focus:border-accent-border" />
            <button type="submit" disabled={!rename.trim()} className="inline-flex h-8 items-center px-2 text-[13px] font-medium text-accent hover:underline disabled:opacity-50">Save</button>
            <button type="button" onClick={() => setRename(null)} className="inline-flex h-8 items-center rounded-lg px-2 text-[13px] text-text-muted hover:text-text-secondary">Cancel</button>
          </form>
        )}
        {site !== null && (
          <form data-testid="entity-website-form" className="mt-3 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void saveWebsite(); }}>
            <input autoFocus value={site} onChange={(e) => setSite(e.target.value)} placeholder="foo.com" aria-label="Website"
              className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-[14px] text-text-primary outline-none focus:border-accent-border" />
            <button type="submit" className="inline-flex h-8 items-center px-2 text-[13px] font-medium text-accent hover:underline">Save</button>
            <button type="button" onClick={() => setSite(null)} className="inline-flex h-8 items-center rounded-lg px-2 text-[13px] text-text-muted hover:text-text-secondary">Cancel</button>
          </form>
        )}
        <div className="mt-4 flex items-center gap-2 border-b border-border-subtle">
          <div role="tablist" aria-label="Entity" className="-mb-px flex min-w-0 flex-1 overflow-x-auto">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} data-testid={`entity-tab-${t.id}`}
                onClick={() => (t.id === "chat" ? openChat() : setTab(t.id))}
                onMouseEnter={t.id === "chat" ? () => { void loadChat(); } : undefined}
                className={`h-10 shrink-0 border-b-2 ${phone ? "px-2 text-[13px]" : "px-3 text-[14px]"} font-medium transition-colors ${tab === t.id ? "border-accent text-text-primary" : "border-transparent text-text-muted hover:text-text-secondary"}`}>
                {phone && t.id === "conversations" ? "History" : t.label}{t.id === "conversations" && threads && threads.length > 0 && <span className="ml-1.5 text-[12px] font-normal text-text-muted">{threads.length}</span>}
              </button>
            ))}
          </div>
          {tab === "chat" && (
            <div className="flex shrink-0 items-center gap-1 pb-1">
              {threads && threads.length > 0 && (
                <select aria-label="Past conversations" data-testid="entity-thread-picker" value={chatSlug ?? ""}
                  onChange={(e) => openChat(e.target.value || null)}
                  className="h-8 max-w-[12rem] truncate rounded-lg border border-border bg-background px-2 text-[13px] text-text-secondary focus:border-accent-border focus:outline-none">
                  {!chatSlug && <option value="">New conversation</option>}
                  {chatSlug && !threads.some((t) => t.slug === chatSlug) && <option value={chatSlug}>This conversation</option>}
                  {threads.map((t) => <option key={t.slug} value={t.slug}>{t.title || "Untitled"}</option>)}
                </select>
              )}
              <button onClick={() => openChat(null)} title="New conversation" aria-label="New conversation" data-testid="entity-chat-new"
                className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
        {err && <p className="mt-3 break-words text-[13px] text-err">{err}</p>}
      </div>

      <div className={pane("overview")} data-testid="entity-overview">
        {loading}
        {d && overview && overview(d, load)}
        {d && !overview && (
          <>
            {aliases.length > 0 && (
              <p className={`${META} mt-4`} data-testid="entity-aliases">
                Also known as {aliases.join(", ")}
              </p>
            )}
            {d.found && (d.merged_from ?? []).length > 0 && (
              <ul data-testid="entity-merged-from" className="mt-2 space-y-0.5">
                {d.merged_from!.map((m) => (
                  <li key={m.id} className={`${META} flex items-center gap-1.5`} title={`${m.id}${m.auto ? ", merged on its own as a clear duplicate" : ""}`}>
                    <GitMerge className="h-3 w-3 shrink-0" aria-hidden />
                    <span className="truncate">Merged from {m.name} · {fmtDay(Date.parse(m.ts))}</span>
                  </li>
                ))}
              </ul>
            )}
            {relation === "reference" && (
              <div data-testid="entity-reference-note" className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="min-w-0 text-[13px] text-text-muted">A reference: only mentioned in replies, not in your own words.</p>
                <button type="button" onClick={() => { void markAs("yours"); }} data-testid="entity-mark-mine"
                  className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-accent hover:underline">
                  <Bookmark className="h-3.5 w-3.5" />This is mine
                </button>
              </div>
            )}
            {homeDomain && phone && <div className="mt-3"><DomainChip slug={homeDomain} /></div>}
            {kind === "place" && <div className="mt-5"><PlaceMap name={displayName} /></div>}
            {kind === "event" && <EventDetails vaultPath={vaultPath} id={writeId} fields={d.found ? d.fields ?? {} : {}} onChanged={load} />}
            {kind === "thing" && <ThingDetails vaultPath={vaultPath} id={writeId} fields={d.found ? d.fields ?? {} : {}} onChanged={load} />}
            {kind === "org" && d.found && <ProductApps apps={d.apps ?? []} />}
            {kind === "org" && <ProductConnection vaultPath={vaultPath} name={displayName} apps={d.apps ?? []} />}
            <Section title="In your vault">
              {d.found && d.digest
                ? <div className="text-[14px] leading-normal text-text-primary"><Markdown source={d.digest} /></div>
                : <p className={META}>{!hasPage ? "Not in your vault yet. Save it, or add a note, to give it a page."
                    : d.saved || d.conversations >= 3 ? "No summary yet. It is written on the next refresh."
                    : "No summary yet. One is written once it comes up in 3 conversations, or when you save it."}</p>}
            </Section>
            {relation === "yours" && (
              <Section title="Across your life">
                <AcrossYourLife vaultPath={vaultPath} target={{ entity: writeId }} emptyName={displayName} />
              </Section>
            )}
            <Section title="Mentioned in">
              {d.found && d.mentions.length
                ? <ul className="-mx-2">{d.mentions.slice(0, 40).map((m, i) => <MentionRow key={`${m.source}:${m.ref}:${i}`} m={m} />)}</ul>
                : <p className={META}>No conversations mention it yet.</p>}
            </Section>
            <AppsUsed vaultPath={vaultPath} entity={writeId} />
            {d.found && d.co_mentions.length > 0 && (
              <Section title="Often mentioned with">
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-[14px]">
                  {d.co_mentions.filter((c) => CARD_KINDS.has(c.kind)).slice(0, 8).map((c) => (
                    <EntityChip key={c.id} entity={{ kind: c.kind, value: c.id.slice(c.id.indexOf("/") + 1) }}>{c.name}</EntityChip>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </div>

      {chatReq && (
        <div className={`${tab === "chat" ? "flex" : "hidden"} min-h-0 flex-col ${phone ? "h-[calc(100dvh-22rem)]" : "flex-1"}`}>
          <Suspense fallback={<ChatSkeleton />}>
            <EntityChat vaultPath={vaultPath} entity={{ id: writeId, name: displayName }} threads={threads}
              request={chatReq} onCurrent={setChatSlug} onThreadsChanged={() => { void pullThreads(); }} />
          </Suspense>
        </div>
      )}

      <div className={pane("notes")}>
        {loading}
        {d && (
          <div className="pt-5">
            <label className="block text-[13px] font-medium text-text-primary" htmlFor="entity-notes">Your notes</label>
            <textarea id="entity-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={8} placeholder="Anything you want remembered. Only you write here."
              className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-text-primary outline-none focus:border-accent-border" />
            <div className="mt-2 flex items-center gap-2">
              <button onClick={saveNotes} disabled={!notesDirty || busy !== null} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-40">
                {busy === "notes" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save notes
              </button>
              {savedNote && <span className="min-w-0 truncate text-[13px] text-accent" title={d.page_path}>Saved to its page</span>}
            </div>
          </div>
        )}
      </div>

      <div className={pane("links")}>
        {tab === "links" || linksSeen ? <LinksPane vaultPath={vaultPath} id={writeId} /> : null}
      </div>

      <div className={pane("files")}>
        {tab === "files" || filesSeen ? <EntityFiles vaultPath={vaultPath} id={writeId} folder={absFolder} readFile={readDropped} writable={encrypted === false} /> : null}
      </div>

      {brief && <div className={pane("brief")} data-testid="entity-brief">{tab === "brief" || briefSeen ? brief : null}</div>}

      <div className={pane("conversations")}>
        <div className="pt-3">
          {threads && threads.length > 0 ? (
            <ul className="-mx-2" data-testid="entity-conversations">
              {threads.slice(0, 50).map((t) => (
                <li key={t.slug}>
                  <button type="button" onClick={() => openChat(t.slug)} data-testid="entity-conversation"
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-warm">
                    <MessageSquare className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-text-primary">{t.title || "Untitled"}</span>
                    <span className="shrink-0 text-[12px] text-text-muted">{t.turns} {t.turns === 1 ? "turn" : "turns"} · {fmtDay(t.updated)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className={META}>{threads ? "No conversations yet. Start one in Chat." : "Reading your conversations"}</p>}
        </div>
      </div>
    </div>
  );
}
