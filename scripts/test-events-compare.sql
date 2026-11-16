-- HOW TO RUN (rule since 2026-11-14): in a throwaway container on the stack's
-- own Postgres 17 image, never against the shared cluster —
--
--   scripts/pg17-isolated.sh init            # all migrations + seed
--   scripts/pg17-isolated.sh apply scripts/test-events-compare.sql
--   scripts/pg17-isolated.sh suites          # every scripts/test-*.sql
--
-- Regression suite for get_events_compare
-- (migration 20261115100000_get_events_compare.sql; docs/EVENT_COMPARISON_PLAN.md §3.5,
-- ROADMAP.md "Phase 8 in detail").
--
-- Runs inside one transaction that is rolled back; every check is an ASSERT.
--
-- NEVER provoke a "permission denied for function" error while the current
-- role is anon / authenticated / service_role: on the Supabase Postgres image
-- that segfaults the backend (docs/ISSUES.md Ground rules). Privileges are
-- asserted with has_function_privilege; the function is only ever *called*
-- as roles that hold EXECUTE on it.
BEGIN;
SET LOCAL client_min_messages = notice;

CREATE TEMP TABLE ctx AS
SELECT (SELECT id FROM businesses LIMIT 1) AS biz,
       (SELECT owner_id FROM businesses LIMIT 1) AS host,
       (SELECT id FROM profiles WHERE id <> (SELECT owner_id FROM businesses LIMIT 1) ORDER BY id LIMIT 1) AS a,
       (SELECT id FROM profiles WHERE id <> (SELECT owner_id FROM businesses LIMIT 1) ORDER BY id OFFSET 1 LIMIT 1) AS b,
       (SELECT id FROM categories WHERE slug = 'live-music') AS cat_music,
       (SELECT id FROM categories WHERE slug = 'sports') AS cat_sports,
       '93000000-0000-4000-8000-000000000001'::uuid AS e_pub,
       '93000000-0000-4000-8000-000000000002'::uuid AS e_small,
       '93000000-0000-4000-8000-000000000003'::uuid AS e_series,
       '93000000-0000-4000-8000-000000000004'::uuid AS e_unlisted,
       '93000000-0000-4000-8000-000000000005'::uuid AS e_draft,
       '93000000-0000-4000-8000-000000000006'::uuid AS e_cancel,
       '93000000-0000-4000-8000-00000000dead'::uuid AS e_missing;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL ROLE anon';
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_super() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.raises(p_sql text, p_like text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE p_like THEN RETURN true; END IF;
  RAISE NOTICE 'wrong error for %: %', p_sql, SQLERRM;
  RETURN false;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.ids(p json) RETURNS text[] LANGUAGE sql AS $$
  SELECT COALESCE(array_agg(x->>'id' ORDER BY ord), '{}') FROM json_array_elements(p) WITH ORDINALITY AS t(x, ord);
$$;
CREATE OR REPLACE FUNCTION pg_temp.row_of(p json, p_id uuid) RETURNS json LANGUAGE sql AS $$
  SELECT x FROM json_array_elements(p) x WHERE x->>'id' = p_id::text LIMIT 1;
$$;

DO $$ BEGIN RAISE NOTICE 'get_events_compare regression suite starting'; END $$;

-- ---------------------------------------------------------------- fixtures
INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address,
                    status, publish_state, visibility, is_recurring, recurrence_pattern, timezone, max_attendees, price_label)
SELECT e_pub, biz, 'Public Gig', 'fixture', cat_music, now() + interval '1 day', now() + interval '1 day 2 hours',
       37.77, -122.41, 'x', 'active', 'published', 'public', false, NULL::jsonb, 'UTC', NULL, '€12' FROM ctx
UNION ALL
SELECT e_small, biz, 'Tiny Room', 'fixture', cat_music, now() + interval '2 days', now() + interval '2 days 2 hours',
       37.80, -122.45, 'x', 'active', 'published', 'public', false, NULL::jsonb, 'UTC', 1, 'Free' FROM ctx
UNION ALL
SELECT e_series, biz, 'Choir Weekly', 'fixture', cat_music, now() - interval '20 days', now() - interval '20 days' + interval '2 hours',
       37.77, -122.41, 'x', 'active', 'published', 'public', true, '{"frequency":"weekly","interval":1}'::jsonb, 'UTC', NULL, NULL FROM ctx
UNION ALL
SELECT e_unlisted, biz, 'Secret Set', 'fixture', cat_sports, now() + interval '3 days', now() + interval '3 days 2 hours',
       37.77, -122.41, 'x', 'active', 'published', 'unlisted', false, NULL::jsonb, 'UTC', NULL, NULL FROM ctx
