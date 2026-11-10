-- Regression suite for the categories + recurring-series stack
-- (migrations 20261109100000 … 20261109170000; docs/CATEGORIES_AND_SERIES_PLAN.md).
--
-- Runs ONLY against an isolated scratch copy, inside one transaction that is
-- rolled back; every check is an ASSERT (db-scratch.sh apply stops on error):
--
--   SCRATCH_DB=eventmap_scratch_<you> scripts/db-scratch.sh refresh
--   for f in supabase/migrations/202611091*.sql; do scripts/db-scratch.sh apply $f; done
--   scripts/db-scratch.sh apply scripts/test-categories-series.sql
--
-- Needs the local seed (one business with an owner + two other profiles).
BEGIN;
SET LOCAL client_min_messages = notice;

CREATE TEMP TABLE ctx AS
SELECT (SELECT id FROM businesses LIMIT 1) AS biz,
       (SELECT owner_id FROM businesses LIMIT 1) AS host,
       (SELECT id FROM profiles WHERE id <> (SELECT owner_id FROM businesses LIMIT 1) ORDER BY id LIMIT 1) AS a,
       (SELECT id FROM profiles WHERE id <> (SELECT owner_id FROM businesses LIMIT 1) ORDER BY id OFFSET 1 LIMIT 1) AS b,
       (SELECT id FROM categories WHERE slug = 'live-music') AS cat_music,
       (SELECT id FROM categories WHERE slug = 'sports') AS cat_sports;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.as_anon() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '', true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.raises(p_sql text, p_like text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM LIKE p_like;
END $$;

DO $$ BEGIN RAISE NOTICE 'categories + series regression suite starting'; END $$;

-- ---------------------------------------------------------------- taxonomy
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM categories WHERE is_active) >= 12, 'twelve active categories';
  ASSERT NOT EXISTS (SELECT 1 FROM categories WHERE color !~ '^#[0-9a-f]{6}$'), 'every category has a hex colour';
  ASSERT NOT EXISTS (SELECT 1 FROM categories WHERE cardinality(synonyms) = 0), 'every category has synonyms';
  ASSERT (SELECT label FROM categories WHERE slug = 'food-drink') = 'Drinks & Tastings', 'relabelled food-drink';
  ASSERT (SELECT icon_key FROM categories WHERE slug = 'live-music') = 'mic-vocal', 'lucide icon keys';
  ASSERT pg_temp.raises($q$INSERT INTO categories (slug, label, icon_key) VALUES ('Bad Slug', 'x', 'users')$q$, '%slug%'),
    'slug format is enforced';
  ASSERT pg_temp.raises($q$UPDATE categories SET color = 'blue' WHERE slug = 'sports'$q$, '%categories_color_hex%'),
    'colour must be hex';
  RAISE NOTICE 'PASS: taxonomy';
END $$;

-- ---------------------------------------------------------------- admin
DO $$
DECLARE v_first text;
BEGIN
  PERFORM pg_temp.as_user((SELECT a FROM ctx));
  ASSERT pg_temp.raises($q$SELECT admin_reorder_categories(ARRAY(SELECT id FROM categories))$q$, '%Admin%'), 'non-admin cannot reorder';
  ASSERT pg_temp.raises($q$SELECT * FROM admin_category_stats()$q$, '%auth%'), 'non-admin cannot read stats';
  PERFORM pg_temp.as_user((SELECT host FROM ctx));
  ASSERT (SELECT is_admin FROM profiles WHERE id = (SELECT host FROM ctx)), 'seed host is admin (precondition)';
  PERFORM admin_reorder_categories(ARRAY(SELECT id FROM categories ORDER BY sort_order DESC));
  SELECT slug INTO v_first FROM categories ORDER BY sort_order LIMIT 1;
  ASSERT v_first = 'family', 'reorder applied (' || v_first || ')';
  ASSERT (SELECT count(*) FROM admin_category_stats()) = (SELECT count(*) FROM categories), 'stats row per category';
  ASSERT pg_temp.raises($q$SELECT admin_reorder_categories(ARRAY(SELECT id FROM categories) || (SELECT id FROM categories LIMIT 1))$q$, '%Duplicate%'),
    'duplicate ids refused';
  RAISE NOTICE 'PASS: admin categories';
