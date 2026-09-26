// Sources: shared client for the Sources page and the chat. The engine owns the
// list, the indexes and retrieval (`prevail sources`); this module is the typed
// seam over those Tauri commands plus the small pieces both surfaces render:
// the kind icons and the "Sources" citation row under a reply.
import { Folder, Globe, Library } from "lucide-react";
import type { ReactNode } from "react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { invoke } from "./bridge";
import { ObsidianLogo } from "./obsidianmodal";

export type SourceKind = "prevail" | "obsidian" | "folder" | "website";
export type SourceState = "never" | "ready" | "indexing" | "error" | "missing" | "locked" | "paused";

export interface SiteSurface { robots: boolean; llms: boolean; llmsFull: boolean; openapi: number | null; sitemap: number | null; health: boolean }
export interface WebSite { origin: string; name: string; rows: number; lastUpdated: string | null; nextDue: string; surface: SiteSurface; error?: string }
export interface WebSummary {
  sites: number; childSites: number; rows: number; items: number; llms: number; llmsFull: number; openapi: number;
  nextDue: string | null; lastUpdated: string | null; errors: { origin: string; error: string }[]; list: WebSite[];
}
export interface SourceStatus {
  state: SourceState;
  lastIndexed: string | null;
  items: number;
  files?: number;
  nextRefresh: string | null;
  error: string | null;
  detail?: string;
  web?: WebSummary;
}
export interface SourceRow {
  id: string;
  kind: SourceKind;
  name: string;
  location: string;
  resolvedLocation: string;
  enabled: boolean;
  added: string;
  domain?: string;
  builtin?: boolean;
  status: SourceStatus;
}

// One excerpt the model was given, as the chat shows it under a reply.
export interface SourceCitation {
  tag: string;
  sourceName: string;
  kind: SourceKind | string;
  title: string;
  location: string;
  url?: string;
  group?: string;
}

export const SOURCES_HEADER = "# CONTEXT FROM YOUR SOURCES";

export const KIND_META: Record<SourceKind, { label: string; plural: string; blurb: string }> = {
  prevail: { label: "Prevail vault", plural: "Prevail vaults", blurb: "Domains, entities, people and everything a vault holds." },
  obsidian: { label: "Obsidian vault", plural: "Obsidian", blurb: "Imported one way into a domain. Your notes are never changed." },
  folder: { label: "Folder", plural: "Folders", blurb: "Any folder of notes or text files, read in place." },
  website: { label: "Website", plural: "Websites", blurb: "A site you trust: its llms.txt, OpenAPI and JSON APIs, refreshed on its own schedule." },
};

export function KindIcon({ kind, className = "h-4 w-4" }: { kind: SourceKind | string; className?: string }) {
  if (kind === "obsidian") return <ObsidianLogo className={className} />;
  if (kind === "folder") return <Folder className={className} aria-hidden />;
  if (kind === "website") return <Globe className={className} aria-hidden />;
  // The real Prevail mark for a Prevail vault; the generic library icon only
  // where the image cannot load.
  if (kind === "prevail") return <img src="/logo.png" alt="" aria-hidden className={`${className} rounded-[4px]`} onError={(e) => { e.currentTarget.style.display = "none"; }} />;
  return <Library className={className} aria-hidden />;
}

// ── Engine calls ────────────────────────────────────────────────────────

export async function listSources(vault: string): Promise<SourceRow[]> {
  const r = await invoke<{ ok: boolean; sources?: SourceRow[]; error?: string }>("sources_list", { vault });
  if (!r?.ok) throw new Error(r?.error || "Could not read sources");
  return r.sources ?? [];
}

export async function addSource(vault: string, input: { kind: SourceKind; location: string; name?: string; domain?: string }): Promise<SourceRow> {
  const r = await invoke<{ ok: boolean; source?: SourceRow; error?: string }>("sources_add", {
    vault, kind: input.kind, location: input.location, name: input.name || null, domain: input.domain || null,
  });
  if (!r?.ok || !r.source) throw new Error(r?.error || "Could not add the source");
  return r.source;
}

