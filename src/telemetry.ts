// Telemetry — anonymous, ON by default with a one-tap opt-out (Privacy page),
// and impossible to leak content. Product decision 2026-07: collection is
// default-on so the product actually learns from usage; the privacy promise is
// kept structurally (hard allowlist, anonymous UUID, transparency log) rather
// than by keeping the pipe empty. Bunker Mode overrides everything: when
// nothing may leave the device, telemetry does not either.
//
// Design (see docs/TELEMETRY-PLAN.md):
//   * Two independent consents: usage (PostHog, default ON) and crash (Sentry, default OFF).
//   * A HARD allowlist of event names and property keys. Anything off the list is
//     dropped before it can ever be sent — a content leak can't happen by accident.
//   * distinct_id is a random local UUID, never email/name/path/machine.
//   * Every would-be send is also appended to a local ring-buffer log so the user
//     can see EXACTLY what telemetry does. Full transparency.
//   * Network sends are gated behind build-time keys (VITE_POSTHOG_KEY /
//     VITE_SENTRY_DSN). With no keys the module is inert: it only writes the local
//     log. Both SDKs are lazy-imported on first send, so a user who never opts in
//     pays zero bytes; PostHog/Sentry init is privacy-hardened (see each block).
import { APP_VERSION } from "./constants";
import { PREF, getPref, isBunkerOn, lsGet, lsSet, setPref } from "./storage";

// ── Allowlist ───────────────────────────────────────────────────────────────
// Only these event names may be sent. Add deliberately; never auto-generate.
export const ALLOWED_EVENTS = [
  "app_opened",        // {version, os}
  "feature_used",      // {feature}
  "benchmark_run",     // {models, domains}
  "provider_configured", // {provider}
  "daemon_toggled",    // {daemon, on}
] as const;
export type TelemetryEvent = (typeof ALLOWED_EVENTS)[number];

// Only these property KEYS survive scrubbing, and only as primitives. No free
// text the user typed, no names they created, no paths — none of it is here.
const ALLOWED_PROPS = new Set([
  "version", "os", "channel", "feature", "models", "domains", "provider", "daemon", "on",
]);

// Properties whose string values must come from a fixed vocabulary, so even an
// allowlisted key can't smuggle content (e.g. feature must be a known feature).
const ENUM_VALUES: Record<string, Set<string>> = {
  os: new Set(["mac", "win", "linux", "unknown"]),
  feature: new Set(["chat", "council", "benchmark", "skills", "intents", "ideal_state", "apps", "memory", "loops", "tasks", "journal", "notes", "automations", "domains", "privacy", "models", "tools", "profile", "settings", "work", "home"]),
  provider: new Set(["openrouter", "anthropic", "openai", "google", "ollama", "lmstudio", "bedrock", "other"]),
  daemon: new Set(["distill", "reminders", "taskgen", "skillgen", "headless_learn"]),
};

// ── Consent ──────────────────────────────────────────────────────────────────
// Opt-IN. A local-first, private product does not phone home by default; the
// user turns usage telemetry on in Settings if they want to help.
export function usageOn(): boolean { return getPref(PREF.telemetryUsage, "0") === "1"; }
export function crashOn(): boolean { return getPref(PREF.telemetryCrash, "0") === "1"; }
export function setUsage(on: boolean) { setPref(PREF.telemetryUsage, on ? "1" : "0"); }
export function setCrash(on: boolean) {
  setPref(PREF.telemetryCrash, on ? "1" : "0");
  // Attach Sentry's global handlers the moment consent is granted; when revoked,
  // beforeSend already drops every event, so no teardown is needed.
  if (on && SENTRY_DSN) void ensureSentry();
}

// ── Anonymous id ─────────────────────────────────────────────────────────────
export function distinctId(): string {
  let id = getPref(PREF.telemetryDistinctId, "");
  if (!id) {
    id = (globalThis.crypto?.randomUUID?.() ?? `anon-${Math.random().toString(36).slice(2)}-${Date.now()}`);
    setPref(PREF.telemetryDistinctId, id);
  }
  return id;
}

// ── Scrubber ─────────────────────────────────────────────────────────────────
// Drop any key not on the allowlist; coerce values to safe primitives; enforce
// enum vocabularies. Returns a clean object that is safe to transmit.
function scrub(props?: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props) return out;
  for (const [k, v] of Object.entries(props)) {
    if (!ALLOWED_PROPS.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) { out[k] = v; continue; }
    if (typeof v === "boolean") { out[k] = v; continue; }
    if (typeof v === "string") {
      const enums = ENUM_VALUES[k];
      if (enums) { if (enums.has(v)) out[k] = v; continue; } // unknown enum value → dropped
      // Non-enum strings (version, channel): allow only short, simple tokens.
      if (/^[\w.\-+]{1,40}$/.test(v)) out[k] = v;
    }
  }
  return out;
}

