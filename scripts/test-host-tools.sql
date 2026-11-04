-- Regression suite for the host-tools stack (migrations 20261103100000–170000).
--
-- Runs ONLY against an isolated scratch copy; everything happens inside one
-- transaction that is rolled back at the end, and every check is an ASSERT so
-- a regression aborts the script (db-scratch.sh apply runs ON_ERROR_STOP=1):
--
--   SCRATCH_DB=eventmap_scratch_<yours> scripts/db-scratch.sh refresh
--   for f in supabase/migrations/202611031?0000_*.sql; do
--     SCRATCH_DB=... scripts/db-scratch.sh apply "$f"; done
--   SCRATCH_DB=... scripts/db-scratch.sh apply scripts/test-host-tools.sql
--
-- Fixtures are the seeded demo users/events (host/alex/sam, art evening and
-- run club). Identity switching uses the same mechanism PostgREST does: the
-- authenticated role plus request.jwt.claims.

BEGIN;

-- ── Helpers ───────────────────────────────────────────────────────────────────

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

-- Runs `sql` and asserts it fails with SQLERRM matching `pattern`.
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

DO $$ BEGIN RAISE NOTICE 'host-tools regression suite starting'; END $$;

-- ── Fixtures ──────────────────────────────────────────────────────────────────

CREATE TEMP TABLE fx AS
SELECT
  '10000000-0000-4000-8000-000000000001'::uuid AS host,
  '10000000-0000-4000-8000-000000000002'::uuid AS alex,
  '10000000-0000-4000-8000-000000000003'::uuid AS sam,
  '30000000-0000-4000-8000-000000000001'::uuid AS art,
  '30000000-0000-4000-8000-000000000002'::uuid AS run,
  (SELECT id FROM businesses b WHERE b.owner_id = '10000000-0000-4000-8000-000000000001') AS biz,
  (SELECT id FROM categories LIMIT 1) AS cat;

-- The suite flips between postgres and the authenticated role; the fixtures
-- table must stay readable either way.
GRANT SELECT ON fx TO authenticated;

-- Reset the two demo events to a known future, open state.
SELECT set_config('eventmap.allow_reschedule', 'true', true);
UPDATE events SET
  start_datetime = now() + interval '1 day',
  end_datetime   = now() + interval '1 day 2 hours',
  status = 'active', rsvp_closed = false, rsvp_mode = 'open',
  waitlist_mode = 'notify', max_attendees = NULL, timezone = NULL,
  publish_state = 'published', visibility = 'public'
WHERE id IN (SELECT art FROM fx UNION SELECT run FROM fx);
SELECT set_config('eventmap.allow_reschedule', '', true);
DELETE FROM rsvps WHERE event_id IN (SELECT art FROM fx);
DELETE FROM event_waitlist WHERE event_id IN (SELECT art FROM fx UNION SELECT run FROM fx);
DELETE FROM event_bans; DELETE FROM host_announcements; DELETE FROM notifications;
DELETE FROM event_chat_settings WHERE event_id IN (SELECT art FROM fx);
UPDATE businesses SET events_created_this_month = 0 WHERE id IN (SELECT biz FROM fx);
INSERT INTO follows (user_id, business_id) SELECT alex, biz FROM fx ON CONFLICT DO NOTHING;
UPDATE profiles SET is_profile_private = false, show_attendance_publicly = true,
  notification_preferences = NULL WHERE id IN (SELECT sam FROM fx UNION SELECT alex FROM fx);

-- ── 1. Host-only views ────────────────────────────────────────────────────────

SELECT pg_temp.login(alex) FROM fx;
SELECT pg_temp.expect_error('1.1 overview not host',
  format('SELECT get_event_host_overview(%L)', (SELECT art FROM fx)), '%only the event host%');
SELECT pg_temp.expect_error('1.2 attendees not host',
  format('SELECT get_event_host_attendees_page(%L, ''going'', 30, 0, NULL)', (SELECT art FROM fx)), '%only the event host%');
SELECT pg_temp.logout();
SELECT pg_temp.expect_error('1.3 overview anon',
  format('SELECT get_event_host_overview(%L)', (SELECT art FROM fx)), '%not_authenticated%');
SELECT pg_temp.login(host) FROM fx;
SELECT pg_temp.expect_error('1.4 bad status',
  format('SELECT get_event_host_attendees_page(%L, ''checked_in'', 30, 0, NULL)', (SELECT art FROM fx)), '%invalid_status%');
SELECT pg_temp.expect_error('1.5 unknown event',
  'SELECT get_event_host_overview(''00000000-0000-4000-8000-000000000000'')', '%event_not_found%');
SELECT pg_temp.logout();

-- ── 2. Private names ──────────────────────────────────────────────────────────

UPDATE profiles SET is_profile_private = true, avatar_url = 'https://x/sam.png' WHERE id IN (SELECT sam FROM fx);
INSERT INTO rsvps (user_id, event_id, status) SELECT alex, art, 'going' FROM fx;
INSERT INTO rsvps (user_id, event_id, status) SELECT sam, art, 'going' FROM fx;

