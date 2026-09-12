# Prevail v0.3.112

Prevail now runs on your phone as a client of your Mac, and a truth-and-safety pass fixed a dead chart, a data race in the distiller, and two places the desktop was talking to the outside world without asking.

## New

- **Prevail on your phone.** A phone cannot run the CLIs, so the mobile app is a client of the Mac. With "Reachable from other devices" on (Settings > Remote, on by default), the web bridge binds to this Mac's Tailscale address when Tailscale is present (private to the tailnet, encrypted, never on the public interface), otherwise to the LAN. The pairing card shows the phone URL, a QR code, and the two-tap install steps for iPhone (Add to Home Screen) and Android (Install app). The installed app stays signed in across launches.
- **Phone-first shell.** Below 768px the desktop cockpit gives way to a shell built for a thumb: a fixed bottom tab bar (Chat, Domains, Needs you, Settings) with 44px targets and iOS safe-area padding. Domains is a card per domain with readiness, score and running or new-reply chips; tapping one opens its chat. Chat has a Chat | Council toggle, a Threads sheet, and a composer pinned above the tabs that the keyboard never covers. Needs you is the Decision Inbox full width. Settings is a grouped list with Back headers, and deep links land on the right section.
- **Google refresh skill.** Connecting Google now writes `skills/sync-google.md`, which pulls the next 7 days of calendar and unread-important mail metadata into the vault on the refresh trigger. Until now every scheduled Google sync failed with "no refresh skill", so Google context only reached a prompt as a live MCP tool, never through the vault. Existing installs are upgraded in place and user edits are never overwritten.
- **Honest catalog.** The app catalog shows the 216 curated apps by default, with "Show all (needs teaching)" for the rest. Non-curated entries are labelled "Teach by browser" and Connect routes into the browser-learn flow. Before, Connect on roughly 1,280 entries created an app that could never sync.

## Fixed

- **Context-score trend was dead.** The history call shelled out to a verb the engine never registered, and the unrecognized verb fell through to launching the TUI. It calls the real `score history` subcommand now.
- **The in-app distiller raced the engine's learn daemon.** The desktop never took the daemon's `learn.lock`, and on a v4 domain it tracked progress in a different cursor file, so the two re-distilled the same records and could lose learned memory on a concurrent write. The desktop now takes the same lock with the same semantics (exclusive create, 5-minute staleness floor, local PID probe, foreign-host locks never stolen) and reads the daemon's cursor. Three tests.
- **Usage telemetry is opt-in.** A local-first, private product does not phone home by default.
- **Favicons stay local.** App icons went through Google's s2 lookup, which reported every connected app's hostname to a third party. The app's own `/favicon.ico` is fetched instead, still skipped under Bunker.
- **A null domain context crashed both chat panels** into their error boundary, on desktop too.

## Cleanup

- Removed dead exports across the front end (unused settings sections, catalog, panel and bench card components, stale helpers, a dead sidebar branch in App) and dead Rust (legacy Composio engine shims, an unconstructed ingestion type, test-only storage helpers now gated). `cargo check` is warning-free.
- One `cheapModel()` accessor replaces twenty copies of the distill-model preference read, and the last raw preference-key strings now go through the `PREF` table.
- The two `AUTONOMY_LABEL` tables (app autonomy vs loop autonomy) no longer share a name.
