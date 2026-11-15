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
# Since 2026-11-14 the shared local cluster is off limits for testing: a scratch
# *database* inside it is not isolation, because a crashed backend restarts
# every connection in the cluster (it happened four times; see docs/ISSUES.md
# "Ground rules"). Use scripts/pg17-isolated.sh instead. This script stays for
# the owner, who must opt in explicitly.
if [[ "${ALLOW_SHARED_CLUSTER:-}" != "1" ]]; then
  cat >&2 <<'MSG'
db-scratch.sh: refusing to touch the shared local cluster.
  Scratch copies live inside the same Postgres as the shared database, so a
  backend crash during a suite takes every session down with it.
  Use the isolated container instead:
      scripts/pg17-isolated.sh init && scripts/pg17-isolated.sh suites
  Owner override (deliberately explicit): ALLOW_SHARED_CLUSTER=1 scripts/db-scratch.sh ...
MSG
  exit 2
fi
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
