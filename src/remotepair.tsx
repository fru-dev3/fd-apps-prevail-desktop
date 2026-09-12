// Pair a phone with this Mac's WebUI. Shown under Settings > Remote once the
// bridge is running: the address other devices use, a QR code that opens it,
// and the two-tap "install as an app" steps for iPhone and Android. There is
// no separate mobile app to build: the WebUI serves the real bundle, and the
// manifest + iOS meta in index.html make it installable as a standalone app.
import { useEffect, useState } from "react";
import { Copy, Check, Smartphone, ShieldCheck, Wifi } from "lucide-react";
import QRCode from "qrcode";
import { invoke } from "./bridge";

interface WebuiStatus {
  running: boolean;
  port: number;
  user: string;
  remote: boolean;
  remote_url: string;
  via_tailscale: boolean;
}

export function RemotePairCard({ port }: { port: string }) {
  const [status, setStatus] = useState<WebuiStatus | null>(null);
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    invoke<WebuiStatus>("webui_status")
      .then((s) => { if (alive) setStatus(s); })
      .catch(() => { if (alive) setStatus(null); });
    return () => { alive = false; };
  }, [port]);

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

  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  }

  const localUrl = `http://localhost:${port}`;

  return (
    <div className="mt-4 rounded-lg border border-accent-border bg-accent-soft px-5 py-4">
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
              <code className="min-w-0 truncate rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-text-primary">{url}</code>
              <button onClick={copy} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-muted hover:text-accent" title="Copy address">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-text-muted">
              {status?.via_tailscale
                ? <><ShieldCheck className="h-3.5 w-3.5 text-accent" /> Over Tailscale: private to your devices, encrypted end to end.</>
                : <><Wifi className="h-3.5 w-3.5" /> Over your local network. Install Tailscale on both devices to reach it from anywhere, encrypted.</>}
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
          Turn on <span className="font-medium text-text-primary">Reachable from other devices</span> above to get a phone address and QR code.
        </div>
      )}
    </div>
  );
}
