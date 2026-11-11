-- Regression suite for 20261110160000_host_lifecycle_notifications.sql and
-- 20261110170000_stop_hosting.sql.
-- Self-contained, rolled back. Run ONLY against an isolated database.
\set ON_ERROR_STOP 1
BEGIN;
CREATE FUNCTION pg_temp.login(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL role authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
END $$;
CREATE FUNCTION pg_temp.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); END $$;
CREATE FUNCTION pg_temp.expect_error(tag text, p_sql text, p_like text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE p_like THEN RAISE EXCEPTION '[%] wrong error: % (wanted %)', tag, SQLERRM, p_like; END IF;
    RETURN;
  END;
  RAISE EXCEPTION '[%] should have failed (%) but succeeded', tag, p_like;
END $$;
CREATE FUNCTION pg_temp.mkevent(p_biz uuid, p_start timestamptz, p_end timestamptz, p_state text DEFAULT 'published')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO events (business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address, publish_state)
  VALUES (p_biz, 'LC event', 'd', (SELECT id FROM categories LIMIT 1), p_start, p_end, 1, 2, 'x', p_state)
  RETURNING id INTO v;
  RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.mkevent(uuid, timestamptz, timestamptz, text) TO authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('50000000-0000-4000-8000-00000000000a', 'lc-admin@test.local', '{"name":"LC Admin"}'),
  ('50000000-0000-4000-8000-000000000001', 'lc-host@test.local',  '{"name":"LC Host"}'),
  ('50000000-0000-4000-8000-000000000002', 'lc-goer@test.local',  '{"name":"LC Goer"}');
INSERT INTO profiles (id, name) SELECT id, raw_user_meta_data->>'name' FROM auth.users
WHERE email LIKE 'lc-%@test.local' ON CONFLICT (id) DO NOTHING;
UPDATE profiles SET is_admin = true WHERE id = '50000000-0000-4000-8000-00000000000a';
INSERT INTO businesses (id, owner_id, name, category, address, lat, lng, description, host_terms_version, host_terms_accepted_at)
VALUES ('51000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'LC Bar', 'Other', '1 Main', 1, 2, 'Desc', 1, now());

-- ── Day-of and post-event notices ──────────────────────────────────────────
-- In window: starts in 3 hours. Out of window: starts in 10 hours.
CREATE TEMP TABLE lc AS SELECT
  pg_temp.mkevent('51000000-0000-4000-8000-000000000001', now() + interval '3 hours', now() + interval '5 hours') AS today,
  pg_temp.mkevent('51000000-0000-4000-8000-000000000001', now() + interval '10 hours', now() + interval '12 hours') AS later,
  pg_temp.mkevent('51000000-0000-4000-8000-000000000001', now() - interval '6 hours', now() - interval '4 hours') AS ended,
  pg_temp.mkevent('51000000-0000-4000-8000-000000000001', now() + interval '3 hours', now() + interval '5 hours', 'draft') AS draft;
GRANT SELECT ON lc TO authenticated;
INSERT INTO rsvps (event_id, user_id, status) SELECT today, '50000000-0000-4000-8000-000000000002', 'going' FROM lc;

SELECT send_host_event_notices();
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM notifications
   WHERE type = 'host_day_of' AND event_id = (SELECT today FROM lc);
  ASSERT n = 1, format('day-of sent once, got %s', n);
  ASSERT NOT EXISTS (SELECT 1 FROM notifications WHERE type = 'host_day_of' AND event_id = (SELECT later FROM lc)),
    'an event 10 hours out is not "today"';
  ASSERT NOT EXISTS (SELECT 1 FROM notifications WHERE type = 'host_day_of' AND event_id = (SELECT draft FROM lc)),
    'drafts get no host notices';
  ASSERT EXISTS (SELECT 1 FROM notifications WHERE type = 'host_day_of'
                   AND event_id = (SELECT today FROM lc) AND body LIKE '%1 person going%'),
    'day-of body counts attendees';
  ASSERT EXISTS (SELECT 1 FROM notifications WHERE type = 'host_post_event_summary'
                   AND event_id = (SELECT ended FROM lc)),
    'post-event summary for an event that ended';
  ASSERT (SELECT user_id FROM notifications WHERE type = 'host_day_of' AND event_id = (SELECT today FROM lc))
         = '50000000-0000-4000-8000-000000000001', 'notices go to the owner';
END $$;

-- Running again must not duplicate.
SELECT send_host_event_notices();
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM notifications WHERE type IN ('host_day_of', 'host_post_event_summary');
  ASSERT n = 2, format('no duplicates on a second run, got %s', n);
END $$;

-- A host who turned notifications off gets none.
UPDATE businesses SET notifications_enabled = false WHERE id = '51000000-0000-4000-8000-000000000001';
DELETE FROM host_notifications_sent;
DELETE FROM notifications WHERE type IN ('host_day_of', 'host_post_event_summary');
SELECT send_host_event_notices();
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM notifications WHERE type IN ('host_day_of', 'host_post_event_summary')),
    'notifications_enabled = false silences host notices';
END $$;
UPDATE businesses SET notifications_enabled = true WHERE id = '51000000-0000-4000-8000-000000000001';

-- ── Decision notifications ─────────────────────────────────────────────────
SELECT pg_temp.login('50000000-0000-4000-8000-000000000001');
CREATE TEMP TABLE lc_req AS SELECT submit_verification_request('https://lc.example') AS id;
GRANT SELECT ON lc_req TO authenticated;
SELECT pg_temp.logout();
SELECT pg_temp.login('50000000-0000-4000-8000-00000000000a');
SELECT admin_review_verification((SELECT id FROM lc_req), 'needs_info', 'Add your socials');
SELECT admin_set_host_standing('51000000-0000-4000-8000-000000000001', 'restricted', 'Spam');
SELECT admin_set_host_standing('51000000-0000-4000-8000-000000000001', 'good');
SELECT pg_temp.logout();
-- Asserted outside the admin session on purpose: notifications are RLS-scoped
-- to their recipient, so an admin cannot see the host's rows at all.
DO $$ DECLARE n int; BEGIN
  ASSERT EXISTS (SELECT 1 FROM notifications WHERE type = 'host_verification_update'
                   AND user_id = '50000000-0000-4000-8000-000000000001' AND body = 'Add your socials'),
    'needs_info notifies the host with the note';
  SELECT count(*) INTO n FROM notifications WHERE type = 'host_standing_update';
  ASSERT n = 2, format('both standing changes notify, got %s', n);
  ASSERT EXISTS (SELECT 1 FROM notifications WHERE type = 'host_standing_update' AND title = 'Publishing is paused');
  ASSERT EXISTS (SELECT 1 FROM notifications WHERE type = 'host_standing_update' AND title LIKE '%good standing%');
END $$;

-- ── Stop hosting ───────────────────────────────────────────────────────────
SELECT pg_temp.login('50000000-0000-4000-8000-000000000001');
SELECT pg_temp.expect_error('no direct archive',
  $$UPDATE businesses SET archived_at = now() WHERE owner_id = auth.uid()$$, '%archive_business%');
DO $$ DECLARE v_cancelled int; BEGIN
  v_cancelled := archive_business();
  -- today + later are upcoming and published; ended is past; draft is a draft.
  ASSERT v_cancelled = 2, format('cancels upcoming published events only, got %s', v_cancelled);
  ASSERT (SELECT archived_at IS NOT NULL FROM businesses WHERE owner_id = auth.uid()), 'archived';
  ASSERT (SELECT status FROM events WHERE id = (SELECT today FROM lc)) = 'cancelled', 'upcoming cancelled';
  ASSERT (SELECT COALESCE(status, 'active') FROM events WHERE id = (SELECT draft FROM lc)) <> 'cancelled', 'drafts untouched';
  ASSERT archive_business() = 0, 'archiving twice is a no-op';
END $$;
SELECT pg_temp.expect_error('archived host cannot publish',
  $$SELECT pg_temp.mkevent('51000000-0000-4000-8000-000000000001', now() + interval '2 days', now() + interval '2 days 2 hours')$$,
  '%host_archived%');
SELECT reopen_business();
DO $$ BEGIN
  ASSERT (SELECT archived_at IS NULL FROM businesses WHERE owner_id = auth.uid()), 'reopened';
  ASSERT (SELECT status FROM events WHERE id = (SELECT today FROM lc)) = 'cancelled', 'reopening does not un-cancel';
END $$;
SELECT pg_temp.mkevent('51000000-0000-4000-8000-000000000001', now() + interval '2 days', now() + interval '2 days 2 hours');
SELECT pg_temp.logout();
-- Outside the host session: notifications are RLS-scoped to the recipient, so
-- the host cannot see what the attendee received.
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM notifications WHERE type = 'event_update'
                   AND user_id = '50000000-0000-4000-8000-000000000002'),
    'attendees were told their event was cancelled';
END $$;

DO $$ BEGIN RAISE NOTICE 'test-host-lifecycle: all assertions passed'; END $$;
ROLLBACK;
