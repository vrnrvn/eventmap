-- Regression suite for 20261104100000_event_insights.sql (get_event_insights,
-- hardened get_business_analytics, business_has_premium).
--
-- Runs ONLY against an isolated scratch copy, inside one transaction that is
-- rolled back; every check is an ASSERT (db-scratch.sh apply stops on error):
--
--   SCRATCH_DB=eventmap_scratch_<yours> scripts/db-scratch.sh refresh
--   SCRATCH_DB=... scripts/db-scratch.sh apply supabase/migrations/20261104100000_event_insights.sql
--   SCRATCH_DB=... scripts/db-scratch.sh apply scripts/test-event-insights.sql
--
-- Grants are checked through the catalog. Do NOT switch to the anon role in
-- psql suites on this Postgres build: `SET role anon` + a pg_temp function
-- call segfaulted the backend on 2026-11-04 and crash-restarted the cluster.

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

DO $$ BEGIN RAISE NOTICE 'event insights regression suite starting'; END $$;

-- ── Fixtures ──────────────────────────────────────────────────────────────────

CREATE TEMP TABLE fx AS
SELECT
  '10000000-0000-4000-8000-000000000001'::uuid AS host,
  '10000000-0000-4000-8000-000000000002'::uuid AS alex,
  '10000000-0000-4000-8000-000000000003'::uuid AS sam,
  (SELECT id FROM businesses b WHERE b.owner_id = '10000000-0000-4000-8000-000000000001') AS biz,
  (SELECT id FROM categories ORDER BY slug LIMIT 1) AS cat,
  'd0000000-0000-4000-8000-000000000001'::uuid AS ev,       -- the event under test
  'd0000000-0000-4000-8000-000000000002'::uuid AS past_ev,  -- earlier event, sam went
  'd0000000-0000-4000-8000-000000000003'::uuid AS draft_ev, -- draft with views
  'd0000000-0000-4000-8000-000000000004'::uuid AS gone_ev,  -- cancelled, upcoming
  'd0000000-0000-4000-8000-000000000005'::uuid AS series,   -- recurring
  'd0000000-0000-4000-8000-000000000011'::uuid AS o1,
  'd0000000-0000-4000-8000-000000000012'::uuid AS o2,
  'd0000000-0000-4000-8000-000000000013'::uuid AS o3;
GRANT SELECT ON fx TO authenticated;

-- The seeded demo host is also an admin, and admins get the premium payload
-- on purpose; test the host as a plain owner and check admins separately (4.x).
UPDATE profiles SET is_admin = false WHERE id IN (SELECT host FROM fx);

-- Start free; sections flip the tier as postgres (the subscription guard
-- allows writes without a JWT).
UPDATE businesses SET subscription_tier = 'free', subscription_expires_at = NULL WHERE id IN (SELECT biz FROM fx);

INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime,
                    lat, lng, address, max_attendees, publish_state, is_recurring, recurrence_pattern, timezone)
SELECT v.id, f.biz, v.title, 'Insights suite', f.cat, v.s, v.s + interval '2 hours', 37.77, -122.41, 'Synthetic',
       v.cap, v.pub, v.rec, v.pat, 'Europe/Lisbon'
FROM fx f, LATERAL (VALUES
  (f.ev,       'Insights event', now() + interval '1 day',  4::int,    'published', false, NULL::jsonb),
  (f.past_ev,  'Past event',     now() + interval '2 days', NULL,      'published', false, NULL),
  (f.draft_ev, 'Draft event',    now() + interval '3 days', NULL,      'draft',     false, NULL),
  (f.gone_ev,  'Cancelled event',now() + interval '4 days', NULL,      'published', false, NULL),
  (f.series,   'Weekly series',  now() + interval '5 days', NULL,      'published', true,  '{"frequency":"weekly","interval":1}'::jsonb),
  (f.o1,       'Other 1',        now() + interval '6 days', NULL,      'published', false, NULL),
  (f.o2,       'Other 2',        now() + interval '7 days', NULL,      'published', false, NULL),
  (f.o3,       'Other 3',        now() + interval '8 days', NULL,      'published', false, NULL)
) AS v(id, title, s, cap, pub, rec, pat);

-- Alex must be a first-timer at this business: drop the seeded RSVPs.
DELETE FROM rsvps WHERE user_id IN (SELECT alex FROM fx)
  AND event_id IN (SELECT e.id FROM events e WHERE e.business_id IN (SELECT biz FROM fx));

