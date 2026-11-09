-- Exercise the profile attendance RPCs against an isolated scratch database.
-- Runs entirely inside one transaction and rolls back, so the scratch copy is
-- left untouched. Intended usage:
--
--   scripts/db-scratch.sh refresh
--   scripts/db-scratch.sh apply supabase/migrations/20261029110000_profile_attendance_history.sql
--   scripts/db-scratch.sh apply scripts/test-attendance-rpcs.sql
--
-- Uses the seeded demo accounts (host / alex / sam) and creates disposable
-- events. Every check raises on failure, so a clean run prints only NOTICEs.

\set ON_ERROR_STOP on
BEGIN;

-- Impersonation helper: mimic what PostgREST sets for an authenticated user.
CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_user IS NULL THEN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('role', 'anon', true);
  ELSE
    PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS: %', p_label;
END;
$$;

-- Seeded ids
\set host  '10000000-0000-4000-8000-000000000001'
\set alex  '10000000-0000-4000-8000-000000000002'
\set sam   '10000000-0000-4000-8000-000000000003'
\set biz   '20000000-0000-4000-8000-000000000001'
\set ev1   '30000000-0000-4000-8000-000000000001'
\set ev2   '30000000-0000-4000-8000-000000000002'

-- Disposable fixtures (ids in a 3f.. block that the seed never uses)
\set past_ev     '3f000000-0000-4000-8000-000000000001'
\set live_ev     '3f000000-0000-4000-8000-000000000002'
\set rec_done    '3f000000-0000-4000-8000-000000000003'
\set rec_open    '3f000000-0000-4000-8000-000000000004'

INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address, is_recurring, recurrence_pattern)
SELECT v.id::uuid, :'biz', v.title, 'attendance rpc test', (SELECT id FROM categories LIMIT 1),
       v.start_at, v.end_at, 37.77, -122.41, 'test', v.recurring, v.pattern
FROM (VALUES
  (:'past_ev',  'Past event',            now() - interval '2 days', now() - interval '2 days' + interval '2 hours', false, NULL::jsonb),
  (:'live_ev',  'In-progress event',     now() - interval '1 hour', now() + interval '1 hour',                      false, NULL::jsonb),
  (:'rec_done', 'Recurring, finished',   now() - interval '30 days', now() - interval '30 days' + interval '1 hour', true,  '{"frequency":"weekly","interval":1,"endDate":"2020-01-01"}'::jsonb),
  (:'rec_open', 'Recurring, no end',     now() - interval '30 days', now() - interval '30 days' + interval '1 hour', true,  '{"frequency":"weekly","interval":1}'::jsonb)
) AS v(id, title, start_at, end_at, recurring, pattern);

-- Fixture RSVPs (some on past/closed events): bypass the join-time guard
-- from 20261103170000 for this statement only.
SELECT set_config('eventmap.allow_approval', 'true', true);
INSERT INTO rsvps (user_id, event_id, status) VALUES
  (:'alex', :'past_ev',  'going'),
  (:'alex', :'live_ev',  'going'),
  (:'alex', :'rec_done', 'going'),
  (:'alex', :'rec_open', 'going'),
  (:'alex', :'ev2',      'interested')   -- downgrade seeded "going" to make sure it is excluded
ON CONFLICT (user_id, event_id) DO UPDATE SET status = EXCLUDED.status;
SELECT set_config('eventmap.allow_approval', '', true);

-- The seed's demo events have fixed dates that age out; keep ev1/ev2 upcoming
-- for this run (rolled back with everything else). People are going, so the
-- reschedule guard (20261103150000) is bypassed for this statement.
SELECT set_config('eventmap.allow_reschedule', 'true', true);
UPDATE events SET start_datetime = now() + interval '3 days', end_datetime = now() + interval '3 days 2 hours'
WHERE id IN (:'ev1', :'ev2');
SELECT set_config('eventmap.allow_reschedule', '', true);

-- Make sure the baseline privacy flags are the defaults
UPDATE profiles SET is_profile_private = false, show_future_events = true, show_attendance_publicly = true
WHERE id IN (:'alex', :'sam');

-- ---------------------------------------------------------------------------
-- 1. Owner view: upcoming vs past split
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(:'alex');