END $$;

-- ---------------------------------------------------------------- discovery
INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address, status, publish_state, visibility)
SELECT '91000000-0000-4000-8000-000000000001'::uuid, biz, 'Friday Band Night', 'fixture', cat_music, now() + interval '1 day', now() + interval '1 day 2 hours', 37.7749, -122.4194, 'x', 'active', 'published', 'public' FROM ctx
UNION ALL
SELECT '91000000-0000-4000-8000-000000000002'::uuid, biz, 'Pickup Soccer', 'fixture', cat_sports, now() + interval '1 day', now() + interval '1 day 2 hours', 37.7749, -122.4194, 'x', 'active', 'published', 'public' FROM ctx;
DO $$
DECLARE v_slugs text; v_boost text; v_plain text;
BEGIN
  PERFORM pg_temp.as_anon();
  SELECT string_agg(category_slug, ',') INTO v_slugs FROM get_ranked_events(37.7749, -122.4194, search_query => ' GIG ');
  ASSERT v_slugs = 'live-music', 'synonym search finds the category (' || coalesce(v_slugs, 'none') || ')';
  SELECT string_agg(category_slug, ',') INTO v_slugs FROM get_ranked_events(37.7749, -122.4194, search_query => 'music');
  ASSERT v_slugs = 'live-music', 'label search finds the category';
  SELECT string_agg(category_slug, ',' ORDER BY ord) INTO v_plain
    FROM (SELECT category_slug, row_number() OVER () ord FROM get_ranked_events(37.7749, -122.4194)) t;
  SELECT string_agg(category_slug, ',' ORDER BY ord) INTO v_boost
    FROM (SELECT category_slug, row_number() OVER () ord FROM get_ranked_events(37.7749, -122.4194,
          p_preferred_category_ids => ARRAY[(SELECT cat_sports FROM ctx)])) t;
  ASSERT v_boost LIKE 'sports%', 'preferred category ranks first (' || v_boost || ')';
  ASSERT (SELECT count(*) FROM get_ranked_events(37.7749, -122.4194, p_preferred_category_ids => '{}'))
       = (SELECT count(*) FROM get_ranked_events(37.7749, -122.4194)), 'empty preference array is a no-op';
  RAISE NOTICE 'PASS: discovery search + interests boost';
END $$;

-- ---------------------------------------------------------------- recurrence v2
DO $$
DECLARE v timestamptz;
BEGIN
  v := event_next_occurrence('2026-11-03 19:00+00', true, '{"frequency":"weekly","interval":1,"byWeekday":[2,4]}', 'UTC', '2026-11-09 12:00+00');
  ASSERT v = '2026-11-10 19:00+00', 'weekly byWeekday next (' || v || ')';
  v := event_next_occurrence('2026-11-03 19:00+00', true, '{"frequency":"weekly","interval":2,"byWeekday":[2,4]}', 'UTC', '2026-11-11 12:00+00');
  ASSERT v = '2026-11-17 19:00+00', 'biweekly parity (Monday-based weeks) (' || v || ')';
  v := event_next_occurrence('2026-11-27 20:00+00', true, '{"frequency":"monthly","interval":1,"monthly":"nthWeekday"}', 'UTC', '2026-12-01 12:00+00');
  ASSERT v = '2026-12-25 20:00+00', 'last-Friday monthly (' || v || ')';
  v := event_next_occurrence('2026-11-17 19:00+00', true, '{"frequency":"weekly","interval":1,"byWeekday":[1,3]}', 'UTC', '2026-11-09 12:00+00');
  ASSERT v = '2026-11-18 19:00+00', 'future start that is not an occurrence → first real date';
  v := event_next_occurrence('2026-11-17 19:00+00', true, '{"frequency":"weekly","interval":1}', 'UTC', '2026-11-09 12:00+00');
  ASSERT v = '2026-11-17 19:00+00', 'v1 future start unchanged';
  v := event_next_occurrence('2026-03-03 19:00 Europe/Lisbon', true, '{"frequency":"weekly","interval":1,"byWeekday":[2]}', 'Europe/Lisbon', '2026-04-01 12:00+00');
  ASSERT (v AT TIME ZONE 'Europe/Lisbon')::time = '19:00', 'wall clock kept across DST';
  ASSERT pg_temp.raises($q$UPDATE events SET is_recurring = true, recurrence_pattern = '{"frequency":"weekly","interval":1,"byWeekday":[]}' WHERE id = '91000000-0000-4000-8000-000000000001'$q$, '%invalid_recurrence%'), 'empty byWeekday rejected';
  ASSERT pg_temp.raises($q$UPDATE events SET is_recurring = true, recurrence_pattern = '{"frequency":"daily","interval":1,"monthly":"nthWeekday"}' WHERE id = '91000000-0000-4000-8000-000000000001'$q$, '%invalid_recurrence%'), 'monthly key on daily rejected';
  RAISE NOTICE 'PASS: recurrence v2';
