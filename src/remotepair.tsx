// Pair a phone with this Mac's WebUI. Shown under Settings > Remote once the
// bridge is running: the address other devices use, a QR code that opens it,
// every other way in (same Wi-Fi, Tailscale, the internet), and the two-tap
// "install as an app" steps for iPhone and Android. There is no separate
// mobile app to build: the WebUI serves the real bundle, and the manifest +
// iOS meta in index.html make it installable as a standalone app.
//
// "Share over the internet" runs a Cloudflare quick tunnel on this Mac: a
// public https address, no account, no router setup. https is also what lets
// the phone browser record voice (the mic is off on plain http addresses).
import { useCallback, useEffect, useState } from "react";
import { Copy, Check, Globe, Mic, Smartphone, ShieldCheck, Wifi } from "lucide-react";
import QRCode from "qrcode";
import { invoke } from "./bridge";

interface WebuiStatus {
  running: boolean;
  port: number;
  user: string;
  remote: boolean;
  remote_url: string;
  via_tailscale: boolean;
  lan_url: string;
  tailscale_url: string;
  tunnel_url: string;
  tunnel_state: "off" | "starting" | "on" | "error";
  tunnel_error: string;
  cloudflared_installed: boolean;
}

const BREW_CLOUDFLARED = "brew install cloudflared";

