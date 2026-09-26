// Small shared pieces of the Apps screen: the connector logo, the status pill,
// the sign-in help and an external-link opener that works on the desktop and
// in the phone browser alike.
import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Pin } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke, isBrowser } from "./bridge";
import { favKeyOf, toggleFavorite, useFavorites } from "./appfavorites";
import { logoHost, signinAction, statusMeta, type MirrorApp, type MirrorStatus, type Tone } from "./appsmirror-model";

export function openExternal(href: string) {
  if (isBrowser()) { window.open(href, "_blank", "noopener,noreferrer"); return; }
  void openUrl(href).catch(() => { window.open(href, "_blank", "noopener,noreferrer"); });
}

export const TONE_PILL: Record<Tone, string> = {
  ok: "bg-ok/10 text-ok ring-ok/25",
  warn: "bg-warn/10 text-warn ring-warn/25",
  err: "bg-err/10 text-err ring-err/25",
  muted: "bg-surface-warm text-text-muted ring-border",
};
export const TONE_DOT: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", err: "bg-err", muted: "bg-text-muted/50" };

export const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", err: "text-err", muted: "text-text-muted" };

// compact: a dot and a coloured label with no chip, for dense list rows.
export function StatusPill({ status, compact = false }: { status: MirrorStatus; compact?: boolean }) {
  const m = statusMeta(status);
  if (compact) {
    return (
      <span data-testid="status-pill" className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[12px] font-medium ${TONE_TEXT[m.tone]}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[m.tone]}`} aria-hidden />
        {m.label}
      </span>
    );
  }
  return (
    <span data-testid="status-pill" className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium ring-1 ${TONE_PILL[m.tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[m.tone]}`} aria-hidden />
      {m.label}
    </span>
  );
}

// Favicons are fetched once per host per session; the Rust side caches on disk.
const iconCache = new Map<string, Promise<string>>();
function favicon(host: string): Promise<string> {
  let p = iconCache.get(host);
  if (!p) {
    p = invoke<string>("app_favicon", { host }).then((s) => s || "").catch(() => "");
    iconCache.set(host, p);
  }
  return p;
}

export function AppLogo({ name, url, size = 32 }: { name: string; url?: string; size?: number }) {
  const host = logoHost(name, url);
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    setSrc("");
    if (host) void favicon(host).then((s) => { if (live) setSrc(s); });
    return () => { live = false; };
  }, [host]);
  const box = { width: size, height: size };
  if (src) {
    return (
      <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-border-subtle" style={box}>
        <img src={src} alt="" width={Math.round(size * 0.66)} height={Math.round(size * 0.66)} className="object-contain" />
      </span>
    );
  }
  const letter = (name.trim().match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-lg bg-surface-strong font-semibold text-text-secondary ring-1 ring-border-subtle"
      style={{ ...box, fontSize: Math.round(size * 0.44) }}
    >
      {letter}
    </span>
  );
}

export function CopyCommand({ command }: { command: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-border bg-surface-warm py-0.5 pl-2 pr-0.5">
      <code className="min-w-0 truncate font-mono text-[12px] text-text-secondary" title={command}>{command}</code>
      <button
        type="button"
        aria-label="Copy command"
        title="Copy command"
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard?.writeText(command).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500); }).catch(() => {});
        }}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-strong hover:text-accent"
      >
        {done ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </span>
  );
}

// How to fix a connector that is not connected: a link for Claude connectors,
// a copyable command for the CLI runtimes.
export function SigninHelp({ app, compact = false }: { app: MirrorApp; compact?: boolean }) {
  const a = signinAction(app);
  if (!a) return null;
  if (a.kind === "link") {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); openExternal(a.href); }}
        className={compact
          ? "inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
          : "inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-soft px-3 py-1.5 text-[13px] font-semibold text-accent hover:bg-accent/15"}
      >
        {app.status === "disabled" ? "Turn on in Claude" : "Sign in on claude.ai"} <ExternalLink className="h-3.5 w-3.5" />
      </button>
    );
  }
  return <CopyCommand command={a.command} />;
}

// Pinning a connector puts it in the sidebar Apps section, the same way a
// starred app used to. The key is namespaced so a connector never collides
// with a vault app folder of the same name.
export const mirrorPinKey = (id: string) => favKeyOf(`mirror-${id}`);
export const MIRROR_SELECT_KEY = "prevail.apps.mirror.select";

export function PinButton({ app }: { app: MirrorApp }) {
  const favs = useFavorites();
  const key = mirrorPinKey(app.id);
  const pinned = favs.has(key);
  return (
    <button
      type="button"
      data-testid="mirror-pin"
      aria-pressed={pinned}
      onClick={() => toggleFavorite(key)}
      title={pinned ? `Unpin ${app.name} from the sidebar` : `Pin ${app.name} to the sidebar`}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors ${
        pinned ? "border-accent-border bg-accent-soft text-accent" : "border-border text-text-secondary hover:border-accent-border hover:text-accent"
      }`}
    >
      <Pin className="h-4 w-4" /> {pinned ? "Pinned" : "Pin"}
    </button>
  );
}
