#!/usr/bin/env bash
# Browser E2E against a FAKE backend — never touches any database.
#
# Builds the web app pointed at a dead address (127.0.0.1:9), serves it, and
# drives headless Chrome over CDP. Every request to that address is answered
# from an in-memory fake (fakebackend.mjs); nothing can reach Supabase.
#
#   scripts/fake-backend-e2e/run.sh            # all suites
#   scripts/fake-backend-e2e/run.sh suiteB B3  # one suite, optional scenario filter
set -euo pipefail
cd "$(dirname "$0")/../.."
HERE=scripts/fake-backend-e2e
OUT=$(mktemp -d /tmp/eventmap-fake-e2e.XXXX)
trap 'rm -rf "$OUT"' EXIT

# This shell may export EXPO_NO_DOTENV=1; load the anon key etc. explicitly,
# then force the dead backend URL.
set -a; [ -f .env.local ] && source .env.local; set +a
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 npx expo export --platform web --clear --output-dir "$OUT/dist" >/dev/null

# Safety: the bundle must target the dead address and nothing else local/hosted.
BUNDLE=$(ls "$OUT"/dist/_expo/static/js/web/entry-*.js)
grep -q '127.0.0.1:9' "$BUNDLE" || { echo "bundle does not target the fake backend; aborting" >&2; exit 1; }
if grep -qE '127\.0\.0\.1:54321|localhost:54321|https://[a-z0-9-]+\.supabase\.co' "$BUNDLE"; then
  echo "bundle references a real backend; aborting" >&2; exit 1
fi

suites=${1:-"suiteA suiteB suiteC suiteD suiteF"}
for s in $suites; do node "$HERE/$s.mjs" "$PWD" "$OUT/dist" ${2:-}; done