-- RSVPs with known creation times (allow_approval: seeding bypass for closed events).
SELECT set_config('eventmap.allow_approval', 'true', true);
INSERT INTO rsvps (user_id, event_id, status, created_at) SELECT alex, ev, 'going', now() - interval '9 days' FROM fx;  -- lead 10 d
INSERT INTO rsvps (user_id, event_id, status, created_at) SELECT sam,  ev, 'going', now() - interval '1 day'  FROM fx;  -- lead 2 d
INSERT INTO rsvps (user_id, event_id, status) SELECT sam,  past_ev, 'going' FROM fx;
INSERT INTO rsvps (user_id, event_id, status) SELECT alex, series,  'going' FROM fx;
SELECT set_config('eventmap.allow_approval', '', true);
-- Move the "past" event into the past now that sam is on it.
SELECT set_config('eventmap.allow_reschedule', 'true', true);
UPDATE events SET start_datetime = now() - interval '30 days', end_datetime = now() - interval '30 days' + interval '2 hours'
WHERE id IN (SELECT past_ev FROM fx);
SELECT set_config('eventmap.allow_reschedule', '', true);
SELECT set_config('eventmap.allow_status_change', 'true', true);
UPDATE events SET status = 'cancelled' WHERE id IN (SELECT gone_ev FROM fx);
SELECT set_config('eventmap.allow_status_change', '', true);

INSERT INTO event_views (event_id, viewer_id, viewed_at, view_date)
SELECT x.ev, x.viewer, x.at, (x.at AT TIME ZONE 'UTC')::date FROM fx f, LATERAL (VALUES
  (f.ev, f.alex, now() - interval '2 days'),
  (f.ev, f.sam,  now() - interval '1 day'),
  (f.ev, f.alex, now() - interval '40 days'),     -- outside the 30-day window
  (f.draft_ev, f.alex, now() - interval '1 day'),
  (f.draft_ev, f.sam,  now() - interval '1 day'),
  (f.o1, f.alex, now() - interval '1 day'),
  (f.o2, f.alex, now() - interval '1 day'), (f.o2, f.sam, now() - interval '1 day'),
  (f.o3, f.alex, now() - interval '1 day'), (f.o3, f.sam, now() - interval '1 day'), (f.o3, f.host, now() - interval '1 day')
) AS x(ev, viewer, at);

INSERT INTO saves (user_id, event_id, created_at) SELECT alex, ev, now() - interval '3 days' FROM fx;
INSERT INTO follows (user_id, business_id) SELECT alex, biz FROM fx ON CONFLICT DO NOTHING;
DELETE FROM follows WHERE user_id IN (SELECT sam FROM fx) AND business_id IN (SELECT biz FROM fx);
INSERT INTO host_announcements (event_id, created_by, body, audience, recipients)
SELECT ev, host, 'Doors at 7', 'going', 2 FROM fx;
INSERT INTO notifications (user_id, type, title, body, event_id, read)
SELECT alex, 'host_announcement', 'Doors at 7', 'x', ev, true FROM fx
UNION ALL SELECT sam, 'host_announcement', 'Doors at 7', 'x', ev, false FROM fx;

-- ── 1. Guards and grants ─────────────────────────────────────────────────────

SELECT pg_temp.expect_error('1.1 anonymous',
  format('SELECT get_event_insights(%L)', (SELECT ev FROM fx)), '%not_authenticated%');
SELECT pg_temp.login(alex) FROM fx;
SELECT pg_temp.expect_error('1.2 not the host',
  format('SELECT get_event_insights(%L)', (SELECT ev FROM fx)), '%only the event host%');
SELECT pg_temp.expect_error('1.3 unknown event',
  'SELECT get_event_insights(''00000000-0000-4000-8000-000000000000'')', '%event_not_found%');
SELECT pg_temp.expect_error('1.4 business analytics, not the owner',
  format('SELECT get_business_analytics(%L)', (SELECT biz FROM fx)), '%not authorized%');
SELECT pg_temp.logout();
DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.get_event_insights(uuid, integer)', 'EXECUTE'), '[1.5] anon: insights';
  ASSERT NOT has_function_privilege('anon', 'public.get_business_analytics(uuid, integer)', 'EXECUTE'), '[1.6] anon: business analytics';
  ASSERT has_function_privilege('authenticated', 'public.get_event_insights(uuid, integer)', 'EXECUTE'), '[1.7] authenticated: insights';
END $$;

-- ── 2. Free tier: counts and funnel only ─────────────────────────────────────

