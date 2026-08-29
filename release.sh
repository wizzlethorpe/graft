#!/usr/bin/env bash
# Cut a release: bump, test, tag, publish to GitHub and the Foundry registry.
#
#   ./release.sh 1.0.0
#   ./release.sh 1.0.0 --dry-run     # build and report, publish nothing
#
# Needs jq, gh, zip on PATH, gh authenticated, and a clean working tree.
# FOUNDRY_RELEASE_TOKEN in .env publishes to the package registry; without it
# that step is skipped and everything else still runs.
set -euo pipefail

GITHUB_REPO="wizzlethorpe/graft"
MODULE_ID="graft"

NEW_VERSION=""
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --*) echo "Unknown flag: $arg" >&2; exit 1 ;;
    *) [ -n "$NEW_VERSION" ] && { echo "Version given twice" >&2; exit 1; }; NEW_VERSION="$arg" ;;
  esac
done
[ -n "$NEW_VERSION" ] || { echo "Usage: ./release.sh <X.Y.Z> [--dry-run]" >&2; exit 1; }
[[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Version must be X.Y.Z" >&2; exit 1; }

cd "$(dirname "${BASH_SOURCE[0]}")"
for cmd in jq gh zip node; do command -v "$cmd" >/dev/null || { echo "Error: $cmd required" >&2; exit 1; }; done
[ -z "$(git status --porcelain)" ] || { echo "Error: working tree is dirty" >&2; exit 1; }

TAG="v$NEW_VERSION"
git rev-parse "$TAG" >/dev/null 2>&1 && { echo "Error: $TAG already exists" >&2; exit 1; }

echo "==> Tests"
node --test 'test/*.test.mjs' >/dev/null || { echo "Error: tests failed" >&2; exit 1; }

echo "==> Version $NEW_VERSION"
jq --arg v "$NEW_VERSION" '.version = $v' module.json > module.json.tmp && mv module.json.tmp module.json

# Versioned URLs in the *released* manifest. Foundry's registry caches manifest
# responses, so a /releases/latest/ URL leaves stale versions lingering in the
# in-app browser. A versioned URL is immutable, so every release is a fresh one.
# The repo's module.json is put back to /latest/ at the end.
jq --arg v "$NEW_VERSION" --arg repo "$GITHUB_REPO" \
   '.download = "https://github.com/" + $repo + "/releases/download/v" + $v + "/" + "graft.zip" |
    .manifest = "https://github.com/" + $repo + "/releases/download/v" + $v + "/module.json"' \
   module.json > module.json.tmp && mv module.json.tmp module.json

BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT
mkdir -p "$BUILD/$MODULE_ID"
# Deliberately not examples/ or test/: a release is what Foundry loads.
cp -r module.json scripts lang LICENSE README.md "$BUILD/$MODULE_ID/"
(cd "$BUILD" && zip -qr graft.zip "$MODULE_ID")
cp module.json "$BUILD/module.json"
echo "==> Built $(du -h "$BUILD/graft.zip" | cut -f1) package"

COMPAT_MIN=$(jq -r '.compatibility.minimum' module.json)
COMPAT_VER=$(jq -r '.compatibility.verified' module.json)

if [ "$DRY_RUN" = 1 ]; then
  echo "==> Dry run: nothing published"
  jq '.download, .manifest' module.json
  git checkout module.json
  exit 0
fi

git add module.json && git commit -qm "Release $NEW_VERSION"
git tag -a "$TAG" -m "Release $NEW_VERSION"
git push -q origin main "$TAG"

echo "==> GitHub release"
gh release create "$TAG" "$BUILD/graft.zip" "$BUILD/module.json" \
  --repo "$GITHUB_REPO" --title "$TAG" --generate-notes

# Read the token into a variable and use it from there; never echo it.
FOUNDRY_TOKEN=""
[ -f .env ] && FOUNDRY_TOKEN=$(grep -E '^FOUNDRY_RELEASE_TOKEN=' .env | cut -d= -f2- | tr -d '"'"'"' ' || true)
if [ -z "$FOUNDRY_TOKEN" ]; then
  echo "==> No FOUNDRY_RELEASE_TOKEN in .env; skipping the package registry"
else
  echo "==> Foundry package registry"
  RESPONSE=$(curl -sS -X POST "https://foundryvtt.com/_api/packages/release_version/" \
    -H "Content-Type: application/json" \
    -H "Authorization: $FOUNDRY_TOKEN" \
    -d "$(jq -n --arg id "$MODULE_ID" --arg v "$NEW_VERSION" --arg repo "$GITHUB_REPO" \
              --arg tag "$TAG" --arg min "$COMPAT_MIN" --arg ver "$COMPAT_VER" \
      '{id: $id, "dry-run": false, release: {
          version: $v,
          manifest: ("https://github.com/" + $repo + "/releases/download/" + $tag + "/module.json"),
          notes: ("https://github.com/" + $repo + "/releases/tag/" + $tag),
          compatibility: { minimum: $min, verified: $ver }
        }}')")
  echo "$RESPONSE" | jq -e '.status == "success"' >/dev/null \
    && echo "    published" \
    || { echo "    registry rejected it:"; echo "$RESPONSE" | jq -r '.errors // .' ; }
fi

# Back to /latest/ in the repo, so what is committed is never a stale pin.
jq --arg repo "$GITHUB_REPO" \
   '.download = "https://github.com/" + $repo + "/releases/latest/download/graft.zip" |
    .manifest = "https://github.com/" + $repo + "/releases/latest/download/module.json"' \
   module.json > module.json.tmp && mv module.json.tmp module.json
git add module.json && git commit -qm "Back to latest/ URLs after $NEW_VERSION"
git push -q origin main

echo "==> $TAG done"
