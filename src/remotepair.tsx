// Phone: the one screen for putting Prevail on your phone. Lives at the top
// level of the Editor nav rather than buried in the network settings, because
// nobody goes looking for "mobile access" inside a WebUI server panel.
//
// It does the whole job in one place: turn the bridge on, show a QR code that
// signs the phone in WITHOUT typing a password, offer an internet address for
// when you are away from home, and say how to install it to the home screen.
// The technical knobs (port, username, password) stay in Network.
//
// The QR carries a one-shot pairing code in the URL fragment. Scanning trades
// it for a session token, which is what makes this usable: a generated
// password is miserable to type on a phone keyboard.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Globe, Mic, Smartphone, ShieldCheck, Wifi } from "lucide-react";
import QRCode from "qrcode";
import { invoke } from "./bridge";
import { PREF, getPref, setPref } from "./storage";
import { SettingsHeader } from "./sectionutil";
import { DesktopOnly } from "./emptystate";

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
  pair_ready: boolean;
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

// Poll the bridge. One hook so the Phone screen and the Network screen agree.
function useWebuiStatus(pollMs = 3000) {
  const [status, setStatus] = useState<WebuiStatus | null>(null);
  const refresh = useCallback(() => invoke<WebuiStatus>("webui_status").then(setStatus).catch(() => setStatus(null)), []);
  useEffect(() => {
    let alive = true;
    const tick = () => { if (alive) void refresh(); };
    tick();
    const id = window.setInterval(tick, pollMs);
    return () => { alive = false; window.clearInterval(id); };
  }, [refresh, pollMs]);
  return { status, setStatus, refresh };
}

// Keep a live pairing code for the address currently on screen. A code is
// single use, so the moment a phone spends one we mint the next: the QR on
// screen is always scannable, and `paired` gives us something true to say.
function usePairingQr(status: WebuiStatus | null) {
  const url = status?.remote_url ?? "";
  const [pairUrl, setPairUrl] = useState("");
  const [paired, setPaired] = useState(false);
  const mintedFor = useRef("");
  const wasReady = useRef(false);

  const mint = useCallback((forUrl: string) => {
    mintedFor.current = forUrl;
    invoke<string>("webui_pair_code")
      .then((u) => setPairUrl(u))
      .catch(() => setPairUrl("")); // fall back to the plain address + password
  }, []);

  useEffect(() => {
    if (!status?.running || !url) {
      setPairUrl("");
      mintedFor.current = "";
      wasReady.current = false;
      return;
    }
    const first = mintedFor.current !== url;
    const consumed = wasReady.current && !status.pair_ready;
    wasReady.current = status.pair_ready;
    if (consumed) {
      setPaired(true);
      window.setTimeout(() => setPaired(false), 6000);
    }
    if (first || consumed) mint(url);
  }, [status?.running, status?.pair_ready, url, mint, status]);

  // Stop handing out a way in once nobody is looking at the code.
  useEffect(() => () => { void invoke("webui_pair_clear").catch(() => {}); }, []);

  return { qrTarget: pairUrl || url, signsInAutomatically: !!pairUrl, paired, showNewCode: () => mint(url) };
}