DO $$
DECLARE f fx%ROWTYPE; j json; t json; exp_views int; exp_posts int; exp_upcoming int;
BEGIN
  SELECT * INTO f FROM fx;
  -- Expectations computed as postgres: under the authenticated role RLS would
  -- hide other people's view rows from these subqueries.
  SELECT COUNT(*) INTO exp_views FROM event_views v JOIN events e ON e.id = v.event_id
    WHERE e.business_id = f.biz AND e.publish_state = 'published';
  SELECT COUNT(*) INTO exp_posts FROM events e WHERE e.business_id = f.biz AND e.publish_state = 'published';
  SELECT COUNT(*) INTO exp_upcoming FROM events e
    WHERE e.business_id = f.biz AND e.publish_state = 'published' AND e.status <> 'cancelled'
      AND NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone);
  PERFORM pg_temp.login(f.host);
  j := get_event_insights(f.ev, 7);
  t := j->'totals';
  ASSERT j->>'tier' = 'free', '[2.1] tier free';
  ASSERT (j->>'period_days')::int = 30, '[2.2] free window is fixed at 30 days';
  ASSERT (t->>'views')::int = 3 AND (t->>'unique_viewers')::int = 2 AND (t->>'views_period')::int = 2,
    format('[2.3] view counts, got %s', t);
  ASSERT (t->>'saves')::int = 1 AND (t->>'going')::int = 2, format('[2.4] saves/going, got %s', t);
  ASSERT (t->>'fill_rate')::numeric = 0.5, format('[2.5] fill rate 2/4, got %s', t->>'fill_rate');
  ASSERT (t->>'view_to_going')::numeric = 1 AND (t->>'view_to_save')::numeric = 0.5, '[2.6] funnel ratios';
  ASSERT json_typeof(j->'trend') = 'null' AND json_typeof(j->'lead_time') = 'null'
     AND json_typeof(j->'audience') = 'null' AND json_typeof(j->'announcements') = 'null'
     AND json_typeof(j->'chat') = 'null' AND json_typeof(j->'business_median') = 'null',
    '[2.7] premium sections are null on free';
  ASSERT j->'event'->>'title' = 'Insights event', '[2.8] event header';

  j := get_business_analytics(f.biz, 90);
  ASSERT j->>'tier' = 'free' AND (j->>'periodDays')::int = 30, '[2.9] business: free, 30 days';
  ASSERT json_typeof(j->'trend') = 'null' AND json_typeof(j->'topEvents') = 'null', '[2.10] business: trend/top null on free';
  ASSERT (j->>'totalViews')::int = exp_views, format('[2.11] business: drafts excluded from views (%s vs %s)', j->>'totalViews', exp_views);
  ASSERT (j->>'totalPosts')::int = exp_posts, format('[2.12] business: drafts excluded from posts (%s vs %s)', j->>'totalPosts', exp_posts);
  ASSERT (j->>'upcomingEvents')::int = exp_upcoming,
    format('[2.13] business: upcoming skips cancelled and ended (%s vs %s)', j->>'upcomingEvents', exp_upcoming);
  PERFORM pg_temp.logout();
END $$;

-- An expired premium subscription is still free.
UPDATE businesses SET subscription_tier = 'premium', subscription_expires_at = now() - interval '1 day' WHERE id IN (SELECT biz FROM fx);
DO $$
DECLARE f fx%ROWTYPE;
BEGIN
  SELECT * INTO f FROM fx;
  ASSERT NOT business_has_premium(f.biz), '[2.14] expired premium is not premium';
  PERFORM pg_temp.login(f.host);
  ASSERT get_event_insights(f.ev)->>'tier' = 'free', '[2.15] expired premium gets the free payload';
  PERFORM pg_temp.logout();
END $$;

-- ── 3. Premium tier ──────────────────────────────────────────────────────────

UPDATE businesses SET subscription_tier = 'premium', subscription_expires_at = now() + interval '30 days' WHERE id IN (SELECT biz FROM fx);