DO $$
DECLARE f fx%ROWTYPE; page json; disp json;
BEGIN
  SELECT * INTO f FROM fx;
  PERFORM pg_temp.login(f.host);
  page := get_event_host_attendees_page(f.art, 'going', 30, 0, NULL);
  ASSERT (SELECT count(*) FROM json_array_elements(page->'items') i
          WHERE i->>'name' = 'Demo S.' AND (i->>'avatar_url') IS NULL AND (i->>'is_private')::boolean) = 1,
    '[2.1] private attendee must list as "Demo S." with no avatar';
  ASSERT (get_event_host_attendees_page(f.art, 'going', 30, 0, 'Sam'))->>'total' = '0',
    '[2.2] hidden surname must not be searchable';
  ASSERT (get_event_host_attendees_page(f.art, 'going', 30, 0, 'Demo S'))->>'total' = '1',
    '[2.3] visible abbreviation must be searchable';
  PERFORM pg_temp.login(f.alex);
  disp := get_profiles_display(ARRAY[f.sam]);
  ASSERT disp->0->>'name' = 'Demo S.' AND (disp->0->>'avatar_url') IS NULL,
    '[2.4] get_profiles_display must abbreviate private profiles';
  ASSERT (SELECT (get_event_attendees_page(f.art, 30, 0, NULL))->'items'->1->>'name') = 'Anonymous',
    '[2.5] attendees still see Anonymous';
  PERFORM pg_temp.logout();
  -- Existence, not "latest": created_at ties within this transaction.
  ASSERT EXISTS (SELECT 1 FROM notifications WHERE user_id = f.host AND type = 'rsvp'
                 AND body LIKE 'Demo S. is going to%'),
    '[2.6] host RSVP notification must use the abbreviated name';
  ASSERT NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = f.host AND type = 'rsvp'
                     AND body LIKE 'Demo Sam %'),
    '[2.7] the full private name must never reach a notification';
END $$;

-- ── 3. Remove, ban, allow back ────────────────────────────────────────────────

DO $$
DECLARE f fx%ROWTYPE;
BEGIN
  SELECT * INTO f FROM fx;
  PERFORM pg_temp.login(f.host);
  PERFORM host_remove_attendee(f.art, f.alex, 'Disruptive');
  ASSERT (SELECT count(*) FROM rsvps WHERE event_id = f.art AND user_id = f.alex) = 0, '[3.1] RSVP dropped';
  ASSERT (SELECT count(*) FROM event_bans WHERE event_id = f.art AND user_id = f.alex) = 1, '[3.2] banned';
  ASSERT (get_event_host_overview(f.art))->>'removed' = '1', '[3.3] overview counts removed';
  ASSERT (get_event_host_attendees_page(f.art, 'removed', 30, 0, NULL))->'items'->0->>'reason' = 'Disruptive',
    '[3.4] removed row carries the reason';
  PERFORM pg_temp.login(f.alex);
  PERFORM pg_temp.expect_error('3.5 rejoin RPC', format('SELECT join_event_with_capacity(%L, ''going'')', f.art), '%removed_from_event%');
  PERFORM pg_temp.expect_error('3.6 waitlist while banned', format('SELECT join_event_waitlist(%L)', f.art), '%removed_from_event%');
  PERFORM pg_temp.expect_error('3.7 direct insert while banned',
    format('INSERT INTO rsvps (user_id, event_id, status) VALUES (%L, %L, ''interested'')', f.alex, f.art),
    '%row-level security%');
  PERFORM pg_temp.login(f.host);
  PERFORM host_unban_attendee(f.art, f.alex);
  PERFORM pg_temp.login(f.alex);
  ASSERT (SELECT join_event_with_capacity(f.art, 'going')) = 'going', '[3.8] rejoin after unban';
  ASSERT (SELECT count(*) FROM event_chat_blocks WHERE event_id = f.art AND user_id = f.alex) = 0,
    '[3.9] chat block lifted with the ban';
  PERFORM pg_temp.logout();
END $$;

-- ── 4. Capacity ───────────────────────────────────────────────────────────────

