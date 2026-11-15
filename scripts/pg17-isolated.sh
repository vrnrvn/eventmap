#!/usr/bin/env bash
# Throwaway Postgres 17 built from the SAME image the local Supabase stack runs
# (public.ecr.aws/supabase/postgres), for validating migrations and the
# scripts/test-*.sql suites on the real engine without touching the shared
# database — or even the shared cluster. A crashed backend restarts every
# connection in its cluster, so a scratch *database* inside the shared cluster
# is not isolation; a separate container is.
#
# Complements scripts/db-isolated.sh, which uses whatever native Postgres is
# installed (14 here, vs. 17 in the stack) and so cannot reproduce PG17-only
# behaviour — e.g. the supautils segfault in docs/ISSUES.md Ground rules.
#
#   scripts/pg17-isolated.sh init          # container + every migration + seed
#   scripts/pg17-isolated.sh apply FILE    # psql -f FILE (ON_ERROR_STOP)
#   scripts/pg17-isolated.sh suites        # run every scripts/test-*.sql, one-line summary
#   scripts/pg17-isolated.sh psql [args]   # interactive psql on the database
#   scripts/pg17-isolated.sh destroy       # remove the container (data goes with it)
#
# Isolation details:
#   * No host port is published unless PG17_PORT is set, so there is nothing to
#     collide with other sessions' stacks (3999, 3997, 54397 ... are taken).
#   * The container name defaults to the worktree directory name, so two
#     worktrees never share one; set PG17_NAME to override.
#   * The image defaults to whatever the running local stack uses, falling back
#     to a pinned tag; set PG17_IMAGE to override.
#   * Platform objects (auth, storage, cron, net, API roles and grants) are
#     stood in by scripts/db-shim.sql, applied ONCE before the migrations. The
#     shim's ALTER DEFAULT PRIVILEGES covers tables the migrations create, so
#     migration REVOKEs are preserved and privilege-negative assertions mean
#     what they say.
#   * pg_cron / pg_net CREATE EXTENSION lines are stubbed exactly as
#     db-isolated.sh does; only plain SQL behaviour is meaningful here.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
NAME=${PG17_NAME:-eventmap_pg17_$(basename "$ROOT" | tr -c 'a-zA-Z0-9_\n' '_')}
DB=eventmap
FALLBACK_IMAGE=public.ecr.aws/supabase/postgres:17.6.1.106

image() {
  if [ -n "${PG17_IMAGE:-}" ]; then echo "$PG17_IMAGE"; return; fi
  docker inspect supabase_db_eventmap-local --format '{{.Config.Image}}' 2>/dev/null || echo "$FALLBACK_IMAGE"
}
pg() { docker exec -i -e PGPASSWORD=postgres "$NAME" psql -U postgres -d "$DB" "$@"; }
wait_ready() {
  # The image initialises and then restarts itself once; a single pg_isready
  # can land in the gap, so require two consecutive successes a few seconds apart.
  local i
  for i in $(seq 1 90); do
    if docker exec "$NAME" pg_isready -U postgres -q 2>/dev/null; then
      sleep 4
      docker exec "$NAME" pg_isready -U postgres -q 2>/dev/null && return 0
    fi
    sleep 1
  done
  echo "container '$NAME' did not become ready" >&2; exit 1
}