DO $$
DECLARE f fx%ROWTYPE; j json; last json;
BEGIN
  SELECT * INTO f FROM fx;
  PERFORM pg_temp.login(f.host);
  j := get_event_insights(f.ev, 7);
  ASSERT j->>'tier' = 'premium' AND (j->>'period_days')::int = 7, '[3.1] premium honours the window';
  ASSERT (get_event_insights(f.ev, 1)->>'period_days')::int = 7, '[3.2] window clamps up to 7';
  ASSERT (get_event_insights(f.ev, 1000)->>'period_days')::int = 365, '[3.3] window clamps down to 365';

  ASSERT json_array_length(j->'trend') = 7, format('[3.4] 7 trend points, got %s', json_array_length(j->'trend'));
  last := j->'trend'->6;
  ASSERT (last->>'going_cumulative')::int = 2, format('[3.5] cumulative going ends at 2, got %s', last);
  ASSERT (SELECT SUM((p->>'views')::int) FROM json_array_elements(j->'trend') p) = 2, '[3.6] trend views inside window';

  ASSERT (j->'lead_time'->>'available')::boolean
     AND (j->'lead_time'->>'d8_14')::int = 1 AND (j->'lead_time'->>'d1_3')::int = 1
     AND (j->'lead_time'->>'same_day')::int = 0, format('[3.7] lead-time buckets, got %s', j->'lead_time');

  ASSERT (j->'audience'->>'followers_going')::int = 1, format('[3.8] followers going, got %s', j->'audience');
  ASSERT (j->'audience'->>'returning_going')::int = 1 AND (j->'audience'->>'first_time_going')::int = 1,
    format('[3.9] sam is returning, alex first-time, got %s', j->'audience');

  ASSERT (j->'announcements'->>'sent')::int = 1 AND (j->'announcements'->>'recipients')::int = 2
     AND (j->'announcements'->>'read')::int = 1, format('[3.10] announcement reach, got %s', j->'announcements');
  ASSERT (j->'chat'->>'messages') IS NOT NULL, '[3.11] chat section present';

  -- Other published, non-cancelled events: past_ev, series, o1, o2, o3 (+ seeded ones).
  ASSERT json_typeof(j->'business_median') = 'object' AND (j->'business_median'->>'events')::int >= 3,
    format('[3.12] median over >= 3 events, got %s', j->'business_median');

  ASSERT get_event_insights(f.series)->'lead_time'->>'available' = 'false', '[3.13] no lead time for series';

  j := get_business_analytics(f.biz, 7);
  ASSERT j->>'tier' = 'premium' AND (j->>'periodDays')::int = 7, '[3.14] business: premium window';
  ASSERT json_array_length(j->'trend') = 7, '[3.15] business: trend length';
  ASSERT json_array_length(j->'topEvents') BETWEEN 1 AND 5, '[3.16] business: top events';
  ASSERT NOT EXISTS (SELECT 1 FROM json_array_elements(j->'topEvents') te WHERE te->>'id' = f.draft_ev::text),
    '[3.17] business: drafts never ranked';
  ASSERT (j->'topEvents'->0->>'start_datetime') IS NOT NULL AND (j->'topEvents'->0->>'status') IS NOT NULL,
    '[3.18] business: top events carry start and status';
  PERFORM pg_temp.logout();
END $$;

-- ── 4. Admins: premium payload on any business ───────────────────────────────

UPDATE businesses SET subscription_tier = 'free', subscription_expires_at = NULL WHERE id IN (SELECT biz FROM fx);
UPDATE profiles SET is_admin = true WHERE id IN (SELECT alex FROM fx);
DO $$
DECLARE f fx%ROWTYPE; j json;
BEGIN
  SELECT * INTO f FROM fx;
  PERFORM pg_temp.login(f.alex);
  j := get_event_insights(f.ev, 90);
  ASSERT j->>'tier' = 'premium' AND (j->>'period_days')::int = 90 AND json_typeof(j->'trend') = 'array',
    '[4.1] an admin sees the premium payload of a free business';
  ASSERT get_business_analytics(f.biz)->>'tier' = 'premium', '[4.2] admin: business analytics';
  PERFORM pg_temp.logout();
END $$;

-- ── 5. Taps and RSVP history (20261104090000) ────────────────────────────────

UPDATE profiles SET is_admin = false WHERE id IN (SELECT alex FROM fx);
UPDATE businesses SET subscription_tier = 'premium', subscription_expires_at = NULL WHERE id IN (SELECT biz FROM fx);

