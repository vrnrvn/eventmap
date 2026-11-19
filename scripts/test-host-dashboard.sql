-- HOW TO RUN (rule since 2026-11-14): in a throwaway container on the stack's
-- own Postgres 17 image, never against the shared cluster —
--
--   PG17_NAME=<unique> scripts/pg17-isolated.sh init
--   PG17_NAME=<unique> scripts/pg17-isolated.sh apply supabase/prepared/2026-11-19_host_dashboard_rpc/20261119130000_get_host_dashboard.sql
--   PG17_NAME=<unique> scripts/pg17-isolated.sh apply scripts/test-host-dashboard.sql
--
-- C3 / 2b-9: get_host_dashboard() — the whole host dashboard in one request.
-- The suite's job is mostly PARITY: every number it returns is compared with
-- the call the client makes today (get_host_events_counts,
-- get_event_host_overview, the per-date counter), so the cutover cannot
-- change what a host sees.
--
-- Skips with a NOTICE when the migration is not applied. One transaction,
-- rolled back; impersonation is by JWT claims (the RPC is SECURITY DEFINER
-- and checks auth.uid()), so SET ROLE is never needed.
BEGIN;
SET LOCAL client_min_messages = notice;

CREATE FUNCTION pg_temp.has_fn(n text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = n) $$;
CREATE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.su() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '', true) $$;
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

DO $$
DECLARE
  c record; d jsonb;
  appr uuid := '9e1f0000-0000-4000-8000-0000000d0001';   -- approval mode, later
  soon uuid := '9e1f0000-0000-4000-8000-0000000d0002';   -- open mode, sooner
  srs  uuid := '9e1f0000-0000-4000-8000-0000000d0003';   -- weekly series
  drft uuid := '9e1f0000-0000-4000-8000-0000000d0004';
  canc uuid := '9e1f0000-0000-4000-8000-0000000d0005';
  dkey text; n int;
