-- Regression suite for get_user_calendar (20261104110000_user_calendar_rpc.sql).
--
-- Runs ONLY against an isolated scratch copy; everything happens inside one
-- transaction that is rolled back at the end, and every check is an ASSERT
-- (db-scratch.sh apply runs ON_ERROR_STOP=1, so a failure aborts):
--
--   SCRATCH_DB=eventmap_scratch_<yours> scripts/db-scratch.sh refresh
--   SCRATCH_DB=... scripts/db-scratch.sh apply supabase/migrations/20261104110000_user_calendar_rpc.sql
--   SCRATCH_DB=... scripts/db-scratch.sh apply scripts/test-calendar.sql
--
-- Fixtures are the seeded demo users (host / alex / sam) and the host's
-- business; the events below are created inside the transaction.

BEGIN;

CREATE FUNCTION pg_temp.login(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL role authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
END; $$;

CREATE FUNCTION pg_temp.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
END; $$;

CREATE FUNCTION pg_temp.expect_error(tag text, sql text, pattern text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE pattern THEN
      RAISE EXCEPTION '[%] failed with the WRONG error: % (wanted %)', tag, SQLERRM, pattern;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION '[%] should have failed (%) but succeeded', tag, pattern;
END; $$;

-- Ids of the rows returned for a call, and the sources of one event.
CREATE FUNCTION pg_temp.ids(cal json) RETURNS text[] LANGUAGE sql AS $$
  SELECT COALESCE(array_agg(r->>'id' ORDER BY r->>'id'), '{}') FROM json_array_elements(cal->'rows') r;
$$;
CREATE FUNCTION pg_temp.row_of(cal json, id uuid) RETURNS json LANGUAGE sql AS $$
  SELECT r FROM json_array_elements(cal->'rows') r WHERE r->>'id' = id::text;
$$;

DO $$ BEGIN RAISE NOTICE 'calendar RPC regression suite starting'; END $$;

-- ── Fixtures ──────────────────────────────────────────────────────────────────

CREATE TEMP TABLE fx AS
SELECT
  '10000000-0000-4000-8000-000000000001'::uuid AS host,
  '10000000-0000-4000-8000-000000000002'::uuid AS alex,
  '10000000-0000-4000-8000-000000000003'::uuid AS sam,
  (SELECT id FROM businesses b WHERE b.owner_id = '10000000-0000-4000-8000-000000000001') AS biz,
  (SELECT id FROM categories ORDER BY slug LIMIT 1) AS cat,
  -- Range under test: the whole of a month well in the future.
  '2027-03-01 00:00:00+00'::timestamptz AS r_from,
  '2027-03-31 23:59:59+00'::timestamptz AS r_to,
  'c0000000-0000-4000-8000-000000000001'::uuid AS e_in,         -- one-off inside the range
  'c0000000-0000-4000-8000-000000000002'::uuid AS e_after,      -- one-off after the range
  'c0000000-0000-4000-8000-000000000003'::uuid AS e_series,     -- weekly series, started before, no end
  'c0000000-0000-4000-8000-000000000004'::uuid AS e_series_end, -- weekly series ending before the range
  'c0000000-0000-4000-8000-000000000005'::uuid AS e_approval,   -- approval-mode event, alex requested
  'c0000000-0000-4000-8000-000000000006'::uuid AS e_draft,      -- host draft inside the range
  'c0000000-0000-4000-8000-000000000007'::uuid AS e_cancelled,  -- cancelled after alex said going
  'c0000000-0000-4000-8000-000000000008'::uuid AS e_spanning,   -- starts before the range, ends inside
  'c0000000-0000-4000-8000-000000000009'::uuid AS e_zoned_end;  -- series ending on the range's first local day

GRANT SELECT ON fx TO authenticated;

-- The host is premium in the seed (recurrence is premium-only); make sure.
UPDATE businesses SET subscription_tier = 'premium', subscription_expires_at = now() + interval '1 year'
WHERE id IN (SELECT biz FROM fx);

INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime,
                    lat, lng, address, is_recurring, recurrence_pattern, timezone, rsvp_mode, publish_state)
SELECT v.id, f.biz, v.title, 'Calendar suite', f.cat, v.s, v.e, 37.77, -122.41, 'Synthetic',
       v.rec, v.pat, v.tz, v.mode, v.pub
FROM fx f, LATERAL (VALUES
  (f.e_in,         'In range',        '2027-03-10 18:00+00'::timestamptz, '2027-03-10 20:00+00'::timestamptz, false, NULL::jsonb, NULL::text, 'open', 'published'),
  (f.e_after,      'After range',     '2027-04-10 18:00+00', '2027-04-10 20:00+00', false, NULL, NULL, 'open', 'published'),
  (f.e_series,     'Weekly series',   '2027-01-05 18:00+00', '2027-01-05 19:00+00', true, '{"frequency":"weekly","interval":1}'::jsonb, 'Europe/Lisbon', 'open', 'published'),
  (f.e_series_end, 'Ended series',    '2027-01-05 18:00+00', '2027-01-05 19:00+00', true, '{"frequency":"weekly","interval":1,"endDate":"2027-02-20"}'::jsonb, NULL, 'open', 'published'),
  (f.e_approval,   'Approval event',  '2027-03-12 18:00+00', '2027-03-12 20:00+00', false, NULL, NULL, 'approval', 'published'),
  (f.e_draft,      'Draft event',     '2027-03-14 18:00+00', '2027-03-14 20:00+00', false, NULL, NULL, 'open', 'draft'),
  (f.e_cancelled,  'Cancelled event', '2027-03-16 18:00+00', '2027-03-16 20:00+00', false, NULL, NULL, 'open', 'published'),
  (f.e_spanning,   'Spanning event',  '2027-02-27 10:00+00', '2027-03-02 10:00+00', false, NULL, NULL, 'open', 'published'),
  -- Ends on 1 Mar in Honolulu; r_from (00:00 UTC on 1 Mar) is still 28 Feb there.
  (f.e_zoned_end,  'Zoned end',       '2027-01-04 18:00+00', '2027-01-04 19:00+00', true, '{"frequency":"weekly","interval":1,"endDate":"2027-02-28"}'::jsonb, 'Pacific/Honolulu', 'open', 'published')
) AS v(id, title, s, e, rec, pat, tz, mode, pub);

INSERT INTO rsvps (user_id, event_id, status)
SELECT f.alex, x.ev, 'going' FROM fx f,
  LATERAL unnest(ARRAY[f.e_in, f.e_after, f.e_series, f.e_series_end, f.e_cancelled, f.e_spanning, f.e_zoned_end]) AS x(ev);
INSERT INTO saves (user_id, event_id) SELECT alex, e_in FROM fx;
INSERT INTO rsvps (user_id, event_id, status) SELECT sam, e_series, 'interested' FROM fx;

-- Alex asks to join the approval-mode event the way the app does.
SELECT pg_temp.login(alex) FROM fx;
SELECT join_event_with_capacity((SELECT e_approval FROM fx), 'going');
SELECT pg_temp.logout();

-- Cancel through the sanctioned path (keeps RSVPs, flips status).
SELECT pg_temp.login(host) FROM fx;
SELECT cancel_event((SELECT e_cancelled FROM fx));
SELECT pg_temp.logout();

-- ── 1. Guards ─────────────────────────────────────────────────────────────────

SELECT pg_temp.expect_error('1.1 anonymous caller',
  'SELECT get_user_calendar(now(), now() + interval ''1 day'')', '%not_authenticated%');
SELECT pg_temp.login(alex) FROM fx;
SELECT pg_temp.expect_error('1.2 inverted range',
  'SELECT get_user_calendar(now(), now() - interval ''1 day'')', '%invalid_range%');
SELECT pg_temp.expect_error('1.3 range too long',
  'SELECT get_user_calendar(now(), now() + interval ''401 days'')', '%range_too_long%');
SELECT pg_temp.expect_error('1.4 unknown source',
  'SELECT get_user_calendar(now(), now() + interval ''1 day'', ARRAY[''going'',''everything''])', '%invalid_source%');
SELECT pg_temp.logout();
-- Grants: the anon API role cannot call it at all. Checked via the catalog,
-- NOT by switching to anon and calling it: `SET role anon` followed by a
-- pg_temp function call segfaulted the backend on this Postgres 17 build
-- (2026-11-04), which crash-restarts every connection in the cluster.
DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.get_user_calendar(timestamptz, timestamptz, text[], integer)', 'EXECUTE'),
    '[1.5] anon must not have EXECUTE';
  ASSERT has_function_privilege('authenticated', 'public.get_user_calendar(timestamptz, timestamptz, text[], integer)', 'EXECUTE'),
    '[1.6] authenticated must have EXECUTE';
END $$;

-- ── 2. Range intersection and sources (alex) ─────────────────────────────────

DO $$
DECLARE f fx%ROWTYPE; cal json; r json;
BEGIN
  SELECT * INTO f FROM fx;
  PERFORM pg_temp.login(f.alex);
  cal := get_user_calendar(f.r_from, f.r_to);

  ASSERT pg_temp.ids(cal) @> ARRAY[f.e_in, f.e_series, f.e_approval, f.e_cancelled, f.e_spanning, f.e_zoned_end]::text[],
    format('[2.1] expected in-range rows, got %s', pg_temp.ids(cal));
  ASSERT NOT pg_temp.ids(cal) && ARRAY[f.e_after, f.e_series_end, f.e_draft]::text[],
    format('[2.2] after-range, ended series and drafts must be excluded, got %s', pg_temp.ids(cal));
  ASSERT (cal->>'truncated')::boolean = false, '[2.3] small result is not truncated';

  r := pg_temp.row_of(cal, f.e_in);
  ASSERT (r->'sources')::text = '["going","saved"]',
    format('[2.4] going + saved merge into one row, got %s', r->'sources');
  ASSERT r->>'user_rsvp' = 'going', '[2.5] user_rsvp reflects the RSVP';

  r := pg_temp.row_of(cal, f.e_approval);
  ASSERT (r->'sources')::text = '["requested"]' AND r->>'user_rsvp' = 'requested',
    format('[2.6] pending approval comes back as requested, got %s', r);

  r := pg_temp.row_of(cal, f.e_cancelled);
  ASSERT r->>'status' = 'cancelled', '[2.7] cancelled events are kept with their status';

  r := pg_temp.row_of(cal, f.e_series);
  ASSERT r->>'timezone' = 'Europe/Lisbon' AND (r->>'is_recurring')::boolean
     AND r->'recurrence_pattern'->>'frequency' = 'weekly',
    '[2.8] series rows carry zone and pattern for client expansion';
  ASSERT (r->>'next_start_datetime') IS NOT NULL, '[2.9] next occurrence is filled';

  -- Source filter: only saved.
  cal := get_user_calendar(f.r_from, f.r_to, ARRAY['saved']);
  ASSERT pg_temp.ids(cal) = ARRAY[f.e_in::text], format('[2.10] saved filter, got %s', pg_temp.ids(cal));
  ASSERT (pg_temp.row_of(cal, f.e_in)->'sources')::text = '["saved"]', '[2.11] filtered sources only';

  -- Limit + truncation.
  cal := get_user_calendar(f.r_from, f.r_to, NULL, 2);
  ASSERT json_array_length(cal->'rows') = 2 AND (cal->>'truncated')::boolean, '[2.12] limit truncates and says so';
  -- Ordered by start: the spanning event (27 Feb) and the series (Jan) start earliest.
  ASSERT (cal->'rows'->0->>'start_datetime')::timestamptz <= (cal->'rows'->1->>'start_datetime')::timestamptz,
    '[2.13] rows ordered by start';

  -- A range that ends before the spanning event starts excludes it.
  cal := get_user_calendar('2027-02-01 00:00+00', '2027-02-26 23:59+00');
  ASSERT NOT pg_temp.ids(cal) && ARRAY[f.e_spanning::text], '[2.14] p_to bound respected';
  PERFORM pg_temp.logout();
END $$;

-- ── 3. Caller scoping and hosting ────────────────────────────────────────────

DO $$
DECLARE f fx%ROWTYPE; cal json;
BEGIN
  SELECT * INTO f FROM fx;
  PERFORM pg_temp.login(f.sam);
  cal := get_user_calendar(f.r_from, f.r_to);
  ASSERT pg_temp.ids(cal) = ARRAY[f.e_series::text], format('[3.1] sam only sees own rows, got %s', pg_temp.ids(cal));
  ASSERT (pg_temp.row_of(cal, f.e_series)->'sources')::text = '["interested"]', '[3.2] sam is interested';

  PERFORM pg_temp.login(f.host);
  cal := get_user_calendar(f.r_from, f.r_to, ARRAY['hosting']);
  ASSERT pg_temp.ids(cal) @> ARRAY[f.e_in, f.e_series, f.e_approval, f.e_cancelled]::text[],
    format('[3.3] host sees own published events, got %s', pg_temp.ids(cal));
  ASSERT NOT pg_temp.ids(cal) && ARRAY[f.e_draft::text], '[3.4] drafts never appear, even for the host';

  PERFORM pg_temp.login(f.alex);
  cal := get_user_calendar(f.r_from, f.r_to, ARRAY['hosting']);
  ASSERT json_array_length(cal->'rows') = 0, '[3.5] non-owners have no hosting rows';
  PERFORM pg_temp.logout();
END $$;

-- ── 4. Requested scope and zones in the list RPCs (20261104120000) ─────────
-- Skipped when that migration isn't applied to this scratch copy.

DO $$
DECLARE f fx%ROWTYPE; lst json; cnt json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_user_going_events'
                 AND pg_get_functiondef(oid) LIKE '%''requested''%') THEN
    RAISE NOTICE 'section 4 skipped: 20261104120000 not applied';
    RETURN;
  END IF;
  SELECT * INTO f FROM fx;
  PERFORM pg_temp.login(f.alex);
  lst := get_user_going_events(f.alex, 'requested', 50, 0);
  ASSERT pg_temp.ids(json_build_object('rows', lst)) = ARRAY[f.e_approval::text],
    format('[4.1] requested scope lists the pending request only, got %s', pg_temp.ids(json_build_object('rows', lst)));
  cnt := get_user_attendance_counts(f.alex);
  ASSERT (cnt->>'requested_count')::int = 1, format('[4.2] requested_count, got %s', cnt);
  lst := get_user_going_events(f.alex, 'upcoming', 100, 0);
  ASSERT NOT pg_temp.ids(json_build_object('rows', lst)) && ARRAY[f.e_approval::text],
    '[4.3] a pending request is not in the going list';
  ASSERT (SELECT r->>'timezone' FROM json_array_elements(lst) r WHERE r->>'id' = f.e_series::text) = 'Europe/Lisbon',
    '[4.4] going rows carry the event zone';
  PERFORM pg_temp.login(f.sam);
  ASSERT json_array_length(get_user_going_events(f.alex, 'requested', 50, 0)) = 0,
    '[4.5] requests are owner-only';
  ASSERT (get_user_attendance_counts(f.alex)->>'requested_count')::int = 0,
    '[4.6] requested_count is owner-only';
  PERFORM pg_temp.logout();
END $$;

-- ── 5. Zone on saved rows (20261104130000) ───────────────────────────────────

DO $$
DECLARE f fx%ROWTYPE; lst json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_user_saved_events'
                 AND pg_get_functiondef(oid) LIKE '%''timezone''%') THEN
    RAISE NOTICE 'section 5 skipped: 20261104130000 not applied';
    RETURN;
  END IF;
  SELECT * INTO f FROM fx;
  INSERT INTO saves (user_id, event_id) VALUES (f.alex, f.e_series);
  PERFORM pg_temp.login(f.alex);
  lst := get_user_saved_events(50, 0);
  ASSERT (SELECT r->>'timezone' FROM json_array_elements(lst) r WHERE r->>'id' = f.e_series::text) = 'Europe/Lisbon',
    '[5.1] saved rows carry the event zone';
  ASSERT (SELECT json_typeof(r->'timezone') FROM json_array_elements(lst) r WHERE r->>'id' = f.e_in::text) = 'null',
    '[5.2] legacy rows report a null zone';
  PERFORM pg_temp.logout();
END $$;

DO $$ BEGIN RAISE NOTICE 'calendar RPC regression suite: all assertions passed'; END $$;

ROLLBACK;
