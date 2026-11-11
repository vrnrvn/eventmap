-- Regression suite for 20261110130000_host_onboarding_status.sql.
-- Self-contained (own users, real `authenticated` role + JWT claims), rolled
-- back. Run ONLY against an isolated database, never the shared one.
\set ON_ERROR_STOP 1
BEGIN;
CREATE FUNCTION pg_temp.login(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL role authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
END $$;
CREATE FUNCTION pg_temp.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); END $$;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('30000000-0000-4000-8000-000000000001', 'os-host@test.local', '{"name":"OS Host"}'),
  ('30000000-0000-4000-8000-000000000002', 'os-none@test.local', '{"name":"OS None"}');
INSERT INTO profiles (id, name) SELECT id, raw_user_meta_data->>'name' FROM auth.users
WHERE email LIKE 'os-%@test.local' ON CONFLICT (id) DO NOTHING;
INSERT INTO businesses (id, owner_id, name, category, address, lat, lng, description, logo_url)
VALUES ('31000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
        'OS Bar', 'Other', '1 Main St', 1, 2, '', NULL);

-- Fresh host: everything zero / false (notifications default on).
SELECT pg_temp.login('30000000-0000-4000-8000-000000000001');
DO $$ DECLARE s jsonb := get_host_onboarding_status(); BEGIN
  ASSERT s->>'has_logo' = 'false' AND s->>'has_description' = 'false', 'fresh profile incomplete: ' || s;
  ASSERT (s->>'published_events')::int = 0 AND (s->>'announcements')::int = 0, 'no events yet: ' || s;
  ASSERT s->>'notifications_enabled' = 'true', 'notifications default on';
END $$;
SELECT pg_temp.logout();

-- Add activity as a privileged writer (fixtures, not the code under test).
UPDATE businesses SET logo_url = 'https://x/logo.png', description = 'Jazz' WHERE id = '31000000-0000-4000-8000-000000000001';
INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address,
                    max_attendees, is_recurring, publish_state)
SELECT v.id::uuid, '31000000-0000-4000-8000-000000000001', 'E', 'd', (SELECT id FROM categories LIMIT 1),
       now() + interval '1 day', now() + interval '1 day 2 hours', 1, 2, 'x', v.cap, v.rec, v.st
FROM (VALUES ('32000000-0000-4000-8000-000000000001', 50, false, 'published'),
             ('32000000-0000-4000-8000-000000000002', NULL, true, 'published'),
             ('32000000-0000-4000-8000-000000000003', NULL, false, 'draft')) AS v(id, cap, rec, st);
INSERT INTO host_announcements (event_id, created_by, body, audience)
VALUES ('32000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Doors at 7', 'going');

SELECT pg_temp.login('30000000-0000-4000-8000-000000000001');
DO $$ DECLARE s jsonb := get_host_onboarding_status(); BEGIN
  ASSERT s->>'has_logo' = 'true' AND s->>'has_description' = 'true', 'profile complete: ' || s;
  ASSERT (s->>'published_events')::int = 2, 'drafts not counted as published: ' || s;
  ASSERT (s->>'events_with_capacity')::int = 1, 'capacity count: ' || s;
  ASSERT (s->>'recurring_events')::int = 1, 'recurring count: ' || s;
  ASSERT (s->>'announcements')::int = 1, 'announcement count: ' || s;
END $$;
SELECT pg_temp.logout();

-- Someone without a host profile gets NULL; anon cannot call it.
SELECT pg_temp.login('30000000-0000-4000-8000-000000000002');
DO $$ BEGIN ASSERT get_host_onboarding_status() IS NULL, 'no host profile → NULL'; END $$;
SELECT pg_temp.logout();
DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon', 'get_host_onboarding_status()', 'EXECUTE'), 'anon must not execute';
END $$;

DO $$ BEGIN RAISE NOTICE 'test-host-onboarding-status: all assertions passed'; END $$;
ROLLBACK;