UNION ALL
SELECT e_draft, biz, 'Not Yet', 'fixture', cat_music, now() + interval '4 days', now() + interval '4 days 2 hours',
       37.77, -122.41, 'x', 'active', 'draft', 'public', false, NULL::jsonb, 'UTC', NULL, NULL FROM ctx
UNION ALL
SELECT e_cancel, biz, 'Fizzled Show', 'fixture', cat_music, now() + interval '5 days', now() + interval '5 days 2 hours',
       37.77, -122.41, 'x', 'cancelled', 'published', 'public', false, NULL::jsonb, 'UTC', NULL, NULL FROM ctx;

-- Alex (a) saved the public gig and is going to the series; Bo (b) took the
-- only seat in the tiny room and Alex is first on its waitlist.
INSERT INTO saves (user_id, event_id) SELECT a, e_pub FROM ctx;
INSERT INTO rsvps (user_id, event_id, status)
SELECT a, e_series, 'going' FROM ctx UNION ALL
SELECT b, e_small, 'going' FROM ctx UNION ALL
SELECT b, e_pub, 'interested' FROM ctx;
INSERT INTO event_waitlist (event_id, user_id) SELECT e_small, a FROM ctx;

-- ---------------------------------------------------------------- [0] grants
DO $$
BEGIN
  ASSERT has_function_privilege('anon', 'public.get_events_compare(uuid[], double precision, double precision)', 'EXECUTE'),
    '[0.1] anon can call it (shared links open signed-out)';
  ASSERT has_function_privilege('authenticated', 'public.get_events_compare(uuid[], double precision, double precision)', 'EXECUTE'),
    '[0.2] authenticated can call it';
  RAISE NOTICE '[0] grants ok';
END $$;

-- ---------------------------------------------------------------- [1] shape and order, as Alex
DO $$
DECLARE c ctx%ROWTYPE; r json; pub json; small json; ser json;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.as_user(c.a);
  r := get_events_compare(ARRAY[c.e_series, c.e_pub, c.e_small], 37.77, -122.41);
  ASSERT pg_temp.ids(r) = ARRAY[c.e_series::text, c.e_pub::text, c.e_small::text], '[1.1] caller order kept: ' || pg_temp.ids(r)::text;
  pub := pg_temp.row_of(r, c.e_pub); small := pg_temp.row_of(r, c.e_small); ser := pg_temp.row_of(r, c.e_series);
  ASSERT (pub->>'business_name') IS NOT NULL AND (pub->>'category_label') = 'Live Music', '[1.2] host and category labels: ' || pub::text;
  ASSERT (pub->>'rsvp_count')::int = 0 AND (small->>'rsvp_count')::int = 1, '[1.3] rsvp_count counts going only';
  ASSERT (pub->>'save_count')::int = 1, '[1.4] save_count';
  ASSERT (small->>'waitlist_count')::int = 1, '[1.5] waitlist_count';
  ASSERT (pub->>'user_saved')::boolean AND NOT (small->>'user_saved')::boolean, '[1.6] user_saved is the viewer''s';
  ASSERT (ser->>'user_rsvp') = 'going' AND (pub->>'user_rsvp') IS NULL, '[1.7] user_rsvp is the viewer''s';
  ASSERT (pub->>'price_label') = '€12' AND (small->>'max_attendees')::int = 1, '[1.8] event columns pass through';
  ASSERT (pub->>'visibility') = 'public', '[1.9] visibility passes through';
  -- Every block hands the session back: the next one reads the temp fixture
  -- table, which the API roles cannot.
  PERFORM pg_temp.as_super();
  RAISE NOTICE '[1] shape ok';
END $$;

-- ---------------------------------------------------------------- [2] distance and next date
DO $$
DECLARE c ctx%ROWTYPE; r json; pub json; small json; ser json; expect double precision;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.as_user(c.a);
  r := get_events_compare(ARRAY[c.e_pub, c.e_small, c.e_series], 37.77, -122.41);
  pub := pg_temp.row_of(r, c.e_pub); small := pg_temp.row_of(r, c.e_small); ser := pg_temp.row_of(r, c.e_series);
  ASSERT (pub->>'distance_km')::double precision < 0.01, '[2.1] same point is ~0 km: ' || (pub->>'distance_km');
  expect := calculate_distance(37.77, -122.41, 37.80, -122.45);
  ASSERT abs((small->>'distance_km')::double precision - expect) < 0.001, '[2.2] distance matches calculate_distance';
  ASSERT (ser->>'next_start_datetime')::timestamptz > now(), '[2.3] a series reports a future next date';
  ASSERT (ser->>'next_start_datetime')::timestamptz = event_next_effective_occurrence(c.e_series, now()), '[2.4] ...the effective one';
  ASSERT (pub->>'next_start_datetime')::timestamptz = (pub->>'start_datetime')::timestamptz, '[2.5] a one-off reports its start';
  r := get_events_compare(ARRAY[c.e_pub], NULL, NULL);
  ASSERT (pg_temp.row_of(r, c.e_pub)->>'distance_km') IS NULL, '[2.6] no reference point, no distance';
  PERFORM pg_temp.as_super();
  RAISE NOTICE '[2] distance and next date ok';