END $$;

-- ---------------------------------------------------------------- series fixture (weekly, started a week ago, next in 60 min)
INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address, status, publish_state, visibility, is_recurring, recurrence_pattern, timezone, max_attendees, waitlist_mode)
SELECT '91000000-0000-4000-8000-000000000010'::uuid, biz, 'Weekly Jam', 'fixture', cat_music,
       date_trunc('minute', now()) - interval '7 days' + interval '60 minutes',
       date_trunc('minute', now()) - interval '7 days' + interval '180 minutes',
       37.7749, -122.4194, 'x', 'active', 'published', 'public', true, '{"frequency":"weekly","interval":1}', 'UTC', 2, 'auto'
FROM ctx;
CREATE TEMP TABLE d AS
SELECT (now() + interval '60 minutes')::date AS d1,
       (now() + interval '60 minutes' + interval '7 days')::date AS d2,
       (now() + interval '60 minutes' + interval '14 days')::date AS d3;
INSERT INTO rsvps (event_id, user_id, status) SELECT '91000000-0000-4000-8000-000000000010', a, 'going' FROM ctx;
UPDATE profiles SET event_reminder_enabled = true, event_reminder_minutes = 60 WHERE id IN (SELECT a FROM ctx UNION SELECT b FROM ctx UNION SELECT host FROM ctx);