// ── Local transparency log (ring buffer, newest last) ────────────────────────
const LOG_KEY = "prevail.telemetry.log";
const LOG_MAX = 200;
export type LoggedEvent = { ts: number; event: string; props: Record<string, string | number | boolean>; sent: boolean };
export function telemetryLog(): LoggedEvent[] {
  try { return JSON.parse(lsGet(LOG_KEY, "[]") || "[]"); } catch { return []; }
}
function appendLog(e: LoggedEvent) {
  const log = telemetryLog();
  log.push(e);
  while (log.length > LOG_MAX) log.shift();
  lsSet(LOG_KEY, JSON.stringify(log));
}
export function clearTelemetryLog() { lsSet(LOG_KEY, "[]"); }

// ── Build-time keys (inert if absent) ────────────────────────────────────────
const POSTHOG_KEY = (import.meta as { env?: Record<string, string> }).env?.VITE_POSTHOG_KEY ?? "";
const POSTHOG_HOST = (import.meta as { env?: Record<string, string> }).env?.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com";
const SENTRY_DSN = (import.meta as { env?: Record<string, string> }).env?.VITE_SENTRY_DSN ?? "";
export function telemetryConfigured(): boolean { return !!POSTHOG_KEY || !!SENTRY_DSN; }

// ── PostHog (lazy) ────────────────────────────────────────────────────────────
// The SDK is only imported on the first transmitted event — never at module load
// — so a user who never opts in pays zero bytes for it. Privacy-hardened init:
// no autocapture, no pageviews, no session recording, identified-only profiles,
// and IP/geo collection disabled server-side via the property below.
type PostHogLike = { capture: (e: string, p?: Record<string, unknown>) => void };
let _posthog: PostHogLike | null = null;
let _posthogInit: Promise<PostHogLike | null> | null = null;
function ensurePosthog(): Promise<PostHogLike | null> {
  if (_posthog) return Promise.resolve(_posthog);
  if (_posthogInit) return _posthogInit;
  if (!POSTHOG_KEY) return Promise.resolve(null);
  _posthogInit = import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        autocapture: false,          // never scrape DOM clicks/inputs
        capture_pageview: false,     // no URL/route capture
        capture_pageleave: false,
        disable_session_recording: true,
        disable_surveys: true,
        person_profiles: "identified_only",
        persistence: "localStorage",
        bootstrap: { distinctID: distinctId() },
        ip: false,                   // no IP collection
        property_blacklist: ["$current_url", "$pathname", "$host", "$referrer", "$referring_domain"],
        // Nothing the server's remote config could switch on: no exception
        // capture (error text can quote prompts, chats, entity names or vault
        // paths), no heatmaps, dead or rage clicks, web vitals, experiments,
        // tours, chat widget or remotely loaded scripts.
        capture_exceptions: false,
        capture_heatmaps: false,
        capture_dead_clicks: false,
        capture_performance: false,
        rageclick: false,
        disable_web_experiments: true,
        disable_product_tours: true,
        disable_conversations: true,
        disable_external_dependency_loading: true,
        advanced_disable_flags: true,
        // Last gate before the network: only allowlisted events, only
        // allowlisted properties (see scrubPosthogEvent).
        before_send: (ev) => scrubPosthogEvent(ev as unknown as PosthogEventLike) as unknown as typeof ev,
      });
      // Create the (anonymous) person profile and stamp version/os on every
      // event, so analyses can segment by build without per-callsite plumbing.
      // The id is the same random local UUID - never email/name/machine.
      try {
        (posthog as unknown as { identify: (id: string) => void }).identify(distinctId());
        (posthog as unknown as { register: (p: Record<string, string>) => void }).register({ version: APP_VERSION, os: osFamily() });
      } catch { /* telemetry must never break the app */ }
      _posthog = posthog as unknown as PostHogLike;
      return _posthog;
    })
    .catch(() => null);
  return _posthogInit;
}