DO $$
DECLARE f fx%ROWTYPE; new_id uuid;
BEGIN
  SELECT * INTO f FROM fx;
  PERFORM pg_temp.login(f.host);
  new_id := create_event_with_limit_check(f.biz, 'Cap test', 'd', f.cat,
    now() + interval '2 days', now() + interval '2 days 1 hour', 37.7, -122.4, 'x',
    NULL, false, NULL, 25, NULL, 'published');
  ASSERT (SELECT max_attendees FROM events WHERE id = new_id) = 25, '[4.1] capacity stored at creation';
  PERFORM pg_temp.expect_error('4.2 cap zero',
    format('SELECT create_event_with_limit_check(%L, ''x'', ''d'', %L, now() + interval ''2 days'', now() + interval ''2 days 1 hour'', 37.7, -122.4, ''x'', NULL, false, NULL, 0, NULL, ''published'')', f.biz, f.cat),
    '%invalid_capacity%');
  -- art has 2 going (alex + sam): plain shrink below refused, to-exactly allowed.
  PERFORM pg_temp.expect_error('4.3 shrink below going',
    format('UPDATE events SET max_attendees = 1 WHERE id = %L', f.art), '%capacity_below_going%');
  UPDATE events SET max_attendees = 2 WHERE id = f.art;
  ASSERT (SELECT max_attendees FROM events WHERE id = f.art) = 2, '[4.4] shrink to going count allowed';
  PERFORM host_set_event_capacity(f.art, 1);
  ASSERT (SELECT max_attendees FROM events WHERE id = f.art) = 1, '[4.5] explicit RPC lowers below';
  PERFORM pg_temp.login(f.alex);
  PERFORM pg_temp.expect_error('4.6 non-host capacity',
    format('SELECT host_set_event_capacity(%L, 50)', f.art), '%only the event host%');
  -- Raising frees seats and pings the waitlist.
  PERFORM pg_temp.logout();
  INSERT INTO event_waitlist (event_id, user_id) VALUES (f.run, f.sam);
  UPDATE events SET max_attendees = 1 WHERE id = f.run;  -- run has 1 going from seed
  DELETE FROM notifications WHERE user_id = f.sam AND type = 'waitlist';
  PERFORM pg_temp.login(f.host);
  PERFORM host_set_event_capacity(f.run, 3);
  PERFORM pg_temp.logout();
  ASSERT (SELECT count(*) FROM notifications WHERE user_id = f.sam AND type = 'waitlist' AND event_id = f.run) = 1,
    '[4.7] raising the cap pings the waitlist';
  ASSERT (SELECT notified_at IS NOT NULL FROM event_waitlist WHERE event_id = f.run AND user_id = f.sam),
    '[4.8] waitlist notified_at stamped';
  UPDATE events SET max_attendees = NULL WHERE id = f.art;
  DELETE FROM event_waitlist WHERE user_id = f.sam;
END $$;

-- ── 5. Settings: closed RSVPs and waitlist modes ─────────────────────────────

DO $$
DECLARE f fx%ROWTYPE;
BEGIN
  SELECT * INTO f FROM fx;
  PERFORM pg_temp.login(f.host);
  PERFORM host_set_event_settings(f.run, true, NULL, NULL);
  PERFORM pg_temp.login(f.sam);
  PERFORM pg_temp.expect_error('5.1 join while closed', format('SELECT join_event_with_capacity(%L, ''going'')', f.run), '%rsvps_closed%');
  PERFORM pg_temp.expect_error('5.2 direct insert while closed',
    format('INSERT INTO rsvps (user_id, event_id, status) VALUES (%L, %L, ''interested'')', f.sam, f.run),
    '%row-level security%');
  PERFORM pg_temp.login(f.alex);
  ASSERT (SELECT join_event_with_capacity(f.run, 'interested')) = 'interested',
    '[5.3] existing attendee may still flip while closed';
  PERFORM pg_temp.login(f.host);
  PERFORM host_set_event_settings(f.run, false, 'off', NULL);
  PERFORM pg_temp.login(f.sam);
  PERFORM pg_temp.expect_error('5.4 waitlist off', format('SELECT join_event_waitlist(%L)', f.run), '%waitlist_off%');
  PERFORM pg_temp.logout();
  -- auto mode: a freed seat promotes the first in line and tells them.
  UPDATE events SET max_attendees = 1, waitlist_mode = 'auto' WHERE id = f.run;
  UPDATE rsvps SET status = 'going' WHERE event_id = f.run AND user_id = f.alex;
  INSERT INTO event_waitlist (event_id, user_id) VALUES (f.run, f.sam);
  DELETE FROM notifications WHERE user_id = f.sam;
  DELETE FROM rsvps WHERE event_id = f.run AND user_id = f.alex;
  ASSERT (SELECT status FROM rsvps WHERE event_id = f.run AND user_id = f.sam) = 'going',
    '[5.5] auto mode promotes on a freed seat';
  ASSERT (SELECT count(*) FROM event_waitlist WHERE event_id = f.run) = 0, '[5.6] waitlist row consumed';
  ASSERT (SELECT title FROM notifications WHERE user_id = f.sam AND type = 'waitlist'
          ORDER BY created_at DESC LIMIT 1) = 'You''re in', '[5.7] promoted user told';
  UPDATE events SET waitlist_mode = 'notify', max_attendees = NULL WHERE id = f.run;
  DELETE FROM rsvps WHERE event_id = f.run AND user_id = f.sam;
END $$;

-- ── 6. Announcements ──────────────────────────────────────────────────────────

