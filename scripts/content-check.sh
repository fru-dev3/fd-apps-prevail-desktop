#!/usr/bin/env bash
# Content check: fail if a listed term appears in tracked files, staged
# changes or commit messages. Terms are stored base64-encoded.
#
#   bash scripts/content-check.sh              # tracked tree + last 300 commit messages (CI)
#   bash scripts/content-check.sh --staged     # staged changes (pre-commit hook)
#   bash scripts/content-check.sh --msg FILE   # one commit message (commit-msg hook)
set -euo pipefail
TERMS_B64=(
  ZnJ1XC5kZXYz
  ZnJ1XC5sb3Vpcw==
  ZnJ1XC5lc3RhdGU=
  ZnJ1bG91aXM=
  bmF0ZXNhdmluYQ==
  RnJ1IE5kZQ==
  RnJ1IExvdWlz
  T2xzZW4=
  VGhpZWxlbg==
  UmF5bW9uZCBKYW1lcw==
  Um95YWwgQ3JlZGl0
  UHJhaXJpZXZpZXc=
  SGVhbHRoUGFydG5lcnM=
  Qm9zcyBSZXZvbHV0aW9u
  R2Fycmlzb24=
  T3hmb3JkIEdyb3Vw
  V2VhbHRoZm9saW8=
  RXJhIENvbnRleHQ=
  SG91c2luZ0h1Yg==
  VGFjb21h
  L1VzZXJzL2ZydW5kZQ==
  U25vd2ZsYWtlIGluIEF1c3Rpbg==
)
pat=""
for t in "${TERMS_B64[@]}"; do
  d="$(printf '%s' "$t" | base64 -d)"
  pat="${pat:+$pat|}$d"
done
self="scripts/content-check.sh"
fail=0
report() { echo "content-check: listed term found ($1):"; echo "$2" | head -20 | sed 's/^/   /'; fail=1; }
case "${1:-}" in
  --staged)
    hits="$(git diff --cached -U0 --no-color -- . ":(exclude)$self" | grep -E '^\+' | grep -viE "^\+\+\+" | grep -iE "$pat" || true)"
    [ -z "$hits" ] || report "staged changes" "$hits" ;;
  --msg)
    hits="$(grep -iE "$pat" "$2" || true)"
    [ -z "$hits" ] || report "commit message" "$hits" ;;
  *)
    hits="$(git grep -nIiE "$pat" -- . ":(exclude)$self" ":(exclude)*.lock" ":(exclude)package-lock.json" ":(exclude)bun.lock" || true)"
    [ -z "$hits" ] || report "tracked files" "$hits"
    hits="$(git log -n 300 --format='%h %B' | grep -iE "$pat" || true)"
    [ -z "$hits" ] || report "commit messages" "$hits" ;;
esac
if [ "$fail" -ne 0 ]; then
  echo "content-check: FAILED."
  exit 1
fi
echo "content-check: clean"
