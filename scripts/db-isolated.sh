#!/usr/bin/env bash
# Throwaway Postgres cluster for validating migrations and SQL suites when
# Docker (and so `supabase start` / scripts/db-scratch.sh) is not available.
# Uses the native postgres binaries (Homebrew: /usr/local/bin or
# /opt/homebrew/bin), listens on 127.0.0.1 only, keeps its data under
# $ISOLATED_DIR (default: ./.isolated-pg, git-ignored) and never touches the
# shared Supabase database.
#
#   scripts/db-isolated.sh init      # initdb + start + shims + every migration + seed
#   scripts/db-isolated.sh start|stop
#   scripts/db-isolated.sh apply FILE  # psql -f FILE (ON_ERROR_STOP)
#   scripts/db-isolated.sh psql [args]
#   scripts/db-isolated.sh destroy   # stop and delete the data directory
#
# Differences from the real stack: Postgres version is whatever is installed
# (Supabase runs 17); auth/storage/net/cron are minimal stand-ins, so only
# plain SQL behaviour is meaningful here. Realtime publications are inert.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=${ISOLATED_DIR:-$ROOT/.isolated-pg}
PORT=${ISOLATED_PORT:-54329}
DB=eventmap
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres PGGSSENCMODE=disable

# Platform stand-ins live in scripts/db-shim.sql (shared with scripts/pg17-isolated.sh).
shim() { cat "$ROOT/scripts/db-shim.sql"; }

start() {
  if pg_ctl -D "$DIR/data" status >/dev/null 2>&1; then return; fi
  pg_ctl -D "$DIR/data" -o "-p $PORT -k '' -c listen_addresses=127.0.0.1" -l "$DIR/server.log" start >/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do pg_isready -q && return; sleep 0.5; done
  echo "server did not start; see $DIR/server.log" >&2; exit 1
}

case "${1:-}" in
  init)
    mkdir -p "$DIR"
    [ -f "$DIR/data/PG_VERSION" ] || initdb -D "$DIR/data" -U postgres -A trust --no-locale -E UTF8 >"$DIR/initdb.log" 2>&1
    start
    psql -d postgres -qtc "SELECT 1 FROM pg_database WHERE datname = '$DB'" | grep -q 1 || psql -d postgres -qc "CREATE DATABASE $DB;"
    psql -d "$DB" -qc "ALTER DATABASE $DB SET search_path = public, extensions;"
    # Supabase's Postgres runs in UTC; some suites cast now() to a date and
    # compare it with a UTC-zoned fixture, so a local-zone session flakes
    # near UTC midnight (scripts/test-categories-series.sql line ~124).
    psql -d "$DB" -qc "ALTER DATABASE $DB SET timezone = 'UTC';"
    shim | psql -d "$DB" -v ON_ERROR_STOP=1 -q
    mkdir -p "$DIR/mig"
    for f in "$ROOT"/supabase/migrations/*.sql; do
      # pg_cron / pg_net are platform extensions; their objects are shimmed above.
      sed -E 's/^CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net)[^;]*;/-- (extension stubbed by db-isolated.sh)/' "$f" > "$DIR/mig/$(basename "$f")"
      psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$DIR/mig/$(basename "$f")" >/dev/null 2>"$DIR/apply.err" \
        || { echo "FAILED: $(basename "$f")"; grep -E "ERROR|LINE|DETAIL" "$DIR/apply.err" | head -5; exit 1; }
    done
    # No second shim pass here. The shim's ALTER DEFAULT PRIVILEGES (set before
    # the migrations run) already gives tables the migrations create their API
    # grants. Re-running GRANT ALL ON ALL TABLES afterwards used to undo the
    # migrations' own REVOKEs, so privilege-negative assertions (e.g.
    # scripts/test-event-insights.sql [5.2]) failed here while passing on the
    # real schema. Fixed 2026-11-14.
    psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/seed.sql" >/dev/null
    echo "isolated database '$DB' ready on 127.0.0.1:$PORT ($(ls "$ROOT"/supabase/migrations/*.sql | wc -l | tr -d ' ') migrations + seed)"
    ;;
  start) start; echo "running on 127.0.0.1:$PORT" ;;
  stop) pg_ctl -D "$DIR/data" stop -m fast >/dev/null && echo "stopped" ;;
  apply) start; psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$2" ;;
  psql) start; shift; psql -d "$DB" "$@" ;;
  destroy) pg_ctl -D "$DIR/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$DIR"; echo "removed $DIR" ;;
  *) echo "usage: $0 init | start | stop | apply FILE | psql [args] | destroy"; exit 1 ;;
esac