DO $$
DECLARE f fx%ROWTYPE; r json;
BEGIN
  SELECT * INTO f FROM fx;
  UPDATE profiles SET notification_preferences = '{"host_announcement": false}'::jsonb WHERE id = f.sam;
  PERFORM pg_temp.login(f.alex);
  PERFORM pg_temp.expect_error('6.1 non-host announce',
    format('SELECT send_event_announcement(%L, ''hi'', ''going'')', f.art), '%only the event host%');
  PERFORM pg_temp.login(f.host);
  r := send_event_announcement(f.art, 'Doors at 7', 'going');
  ASSERT r->>'recipients' = '1', '[6.2] going-only reaches the one subscribed attendee';
  r := send_event_announcement(f.art, 'Bring ID', 'all');
  ASSERT r->>'recipients' = '1', '[6.3] opted-out user skipped';
  PERFORM pg_temp.expect_error('6.4 empty body',
    format('SELECT send_event_announcement(%L, ''   '', ''going'')', f.art), '%invalid_body%');
  PERFORM send_event_announcement(f.art, 'Last one', 'going');
  PERFORM pg_temp.expect_error('6.5 daily limit',
    format('SELECT send_event_announcement(%L, ''Too many'', ''going'')', f.art), '%announcement_limit%');
  ASSERT (SELECT count(*) FROM event_chat_messages WHERE event_id = f.art AND body LIKE '📣 %') = 3,
    '[6.6] chat mirrors written';
  ASSERT (SELECT m.body FROM event_chat_settings s JOIN event_chat_messages m ON m.id = s.pinned_message_id
          WHERE s.event_id = f.art) = '📣 Last one', '[6.7] latest announcement pinned';
  ASSERT (get_event_host_overview(f.art))->>'announcements_today' = '3', '[6.8] overview counts announcements';
  PERFORM pg_temp.logout();
  UPDATE profiles SET notification_preferences = NULL WHERE id = f.sam;
END $$;

-- ── 7. Time zones ─────────────────────────────────────────────────────────────

DO $$
DECLARE f fx%ROWTYPE; next_wall timestamp;
BEGIN
  SELECT * INTO f FROM fx;
  ASSERT is_valid_time_zone('Europe/Lisbon') AND is_valid_time_zone('UTC'), '[7.1] valid zones accepted';
  ASSERT NOT is_valid_time_zone('+02:00') AND NOT is_valid_time_zone('CET')
     AND NOT is_valid_time_zone('Mars/Olympus') AND NOT is_valid_time_zone(NULL), '[7.2] junk refused';
  PERFORM pg_temp.expect_error('7.3 bad zone on update',
    format('UPDATE events SET timezone = ''Mars/Olympus'' WHERE id = %L', f.run), '%invalid_timezone%');
  -- A weekly 19:00 Lisbon series stays 19:00 local across the WET->WEST change.
  next_wall := event_next_occurrence('2026-03-04T19:00:00Z'::timestamptz, true,
    '{"frequency":"weekly","interval":1}'::jsonb, 'Europe/Lisbon') AT TIME ZONE 'Europe/Lisbon';
  ASSERT to_char(next_wall, 'HH24:MI') = '19:00', '[7.4] zoned stepping keeps the wall clock';
  -- Recurrence end compared on the event-local calendar day.
  ASSERT event_has_ended(now() - interval '10 days', true,
    ('{"frequency":"daily","interval":1,"endDate":"' || ((now() AT TIME ZONE 'Pacific/Auckland')::date - 1) || '"}')::jsonb,
    'Pacific/Auckland'), '[7.5] ended yesterday Auckland-local';
  ASSERT NOT event_has_ended(now() - interval '10 days', true,
    ('{"frequency":"daily","interval":1,"endDate":"' || (now() AT TIME ZONE 'Pacific/Honolulu')::date || '"}')::jsonb,
    'Pacific/Honolulu'), '[7.6] still running on its last Honolulu-local day';
END $$;

-- ── 8. Publishing, visibility, lifecycle ─────────────────────────────────────