function CopyButton({ text, label = "Copy address" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  }
  return (
    <button onClick={copy} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-muted hover:text-accent" title={label} aria-label={label}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function RemotePairCard({ port }: { port: string }) {
  const [status, setStatus] = useState<WebuiStatus | null>(null);
  const [qr, setQr] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareErr, setShareErr] = useState("");

  const refresh = useCallback(() => invoke<WebuiStatus>("webui_status").then(setStatus).catch(() => setStatus(null)), []);
  // Poll while the card is up: the tunnel can drop on its own (Cloudflare
  // reconnects, the Mac changes network) and the card must say so.
  useEffect(() => {
    let alive = true;
    const tick = () => { if (alive) void refresh(); };
    tick();
    const id = window.setInterval(tick, 3000);
    return () => { alive = false; window.clearInterval(id); };
  }, [port, refresh]);

  const url = status?.remote_url || "";
  useEffect(() => {
    if (!url) { setQr(""); return; }
    let alive = true;
    // Dark-on-light so phone cameras lock on instantly regardless of theme.
    QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: "#0a0d1f", light: "#ffffff" } })
      .then((d) => { if (alive) setQr(d); })
      .catch(() => { if (alive) setQr(""); });
    return () => { alive = false; };
  }, [url]);

  async function share() {
    setSharing(true); setShareErr("");
    try { setStatus(await invoke<WebuiStatus>("webui_tunnel_start")); }
    catch (e) { setShareErr(String(e instanceof Error ? e.message : e)); void refresh(); }
    finally { setSharing(false); }
  }
  async function stopShare() {
    setShareErr("");
    try { setStatus(await invoke<WebuiStatus>("webui_tunnel_stop")); } catch { void refresh(); }
  }

  const localUrl = `http://localhost:${port}`;
  const tunnelOn = status?.tunnel_state === "on" && !!status.tunnel_url;
  const tunnelStarting = sharing || status?.tunnel_state === "starting";
  const tunnelError = shareErr || (status?.tunnel_state === "error" ? status.tunnel_error : "");
  const primaryIsTunnel = tunnelOn && url === status?.tunnel_url;

  return (
    <div className="mt-4 rounded-lg border border-accent-border bg-accent-soft px-5 py-4" data-testid="remote-pair">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">Live</div>
      <div className="text-sm text-text-primary">
        On this Mac: <a href={localUrl} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">{localUrl}</a>
      </div>

      {url ? (
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
          {qr && (
            <img src={qr} alt={`QR code for ${url}`} width={160} height={160} className="h-40 w-40 shrink-0 rounded-md bg-white p-1" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Smartphone className="h-4 w-4 text-accent" /> On your phone
            </div>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 truncate rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-text-primary" data-testid="remote-primary-url">{url}</code>
              <CopyButton text={url} />
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-text-muted">
              {primaryIsTunnel
                ? <><Globe className="h-3.5 w-3.5 text-accent" /> Over the internet: works from anywhere, and the phone mic works (https). This address changes each time you share.</>
                : status?.via_tailscale
                  ? <><ShieldCheck className="h-3.5 w-3.5 text-accent" /> Over Tailscale: private to your devices, encrypted end to end.</>
                  : <><Wifi className="h-3.5 w-3.5" /> Same Wi-Fi as this Mac. Nothing to install on the phone.</>}
            </div>
            <ol className="mt-3 list-decimal space-y-1 pl-4 text-xs text-text-secondary">
              <li>Scan the code (or open the address) in Safari on iPhone, or Chrome on Android.</li>
              <li>Sign in with the username and password above.</li>
              <li><span className="font-medium text-text-primary">iPhone:</span> tap Share, then <span className="font-medium text-text-primary">Add to Home Screen</span>. <span className="font-medium text-text-primary">Android:</span> tap the menu, then <span className="font-medium text-text-primary">Install app</span>.</li>
            </ol>
            <div className="mt-2 text-[11px] text-text-muted">It opens full screen as its own app and stays signed in. This Mac must stay on.</div>
          </div>
        </div>
      ) : (
        <div className="mt-3 text-xs text-text-muted">
          Turn on <span className="font-medium text-text-primary">Reachable from other devices</span> above for a same-Wi-Fi address, or share over the internet below.
        </div>
      )}

      {/* Every way in, so the user can pick the one that fits where they are. */}
      <div className="mt-4 border-t border-border-subtle pt-3">
        <div className="mb-2 text-xs font-semibold text-text-primary">Ways to reach it</div>
        <div className="space-y-2">
          {status?.lan_url && (
            <div className="flex items-center gap-2 text-xs" data-testid="remote-lan">
              <Wifi className="h-3.5 w-3.5 shrink-0 text-text-muted" />
              <span className="w-24 shrink-0 text-text-secondary">Same Wi-Fi</span>
              <code className="min-w-0 flex-1 truncate font-mono text-text-primary">{status.lan_url}</code>
              <CopyButton text={status.lan_url} />
            </div>
          )}
          {status?.tailscale_url && (
            <div className="flex items-center gap-2 text-xs" data-testid="remote-tailscale">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-text-muted" />
              <span className="w-24 shrink-0 text-text-secondary">Tailscale</span>
              <code className="min-w-0 flex-1 truncate font-mono text-text-primary">{status.tailscale_url}</code>
              <CopyButton text={status.tailscale_url} />
            </div>
          )}
          <div className="flex items-center gap-2 text-xs" data-testid="remote-tunnel">
            <Globe className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <span className="w-24 shrink-0 text-text-secondary">Internet</span>
            {tunnelOn ? (
              <>
                <code className="min-w-0 flex-1 truncate font-mono text-text-primary" data-testid="remote-tunnel-url">{status!.tunnel_url}</code>
                <CopyButton text={status!.tunnel_url} />
                <button onClick={() => void stopShare()} className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-text-muted hover:text-warn">Stop sharing</button>
              </>
            ) : status && !status.cloudflared_installed ? (
              <>
                <span className="min-w-0 flex-1 text-text-muted">Needs cloudflared. In Terminal: <code className="font-mono text-text-primary">{BREW_CLOUDFLARED}</code></span>
                <CopyButton text={BREW_CLOUDFLARED} label="Copy command" />
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 text-text-muted">{tunnelStarting ? "Asking Cloudflare for an address..." : "Off. One tap gives you a public https address, no account, no router setup."}</span>
                <button onClick={() => void share()} disabled={tunnelStarting || !status?.running} className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-on-accent disabled:opacity-50">
                  {tunnelStarting ? "Starting..." : "Share over the internet"}
                </button>
              </>
            )}
          </div>
          {tunnelError && <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn" data-testid="remote-tunnel-error">{tunnelError}</div>}
        </div>
        <div className="mt-3 flex items-start gap-1.5 text-[11px] text-text-muted">
          <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Hold-to-talk on the phone needs the internet address: browsers only open the microphone on https. Over Wi-Fi, everything else works and the keyboard mic still types.</span>
        </div>
      </div>
    </div>
  );
}
