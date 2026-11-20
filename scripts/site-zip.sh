#!/usr/bin/env bash
# Builds site/navi.zip, the download on Navi's website, from a git ref.
# Default: origin/main, the stable version. Usage: scripts/site-zip.sh [ref]
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
git -C "$ROOT" fetch -q origin main
REF=${1:-origin/main}
TMP=$(mktemp -d)
trap 'git -C "$ROOT" worktree remove --force "$TMP/src" 2>/dev/null || true; rm -rf "$TMP"' EXIT
git -C "$ROOT" worktree add -q --detach "$TMP/src" "$REF"
ln -s "$ROOT/node_modules" "$TMP/src/node_modules"
(cd "$TMP/src" && npm run build > "$TMP/build.log" 2>&1) || { cat "$TMP/build.log"; exit 1; }
cp -r "$TMP/src/dist" "$TMP/navi"
find "$TMP/navi" -name '*.map' -delete
rm -f "$ROOT/site/navi.zip"
(cd "$TMP" && zip -qr -9 "$ROOT/site/navi.zip" navi)
echo "site/navi.zip from $(git -C "$ROOT" rev-parse --short "$REF"): $(du -h "$ROOT/site/navi.zip" | cut -f1)"