case "${1:-}" in
  init)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    # macOS ships bash 3.2, where "${arr[@]}" on an empty array trips set -u.
    publish=(); [ -n "${PG17_PORT:-}" ] && publish=(-p "127.0.0.1:${PG17_PORT}:5432")
    docker run -d --name "$NAME" ${publish[@]+"${publish[@]}"} -e POSTGRES_PASSWORD=postgres "$(image)" >/dev/null
    wait_ready
    tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
    mkdir -p "$tmp/mig"
    for f in "$ROOT"/supabase/migrations/*.sql; do
      sed -E 's/^CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net)[^;]*;/-- (extension stubbed by pg17-isolated.sh)/' "$f" > "$tmp/mig/$(basename "$f")"
    done
    docker exec "$NAME" mkdir -p /tmp/iso/mig
    docker cp "$ROOT/scripts/db-shim.sql" "$NAME:/tmp/iso/shim.sql" >/dev/null
    docker cp "$tmp/mig/." "$NAME:/tmp/iso/mig/" >/dev/null
    docker cp "$ROOT/supabase/seed.sql" "$NAME:/tmp/iso/seed.sql" >/dev/null
    docker exec -e PGPASSWORD=postgres "$NAME" bash -c '
      set -e
      psql -U postgres -d postgres -qc "CREATE DATABASE eventmap;"
      psql -U postgres -d eventmap -qc "ALTER DATABASE eventmap SET search_path = public, extensions;"
      psql -U postgres -d eventmap -qc "ALTER DATABASE eventmap SET timezone = '"'"'UTC'"'"';"
      psql -U postgres -d eventmap -v ON_ERROR_STOP=1 -q -f /tmp/iso/shim.sql 2>/dev/null
      for f in /tmp/iso/mig/*.sql; do
        psql -U postgres -d eventmap -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>/tmp/iso/err \
          || { echo "FAILED: $(basename "$f")"; grep -E "ERROR|LINE|DETAIL" /tmp/iso/err | head -5; exit 1; }
      done
      psql -U postgres -d eventmap -v ON_ERROR_STOP=1 -q -f /tmp/iso/seed.sql >/dev/null'
    n=$(ls "$ROOT"/supabase/migrations/*.sql | wc -l | tr -d ' ')
    echo "isolated PG17 '$NAME' ready: $n migrations + seed ($(image))${PG17_PORT:+, published on 127.0.0.1:$PG17_PORT}"
    ;;
  apply)
    [ -f "${2:-}" ] || { echo "usage: $0 apply FILE" >&2; exit 1; }
    docker cp "$2" "$NAME:/tmp/iso/apply.sql" >/dev/null
    pg -v ON_ERROR_STOP=1 -f /tmp/iso/apply.sql
    ;;
  suites)
    # Every suite is rollback-only, so order does not matter and the database
    # is unchanged afterwards. A lost connection means the backend crashed
    # (see the segfault rule in docs/ISSUES.md) — reported separately from a
    # failed assertion.
    pass=0; fail=0; crash=0
    for f in "$ROOT"/scripts/test-*.sql; do
      n=$(basename "$f" .sql)
      # rm first: docker cp refuses to overwrite a target that is not a regular file.
      docker exec "$NAME" rm -f /tmp/iso/suite.sql
      docker cp "$f" "$NAME:/tmp/iso/suite.sql" >/dev/null
      out=$(pg -v ON_ERROR_STOP=1 -f /tmp/iso/suite.sql 2>&1 || true)
      if grep -q "connection to server was lost" <<<"$out"; then
        echo "CRASH  $n"; crash=$((crash+1)); wait_ready
      elif grep -qE "^psql:[^ ]*: ERROR: |^psql: error: |^ERROR: " <<<"$out"; then
        # Catches an assertion failure (psql:FILE:LINE: ERROR: ...) and psql
        # itself failing (psql: error: could not open ...), which must never
        # read as a pass. Anchored on the ": ERROR: " / "error: " token so a
        # NOTICE whose text merely contains the word (e.g. "without erroring")
        # does not count.
        echo "FAIL   $n :: $(grep -oE '(ERROR|error): .*' <<<"$out" | head -1 | cut -c1-90)"; fail=$((fail+1))
      else
        echo "PASS   $n"; pass=$((pass+1))
      fi
    done
    echo "suites: $pass passed, $fail failed, $crash crashed"
    [ "$fail" -eq 0 ] && [ "$crash" -eq 0 ]
    ;;
  psql) shift; docker exec -it -e PGPASSWORD=postgres "$NAME" psql -U postgres -d "$DB" "$@" ;;
  destroy) docker rm -f "$NAME" >/dev/null 2>&1 && echo "removed container '$NAME'" || echo "no container '$NAME'" ;;
  *) echo "usage: $0 init | apply FILE | suites | psql [args] | destroy"; exit 1 ;;
esac
