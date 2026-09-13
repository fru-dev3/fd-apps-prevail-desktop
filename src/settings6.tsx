// Settings sections extracted from App.tsx: Privacy & Connectivity (Bunker Mode),
// Council defaults, Configuration (groups the memory/tasks/ideal sub-sections),
// and the Agents catalog (AgentCard + AgentsSection).
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, Brain, Check, ChevronRight, Circle, CircleCheck, CircleX, Cloud, CloudOff, Copy, Cpu, Crown, FileX, Fingerprint, FolderCheck, FolderX, Globe, LineChart, ListChecks, Loader2, Lock, LockOpen, Mail, MailCheck, RefreshCw, Scale, Search, Send, Server, ShieldCheck, ShieldOff, Sigma, Sparkles, Star, Target, Terminal, User, Wifi, WifiOff } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { invoke } from "./bridge";
import { DISCOVERED_MODELS, RUNTIME_META, VENDOR_BRAND, isHarnessRuntime } from "./constants";
import { isLocalCli } from "./helpers";
import { modelsFor, prettyModelId } from "./helpers2";
import { LS, PREF, getPref, isBunkerOn, lsGet, lsSet, setPref } from "./storage";
import { Ghost } from "lucide-react";
import { RowMenu, Toggle } from "./ui";
import type { RowMenuItem } from "./ui";
import { COUNCIL_CHAIR_KEY, COUNCIL_MEMBERS_KEY, councilModelsFor, councilSlotKey, readCouncilChair, readCouncilMembers } from "./council";
import { SettingsHeader, authLoginCmd } from "./sectionutil";
import { cliVerifyLive, loadVerifyMap, recheckCli, saveVerifyMap, setCliVerify, useCliVerifyLive } from "./verify";
import { ProviderMark } from "./marks";
import { MasterDetail } from "./masterdetail";
import { TelemetrySettings } from "./settings4";
import type { CliInfo, ModelVerifyStatus, UsageSummary } from "./types";

// Consistent section header shared by the three privacy controls. Big, legible
// title + a one-line plain-language explanation of what the section governs, so
// each grouping reads on its own.
function PrivacyGroupHead({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
      <h3 className="font-display text-lg font-semibold tracking-tight text-text-primary">{title}</h3>
      <p className="text-sm text-text-muted">{blurb}</p>
    </div>
  );
}