DO $$
DECLARE f fx%ROWTYPE; n int;
BEGIN
  SELECT * INTO f FROM fx;
  ASSERT NOT has_function_privilege('anon', 'public.track_event_interaction(uuid, text)', 'EXECUTE'), '[5.1] anon cannot track';
  ASSERT NOT has_table_privilege('authenticated', 'public.event_interactions', 'SELECT'), '[5.2] interactions not readable';
  ASSERT NOT has_table_privilege('authenticated', 'public.rsvp_history', 'SELECT'), '[5.3] history not readable';

  PERFORM pg_temp.login(f.alex);
  PERFORM track_event_interaction(f.ev, 'share');
  PERFORM track_event_interaction(f.ev, 'share');       -- same day: deduped
  PERFORM track_event_interaction(f.ev, 'ticket');
  PERFORM track_event_interaction(f.draft_ev, 'share'); -- drafts don't count
  PERFORM pg_temp.login(f.host);
  PERFORM track_event_interaction(f.ev, 'calendar');    -- host's own tap skipped
  PERFORM pg_temp.logout();
  PERFORM track_event_interaction(f.ev, 'directions');  -- no JWT: no-op

  SELECT COUNT(*) INTO n FROM event_interactions WHERE event_id = f.ev;
  ASSERT n = 2, format('[5.4] one share + one ticket recorded, got %s', n);
  ASSERT NOT EXISTS (SELECT 1 FROM event_interactions WHERE event_id = f.draft_ev), '[5.5] no taps on drafts';
END $$;

SELECT pg_temp.login(alex) FROM fx;
SELECT pg_temp.expect_error('5.6 invalid kind',
  format('SELECT track_event_interaction(%L, ''like'')', (SELECT ev FROM fx)), '%invalid_kind%');
-- Alex steps down to interested, the app's way.
SELECT join_event_with_capacity((SELECT ev FROM fx), 'interested');
-- Sam leaves.
SELECT pg_temp.login(sam) FROM fx;
DELETE FROM rsvps WHERE event_id = (SELECT ev FROM fx) AND user_id = (SELECT sam FROM fx);
SELECT pg_temp.logout();

DO $$
DECLARE f fx%ROWTYPE; j json; c json;
BEGIN
  SELECT * INTO f FROM fx;
  ASSERT EXISTS (SELECT 1 FROM rsvp_history WHERE event_id = f.ev AND user_id = f.alex
                 AND from_status = 'going' AND to_status = 'interested' AND changed_by = f.alex), '[5.7] downgrade recorded';
  ASSERT EXISTS (SELECT 1 FROM rsvp_history WHERE event_id = f.ev AND user_id = f.sam
                 AND from_status = 'going' AND to_status = 'left'), '[5.8] self-delete recorded as left';

  -- A host removal is "removed", not "left".
  INSERT INTO rsvps (user_id, event_id, status) VALUES (f.sam, f.o1, 'going');
  PERFORM pg_temp.login(f.host);
  PERFORM host_remove_attendee(f.o1, f.sam, NULL, false);
  PERFORM pg_temp.logout();
  ASSERT EXISTS (SELECT 1 FROM rsvp_history WHERE event_id = f.o1 AND user_id = f.sam AND to_status = 'removed'),
    '[5.9] host removal recorded as removed';

  PERFORM pg_temp.login(f.host);
  j := get_event_insights(f.ev, 30);
  ASSERT (j->'interactions'->>'share')::int = 1 AND (j->'interactions'->>'ticket')::int = 1
     AND (j->'interactions'->>'calendar')::int = 0, format('[5.10] tap counts, got %s', j->'interactions');
  c := j->'rsvp_changes';
  ASSERT (c->>'left')::int = 1 AND (c->>'downgraded')::int = 1 AND (c->>'tracked_since') IS NOT NULL,
    format('[5.11] RSVP changes, got %s', c);
  ASSERT (get_business_analytics(f.biz, 30)->'interactionTotals'->>'share')::int >= 1, '[5.12] business tap totals';
  PERFORM pg_temp.logout();

  UPDATE businesses SET subscription_tier = 'free' WHERE id = f.biz;
  PERFORM pg_temp.login(f.host);
  j := get_event_insights(f.ev, 30);
  ASSERT json_typeof(j->'interactions') = 'null' AND json_typeof(j->'rsvp_changes') = 'null', '[5.13] premium-only on free';
  ASSERT json_typeof(get_business_analytics(f.biz)->'interactionTotals') = 'null', '[5.14] business taps premium-only';
  PERFORM pg_temp.logout();

  -- History never blocks deleting an event with RSVPs (cascade).
  INSERT INTO rsvps (user_id, event_id, status) VALUES (f.alex, f.o2, 'going');
  DELETE FROM events WHERE id = f.o2;
  ASSERT NOT EXISTS (SELECT 1 FROM events WHERE id = f.o2), '[5.15] event with RSVPs deletes cleanly';
  ASSERT NOT EXISTS (SELECT 1 FROM rsvp_history WHERE event_id = f.o2), '[5.16] its history goes with it';
END $$;

DO $$ BEGIN RAISE NOTICE 'event insights regression suite: all assertions passed'; END $$;

ROLLBACK;
