# Prevail v0.3.111

Every model picker now offers the September 2026 lineup, and the cost figures behind them are current again.

## New

- **Claude Fable 5.1.** The `fable` alias joins the Claude runtime as the frontier tier above Opus, resolving to Fable 5.1. Fable 5 stays as a pinned older version.
- **GPT-6 Astra.** Codex adds Astra (GA 2026-09-03) as its flagship, with a high-reasoning variant, alongside the existing GPT-5.6 tiers. Sol remains the default.
- **Gemini 3.8, 3.7 and 3.6 Flash.** Antigravity picks up the three newest Flash generations. Gemini 3.5 Flash is gone from the `agy` catalog and has been removed.
- **Refreshed hosted catalogs.** The OpenRouter picks and the direct-provider lists (Anthropic, OpenAI, Google, xAI, Kimi) carry current ids, including Grok 4.6, Kimi K3, DeepSeek V4 Pro, Qwen3.8 Max and GLM 5.3. The Google key path had still been on Gemini 2.5.

Every id was checked against the runtime's own catalog and then smoke-tested through the real CLI, including the reasoning-effort suffixes.

## Fixed

- **Cost estimates ran about three times high for Opus.** Both price tables still used the $15/$75 Opus 4.x rate; Opus 5 is $5/$25. Fable and GPT-6 were not priced at all. The GPT-5.6 tier rates have also come down since July, and Gemini 3.x Flash is priced well above the old 2.x Flash rate the table assumed.
- **Model names no longer shout.** The label formatter upper-cased any word of four letters or fewer, so `gpt-5.6-sol` rendered as "GPT 5.6 SOL". It now distinguishes real acronyms from codenames: GPT-5.6 Sol, GPT-6 Astra.
- **A stale saved model no longer changes vendor.** Healing a retired pick sent every model id to a Codex model, so a domain pinned to an old Claude or Gemini model silently moved to OpenAI. Each dead pick now heals to its own vendor's current default.
- **Release script.** It looked for the website repo under its pre-rename name and would exit immediately, and it now skips the version stamp when the site repo holds unrelated uncommitted work instead of sweeping it into a release commit.
