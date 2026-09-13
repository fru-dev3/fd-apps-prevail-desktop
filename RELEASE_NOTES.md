# Prevail v0.3.119

Arena can draft questions again, the app tells you when a newer build exists, and Obsidian lives where file sources belong.

## Fixed

- **"Suggest with AI" failed on every domain with "no questions drafted".** Two bugs stacked. The engine only looked for a domain's context under the old file names, so a current vault with `memory/state.md`, `memory/tasks.md` and `ideal-state.md` in every domain looked empty to it. And the engine printed the real reason one line before a summary, while the app showed only the summary, so the message told you to fix something without saying what. The engine reads the current layout now, and the app reports the actual reason.
- **Obsidian was under General**, between start-on-boot and sound effects. It is a file source, so it now sits on the Workspace screen with the vault, the demo vault and backups.

## New

- **A green "available" badge in the bottom ribbon when a newer Prevail has shipped.** It checks GitHub Releases on launch and hourly, pulses so it reads from across the room, and opens the release page. It works without the signed updater feed, and never runs in Bunker Mode, which promises no network calls.

## Notes

- Engine v1.9.20 is bundled, carrying the drafting fix.
- The in-app updater feed is still not published, because the signing key on the build machine does not match the key shipped in v0.3.x. Install from the DMG; the new badge is how you will know there is one.
