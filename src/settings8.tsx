// Settings sections extracted from App.tsx: Appearance (theme + palette), Demo
// Mode (sample-vault sandbox), and Vault settings (path + the backup-automation
// card).
import { useEffect, useState } from "react";
import { confirm as tauriConfirm, open } from "@tauri-apps/plugin-dialog";
import { Archive, DatabaseBackup, ExternalLink, FolderCog, FolderOpen, FolderTree, Loader2, Monitor, Moon, RotateCw, ShieldCheck, Sparkles, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { invoke } from "./bridge";
import { PALETTES } from "./constants";
import { formatFreshness } from "./format";
import { bytesHuman } from "./helpers";
import { LS, lsGet, lsSet } from "./storage";
import { Toggle } from "./ui";
import { PaletteCard } from "./panels3";
import { useAppearance } from "./hooks";
import { ObsidianCard } from "./settings4";
import { SettingsHeader } from "./sectionutil";
import { VaultHygieneCard } from "./vaulthygiene";
import { BACKUP_CFG, backupFreqMs, backupVaultNow } from "./backup";
import type { Mode } from "./types";

export function AppearanceSection({ appearance }: { appearance: ReturnType<typeof useAppearance> }) {
  return (
    <section className="mt-10">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">Appearance</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Mode controls brightness; theme controls the accent palette and surface styling.
          </p>
        </div>
      </div>

      {/* Color Mode segmented control */}
      <div className="mt-6 rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium">Color Mode</div>
            <div className="mt-1 text-sm text-text-secondary">
              Pick a fixed mode or let Prevail follow your system setting.
            </div>
          </div>
          <div className="inline-flex shrink-0 items-center rounded-md border border-border bg-background p-1 text-xs">
            {[
              { id: "light", label: "Light", icon: Sun },
              { id: "dark", label: "Dark", icon: Moon },
              { id: "system", label: "System", icon: Monitor },
            ].map((m) => {
              const Icon = m.icon;
              const active = appearance.mode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => appearance.setMode(m.id as Mode)}
                  className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 transition-colors ${
                    active
                      ? "bg-accent text-background shadow-sm"
                      : "text-text-secondary hover:bg-surface-warm"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Theme palette cards */}
      <div className="mt-6">
        <div className="mb-1 font-medium">Theme</div>
        <p className="mb-4 text-sm text-text-secondary">
          Desktop palettes. The selected mode is applied on top.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PALETTES.map((p) => (
            <PaletteCard
              key={p.id}
              palette={p}
              active={appearance.palette === p.id}
              onSelect={() => appearance.setPalette(p.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}


// Council config - its own first-class section. You pick the EXACT models on the
// default panel (per-provider, multiple models allowed) and which one chairs.

export function DemoModeSection({ vaultPath, onVaultMoved, onSetupDomains, headerless }: { vaultPath: string; onVaultMoved?: (path: string) => void; onSetupDomains?: () => void; headerless?: boolean }) {
  const [appMode, setAppMode] = useState<"demo" | "production" | null>(null);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // B2-16: per-vault backup toggle on the active card. Backup snapshots the
  // ACTIVE vault, so this reflects/controls BACKUP_CFG.enabled.
  const [backupOn, setBackupOn] = useState(() => lsGet(BACKUP_CFG.enabled, "0") === "1");
  const toggleBackup = (v: boolean) => { setBackupOn(v); lsSet(BACKUP_CFG.enabled, v ? "1" : "0"); window.dispatchEvent(new Event("prevail:bench-sched")); };
  // Backup status surfaced next to the toggle: schedule, next-run, run-now, folder.
  const [backupTick, setBackupTick] = useState(0);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupFreq, setBackupFreqState] = useState(() => lsGet(BACKUP_CFG.freq, "weekly") || "weekly");
  const setBackupFreq = (v: string) => { setBackupFreqState(v); lsSet(BACKUP_CFG.freq, v); window.dispatchEvent(new Event("prevail:bench-sched")); setBackupTick((t) => t + 1); };
  const customDays = /^custom:(\d+)$/.exec(backupFreq)?.[1] ?? "2";
  const backupNextLabel = (() => {
    void backupTick; // re-evaluate after a manual backup
    const last = Number(lsGet(BACKUP_CFG.lastRun, "0")) || 0;
    if (!last) return "on next check";
    const next = last + backupFreqMs(backupFreq);
    return new Date(next).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  })();
  const backupNow = async () => {
    setBackupBusy(true);
    try { await backupVaultNow(vaultPath); setBackupTick((t) => t + 1); } finally { setBackupBusy(false); }
  };
  const openBackupsFolder = async () => {
    try {
      // Prefer an existing backup's folder; fall back to the effective backup dir
      // so this works even before the first backup has been written.
      const list = await invoke<{ path: string }[]>("vault_backups_list", { destDir: lsGet(BACKUP_CFG.dest) || null });
      const p = (Array.isArray(list) && list[0]?.path) || (await invoke<string>("vault_backup_dir", { destDir: lsGet(BACKUP_CFG.dest) || null }));
      if (p) await invoke("open_in_finder", { path: p });
    } catch (e) { console.error("open backups folder", e); }
  };
  // The folder backups are actually written to: a saved override (BACKUP_CFG.dest)
  // or the default app-support/backups. Shown + changeable right on the card.
  const [backupDir, setBackupDir] = useState<string>("");
  const [backupDirCustom, setBackupDirCustom] = useState<boolean>(() => !!lsGet(BACKUP_CFG.dest));
  useEffect(() => {
    invoke<string>("vault_backup_dir", { destDir: lsGet(BACKUP_CFG.dest) || null }).then(setBackupDir).catch(() => {});
  }, [backupTick]);
  const changeBackupDir = async () => {
    const picked = await open({ directory: true, multiple: false, title: "Choose a backup folder" });
    if (typeof picked === "string" && picked) {
      lsSet(BACKUP_CFG.dest, picked);
      setBackupDirCustom(true);
      setBackupTick((t) => t + 1);
      window.dispatchEvent(new Event("prevail:backup-done"));
    }
  };
  const resetBackupDir = () => {
    lsSet(BACKUP_CFG.dest, "");
    setBackupDirCustom(false);
    setBackupTick((t) => t + 1);
    window.dispatchEvent(new Event("prevail:backup-done"));
  };
  // Rescan the workspace: re-read domains/apps from disk (picks up anything added
  // outside the app, or a file that went missing) and refresh every surface.
  const [rescanning, setRescanning] = useState(false);
  const [rescanNote, setRescanNote] = useState<string | null>(null);
  const rescanVault = async () => {
    setRescanning(true); setRescanNote(null);
    try {
      const ds = await invoke<{ name: string }[]>("scan_vault", { path: vaultPath });
      window.dispatchEvent(new Event("prevail:domains-changed"));
      window.dispatchEvent(new Event("prevail:apps-changed"));
      window.dispatchEvent(new Event("prevail:tasks-changed"));
      const n = Array.isArray(ds) ? ds.length : 0;
      setRescanNote(`Rescanned: ${n} domain${n === 1 ? "" : "s"} found.`);
      window.setTimeout(() => setRescanNote(null), 4000);
    } catch (e) {
      setRescanNote(`Rescan failed: ${e}`);
    } finally { setRescanning(false); }
  };
  const BackupStatusLine = () => (
    backupOn ? (
      // Schedule on the left; actions as right-aligned icon buttons (with tooltips)
      // that match the path row's icon-button style for an even, clean layout.
      <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-muted">
        {/* Editable schedule, right here: daily / weekly / monthly / every N days
            (every other day = 2, every other week = 14). */}
        <select
          value={/^custom:/.test(backupFreq) ? "custom" : backupFreq}
          onChange={(e) => setBackupFreq(e.target.value === "custom" ? `custom:${customDays}` : e.target.value)}
          title="How often automatic backups run"
          className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-text-secondary focus:border-accent-border focus:outline-none"
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="custom">every N days</option>
        </select>
        {/^custom:/.test(backupFreq) && (
          <span className="inline-flex items-center gap-1">
            <input type="number" min={1} max={365} value={customDays}
              onChange={(e) => setBackupFreq(`custom:${Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 1))}`)}
              className="w-12 rounded border border-border bg-background px-1.5 py-0.5 text-right font-mono text-[10px] text-text-secondary focus:border-accent-border focus:outline-none" />
            <span>Days</span>
          </span>
        )}
        <span className="min-w-0 flex-1 truncate" title="Next scheduled backup">· next ~{backupNextLabel}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button onClick={backupNow} disabled={backupBusy} title="Back up now" className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40">
            {backupBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DatabaseBackup className="h-3.5 w-3.5" />}
          </button>
          <button onClick={changeBackupDir} title={`Change backup folder (now: ${backupDir || "default"})`} className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent">
            <FolderCog className="h-3.5 w-3.5" />
          </button>
          <button onClick={openBackupsFolder} title="Open backups folder" className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent">
            <Archive className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* Where backups land — visible + changeable right here. Kept OUTSIDE the
            vault (a backup inside what it backs up is circular). */}
        <div className="flex w-full items-center gap-1.5 text-[11px] text-text-muted">
          <FolderOpen className="h-3 w-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={backupDir}>{backupDir || "default location"}{backupDirCustom ? "" : " · default"}</span>
          <button onClick={changeBackupDir} className="shrink-0 hover:text-accent">Change</button>
          {backupDirCustom && <button onClick={resetBackupDir} className="shrink-0 hover:text-accent">Reset</button>}
        </div>
      </div>
    ) : null
  );
  // The remembered production vault path, so switching demo<->production never
  // re-asks for the folder, and both locations can be shown.
  const [prodVault, setProdVault] = useState<string>(() => lsGet(LS.vaultProduction) || "");
  useEffect(() => {
    const loadMode = () =>
      invoke<{ mode: "demo" | "production" }>("engine_appmode_get").then((m) => setAppMode(m.mode)).catch(() => {});
    loadMode();
    window.addEventListener("prevail:appmode", loadMode);
    return () => window.removeEventListener("prevail:appmode", loadMode);
  }, []);
  // When we're in production, the current vaultPath IS the production vault -
  // remember it (covers vaults set up before this round-trip logic existed).
  useEffect(() => {
    if (appMode === "production" && vaultPath && !vaultPath.includes("/.prevail/demo-vault")) {
      if (vaultPath !== prodVault) { setProdVault(vaultPath); lsSet(LS.vaultProduction, vaultPath); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode, vaultPath]);

  // Point the app at a chosen folder as the production vault. `runOnboarding`
  // controls whether an empty vault triggers the domain setup flow.
  async function enterProduction(picked: string, runOnboarding: boolean) {
    // Snapshot before clearing the demo sandbox (a pre-event backup).
    await backupVaultNow(vaultPath);
    await invoke<{ vault: string; demoCleared: boolean }>("engine_production_init", { vault: picked, clearDemo: vaultPath });
    await invoke("engine_appmode_set", { mode: "production", vault: picked }).catch(() => {});
    setProdVault(picked); lsSet(LS.vaultProduction, picked);
    setAppMode("production");
    window.dispatchEvent(new Event("prevail:appmode"));
    onVaultMoved?.(picked);
    // Only onboard a genuinely EMPTY vault. If the folder you pointed at already
    // has domains, it's ready to use - scan it and skip the setup modal entirely.
    if (runOnboarding) {
      const existing = await invoke<{ name: string }[]>("scan_vault", { path: picked }).catch(() => [] as { name: string }[]);
      if (!existing || existing.length === 0) onSetupDomains?.();
    }
  }

  // Leave the demo sandbox for your own vault. If a production vault is already
  // remembered, just switch back to it (no re-pick, no onboarding); otherwise
  // pick a fresh folder and run setup.
  async function switchToProduction() {
    // Already have a production vault on disk? Round-trip straight back to it.
    if (prodVault) {
      const ok = await invoke<boolean>("vault_exists", { path: prodVault }).catch(() => false);
      if (ok) {
        setSwitchingMode(true); setNote(null);
        try {
          await invoke("engine_appmode_set", { mode: "production", vault: prodVault }).catch(() => {});
          setAppMode("production");
          window.dispatchEvent(new Event("prevail:appmode"));
          onVaultMoved?.(prodVault);
          setNote(`Back in your own vault (${prodVault}).`);
        } catch (e) { setNote(`Could not switch: ${String(e)}`); }
        finally { setSwitchingMode(false); }
        return;
      }
    }
    const confirmOk = await tauriConfirm(
      "Ready to set up your own vault? You'll choose a folder for it, then set up your domains. The demo sample data is cleared.",
      { title: "Use your own vault", kind: "info", okLabel: "Choose my vault folder", cancelLabel: "Stay in demo" },
    );
    if (!confirmOk) return;
    const picked = await open({ directory: true, multiple: false, title: "Choose a folder for your own vault" });
    if (!picked || typeof picked !== "string") return;
    setSwitchingMode(true);
    setNote(null);
    try {
      await enterProduction(picked, true);
    } catch (e) {
      setNote(`Could not set up your vault: ${String(e)}`);
    } finally {
      setSwitchingMode(false);
    }
  }
  // B2-15: change the vault folder from the card icon — pick a new directory and
  // point the app at it (same path the 3-step setup uses).
  async function changeVaultPath() {
    const picked = await open({ directory: true, multiple: false, title: "Choose your vault folder" });
    if (!picked || typeof picked !== "string") return;
    setSwitchingMode(true);
    setNote(null);
    try { await enterProduction(picked, true); }
    catch (e) { setNote(`Could not switch vault: ${String(e)}`); }
    finally { setSwitchingMode(false); }
  }
  // Return to the demo sandbox: repoint the app at the demo vault (re-seeding
  // the bundled sample data) and flip the flag. The production vault is
  // remembered, untouched, and one click away.
  async function switchToDemo() {
    setSwitchingMode(true);
    setNote(null);
    try {
      const demoPath = await invoke<string>("import_sample_vault");
      await invoke("engine_appmode_set", { mode: "demo", vault: demoPath }).catch(() => {});
      await invoke("engine_appmode_mark_demo", { vault: demoPath }).catch(() => {});
      setAppMode("demo");
      window.dispatchEvent(new Event("prevail:appmode"));
      onVaultMoved?.(demoPath);
      setNote("You're back in the demo sandbox. Your own vault is remembered and one click away.");
    } catch (e) {
      setNote(`Could not switch: ${String(e)}`);
    } finally {
      setSwitchingMode(false);
    }
  }
  const isDemo = appMode === "demo";
  return (
    <>
      {/* "Sandbox" - the throwaway exploration space. Your vault vs the demo
          vault as MUTUALLY-EXCLUSIVE toggles. */}
      {!headerless && (
        <SettingsHeader
          icon={Sparkles}
          title="Sandbox"
          subtitle="Explore with sample data before using your own."
        />
      )}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className={`rounded-xl border p-4 transition-all ${!isDemo ? "border-2 border-warn bg-warn/10 shadow-sm" : "border border-border bg-surface opacity-55"}`}>
          {/* Header: shield + title + Active, toggle hard-right. */}
          <div className="flex items-center gap-2">
            <ShieldCheck className={`h-4 w-4 shrink-0 ${!isDemo ? "text-warn" : "text-text-muted"}`} />
            <span className="text-sm font-semibold text-text-primary">Your vault</span>
            {!isDemo && <span className="rounded-full bg-warn px-1.5 py-0.5 text-[11px] font-bold text-background">Active</span>}
            <span className="ml-auto"><Toggle on={!isDemo} disabled={switchingMode} onChange={(v) => { if (v) void switchToProduction(); else void switchToDemo(); }} label="Use my own vault" /></span>
          </div>
          {/* Path + an even, aligned row of icon actions: rescan, change folder, open. */}
          <div className="mt-2 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[11px] text-text-secondary" title={prodVault || "not set up yet"}>{prodVault || (isDemo ? "not set up yet - toggle on to set up" : vaultPath)}</span>
            <div className="flex shrink-0 items-center gap-0.5">
              <button onClick={rescanVault} disabled={rescanning} title="Rescan the workspace for the canonical structure" className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40"><RotateCw className={`h-3.5 w-3.5 ${rescanning ? "animate-spin" : ""}`} /></button>
              <button onClick={changeVaultPath} disabled={switchingMode} title="Change vault folder" className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent disabled:opacity-40"><FolderOpen className="h-3.5 w-3.5" /></button>
              {(prodVault || !isDemo) && (
                <button onClick={() => void invoke("open_in_finder", { path: prodVault || vaultPath }).catch(() => {})} title="Open in Finder" className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-warm hover:text-accent"><ExternalLink className="h-3.5 w-3.5" /></button>
              )}
            </div>
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-text-muted">Real data, backed up. {isDemo && !prodVault ? "Toggling on walks you through a quick 3-step setup." : "Switching to demo never touches it."}</div>
          {rescanNote && <div className="mt-1.5 font-mono text-[10px] text-accent">{rescanNote}</div>}
          {/* Per-vault backup toggle (active vault only). */}
          {!isDemo && (
            <div className="mt-3 border-t border-border-subtle/60 pt-2.5">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[11px] text-text-secondary">Automatic backups</span>
                <Toggle on={backupOn} onChange={toggleBackup} label="Back up your vault" />
              </div>
              <BackupStatusLine />
            </div>
          )}
        </div>
        <div className={`rounded-xl border p-4 transition-all ${isDemo ? "border-2 border-accent bg-accent-soft shadow-sm" : "border border-border bg-surface opacity-55"}`}>
          <div className="flex items-center gap-2">
            <Sparkles className={`h-4 w-4 ${isDemo ? "text-accent" : "text-text-muted"}`} />
            <span className="text-sm font-semibold text-text-primary">Demo vault</span>
            {isDemo && <span className="rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-bold text-background">Active</span>}
            <span className="ml-auto"><Toggle on={isDemo} disabled={switchingMode} onChange={(v) => { if (v) void switchToDemo(); else void switchToProduction(); }} label="Explore the demo sandbox" /></span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[11px] text-text-secondary" title={isDemo ? vaultPath : "sample data"}>{isDemo ? vaultPath : "throwaway sample data"}</span>
            {isDemo && (
              <button onClick={() => void invoke("open_in_finder", { path: vaultPath }).catch(() => {})} title="Open in Finder" className="shrink-0 rounded p-1 text-text-muted hover:text-accent"><ExternalLink className="h-3.5 w-3.5" /></button>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-text-muted">Sample data, re-seeded. Safe to explore; nothing here is your real data.</div>
          {isDemo && (
            <div className="mt-2 border-t border-border-subtle/60 pt-2">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[11px] text-text-muted">Automatic backups</span>
                <Toggle on={backupOn} onChange={toggleBackup} label="Back up demo vault" />
              </div>
              <BackupStatusLine />
            </div>
          )}
        </div>
      </div>
      {switchingMode && <div className="mb-4 text-xs text-text-muted">Switching…</div>}
      {/* Switch feedback (set by switchToProduction / switchToDemo). */}
      {note && (
        <div className="flex items-start gap-2 rounded-lg border border-accent-border bg-accent-soft px-3 py-2 text-xs text-text-primary">
          <span>{note}</span>
        </div>
      )}
    </>
  );
}

export function BackupAutomationCard({ vault, onChange }: { vault: string; onChange?: () => void }) {
  const [enabled, setEnabled] = useState(() => lsGet(BACKUP_CFG.enabled, "0") === "1");
  const [freq, setFreq] = useState(() => lsGet(BACKUP_CFG.freq, "weekly") || "weekly");
  const [backups, setBackups] = useState<{ name: string; path: string; bytes: number; mtime: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Where backups are written: a saved override (BACKUP_CFG.dest) or the default.
  // We show the effective resolved path so it's never a mystery.
  const [dest, setDest] = useState<string>(() => lsGet(BACKUP_CFG.dest) || "");
  const [effectiveDir, setEffectiveDir] = useState<string>("");
  const loadDir = () => invoke<string>("vault_backup_dir", { destDir: lsGet(BACKUP_CFG.dest) || null }).then(setEffectiveDir).catch(() => {});
  useEffect(() => { loadDir(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dest]);
  const changeBackupDir = async () => {
    const picked = await open({ directory: true, multiple: false, title: "Choose a backup folder" });
    if (typeof picked === "string" && picked) { lsSet(BACKUP_CFG.dest, picked); setDest(picked); refresh(); }
  };
  const resetBackupDir = () => { lsSet(BACKUP_CFG.dest, ""); setDest(""); refresh(); };
  const refresh = () =>
    invoke<{ name: string; path: string; bytes: number; mtime: number }[]>("vault_backups_list", { destDir: lsGet(BACKUP_CFG.dest) || null })
      .then((b) => setBackups(Array.isArray(b) ? b : []))
      .catch(() => {});
  useEffect(() => {
    refresh();
    const f = () => refresh();
    window.addEventListener("prevail:backup-done", f);
    return () => window.removeEventListener("prevail:backup-done", f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const last = Number(lsGet(BACKUP_CFG.lastRun, "0")) || 0;
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <RotateCw className="h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-semibold tracking-tight">Automatic backups</div>
          <div className="text-xs text-text-secondary">
            Snapshots the whole vault on a schedule (and before risky operations like encryption or a mode switch), kept outside the vault. Old ones are pruned automatically.
            {enabled && last > 0 && ` Last backup ${formatFreshness(Math.max(0, (Date.now() - last) / 1000))} ago.`}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <select value={/^custom:/.test(freq) ? "custom" : freq}
            onChange={(e) => { const v = e.target.value === "custom" ? `custom:${/^custom:(\d+)$/.exec(freq)?.[1] ?? "3"}` : e.target.value; setFreq(v); lsSet(BACKUP_CFG.freq, v); }}
            disabled={!enabled}
            className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-secondary disabled:opacity-40">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="custom">every N days</option>
          </select>
          {/^custom:/.test(freq) && (
            <div className="flex items-center gap-1">
              <input type="number" min={1} max={365} value={/^custom:(\d+)$/.exec(freq)?.[1] ?? "3"} disabled={!enabled}
                onChange={(e) => { const v = `custom:${Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 1))}`; setFreq(v); lsSet(BACKUP_CFG.freq, v); }}
                className="w-14 rounded-md border border-border bg-background px-2 py-1 text-right text-[11px] text-text-secondary disabled:opacity-40" />
              <span className="font-mono text-[11px] text-text-muted">Days</span>
            </div>
          )}
        </div>
        {/* D4: minimal - a toggle (peel switch) + schedule selector. The "or every
            N changes" input was the clutter the founder flagged; removed. */}
        <button onClick={async () => { setBusy(true); setNote(null); const ok = await backupVaultNow(vault); setNote(ok ? "Backup created." : "Backup failed."); setBusy(false); }}
          disabled={busy}
          className="rounded-md border border-border px-3 py-1 text-[11px] text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-50">
          {busy ? "…" : "Back up now"}
        </button>
        <Toggle on={enabled} onChange={(v) => { setEnabled(v); lsSet(BACKUP_CFG.enabled, v ? "1" : "0"); }} label="Automatic backups" />
      </div>
      {note && <div className="mt-2 text-xs text-text-secondary">{note}</div>}
      {/* Backup location: the effective folder + change / reset. Kept OUTSIDE the
          vault on purpose (a backup inside what it backs up is circular). */}
      <div className="mt-3 flex items-center gap-2 border-t border-border-subtle pt-2.5">
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] text-text-muted">Backup location {dest ? "" : "· default"}</div>
          <div className="truncate text-[11px] text-text-secondary" title={effectiveDir}>{effectiveDir || "…"}</div>
        </div>
        <button onClick={changeBackupDir} title="Choose a different backup folder" className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-muted hover:border-accent-border hover:text-accent">Change</button>
        {dest && <button onClick={resetBackupDir} title="Reset to the default location" className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[11px] text-text-muted hover:border-accent-border hover:text-accent">Reset</button>}
      </div>
      {backups.length > 0 && (
        <details className="mt-3 rounded-lg border border-border-subtle bg-background px-3 py-2">
          <summary className="cursor-pointer text-[11px] text-text-muted">
            Restore points · {backups.length}
          </summary>
          <div className="mt-2 flex flex-col gap-1">
            {backups.map((b) => (
              <div key={b.path} className="flex items-center gap-2 px-1 py-1">
                <span className="flex-1 truncate text-[11px] text-text-secondary" title={b.path}>{b.name.replace("prevail-backup-", "").replace(".tar.gz", "")}</span>
                <span className="shrink-0 text-[11px] text-text-muted">{bytesHuman(b.bytes)}</span>
                <button
                  onClick={async () => {
                    const ok = await tauriConfirm(
                      "Restore this backup over your current vault? Your current state is backed up first, so this is reversible.",
                      { title: "Restore vault", kind: "warning", okLabel: "Restore", cancelLabel: "Cancel" },
                    );
                    if (!ok) return;
                    setBusy(true); setNote(null);
                    try {
                      await backupVaultNow(vault); // snapshot current state first
                      await invoke("vault_restore_archive", { vault, archive: b.path });
                      setNote("Restored. Reloading…");
                      onChange?.();
                      setTimeout(() => window.location.reload(), 900);
                    } catch (e) { setNote(`Restore failed: ${String(e)}`); }
                    finally { setBusy(false); }
                  }}
                  disabled={busy}
                  className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] text-text-muted hover:border-accent-border hover:text-accent disabled:opacity-50">
                  Restore
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// IA-1: "Workspace" is the single umbrella area covering where data lives (vault,
// domains, backups) + the throwaway Sandbox. Replaces the separate "Vault" and
// "Demo Mode" nav entries, composing the (headerless) Vault + Sandbox sections
// under one header with sub-labels.
function WorkspaceSubLabel({ icon: Icon, label, desc }: { icon: LucideIcon; label: string; desc: string }) {
  return (
    <div className="mb-2 mt-1 flex items-center gap-2 px-1">
      <Icon className="h-3.5 w-3.5 text-accent" />
      <h3 className="text-sm font-semibold text-text-primary">{label}</h3>
      <span className="ml-auto text-[11px] text-text-muted">{desc}</span>
    </div>
  );
}

// Rebuild the on-disk structure of the active vault: scan every domain and move
// any loose/legacy files into the clean source/ + memory/ + .system/ layout. Safe
// to run any time (idempotent: already-clean domains are skipped; originals are
// archived into each domain's _pre-v4-v4/ backup, never deleted). This is the
// one-button normalizer for a vault that came from an older layout or was edited
// by hand.
function VaultRebuildCard({ vaultPath }: { vaultPath: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const rebuild = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await invoke<{ ok: boolean; domains?: Array<{ domain: string; ops: number; already: boolean }>; error?: string }>("engine_vault_migrate_v4", { vault: vaultPath });
      if (!r.ok) { setMsg(`Rebuild failed: ${r.error ?? "unknown error"}`); return; }
      const doms = r.domains ?? [];
      const moved = doms.filter((d) => !d.already && d.ops > 0);
      const clean = doms.length - moved.length;
      window.dispatchEvent(new CustomEvent("prevail:vault-migrated"));
      setMsg(moved.length === 0
        ? `All ${doms.length} domain${doms.length === 1 ? "" : "s"} already on the clean layout. Nothing to move.`
        : `Rebuilt ${moved.length} domain${moved.length === 1 ? "" : "s"} into source/ + memory/ + .system/ (${clean} already clean). Originals archived in each domain's _pre-v4-v4 backup.`);
    } catch (e) {
      setMsg(`Rebuild failed: ${e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 rounded-lg border border-border-subtle bg-background p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><FolderCog className="h-4 w-4 text-accent" /> Rebuild structure</div>
          <div className="mt-0.5 text-xs text-text-secondary">
            Normalizes every domain into the clean layout. Originals are archived, never deleted.
          </div>
        </div>
        <button
          onClick={rebuild}
          disabled={busy || !vaultPath}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
          {busy ? "Rebuilding..." : "Rebuild"}
        </button>
      </div>
      {msg && <div className="mt-3 rounded-md border border-border-subtle bg-surface px-3 py-2 text-xs text-text-secondary">{msg}</div>}
    </div>
  );
}

export function WorkspaceSection({ vaultPath, onSetupDomains, onVaultMoved }: { vaultPath: string; onSetupDomains?: () => void; onVaultMoved?: (path: string) => void }) {
  return (
    <>
      <SettingsHeader icon={FolderTree} title="Workspace" subtitle="Where your data lives." />
      <ObsidianCard />
      {/* ONE Vault section = the Your/Demo vault cards (inline change+open icons and
          a per-vault backup toggle), plus a copy-safe filename normalizer. */}
      <div>
        <WorkspaceSubLabel icon={FolderOpen} label="Vault" desc="your vault · demo vault · backups" />
        <DemoModeSection vaultPath={vaultPath} onVaultMoved={onVaultMoved} onSetupDomains={onSetupDomains} headerless />
      </div>
      {/* One-button structure normalizer for legacy / hand-edited vaults. */}
      <VaultRebuildCard vaultPath={vaultPath} />
      {/* F5: vault-hygiene tools (normalize + consolidate). Copy-only, dry-run first. */}
      <VaultHygieneCard vaultPath={vaultPath} />
    </>
  );
}