-- ---------------------------------------------------------------- exceptions + reminders
DO $$
DECLARE v jsonb; v_next timestamptz; v_n integer;
BEGIN
  PERFORM pg_temp.as_anon();
  PERFORM send_event_reminders();
  SELECT count(*) INTO v_n FROM event_reminder_sent WHERE event_id = '91000000-0000-4000-8000-000000000010';
  ASSERT v_n = 1, 'reminder for a later date of the series (' || v_n || ')';
  PERFORM send_event_reminders();
  ASSERT (SELECT count(*) FROM event_reminder_sent WHERE event_id = '91000000-0000-4000-8000-000000000010') = 1, 'reminder idempotent';

  PERFORM pg_temp.as_user((SELECT b FROM ctx));
  ASSERT pg_temp.raises(format($q$SELECT skip_occurrence('91000000-0000-4000-8000-000000000010', %L)$q$, (SELECT d2 FROM d)), '%not_allowed%'), 'guest cannot skip';
  PERFORM pg_temp.as_user((SELECT host FROM ctx));
  ASSERT pg_temp.raises($q$SELECT skip_occurrence('91000000-0000-4000-8000-000000000010', current_date + 3)$q$, '%does not run%') OR
         (SELECT d1 FROM d) = current_date + 3, 'off-pattern date refused';
  ASSERT pg_temp.raises($q$SELECT skip_occurrence('91000000-0000-4000-8000-000000000010', current_date - 7)$q$, '%passed%'), 'past date refused';

  v := skip_occurrence('91000000-0000-4000-8000-000000000010', (SELECT d1 FROM d), 'Venue closed', true)::jsonb;
  ASSERT v->>'status' = 'cancelled' AND (v->>'notified')::int = 1, 'skip notifies the goer (' || v::text || ')';
  v_next := event_next_effective_occurrence('91000000-0000-4000-8000-000000000010', now());
  ASSERT v_next::date = (SELECT d2 FROM d), 'effective next skips the cancelled date';
  ASSERT (SELECT count(*) FROM event_reminder_sent WHERE event_id = '91000000-0000-4000-8000-000000000010') = 1, 'skip leaves other reminder markers (G14)';

  v := reschedule_occurrence('91000000-0000-4000-8000-000000000010', (SELECT d2 FROM d), now() + interval '7 days 3 hours', now() + interval '7 days 5 hours', NULL, false)::jsonb;
  ASSERT v->>'status' = 'rescheduled', 'reschedule ok';
  v_next := event_next_effective_occurrence('91000000-0000-4000-8000-000000000010', now());
  ASSERT abs(extract(epoch FROM (v_next - (now() + interval '7 days 3 hours')))) < 2, 'effective next uses the moved time';
  ASSERT pg_temp.raises(format($q$SELECT reschedule_occurrence('91000000-0000-4000-8000-000000000010', %L, now() - interval '1 hour', now(), NULL, false)$q$, (SELECT d3 FROM d)), '%future%'), 'cannot move into the past';

  v := restore_occurrence('91000000-0000-4000-8000-000000000010', (SELECT d1 FROM d), false)::jsonb;
  ASSERT v->>'status' = 'restored', 'restore ok';
  v_next := event_next_effective_occurrence('91000000-0000-4000-8000-000000000010', now());
  ASSERT v_next::date = (SELECT d1 FROM d), 'restored date is next again';
  ASSERT (restore_occurrence('91000000-0000-4000-8000-000000000010', (SELECT d1 FROM d), false)::jsonb)->>'status' = 'unchanged', 'restore twice is a no-op';

  PERFORM pg_temp.as_user((SELECT b FROM ctx));
  SET LOCAL ROLE authenticated;
  ASSERT (SELECT count(*) FROM event_occurrence_exceptions WHERE event_id = '91000000-0000-4000-8000-000000000010') = 1, 'attendees can read exceptions';
  ASSERT pg_temp.raises($q$INSERT INTO event_occurrence_exceptions (event_id, occurrence_date, kind) VALUES ('91000000-0000-4000-8000-000000000010', current_date + 30, 'cancelled')$q$, '%'), 'no direct writes';
  RESET ROLE;
  RAISE NOTICE 'PASS: exceptions, effective next, per-date reminders';
END $$;