// PostHog's own event pipeline adds $-properties (URL, referrer, element text,
// exception text...). Before any event leaves, drop events that are not ours
// and keep only our allowlisted, scrubbed properties plus a fixed set of
// SDK bookkeeping keys that cannot carry content.
const POSTHOG_SAFE_PROPS = new Set([
  "token", "distinct_id", "$device_id", "$user_id", "$insert_id", "$time", "$lib", "$lib_version", "$os", "$os_version",
  "$browser", "$browser_version", "$device_type", "$screen_height", "$screen_width", "$viewport_height", "$viewport_width",
  "$session_id", "$window_id", "$process_person_profile", "$is_identified", "$configured_session_timeout_ms",
]);
export interface PosthogEventLike { event?: string; properties?: Record<string, unknown>; $set?: unknown; $set_once?: unknown; [k: string]: unknown }
export function scrubPosthogEvent(ev: PosthogEventLike | null): PosthogEventLike | null {
  if (!ev || typeof ev.event !== "string") return null;
  const ours = (ALLOWED_EVENTS as readonly string[]).includes(ev.event);
  if (!ours && ev.event !== "$identify") return null;
  const props = ev.properties ?? {};
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) if (POSTHOG_SAFE_PROPS.has(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) kept[k] = v;
  const out: PosthogEventLike = { ...ev, properties: { ...kept, ...scrub(props) } };
  // Person properties: only version and os, from our own register() call.
  delete out.$set; delete out.$set_once;
  delete (out.properties as Record<string, unknown>).$set;
  delete (out.properties as Record<string, unknown>).$set_once;
  return out;
}

// ── Sentry crash reporting (lazy) ─────────────────────────────────────────────
// Same privacy posture as PostHog: lazy-imported only when crash consent is on,
// so a non-consenting user pays zero bytes. Hardened init — the OPPOSITE of the
// vendor default: sendDefaultPii=false, no IP, no breadcrumbs (which would
// capture console/DOM/fetch content), no tracing, no session replay. Consent is
// re-checked in beforeSend on EVERY event, so flipping the toggle off stops all
// sends instantly even if the SDK is already initialized. The only identifier
// attached is the random local UUID — never email/name/host/path.
type SentryLike = {
  captureException: (e: unknown) => void;
  captureMessage: (m: string) => void;
};
let _sentry: SentryLike | null = null;
let _sentryInit: Promise<SentryLike | null> | null = null;
function ensureSentry(): Promise<SentryLike | null> {
  if (_sentry) return Promise.resolve(_sentry);
  if (_sentryInit) return _sentryInit;
  if (!SENTRY_DSN) return Promise.resolve(null);
  _sentryInit = import("@sentry/browser")
    .then((Sentry) => {
      Sentry.init({
        dsn: SENTRY_DSN,
        release: APP_VERSION,          // matches the source maps uploaded in CI → readable stack traces
        sendDefaultPii: false,         // never attach IP, cookies, headers, or user data
        defaultIntegrations: false,    // drop breadcrumbs/console/fetch/dom capture wholesale
        integrations: [
          // Keep only crash capture + dedupe; nothing that records content.
          Sentry.globalHandlersIntegration({ onerror: true, onunhandledrejection: true }),
          Sentry.dedupeIntegration(),
          Sentry.functionToStringIntegration(),
        ],
        maxBreadcrumbs: 0,             // belt-and-suspenders: zero breadcrumbs
        tracesSampleRate: 0,           // no performance/transaction data
        // No session pings: defaultIntegrations are off and we never add
        // browserSessionIntegration, so no session/health data is ever sent.
        initialScope: { user: { id: distinctId() } }, // anon UUID only
        beforeBreadcrumb: () => null,  // drop every breadcrumb, always
        beforeSend(event) {
          if (!crashOn() || isBunkerOn()) return null; // consent re-checked per event → off = silent
          return scrubSentryEvent(event as unknown as SentryEventLike, distinctId()) as unknown as typeof event;
        },
      });
      _sentry = { captureException: Sentry.captureException, captureMessage: Sentry.captureMessage };
      return _sentry;
    })
    .catch(() => null);
  return _sentryInit;
}