// The compact per-channel status row shared by all three privacy controls, so
// each card has the same granularity. `good` = the protective/active state
// (highlighted cyan); otherwise muted. Sits inside the card under a divider.
type StatusChip = { Icon: LucideIcon; label: string; state: string; good: boolean };
function StatusChips({ items, expected }: { items: StatusChip[]; expected: boolean }) {
  // Only a channel that DISAGREES with the headline earns a chip. With the
  // control on and everything it governs actually closed, four chips reading
  // "blocked" are four more ways of saying what the switch already says; the
  // one that matters is the channel that did not comply.
  const shown = expected ? items.filter((t) => !t.good) : [];
  if (shown.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border-subtle pt-3">
      {shown.map((t) => (
        <span
          key={t.label}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${t.good ? "border-ai/30 bg-ai/5 text-text-primary" : "border-border bg-surface text-text-muted"}`}
        >
          <t.Icon className={`h-3.5 w-3.5 ${t.good ? "text-ai" : "text-text-muted"}`} />
          {t.label}
          <span className="font-mono tracking-wide opacity-70">{t.state}</span>
        </span>
      ))}
    </div>
  );
}

// G3: the global incognito master. On = chat AND council run as a plain model
// with none of your context (profile, ideal state, omega, memory). Per-surface
// toggles in each composer can still go incognito just there.
function GlobalIncognitoToggle() {
  const [on, setOn] = useState(() => getPref(PREF.incognito, "0") === "1");
  // What the model sees right now, per context channel. `good` = hidden (the
  // private state), matching the cyan-when-protective convention.
  const chips: StatusChip[] = [
    { Icon: User, label: "Profile", state: on ? "Hidden" : "Used", good: on },
    { Icon: Target, label: "Ideal state", state: on ? "Hidden" : "Used", good: on },
    { Icon: Sigma, label: "Omega", state: on ? "Hidden" : "Used", good: on },
    { Icon: Brain, label: "Memory", state: on ? "Hidden" : "Used", good: on },
  ];
  return (
    <div className={`rounded-xl border p-4 ${on ? "border-accent-border bg-accent-soft/30" : "border-border bg-surface"}`}>
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${on ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"}`}><Ghost className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary">{on ? "On - every surface runs blank" : "Off - your context is used"}</div>
          <div className="mt-0.5 text-xs text-text-secondary">
            {on
              ? "Chat and council run as a plain model with no profile, ideal state, omega, or memory."
              : "Chat and council see your profile, ideals, omega and memory."}
          </div>
        </div>
        <Toggle on={on} onChange={(v) => { setOn(v); setPref(PREF.incognito, v ? "1" : "0"); }} label="Incognito everywhere" />
      </div>
      <StatusChips items={chips} expected={on} />
    </div>
  );
}

// Vault Lock - the filesystem-scope switch. A SEPARATE dimension from Bunker
// Mode (which is about local vs cloud models). On = the assistant may only
// touch files inside the vault; off = full local-machine access. Default ON.
function VaultLockToggle() {
  const [on, setOn] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    invoke<{ enabled: boolean }>("vault_lock_status").then((s) => setOn(!!s.enabled)).catch(() => {});
  }, []);
  async function toggle(next: boolean) {
    setBusy(true);
    try {
      const s = await invoke<{ enabled: boolean }>("vault_lock_set", { enabled: next });
      setOn(!!s.enabled);
      // Tell the footer trust-bar to update immediately (it listens for this).
      window.dispatchEvent(new CustomEvent("prevail:vault-lock-changed"));
    } catch (e) { console.error("vault_lock_set", e); } finally { setBusy(false); }
  }
  // What the assistant can reach on disk right now. `good` = restricted to the
  // vault (the protective state), matching the cyan-when-protective convention.
  const chips: StatusChip[] = [
    { Icon: FolderCheck, label: "Vault", state: "Read/write", good: true },
    { Icon: FolderX, label: "Other folders", state: on ? "Blocked" : "Allowed", good: on },
    { Icon: FileX, label: "Outside files", state: on ? "Blocked" : "Allowed", good: on },
    { Icon: Terminal, label: "Local tools", state: on ? "Vault only" : "Whole machine", good: on },
  ];
  return (
    <div className={`rounded-xl border p-4 ${on ? "border-accent-border bg-accent-soft/30" : "border-border bg-surface"}`}>
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${on ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"}`}>
          {on ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary">{on ? "On - vault only" : "Off - whole machine"}</div>
          <div className="mt-0.5 text-xs text-text-secondary">
            {on
              ? "Only your vault. The rest of this Mac is off-limits."
              : "Full local-machine access. The assistant can scan any directory and use local tools across your computer."}
          </div>
        </div>
        <Toggle on={on} disabled={busy} onChange={toggle} label="Vault Lock" />
      </div>
      <StatusChips items={chips} expected={on} />
    </div>
  );
}

// Outbound Guardrail - ONE switch, like the other privacy controls. On (the
// default) engages BOTH engine-enforced outbound protections in one move:
//   who  - email to anyone but you is saved as a Gmail draft you send yourself
//          (emailPolicy draft-others)
//   what - outbound content to another party carrying PII, money figures,
//          health/legal/salary/strategy details or verbatim quotes is held
//          until you release that exact action (egressGuard on)
// Off disables both (approved actions run exactly as addressed). Finer modes
// (block-entirely email) stay available via the CLI: prevail email-policy /
// egress-guard. State is engine-side config, so every surface obeys it; the
// bottom ribbon mirrors it live via the prevail:guardrail-changed event.
function OutboundGuardrailToggle() {
  const [on, setOn] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([
      invoke<{ policy?: string }>("email_policy_get").catch(() => null),
      invoke<{ mode?: string }>("egress_guard_get").catch(() => null),
    ]).then(([p, g]) => {
      if (p || g) setOn(p?.policy !== "allow" && g?.mode !== "off");
    });
  }, []);
  async function toggle(next: boolean) {
    setBusy(true);
    try {
      await invoke("email_policy_set", { policy: next ? "draft-others" : "allow" });
      await invoke("egress_guard_set", { mode: next ? "on" : "off" });
      setOn(next);
      window.dispatchEvent(new CustomEvent("prevail:guardrail-changed"));
    } catch (e) { console.error("guardrail toggle", e); } finally { setBusy(false); }
  }
  const chips: StatusChip[] = [
    { Icon: MailCheck, label: "Email to you", state: "Sends", good: true },
    { Icon: Mail, label: "Email to others", state: on ? "Draft only" : "Sends", good: on },
    { Icon: Fingerprint, label: "PII, figures, health, legal", state: on ? "Held" : "May leave", good: on },
    { Icon: Send, label: "Autonomous outreach", state: on ? "Needs your send" : "Allowed", good: on },
  ];
  return (
    <div className={`rounded-xl border p-4 ${on ? "border-accent-border bg-accent-soft/30" : "border-border bg-surface"}`}>
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${on ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"}`}>
          {on ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary">{on ? "On - nothing reaches another party without you" : "Off - approved actions run as addressed"}</div>
          <div className="mt-0.5 text-xs text-text-secondary">
            {on
              ? "Email to anyone but you waits as a draft, and sensitive details are held until you release them."
              : "Approved sends go out as addressed, unscanned."}
          </div>
        </div>
        <Toggle on={on} disabled={busy} onChange={toggle} label="Outbound guardrail" />
      </div>
      <StatusChips items={chips} expected={on} />
    </div>
  );
}

export function PrivacyConnectivitySection({ enabled, onChange }: { enabled: boolean; onChange: (on: boolean) => void }) {
  type BunkerStatus = { enabled: boolean; network_blocked: boolean; web_blocked: boolean; cloud_blocked: boolean; local_available: boolean };
  const [status, setStatus] = useState<BunkerStatus | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    invoke<BunkerStatus>("bunker_status").then(setStatus).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function setBunker(on: boolean) {
    setBusy(true);
    try {
      const s = await invoke<BunkerStatus>("bunker_set", { enabled: on });
      setStatus(s);
      onChange(!!s.enabled);
    } catch (e) {
      console.error("bunker_set", e);
    } finally {
      setBusy(false);
      setConfirmOff(false);
    }
  }

  // Turning OFF requires confirmation; turning ON is immediate.
  function onToggle(next: boolean) {
    if (!next) { setConfirmOff(true); return; }
    void setBunker(true);
  }

  // What's blocked vs open right now, as visual tiles. "good" = the
  // privacy-protective state (blocked / available). Each maps an icon to its
  // on/off variant so the page reads at a glance.
  const tiles = [
    {
      good: !!status?.network_blocked,
      Icon: status?.network_blocked ? WifiOff : Wifi,
      label: "Network",
      state: status?.network_blocked ? "Blocked" : "Allowed",
    },
    {
      good: !!status?.web_blocked,
      Icon: status?.web_blocked ? Search : Globe,
      label: "Web search",
      state: status?.web_blocked ? "Blocked" : "Allowed",
    },
    {
      good: !!status?.cloud_blocked,
      Icon: status?.cloud_blocked ? CloudOff : Cloud,
      label: "Cloud AI",
      state: status?.cloud_blocked ? "Blocked" : "Allowed",
    },
    {
      good: !!status?.local_available,
      Icon: Cpu,
      label: "Local models",
      state: status?.local_available ? "Available" : "Not detected",
    },
  ];

  return (
    <>
      <SettingsHeader
        title="Privacy"
        subtitle="Four independent controls. Any combination works."
      />

      {/* ── SECTION 1 - BUNKER MODE: where your data can go ─────────────────── */}
      <section>
        <PrivacyGroupHead
          title="Bunker Mode"
          blurb="Where your data can go."
        />

        {/* Control card - SAME shape/weight as Vault Lock and Incognito so no one
            section dominates. The per-channel live status lives inside the card
            as compact chips, not a separate hero grid. */}
        <div className={`rounded-xl border p-4 ${enabled ? "border-accent-border bg-accent-soft/30" : "border-border bg-surface"}`}>
          <div className="flex items-center gap-3">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${enabled ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"}`}>
              {enabled ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text-primary">{enabled ? "On - fully local" : "Off - cloud connected"}</div>
              <div className="mt-0.5 text-xs text-text-secondary">
                {enabled
                  ? "Everything stays on this device. Nothing leaves your machine."
                  : "Cloud AI, web search and network access are available."}
              </div>
            </div>
            <Toggle on={enabled} disabled={busy} onChange={onToggle} label="Bunker Mode" />
          </div>

          {/* Compact live status - what's blocked vs open right now. */}
          <StatusChips items={tiles} expected={enabled} />
          {!status?.local_available && enabled && (
            <a href="https://ollama.com/download" target="_blank" rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent hover:underline">
              <Cpu className="h-3.5 w-3.5" /> No local model detected. Install Ollama to run on-device.
            </a>
          )}
        </div>
      </section>

      {/* Leave-Bunker-Mode confirmation */}
      {confirmOff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setConfirmOff(false)}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-black/20 bg-[#141416] px-5 py-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10">
                <ShieldOff className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <h3 className="font-display text-lg font-semibold text-white">Leave Bunker Mode?</h3>
                <p className="text-xs text-white/60">This opens your machine to the network.</p>
              </div>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-text-secondary">Turning this off enables:</p>
              <div className="mt-3 grid grid-cols-1 gap-2">
                {([
                  [Cloud, "Cloud AI providers"],
                  [Globe, "Internet access"],
                  [Search, "Web search"],
                  [Server, "External services"],
                ] as const).map(([Icon, label]) => (
                  <div key={label} className="flex items-center gap-2.5 rounded-lg border border-border-subtle bg-background px-3 py-2 text-sm text-text-secondary">
                    <Icon className="h-4 w-4 shrink-0 text-text-muted" />
                    {label}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-text-muted">Your data may be transmitted to third-party services depending on which features you use.</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-border-subtle bg-surface-warm/40 px-5 py-3">
              <button onClick={() => setConfirmOff(false)} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-strong">Cancel</button>
              <button onClick={() => void setBunker(false)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[#141416] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50">
                <ShieldOff className="h-4 w-4" /> Leave Bunker Mode
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SECTION 2 - VAULT LOCK: what files the assistant can touch ──────── */}
      <section className="mt-6 border-t border-border-subtle pt-6">
        <PrivacyGroupHead
          title="Vault Lock"
          blurb="What files the assistant can touch."
        />
        <VaultLockToggle />
      </section>

      {/* ── SECTION 3 - INCOGNITO: how much of you the model sees ───────────── */}
      <section className="mt-6 border-t border-border-subtle pt-6">
        <PrivacyGroupHead
          title="Incognito"
          blurb="How much of you the model sees."
        />
        <GlobalIncognitoToggle />
      </section>

      {/* ── SECTION 4 - OUTBOUND GUARDRAIL: nothing reaches another party ───── */}
      <section className="mt-6 border-t border-border-subtle pt-6">
        <PrivacyGroupHead
          title="Outbound Guardrail"
          blurb="Whether anything can reach another party without you."
        />
        <OutboundGuardrailToggle />
      </section>

      {/* Telemetry lives under Privacy (moved from Safety). Anonymous, opt-in,
          default-OFF. Brings its own border-t / heading. */}
      <TelemetrySettings />
    </>
  );
}

// ─── General preferences storage ──────────────────────────────────────
// Read/write small boolean + string prefs to localStorage with sensible
// defaults. Exported helpers used at call sites (textarea, chat chunk
// handlers, etc.) to read live.

// A visual "round table": the panel drawn as seats around a ring, the chair
// crowned at the top, spokes to a central emblem. New seats animate in as members
// are added, so picking a council feels like assembling a table, not editing a
// list. Why it matters: the council's value is the spread of independent minds -
// seeing them arranged makes that legible at a glance.
function CouncilCircle({ members, chair, clis }: { members: string[]; chair: string; clis: CliInfo[] }) {
  const size = 232, R = 84, cx = size / 2, cy = size / 2, seat = 46;
  // Chair first so it always takes the top seat; the rest fan around clockwise.
  const ordered = [chair, ...members.filter((m) => m && m !== chair)].filter(Boolean);
  const n = ordered.length;
  const labelFor = (key: string) => {
    const [cli, model] = key.split("::");
    const c = clis.find((x) => x.id === cli);
    const m = councilModelsFor(cli).find((x) => x.id === model);
    return `${c?.label ?? cli} · ${m?.label ?? (prettyModelId(model || "") || "default")}`;
  };
  // B2-4: the short model name shown UNDER each seat (e.g. "Opus 4.7"), so the
  // ring labels its models, not just provider glyphs.
  const modelShort = (key: string) => {
    const [cli, model] = key.split("::");
    const m = councilModelsFor(cli).find((x) => x.id === model);
    return (m?.label ?? (prettyModelId(model || "") || "default")).replace(/\s*\(.*?\)\s*/g, "").trim();
  };
  if (n === 0) {
    return (
      <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 text-center">
        <Crown className="h-7 w-7 text-text-muted" />
        <div className="text-sm text-text-secondary">No one seated yet</div>
        <div className="text-xs text-text-muted">Pick models below to assemble your council.</div>
      </div>
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center py-2">
      <style>{`@keyframes councilSeatIn{from{opacity:0;transform:translate(-50%,-50%) scale(.4)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}`}</style>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="absolute inset-0" aria-hidden>
          <circle cx={cx} cy={cy} r={R} fill="none" className="stroke-border-subtle" strokeWidth={1} />
          {ordered.map((key, i) => {
            const a = -Math.PI / 2 + i * ((2 * Math.PI) / n);
            return <line key={key} x1={cx} y1={cy} x2={cx + R * Math.cos(a)} y2={cy + R * Math.sin(a)} className="stroke-border-subtle" strokeWidth={1} />;
          })}
        </svg>
        {/* Center emblem: the panel size at a glance. */}
        <div className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-border bg-background">
          <span className="font-display text-base font-bold leading-none text-text-primary">{members.length}</span>
          <span className="font-mono text-[11px] text-text-muted">Panel</span>
        </div>
        {ordered.map((key, i) => {
          const a = -Math.PI / 2 + i * ((2 * Math.PI) / n);
          const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
          const isChair = key === chair;
          const cli = key.split("::")[0];
          return (
            <div
              key={key}
              title={`${labelFor(key)}${isChair ? " (chair)" : ""}`}
              className="absolute"
              style={{ left: x, top: y, width: seat, height: seat, transform: "translate(-50%,-50%)", animation: "councilSeatIn .3s cubic-bezier(0.22,1,0.36,1)" }}
            >
              <div className={`relative flex h-full w-full items-center justify-center rounded-full border bg-background ${isChair ? "border-accent ring-2 ring-accent/30" : "border-border"}`}>
                <ProviderMark vendor={cli} size={26} />
                {isChair && (
                  <span className="absolute -top-2.5 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full bg-accent text-background shadow-sm">
                    <Crown className="h-3 w-3" />
                  </span>
                )}
              </div>
              {/* B2-4: model name under the seat. */}
              <div className="absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap text-center font-mono text-[10px] leading-tight text-text-secondary">
                {modelShort(key)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Live aggregate stats over the same council member set the ring draws. Every
// number recomputes (useMemo) as models are added or removed, so the panel reads
// as a running portrait of the council you are assembling: how big it is, how it
// splits open-source vs cloud, how many distinct vendors sit at the table, local
// vs remote, and a rough "what would it cost to run all of these at once" gauge.
//
// Classification is intentionally string-based (lowercase cli + model + label):
// each member is open-source if it matches an OSS token, cloud if it matches a
// cloud token, otherwise unknown. Local == the open-source / on-device set.
const COUNCIL_OSS_TOKENS = ["ollama", "llama", "mistral", "qwen", "deepseek", "gemma", "phi", "mixtral", "mlx", "lmstudio"];
const COUNCIL_CLOUD_TOKENS = ["claude", "anthropic", "gpt", "openai", "codex", "gemini", "google", "grok", "xai", "kimi"];

// Relative "burn" weight per member. Cloud flagships are the heaviest (~3),
// mid-tier cloud ~2, anything local ~1. No real cost metadata is exposed in this
// codebase, so this is a deliberately rough, clearly-labelled estimate.
function councilMemberWeight(hay: string, isOss: boolean): number {
  if (isOss) return 1;
  const flagship = ["fable", "opus", "astra", "gpt-6", "gpt-5", "gpt5", "gemini-3.1-pro", "gemini-pro", "grok-4", "o3", "o1"];
  if (flagship.some((t) => hay.includes(t))) return 3;
  return 2; // mid cloud (sonnet, haiku, gpt-4o-mini, flash, etc.)
}

// Estimated dollar cost for ONE member to answer one council question. Local /
// open-source models run on-device, so $0. Cloud models use a rough blended
// $/1M-tokens by tier times a typical council-turn size. Deliberately an
// estimate (real prices vary by provider + exact model), but a concrete figure
// is far more useful than "$$$". Tuned to land in a believable per-run range.
const COUNCIL_TURN_TOKENS = 6000; // ~prompt + context + answer for one seat
function councilMemberCostUsd(hay: string, isOss: boolean): number {
  if (isOss) return 0; // on-device, no API spend
  const flagship = ["fable", "opus", "astra", "gpt-6", "gpt-5", "gpt5", "gemini-3.1-pro", "gemini-pro", "grok-4", "o3", "o1"];
  const perMillion = flagship.some((t) => hay.includes(t)) ? 18 : 4; // blended $/1M tokens
  return (COUNCIL_TURN_TOKENS / 1_000_000) * perMillion;
}
// Format a small USD figure without losing precision on cheap panels.
function fmtUsd(n: number): string {
  if (n <= 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

function CouncilStats({ members, clis }: { members: string[]; clis: CliInfo[] }) {
  const stats = useMemo(() => {
    const total = members.length;
    // Build the lowercase haystack (cli + model + resolved label) per member.
    const classify = members.map((key) => {
      const [cli, model] = key.split("::");
      const c = clis.find((x) => x.id === cli);
      const m = councilModelsFor(cli).find((x) => x.id === model);
      const label = `${c?.label ?? cli} ${m?.label ?? model ?? ""}`;
      const hay = `${cli} ${model ?? ""} ${label}`.toLowerCase();
      const isOss = COUNCIL_OSS_TOKENS.some((t) => hay.includes(t));
      const isCloud = !isOss && COUNCIL_CLOUD_TOKENS.some((t) => hay.includes(t));
      return { cli, hay, isOss, isCloud };
    });
    const oss = classify.filter((x) => x.isOss).length;
    // Anything not matched as open-source is treated as cloud for the split so the
    // two segments always sum to the panel size (unknown providers are remote).
    const cloudish = total - oss;
    const ossPct = total ? Math.round((oss / total) * 100) : 0;
    const cloudPct = total ? 100 - ossPct : 0;
    const vendors = Array.from(new Set(classify.map((x) => x.cli)));
    const local = oss; // local == the open-source / on-device set
    const remote = total - local;
    const burn = classify.reduce((sum, x) => sum + councilMemberWeight(x.hay, x.isOss), 0);
    const maxBurn = total * 3 || 1; // all-flagship-cloud ceiling
    const burnPct = Math.round((burn / maxBurn) * 100);
    const burnTier = burnPct >= 67 ? "$$$" : burnPct >= 34 ? "$$" : "$";
    // Concrete dollar estimate: sum each cloud member's per-run cost (local = $0).
    const costUsd = classify.reduce((sum, x) => sum + councilMemberCostUsd(x.hay, x.isOss), 0);
    return { total, oss, cloud: cloudish, ossPct, cloudPct, vendors, local, remote, burn, burnPct, burnTier, costUsd };
  }, [members, clis]);

  if (stats.total === 0) {
    return (
      <div className="flex h-full min-h-[180px] flex-col items-center justify-center p-4 text-center">
        <ListChecks className="h-6 w-6 text-text-muted" />
        <div className="mt-2 text-sm text-text-secondary">No stats yet</div>
        <div className="text-xs text-text-muted">Seat some models to see the panel breakdown.</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="font-mono text-[11px] font-bold text-text-primary">Panel stats</div>

      {/* Number cards: panel size + providers. */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-lg border border-border-subtle bg-background p-3">
          <div className="font-display text-2xl font-bold leading-none text-text-primary">{stats.total}</div>
          <div className="mt-1 text-[11px] text-text-muted">Panel size</div>
        </div>
        <div className="rounded-lg border border-border-subtle bg-background p-3">
          <div className="font-display text-2xl font-bold leading-none text-text-primary">{stats.vendors.length}</div>
          <div className="mt-1 text-[11px] text-text-muted">Provider{stats.vendors.length === 1 ? "" : "s"}</div>
        </div>
      </div>

      {/* Open-source vs cloud split + two-segment bar. */}
      <div className="rounded-lg border border-border-subtle bg-background p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1.5 text-text-secondary"><Cpu className="h-3.5 w-3.5 text-ok" /> {stats.ossPct}% open <span className="text-text-muted">({stats.oss})</span></span>
          <span className="inline-flex items-center gap-1.5 text-text-secondary"><Cloud className="h-3.5 w-3.5 text-accent" /> {stats.cloudPct}% cloud <span className="text-text-muted">({stats.cloud})</span></span>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-warm">
          <div className="h-full bg-ok" style={{ width: `${stats.ossPct}%` }} />
          <div className="h-full bg-accent" style={{ width: `${stats.cloudPct}%` }} />
        </div>
      </div>

      {/* Local vs remote split (local = the open-source / on-device set). */}
      <div className="rounded-lg border border-border-subtle bg-background p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1.5 text-text-secondary"><Server className="h-3.5 w-3.5 text-text-muted" /> {stats.local} local</span>
          <span className="inline-flex items-center gap-1.5 text-text-secondary"><Globe className="h-3.5 w-3.5 text-text-muted" /> {stats.remote} remote</span>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-warm">
          <div className="h-full bg-ok" style={{ width: `${stats.total ? (stats.local / stats.total) * 100 : 0}%` }} />
          <div className="h-full bg-text-muted/60" style={{ width: `${stats.total ? (stats.remote / stats.total) * 100 : 0}%` }} />
        </div>
      </div>

      {/* Estimated dollar cost for one full panel run (every seat answers once). */}
      <div className="mt-auto rounded-lg border border-border-subtle bg-background p-3">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[11px] text-text-muted">Est. cost / panel run</span>
          <span className="font-display text-lg font-bold text-accent">{fmtUsd(stats.costUsd)} <span className="font-mono text-[11px] font-normal text-text-muted">{stats.burnTier}</span></span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-warm">
          <div className="h-full bg-accent" style={{ width: `${stats.burnPct}%` }} />
        </div>
        <div className="mt-1.5 text-[10px] text-text-muted">
          Rough estimate: ~{(COUNCIL_TURN_TOKENS / 1000).toFixed(0)}K tokens/seat at blended cloud rates; local models are free. Actual prices vary.
        </div>
      </div>
    </div>
  );
}

export function CouncilSettingsSection({ clis }: { clis: CliInfo[] }) {
  const available = useMemo(() => clis.filter((c) => c.available && (!isBunkerOn() || isLocalCli(c.id))), [clis]);
  const [members, setMembers] = useState<Set<string>>(() => new Set(readCouncilMembers()));
  const [chair, setChair] = useState<string>(() => readCouncilChair());
  // Each provider expands/collapses INDEPENDENTLY - a Set of open provider ids,
  // not a single value (opening one never closes another).
  const [expandedSet, setExpandedSet] = useState<Set<string>>(() => new Set());
  // Per-provider catalog search (aggregators like OpenRouter expose hundreds of
  // models — search, don't scroll a fixed list).
  const [panelSearch, setPanelSearch] = useState<Record<string, string>>({});
  // Global auto-council: a high-stakes judgment call asked through any AI tool
  // (over MCP) or the Prevail chat auto-escalates to a multi-model council.
  // Mirrors the engine config the MCP server reads. Lives here (not in
  // Integrations) because it governs the council. (feedback: moved here.)
  const [autoCouncil, setAutoCouncil] = useState(false);
  const [autoCouncilBusy, setAutoCouncilBusy] = useState(false);
  useEffect(() => {
    invoke<{ auto?: string }>("get_auto_council").then((m) => setAutoCouncil(m?.auto === "auto")).catch(() => {});
  }, []);
  async function toggleAutoCouncil(on: boolean) {
    setAutoCouncilBusy(true);
    setAutoCouncil(on); // optimistic
    try { await invoke("set_auto_council", { domain: "general", on }); }
    catch { setAutoCouncil(!on); /* revert on failure */ }
    finally { setAutoCouncilBusy(false); }
  }
  // Once providers are detected: prune any stale slot keys that no longer map to
  // a real (available provider, model) - that's what made the count drift from
  // the visible badges - then seed a sensible default if the panel is empty.
  // Discovered (live-catalog) models count as valid too, so a model added via
  // search (e.g. an OpenRouter GLM) isn't pruned away on the next mount.
  useEffect(() => {
    if (available.length === 0) return;
    const valid = new Set<string>();
    for (const c of available) {
      for (const m of councilModelsFor(c.id)) valid.add(councilSlotKey(c.id, m.id));
      for (const m of (DISCOVERED_MODELS[c.id] ?? [])) valid.add(councilSlotKey(c.id, m.id));
    }
    setMembers((prev) => {
      const pruned = new Set([...prev].filter((k) => valid.has(k)));
      if (pruned.size > 0) return pruned.size === prev.size ? prev : pruned;
      // Empty after pruning → seed the first model of the first three providers.
      return new Set(available.slice(0, 3).map((c) => councilSlotKey(c.id, councilModelsFor(c.id)[0].id)));
    });
    setExpandedSet((e) => (e.size ? e : new Set([available[0].id])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);
  useEffect(() => { lsSet(COUNCIL_MEMBERS_KEY, JSON.stringify([...members])); window.dispatchEvent(new Event("prevail:council-changed")); }, [members]);
  useEffect(() => {
    lsSet(COUNCIL_CHAIR_KEY, chair);
    const cli = chair.split("::")[0];
    if (cli) lsSet(LS.defaultChairCli, cli); // back-compat
    window.dispatchEvent(new Event("prevail:council-changed"));
  }, [chair]);
  // Chair must be a current member.
  useEffect(() => {
    if (members.size && !members.has(chair)) setChair([...members][0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);

  const toggle = (key: string) => setMembers((m) => { const n = new Set(m); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  // Resolve a readable chair label from its slot key.
  const chairLabel = (() => {
    if (!chair) return "-";
    const [cli, model] = chair.split("::");
    const c = clis.find((x) => x.id === cli);
    const m = councilModelsFor(cli).find((x) => x.id === model);
    return `${c?.label ?? cli} · ${m?.label ?? (model || "default")}`;
  })();

  return (
    <>
      <SettingsHeader title="Council" subtitle="Several models answer, a chair writes the verdict." />
      {/* G3 (Monday feedback): make it explicit that the panel saves as you edit. */}
      <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-surface-warm px-2.5 py-0.5 text-[11px] text-text-muted">
        <Check className="h-3 w-3 text-ok" /> Changes save automatically
      </div>
      {/* One seamless panel: the round table on the left (prominent, centered),
          a divider, then the live aggregate stats on the right. Stacks on narrow
          widths (divider becomes a top border on the stats half). */}
      <div className="mb-5 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-col lg:flex-row lg:items-stretch">
          <div className="flex items-center justify-center p-4 lg:w-[42%] lg:shrink-0">
            <CouncilCircle members={[...members]} chair={chair} clis={clis} />
          </div>
          <div className="min-w-0 flex-1 border-t border-border-subtle lg:border-l lg:border-t-0">
            <CouncilStats members={[...members]} clis={clis} />
          </div>
        </div>
      </div>
      {/* Compact summary bar - what the panel is right now. */}
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-accent-border bg-accent-soft px-4 py-3 text-sm">
        <span className="font-semibold text-text-primary">{members.size} model{members.size === 1 ? "" : "s"} on the panel</span>
        <span className="inline-flex items-center gap-1 text-text-secondary"><Crown className="h-3.5 w-3.5 text-accent" /> chair: <span className="font-medium text-text-primary">{chairLabel}</span></span>
      </div>
      {/* Global auto-council: when a question is high-stakes, convene the panel
          automatically instead of answering single-model. Applies to every
          domain and every entry point (the Prevail chat and any AI tool over
          MCP). Moved here from Integrations - it's a council behavior. */}
      <div className="mb-5 flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-warm/40 px-4 py-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${autoCouncil ? "bg-accent-soft text-accent" : "bg-surface-warm text-text-muted"}`}><Scale className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary">Auto-convene on high-stakes questions</div>
          <div className="mt-0.5 text-xs text-text-secondary">Judgment calls go to this council automatically and the verdict is saved. Routine questions stay single-model.</div>
        </div>
        <Toggle on={autoCouncil} disabled={autoCouncilBusy} onChange={toggleAutoCouncil} label="Auto-convene the council on high-stakes questions" />
      </div>
      <div className="space-y-2">
        {/* "None" and "not asked yet" are different answers. Detection had not
            returned yet in the common case, and the page said there were no
            providers directly under a panel naming six models - two states of
            the same screen contradicting each other. */}
        {available.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-surface p-4 text-sm text-text-muted">
            {clis.length === 0
              ? "Checking the runtimes on this Mac…"
              : `No runtime is ready to join a panel${isBunkerOn() ? " in Bunker Mode, which allows local models only" : ""}.`}
          </div>
        )}
        {available.map((c) => {
          const curated = councilModelsFor(c.id);
          const live = DISCOVERED_MODELS[c.id] ?? [];
          // Aggregators (OpenRouter) ship a big live catalog — make every model
          // reachable via search, not just the curated handful.
          const isAggregator = live.length > 0;
          const q = (panelSearch[c.id] ?? "").trim().toLowerCase();
          // Slot keys already on the panel for this provider (so search-added
          // models still render as checked, even if not in the curated list).
          const onPanelIds = [...members].filter((k) => k.startsWith(`${c.id}::`)).map((k) => k.slice(c.id.length + 2));
          const picked = onPanelIds.length;
          let models: { id: string; label: string; blurb?: string }[];
          if (isAggregator && q) {
            models = live.filter((m) => `${m.id} ${m.label ?? ""}`.toLowerCase().includes(q)).slice(0, 40)
              .map((m) => ({ id: m.id, label: m.label && m.label !== m.id ? m.label : m.id, blurb: "" }));
          } else if (isAggregator) {
            const curatedIds = new Set(curated.map((m) => m.id));
            const extras = onPanelIds.filter((id) => !curatedIds.has(id)).map((id) => {
              const lm = live.find((x) => x.id === id);
              return { id, label: lm?.label ?? id, blurb: "" };
            });
            models = [...curated, ...extras];
          } else {
            models = curated;
          }
          const isExp = expandedSet.has(c.id);
          return (
            <div key={c.id} className={`overflow-hidden rounded-lg border bg-surface transition-colors ${isExp || picked > 0 ? "border-accent-border" : "border-border-subtle"}`}>
              <button onClick={() => setExpandedSet((e) => { const n = new Set(e); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                <ChevronRight className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${isExp ? "rotate-90" : ""}`} strokeWidth={2.5} />
                <ProviderMark vendor={c.id} size={26} />
                <span className="flex-1 font-display text-sm font-semibold text-text-primary">{c.label}</span>
                {picked > 0 && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] text-background">{picked} on panel</span>}
                <span className="shrink-0 text-[11px] text-text-muted">{isAggregator ? `${live.length} models, search` : `${models.length} model${models.length === 1 ? "" : "s"}`}</span>
              </button>
              {isExp && (
                <div className="space-y-1.5 border-t border-border-subtle bg-background/40 p-3">
                  {isAggregator && (
                    <div className="relative mb-1">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                      <input
                        value={panelSearch[c.id] ?? ""}
                        onChange={(e) => setPanelSearch((s) => ({ ...s, [c.id]: e.target.value }))}
                        placeholder={`Search all ${live.length} models (e.g. glm, kimi, qwen)…`}
                        className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 font-mono text-xs text-text-primary placeholder:text-text-muted focus:border-accent-border focus:outline-none"
                      />
                    </div>
                  )}
                  {models.length === 0 && (
                    <div className="px-1 py-2 font-mono text-[11px] text-text-muted">No models match "{panelSearch[c.id]}".</div>
                  )}
                  {models.map((m) => {
                    const key = councilSlotKey(c.id, m.id);
                    const on = members.has(key);
                    const isChair = chair === key;
                    return (
                      <div key={key} className={`flex items-center gap-3 rounded-md border px-3 py-2 ${on ? "border-accent-border bg-accent-soft" : "border-border-subtle bg-surface"}`}>
                        <button onClick={() => toggle(key)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? "border-accent bg-accent text-background" : "border-border bg-background"}`}>
                            {on && <Check className="h-3 w-3" strokeWidth={3} />}
                          </span>
                          <span className="min-w-0">
                            <span className="font-mono text-sm text-text-primary">{m.label}</span>
                            {m.blurb && <span className="ml-2 text-[11px] text-text-muted">{m.blurb}</span>}
                          </span>
                        </button>
                        {on && (
                          <button
                            onClick={() => setChair(key)}
                            title={isChair ? "Chairs the council (writes the verdict)" : "Make this model the chair"}
                            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] ${
                              isChair ? "bg-accent text-background" : "border border-border text-text-muted hover:border-accent-border hover:text-accent"
                            }`}
                          >
                            <Crown className="h-3 w-3" /> {isChair ? "Chair" : "Chair"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-text-muted">
        The <span className="text-accent">Council</span> tab in any domain starts with this panel.
      </p>
    </>
  );
}



// FrameworkPickerCard was deleted with v0.2.92 - the chip-row UI
// it provided lived only in Settings → Defaults as a duplicate of
// the dedicated Settings → Frameworks page. The full two-column
// FrameworksSection is now the single source of truth.

// ─────────────────────────────────────────────────────────────────────
// Integration cards (Telegram / WhatsApp / MCP / Briefings) are now
// rendered directly inside Settings → Integrations. Old ToolsPanel
// wrapper removed.

// Economy / Balanced / Quality bias plus cascade escalation for the "Auto"
// router, in ONE compact row that sits above the model list of any runtime
// that offers Auto. Both persist globally (prevail.route.bias, default
// "balanced"; prevail.route.cascade, default off) and are forwarded to the
// engine only on auto turns. Cascade answers an ambiguous prompt with a cheaper
// model first and escalates only when a confidence check fails, so it can cost
// two calls: slower, usually cheaper. Obvious easy/hard prompts never cascade.
export const ROUTE_BIAS_KEY = "prevail.route.bias";
export const ROUTE_CASCADE_KEY = "prevail.route.cascade";
type RouteBiasValue = "economy" | "balanced" | "quality";
const ROUTE_BIAS_OPTIONS: { id: RouteBiasValue; label: string; blurb: string }[] = [
  { id: "economy", label: "Economy", blurb: "Cheaper and faster" },
  { id: "balanced", label: "Balanced", blurb: "Cost against quality" },
  { id: "quality", label: "Quality", blurb: "Strongest model every time" },
];
function readRouteBias(): RouteBiasValue {
  const v = lsGet(ROUTE_BIAS_KEY, "balanced");
  return v === "economy" || v === "quality" ? v : "balanced";
}
function readRouteCascade(): boolean { return lsGet(ROUTE_CASCADE_KEY, "0") === "1"; }

function RoutingRow() {
  const [bias, setBias] = useState<RouteBiasValue>(readRouteBias);
  const [cascade, setCascade] = useState<boolean>(readRouteCascade);
  // Stay in sync if another runtime's detail (or another window) changed it.
  useEffect(() => {
    const hb = () => setBias(readRouteBias());
    const hc = () => setCascade(readRouteCascade());
    window.addEventListener("prevail:route-bias-changed", hb);
    window.addEventListener("prevail:route-cascade-changed", hc);
    return () => {
      window.removeEventListener("prevail:route-bias-changed", hb);
      window.removeEventListener("prevail:route-cascade-changed", hc);
    };
  }, []);
  const pickBias = (v: RouteBiasValue) => {
    setBias(v);
    lsSet(ROUTE_BIAS_KEY, v);
    window.dispatchEvent(new Event("prevail:route-bias-changed"));
  };
  const setCascadeOn = (v: boolean) => {
    setCascade(v);
    lsSet(ROUTE_CASCADE_KEY, v ? "1" : "0");
    window.dispatchEvent(new Event("prevail:route-cascade-changed"));
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border-subtle bg-surface-warm/50 px-3 py-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text-primary">
        <Sparkles className="h-3.5 w-3.5 text-accent" /> Auto routing
      </span>
      <div className="inline-flex rounded-md border border-border bg-background p-0.5" role="radiogroup" aria-label="Auto routing bias">
        {ROUTE_BIAS_OPTIONS.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={bias === o.id}
            onClick={() => pickBias(o.id)}
            title={o.blurb}
            className={`rounded px-2.5 py-1 text-xs transition-colors ${bias === o.id ? "bg-accent text-background shadow-sm" : "text-text-secondary hover:bg-surface-warm hover:text-text-primary"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <span className="text-xs text-text-muted">{ROUTE_BIAS_OPTIONS.find((o) => o.id === bias)?.blurb}</span>
      <label
        className="ml-auto inline-flex cursor-pointer items-center gap-2 text-xs text-text-secondary"
        title="Answer ambiguous prompts with a cheaper model first and escalate only if it is not confident. Can cost two calls, so it is slower but often cheaper."
      >
        <Toggle on={cascade} onChange={setCascadeOn} label="Cascade escalation" />
        Try a cheaper model first
      </label>
    </div>
  );
}

// A quiet status pill: colored dot (or spinner) + a two-word sentence-case
// label. Used for the runtime's health and for a failed model row.
type ChipTone = "ok" | "warn" | "err" | "muted";
function StatusChip({ tone, label, spin, title }: { tone: ChipTone; label: string; spin?: boolean; title?: string }) {
  const cls = tone === "ok" ? "bg-ok/10 text-ok" : tone === "warn" ? "bg-warn/10 text-warn" : tone === "err" ? "bg-err/10 text-err" : "bg-surface-strong text-text-muted";
  const dot = tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : tone === "err" ? "bg-err" : "bg-text-muted";
  return (
    <span title={title} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {spin ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
      {label}
    </span>
  );
}

const btnSecondary = "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-text-secondary transition-colors hover:border-accent-border hover:text-accent disabled:opacity-40";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-accent-hover";

export function AgentCard({
  cli,
  onStartChat,
  isDefault,
  onMakeDefault,
  cost,
  chattable = true,
  forceOpen = false,
}: {
  cli: CliInfo;
  onStartChat?: (cliId: string, modelId?: string) => void;
  isDefault?: boolean;
  onMakeDefault?: () => void;
  /** Cumulative spend on this runtime (USD), from the usage ledger. */
  cost?: number;
  /** Whether this runtime can power the chat composer. Harnesses are false —
      they're catalog-only and never offered "Start chat". */
  chattable?: boolean;
  /** Render always-expanded with no collapse chevron - used as the detail pane
      in the Runtimes master-detail, where the row IS the only thing shown. */
  forceOpen?: boolean;
}) {
  const brand = VENDOR_BRAND[cli.id] ?? VENDOR_BRAND.other;
  const liveVerify = useCliVerifyLive();
  // Re-render when live discovery fills in new models.
  const [, setModelsNonce] = useState(0);
  useEffect(() => {
    const h = () => setModelsNonce((n) => n + 1);
    window.addEventListener("prevail:models-refreshed", h);
    return () => window.removeEventListener("prevail:models-refreshed", h);
  }, []);
  const models = modelsFor(cli.id);
  // "auto" is a router sentinel, not a real model: it can't be verified and must
  // not count against the "N of M verified" tally or trigger a verify call.
  const verifiable = models.filter((m) => m.id !== "auto");
  const [open, setOpen] = useState(false);
  const isOpen = forceOpen || open;
  // The provider's default model (what a new chat uses). Set right here in
  // Models, so there's no separate Defaults page.
  const modelKey = `prevail.model.${cli.id}`;
  const [defaultModel, setDefaultModel] = useState(() => lsGet(modelKey) || models[0]?.id || "");
  useEffect(() => { if (defaultModel) lsSet(modelKey, defaultModel); }, [modelKey, defaultModel]);
  const setAsDefault = (modelId: string) => { setDefaultModel(modelId); onMakeDefault?.(); };
  const [status, setStatus] = useState<Record<string, ModelVerifyStatus>>(() => {
    const map = loadVerifyMap();
    const out: Record<string, ModelVerifyStatus> = {};
    for (const m of models) {
      const key = `${cli.id}:${m.id}`;
      if (map[key] === "ok") out[m.id] = "ok";
    }
    return out;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cmdCopied, setCmdCopied] = useState(false);
  const [idCopied, setIdCopied] = useState("");

  async function verifyModel(modelId: string) {
    if (modelId === "auto") return; // sentinel, nothing to verify
    setStatus((s) => ({ ...s, [modelId]: "verifying" }));
    try {
      await invoke<string>("verify_cli_model", {
        args: { cli: cli.id, model: modelId || null },
      });
      setStatus((s) => {
        const next = { ...s, [modelId]: "ok" as ModelVerifyStatus };
        const map = loadVerifyMap();
        map[`${cli.id}:${modelId}`] = "ok";
        saveVerifyMap(map);
        return next;
      });
      setErrors((e) => { const { [modelId]: _, ...rest } = e; return rest; });
      setCliVerify(cli.id, { status: "ok" }); // any working model = usable provider
    } catch (e) {
      setStatus((s) => ({ ...s, [modelId]: "failed" }));
      setErrors((er) => ({ ...er, [modelId]: String(e).slice(0, 200) }));
      // Only demote the provider when nothing of it has verified ok.
      if (cliVerifyLive.get(cli.id)?.status !== "ok") {
        setCliVerify(cli.id, { status: "failed", error: String(e).slice(0, 200) });
      }
    }
  }

  function verifyAll() {
    for (const m of verifiable) {
      if (status[m.id] === "ok" || status[m.id] === "verifying") continue;
      void verifyModel(m.id);
    }
  }

  // Auto-run verification when the card is opened the first time
  // and there are unverified models in the list.
  useEffect(() => {
    if (!isOpen) return;
    const unverified = verifiable.some((m) => status[m.id] !== "ok");
    if (unverified) verifyAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const copyText = (text: string, done: () => void) => {
    navigator.clipboard.writeText(text).then(done).catch(() => {});
  };

  const cliErr = liveVerify.get(cli.id);
  const meta = RUNTIME_META[cli.id];
  const verifiedCount = verifiable.filter((m) => status[m.id] === "ok").length;

  // Runtime health, one chip. Sentence case, two words at most.
  const health = (() => {
    if (!cli.available) {
      return cli.error
        ? { tone: "err" as ChipTone, label: "Won't run", title: cli.error }
        : { tone: "muted" as ChipTone, label: "Not installed" };
    }
    const v = cliVerifyLive.get(cli.id);
    if (v?.status === "ok") return { tone: "ok" as ChipTone, label: "Ready" };
    if (v?.status === "failed") {
      const login = authLoginCmd(cli.id, v.error ?? "");
      return { tone: "err" as ChipTone, label: login !== null ? "Not signed in" : "Not working", title: v.error ?? undefined };
    }
    if (v?.status === "verifying") return { tone: "warn" as ChipTone, label: "Checking", spin: true };
    return { tone: "muted" as ChipTone, label: "Detected" };
  })();

  // The one-line fact strip under the name: vendor, version, spend, verified.
  const metaParts: string[] = [brand.name];
  if (cli.available) metaParts.push(cli.version ? `Version ${cli.version}` : `${cli.bin} in PATH`);
  if (typeof cost === "number" && cost > 0) metaParts.push(`$${cost < 1 ? cost.toFixed(2) : cost < 100 ? cost.toFixed(1) : Math.round(cost)} spent`);
  if (cli.available && verifiable.length > 0) metaParts.push(`${verifiedCount} of ${verifiable.length} models verified`);

  // Runtime-level secondary actions, behind one menu in the header.
  const runtimeMenu: RowMenuItem[] = [];
  if (cli.available && verifiable.length > 0) runtimeMenu.push({ icon: RefreshCw, label: "Verify all models", onClick: verifyAll });
  if (cli.available) runtimeMenu.push({ icon: RefreshCw, label: "Re-check runtime", onClick: () => recheckCli(cli.id) });
  if (meta?.install) runtimeMenu.push({ icon: ArrowUpRight, label: "Open setup guide", onClick: () => { window.open(meta.install, "_blank", "noreferrer"); } });

  return (
    <div className={forceOpen ? "bg-surface" : `rounded-lg border bg-surface transition-colors ${open ? "border-accent-border" : "border-border-subtle"}`}>
      {/* Header: mark, big name, health chip, fact strip, ONE primary action. */}
      <div className="flex items-center gap-4 px-5 py-4">
        <ProviderMark vendor={cli.id} size={44} />
        <button
          onClick={() => !forceOpen && cli.available && setOpen((v) => !v)}
          disabled={forceOpen || !cli.available || models.length === 0}
          className="min-w-0 flex-1 text-left disabled:cursor-default"
        >
          <span className="flex items-center gap-2">
            {!forceOpen && cli.available && models.length > 0 && (
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`} />
            )}
            <span className="truncate font-display text-lg font-semibold tracking-tight text-text-primary">{cli.label}</span>
            {isDefault && <span className="shrink-0 rounded-full bg-accent px-2 py-px text-[10px] font-semibold text-background">Default</span>}
            <StatusChip tone={health.tone} label={health.label} spin={health.spin} title={health.title} />
          </span>
          <span className="mt-0.5 block truncate text-xs text-text-muted">{metaParts.join("  ·  ")}</span>
        </button>
        {cli.available && chattable ? (
          <button onClick={() => onStartChat?.(cli.id)} className={btnPrimary}>
            Start chat
          </button>
        ) : cli.available && !chattable ? (
          // Harness, installed: catalog-only (not a homepage chat runtime).
          <span className="text-xs text-text-muted" title="Harness: set up here; not a chat runtime">Ready to use</span>
        ) : (
          <a
            href={meta?.install ?? "#"}
            target="_blank"
            rel="noreferrer"
            title={meta?.blurb ? `${meta.blurb} (opens setup docs)` : "Open setup docs"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-accent-border hover:text-accent"
          >
            Set up <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        )}
        {runtimeMenu.length > 0 && <RowMenu items={runtimeMenu} label="Runtime actions" />}
      </div>

      {/* Why it's not working, on the card face: usually an auth/token problem,
          so lead with the fix (the login command) rather than the stack. */}
      {cli.available && cliErr?.status === "failed" && cliErr.error && (
        <div className="flex items-center gap-2.5 border-t border-border-subtle bg-warn/5 px-5 py-2.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" />
          <div className="min-w-0 flex-1 text-xs text-text-secondary">
            {(() => {
              const loginCmd = authLoginCmd(cli.id, cliErr.error ?? "");
              return loginCmd ? (
                <>Not signed in. Run <code className="rounded bg-surface-warm px-1.5 py-0.5 font-mono text-[11px] text-accent">{loginCmd}</code> in a terminal, then re-check.</>
              ) : (
                <span className="line-clamp-2">{cliErr.error}</span>
              );
            })()}
          </div>
          <button onClick={() => recheckCli(cli.id)} className={btnSecondary}>Re-check</button>
        </div>
      )}

      {isOpen && cli.available && models.length > 0 && (
        <div className="border-t border-border-subtle px-5 py-4">
          <div className="mb-3 flex items-baseline gap-2">
            <h4 className="text-base font-semibold text-text-primary">Models</h4>
            <span className="text-sm text-text-muted">{models.length}</span>
            {verifiable.length > 0 && (
              <button onClick={verifyAll} className="ml-auto text-xs text-text-secondary hover:text-accent">
                Verify all
              </button>
            )}
          </div>
          {/* Auto routing, one compact row, only for runtimes that offer "Auto". */}
          {models.some((m) => m.id === "auto") && <div className="mb-3"><RoutingRow /></div>}
          <div className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-background">
            {models.map((m) => {
              const s = status[m.id];
              const err = errors[m.id];
              const isAuto = m.id === "auto";
              const isDef = defaultModel === m.id;
              const failed = s === "failed";
              const loginCmd = failed && err ? authLoginCmd(cli.id, err) : null;
              const idTip = m.resolved && m.resolved !== m.id ? `${m.id} (resolves to ${m.resolved})` : m.id;
              const glyph = isAuto
                ? <Sparkles className="h-4 w-4 text-accent" />
                : s === "ok" ? <CircleCheck className="h-4 w-4 text-ok" />
                : s === "verifying" ? <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
                : failed ? <CircleX className="h-4 w-4 text-err" />
                : <Circle className="h-4 w-4 text-text-muted/40" />;
              const glyphTip = isAuto ? "Router: picks a model per prompt" : s === "ok" ? "Verified" : s === "verifying" ? "Checking" : failed ? "Failed" : "Not checked yet";
              const menu: RowMenuItem[] = [];
              if (!isDef) menu.push({ icon: Star, label: "Use as default", hint: "New chats start here", onClick: () => setAsDefault(m.id) });
              if (!isAuto) menu.push({ icon: RefreshCw, label: s === "ok" || failed ? "Test again" : "Test now", disabled: s === "verifying", onClick: () => { void verifyModel(m.id); } });
              menu.push({
                icon: LineChart,
                label: "Benchmark runs",
                hint: "Scores, domains, history",
                onClick: () => {
                  // Jump to the Arena with this model's runs expanded (key matches
                  // the leaderboard aggregation).
                  lsSet("prevail.bench.expandModel", `${cli.id}::${m.label}`);
                  window.dispatchEvent(new CustomEvent("prevail:settings-section", { detail: "benchmark" }));
                },
              });
              menu.push({ kind: "separator" });
              menu.push({ icon: Copy, label: idCopied === m.id ? "Copied" : "Copy model id", hint: idTip, onClick: () => copyText(m.id, () => { setIdCopied(m.id); window.setTimeout(() => setIdCopied(""), 1500); }) });
              return (
                <div key={m.id} className="group flex items-center gap-3 px-3 py-2.5">
                  <span className="flex w-5 shrink-0 justify-center" title={glyphTip}>{glyph}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {/* A failed model is muted by color, not opacity: opacity would
                          also fade the row's popover menu. */}
                      <span className={`truncate text-sm font-medium ${failed ? "text-text-muted" : "text-text-primary"}`} title={`Model id: ${idTip}`}>{m.label}</span>
                      {isDef && <span className="shrink-0 rounded-full bg-accent px-2 py-px text-[10px] font-semibold text-background">Default</span>}
                      {failed && (
                        <StatusChip
                          tone="err"
                          label={loginCmd !== null ? "Not signed in" : "Failed"}
                          title={loginCmd ? `Run ${loginCmd} in a terminal, then test again. ${err}` : err}
                        />
                      )}
                    </div>
                    {m.blurb && <div className={`truncate text-xs ${failed ? "text-text-muted/60" : "text-text-muted"}`}>{m.blurb}</div>}
                  </div>
                  {chattable && (
                    <button
                      onClick={() => onStartChat?.(cli.id, m.id)}
                      className={`${btnSecondary} ${isDef ? "border-accent-border text-accent" : ""}`}
                    >
                      Chat
                    </button>
                  )}
                  <RowMenu items={menu} reveal label={`More actions for ${m.label}`} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Installed but no model list (harnesses): the body was previously blank,
          which read as "broken." Explain what it is and that it's ready. */}
      {isOpen && cli.available && models.length === 0 && (
        <div className="space-y-2 border-t border-border-subtle px-5 py-4">
          <div className="text-sm text-text-secondary">
            {meta?.blurb || `${cli.label} is a harness runtime.`}
          </div>
          <p className="text-xs leading-relaxed text-text-muted">
            This is a <span className="font-semibold text-text-secondary">Harness</span>: it wraps the{" "}
            <code className="text-accent">{meta?.protocol ?? "base"}</code> protocol and runs through your installed base CLI. It's installed and validated, so it's ready to use wherever harnesses are offered (it isn't a homepage chat runtime).
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <span className="text-xs text-text-muted">{cli.version ? `Version ${cli.version} · ` : ""}{cli.bin}</span>
            {meta?.install && (
              <a href={meta.install} target="_blank" rel="noreferrer" className={btnSecondary}>
                Docs <ArrowUpRight className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Not installed: a real setup body (not just a tiny link), so the detail
          pane always says something actionable. */}
      {isOpen && !cli.available && (
        <div className="space-y-3 border-t border-border-subtle px-5 py-4">
          <div className="text-sm text-text-secondary">
            {cli.error
              ? `${cli.label} is installed but won't run: its launcher is on disk but failed to start.`
              : meta?.blurb || `${cli.label} isn't installed on this Mac yet.`}
          </div>
          {/* Broken install: show the actual failure so the user knows what to
              fix (the most common cause is a wrapper pointing at a removed env). */}
          {cli.error && (
            <div className="flex items-start gap-2 rounded-md border border-err/30 bg-err/5 px-2.5 py-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-err" />
              <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-text-secondary">{cli.error}</code>
            </div>
          )}
          <div className="space-y-2.5 rounded-lg border border-border-subtle bg-background p-3">
            <div className="text-sm font-semibold text-text-primary">{cli.error ? `Reinstall ${cli.label}` : `Set up ${cli.label}`}</div>
            <p className="text-xs leading-relaxed text-text-secondary">
              {cli.error
                ? `Reinstall ${cli.label} to repair the launcher. It runs on your own subscription, no key to paste here. Prevail auto-detects it; hit Re-check once it's fixed.`
                : `Install ${cli.label} from its setup guide. It runs on your own subscription, no key to paste here. Prevail auto-detects it; hit Re-check once it's installed.`}
            </p>
            {meta?.cmd && (
              <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-warm/60 px-2 py-1.5">
                <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-primary" title={meta.cmd}>{meta.cmd}</code>
                <button
                  onClick={() => { void invoke("open_in_terminal", { command: meta.cmd }).catch((e) => console.error("open_in_terminal", e)); }}
                  title="Open Terminal and run this install command (you'll see it run and can confirm any prompts)"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent-border bg-accent-soft px-2.5 py-1 text-xs text-accent hover:bg-accent hover:text-background"
                >
                  <Terminal className="h-3 w-3" /> Install
                </button>
                <button
                  onClick={() => copyText(meta.cmd!, () => { setCmdCopied(true); window.setTimeout(() => setCmdCopied(false), 1500); })}
                  className={btnSecondary}
                >
                  {cmdCopied ? <><Check className="h-3 w-3" /> Copied</> : "Copy"}
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {meta?.install && (
                <a href={meta.install} target="_blank" rel="noreferrer" className={btnPrimary}>
                  Open setup guide <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              )}
              <button onClick={() => recheckCli(cli.id)} className={btnSecondary}>Re-check</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// Pick a representative icon for a settings page from its title, so every
// header gets a matching glyph without threading an icon through 20 call sites.

// Header hierarchy, level 2: a subsection within a settings page. Sits clearly
// below the big SettingsHeader (level 1) and above the small mono group labels
// (level 3), so the eye reads page -> subsection -> group without guessing.
// Display-weight, sentence case, with a hairline rule underneath.

// Header hierarchy, level 3: a small group label inside a subsection (e.g.
// "Detected · 2"). The quietest of the three so it never competes with a
// level-2 SubsectionHeader.

// Privacy & Connectivity - the Bunker Mode control surface. The toggle + status
// card here reflect the BACKEND policy (bunker.rs), which is the real source of
// truth and enforcer; this screen never decides anything on its own.

// One row in the Runtimes master-detail list: provider mark, name, a health
// dot, version sub-line, and the default marker. Selecting it shows the runtime
// detail (an always-open AgentCard) on the right.
function RuntimeRow({ cli, active, vstatus, isDefault, onSelect }: {
  cli: CliInfo;
  active: boolean;
  vstatus?: string;
  isDefault?: boolean;
  onSelect: () => void;
}) {
  // Broken = on disk but won't run (detect_clis returned an error). Distinct
  // from genuinely not-installed, so the row never disagrees with the detail
  // panel's BROKEN / "won't run" status.
  const broken = !cli.available && !!cli.error;
  const sub = cli.available ? (cli.version ? `Version ${cli.version.slice(0, 22)}` : "Detected") : broken ? "Won't run" : "Not installed";
  // One lucide glyph per state, colored, no badge background: the row stays
  // quiet and the color alone says ready / checking / failed / absent.
  const state: { Icon: LucideIcon; cls: string; tip: string } = !cli.available
    ? broken
      ? { Icon: CircleX, cls: "text-err", tip: "Installed but won't run" }
      : { Icon: Circle, cls: "text-text-muted/40", tip: "Not installed" }
    : vstatus === "ok"
      ? { Icon: CircleCheck, cls: "text-ok", tip: "Ready" }
      : vstatus === "failed"
        ? { Icon: CircleX, cls: "text-warn", tip: "Not working" }
        : vstatus === "verifying"
          ? { Icon: Loader2, cls: "animate-spin text-text-muted", tip: "Checking" }
          : { Icon: Circle, cls: "text-text-muted/60", tip: "Detected, not checked yet" };
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 rounded-lg border-l-2 px-2.5 py-2 text-left transition-colors ${active ? "border-l-accent bg-accent-soft shadow-sm ring-1 ring-accent-border" : "border-l-transparent ring-1 ring-transparent hover:bg-surface-warm"}`}
    >
      <ProviderMark vendor={cli.id} size={28} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-semibold ${active ? "text-accent" : "text-text-primary"}`}>{cli.label}</span>
        <span className="block truncate text-[11px] text-text-muted">{sub}</span>
      </span>
      {isDefault && <span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-background">Default</span>}
      <span className="flex shrink-0" title={state.tip} aria-label={state.tip}><state.Icon className={`h-4 w-4 ${state.cls}`} /></span>
    </button>
  );
}

export function AgentsSection({
  clis,
  onStartChatWith,
  embedded,
  defaultChatCli,
  onMakeDefault,
  vaultPath,
}: {
  clis: CliInfo[];
  onStartChatWith?: (cliId: string, modelId?: string) => void;
  embedded?: boolean;
  defaultChatCli?: string;
  onMakeDefault?: (cliId: string) => void;
  vaultPath?: string;
}) {
  // Runtimes shown as SEPARATE collapsible groups: hosted vendor CLIs (Cloud
  // models: Claude Code, Codex, Gemini, Antigravity, ...), on-device runtimes
  // (Local models: Ollama, LM Studio, MLX, LocalAI, llama.cpp), and harnesses
  // that wrap a base protocol (Pi, OpenCode, Hermes, OpenClaw, Paperclip,
  // Motorcar). Within each, installed runtimes sort first; not-installed show a
  // "Set up" link. All groups open by default so every supported runtime is
  // visible to set up.
  const sortReady = (a: CliInfo, b: CliInfo) => Number(b.available) - Number(a.available) || a.label.localeCompare(b.label);
  // Aggregators (OpenRouter, Bedrock) are HTTP gateways, not spawnable CLIs -
  // they have their own "Aggregator runtimes" section with key + catalog, so
  // they must NOT also appear in the CLI runtimes list (and can't be "spawned").
  const AGGREGATOR_IDS = new Set(["openrouter", "bedrock"]);
  const cliRuntimes = clis.filter((c) => !isHarnessRuntime(c.id) && !AGGREGATOR_IDS.has(c.id)).sort(sortReady);
  const harnesses = clis.filter((c) => isHarnessRuntime(c.id)).sort(sortReady);
  // Split the vendor CLIs into on-device (local) vs hosted (cloud) so the user
  // can configure local-only models in one place. Match local runtimes by id,
  // case-insensitively, covering the common naming variants.
  const LOCAL_RUNTIME_IDS = new Set(["ollama", "omlx", "mlx", "lmstudio", "lm-studio", "localai", "llamacpp"]);
  const isLocalRuntime = (id: string) => LOCAL_RUNTIME_IDS.has(id.toLowerCase());
  const localClis = cliRuntimes.filter((c) => isLocalRuntime(c.id));
  const cloudClis = cliRuntimes.filter((c) => !isLocalRuntime(c.id));
  // Per-runtime spend (cumulative), from the local usage ledger. Shown in the
  // detail; "-" when nothing has been spent / no vault.
  const [costByCli, setCostByCli] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!vaultPath) return;
    let alive = true;
    invoke<UsageSummary>("usage_summary", { vault: vaultPath })
      .then((s) => {
        if (!alive) return;
        const m: Record<string, number> = {};
        for (const b of s.by_cli || []) m[b.key] = b.cost_usd;
        setCostByCli(m);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [vaultPath]);

  // Master-detail: pick a runtime on the left, see its full detail (an
  // always-open AgentCard) on the right - the canonical app layout.
  const groups = [
    { key: "cloud", label: "Cloud models", list: cloudClis },
    { key: "local", label: "Local models", list: localClis },
    { key: "harness", label: "Harnesses", list: harnesses },
  ].filter((g) => g.list.length > 0);
  const all = groups.flatMap((g) => g.list);
  const verify = useCliVerifyLive();
  const [selectedId, setSelectedId] = useState("");
  const selectedEff = selectedId || defaultChatCli || all.find((c) => c.available)?.id || all[0]?.id || "";
  const selected = all.find((c) => c.id === selectedEff) ?? null;
  // Collapsible sub-groups (Cloud / Local / Harnesses), matching the Arena rail's
  // expandable provider groups. Collapsed keys persisted so the rail reopens the
  // same way; all groups open by default.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("prevail.runtimes.groupsCollapsed") || "[]")); }
    catch { return new Set(); }
  });
  const toggleGroup = (key: string) => setCollapsedGroups((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    try { localStorage.setItem("prevail.runtimes.groupsCollapsed", JSON.stringify([...next])); } catch { /* ignore */ }
    return next;
  });

  const listEl = (
    <div className="space-y-3">
      {groups.map((g) => {
        const ready = g.list.filter((c) => c.available).length;
        const open = !collapsedGroups.has(g.key);
        return (
          <div key={g.key} className="space-y-1">
            <button
              onClick={() => toggleGroup(g.key)}
              aria-expanded={open}
              className="flex w-full items-baseline justify-between rounded-md px-1 py-0.5 transition-colors hover:bg-surface-warm"
            >
              <span className="flex items-center gap-1 text-xs font-medium text-text-secondary">
                <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2.5} />
                {g.label} <span className="font-normal text-text-muted">{g.list.length}</span>
              </span>
              <span className="text-[11px] text-text-muted">{ready} of {g.list.length} set up</span>
            </button>
            {open && g.list.map((c) => (
              <RuntimeRow
                key={c.id}
                cli={c}
                active={c.id === selectedEff}
                vstatus={verify.get(c.id)?.status}
                isDefault={defaultChatCli === c.id}
                onSelect={() => setSelectedId(c.id)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );

  // Collapsed icon rail: each runtime's mark, clickable to select (so collapsing
  // keeps every runtime reachable, not hidden).
  const railEl = (
    <>
      {all.map((c) => (
        <button
          key={c.id}
          onClick={() => setSelectedId(c.id)}
          title={`${c.label}${c.available ? "" : " (not installed)"}`}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${c.id === selectedEff ? "ring-2 ring-accent" : "hover:bg-surface-strong"} ${c.available ? "" : "opacity-50"}`}
        >
          <ProviderMark vendor={c.id} size={26} />
        </button>
      ))}
    </>
  );

  const detailEl = selected ? (
    <AgentCard
      key={selected.id}
      cli={selected}
      forceOpen
      onStartChat={onStartChatWith}
      isDefault={defaultChatCli === selected.id}
      onMakeDefault={onMakeDefault ? () => onMakeDefault(selected.id) : undefined}
      cost={costByCli[selected.id]}
      chattable={!isHarnessRuntime(selected.id)}
    />
  ) : (
    <div className="p-8 text-center text-sm text-text-muted">Select a runtime to see its status, models, and actions.</div>
  );

  return (
    <>
      {!embedded && (
        <SettingsHeader
          title="Runtimes"
          subtitle="The runtimes detected on this Mac."
        />
      )}
      <MasterDetail title="Runtimes" storageKey="prevail.runtimes.listCollapsed" list={listEl} rail={railEl} detail={detailEl} />
    </>
  );
}