DO $$
DECLARE f fx%ROWTYPE; draft_id uuid; copy_id uuid; r json;
BEGIN
  SELECT * INTO f FROM fx;
  PERFORM pg_temp.login(f.host);
  draft_id := create_event_with_limit_check(f.biz, 'Draft show', 'd', f.cat,
    now() + interval '3 days', now() + interval '3 days 2 hours', 37.7, -122.4, 'x',
    NULL, false, NULL, NULL, 'Europe/Lisbon', 'draft');
  PERFORM pg_temp.logout();
  ASSERT (SELECT events_created_this_month FROM businesses WHERE id = f.biz) = 1,
    '[8.1] only the earlier published create counted';  -- from step 4.1
  ASSERT (SELECT count(*) FROM notifications WHERE type = 'new_event_from_followed' AND event_id = draft_id) = 0,
    '[8.2] drafts never ping followers';
  PERFORM pg_temp.login(f.alex);
  ASSERT get_event_details(draft_id) IS NULL, '[8.3] draft details hidden from others';
  ASSERT (SELECT count(*) FROM events WHERE id = draft_id) = 0, '[8.4] draft invisible via the table';
  PERFORM pg_temp.login(f.host);
  PERFORM pg_temp.expect_error('8.5 direct publish',
    format('UPDATE events SET publish_state = ''published'' WHERE id = %L', draft_id), '%use publish_event%');
  r := publish_event(draft_id);
  ASSERT r->>'notified' = '1', '[8.6] publishing pings the follower once';
  ASSERT (SELECT events_created_this_month FROM businesses WHERE id = f.biz) = 2, '[8.7] publish consumed allowance';
  ASSERT (publish_event(draft_id))->>'notified' = '0', '[8.8] publish is idempotent';
  -- Any unflagged publish_state change is refused by the first guard branch;
  -- the "cannot go back" branch is defence-in-depth for flagged paths.
  PERFORM pg_temp.expect_error('8.9 unpublish',
    format('UPDATE events SET publish_state = ''draft'' WHERE id = %L', draft_id), '%use publish_event%');
  -- Unlisted: out of discovery and table reads; details-by-id (share link) works.
  UPDATE events SET visibility = 'unlisted' WHERE id = draft_id;
  PERFORM pg_temp.login(f.alex);
  ASSERT (SELECT count(*) FROM get_ranked_events(37.7, -122.4, 500, NULL, NULL, NULL, NULL, 100, 0)
          WHERE id = draft_id) = 0, '[8.10] unlisted out of ranked';
  ASSERT (SELECT count(*) FROM events WHERE id = draft_id) = 0, '[8.11] unlisted out of table reads';
  ASSERT (get_event_details(draft_id))->'event'->>'title' = 'Draft show', '[8.12] unlisted opens by id';
  -- Reschedule is the only time/place path once someone is going.
  PERFORM join_event_with_capacity(draft_id, 'going');
  PERFORM pg_temp.login(f.host);
  PERFORM pg_temp.expect_error('8.13 plain time move',
    format('UPDATE events SET start_datetime = now() + interval ''4 days'' WHERE id = %L', draft_id),
    '%reschedule_required%');
  UPDATE events SET title = 'Renamed show' WHERE id = draft_id;  -- non-time edits stay direct
  DELETE FROM notifications WHERE event_id = draft_id;
  r := reschedule_event(draft_id, now() + interval '4 days', now() + interval '4 days 2 hours', 'Sorry!');
  ASSERT r->>'notified' = '1', '[8.14] reschedule notifies the attendee';
  PERFORM pg_temp.logout();
  ASSERT (SELECT count(*) FROM notifications WHERE event_id = draft_id AND title = 'Event rescheduled') = 1
     AND (SELECT count(*) FROM notifications WHERE event_id = draft_id AND title = 'Event updated') = 0,
    '[8.15] one rescheduled notice, generic suppressed';
  -- Postpone pauses joining but keeps everyone; reschedule resumes.
  PERFORM pg_temp.login(f.host);
  r := postpone_event(draft_id, 'Storm');
  ASSERT (SELECT status FROM events WHERE id = draft_id) = 'postponed', '[8.16] postponed';
  PERFORM pg_temp.login(f.sam);
  PERFORM pg_temp.expect_error('8.17 join while postponed',
    format('SELECT join_event_with_capacity(%L, ''going'')', draft_id), '%event_closed%');
  PERFORM pg_temp.login(f.host);
  PERFORM reschedule_event(draft_id, now() + interval '5 days', now() + interval '5 days 2 hours', NULL);
  ASSERT (SELECT status FROM events WHERE id = draft_id) = 'active', '[8.18] reschedule resumes';
  ASSERT (SELECT status_note FROM events WHERE id = draft_id) IS NULL, '[8.19] note cleared on resume';
  -- Duplicate -> future-dated draft with links.
  copy_id := duplicate_event(f.art);
  ASSERT (SELECT publish_state FROM events WHERE id = copy_id) = 'draft'
     AND (SELECT start_datetime > now() FROM events WHERE id = copy_id), '[8.20] duplicate is a future draft';
  ASSERT (SELECT count(*) FROM event_links WHERE event_id = copy_id)
       = (SELECT count(*) FROM event_links WHERE event_id = f.art), '[8.21] links copied';
  PERFORM pg_temp.login(f.alex);
  PERFORM pg_temp.expect_error('8.22 non-host duplicate',
    format('SELECT duplicate_event(%L)', f.art), '%only the event host%');
  PERFORM pg_temp.logout();
END $$;

-- ── 9. Chat mode, policy, pins ────────────────────────────────────────────────

