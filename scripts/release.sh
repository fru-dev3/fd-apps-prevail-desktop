#!/usr/bin/env bash
# One-command release for the Prevail desktop app.
#
#   build (self-contained, signed) -> notarize+staple app & dmg ->
#   TEST the dmg through Gatekeeper -> publish to the website (direct
#   download, versioned save-name) -> publish/refresh the GitHub release.
#
# Apple creds come from 1Password at runtime (nothing secret is stored here).
# The version is read from tauri.conf.json and stamped into the site so the
# download URL stays stable while the saved filename carries the version.
#
# Usage:  bash scripts/release.sh            # full release
#         SKIP_BUILD=1 bash scripts/release.sh   # reuse the last build
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"               # desktop repo root
# The site repo was renamed fd-apps-prevail-site -> fd-apps-prevail-web
# (2026-08-19). Accept either so this keeps working on both checkouts.
SITE=""
for _cand in fd-apps-prevail-web fd-apps-prevail-site; do
  if [ -d "$HERE/../$_cand" ]; then SITE="$(cd "$HERE/../$_cand" && pwd)"; break; fi
done
OP_ITEM="o4smftszeclcwy54c6tofu4kny"                    # "Prevail - Apple Notarization"
REPO="fru-dev3/prevail-desktop"
ARCH="aarch64"

step() { printf '\n\033[1;33m== %s ==\033[0m\n' "$1"; }
die()  { printf '\033[1;31mrelease: %s\033[0m\n' "$1" >&2; exit 1; }

[ -n "${SITE:-}" ] || die "cannot find the site repo (fd-apps-prevail-web) next to the desktop repo"
command -v op >/dev/null || die "1Password CLI (op) not found"
command -v gh >/dev/null || die "GitHub CLI (gh) not found"

VERSION="$(python3 -c "import json;print(json.load(open('$HERE/src-tauri/tauri.conf.json'))['version'])")"
[ -n "$VERSION" ] || die "could not read version from tauri.conf.json"
TAG="v$VERSION"
DMG="$HERE/src-tauri/target/release/bundle/dmg/Prevail_${VERSION}_${ARCH}.dmg"
step "Releasing Prevail $VERSION ($TAG)"

step "Apple credentials (1Password)"
# Honor pre-set env vars (so a caller can pre-fetch creds and skip op);
# otherwise fetch from 1Password. Back-to-back `op item get` calls intermittently
# return "[ERROR] ... authorization timeout" (the desktop-app approval prompt
# doesn't surface in time, especially in a detached/background process), so each
# fetch retries until it gets a clean value rather than dying on the first blip.
opget() {
  local label="$1" val=""
  for _ in 1 2 3 4 5; do
    val="$(op item get "$OP_ITEM" --fields "label=$label" --reveal 2>/dev/null)"
    case "$val" in
      ""|\[ERROR\]*) sleep 2 ;;
      *) printf '%s' "$val"; return 0 ;;
    esac
  done
  return 1
}
export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-$(opget signing-identity)}"
export APPLE_ID="${APPLE_ID:-$(opget apple-id)}"
export APPLE_PASSWORD="${APPLE_PASSWORD:-$(opget app-specific-password)}"
export APPLE_TEAM_ID="${APPLE_TEAM_ID:-$(opget team-id)}"
[ -n "$APPLE_SIGNING_IDENTITY" ] && [ -n "$APPLE_PASSWORD" ] || die "missing Apple creds in 1Password (op authorization may have timed out)"
echo "signing as: $APPLE_SIGNING_IDENTITY"

# Updater signing key (for the in-app auto-updater feed). The build produces
# Prevail.app.tar.gz + .sig when createUpdaterArtifacts is on; these env vars
# let `tauri build` sign them. Key lives at ~/.prevail/updater.key.
UPDATER_KEY="$HOME/.prevail/updater.key"
if [ -f "$UPDATER_KEY" ]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$UPDATER_KEY")"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
  echo "updater artifacts will be signed"
else
  echo "WARN: $UPDATER_KEY missing — auto-update artifacts will be unsigned/skipped"
fi

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  step "Build (Developer ID sign + bundle DMG; self-contained engine sidecar)"
  # NOTE: tauri's INLINE notarization (during build) is unreliable — its
  # status-poll intermittently hits Apple notary 401s and aborts with an empty
  # error, even though the submission reaches Apple. So we deliberately DON'T
  # give tauri the notary creds (APPLE_ID/APPLE_PASSWORD): it only signs +
  # bundles the DMG here, and we notarize the DMG ourselves below with
  # `notarytool submit --wait`, which polls resiliently. Stapling the DMG is
  # sufficient for Gatekeeper (verified: the contained app reports
  # "source=Notarized Developer ID").
  ( cd "$HERE" && env -u APPLE_ID -u APPLE_PASSWORD npm run tauri build -- --bundles app dmg )
else
  step "Skipping build (SKIP_BUILD=1)"