SELECT pg_temp.check(
  (SELECT array_agg(x->>'id' ORDER BY x->>'id') FROM json_array_elements(get_user_going_events(:'alex', 'upcoming')) x)
    = ARRAY[:'ev1', :'live_ev', :'rec_open']::text[],
  'owner upcoming = seeded ev1 + in-progress + open recurring (interested rsvp excluded)');

SELECT pg_temp.check(
  (SELECT array_agg(x->>'id' ORDER BY x->>'id') FROM json_array_elements(get_user_going_events(:'alex', 'past')) x)
    = ARRAY[:'past_ev', :'rec_done']::text[],
  'owner past = ended event + recurring with passed end date');

SELECT pg_temp.check(
  (SELECT (x->>'id') FROM json_array_elements(get_user_going_events(:'alex', 'upcoming')) WITH ORDINALITY AS t(x, n) WHERE n = 1) = :'live_ev',
  'upcoming is ordered soonest-first (in-progress event comes first)');

SELECT pg_temp.check(
  (SELECT (x->>'id') FROM json_array_elements(get_user_going_events(:'alex', 'past')) WITH ORDINALITY AS t(x, n) WHERE n = 1) = :'past_ev',
  'past is ordered most-recent-first');

SELECT pg_temp.check(
  json_array_length(get_user_going_events(:'alex', 'past', 1, 0)) = 1
  AND (get_user_going_events(:'alex', 'past', 1, 1)->0->>'id') = :'rec_done',
  'past list paginates with limit/offset');

SELECT pg_temp.check(
  json_array_length(get_user_upcoming_events(:'alex')) = 3,
  'legacy get_user_upcoming_events wrapper still works');

SELECT pg_temp.check(
  json_array_length(get_user_past_events(:'alex')) = 2,
  'get_user_past_events wrapper works');

SELECT pg_temp.check(
  (get_user_attendance_counts(:'alex')->>'upcoming_count')::int = 3
  AND (get_user_attendance_counts(:'alex')->>'attended_count')::int = 2,
  'owner counts: 3 upcoming, 2 attended');

SELECT pg_temp.check(
  (SELECT bool_and((x::jsonb) ? 'is_recurring' AND (x::jsonb) ? 'recurrence_pattern' AND (x::jsonb) ? 'rsvp_count')
     FROM json_array_elements(get_user_going_events(:'alex', 'upcoming')) x),
  'rows carry recurrence fields and counts');

-- Recurring events report their next occurrence; one-off events echo their start
SELECT pg_temp.check(
  (SELECT (x->>'next_start_datetime')::timestamptz >= now() - interval '1 minute'
     FROM json_array_elements(get_user_going_events(:'alex', 'upcoming')) x WHERE x->>'id' = :'rec_open'),
  'open recurring event exposes a next occurrence in the future');

SELECT pg_temp.check(
  (SELECT (x->>'next_start_datetime') = (x->>'start_datetime')
     FROM json_array_elements(get_user_going_events(:'alex', 'upcoming')) x WHERE x->>'id' = :'ev1'),
  'one-off event next occurrence equals its start');

SELECT pg_temp.check(
  event_next_occurrence(now() - interval '45 days', true, '{"frequency":"weekly","interval":2}'::jsonb)
    BETWEEN now() AND now() + interval '14 days'
  AND event_next_occurrence(now() - interval '100 days', true, '{"frequency":"monthly","interval":1}'::jsonb)
    BETWEEN now() AND now() + interval '31 days'
  AND event_next_occurrence(now() + interval '3 days', true, '{"frequency":"daily","interval":1}'::jsonb)
    = now() + interval '3 days',
  'event_next_occurrence handles weekly/monthly/not-yet-started patterns');

-- Saved events: one RPC, caller-scoped, upcoming before past
INSERT INTO saves (user_id, event_id) VALUES (:'alex', :'ev2'), (:'alex', :'past_ev')
ON CONFLICT (user_id, event_id) DO NOTHING;

SELECT pg_temp.check(
  (SELECT array_agg(x->>'id' ORDER BY n) FROM json_array_elements(get_user_saved_events()) WITH ORDINALITY AS t(x, n))
    = ARRAY[:'ev2', :'past_ev']::text[]
  AND (SELECT bool_and((x::jsonb) ? 'saved_at' AND (x::jsonb) ? 'has_ended') FROM json_array_elements(get_user_saved_events()) x),
  'saved events come back in one call, upcoming first, with saved_at/has_ended');

