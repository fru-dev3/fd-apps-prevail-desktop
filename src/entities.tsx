// Inline vault objects in rendered markdown. The model writes the people,
// places, domains, tasks, files and dates it refers to as ordinary markdown
// links on a prevail:// address (see ENTITY_LINK_DIRECTIVE), and the Markdown
// renderer hands every link to EntityLink, which draws the object instead of a
// bare underline: a domain as its coloured pill, a person with an avatar, a
// file or task as a link that opens it in the app. People, places, orgs and
// things open the Entities view with that entity selected (entitiesview.tsx);
// a chip whose entity is saved to the vault carries a small green dot.
import React, { useEffect, useState } from "react";
import { Boxes, Building2, Calendar, CheckSquare, ExternalLink, FileText, MapPin } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "./bridge";
import { lookupEntity, requestEntity, slugifyName, useEntityStore } from "./entitystore";
import { domainColor } from "./helpers";
import { domainIcon } from "./icons";
import { pickSkillColor } from "./sectionutil";

export type EntityKind = "domain" | "person" | "place" | "org" | "thing" | "task" | "file" | "date";

export interface EntityRef {
  kind: EntityKind;
  // domain slug, person or place name, vault-relative file path, ISO date,
  // or the task id; `domain` is set for tasks.
  value: string;
  domain?: string;
}

const KINDS = new Set<EntityKind>(["domain", "person", "place", "org", "thing", "task", "file", "date"]);

// The kinds that are entities with a card (and maybe a vault page).
export const CARD_KINDS = new Set<EntityKind>(["person", "place", "org", "thing"]);

// The engine id for a chip: <kind>/<slug>.
export function entityIdOf(ref: EntityRef): string {
  return `${ref.kind}/${slugifyName(ref.value)}`;
}