DO $$
DECLARE f fx%ROWTYPE; st record; msg_id uuid;
BEGIN
  SELECT * INTO f FROM fx;
  DELETE FROM rsvps WHERE event_id = f.art AND user_id = f.sam;  -- leave one attendee
  PERFORM pg_temp.login(f.alex);
  SELECT * INTO st FROM get_event_chat_post_status(f.art);
  ASSERT NOT st.can_read, '[9.1] default two_going: one attendee has no chat';
  PERFORM pg_temp.login(f.host);
  PERFORM set_event_chat_mode(f.art, NULL, 'any_going');
  PERFORM pg_temp.login(f.alex);
  SELECT * INTO st FROM get_event_chat_post_status(f.art);
  ASSERT st.can_read AND st.can_post AND st.open_policy = 'any_going', '[9.2] any_going opens from the first attendee';
  INSERT INTO event_chat_messages (event_id, sender_id, body, mentions) VALUES (f.art, f.alex, 'hello', '{}');
  PERFORM pg_temp.login(f.host);
  PERFORM set_event_chat_mode(f.art, 'announcements', NULL);
  PERFORM pg_temp.login(f.alex);
  SELECT * INTO st FROM get_event_chat_post_status(f.art);
  ASSERT st.can_read AND NOT st.can_post AND st.locked, '[9.3] announcements: attendees read-only, legacy locked=true';
  PERFORM pg_temp.expect_error('9.4 attendee posts in announcements',
    format('INSERT INTO event_chat_messages (event_id, sender_id, body, mentions) VALUES (%L, %L, ''nope'', ''{}'')', f.art, f.alex),
    '%row-level security%');
  PERFORM pg_temp.login(f.host);
  INSERT INTO event_chat_messages (event_id, sender_id, body, mentions) VALUES (f.art, f.host, 'host note', '{}');
  PERFORM set_event_chat_mode(f.art, 'off', NULL);
  PERFORM pg_temp.login(f.alex);
  SELECT * INTO st FROM get_event_chat_post_status(f.art);
  ASSERT NOT st.can_read, '[9.5] off hides the chat from attendees';
  PERFORM pg_temp.login(f.host);
  SELECT * INTO st FROM get_event_chat_post_status(f.art);
  ASSERT st.can_read AND NOT st.can_post, '[9.6] host keeps reading while off, nobody posts';
  PERFORM set_event_chat_mode(f.art, 'open', NULL);
  PERFORM set_event_chat_settings(f.art, true, NULL);
  ASSERT (SELECT chat_mode FROM event_chat_settings WHERE event_id = f.art) = 'announcements',
    '[9.7] legacy lock maps onto the mode';
  PERFORM set_event_chat_settings(f.art, false, NULL);
  ASSERT (SELECT chat_mode FROM event_chat_settings WHERE event_id = f.art) = 'open',
    '[9.8] legacy unlock maps back';
  SELECT id INTO msg_id FROM event_chat_messages WHERE event_id = f.art AND sender_id = f.host LIMIT 1;
  PERFORM set_event_chat_pin(f.art, msg_id);
  ASSERT (SELECT pinned_message_id FROM event_chat_settings WHERE event_id = f.art) = msg_id, '[9.9] pinned';
  PERFORM pg_temp.login(f.alex);
  PERFORM pg_temp.expect_error('9.10 attendee pins',
    format('SELECT set_event_chat_pin(%L, %L)', f.art, msg_id), '%only the event host%');
  PERFORM pg_temp.login(f.host);
  PERFORM delete_event_chat_message(msg_id);
  ASSERT (SELECT pinned_message_id FROM event_chat_settings WHERE event_id = f.art) IS NULL,
    '[9.11] deleting a pinned message unpins it';
  PERFORM pg_temp.expect_error('9.12 pin a foreign message',
    format('SELECT set_event_chat_pin(%L, %L)', f.art, gen_random_uuid()), '%message_not_found%');
  PERFORM pg_temp.logout();
END $$;

-- ── 10. RSVP approval mode ────────────────────────────────────────────────────