END $$;

-- ---------------------------------------------------------------- [3] visibility mirrors get_event_details
DO $$
DECLARE c ctx%ROWTYPE; r json;
BEGIN
  SELECT * INTO c FROM ctx;
  -- Bo never saw the unlisted event; by id it is still returned (share-link path).
  PERFORM pg_temp.as_user(c.b);
  r := get_events_compare(ARRAY[c.e_unlisted, c.e_cancel, c.e_draft, c.e_missing], NULL, NULL);
  ASSERT pg_temp.ids(r) = ARRAY[c.e_unlisted::text, c.e_cancel::text], '[3.1] unlisted + cancelled returned, draft + unknown dropped: ' || pg_temp.ids(r)::text;
  ASSERT (pg_temp.row_of(r, c.e_unlisted)->>'visibility') = 'unlisted', '[3.2] unlisted says so';
  ASSERT (pg_temp.row_of(r, c.e_cancel)->>'status') = 'cancelled', '[3.3] cancelled says so';
  -- The host sees their own draft.
  PERFORM pg_temp.as_user(c.host);
  r := get_events_compare(ARRAY[c.e_draft], NULL, NULL);
  ASSERT pg_temp.ids(r) = ARRAY[c.e_draft::text], '[3.4] owner sees the draft';
  -- Signed out: rows come back, viewer fields are empty.
  PERFORM pg_temp.as_anon();
  r := get_events_compare(ARRAY[c.e_pub, c.e_unlisted], 37.77, -122.41);
  ASSERT array_length(pg_temp.ids(r), 1) = 2, '[3.5] anon reads public and unlisted by id';
  ASSERT (pg_temp.row_of(r, c.e_pub)->>'user_rsvp') IS NULL AND NOT (pg_temp.row_of(r, c.e_pub)->>'user_saved')::boolean, '[3.6] anon has no viewer state';
  PERFORM pg_temp.as_super();
  RAISE NOTICE '[3] visibility ok';
END $$;

-- ---------------------------------------------------------------- [4] input hygiene and the cap
DO $$
DECLARE c ctx%ROWTYPE; r json;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.as_user(c.a);
  r := get_events_compare(ARRAY[c.e_pub, NULL, c.e_pub, c.e_small, c.e_pub], NULL, NULL);
  ASSERT pg_temp.ids(r) = ARRAY[c.e_pub::text, c.e_small::text], '[4.1] duplicates collapse, nulls ignored: ' || pg_temp.ids(r)::text;
  ASSERT get_events_compare('{}'::uuid[], NULL, NULL)::text = '[]', '[4.2] empty in, empty out';
  ASSERT get_events_compare(ARRAY[c.e_missing], NULL, NULL)::text = '[]', '[4.3] unknown id is not an error';
  ASSERT get_events_compare(ARRAY[c.e_pub, c.e_small, c.e_series, c.e_unlisted], NULL, NULL) IS NOT NULL, '[4.4] four is fine';
  ASSERT pg_temp.raises(
    format('SELECT get_events_compare(ARRAY[%L,%L,%L,%L,%L]::uuid[], NULL, NULL)', c.e_pub, c.e_small, c.e_series, c.e_unlisted, c.e_cancel),
    'too_many_events%'), '[4.5] five is refused';
  -- Five with a duplicate is four distinct: allowed.
  ASSERT get_events_compare(ARRAY[c.e_pub, c.e_small, c.e_series, c.e_unlisted, c.e_pub], NULL, NULL) IS NOT NULL, '[4.6] cap counts distinct ids';
  PERFORM pg_temp.as_super();
  RAISE NOTICE '[4] hygiene ok';
END $$;

DO $$ BEGIN RAISE NOTICE 'get_events_compare regression suite: all blocks passed'; END $$;
ROLLBACK;