SELECT pg_temp.check(
  (get_user_attendance_counts(:'alex')->>'saved_count')::int = 2,
  'owner counts include saved_count');

-- Interested list: owner-only, upcoming only
SELECT pg_temp.check(
  (SELECT array_agg(x->>'id') FROM json_array_elements(get_user_going_events(:'alex', 'interested')) x)
    = ARRAY[:'ev2']::text[],
  'owner sees interested list (not-ended only)');

SELECT pg_temp.check(
  (get_user_attendance_counts(:'alex')->>'interested_count')::int = 1,
  'owner counts include interested_count');

-- ---------------------------------------------------------------------------
-- 2. Another user viewing a public profile
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(:'sam');

SELECT pg_temp.check(
  json_array_length(get_user_going_events(:'alex', 'upcoming')) = 3,
  'other user sees upcoming list of a public profile');

SELECT pg_temp.check(
  json_array_length(get_user_going_events(:'alex', 'past')) = 0
  AND json_array_length(get_user_past_events(:'alex')) = 0,
  'other user never sees attendance history');

SELECT pg_temp.check(
  (get_user_attendance_counts(:'alex')->>'upcoming_count')::int = 3
  AND (get_user_attendance_counts(:'alex')->>'attended_count')::int = 0,
  'other user gets upcoming count but attended count is withheld');

SELECT pg_temp.check(
  (get_user_attendance_counts(:'alex')->>'saved_count')::int = 0
  AND json_array_length(get_user_saved_events()) = 0,
  'other user gets no saved count and only their own (empty) saves');

SELECT pg_temp.check(
  json_array_length(get_user_going_events(:'alex', 'interested')) = 0
  AND (get_user_attendance_counts(:'alex')->>'interested_count')::int = 0,
  'interested list and count are owner-only');

-- Profiles table lockdown + public profile RPCs
SELECT pg_temp.check(
  (SELECT COUNT(*) FROM profiles) = 1
  AND (SELECT id FROM profiles LIMIT 1) = :'sam'::uuid,
  'profiles table reads are restricted to the caller''s own row');

SELECT pg_temp.check(
  (get_public_profile(:'alex')->>'is_private')::boolean = false
  AND (get_public_profile(:'alex')->'profile'->>'name') IS NOT NULL
  AND (get_public_profile(:'alex')->'profile'->'lat') IS NULL
  AND ((get_public_profile(:'alex')->'profile')::jsonb ? 'is_admin') = false,
  'get_public_profile returns safe columns only');

SELECT pg_temp.check(
  get_public_profile('00000000-0000-4000-8000-00000000dead') IS NULL,
  'get_public_profile returns NULL for a missing user');

SELECT pg_temp.check(
  (SELECT bool_and((x::jsonb) ? 'name' AND (x::jsonb) ? 'avatar_url')
   FROM json_array_elements(get_profiles_display(ARRAY[:'alex', :'host']::uuid[])) x)
  AND json_array_length(get_profiles_display(ARRAY[:'alex', :'host']::uuid[])) = 2,
  'get_profiles_display resolves display identities in batch');

-- ---------------------------------------------------------------------------
-- 3. Privacy flags are enforced on the server
-- ---------------------------------------------------------------------------
SELECT set_config('role', 'postgres', true);
UPDATE profiles SET is_profile_private = true WHERE id = :'alex';
SELECT pg_temp.act_as(:'sam');

SELECT pg_temp.check(
  json_array_length(get_user_upcoming_events(:'alex')) = 0
  AND (get_user_attendance_counts(:'alex')->>'upcoming_count')::int = 0,
  'private profile: upcoming list and counts hidden from others');

SELECT pg_temp.check(
  (get_public_profile(:'alex')->>'is_private')::boolean = true
  AND ((get_public_profile(:'alex'))::jsonb ? 'profile') = false,
  'private profile: get_public_profile returns only the private flag');

SELECT pg_temp.act_as(:'alex');
SELECT pg_temp.check(
  json_array_length(get_user_upcoming_events(:'alex')) = 3,
  'private profile: owner still sees own upcoming list');

SELECT set_config('role', 'postgres', true);
UPDATE profiles SET is_profile_private = false, show_future_events = false WHERE id = :'alex';
SELECT pg_temp.act_as(:'sam');

