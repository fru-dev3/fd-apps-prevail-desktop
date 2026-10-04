// Knowledge sources, the page's pure half: the engine's shapes, what a pasted
// text looks like (for the prefilled Fields), splitting a password off before
// anything leaves the page, and the plain lines a row shows. The engine owns
// the model and every limit (`prevail sources`, knowledge-sources.ts).

export type KnowledgeKind = "mcp" | "web" | "folder" | "database";
export interface KnowledgeScope { briefings: boolean; general: boolean; domains: string[]; projects: string[] }
export interface KnowledgeSource {
  id: string;
  name: string;
  kind: KnowledgeKind;
  integration: string;
  location: string;
  urls: string[];
  scope: KnowledgeScope;
  last_checked: number | null;
  status: "ready" | "error" | "untrusted_here";
  detail?: string;
  found?: string;
  trusted_here: boolean;
  has_secret?: boolean;
}
export interface AddResult { source: KnowledgeSource; probe: { ok: boolean; error?: string }; adopted: boolean; found: string; detected?: string }

export const KIND_LABEL: Record<KnowledgeKind, string> = { mcp: "MCP server", web: "Site or feed", folder: "Folder", database: "Database" };
export const KIND_HINT: Record<KnowledgeKind, string> = {
  mcp: "A remote MCP address. Only its read tools run.",
  web: "A site, a page or an RSS or Atom feed. Read with GETs to that site only.",
  folder: "A folder on this Mac. Text files only, nothing outside it.",
  database: "A SQLite file or a Postgres URL. One SELECT at a time, 200 rows at most.",
};
export const KIND_PLACEHOLDER: Record<KnowledgeKind, string> = {
  mcp: "https://example.com/mcp",
  web: "https://example.com/feed.xml",
  folder: "~/Documents/foo-notes",
  database: "~/data/foo.db or postgres://user@host/db",
};

const URL_RE = /\b(?:postgres(?:ql)?|https?):\/\/[^\s"'<>]+/i;
const PATH_RE = /(?:^|[\s(])((?:~\/|\/|\.\.?\/)[^\s,;"'()]+)/;

/** What a pasted text points at, as far as the page can tell; the engine
 *  decides for real (it probes a link for an MCP server first). */
export function guessSource(text: string): { kind?: KnowledgeKind; location?: string } {
  const t = text.trim();
  const loc = URL_RE.exec(t)?.[0]?.replace(/[.,;:)]+$/, "") ?? PATH_RE.exec(t)?.[1]?.replace(/[.,;:)]+$/, "");
  if (!loc) return {};
  if (/^postgres/i.test(loc) || /\.(sqlite3?|db3?)$/i.test(loc)) return { kind: "database", location: loc };
  if (/^https?:/i.test(loc)) return { kind: /\/mcp\/?$/i.test(loc) || /\bmcp\b/i.test(t.replace(loc, "")) ? "mcp" : "web", location: loc };
  return { kind: "folder", location: loc };
}

/** Split a password out of a Postgres URL in the text, so it goes to the
 *  Keychain and never into a command line or the vault. */
export function splitSecret(text: string): { text: string; secret?: string } {
  const m = /\b(postgres(?:ql)?:\/\/)([^:@/\s]+):([^@\s]+)@/i.exec(text);
  if (!m) return { text };
  let secret = m[3]!;
  try { secret = decodeURIComponent(secret); } catch { /* keep as typed */ }
  return { text: text.replace(m[0], `${m[1]}${m[2]}@`), secret };
}

/** The Keychain item (service prevail.appsecrets) the engine reads a source's password or token from. */
export function secretName(id: string): string {
  return `PREVAIL_SOURCE_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_SECRET`;
}

const titleCase = (s: string) => s.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/** "Briefings · General · Money": what a source is used for, in one line. */
export function useLine(s: Pick<KnowledgeSource, "scope">): string {
  const bits = [s.scope.briefings ? "Briefings" : "", s.scope.general ? "Chief of staff" : "", ...s.scope.domains.map(titleCase), ...s.scope.projects.map((p) => `Project ${titleCase(p)}`)].filter(Boolean);
  return bits.length ? bits.join(", ") : "Chat when you name it";
}

/** A location shown short (host, or the last two path parts); the full one goes in a tooltip. */
export function shortLocation(s: Pick<KnowledgeSource, "kind" | "location">): string {
  if (s.kind === "mcp" || s.kind === "web" || /^postgres/i.test(s.location)) {
    try { const u = new URL(s.location.split(",")[0]!.trim()); return `${u.host}${u.pathname !== "/" ? u.pathname : ""}`.replace(/\/$/, ""); } catch { return s.location; }
  }
  const parts = s.location.replace(/\/+$/, "").split("/").filter(Boolean);
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : s.location;
}

/** The sources a domain, a project, or briefings use (the engine's rule, for display). */
export function sourcesInUse(all: KnowledgeSource[], use: { domain?: string; project?: string; briefing?: boolean }): KnowledgeSource[] {
  const d = (use.domain ?? "").toLowerCase();
  const p = (use.project ?? "").replace(/^(mission|project)\//, "").toLowerCase();
  return all.filter((s) => {
    if (!s.trusted_here) return false;
    if (use.briefing && !s.scope.briefings) return false;
    if (p && s.scope.projects.includes(p)) return true;
    if (d && d !== "general" && s.scope.domains.includes(d)) return true;
    return (!d || d === "general") && !p ? s.scope.general : false;
  });
}