// ── Sentry event scrubber ─────────────────────────────────────────────────────
// An error message is free text: it can quote a prompt, a chat line, an entity
// name, a note or a vault path (an engine error echoes its arguments). None of
// that may leave the device, so a crash report keeps only its SHAPE: the error
// type, and stack frames reduced to function names and bundle file names. Every
// message, breadcrumb, extra, tag, context, request and fingerprint is dropped.
export interface SentryFrameLike { filename?: string; abs_path?: string; function?: string; lineno?: number; colno?: number; in_app?: boolean; [k: string]: unknown }
export interface SentryEventLike {
  [k: string]: unknown;
  exception?: { values?: { type?: string; value?: string; stacktrace?: { frames?: SentryFrameLike[] }; mechanism?: { type?: string; handled?: boolean } }[] };
}
const SAFE_TYPE = /^[A-Za-z_$][\w$.]{0,60}$/;
const SAFE_FN = /^[\w$.<>\[\]]{1,80}$/;
// Only the bundle's own file name survives (index-abc123.js); a path, a host
// that is not the app, or anything with a space or @ is cut to "<file>".
function safeFile(f?: string): string | undefined {
  if (!f) return undefined;
  const base = f.split(/[?#]/)[0].split(/[\\/]/).pop() ?? "";
  return /^[\w.-]{1,80}\.(m?js|tsx?|jsx?)$/.test(base) ? `app:///${base}` : "<file>";
}
export function scrubSentryEvent(event: SentryEventLike, anonId: string): SentryEventLike {
  const values = (event.exception?.values ?? []).map((v) => ({
    type: v.type && SAFE_TYPE.test(v.type) ? v.type : "Error",
    value: "[redacted]",
    ...(v.mechanism ? { mechanism: { type: String(v.mechanism.type ?? "generic").slice(0, 40), handled: !!v.mechanism.handled } } : {}),
    ...(v.stacktrace?.frames ? {
      stacktrace: {
        frames: v.stacktrace.frames.map((fr) => ({
          ...(fr.function && SAFE_FN.test(fr.function) ? { function: fr.function } : {}),
          ...(safeFile(fr.filename ?? fr.abs_path) ? { filename: safeFile(fr.filename ?? fr.abs_path) } : {}),
          ...(typeof fr.lineno === "number" ? { lineno: fr.lineno } : {}),
          ...(typeof fr.colno === "number" ? { colno: fr.colno } : {}),
          ...(typeof fr.in_app === "boolean" ? { in_app: fr.in_app } : {}),
        })),
      },
    } : {}),
  }));
  const out: SentryEventLike = {
    ...(typeof event.event_id === "string" ? { event_id: event.event_id } : {}),
    ...(typeof event.timestamp === "number" ? { timestamp: event.timestamp } : {}),
    ...(typeof event.platform === "string" ? { platform: event.platform } : {}),
    ...(typeof event.level === "string" ? { level: event.level } : {}),
    ...(typeof event.release === "string" ? { release: event.release } : {}),
    ...(typeof event.environment === "string" ? { environment: event.environment } : {}),
    ...(event.sdk && typeof event.sdk === "object" ? { sdk: event.sdk } : {}),
    user: { id: anonId },
  };
  if (values.length) out.exception = { values };
  // A bare captureMessage carries nothing but its text: keep that it happened.
  else out.message = "[redacted]";
  return out;
}

/**
 * Initialize crash reporting if (and only if) the user has consented and a DSN
 * was built in. Safe to call on boot and again whenever consent changes — it is
 * idempotent. Once initialized, Sentry's global handlers capture uncaught errors
 * and unhandled rejections automatically; beforeSend gates every send on consent.
 */
export function initCrashReporting(): void {
  if (crashOn() && SENTRY_DSN) void ensureSentry();
}

/** Manually report a caught error. No-op unless crash consent is on + DSN built in. */
export function reportError(err: unknown): void {
  if (!crashOn() || !SENTRY_DSN) return;
  void ensureSentry().then((s) => s?.captureException(err)).catch(() => {});
}

// ── Public API ───────────────────────────────────────────────────────────────
/**
 * Record an anonymous usage event. Always allowlist-scrubbed and logged locally;
 * only transmitted if usage consent is on AND a PostHog key was built in.
 */
export function track(event: TelemetryEvent, props?: Record<string, unknown>) {
  if (!ALLOWED_EVENTS.includes(event)) return; // unknown event → never sent
  const clean = scrub(props);
  // Bunker Mode means NOTHING leaves this device - telemetry included, no
  // matter what the consent pref says. The local transparency log still gets
  // the entry (marked unsent) so behavior stays inspectable.
  const willSend = usageOn() && !!POSTHOG_KEY && !isBunkerOn();
  appendLog({ ts: Date.now(), event, props: clean, sent: willSend });
  if (!willSend) return;
  // Forward to PostHog. Lazy-inits the SDK on first send; the scrubbed `clean`
  // object is the ONLY payload — distinct_id is the random local UUID, IP/geo
  // and autocapture are disabled in init(). Fire-and-forget; never throws.
  void ensurePosthog().then((ph) => ph?.capture(event, clean)).catch(() => {});
}

/** Coarse OS family for the `os` property (never the full UA/machine name). */
export function osFamily(): "mac" | "win" | "linux" | "unknown" {
  if (typeof navigator === "undefined") return "unknown";
  const s = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (s.includes("mac")) return "mac";
  if (s.includes("win")) return "win";
  if (s.includes("linux")) return "linux";
  return "unknown";
}
