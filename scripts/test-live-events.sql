-- HOW TO RUN (rule since 2026-11-14): in a throwaway container on the stack's
-- own Postgres 17 image, never against the shared cluster —
--
--   PG17_NAME=<unique> scripts/pg17-isolated.sh init
--   PG17_NAME=<unique> scripts/pg17-isolated.sh apply supabase/prepared/2026-11-20_live_events/20261120100000_get_live_events.sql
--   PG17_NAME=<unique> scripts/pg17-isolated.sh apply scripts/test-live-events.sql
--
-- Live events page (phase 3): get_live_events() — in-progress first, then
-- "starting soon"; interests boost but never filter; the seeded sprinkle is
-- stable per seed. Skips with a NOTICE when the prepared file is not applied,
-- so the standard suite run passes on a database without it.
-- One transaction, rolled back; every check is an ASSERT.
BEGIN;
SET LOCAL client_min_messages = notice;

DO $outer$
DECLARE
  ctx record;
  r record;
  ids uuid[];
  ids2 uuid[];
  n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_live_events') THEN
    RAISE NOTICE 'get_live_events not applied; suite skipped';
    RETURN;
  END IF;

  UPDATE businesses SET host_terms_version = host_terms_current_version(),
                        host_terms_accepted_at = COALESCE(host_terms_accepted_at, now());
  SELECT e.business_id AS biz, e.category_id AS cat, b.owner_id AS host,
         (SELECT id FROM categories WHERE id <> e.category_id LIMIT 1) AS cat2
    INTO ctx
    FROM events e JOIN businesses b ON b.id = e.business_id
   WHERE e.id = '30000000-0000-4000-8000-000000000001';

  -- Fixtures around a remote point (-60, 100), far from every seed event.
  -- Insert future (the write guards allow that), then move into place the
  -- lifecycle-harness way.
  PERFORM set_config('eventmap.allow_reschedule', 'true', true);
  PERFORM set_config('eventmap.skip_update_notice', 'true', true);
  CREATE TEMP TABLE fx (key text PRIMARY KEY, id uuid);
  INSERT INTO fx
  SELECT x.key, x.id FROM (VALUES
    ('live-now',      'a0000000-0000-4000-8000-000000000001'::uuid),
    ('live-far-ring', 'a0000000-0000-4000-8000-000000000002'::uuid),
    ('soon-30m',      'a0000000-0000-4000-8000-000000000003'::uuid),
    ('later-3h',      'a0000000-0000-4000-8000-000000000004'::uuid),
    ('ended',         'a0000000-0000-4000-8000-000000000005'::uuid),
    ('series-live',   'a0000000-0000-4000-8000-000000000006'::uuid),
    ('series-skip',   'a0000000-0000-4000-8000-000000000007'::uuid),
    ('pref-cat',      'a0000000-0000-4000-8000-000000000008'::uuid),
    ('outside',       'a0000000-0000-4000-8000-000000000009'::uuid)
  ) x(key, id);

  INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime,
                      lat, lng, address, status, publish_state, visibility, is_recurring, recurrence_pattern, timezone)
  SELECT f.id, ctx.biz, 'lv ' || f.key, 'x',
         CASE WHEN f.key = 'pref-cat' THEN ctx.cat2 ELSE ctx.cat END,
         now() + interval '10 days', now() + interval '10 days 2 hours',
         CASE WHEN f.key = 'outside' THEN -59.0 ELSE -60.0 END,
         CASE WHEN f.key = 'live-far-ring' THEN 100.2 ELSE 100.0 END,
         'x', 'active', 'published', 'public',
         f.key IN ('series-live', 'series-skip'),
         CASE WHEN f.key IN ('series-live', 'series-skip') THEN '{"frequency":"weekly","interval":1}'::jsonb END,
         'UTC'
    FROM fx f;

  -- Place each fixture on the clock. 'outside' is ~111 km north: inside the
  -- bounding box of a 25 km radius? No — dlat ≈ 0.225°, so it is not even in
  -- the box; it proves the distance cut, not just the box cut.
  UPDATE events SET start_datetime = now() - interval '1 hour',  end_datetime = now() + interval '1 hour'
   WHERE id IN (SELECT id FROM fx WHERE key IN ('live-now', 'live-far-ring', 'pref-cat', 'outside'));
  UPDATE events SET start_datetime = now() + interval '30 minutes', end_datetime = now() + interval '90 minutes'
   WHERE id = (SELECT id FROM fx WHERE key = 'soon-30m');
  UPDATE events SET start_datetime = now() + interval '3 hours', end_datetime = now() + interval '4 hours'
   WHERE id = (SELECT id FROM fx WHERE key = 'later-3h');
  UPDATE events SET start_datetime = now() - interval '3 hours', end_datetime = now() - interval '1 hour'
   WHERE id = (SELECT id FROM fx WHERE key = 'ended');
  -- series-live: weekly, first session a week ago at this hour − 1 h → the
  -- current session runs now. series-skip: same, but today's date cancelled.
  UPDATE events SET start_datetime = now() - interval '7 days 1 hour', end_datetime = now() - interval '7 days' + interval '1 hour'
   WHERE id IN (SELECT id FROM fx WHERE key IN ('series-live', 'series-skip'));
  INSERT INTO event_occurrence_exceptions (event_id, occurrence_date, kind, note)
  SELECT id, (now() AT TIME ZONE 'UTC')::date, 'cancelled', 'x' FROM fx WHERE key = 'series-skip';

  PERFORM set_config('request.jwt.claims', '', true);  -- anon caller

  -- [1] live before soon; the right members; occ windows filled.
  SELECT array_agg(g.id ORDER BY ord) INTO ids FROM (
    SELECT g.id, row_number() OVER () AS ord FROM get_live_events(-60, 100, 25) g) g(id, ord);
  ASSERT (SELECT id FROM fx WHERE key = 'live-now') = ANY (ids), 'running one-off listed';
  ASSERT (SELECT id FROM fx WHERE key = 'series-live') = ANY (ids), 'running series session listed';
  ASSERT (SELECT id FROM fx WHERE key = 'soon-30m') = ANY (ids), 'starting-in-30-min listed';
  ASSERT NOT (SELECT id FROM fx WHERE key = 'later-3h') = ANY (ids), 'starting in 3 h not in the default window';
  ASSERT NOT (SELECT id FROM fx WHERE key = 'ended') = ANY (ids), 'ended not listed';
  ASSERT NOT (SELECT id FROM fx WHERE key = 'series-skip') = ANY (ids), 'cancelled-today series not live';
  ASSERT NOT (SELECT id FROM fx WHERE key = 'outside') = ANY (ids), 'outside the radius not listed';

  FOR r IN SELECT * FROM get_live_events(-60, 100, 25) LOOP
    ASSERT r.live_status IN ('live', 'soon'), 'status named';
    ASSERT r.occ_start IS NOT NULL AND r.occ_end IS NOT NULL, 'occurrence window filled';
    IF r.live_status = 'live' THEN
      ASSERT r.occ_start <= now() AND now() < r.occ_end, 'live means running now';
    ELSE
      ASSERT r.occ_start > now() AND r.occ_start <= now() + interval '60 minutes', 'soon means within the window';
    END IF;
  END LOOP;
  ASSERT (SELECT COALESCE(max(ord) FILTER (WHERE ls = 'live'), 0)
               < COALESCE(min(ord) FILTER (WHERE ls = 'soon'), 2147483647)
            FROM (SELECT g.live_status AS ls, row_number() OVER () AS ord
                    FROM get_live_events(-60, 100, 25) g) t), 'every live row before every soon row';

  -- [2] a running series session is not duplicated under "soon".
  SELECT count(*) INTO n FROM get_live_events(-60, 100, 25) g WHERE g.id = (SELECT id FROM fx WHERE key = 'series-live');
  ASSERT n = 1, format('series listed once, got %s', n);

  -- [3] the viewer's interests boost, never filter: pref-cat (other category)
  -- outranks the equidistant live-now when preferred, with seed held fixed.
  ASSERT (SELECT array_position(array_agg(g.id ORDER BY g.ord), (SELECT id FROM fx WHERE key = 'pref-cat'))
            < array_position(array_agg(g.id ORDER BY g.ord), (SELECT id FROM fx WHERE key = 'live-now'))
            FROM (SELECT id, row_number() OVER () AS ord
                    FROM get_live_events(-60, 100, 25, 30, 60, ARRAY[ctx.cat2], 'seed-a')) g),
         'preferred category boosted';
  ASSERT (SELECT count(*) FROM get_live_events(-60, 100, 25, 30, 60, ARRAY[ctx.cat2], 'seed-a') g
           WHERE g.id IN (SELECT id FROM fx)) >= 4, 'non-preferred events still listed (boost, not filter)';

  -- [4] the sprinkle is deterministic per seed.
  SELECT array_agg(g.id ORDER BY g.ord) INTO ids
    FROM (SELECT id, row_number() OVER () AS ord FROM get_live_events(-60, 100, 25, 30, 60, NULL, 'seed-b')) g;
  SELECT array_agg(g.id ORDER BY g.ord) INTO ids2
    FROM (SELECT id, row_number() OVER () AS ord FROM get_live_events(-60, 100, 25, 30, 60, NULL, 'seed-b')) g;
  ASSERT ids = ids2, 'same seed, same order';

  -- [5] limit respected; wider "soon" window picks up the 5-hour event.
  ASSERT (SELECT count(*) FROM get_live_events(-60, 100, 25, 2)) <= 2, 'limit respected';
  ASSERT (SELECT id FROM fx WHERE key = 'later-3h') IN
         (SELECT g.id FROM get_live_events(-60, 100, 25, 30, 240, NULL, NULL) g), 'soon window is a parameter (capped at 240)';

  -- [6] a banned host disappears.
  INSERT INTO banned_users (user_id, reason, banned_by) VALUES (ctx.host, 'x', ctx.host) ON CONFLICT DO NOTHING;
  ASSERT (SELECT count(*) FROM get_live_events(-60, 100, 25) g WHERE g.id IN (SELECT id FROM fx)) = 0, 'banned host hidden';
  DELETE FROM banned_users WHERE user_id = ctx.host;

  RAISE NOTICE 'test-live-events: all assertions passed';
END $outer$;

ROLLBACK;