SELECT pg_temp.check(
  json_array_length(get_user_upcoming_events(:'alex')) = 0,
  'show_future_events = false hides the list from others');

SELECT set_config('role', 'postgres', true);
UPDATE profiles SET show_future_events = true WHERE id = :'alex';

-- Anonymous (no JWT) callers get nothing
SELECT pg_temp.act_as(NULL);
SELECT pg_temp.check(
  json_array_length(get_user_upcoming_events(:'alex')) = 0,
  'anonymous caller gets an empty list');

-- Bad scope is rejected
SELECT pg_temp.act_as(:'alex');
DO $$
BEGIN
  PERFORM get_user_going_events('10000000-0000-4000-8000-000000000002', 'everything');
  RAISE EXCEPTION 'FAIL: invalid scope should raise';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  RAISE NOTICE 'PASS: invalid scope raises (%)', SQLERRM;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Anonymous attendees do not leak the user id
-- ---------------------------------------------------------------------------
SELECT set_config('role', 'postgres', true);
UPDATE profiles SET show_attendance_publicly = false WHERE id = :'sam';
-- Fixture RSVPs (some on past/closed events): bypass the join-time guard
-- from 20261103170000 for this statement only.
SELECT set_config('eventmap.allow_approval', 'true', true);
INSERT INTO rsvps (user_id, event_id, status) VALUES (:'sam', :'live_ev', 'going')
ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'going';
SELECT set_config('eventmap.allow_approval', '', true);
SELECT pg_temp.act_as(:'alex');

SELECT pg_temp.check(
  (SELECT bool_and(
      (x->>'is_anonymous')::boolean
      AND (x->>'id') NOT LIKE '%' || :'sam' || '%'
      AND (x->>'id') LIKE 'anon-%'
      AND x->>'avatar_url' IS NULL)
   FROM json_array_elements(get_event_attendees_public(:'ev1')) x
   WHERE x->>'name' = 'Anonymous'),
  'anonymous attendee row has no trace of the user id');

SELECT pg_temp.check(
  (SELECT x->>'id' FROM json_array_elements(get_event_attendees_public(:'ev1')) x WHERE (x->>'is_anonymous')::boolean LIMIT 1)
  <>
  (SELECT x->>'id' FROM json_array_elements(get_event_attendees_public(:'live_ev')) x WHERE (x->>'is_anonymous')::boolean LIMIT 1),
  'same private user gets different anonymous ids on different events');

SELECT pg_temp.check(
  (SELECT COUNT(*) FROM json_array_elements(get_event_attendees_public(:'ev1')) x WHERE (x->>'is_anonymous')::boolean = false AND x->>'id' = :'alex') = 1,
  'public attendee still listed with real id');

-- track_event_view: the upsert must work twice in a row (same viewer, same day)
SELECT pg_temp.act_as(:'alex');
SELECT track_event_view(:'ev1');
SELECT track_event_view(:'ev1');
SELECT pg_temp.check(
  (SELECT COUNT(*) FROM event_views WHERE event_id = :'ev1' AND viewer_id = :'alex' AND view_date = CURRENT_DATE) = 1,
  'track_event_view records one row per viewer per day without erroring');