fi
[ -f "$DMG" ] || die "DMG not found at $DMG"

step "Notarize + staple the DMG"
# Already stapled (e.g. resuming after a later step failed)? Nothing to do:
# re-notarizing a ticketed DMG just burns ten minutes for the same answer.
if xcrun stapler validate "$DMG" >/dev/null 2>&1; then
  echo "already notarized + stapled, skipping"
else
  # NOTE: do NOT use `notarytool submit --wait`. Its wait loop crashes with a
  # Bus error (stack overflow in the NIO networking thread while formatting a
  # status string) — reproduced twice on v0.3.115, submission never even
  # started. Plain `submit` uploads fine, so we poll `info` ourselves. That is
  # also more debuggable: the submission id is printed and survives a crash.
  SUB_JSON="$(xcrun notarytool submit "$DMG" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --output-format json)"
  SUB_ID="$(python3 -c 'import sys,json;print(json.loads(sys.stdin.read()).get("id",""))' <<<"$SUB_JSON")"
  [ -n "$SUB_ID" ] || die "notarytool did not return a submission id: $SUB_JSON"
  echo "submission: $SUB_ID"
  NOTARY_STATUS=""
  for _ in $(seq 1 80); do   # 80 x 15s = 20 minutes, the old --wait timeout
    sleep 15
    INFO="$(xcrun notarytool info "$SUB_ID" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --output-format json 2>/dev/null || true)"
    NOTARY_STATUS="$(python3 -c 'import sys,json
try: print(json.loads(sys.stdin.read()).get("status",""))
except Exception: print("")' <<<"$INFO")"
    echo "  status: ${NOTARY_STATUS:-unknown}"
    case "$NOTARY_STATUS" in Accepted|Invalid|Rejected) break;; esac
  done
  if [ "$NOTARY_STATUS" != "Accepted" ]; then
    echo "notarization did not pass ($NOTARY_STATUS). Apple's log:"
    xcrun notarytool log "$SUB_ID" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" 2>&1 | head -40 || true
    die "notarization failed for $SUB_ID"
  fi
  xcrun stapler staple "$DMG"
  xcrun stapler validate "$DMG"
fi

step "GATE: Gatekeeper test on a quarantined copy (must be Notarized Developer ID)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
cp "$DMG" "$WORK/dl.dmg"
xattr -w com.apple.quarantine "0181;00000000;release-test;$(uuidgen)" "$WORK/dl.dmg"
MNT="$(hdiutil attach "$WORK/dl.dmg" -nobrowse -readonly | grep -o '/Volumes/.*' | head -1)"
ASSESS="$(spctl -a -vvv "$MNT/Prevail.app" 2>&1 || true)"
ENGINE="$("$MNT/Prevail.app/Contents/MacOS/prevail" --version 2>&1 | head -1 || true)"
hdiutil detach "$MNT" >/dev/null 2>&1 || true
echo "$ASSESS"
echo "bundled engine: $ENGINE"
echo "$ASSESS" | grep -q "source=Notarized Developer ID" || die "Gatekeeper REJECTED the build — NOT publishing"
echo "$ENGINE" | grep -qi "prevail" || die "bundled engine did not run — NOT publishing"
echo "Gatekeeper + self-contained engine: PASS"

step "Stamp the website version (DMG is served from GitHub Releases, NOT here)"
# IMPORTANT: do NOT copy the DMG into the site. Serving ~32 MB binaries from
# Netlify burns the free-tier bandwidth quota and takes the whole site down
# (503 usage_exceeded). The site links to the GitHub release asset instead
# (unlimited bandwidth); here we only stamp the version string.
# Surgically stamp ONLY the APP_VERSION constant — the site's version.ts also
# exports useLiveVersion()/useLatestVersion() that the app imports, so we must
# NOT clobber the whole file (that broke the site build). The DMG is served from
# GitHub Releases; this constant is just the first-paint fallback.
# GUARD: only touch the site repo when its tree is clean apart from the two
# files this step owns. Otherwise we would sweep somebody else's in-progress
# work into a release commit (or push a half-finished refactor to Netlify).
# Skipping is safe: the site reads the current version live from the GitHub
# Releases API (useLiveVersion), so APP_VERSION is only a first-paint fallback.
SITE_DIRTY="$(cd "$SITE" && git status --porcelain | grep -v -e 'src/version\.ts' -e 'public/llms\.txt' || true)"
if [ -n "$SITE_DIRTY" ]; then
  echo "WARN: the site repo has unrelated uncommitted changes — skipping the version stamp and push."
  echo "      (prevail.sh fetches the latest version live, so the release is unaffected.)"
  echo "$SITE_DIRTY" | sed 's/^/        /'
else
if [ -f "$SITE/src/version.ts" ]; then
  perl -i -pe 's/(export const APP_VERSION = ")[0-9]+\.[0-9]+\.[0-9]+(")/${1}'"$VERSION"'${2}/' "$SITE/src/version.ts"
