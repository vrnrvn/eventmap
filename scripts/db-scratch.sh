#!/usr/bin/env bash
# Creates/refreshes an isolated scratch copy of the local Supabase database
# (schema + data) inside the same Postgres cluster, so SQL changes can be
# applied and exercised without touching the shared `postgres` database that
# other dev sessions (and the local API/realtime services) are using.
#
#   scripts/db-scratch.sh refresh   # (re)create eventmap_scratch from postgres
#   scripts/db-scratch.sh apply FILE  # run a SQL file against the scratch DB
#   scripts/db-scratch.sh psql [args] # open psql on the scratch DB
set -euo pipefail
CONTAINER=${SUPABASE_DB_CONTAINER:-supabase_db_eventmap-local}
if [[ "${SCRATCH_DB:-eventmap_scratch}" == "postgres" ]]; then echo "refusing to use the shared postgres database as scratch" >&2; exit 1; fi
SCRATCH=${SCRATCH_DB:-eventmap_scratch}
PG="docker exec -i -e PGPASSWORD=postgres $CONTAINER"
case "${1:-}" in
  refresh)
    $PG psql -U postgres -d postgres -qc "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$SCRATCH';" >/dev/null
    $PG psql -U postgres -d postgres -qc "DROP DATABASE IF EXISTS $SCRATCH;"
    $PG psql -U postgres -d postgres -qc "CREATE DATABASE $SCRATCH;"
    $PG bash -c "pg_dump -U postgres -d postgres --no-owner -N _analytics -N _realtime -N realtime -N pgsodium -N pgsodium_masks -N vault -N supabase_functions 2>/dev/null | psql -U postgres -d $SCRATCH -q -v ON_ERROR_STOP=0" 2>&1 | grep -E "^ERROR" | grep -vE "already exists|must be owner|permission denied|does not exist|supabase_admin" | head -20 || true
    echo "scratch database '$SCRATCH' refreshed from 'postgres'"
    ;;
  apply)
    $PG psql -U postgres -d "$SCRATCH" -v ON_ERROR_STOP=1 < "$2"
    ;;
  psql)
    shift; $PG psql -U postgres -d "$SCRATCH" "$@"
    ;;
  *)
    echo "usage: $0 refresh | apply FILE | psql [args]"; exit 1;;
esac