-- ---------------------------------------------------------------- per-date RSVP, capacity, waitlist
DO $$
DECLARE v jsonb; v_going bigint; v_wait bigint; v_page jsonb; v_b uuid;
BEGIN
  -- A goes to the series (cap 2). Host opts in as a second seat on d3; B then waitlists.
  PERFORM pg_temp.as_user((SELECT a FROM ctx));
  v := set_occurrence_rsvp('91000000-0000-4000-8000-000000000010', (SELECT d3 FROM d), 'not_going')::jsonb;
  ASSERT v->>'status' = 'not_going', 'series goer opts out of one date';
  ASSERT pg_temp.raises($q$SELECT set_occurrence_rsvp('91000000-0000-4000-8000-000000000010', current_date + 2, 'going')$q$, '%does not run%') OR (SELECT d1 FROM d) = current_date + 2, 'off-pattern date refused for RSVP';
  ASSERT pg_temp.raises($q$SELECT set_occurrence_rsvp('91000000-0000-4000-8000-000000000001', current_date + 1, 'going')$q$, '%not_recurring%'), 'one-off events refuse per-date RSVP';

  SELECT going_count, waitlist_count INTO v_going, v_wait FROM get_occurrence_going_counts('91000000-0000-4000-8000-000000000010', ARRAY[(SELECT d3 FROM d)]);
  ASSERT v_going = 0 AND v_wait = 0, 'd3 count after opt-out = 0 (' || v_going || ')';

  PERFORM pg_temp.as_user((SELECT host FROM ctx));
  PERFORM set_occurrence_rsvp('91000000-0000-4000-8000-000000000010', (SELECT d3 FROM d), 'going');
  PERFORM pg_temp.as_user((SELECT b FROM ctx));
  PERFORM set_occurrence_rsvp('91000000-0000-4000-8000-000000000010', (SELECT d3 FROM d), 'going');
  SELECT going_count, waitlist_count INTO v_going, v_wait FROM get_occurrence_going_counts('91000000-0000-4000-8000-000000000010', ARRAY[(SELECT d3 FROM d)]);
  ASSERT v_going = 2 AND v_wait = 0, 'two date-only goers fill the cap (' || v_going || '/' || v_wait || ')';

  -- A comes back on d3 → the date is full → waitlist (mode auto)
  PERFORM pg_temp.as_user((SELECT a FROM ctx));
  v := set_occurrence_rsvp('91000000-0000-4000-8000-000000000010', (SELECT d3 FROM d), NULL)::jsonb;  -- clear opt-out: series goer, no cap check
  SELECT going_count INTO v_going FROM get_occurrence_going_counts('91000000-0000-4000-8000-000000000010', ARRAY[(SELECT d3 FROM d)]);
  ASSERT v_going = 3, 'series goer returning is never waitlisted (counted at series join) (' || v_going || ')';
  PERFORM set_occurrence_rsvp('91000000-0000-4000-8000-000000000010', (SELECT d3 FROM d), 'not_going');

  -- B leaves d3, host stays; a newcomer (A, pretending via date-only) cannot: use B again as waitlister after refilling
  PERFORM pg_temp.as_user((SELECT b FROM ctx));
  PERFORM set_occurrence_rsvp('91000000-0000-4000-8000-000000000010', (SELECT d3 FROM d), NULL);
  -- Fill with A as date-only? A is a series goer. Use the host (date) + a second date-only: only 3 profiles, so test waitlist via cap 1.
  UPDATE events SET max_attendees = 1 WHERE id = '91000000-0000-4000-8000-000000000010';
  v := set_occurrence_rsvp('91000000-0000-4000-8000-000000000010', (SELECT d3 FROM d), 'going')::jsonb;  -- host holds the single seat
  ASSERT v->>'status' = 'waitlist', 'full date → waitlist (' || v::text || ')';
  SELECT going_count, waitlist_count INTO v_going, v_wait FROM get_occurrence_going_counts('91000000-0000-4000-8000-000000000010', ARRAY[(SELECT d3 FROM d)]);
  ASSERT v_going = 1 AND v_wait = 1, 'counts show 1 going, 1 waiting';

  -- Host steps back → auto-promotes B and tells them
  PERFORM pg_temp.as_user((SELECT host FROM ctx));
  PERFORM set_occurrence_rsvp('91000000-0000-4000-8000-000000000010', (SELECT d3 FROM d), NULL);
  ASSERT (SELECT status FROM rsvp_occurrences WHERE event_id = '91000000-0000-4000-8000-000000000010' AND user_id = (SELECT b FROM ctx) AND occurrence_date = (SELECT d3 FROM d)) = 'going', 'auto mode promotes the waitlisted user';
  ASSERT EXISTS (SELECT 1 FROM notifications WHERE event_id = '91000000-0000-4000-8000-000000000010' AND user_id = (SELECT b FROM ctx) AND type = 'waitlist'), 'promoted user is notified';

  -- notify mode: a freed seat pings but does not promote
  UPDATE events SET waitlist_mode = 'notify' WHERE id = '91000000-0000-4000-8000-000000000010';
  PERFORM set_occurrence_rsvp('91000000-0000-4000-8000-000000000010', (SELECT d3 FROM d), 'going');   -- host waitlists behind B
  ASSERT (SELECT status FROM rsvp_occurrences WHERE event_id = '91000000-0000-4000-8000-000000000010' AND user_id = (SELECT host FROM ctx) AND occurrence_date = (SELECT d3 FROM d)) = 'waitlist', 'second person waits';
  PERFORM pg_temp.as_user((SELECT b FROM ctx));
  PERFORM set_occurrence_rsvp('91000000-0000-4000-8000-000000000010', (SELECT d3 FROM d), NULL);
  ASSERT (SELECT status FROM rsvp_occurrences WHERE event_id = '91000000-0000-4000-8000-000000000010' AND user_id = (SELECT host FROM ctx) AND occurrence_date = (SELECT d3 FROM d)) = 'waitlist', 'notify mode does not promote';
  ASSERT EXISTS (SELECT 1 FROM notifications WHERE event_id = '91000000-0000-4000-8000-000000000010' AND user_id = (SELECT host FROM ctx) AND type = 'waitlist' AND data->>'kind' = 'occurrence_waitlist_spot'), 'notify mode pings the waitlisted user';

  -- off mode: hard refusal
  UPDATE events SET waitlist_mode = 'off' WHERE id = '91000000-0000-4000-8000-000000000010';
  PERFORM pg_temp.as_user((SELECT host FROM ctx));
  PERFORM set_occurrence_rsvp('91000000-0000-4000-8000-000000000010', (SELECT d3 FROM d), 'going');  -- takes the free seat
  PERFORM pg_temp.as_user((SELECT b FROM ctx));
  ASSERT pg_temp.raises(format($q$SELECT set_occurrence_rsvp('91000000-0000-4000-8000-000000000010', %L, 'going')$q$, (SELECT d3 FROM d)), '%event_full%'), 'waitlist off → event_full';

  -- private event is still capacity-checked (review fix)
  UPDATE events SET visibility = 'unlisted' WHERE id = '91000000-0000-4000-8000-000000000010';
  ASSERT pg_temp.raises(format($q$SELECT set_occurrence_rsvp('91000000-0000-4000-8000-000000000010', %L, 'going')$q$, (SELECT d3 FROM d)), '%event_full%'), 'capacity enforced on non-public events';
  UPDATE events SET visibility = 'public', max_attendees = 2, waitlist_mode = 'auto' WHERE id = '91000000-0000-4000-8000-000000000010';

  -- host per-date list
  PERFORM pg_temp.as_user((SELECT host FROM ctx));
  v_page := get_occurrence_attendees_page('91000000-0000-4000-8000-000000000010', (SELECT d3 FROM d))::jsonb;
  ASSERT (v_page->>'total')::int = 1 AND v_page->'items'->0->>'via' = 'date', 'per-date attendee list (' || v_page::text || ')';
  PERFORM pg_temp.as_user((SELECT b FROM ctx));
  ASSERT pg_temp.raises(format($q$SELECT get_occurrence_attendees_page('91000000-0000-4000-8000-000000000010', %L)$q$, (SELECT d3 FROM d)), '%not_allowed%'), 'guests cannot list attendees';

  -- RLS: own rows only (temp tables aren't readable as the restricted role)
  SELECT b INTO v_b FROM ctx;
  SET LOCAL ROLE authenticated;
  ASSERT NOT EXISTS (SELECT 1 FROM rsvp_occurrences WHERE event_id = '91000000-0000-4000-8000-000000000010' AND user_id <> v_b), 'users see only their own per-date rows';
  RESET ROLE;
  RAISE NOTICE 'PASS: per-date RSVP, capacity, waitlist (auto/notify/off), attendee list';
END $$;

-- ---------------------------------------------------------------- reminders honour overrides; leave-series trigger (G19); prune (G13)
DO $$
DECLARE v_n integer;
BEGIN
  PERFORM pg_temp.as_anon();
  DELETE FROM event_reminder_sent WHERE event_id = '91000000-0000-4000-8000-000000000010';
  -- A (series goer) opts out of tonight; host joins tonight only.
  PERFORM pg_temp.as_user((SELECT a FROM ctx));
  PERFORM set_occurrence_rsvp('91000000-0000-4000-8000-000000000010', (SELECT d1 FROM d), 'not_going');
  PERFORM pg_temp.as_user((SELECT host FROM ctx));
  PERFORM set_occurrence_rsvp('91000000-0000-4000-8000-000000000010', (SELECT d1 FROM d), 'going');
  PERFORM pg_temp.as_anon();
  PERFORM send_event_reminders();
  ASSERT (SELECT string_agg(CASE WHEN user_id = (SELECT host FROM ctx) THEN 'host' ELSE 'other' END, ',')
            FROM event_reminder_sent WHERE event_id = '91000000-0000-4000-8000-000000000010') = 'host',
    'tonight''s reminder goes only to the date-only goer';

  -- G19: A leaves the series → not_going rows dropped, date-only going rows (host) kept
  DELETE FROM rsvps WHERE event_id = '91000000-0000-4000-8000-000000000010' AND user_id = (SELECT a FROM ctx);
  ASSERT NOT EXISTS (SELECT 1 FROM rsvp_occurrences WHERE event_id = '91000000-0000-4000-8000-000000000010' AND user_id = (SELECT a FROM ctx)), 'leaving drops not_going overrides';
  ASSERT EXISTS (SELECT 1 FROM rsvp_occurrences WHERE event_id = '91000000-0000-4000-8000-000000000010' AND user_id = (SELECT host FROM ctx) AND status = 'going'), 'date-only going rows survive';

  -- G13: moving the series to Wednesdays prunes rows on the old weekday
  SELECT count(*) INTO v_n FROM rsvp_occurrences WHERE event_id = '91000000-0000-4000-8000-000000000010';
  ASSERT v_n > 0, 'precondition: per-date rows exist';
  PERFORM set_config('eventmap.allow_reschedule', 'true', true);
  UPDATE events SET recurrence_pattern = jsonb_build_object('frequency', 'weekly', 'interval', 1,
      'byWeekday', jsonb_build_array(((extract(dow FROM (SELECT d1 FROM d))::int + 1) % 7)))
   WHERE id = '91000000-0000-4000-8000-000000000010';
  ASSERT (SELECT count(*) FROM rsvp_occurrences WHERE event_id = '91000000-0000-4000-8000-000000000010') = 0, 'orphaned per-date rows pruned';
  ASSERT (SELECT count(*) FROM event_occurrence_exceptions WHERE event_id = '91000000-0000-4000-8000-000000000010') = 0, 'orphaned exceptions pruned';
  RAISE NOTICE 'PASS: reminders honour overrides; leave-series; orphan pruning';
END $$;

-- ---------------------------------------------------------------- split
INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address, status, publish_state, visibility, is_recurring, recurrence_pattern, timezone)
SELECT '91000000-0000-4000-8000-000000000020'::uuid, biz, 'Yoga', 'fixture', cat_sports, '2026-11-02 18:00+00', '2026-11-02 19:00+00', 37.77, -122.41, 'x', 'active', 'published', 'public', true, '{"frequency":"weekly","interval":1,"endDate":"2027-03-01"}', 'UTC' FROM ctx;
INSERT INTO rsvps (event_id, user_id, status) SELECT '91000000-0000-4000-8000-000000000020', b, 'going' FROM ctx;
INSERT INTO event_links (event_id, label, url) VALUES ('91000000-0000-4000-8000-000000000020', 'Tickets', 'https://example.test/t');
DO $$
DECLARE v_new uuid; v_notes integer;
BEGIN
  PERFORM pg_temp.as_user((SELECT host FROM ctx));
  PERFORM skip_occurrence('91000000-0000-4000-8000-000000000020', '2026-11-16', NULL, false);
  PERFORM skip_occurrence('91000000-0000-4000-8000-000000000020', '2026-12-07', NULL, false);
  PERFORM pg_temp.as_user((SELECT b FROM ctx));
  PERFORM set_occurrence_rsvp('91000000-0000-4000-8000-000000000020', '2026-12-14', 'not_going');
  PERFORM pg_temp.as_user((SELECT host FROM ctx));
  ASSERT pg_temp.raises($q$SELECT split_series_from('91000000-0000-4000-8000-000000000020', '2026-11-02')$q$, '%first%'), 'cannot split at the first date';
  ASSERT pg_temp.raises($q$SELECT split_series_from('91000000-0000-4000-8000-000000000020', '2026-11-03')$q$, '%does not run%'), 'cannot split on an off-pattern date';
  SELECT count(*) INTO v_notes FROM notifications;
  v_new := split_series_from('91000000-0000-4000-8000-000000000020', '2026-11-30');
  ASSERT (SELECT recurrence_pattern->>'endDate' FROM events WHERE id = '91000000-0000-4000-8000-000000000020') = '2026-11-29', 'original ends the day before';
  ASSERT (SELECT start_datetime FROM events WHERE id = v_new) = '2026-11-30 18:00+00', 'new series starts at the split date';
  ASSERT (SELECT publish_state FROM events WHERE id = v_new) = 'published', 'new series published';
  ASSERT (SELECT count(*) FROM rsvps WHERE event_id = v_new AND status = 'going') = 1, 'going RSVPs copied';
  ASSERT (SELECT count(*) FROM event_links WHERE event_id = v_new) = 1, 'links copied';
  ASSERT (SELECT string_agg(occurrence_date::text, ',') FROM event_occurrence_exceptions WHERE event_id = '91000000-0000-4000-8000-000000000020') = '2026-11-16', 'earlier exception stays';
  ASSERT (SELECT string_agg(occurrence_date::text, ',') FROM event_occurrence_exceptions WHERE event_id = v_new) = '2026-12-07', 'later exception moved (prune-safe ordering)';
  ASSERT (SELECT count(*) FROM rsvp_occurrences WHERE event_id = v_new) = 1, 'later per-date RSVP moved';
  ASSERT (SELECT count(*) FROM notifications) = v_notes, 'split sends no notifications';
  RAISE NOTICE 'PASS: split series';