-- ---------------------------------------------------------------------------
-- 5. Attendee pagination + search (45 synthetic attendees)
-- ---------------------------------------------------------------------------
SELECT set_config('role', 'postgres', true);
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change)
SELECT ('7a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'bulk' || n || '@example.test', 'x', now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('name', 'Bulk User ' || n),
  now(), now(), '', '', '', ''
FROM generate_series(1, 45) n
ON CONFLICT (id) DO NOTHING;
-- profiles are created by the auth trigger; make sure they exist and name them
INSERT INTO profiles (id, name)
SELECT ('7a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Bulk User ' || n FROM generate_series(1, 45) n
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
UPDATE profiles SET show_attendance_publicly = false WHERE id IN (
  SELECT ('7a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid FROM generate_series(40, 45) n);
-- Fixture RSVPs (some on past/closed events): bypass the join-time guard
-- from 20261103170000 for this statement only.
SELECT set_config('eventmap.allow_approval', 'true', true);
INSERT INTO rsvps (user_id, event_id, status, created_at)
SELECT ('7a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, :'ev1', 'going', now() - (n || ' minutes')::interval
FROM generate_series(1, 45) n
ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'going';
SELECT set_config('eventmap.allow_approval', '', true);

SELECT pg_temp.act_as(:'alex');
SELECT pg_temp.check(
  (get_event_attendees_page(:'ev1', 30, 0)->>'total')::int = 47
  AND json_array_length(get_event_attendees_page(:'ev1', 30, 0)->'items') = 30
  AND (get_event_attendees_page(:'ev1', 30, 0)->>'has_more')::boolean = true
  AND json_array_length(get_event_attendees_page(:'ev1', 30, 30)->'items') = 17
  AND (get_event_attendees_page(:'ev1', 30, 30)->>'has_more')::boolean = false,
  'attendee page: total 47 (2 seeded + 45 bulk), pages of 30 then 17, has_more flips');

SELECT pg_temp.check(
  (SELECT COUNT(DISTINCT x->>'id') FROM (
     SELECT json_array_elements(get_event_attendees_page(:'ev1', 30, 0)->'items') x
     UNION ALL
     SELECT json_array_elements(get_event_attendees_page(:'ev1', 30, 30)->'items') x) t) = 47,
  'attendee page: no duplicates or gaps across pages');

SELECT pg_temp.check(
  (SELECT bool_and(NOT (x->>'is_anonymous')::boolean) FROM json_array_elements(get_event_attendees_page(:'ev1', 30, 0)->'items') x)
  AND (SELECT COUNT(*) FROM json_array_elements(get_event_attendees_page(:'ev1', 30, 30)->'items') x WHERE (x->>'is_anonymous')::boolean) = 7,
  'attendee page: named attendees first, the 7 anonymous rows (sam + 6 bulk) last');

SELECT pg_temp.check(
  (get_event_attendees_page(:'ev1', 30, 0)->'items'->0->>'id') = :'alex',
  'attendee page: the viewer is listed first');

SELECT pg_temp.check(
  (get_event_attendees_page(:'ev1', 30, 0, 'bulk user 1')->>'total')::int = 11
  AND (get_event_attendees_page(:'ev1', 30, 0, 'Bulk User 44')->>'total')::int = 0
  AND (get_event_attendees_page(:'ev1', 30, 0, '%')->>'total')::int = 0
  AND (get_event_attendees_page(:'ev1', 30, 0, '  ')->>'total')::int = 47,
  'attendee page: search is case-insensitive, never matches anonymous users, escapes wildcards, blank = all');

SELECT pg_temp.check(
  json_array_length(get_event_attendees_page(:'ev1', 1000, 0)->'items') = 47
  AND json_array_length(get_event_attendees_page(:'ev1', 0, -5)->'items') = 1,
  'attendee page: limit clamps to 100 max / 1 min, negative offset treated as 0');

-- ---------------------------------------------------------------------------
-- 6. Reminders follow the RSVP context
-- ---------------------------------------------------------------------------
SELECT set_config('role', 'postgres', true);
\set rem_going   '3f000000-0000-4000-8000-000000000011'
\set rem_int24   '3f000000-0000-4000-8000-000000000012'
\set rem_int2h   '3f000000-0000-4000-8000-000000000013'
\set rem_none    '3f000000-0000-4000-8000-000000000014'
\set rem_far     '3f000000-0000-4000-8000-000000000015'
INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address)
SELECT v.id::uuid, :'biz', v.title, 'reminder test', (SELECT id FROM categories LIMIT 1), v.start_at, v.start_at + interval '2 hours', 37.77, -122.41, 'test'
FROM (VALUES
  (:'rem_going', 'Going in an hour',          now() + interval '60 minutes'),
  (:'rem_int24', 'Interested tomorrow',       now() + interval '24 hours'),
  (:'rem_int2h', 'Interested, late, in 2h',   now() + interval '120 minutes'),
  (:'rem_none',  'No RSVP in an hour',        now() + interval '60 minutes'),
  (:'rem_far',   'Interested in 3 days',      now() + interval '3 days')
) AS v(id, title, start_at);
UPDATE profiles SET event_reminder_enabled = true, event_reminder_minutes = 60,
  notification_preferences = COALESCE(notification_preferences, '{}'::jsonb) || '{"interested_reminder": true}'::jsonb
WHERE id IN (:'alex', :'sam');
-- Fixture RSVPs (some on past/closed events): bypass the join-time guard
-- from 20261103170000 for this statement only.
SELECT set_config('eventmap.allow_approval', 'true', true);
INSERT INTO rsvps (user_id, event_id, status, created_at) VALUES
  (:'alex', :'rem_going', 'going',      now() - interval '2 days'),
  (:'alex', :'rem_int24', 'interested', now() - interval '2 days'),
  (:'alex', :'rem_int2h', 'interested', now() - interval '30 minutes'),
  (:'alex', :'rem_far',   'interested', now() - interval '2 days'),
  (:'sam',  :'rem_int24', 'interested', now() - interval '2 days'),   -- sam opts out below
  (:'sam',  :'rem_going', 'going',      now() - interval '2 days')    -- sam disables reminders below
ON CONFLICT (user_id, event_id) DO UPDATE SET status = EXCLUDED.status, created_at = EXCLUDED.created_at;
SELECT set_config('eventmap.allow_approval', '', true);
UPDATE profiles SET notification_preferences = notification_preferences || '{"interested_reminder": false}'::jsonb,
  event_reminder_enabled = false WHERE id = :'sam';
DELETE FROM notifications WHERE type = 'event_reminder' AND user_id IN (:'alex', :'sam');

SELECT send_event_reminders();

SELECT pg_temp.check(
  (SELECT COUNT(*) FROM notifications WHERE user_id = :'alex' AND event_id = :'rem_going' AND title = 'Event starting soon') = 1,
  'reminders: going + 60 min lead time -> starting-soon reminder');
SELECT pg_temp.check(
  (SELECT COUNT(*) FROM notifications WHERE user_id = :'alex' AND event_id = :'rem_int24' AND title = 'Still interested?' AND body LIKE '%starts tomorrow%') = 1,
  'reminders: interested, day before -> nudge');
SELECT pg_temp.check(
  (SELECT COUNT(*) FROM notifications WHERE user_id = :'alex' AND event_id = :'rem_int2h' AND title = 'Still interested?' AND body LIKE '%about 2 hours%') = 1,
  'reminders: interest registered late -> 2h nudge');
SELECT pg_temp.check(
  (SELECT COUNT(*) FROM notifications WHERE type = 'event_reminder' AND event_id IN (:'rem_none', :'rem_far')) = 0,
  'reminders: no RSVP, or interested but days away -> nothing');
SELECT pg_temp.check(
  (SELECT COUNT(*) FROM notifications WHERE user_id = :'sam' AND type = 'event_reminder') = 0,
  'reminders: opted-out user gets neither kind');

SELECT send_event_reminders();
SELECT pg_temp.check(
  (SELECT COUNT(*) FROM notifications WHERE user_id = :'alex' AND type = 'event_reminder' AND event_id IN (:'rem_going', :'rem_int24', :'rem_int2h')) = 3,
  'reminders: second run sends nothing new (idempotent)');

-- Context change: interested -> going on the 2h event; lead time 120 now applies without a PK clash
UPDATE profiles SET event_reminder_minutes = 120 WHERE id = :'alex';
UPDATE rsvps SET status = 'going' WHERE user_id = :'alex' AND event_id = :'rem_int2h';
SELECT send_event_reminders();
SELECT pg_temp.check(
  (SELECT COUNT(*) FROM notifications WHERE user_id = :'alex' AND event_id = :'rem_int2h' AND title = 'Event starting soon') = 1,
  'reminders: switching interested -> going still yields the going reminder (kinds do not collide)');

-- Leaving: a removed RSVP gets no reminder even inside the window
UPDATE profiles SET event_reminder_minutes = 60 WHERE id = :'alex';
DELETE FROM event_reminder_sent WHERE event_id = :'rem_going';
DELETE FROM notifications WHERE type = 'event_reminder' AND event_id = :'rem_going';
DELETE FROM rsvps WHERE user_id = :'alex' AND event_id = :'rem_going';
SELECT send_event_reminders();
SELECT pg_temp.check(
  (SELECT COUNT(*) FROM notifications WHERE type = 'event_reminder' AND event_id = :'rem_going') = 0,
  'reminders: leaving an event stops its reminder');

ROLLBACK;
