#!/usr/bin/env bash
# Isolated end-to-end environment for the web build that never touches the
# shared local database:
#
#   scratch DB copy  <- private PostgREST (:3999) <- proxy (:54399) <- web export
#
# Auth, storage, and realtime still go to the shared gateway (:54321) through
# the proxy; only /rest/v1 is redirected to the scratch copy. Sign-ins therefore
# use the real local GoTrue but every table read/write lands in the scratch DB.
#
#   scripts/e2e-isolated-env.sh up      # scratch + migration + postgrest + proxy
#   scripts/e2e-isolated-env.sh build   # web export pointed at the proxy
#   scripts/e2e-isolated-env.sh run     # drive the profile flow, screenshots in $OUT
#   scripts/e2e-isolated-env.sh down    # stop everything, drop the scratch DB
#
# Env overrides: SCRATCH_DB (default eventmap_scratch_$USER), REST_PORT (3999),
# PROXY_PORT (54399), EXPORT_DIR (/tmp/eventmap-web-$USER), OUT (/tmp/eventmap-e2e-$USER),
# SEED_SQL (optional file applied after the migration, e.g. to reset a demo user).
set -euo pipefail
cd "$(dirname "$0")/.."

# Postgres folds unquoted identifiers to lower case, so keep the name lower case.
SCRATCH_DB=$(echo "${SCRATCH_DB:-eventmap_scratch_${USER}}" | tr 'A-Z' 'a-z')
REST_PORT=${REST_PORT:-3999}
PROXY_PORT=${PROXY_PORT:-54399}
EXPORT_DIR=${EXPORT_DIR:-/tmp/eventmap-web-${USER}}
OUT=${OUT:-/tmp/eventmap-e2e-${USER}}
CONTAINER=${SUPABASE_DB_CONTAINER:-supabase_db_eventmap-local}
REST_NAME="eventmap_rest_${SCRATCH_DB}"
NETWORK=${SUPABASE_NETWORK:-supabase_network_eventmap-local}
MIGRATION=${MIGRATION:-supabase/migrations/20261029110000_profile_attendance_history.sql}
PROXY_PID_FILE="/tmp/eventmap-proxy-${PROXY_PORT}.pid"

case "${1:-}" in
  up)
    export SCRATCH_DB
    scripts/db-scratch.sh refresh
    scripts/db-scratch.sh apply "$MIGRATION"
    scripts/db-scratch.sh apply "${SEED_SQL:-scripts/e2e-seed-demo-user.sql}"
    # Reuse the running stack's JWT config (a JWKS JSON on current CLI versions).
    JWKS=$(docker inspect supabase_rest_eventmap-local --format '{{range .Config.Env}}{{.}}{{"\n"}}{{end}}' | grep '^PGRST_JWT_SECRET=' | cut -d= -f2-)
    IMAGE=$(docker inspect supabase_rest_eventmap-local --format '{{.Config.Image}}')
    docker rm -f "$REST_NAME" >/dev/null 2>&1 || true
    docker run -d --name "$REST_NAME" --network "$NETWORK" -p "127.0.0.1:${REST_PORT}:3000" \
      -e PGRST_DB_URI="postgresql://authenticator:postgres@${CONTAINER}:5432/${SCRATCH_DB}" \
      -e PGRST_DB_SCHEMAS=public,graphql_public -e PGRST_DB_EXTRA_SEARCH_PATH=public,extensions \
      -e PGRST_DB_MAX_ROWS=1000 -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$JWKS" "$IMAGE" >/dev/null
    if [[ -f "$PROXY_PID_FILE" ]] && kill -0 "$(cat "$PROXY_PID_FILE")" 2>/dev/null; then kill "$(cat "$PROXY_PID_FILE")"; fi
    PORT="$PROXY_PORT" REST="http://127.0.0.1:${REST_PORT}" nohup node scripts/e2e-isolated-api.mjs >"/tmp/eventmap-proxy-${PROXY_PORT}.log" 2>&1 &
    echo $! >"$PROXY_PID_FILE"
    sleep 2
    curl -fs -o /dev/null "http://127.0.0.1:${PROXY_PORT}/rest/v1/" && echo "isolated env up: proxy :${PROXY_PORT}, rest :${REST_PORT}, db ${SCRATCH_DB}"
    ;;
  build)
    rm -rf "$EXPORT_DIR"
    set -a; source .env.local; set +a
    EXPO_PUBLIC_SUPABASE_URL="http://127.0.0.1:${PROXY_PORT}" EXPO_NO_DOTENV=1 EXPO_NO_TELEMETRY=1 \
      npx expo export --platform web --clear --output-dir "$EXPORT_DIR" | tail -2
    grep -l "127.0.0.1:${PROXY_PORT}" "$EXPORT_DIR"/_expo/static/js/web/*.js >/dev/null && echo "export targets the proxy"
    ;;
  run)
    rm -rf "$OUT"
    SCRATCH_DB="$SCRATCH_DB" node scripts/e2e-profile-flow.mjs "$EXPORT_DIR" "$OUT"
    ;;
  down)
    if [[ -f "$PROXY_PID_FILE" ]]; then kill "$(cat "$PROXY_PID_FILE")" 2>/dev/null || true; rm -f "$PROXY_PID_FILE"; fi
    docker rm -f "$REST_NAME" >/dev/null 2>&1 || true
    docker exec -i -e PGPASSWORD=postgres "$CONTAINER" psql -U postgres -d postgres -qc "DROP DATABASE IF EXISTS ${SCRATCH_DB};"
    echo "isolated env down"
    ;;
  *)
    echo "usage: $0 up | build | run | down"; exit 1;;
esac
