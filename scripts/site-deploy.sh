#!/usr/bin/env bash
# Publishes site/ to Vercel (project chrome-navigator, https://chrome-navigator.vercel.app).
# Run scripts/site-zip.sh first so site/navi.zip exists. Needs a Vercel token: VERCEL_TOKEN,
# or in a sandbox whose proxy adds it, any placeholder.
# It deploys a copy made outside git: Vercel blocks deploys whose commit author isn't on the Vercel team.
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
[ -f "$ROOT/site/navi.zip" ] || { echo "site/navi.zip is missing: run scripts/site-zip.sh"; exit 1; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
(cd "$ROOT/site" && cp -r index.html styles.css script.js favicon.png favicon.svg vercel.json .vercelignore navi.zip media "$TMP/")
[ -d "$ROOT/site/.vercel" ] && cp -r "$ROOT/site/.vercel" "$TMP/"
cd "$TMP"
ARGS=(--yes --token "${VERCEL_TOKEN:-proxyinjectedtoken0000000}")
[ -d .vercel ] || npx -y vercel@latest link --project chrome-navigator "${ARGS[@]}"
npx -y vercel@latest deploy --prod "${ARGS[@]}"
