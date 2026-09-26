// Google accounts for the Calendar pull. `calendar pull-google` reads events
// through the Google Workspace CLI (gws), one config dir per Google account.
// This card installs the CLI and signs accounts in or out; everything else
// Google (mail, drive) now comes through the runtime connectors on Apps.
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, ExternalLink, Loader2, LogIn, Plus, Trash2 } from "lucide-react";
import { invoke, listen } from "./bridge";
import { openExternal } from "./appsmirror-parts";

type CliStatus = { installed: boolean; version: string | null; bin: string | null };
type Profile = { configDir: string; label: string; email: string | null; status: "connected" | "expired" | "needs_scope" | "unknown" };

const STATUS: Record<Profile["status"], { label: string; cls: string }> = {
  connected: { label: "Connected", cls: "text-ok" },
  expired: { label: "Sign-in expired", cls: "text-warn" },
  needs_scope: { label: "Needs access again", cls: "text-warn" },
  unknown: { label: "Not verified", cls: "text-text-muted" },
};

// Run one streamed gws command and collect its lines until it reports done.
async function stream(prefix: "google_install" | "google_auth", start: (session: string) => Promise<unknown>, onLine: (l: string) => void) {
  const session = `${prefix}-${crypto.randomUUID()}`;
  let unLine = () => {};
  let unDone = () => {};
  try {
    await new Promise<void>((resolve) => {
      void (async () => {
        unLine = await listen<{ session: string; data: unknown }>(`${prefix}:line`, (e) => {
          if (e.payload.session !== session) return;
          const line = typeof e.payload.data === "string" ? e.payload.data : JSON.stringify(e.payload.data);
          if (line.trim()) onLine(line);
        });
        unDone = await listen<{ session: string }>(`${prefix}:done`, (e) => { if (e.payload.session === session) resolve(); });
        start(session).catch((err) => { onLine(String(err).slice(0, 200)); resolve(); });
      })();
    });
  } finally { unLine(); unDone(); }
}

export function GoogleAccountsCard({ vaultPath, onChanged }: { vaultPath: string; onChanged?: () => void }) {
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string>("");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const live = useRef(true);

  const reload = useCallback(async () => {
    try {
      const s = await invoke<CliStatus>("google_cli_status");
      if (!live.current) return;
      setCli(s);
      if (s.installed) {
        const ps = await invoke<Profile[]>("google_profiles");
        if (live.current) setProfiles(Array.isArray(ps) ? ps : []);
      }
    } catch { if (live.current) setCli({ installed: false, version: null, bin: null }); }
  }, []);
  useEffect(() => { live.current = true; void reload(); return () => { live.current = false; }; }, [reload]);

  async function install() {
    setBusy("install"); setLog("");
    await stream("google_install", (session) => invoke("google_cli_install_stream", { session }), (l) => setLog(l));
    await reload();
    setBusy(null);
  }
  async function signIn(configDir: string | null, label?: string) {
    setBusy(configDir ?? "new"); setLog(""); setAuthUrl(null);
    await stream("google_auth", (session) => invoke("google_auth_login_stream", { session, configDir, label: label ?? null }), (l) => {
      setLog(l);
      const m = l.match(/https:\/\/accounts\.google\.com\/o\/oauth2\/[^\s"']+/);
      if (m) setAuthUrl(m[0]);
    });
    await reload();
    // Keep the agent-facing Google app in step with the account set.
    await invoke("google_scaffold", { vault: vaultPath }).catch(() => {});
    setBusy(null); setAuthUrl(null); setNewLabel("");
    onChanged?.();
  }
  async function remove(configDir: string) {
    setBusy(configDir);
    try {
      await invoke("google_profile_remove", { configDir });
      await reload();
      await invoke("google_scaffold", { vault: vaultPath }).catch(() => {});
      onChanged?.();
    } catch (e) { setLog(String(e).slice(0, 200)); }
    setBusy(null);
  }

  const btn = "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-text-secondary hover:border-accent-border hover:text-accent disabled:opacity-45";
  return (
    <div className="mb-4 rounded-xl border border-border-subtle bg-surface p-4">
      <h3 className="text-base font-semibold text-text-primary">Google accounts</h3>
      <p className="mt-0.5 text-[13px] text-text-muted">Calendar reads events through the Google Workspace CLI, one sign-in per account.</p>
      {cli === null ? (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Checking</p>
      ) : !cli.installed ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-[13px] text-text-secondary">The Google Workspace CLI is not installed.</span>
          <button type="button" className={btn} onClick={install} disabled={!!busy}>
            {busy === "install" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Install
          </button>
        </div>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-border-subtle">
            {profiles.length === 0 && <li className="py-2 text-[13px] text-text-muted">No accounts yet.</li>}
            {profiles.map((p) => {
              const st = STATUS[p.status] ?? STATUS.unknown;
              return (
                <li key={p.configDir} className="flex min-h-[48px] min-w-0 flex-wrap items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold text-text-primary">{p.email || p.label}</div>
                    <div className={`flex items-center gap-1 text-[12px] ${st.cls}`}>{p.status !== "connected" && p.status !== "unknown" && <AlertTriangle className="h-3 w-3" />}{st.label}</div>
                  </div>
                  {p.status !== "connected" && (
                    <button type="button" className={btn} onClick={() => signIn(p.configDir)} disabled={!!busy}>
                      {busy === p.configDir ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />} Sign in again
                    </button>
                  )}
                  <button type="button" aria-label={`Remove ${p.email || p.label}`} title="Remove this account" onClick={() => remove(p.configDir)} disabled={!!busy}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-err/10 hover:text-err disabled:opacity-45">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value.replace(/[^a-z0-9-]/gi, "").toLowerCase())} placeholder="Account name, e.g. work"
              aria-label="Account name"
              className="w-48 rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted/70 focus:border-accent-border focus:outline-none" />
            <button type="button" className={btn} onClick={() => signIn(null, newLabel || "default")} disabled={!!busy}>
              {busy === "new" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add account
            </button>
          </div>
        </>
      )}
      {authUrl && (
        <button type="button" onClick={() => openExternal(authUrl)} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
          Open the Google sign-in page <ExternalLink className="h-3.5 w-3.5" />
        </button>
      )}
      {log && busy && <p className="mt-2 truncate font-mono text-[12px] text-text-muted" title={log}>{log}</p>}
    </div>
  );
}