DO $$
DECLARE f fx%ROWTYPE; r text;
BEGIN
  SELECT * INTO f FROM fx;
  UPDATE events SET rsvp_mode = 'approval', max_attendees = NULL WHERE id = f.art;
  DELETE FROM rsvps WHERE event_id = f.art; DELETE FROM notifications WHERE event_id = f.art;
  PERFORM pg_temp.login(f.alex);
  r := join_event_with_capacity(f.art, 'going');
  ASSERT r = 'requested', '[10.1] join becomes a request';
  PERFORM pg_temp.logout();
  ASSERT (SELECT title FROM notifications WHERE user_id = f.host AND event_id = f.art
          ORDER BY created_at DESC LIMIT 1) = 'Request to join your event', '[10.2] host pinged';
  PERFORM pg_temp.login(f.sam);
  PERFORM pg_temp.expect_error('10.3 direct going insert',
    format('INSERT INTO rsvps (user_id, event_id, status) VALUES (%L, %L, ''going'')', f.sam, f.art),
    '%approval_required%');
  ASSERT (SELECT join_event_with_capacity(f.art, 'interested')) = 'interested',
    '[10.4] interested needs no approval';
  PERFORM pg_temp.login(f.alex);
  PERFORM pg_temp.expect_error('10.5 self-upgrade to going',
    format('UPDATE rsvps SET status = ''going'' WHERE event_id = %L AND user_id = %L', f.art, f.alex),
    '%approval_required%');
  PERFORM pg_temp.logout();
  ASSERT (SELECT going_count FROM event_rsvp_counts WHERE event_id = f.art) = 0,
    '[10.6] requests invisible in public counts';
  PERFORM pg_temp.login(f.host);
  ASSERT (get_event_host_overview(f.art))->>'requested' = '1', '[10.7] hub sees the request';
  PERFORM host_review_rsvp(f.art, f.alex, 'approve');
  PERFORM pg_temp.logout();
  ASSERT (SELECT status FROM rsvps WHERE event_id = f.art AND user_id = f.alex) = 'going', '[10.8] approved';
  ASSERT (SELECT title FROM notifications WHERE user_id = f.alex AND event_id = f.art
          ORDER BY created_at DESC LIMIT 1) = 'You''re in', '[10.9] approval notifies the requester';
  PERFORM pg_temp.login(f.sam);
  PERFORM join_event_with_capacity(f.art, 'going');
  PERFORM pg_temp.login(f.host);
  PERFORM host_review_rsvp(f.art, f.sam, 'decline');
  PERFORM pg_temp.logout();
  ASSERT (SELECT count(*) FROM rsvps WHERE event_id = f.art AND user_id = f.sam AND status = 'requested') = 0,
    '[10.10] declined request removed';
  ASSERT (SELECT title FROM notifications WHERE user_id = f.sam AND event_id = f.art
          ORDER BY created_at DESC LIMIT 1) = 'Request not approved', '[10.11] decline notifies politely';
  -- Capacity is enforced at approval time.
  PERFORM pg_temp.login(f.host);
  PERFORM host_set_event_capacity(f.art, 1);
  PERFORM pg_temp.login(f.sam);
  PERFORM join_event_with_capacity(f.art, 'going');
  PERFORM pg_temp.login(f.host);
  PERFORM pg_temp.expect_error('10.12 approve into a full event',
    format('SELECT host_review_rsvp(%L, %L, ''approve'')', f.art, f.sam), '%EVENT_FULL%');
  -- Cancelling tells requesters too (fix in 20261103170000).
  DELETE FROM notifications WHERE event_id = f.art;
  PERFORM cancel_event(f.art);
  PERFORM pg_temp.logout();
  ASSERT (SELECT count(*) FROM notifications WHERE user_id = f.sam AND event_id = f.art
          AND title = 'Event cancelled') = 1, '[10.13] pending requester hears about cancellation';
END $$;

-- ── 11. Review-driven hardening (2026-11-03 final round) ─────────────────────