export function mapUrl(place: string): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(place)}`;
}

// prevail://<kind>/<value...>. A task is prevail://task/<domain>/<id>.
export function parseEntityHref(href: string | undefined | null): EntityRef | null {
  if (!href) return null;
  const m = href.match(/^prevail:\/\/([a-z]+)\/(.+)$/i);
  if (!m) return null;
  const kind = m[1].toLowerCase() as EntityKind;
  if (!KINDS.has(kind)) return null;
  let rest: string;
  try { rest = decodeURIComponent(m[2]); } catch { rest = m[2]; }
  rest = rest.replace(/\/+$/, "");
  if (!rest) return null;
  if (kind === "task") {
    const i = rest.indexOf("/");
    if (i <= 0 || i === rest.length - 1) return null;
    return { kind, domain: rest.slice(0, i), value: rest.slice(i + 1) };
  }
  if (kind === "file" && (rest.split("/").includes("..") || rest.startsWith("/"))) return null;
  return { kind, value: rest };
}

// react-markdown drops any href whose protocol is not on its safe list, which
// would blank every prevail:// link before EntityLink sees it. Allow exactly
// that scheme and keep the default filter for everything else.
const SAFE_PROTOCOL = /^(https?|mailto|tel):/i;
export function markdownUrlTransform(url: string): string {
  if (/^prevail:\/\//i.test(url)) return url;
  const colon = url.indexOf(":");
  const slash = url.indexOf("/");
  const query = url.indexOf("?");
  const hash = url.indexOf("#");
  // No protocol, or the colon sits after a path/query/fragment start: relative.
  if (colon === -1 || (slash !== -1 && colon > slash) || (query !== -1 && colon > query) || (hash !== -1 && colon > hash)) {
    return url;
  }
  return SAFE_PROTOCOL.test(url) ? url : "";
}

function fire(name: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function openEntity(ref: EntityRef) {
  switch (ref.kind) {
    case "domain":
      fire("prevail:open-domain", ref.value);
      return;
    case "task":
      // The board may not be mounted yet; it reads this on mount as well as
      // answering the event, the same hand-off the "Needs you" pill uses.
      try { localStorage.setItem("prevail.board.openTask", ref.value); } catch { /* storage off */ }
      fire("prevail:work-section", "tasks");
      fire("prevail:open-task", ref.value);
      return;
    case "file":
      fire("prevail:open-vault-file", ref.value);
      return;
    case "date":
      fire("prevail:work-section", "calendar");
      return;
    case "person":
    case "place":
    case "org":
    case "thing":
      requestEntity({ kind: ref.kind, value: ref.value });
      return;
  }
}

export function openMap(place: string) {
  void openUrl(mapUrl(place)).catch(() => {});
}

// Company/product logos come from the company's own site (favicon command,
// cached on disk), never a third-party logo service.
const logoCache = new Map<string, Promise<string>>();
export function useFavicon(host: string | undefined): string {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    setSrc("");
    if (!host) return;
    let p = logoCache.get(host);
    if (!p) { p = invoke<string>("app_favicon", { host }).then((x) => x || "").catch(() => ""); logoCache.set(host, p); }
    void p.then((x) => { if (live) setSrc(x); });
    return () => { live = false; };
  }, [host]);
  return src;
}

// A company named like a domain ("acme.com") is its own logo host.
export function orgHost(name: string, known?: string): string | undefined {
  if (known) return known;
  const m = name.trim().toLowerCase().match(/^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})\/?$/);
  return m ? m[1] : undefined;
}

export function OrgMark({ name, host, size = 16 }: { name: string; host?: string; size?: number }) {
  const src = useFavicon(orgHost(name, host));
  if (src) {
    return (
      <span aria-hidden className="inline-flex shrink-0 items-center justify-center self-center overflow-hidden rounded bg-white ring-1 ring-border-subtle" style={{ width: size, height: size }}>
        <img src={src} alt="" width={Math.round(size * 0.75)} height={Math.round(size * 0.75)} className="object-contain" />
      </span>
    );
  }
  return <Building2 size={size - 3} aria-hidden className="shrink-0 self-center" />;
}

function VaultDot() {
  return <span aria-label="Saved to your vault" title="Saved to your vault" data-vault-dot className="ml-0.5 inline-block h-1.5 w-1.5 shrink-0 self-center rounded-full bg-accent" />;
}

function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

function initialsOf(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

const linkish = "cursor-pointer text-accent underline decoration-accent-border underline-offset-[3px] hover:decoration-accent";

export function EntityChip({ entity, children }: { entity: EntityRef; children: React.ReactNode }) {
  const label = children ?? entity.value;
  const onClick = (e: React.MouseEvent) => { e.preventDefault(); openEntity(entity); };
  useEntityStore(); // re-render when the vault's pages change
  const known = CARD_KINDS.has(entity.kind) ? lookupEntity(entity.kind, entity.value) : null;
  switch (entity.kind) {
    case "domain": {
      const color = domainColor(entity.value);
      const Icon = domainIcon(entity.value);
      return (
        <button
          type="button"
          onClick={onClick}
          data-entity="domain"
          title={`Open ${entity.value}`}
          className="mx-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-md px-1.5 py-px align-middle text-[0.8em] font-semibold uppercase tracking-wide"
          style={{ color, backgroundColor: `${color}1f` }}
        >
          {Icon && <Icon size={12} aria-hidden />}
          {label}
        </button>
      );
    }
    case "person": {
      const who = known?.name ?? entity.value;
      const { bg, fg } = pickSkillColor(who);
      return (
        <button type="button" onClick={onClick} data-entity="person" title={`About ${entity.value}`} className="inline-flex items-baseline gap-1 text-left">
          <span
            aria-hidden
            className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center self-center rounded-full text-[8.5px] font-bold leading-none tracking-tight"
            style={{ backgroundColor: bg, color: fg }}
          >
            {initialsOf(who)}
          </span>
          <span className="underline decoration-dotted decoration-text-muted underline-offset-[3px] hover:decoration-accent">{label}</span>
          {known?.saved && <VaultDot />}
        </button>
      );
    }
    case "place":
      return (
        <a href="#" onClick={onClick} data-entity="place" title={`About ${entity.value}`} className={`inline-flex items-baseline gap-0.5 ${linkish}`}>
          <MapPin size={13} aria-hidden className="shrink-0 self-center" />
          {label}
          {known?.saved && <VaultDot />}
        </a>
      );
    case "org":
      return (
        <a href="#" onClick={onClick} data-entity="org" title={`About ${entity.value}`} className={`inline-flex items-baseline gap-1 ${linkish}`}>
          <OrgMark name={entity.value} host={known?.domain} size={15} />
          {label}
          {known?.saved && <VaultDot />}
        </a>
      );
    case "thing":
      return (
        <a href="#" onClick={onClick} data-entity="thing" title={`About ${entity.value}`} className={`inline-flex items-baseline gap-0.5 ${linkish}`}>
          <Boxes size={13} aria-hidden className="shrink-0 self-center" />
          {label}
          {known?.saved && <VaultDot />}
        </a>
      );
    case "task":
      return (
        <a href="#" onClick={onClick} data-entity="task" title="Open task" className={`inline-flex items-baseline gap-0.5 ${linkish}`}>
          <CheckSquare size={13} aria-hidden className="shrink-0 self-center" />
          {label}
        </a>
      );
    case "file":
      return (
        <a href="#" onClick={onClick} data-entity="file" title={entity.value} className={`inline-flex items-baseline gap-0.5 ${linkish}`}>
          <FileText size={13} aria-hidden className="shrink-0 self-center" />
          {label}
        </a>
      );
    case "date":
      return (
        <a href="#" onClick={onClick} data-entity="date" title={formatDate(entity.value)} className={`inline-flex items-baseline gap-0.5 ${linkish}`}>
          <Calendar size={13} aria-hidden className="shrink-0 self-center" />
          {label}
        </a>
      );
  }
}

// The markdown `a` renderer. Vault objects become chips; web links open in the
// browser instead of navigating the app's own window away; a relative link
// (Obsidian imports write `[Note](Note.md)`) opens that vault file.
export function EntityLink({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
  delete (rest as { node?: unknown }).node;
  const ref = parseEntityHref(href);
  if (ref) return <EntityChip entity={ref}>{children}</EntityChip>;
  if (href && /^(https?|mailto|tel):/i.test(href)) {
    return (
      <a
        {...rest}
        href={href}
        onClick={(e) => { e.preventDefault(); void openUrl(href).catch(() => {}); }}
        className="inline-flex items-baseline gap-0.5"
      >
        {children}
        {/^https?:/i.test(href) && <ExternalLink size={11} aria-hidden className="shrink-0 self-center opacity-60" />}
      </a>
    );
  }
  if (href && !href.startsWith("#") && !/^[a-z]+:/i.test(href) && !href.split("/").includes("..")) {
    const path = href.replace(/^\.\//, "");
    return <EntityChip entity={{ kind: "file", value: decodeURIComponentSafe(path) }}>{children}</EntityChip>;
  }
  return <span {...(rest as React.HTMLAttributes<HTMLSpanElement>)}>{children}</span>;
}

function decodeURIComponentSafe(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

// Told to the model on every desktop chat turn. Kept short: it rides each
// prompt. `domains` are the vault's real slugs, so a domain link always
// resolves to something the app can open. Worded as a hard format rule with a
// worked example because a softer "please link things" was ignored outright
// (Sonnet 5, 2026-09-25); this version was followed by Sonnet 5, Haiku 4.5 and
// GPT-6 Luna.
export function entityLinkDirective(domains: string[], saved: { name: string; id: string }[] = []): string {
  const slugs = domains.filter((d) => d && !d.startsWith("_")).slice(0, 60);
  const example = slugs.includes("career") ? "career" : (slugs[0] ?? "career");
  const own = saved.filter((e) => e.name && /^(person|place|org|thing)\/[a-z0-9-]+$/.test(e.id)).slice(0, 40);
  return [
    "# OUTPUT FORMAT (required): LINK EVERY CONCRETE THING",
    "This app turns special links into clickable chips. In every reply, write each person, place, company or product, named thing, life domain, task, vault file and specific date you mention as a markdown link with a prevail:// address. Plain names for these are a formatting error.",
    "- person: [Seneca](prevail://person/Seneca)",
    "- place: [Rome](prevail://place/Rome)",
    "- company or product: [Stripe](prevail://org/Stripe)",
    "- named thing (a book, vehicle, device, property, event): [The Odyssey](prevail://thing/The%20Odyssey)",
    `- life domain: [${example}](prevail://domain/${example})` + (slugs.length ? `. Only these slugs exist: ${slugs.join(", ")}` : ""),
    "- task (only with a known id): [call the lender](prevail://task/<domain>/<id>)",
    "- vault file (only a path you have seen, relative to the vault root): [state](prevail://file/<path>)",
    "- date: [Nov 15](prevail://date/YYYY-MM-DD)",
    ...(own.length
      ? [`The user keeps pages on these; link them by exactly this address: ${own.map((e) => `${e.name} = prevail://${e.id}`).join("; ")}`]
      : []),
    "Link each thing the first time it appears, inline in the sentence; later mentions stay plain. Never invent an id, slug or path. Percent-encode spaces (Marcus%20Aurelius).",
    "",
  ].join("\n");
}