export async function removeSource(vault: string, id: string): Promise<{ keptImport?: string }> {
  const r = await invoke<{ ok: boolean; keptImport?: string; error?: string }>("sources_remove", { vault, id });
  if (!r?.ok) throw new Error(r?.error || "Could not remove the source");
  return { keptImport: r.keptImport };
}

export async function setSourceEnabled(vault: string, id: string, enabled: boolean): Promise<void> {
  const r = await invoke<{ ok: boolean; error?: string }>("sources_set_enabled", { vault, id, enabled });
  if (!r?.ok) throw new Error(r?.error || "Could not change the source");
}

export async function refreshSources(vault: string, opts: { ids?: string[]; force?: boolean } = {}): Promise<{ busy: boolean }> {
  const r = await invoke<{ ok: boolean; busy?: boolean; error?: string }>("sources_refresh", {
    vault, ids: opts.ids ?? null, force: opts.force ?? null, due: null,
  });
  if (!r?.ok) throw new Error(r?.error || "Refresh failed");
  return { busy: !!r.busy };
}

/**
 * Cited excerpts for one chat message. `null` means retrieval could not run
 * (no engine, timed out), so the caller lets the engine try instead; an empty
 * context means it ran and found nothing worth citing.
 */
export async function sourcesForMessage(vault: string, query: string, timeoutMs = 3000): Promise<{ context: string; hits: SourceCitation[] } | null> {
  const q = query.trim();
  if (!vault || q.length < 3) return { context: "", hits: [] };
  try {
    const r = await Promise.race([
      invoke<{ ok: boolean; context?: string; hits?: SourceCitation[] }>("sources_context", { vault, query: q.slice(0, 1500) }),
      new Promise<null>((res) => setTimeout(() => res(null), timeoutMs)),
    ]);
    if (!r || !r.ok) return null;
    return { context: r.context ?? "", hits: r.hits ?? [] };
  } catch {
    return null;
  }
}

// ── Formatting ──────────────────────────────────────────────────────────

export function fmtCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** "just now", "12 min ago", "3 hours ago", "Sep 21". */
export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "Never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Never";
  const s = Math.round((now - t) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) { const h = Math.round(s / 3600); return `${h} hour${h === 1 ? "" : "s"} ago`; }
  const d = Math.round(s / 86_400);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "in 20 min", "in 6 hours", "Mon 3:00 AM". */
export function fmtNext(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "Not scheduled";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Not scheduled";
  const s = Math.round((t - now) / 1000);
  if (s <= 60) return "Due now";
  if (s < 3600) return `In ${Math.round(s / 60)} min`;
  if (s < 86_400) { const h = Math.round(s / 3600); return `In ${h} hour${h === 1 ? "" : "s"}`; }
  return new Date(t).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
}

export function openCitation(c: { url?: string; location?: string }) {
  const u = c.url ?? "";
  if (/^https?:\/\//.test(u)) { void openUrl(u).catch(() => window.open(u, "_blank", "noopener,noreferrer")); return; }
  if (u.startsWith("/")) void revealItemInDir(u).catch(() => {});
}

// The "Sources" row under a reply: every excerpt the model was given, as a
// chip that opens the page or reveals the file. The reply cites them as [S1].
export function SourcesCited({ sources }: { sources?: SourceCitation[] }): ReactNode {
  if (!sources || sources.length === 0) return null;
  return (
    <div data-testid="sources-cited" className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-2.5">
      <span className="mr-0.5 text-[12px] font-semibold text-text-secondary">Sources</span>
      {sources.map((c) => (
        <button key={c.tag} type="button" onClick={() => openCitation(c)}
          title={`${c.title}\n${c.url ?? c.location}`}
          className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border border-border-subtle bg-background px-2 py-0.5 text-[12px] text-text-secondary transition-colors hover:border-accent-border hover:text-accent">
          <span className="font-semibold text-accent">{c.tag}</span>
          <KindIcon kind={c.kind} className="h-3 w-3 shrink-0" />
          <span className="truncate">{c.kind === "website" ? (c.group ?? c.sourceName) : c.sourceName}</span>
        </button>
      ))}
    </div>
  );
}
