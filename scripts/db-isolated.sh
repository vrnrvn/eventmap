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

shim() {
cat <<'SQL'
-- Minimal stand-ins for the Supabase platform objects the migrations touch.
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_user') THEN CREATE ROLE dashboard_user NOLOGIN; END IF;
END $r$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO PUBLIC;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, instance_id uuid, aud text, role text, email text, encrypted_password text,
  email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz,
  confirmation_token text, recovery_token text, email_change_token_new text, email_change text, phone text, deleted_at timestamptz, last_sign_in_at timestamptz);
CREATE TABLE IF NOT EXISTS auth.identities (id uuid, user_id uuid, provider_id text, identity_data jsonb, provider text, created_at timestamptz, updated_at timestamptz, UNIQUE (provider_id, provider));
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'role', 'anon') $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt()->>'email' $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC; GRANT SELECT ON auth.users TO PUBLIC;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), last_accessed_at timestamptz, path_tokens text[]);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
CREATE OR REPLACE FUNCTION storage.filename(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name,'/'),1)] $$;
GRANT USAGE ON SCHEMA storage TO PUBLIC; GRANT ALL ON ALL TABLES IN SCHEMA storage TO PUBLIC;
CREATE SCHEMA IF NOT EXISTS net;
CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (jobid bigserial PRIMARY KEY, schedule text, command text, jobname text);
CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job (schedule, command, jobname) VALUES (schedule, command, job_name) RETURNING jobid $$;
CREATE OR REPLACE FUNCTION cron.schedule(schedule text, command text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job (schedule, command) VALUES (schedule, command) RETURNING jobid $$;
CREATE OR REPLACE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = job_name RETURNING true $$;
DO $p$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN CREATE PUBLICATION supabase_realtime; END IF; END $p$;
CREATE SCHEMA IF NOT EXISTS vault;
-- Supabase grants the API roles access to public by default; mirror that so
-- `SET ROLE authenticated` exercises RLS the way PostgREST does.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
SQL
}

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
    # New tables from the migrations need the API grants too.
    shim | psql -d "$DB" -v ON_ERROR_STOP=1 -q
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