BEGIN
  IF NOT pg_temp.has_fn('get_host_dashboard') THEN
    RAISE NOTICE '[1] skipped: 20261119130000 not applied'; RETURN;
  END IF;
  SELECT e.business_id AS biz, e.category_id AS cat, b.owner_id AS host,
         '10000000-0000-4000-8000-000000000002'::uuid AS alex,
         '10000000-0000-4000-8000-000000000003'::uuid AS sam
    INTO c FROM events e JOIN businesses b ON b.id = e.business_id
   WHERE e.id = '30000000-0000-4000-8000-000000000001';

  INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime,
                      lat, lng, address, status, publish_state, visibility, rsvp_mode, timezone)
  VALUES (appr, c.biz, 'Approval later', 'x', c.cat, now() + interval '5 days', now() + interval '5 days 2 hours',
          1, 1, 'x', 'active', 'published', 'public', 'approval', 'UTC'),
         (soon, c.biz, 'Open sooner', 'x', c.cat, now() + interval '1 day', now() + interval '1 day 2 hours',
          1, 1, 'x', 'active', 'published', 'public', 'open', 'UTC'),
         (canc, c.biz, 'Cancelled', 'x', c.cat, now() + interval '2 days', now() + interval '2 days 2 hours',
          1, 1, 'x', 'active', 'published', 'public', 'open', 'UTC');
  INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime,
                      lat, lng, address, status, publish_state, visibility, is_recurring, recurrence_pattern, timezone)
  VALUES (srs, c.biz, 'Weekly series', 'x', c.cat, now() + interval '2 days', now() + interval '2 days 2 hours',
          1, 1, 'x', 'active', 'published', 'public', true, '{"frequency":"weekly","interval":1}', 'UTC');
  INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime,
                      lat, lng, address, status, publish_state, visibility, timezone)
  VALUES (drft, c.biz, 'A draft', 'x', c.cat, now() + interval '9 days', now() + interval '9 days 2 hours',
          1, 1, 'x', 'active', 'draft', 'public', 'UTC');

  PERFORM set_config('eventmap.allow_approval', 'true', true);
  INSERT INTO rsvps (event_id, user_id, status) VALUES
    (appr, c.alex, 'requested'), (appr, c.sam, 'requested'),
    (soon, c.alex, 'going'), (srs, c.alex, 'going');
  PERFORM set_config('eventmap.allow_approval', '', true);
  INSERT INTO event_waitlist (event_id, user_id) VALUES (soon, c.sam);

  dkey := to_char((now() + interval '2 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD');
  INSERT INTO rsvp_occurrences (event_id, user_id, occurrence_date, status)
  VALUES (srs, c.sam, dkey::date, 'going'), (srs, c.alex, dkey::date, 'not_going');
  INSERT INTO event_occurrence_exceptions (event_id, occurrence_date, kind, created_by)
  VALUES (srs, (dkey::date + 7), 'cancelled', c.host);
  PERFORM set_config('eventmap.allow_status_change', 'true', true);
  UPDATE events SET status = 'cancelled' WHERE id = canc;
  PERFORM set_config('eventmap.allow_status_change', '', true);

  PERFORM pg_temp.as_user(c.host);
  d := get_host_dashboard(c.biz, now(), now() + interval '7 days')::jsonb;

  ASSERT d ?& ARRAY['events','drafts','counts','exceptions','overviews','date_going','inspected','eligible','truncated'],
    '[1.1] the payload carries every section the dashboard reads';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'events') x WHERE x->>'id' = soon::text)
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'events') x WHERE x->>'id' = drft::text),
    '[1.2] the agenda holds published events, not drafts';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'drafts') x WHERE x->>'id' = drft::text),
    '[1.3] drafts come back in their own list';
  ASSERT NOT (d->'counts') ? (canc::text), '[1.4] a cancelled event gets no counts';

  -- Parity with the per-event calls the dashboard makes today.
  ASSERT (d->'counts'->(soon::text)->>'going')::int
         = (SELECT (x->>'going')::int FROM json_array_elements(get_host_events_counts(ARRAY[soon])) x)
     AND (d->'counts'->(soon::text)->>'waitlist')::int
         = (SELECT (x->>'waitlist')::int FROM json_array_elements(get_host_events_counts(ARRAY[soon])) x),
    '[1.5] counts agree with get_host_events_counts';
  ASSERT (d->'overviews'->(appr::text)->>'requested')::int = (get_event_host_overview(appr)->>'requested')::int,
    '[1.6] requested agrees with get_event_host_overview';
  ASSERT (d->'overviews'->(appr::text)->'chat'->>'open_reports')::int
         = (get_event_host_overview(appr)->'chat'->>'open_reports')::int,
    '[1.7] open reports agree with get_event_host_overview';
  ASSERT (d->'date_going'->(srs::text)->>dkey)::int = occurrence_going_count(srs, dkey::date),
    '[1.8] per-date counts agree with occurrence_going_count';
  ASSERT (d->'date_going'->(srs::text)->>dkey)::int = 1,
    '[1.9] that count is series goers minus opt-outs plus date-only goers';
  ASSERT NOT ((d->'date_going'->(srs::text)) ? to_char(dkey::date + 7, 'YYYY-MM-DD')),
    '[1.10] a cancelled date is not counted';
  ASSERT (SELECT count(*) FROM jsonb_array_elements(d->'exceptions')) =
         (SELECT count(*) FROM event_occurrence_exceptions WHERE event_id = srs),
    '[1.11] the exceptions match the rows the client would fetch';

  -- The bounds the client applies today (DC5), now server-side.
  d := get_host_dashboard(c.biz, now(), now() + interval '7 days', 50, 1)::jsonb;
  ASSERT (d->>'inspected')::int = 1 AND (d->'overviews') ? (appr::text),
    '[1.12] with room for one overview, approval mode wins over the sooner event';
  ASSERT (d->>'eligible')::int > 1, '[1.13] eligible still reports how many could be inspected';
  d := get_host_dashboard(c.biz, now(), now() + interval '7 days', 1)::jsonb;
  ASSERT (d->>'truncated')::boolean, '[1.14] truncated marks an incomplete agenda';
  PERFORM pg_temp.su();

  -- Access control.
  PERFORM pg_temp.as_user(c.sam);
  ASSERT pg_temp.err(format('SELECT get_host_dashboard(%L)', c.biz)) LIKE '%only the host%',
    '[1.15] a non-host is refused';
  PERFORM pg_temp.su();
  ASSERT pg_temp.err(format('SELECT get_host_dashboard(%L)', c.biz)) LIKE '%not_authenticated%',
    '[1.16] signed out is refused';
  ASSERT (SELECT bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
            FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_host_dashboard')
     AND (SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
            FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_host_dashboard'),
    '[1.17] authenticated may call it, anon may not';
END $$;

ROLLBACK;
