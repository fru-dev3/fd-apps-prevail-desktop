# Archived 2026-08-19

**Status: archived, not deleted.** This folder was a git worktree of
prevail-desktop holding branch `feat/redesign-phase1-sidebar-work-editor`,
now pushed to github.com/fru-dev3/fd-apps-prevail-desktop as the durable
backup. After archiving, the worktree link was pruned, so git commands no
longer work here; this folder is a plain source snapshot.

## What this is

Phase 1 of a desktop UI redesign (June 2026): sidebar rework, Work/Editor
segmented pill toggle, profile switcher under the logo, Quick Capture ribbon
with typed + voice notes and live waveform.

## Why it matters beyond the redesign

The branch also preserves prevail-desktop's ORIGINAL commit history (1090
commits back to "feat: Prevail desktop v0.1.0"). The repo's main on GitHub
was later restarted with a fresh history, so this branch is the only place
the pre-reset history survives. Roughly 774 of its patches have equivalents
in the new main; about 260 do not.

## Pending / if resumed

- The redesign was never merged. Before reviving it, check how much the
  current main already re-implemented; cherry-pick from the branch rather
  than merging it (histories are unrelated, a merge would drag in the whole
  old history).