export function RemotePairCard({ port }: { port: string }) {
  const { status, setStatus, refresh } = useWebuiStatus();
  const { qrTarget, signsInAutomatically, paired, showNewCode } = usePairingQr(status);
  const [qr, setQr] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareErr, setShareErr] = useState("");

  const url = status?.remote_url || "";
  useEffect(() => {
    if (!qrTarget) { setQr(""); return; }
    let alive = true;
    // Dark-on-light so phone cameras lock on instantly regardless of theme.
    QRCode.toDataURL(qrTarget, { margin: 1, width: 320, color: { dark: "#0a0d1f", light: "#ffffff" } })
      .then((d) => { if (alive) setQr(d); })
      .catch(() => { if (alive) setQr(""); });
    return () => { alive = false; };
  }, [qrTarget]);

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
    <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface" data-testid="remote-pair">
      {/* Header strip: state first, so a glance answers "is this on?" */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-surface-warm/60 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
          </span>
          <span className="text-sm font-semibold text-text-primary">Phone access is on</span>
        </div>
        <a href={localUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-text-muted hover:text-accent">{localUrl}</a>
      </div>

      {url ? (
        <div className="flex flex-col gap-6 px-5 py-5 sm:flex-row">
          {/* The QR is the product here, so it gets real size and a quiet frame. */}
          <div className="shrink-0">
            {qr
              ? <img src={qr} alt={`QR code for ${url}`} width={190} height={190} className="rounded-xl bg-white p-2 ring-1 ring-border" style={{ height: 190, width: 190 }} />
              : <div className="rounded-xl bg-surface-warm" style={{ height: 190, width: 190 }} />}
            <div className="mt-2 text-center">
              {paired
                ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ok" data-testid="remote-paired"><Check className="h-4 w-4" /> Phone paired</span>
                : signsInAutomatically
                  ? <button onClick={showNewCode} className="text-xs text-text-muted underline hover:text-accent">Show a new code</button>
                  : null}
            </div>
          </div>

          {/* Three steps, as steps: a numbered badge and a short line each,
              instead of a paragraph pretending to be instructions. */}
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-xl font-semibold tracking-tight text-text-primary">Scan it with your phone</h3>
            <ol className="mt-3 space-y-2.5">
              {[
                ["Point your camera at the code", "Then open the link it offers."],
                signsInAutomatically
                  ? ["You are signed in.", "No password to type. The code works once, then expires."]
                  : ["Sign in", "Use the username and password from Network."],
                ["Keep it on your home screen", "iPhone: Share, then Add to Home Screen. Android: menu, then Install app."],
              ].map(([title, sub], i) => (
                <li key={title} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-[11px] font-bold text-accent ring-1 ring-accent-border">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium leading-snug text-text-primary">{title}</div>
                    <div className="text-xs leading-snug text-text-muted">{sub}</div>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-3 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-text-primary" data-testid="remote-primary-url">{url}</code>
              <CopyButton text={url} />
            </div>
            <div className="mt-1.5 text-[11px] text-text-muted">
              {primaryIsTunnel
                ? "Over the internet, so it works from anywhere."
                : status?.via_tailscale
                  ? "Over Tailscale, private to your devices."
                  : "Same Wi-Fi as this Mac."}
              {" This Mac must stay on."}
            </div>
          </div>
        </div>
      ) : (
        <div className="px-5 py-5 text-sm text-text-muted">
          Turn on <span className="font-medium text-text-primary">Reachable from other devices</span> for a same-Wi-Fi address, or share over the internet below.
        </div>
      )}

      {/* Ways in, as a table with one obvious state per row. */}
      <div className="border-t border-border-subtle px-5 py-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Ways to reach it</div>
        <div className="divide-y divide-border-subtle">
          <ReachRow icon={Wifi} label="Same Wi-Fi" value={status?.lan_url} active={!!status?.lan_url && url === status?.lan_url} testid="remote-lan"
            empty="Not on a network this Mac can share." />
          <ReachRow icon={ShieldCheck} label="Tailscale" value={status?.tailscale_url} active={!!status?.tailscale_url && url === status?.tailscale_url} testid="remote-tailscale"
            empty="Tailscale is not running on this Mac." />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2" data-testid="remote-tunnel">
            <Globe className="h-4 w-4 shrink-0 text-text-muted" />
            <span className="w-24 shrink-0 text-sm font-medium text-text-primary">Internet</span>
            {tunnelOn ? (
              <>
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary" data-testid="remote-tunnel-url">{status!.tunnel_url}</code>
                {primaryIsTunnel && <ActiveChip />}
                <CopyButton text={status!.tunnel_url} />
                <button onClick={() => void stopShare()} className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-text-muted hover:text-warn">Stop sharing</button>
              </>
            ) : status && !status.cloudflared_installed ? (
              <>
                <span className="min-w-0 flex-1 text-xs text-text-muted">Needs cloudflared</span>
                <code className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px]">{BREW_CLOUDFLARED}</code>
                <CopyButton text={BREW_CLOUDFLARED} label="Copy command" />
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 text-xs text-text-muted">{tunnelStarting ? "Asking Cloudflare for an address..." : "A public https address. No account, no router setup."}</span>
                <button onClick={() => void share()} disabled={tunnelStarting || !status?.running} className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-on-accent disabled:opacity-50">
                  {tunnelStarting ? "Starting..." : "Share over the internet"}
                </button>
              </>
            )}
          </div>
        </div>
        {tunnelError && <div className="mt-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn" data-testid="remote-tunnel-error">{tunnelError}</div>}
        <div className="mt-3 flex items-start gap-1.5 text-[11px] text-text-muted">
          <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Hold-to-talk needs the internet address: browsers only open the microphone on https. Everything else works over Wi-Fi.</span>
        </div>
      </div>
    </div>
  );
}

function ActiveChip() {
  return <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-accent ring-1 ring-accent-border">In the QR</span>;
}

// One way in: icon, name, address, and whether it is the one the QR points at.
function ReachRow({ icon: Icon, label, value, active, testid, empty }: {
  icon: typeof Wifi; label: string; value?: string; active: boolean; testid: string; empty: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2" data-testid={testid}>
      <Icon className="h-4 w-4 shrink-0 text-text-muted" />
      <span className="w-24 shrink-0 text-sm font-medium text-text-primary">{label}</span>
      {value ? (
        <>
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary">{value}</code>
          {active && <ActiveChip />}
          <CopyButton text={value} />
        </>
      ) : (
        <span className="min-w-0 flex-1 text-xs text-text-muted">{empty}</span>
      )}
    </div>
  );
}

// ── The Phone screen ──────────────────────────────────────────────────

// Turning phone access on is one button, not a tour of the network settings:
// mint a password if there isn't one, switch reachability on, start the bridge.
async function enablePhoneAccess(): Promise<void> {
  let pass = "";
  try { pass = await invoke<string>("webui_secret_get"); } catch { /* keychain unavailable */ }
  if (!pass) {
    pass = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
    try { await invoke("webui_secret_set", { pass }); } catch { /* ignore */ }
  }
  const port = Number(getPref(PREF.webuiPort, "8787")) || 8787;
  const user = getPref(PREF.webuiUser, "admin");
  setPref(PREF.webuiRemote, "1");
  await invoke("webui_start", { port, user, pass, remote: true });
}

export function PhoneSection() {
  const { status, refresh } = useWebuiStatus();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function turnOn() {
    setBusy(true); setErr("");
    try { await enablePhoneAccess(); await refresh(); }
    catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  const running = !!status?.running;
  const port = String(status?.port || getPref(PREF.webuiPort, "8787"));

  return (
    <>
      <SettingsHeader
        title="Phone"
        subtitle="Use Prevail from your phone. It stays on your Mac: the phone is a window onto it, so your vault and your models never leave this machine."
        icon={Smartphone}
      />
      <DesktopOnly feature="Phone setup">
        {!running ? (
          <div className="rounded-lg border border-border bg-surface px-6 py-8 text-center">
            <Smartphone className="mx-auto h-10 w-10 text-accent" />
            <div className="mt-3 text-base font-semibold text-text-primary">Put Prevail on your phone</div>
            <p className="mx-auto mt-1 max-w-md text-sm text-text-muted">
              Turn this on and a QR code appears. Scan it and your phone is signed in, with no password to type. It installs to the home screen like a normal app.
            </p>
            <button onClick={() => void turnOn()} disabled={busy} className="mt-5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50">
              {busy ? "Starting..." : "Turn on phone access"}
            </button>
            {err && <div className="mx-auto mt-3 max-w-md rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{err}</div>}
            <div className="mt-4 text-[11px] text-text-muted">This Mac must stay on and awake for the phone to reach it.</div>
          </div>
        ) : (
          <>
            <RemotePairCard port={port} />
            <div className="mt-3 text-xs text-text-muted">
              Port, username and password live in{" "}
              <button onClick={() => window.dispatchEvent(new CustomEvent("prevail:open-settings", { detail: "remote" }))} className="underline hover:text-accent">
                Network
              </button>.
            </div>
          </>
        )}
      </DesktopOnly>
    </>
  );
}