else
  printf 'export const APP_VERSION = "%s";\n' "$VERSION" > "$SITE/src/version.ts"
fi
# Also keep the version lines in llms.txt current (read by AI crawlers). Stamp
# the desktop version from this repo, and the CLI version from the sibling
# prevail-cli package.json (the CLI ships via its own GH Actions release, which
# doesn't touch the site — so without this its line drifts). Both rewrites only
# replace the number, and run only if the file / sibling exist.
LLMS="$SITE/public/llms.txt"
if [ -f "$LLMS" ]; then
  perl -i -pe "s/(Current desktop version )[0-9]+\.[0-9]+\.[0-9]+/\${1}$VERSION/" "$LLMS"
  CLI_PKG="$HERE/../fd-apps-prevail-cli/package.json"
  if [ -f "$CLI_PKG" ]; then
    CLI_VERSION="$(python3 -c "import json;print(json.load(open('$CLI_PKG'))['version'])" 2>/dev/null || true)"
    [ -n "$CLI_VERSION" ] && perl -i -pe "s/(Current CLI version )[0-9]+\.[0-9]+\.[0-9]+/\${1}$CLI_VERSION/" "$LLMS"
  fi
fi
( cd "$SITE" && npm run build >/dev/null )   # sanity-build before pushing
( cd "$SITE" && git add src/version.ts public/llms.txt \
  && git commit -q -m "release: Prevail $VERSION (version stamp; DMG on GitHub Releases)" \
  && git push )
echo "site pushed — Netlify will deploy prevail.sh"
fi

step "Build the auto-update feed (latest.json)"
MACOS_DIR="$HERE/src-tauri/target/release/bundle/macos"
TARBALL="$MACOS_DIR/Prevail.app.tar.gz"
SIGFILE="$TARBALL.sig"
UPDATE_ASSETS=()
if [ -f "$TARBALL" ] && [ -f "$SIGFILE" ]; then
  SIG="$(cat "$SIGFILE")"
  PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  LATEST_JSON="$WORK/latest.json"
  python3 - "$VERSION" "$SIG" "$PUB_DATE" "$REPO" "$TAG" > "$LATEST_JSON" <<'PY'
import json, sys
version, sig, pub_date, repo, tag = sys.argv[1:6]
url = f"https://github.com/{repo}/releases/download/{tag}/Prevail.app.tar.gz"
print(json.dumps({
    "version": version,
    "notes": f"Prevail {version}",
    "pub_date": pub_date,
    "platforms": {"darwin-aarch64": {"signature": sig, "url": url}},
}, indent=2))
PY
  UPDATE_ASSETS=("$TARBALL" "$SIGFILE" "$LATEST_JSON")
  echo "latest.json built for darwin-aarch64"
else
  echo "WARN: updater artifacts not found ($TARBALL) — auto-update feed skipped this release"
fi

step "Publish GitHub release $TAG"
# Also publish a STABLE-named copy so the site can link to a fixed URL
# (releases/latest/download/Prevail-mac-arm64.dmg) across every version.
STABLE_DMG="$WORK/Prevail-mac-arm64.dmg"
cp "$DMG" "$STABLE_DMG"
# Prefer hand-written notes (RELEASE_NOTES.md at the repo root) over the
# commit-generated ones when present, so the release reads like a changelog.
if [ -f "$HERE/RELEASE_NOTES.md" ]; then
  NOTES_ARGS=(--notes-file "$HERE/RELEASE_NOTES.md")
else
  NOTES_ARGS=(--generate-notes)
fi
# Create (or refresh) the release WITHOUT assets, then upload each asset on its
# own with retries. Uploading several 30+ MB files in one gh call has repeatedly
# died mid-way with "remote error: tls: bad record MAC", leaving no release at
# all; one-at-a-time with retries survives the transient.
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release edit "$TAG" --repo "$REPO" "${NOTES_ARGS[@]}" >/dev/null
else
  gh release create "$TAG" --repo "$REPO" --target main --title "$TAG" "${NOTES_ARGS[@]}"
fi
for asset in "$DMG" "$STABLE_DMG" ${UPDATE_ASSETS[@]+"${UPDATE_ASSETS[@]}"}; do
  ok=0
  for attempt in 1 2 3 4 5; do
    if gh release upload "$TAG" "$asset" --repo "$REPO" --clobber; then ok=1; break; fi
    echo "upload of $(basename "$asset") failed (attempt $attempt), retrying..."; sleep 6
  done
  [ "$ok" = 1 ] || die "could not upload $(basename "$asset") after 5 attempts"
done

step "Done — Prevail $VERSION released"
echo "  website:  https://prevail.sh/Prevail-mac-arm64.dmg  (saves as Prevail-$VERSION-arm64.dmg)"
echo "  release:  https://github.com/$REPO/releases/tag/$TAG"
