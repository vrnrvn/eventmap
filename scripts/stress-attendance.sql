-- Load check for the attendance RPCs on an isolated scratch copy. Creates a
-- heavy user (3,000 going RSVPs split past/future, 500 interested, 800 saves)
-- and a heavy event (5,000 going attendees), then times the RPCs the app calls.
-- Everything runs in one transaction and rolls back.
--
--   SCRATCH_DB=... scripts/db-scratch.sh apply scripts/stress-attendance.sql
\set ON_ERROR_STOP on
\timing on
BEGIN;
SET LOCAL work_mem = '64MB';
\set heavy_user '8b000000-0000-4000-8000-000000000001'
\set heavy_event '8c000000-0000-4000-8000-000000000001'
\set biz '20000000-0000-4000-8000-000000000001'

-- heavy user + 5,000 attendee users
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change)
SELECT ('8b000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'stress' || n || '@example.test', 'x', now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('name', 'Stress ' || n), now(), now(), '', '', '', ''
FROM generate_series(1, 5001) n ON CONFLICT (id) DO NOTHING;
INSERT INTO profiles (id, name) SELECT ('8b000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Stress ' || n
FROM generate_series(1, 5001) n ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
UPDATE profiles SET show_attendance_publicly = (random() > 0.1) WHERE name LIKE 'Stress %';

-- 4,000 events: half past, half future, 5% recurring
INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address, is_recurring, recurrence_pattern)
SELECT ('8c000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, :'biz', 'Stress event ' || n, 'stress', (SELECT id FROM categories LIMIT 1),
  now() + ((n - 2000) || ' hours')::interval, now() + ((n - 2000) || ' hours')::interval + interval '2 hours',
  37.77, -122.41, 'stress', (n % 20 = 0), CASE WHEN n % 20 = 0 THEN '{"frequency":"weekly","interval":1}'::jsonb END
FROM generate_series(1, 4000) n ON CONFLICT (id) DO NOTHING;

-- heavy user: going to 3,000 events, interested in 500, saved 800
INSERT INTO rsvps (user_id, event_id, status)
SELECT :'heavy_user', ('8c000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, CASE WHEN n <= 3000 THEN 'going' ELSE 'interested' END
FROM generate_series(1, 3500) n ON CONFLICT DO NOTHING;
INSERT INTO saves (user_id, event_id)
SELECT :'heavy_user', ('8c000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid FROM generate_series(1, 800) n ON CONFLICT DO NOTHING;

-- heavy event: 5,000 going attendees
INSERT INTO rsvps (user_id, event_id, status, created_at)
SELECT ('8b000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, :'heavy_event', 'going', now() - (n || ' seconds')::interval
FROM generate_series(2, 5001) n ON CONFLICT DO NOTHING;
ANALYZE rsvps; ANALYZE events; ANALYZE profiles; ANALYZE saves;

SELECT set_config('request.jwt.claim.sub', :'heavy_user', true), set_config('role', 'authenticated', true);

\echo '--- counts (heavy user)'
SELECT get_user_attendance_counts(:'heavy_user');
\echo '--- upcoming page 1 / past page 1 / past page 100 / interested'
SELECT json_array_length(get_user_going_events(:'heavy_user', 'upcoming', 20, 0));
SELECT json_array_length(get_user_going_events(:'heavy_user', 'past', 20, 0));
SELECT json_array_length(get_user_going_events(:'heavy_user', 'past', 20, 1480));
SELECT json_array_length(get_user_going_events(:'heavy_user', 'interested', 20, 0));
\echo '--- saved (100 max per page)'
SELECT json_array_length(get_user_saved_events(100, 0));
\echo '--- attendees: page 1, page 150, search, total'
SELECT (get_event_attendees_page(:'heavy_event', 30, 0)->>'total')::int AS total,
       json_array_length(get_event_attendees_page(:'heavy_event', 30, 0)->'items') AS page1;
SELECT json_array_length(get_event_attendees_page(:'heavy_event', 30, 4470)->'items') AS page150;
SELECT (get_event_attendees_page(:'heavy_event', 30, 0, 'stress 49')->>'total')::int AS search_total;
\echo '--- legacy full list (chat mentions) on the heavy event'
SELECT json_array_length(get_event_attendees_public(:'heavy_event'));
\echo '--- plans'
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON) SELECT get_user_going_events(:'heavy_user', 'past', 20, 0);
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON) SELECT get_event_attendees_page(:'heavy_event', 30, 0);
ROLLBACK;