DO $$
DECLARE f fx%ROWTYPE; r json; before_pin uuid; copy2_id uuid;
BEGIN
  SELECT * INTO f FROM fx;
  -- 11.1 An RSVP cannot be moved between events (closed/approval/full bypass).
  PERFORM set_config('eventmap.allow_reschedule', 'true', true);
  PERFORM set_config('eventmap.allow_status_change', 'true', true);  -- art was cancelled in §10
  UPDATE events SET status = 'active', rsvp_closed = false, rsvp_mode = 'open', max_attendees = NULL,
    start_datetime = now() + interval '1 day', end_datetime = now() + interval '1 day 2 hours',
    publish_state = 'published'
  WHERE id IN (f.art, f.run);
  PERFORM set_config('eventmap.allow_reschedule', '', true);
  PERFORM set_config('eventmap.allow_status_change', '', true);
  DELETE FROM rsvps WHERE event_id IN (f.art, f.run);
  DELETE FROM event_bans; DELETE FROM event_waitlist;
  PERFORM pg_temp.login(f.alex);
  PERFORM join_event_with_capacity(f.run, 'going');
  PERFORM pg_temp.login(f.host);
  PERFORM host_set_event_settings(f.art, true, NULL, NULL); -- close art
  PERFORM pg_temp.login(f.alex);
  PERFORM pg_temp.expect_error('11.1 rsvp event move',
    format('UPDATE rsvps SET event_id = %L WHERE event_id = %L AND user_id = %L', f.art, f.run, f.alex),
    '%cannot move to another event%');
  PERFORM pg_temp.login(f.host);
  PERFORM host_set_event_settings(f.art, false, NULL, 'approval');
  -- 11.2 The waitlist cannot route around approval mode.
  PERFORM host_set_event_capacity(f.art, 1);
  PERFORM pg_temp.logout();
  PERFORM set_config('eventmap.allow_approval', 'true', true);
  INSERT INTO rsvps (user_id, event_id, status) VALUES (f.alex, f.art, 'going')
  ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'going';
  PERFORM set_config('eventmap.allow_approval', '', true);
  PERFORM pg_temp.login(f.sam);
  PERFORM pg_temp.expect_error('11.2 waitlist under approval',
    format('SELECT join_event_waitlist(%L)', f.art), '%approval_required%');
  PERFORM pg_temp.logout();
  -- 11.3 Auto-promote never admits unapproved people on approval events.
  UPDATE events SET waitlist_mode = 'auto' WHERE id = f.art;
  INSERT INTO event_waitlist (event_id, user_id) VALUES (f.art, f.sam);  -- pre-mode-switch leftover
  DELETE FROM rsvps WHERE event_id = f.art AND user_id = f.alex;         -- seat frees
  ASSERT NOT EXISTS (SELECT 1 FROM rsvps WHERE event_id = f.art AND user_id = f.sam),
    '[11.3] approval event must not auto-admit from the waitlist';
  DELETE FROM event_waitlist WHERE event_id = f.art;
  -- 11.4 Direct 'requested' insert on an open event is refused.
  UPDATE events SET rsvp_mode = 'open', waitlist_mode = 'notify', max_attendees = NULL WHERE id = f.art;
  PERFORM pg_temp.login(f.sam);
  PERFORM pg_temp.expect_error('11.4 requested on open event',
    format('INSERT INTO rsvps (user_id, event_id, status) VALUES (%L, %L, ''requested'')', f.sam, f.art),
    '%does not take join requests%');
  -- 11.5 duplicate_event carries rsvp_mode.
  PERFORM pg_temp.login(f.host);
  PERFORM host_set_event_settings(f.art, NULL, NULL, 'approval');
  copy2_id := duplicate_event(f.art);
  ASSERT (SELECT rsvp_mode FROM events WHERE id = copy2_id) = 'approval',
    '[11.5] duplicated event keeps approval mode';
  PERFORM host_set_event_settings(f.art, NULL, NULL, 'open');
  -- 11.6 Legacy lock RPC leaves an off chat alone.
  PERFORM set_event_chat_mode(f.art, 'off', NULL);
  PERFORM set_event_chat_settings(f.art, false, NULL);
  ASSERT (SELECT chat_mode = 'off' AND locked FROM event_chat_settings WHERE event_id = f.art),
    '[11.6] legacy unlock must not break the off invariant';
  -- 11.7 Announcements do not mirror into a switched-off chat.
  SELECT pinned_message_id INTO before_pin FROM event_chat_settings WHERE event_id = f.art;
  PERFORM pg_temp.logout();
  DELETE FROM host_announcements WHERE event_id = f.art;  -- direct DML is postgres-only
  PERFORM pg_temp.login(f.host);
  r := send_event_announcement(f.art, 'Off-chat announcement', 'going');
  ASSERT NOT EXISTS (SELECT 1 FROM event_chat_messages WHERE event_id = f.art AND body = '📣 Off-chat announcement'),
    '[11.7] no chat mirror while the chat is off';
  ASSERT (SELECT pinned_message_id IS NOT DISTINCT FROM before_pin FROM event_chat_settings WHERE event_id = f.art),
    '[11.7b] pin untouched while the chat is off';
  PERFORM set_event_chat_mode(f.art, 'open', NULL);
  -- 11.8 Postponed: an attendee can still downgrade going -> interested.
  PERFORM pg_temp.logout();
  PERFORM set_config('eventmap.allow_approval', 'true', true);
  INSERT INTO rsvps (user_id, event_id, status) VALUES (f.alex, f.art, 'going')
  ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'going';
  PERFORM set_config('eventmap.allow_approval', '', true);
  PERFORM pg_temp.login(f.host);
  PERFORM postpone_event(f.art, NULL);
  PERFORM pg_temp.login(f.alex);
  ASSERT (SELECT join_event_with_capacity(f.art, 'interested')) = 'interested',
    '[11.8] downgrade allowed while postponed';
  PERFORM pg_temp.expect_error('11.8b no self-upgrade while postponed',
    format('UPDATE rsvps SET status = ''going'' WHERE event_id = %L AND user_id = %L', f.art, f.alex),
    '%event_closed%');
  PERFORM pg_temp.login(f.sam);
  PERFORM pg_temp.expect_error('11.8c no new rows while postponed',
    format('INSERT INTO rsvps (user_id, event_id, status) VALUES (%L, %L, ''interested'')', f.sam, f.art),
    '%event_closed%');
  -- 11.9 Publishing a recurring draft whose series ended is refused.
  PERFORM pg_temp.login(f.host);
  PERFORM pg_temp.expect_error('11.9 publish an ended recurring draft',
    format($q$SELECT publish_event(create_event_with_limit_check(%L, 'Old series', 'd', %L,
      now() - interval '60 days', now() - interval '60 days' + interval '1 hour', 37.7, -122.4, 'x',
      NULL, true, '{"frequency":"weekly","interval":1,"endDate":"2020-01-01"}'::jsonb, NULL, NULL, 'draft'))$q$,
      f.biz, f.cat),
    '%already over%');
  PERFORM pg_temp.logout();
END $$;

DO $$ BEGIN RAISE NOTICE 'host-tools regression suite: ALL CHECKS PASSED'; END $$;

ROLLBACK;