END $$;

-- ---------------------------------------------------------------- interest notifications
DO $$
DECLARE v_n integer;
BEGIN
  UPDATE profiles SET preferred_categories = ARRAY[(SELECT cat_music FROM ctx)], lat = 37.775, lng = -122.418,
         notification_preferences = COALESCE(notification_preferences, '{}') || '{"interest_events":true}' WHERE id = (SELECT b FROM ctx);
  UPDATE profiles SET preferred_categories = ARRAY[(SELECT cat_music FROM ctx)], lat = 37.775, lng = -122.418,
         notification_preferences = COALESCE(notification_preferences, '{}') - 'interest_events' WHERE id = (SELECT a FROM ctx);
  DELETE FROM follows WHERE user_id IN (SELECT a FROM ctx UNION SELECT b FROM ctx);
  DELETE FROM notifications WHERE type = 'interest_event';
  INSERT INTO events (business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address, status, publish_state, visibility)
  SELECT biz, 'Saturday Gig', 'fx', cat_music, now() + interval '3 days', now() + interval '3 days 2 hours', 37.7749, -122.4194, 'x', 'active', 'published', 'public' FROM ctx;
  ASSERT (SELECT count(*) FROM notifications WHERE type = 'interest_event' AND user_id = (SELECT b FROM ctx)) = 1, 'opted-in nearby user notified';
  ASSERT (SELECT count(*) FROM notifications WHERE type = 'interest_event' AND user_id = (SELECT a FROM ctx)) = 0, 'not opted-in → nothing';
  INSERT INTO events (business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address, status, publish_state, visibility)
  SELECT biz, 'Sunday Gig', 'fx', cat_music, now() + interval '4 days', now() + interval '4 days 2 hours', 37.7749, -122.4194, 'x', 'active', 'published', 'public' FROM ctx;
  ASSERT (SELECT count(*) FROM notifications WHERE type = 'interest_event' AND user_id = (SELECT b FROM ctx)) = 1, 'at most one per day';
  DELETE FROM notifications WHERE type = 'interest_event';
  INSERT INTO events (business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address, status, publish_state, visibility)
  SELECT biz, 'Far Gig', 'fx', cat_music, now() + interval '5 days', now() + interval '5 days 2 hours', 38.5, -121.5, 'x', 'active', 'published', 'public' FROM ctx;
  ASSERT (SELECT count(*) FROM notifications WHERE type = 'interest_event') = 0, 'too far → nothing';
  INSERT INTO events (business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address, status, publish_state, visibility)
  SELECT biz, 'Draft Gig', 'fx', cat_music, now() + interval '6 days', now() + interval '6 days 2 hours', 37.7749, -122.4194, 'x', 'active', 'draft', 'public' FROM ctx;
  ASSERT (SELECT count(*) FROM notifications WHERE type = 'interest_event') = 0, 'drafts do not notify';
  RAISE NOTICE 'PASS: interest notifications';
END $$;

DO $$ BEGIN RAISE NOTICE 'categories + series regression suite: ALL CHECKS PASSED'; END $$;
ROLLBACK;
