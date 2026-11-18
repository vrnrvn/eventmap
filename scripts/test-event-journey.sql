-- HOW TO RUN (rule since 2026-11-14): in a throwaway container on the stack's
-- own Postgres 17 image, never against the shared cluster —
--
--   scripts/pg17-isolated.sh init
--   for f in supabase/prepared/2026-11-17_event_journey/*.sql; do scripts/pg17-isolated.sh apply "$f"; done
--   scripts/pg17-isolated.sh apply scripts/test-event-journey.sql
--
-- Regression suite for the event-journey review migrations
-- (docs/EVENT_JOURNEY_REVIEW_2026-11-17.md; files staged in
-- supabase/prepared/2026-11-17_event_journey/ until the owner applies them).
--
-- One transaction, rolled back; every check is an ASSERT. Each block first
-- looks for its migration and SKIPS (NOTICE) when it is not applied, so the
-- suite passes on a database with none, some or all of the seven files — it
-- is part of `scripts/pg17-isolated.sh suites` either way.
--
-- Impersonation is via JWT claims (auth.uid()). The one block that must run
-- as `authenticated` (the RSVP DELETE policy) first asserts that role can
-- execute every function on that path, because a "permission denied for
-- function" after SET ROLE segfaults this image (docs/ISSUES.md Ground rules).
BEGIN;
SET LOCAL client_min_messages = notice;

UPDATE businesses SET host_terms_version = host_terms_current_version(),
                      host_terms_accepted_at = COALESCE(host_terms_accepted_at, now());

CREATE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.su() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '', true) $$;
CREATE FUNCTION pg_temp.has_fn(n text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = n) $$;
CREATE FUNCTION pg_temp.fn_has(n text, needle text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = n AND prosrc LIKE '%' || needle || '%') $$;
-- Raises → its message; succeeds → NULL.
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
CREATE FUNCTION pg_temp.told(u uuid, ev uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::int FROM notifications WHERE user_id = u AND event_id = ev $$;

CREATE TEMP TABLE ctx AS
SELECT e.business_id AS biz, e.category_id AS cat,
       '10000000-0000-4000-8000-000000000001'::uuid AS host,
       '10000000-0000-4000-8000-000000000002'::uuid AS alex,
       '10000000-0000-4000-8000-000000000003'::uuid AS sam
  FROM events e WHERE e.id = '30000000-0000-4000-8000-000000000001';

-- A weekly UTC series whose first date is `first_offset` from now (minute-aligned).
CREATE FUNCTION pg_temp.series(id uuid, first_offset interval, pattern jsonb DEFAULT '{"frequency":"weekly","interval":1}')
RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime,
                      lat, lng, address, status, publish_state, visibility, is_recurring, recurrence_pattern, timezone)
  SELECT id, c.biz, 'EJ series', 'fixture', c.cat,
         date_trunc('minute', now()) + first_offset, date_trunc('minute', now()) + first_offset + interval '2 hours',
         37.77, -122.41, 'x', 'active', 'published', 'public', true, pattern, 'UTC'
    FROM ctx c
  RETURNING id $$;
-- A one-off created in the future (so RSVPs can be added), optionally moved
-- into the past afterwards with pg_temp.end_it().
CREATE FUNCTION pg_temp.oneoff(id uuid, cap integer DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime,
                      lat, lng, address, status, publish_state, visibility, max_attendees, timezone)
  SELECT id, c.biz, 'EJ one-off', 'fixture', c.cat, now() + interval '2 days', now() + interval '2 days 2 hours',
         37.77, -122.41, 'x', 'active', 'published', 'public', cap, 'UTC'
    FROM ctx c
  RETURNING id $$;
CREATE FUNCTION pg_temp.end_it(ev uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('eventmap.allow_reschedule', 'true', true);
  PERFORM set_config('eventmap.skip_update_notice', 'true', true);
  UPDATE events SET start_datetime = now() - interval '5 hours', end_datetime = now() - interval '3 hours' WHERE id = ev;
  PERFORM set_config('eventmap.allow_reschedule', '', true);
  PERFORM set_config('eventmap.skip_update_notice', '', true);
END $$;
-- A real future date of a weekly series that started `first_offset` ago: n weeks on.
CREATE FUNCTION pg_temp.week_date(ev uuid, n integer) RETURNS date LANGUAGE sql AS $$
  SELECT ((start_datetime AT TIME ZONE 'UTC')::date + 7 * n) FROM events WHERE id = ev $$;

-- ---------------------------------------------------------------------------
-- [1] 20261117100000_occurrence_rsvp_guards — EJ-1, EJ-13
-- ---------------------------------------------------------------------------
DO $$
DECLARE c ctx%ROWTYPE; ev uuid := '9e170000-0000-4000-8000-000000000101'; m text;
BEGIN
  IF NOT pg_temp.fn_has('set_occurrence_rsvp', 'account suspended') THEN
    RAISE NOTICE '[1] skipped: migration 20261117100000 not applied'; RETURN;
  END IF;
  SELECT * INTO c FROM ctx;
  -- Started 7 days 3 hours ago, 2 h long: today''s session ran 3 h → 1 h ago.
  PERFORM pg_temp.series(ev, - interval '7 days 3 hours');

  INSERT INTO banned_users (user_id, banned_by, reason) VALUES (c.alex, c.host, 'ej fixture');
  PERFORM pg_temp.as_user(c.alex);
  m := pg_temp.err(format('SELECT set_occurrence_rsvp(%L, %L::date, %L)', ev, pg_temp.week_date(ev, 2), 'going'));
  ASSERT m LIKE '%account suspended%', '[1.1] suspended account refused per-date RSVP: ' || coalesce(m, 'accepted');
  PERFORM pg_temp.su();
  DELETE FROM banned_users WHERE reason = 'ej fixture';

  PERFORM pg_temp.as_user(c.sam);
  m := pg_temp.err(format('SELECT set_occurrence_rsvp(%L, %L::date, %L)', ev,
                          ((now() - interval '3 hours') AT TIME ZONE 'UTC')::date, 'going'));
  ASSERT m LIKE '%that date is over%' OR m LIKE '%does not run on that date%',
         '[1.2] a finished date is refused: ' || coalesce(m, 'accepted');
  m := pg_temp.err(format('SELECT set_occurrence_rsvp(%L, %L::date, %L)', ev, pg_temp.week_date(ev, 2), 'going'));
  ASSERT m IS NULL, '[1.3] a future date is still accepted: ' || coalesce(m, '');
  PERFORM pg_temp.su();
  RAISE NOTICE '[1] ok';
END $$;

-- ---------------------------------------------------------------------------
-- [2] 20261117110000_freeze_attendance_after_end — EJ-12
-- ---------------------------------------------------------------------------
DO $$
DECLARE c ctx%ROWTYPE; ev uuid := '9e170000-0000-4000-8000-000000000201';
        ev2 uuid := '9e170000-0000-4000-8000-000000000202'; n integer;
BEGIN
  IF NOT pg_temp.has_fn('event_is_over') THEN
    RAISE NOTICE '[2] skipped: migration 20261117110000 not applied'; RETURN;
  END IF;
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.oneoff(ev, 1);
  INSERT INTO rsvps (user_id, event_id, status) VALUES (c.alex, ev, 'going');
  INSERT INTO event_waitlist (event_id, user_id) VALUES (ev, c.sam);
  PERFORM pg_temp.end_it(ev);
  DELETE FROM notifications WHERE event_id = ev;

  -- Segfault guard: every function the DELETE policy expression calls must be
  -- executable by `authenticated`. (Trigger functions are not checked here:
  -- Postgres checks EXECUTE on them when the trigger is created, never when it
  -- fires — the app's own "leave event" deletes as authenticated through these
  -- triggers. record_rsvp_history, for one, is not granted and need not be.)
  ASSERT has_function_privilege('authenticated', 'public.event_is_over(uuid)', 'EXECUTE'), '[2.0] event_is_over executable';
  ASSERT has_function_privilege('authenticated', 'auth.uid()', 'EXECUTE'), '[2.0] auth.uid executable';

  PERFORM pg_temp.as_user(c.alex);
  PERFORM set_config('role', 'authenticated', true);
  DELETE FROM rsvps WHERE event_id = ev AND user_id = c.alex;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.su();
  ASSERT n = 0, '[2.1] going RSVP cannot be deleted after the end, deleted ' || n;

  -- The cascade path (e.g. account deletion) bypasses the policy: triggers
  -- must still not tell the waitlist / host anything.
  DELETE FROM rsvps WHERE event_id = ev AND user_id = c.alex;
  ASSERT pg_temp.told(c.sam, ev) = 0, '[2.2] waitlist not told "a spot opened up" for an ended event';
  ASSERT pg_temp.told(c.host, ev) = 0, '[2.3] host not told "someone left" an ended event';

  -- Control: an interested row stays deletable after the end; before the end
  -- leaving still works.
  PERFORM pg_temp.oneoff(ev2);
  INSERT INTO rsvps (user_id, event_id, status) VALUES (c.sam, ev2, 'interested');
  PERFORM pg_temp.end_it(ev2);
  PERFORM pg_temp.as_user(c.sam);
  PERFORM set_config('role', 'authenticated', true);
  DELETE FROM rsvps WHERE event_id = ev2 AND user_id = c.sam;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('role', 'postgres', true);
  PERFORM pg_temp.su();
  ASSERT n = 1, '[2.4] interested row still deletable after the end';
  RAISE NOTICE '[2] ok';
END $$;

-- ---------------------------------------------------------------------------
-- [3] 20261117120000_event_notice_audience — EJ-19, EJ-21, EJ-20, EJ-15, EJ-23
-- ---------------------------------------------------------------------------
DO $$
DECLARE c ctx%ROWTYPE; s uuid := '9e170000-0000-4000-8000-000000000301';
        o uuid := '9e170000-0000-4000-8000-000000000302'; p uuid := '9e170000-0000-4000-8000-000000000303';
        d1 date; d2 date; t text; b text; m text;
BEGIN
  IF NOT pg_temp.has_fn('event_notice_audience') THEN
    RAISE NOTICE '[3] skipped: migration 20261117120000 not applied'; RETURN;
  END IF;
  SELECT * INTO c FROM ctx;

  -- Series: alex goes to the series, sam to ONE date only (d1).
  PERFORM pg_temp.series(s, - interval '7 days' + interval '2 hours');
  d1 := pg_temp.week_date(s, 2); d2 := pg_temp.week_date(s, 3);
  PERFORM pg_temp.as_user(c.alex); PERFORM join_event_with_capacity(s, 'going');
  PERFORM pg_temp.as_user(c.sam);  PERFORM set_occurrence_rsvp(s, d1, 'going');
  PERFORM pg_temp.su(); DELETE FROM notifications;

  PERFORM pg_temp.as_user(c.host);
  PERFORM skip_occurrence(s, d2, NULL, true);
  PERFORM pg_temp.su();
  ASSERT pg_temp.told(c.alex, s) = 1, '[3.1] series goer told a date is cancelled';
  ASSERT pg_temp.told(c.sam, s) = 0, '[3.2] date-only goer of ANOTHER date not told';
  DELETE FROM notifications;
  PERFORM pg_temp.as_user(c.host);
  PERFORM skip_occurrence(s, d1, NULL, true);
  PERFORM pg_temp.su();
  ASSERT pg_temp.told(c.sam, s) = 1, '[3.3] date-only goer told THEIR date is cancelled (EJ-19)';
  DELETE FROM notifications;

  PERFORM pg_temp.as_user(c.host);
  PERFORM send_event_announcement(s, 'Bring water', 'going');
  PERFORM pg_temp.su();
  ASSERT (SELECT count(*) FROM notifications WHERE user_id = c.sam AND type = 'host_announcement') = 1,
         '[3.4] date-only goer gets a "going" announcement';
  DELETE FROM notifications;

  -- One-off: sam going, alex waitlisted, host saved nothing; a saver (sam on o2) …
  PERFORM pg_temp.oneoff(o, 1);
  PERFORM pg_temp.as_user(c.sam);  PERFORM join_event_with_capacity(o, 'going');
  PERFORM pg_temp.as_user(c.alex); PERFORM join_event_waitlist(o);
  PERFORM pg_temp.su();
  INSERT INTO saves (user_id, event_id) VALUES (c.alex, o) ON CONFLICT DO NOTHING;
  DELETE FROM notifications;

  -- EJ-15: end-only change.
  PERFORM pg_temp.as_user(c.host);
  PERFORM reschedule_event(o, (SELECT start_datetime FROM events WHERE id = o),
                              (SELECT end_datetime + interval '30 minutes' FROM events WHERE id = o), NULL, NULL, NULL, NULL);
  PERFORM pg_temp.su();
  SELECT title, body INTO t, b FROM notifications WHERE user_id = c.sam AND event_id = o;
  ASSERT t = 'Event time changed' AND b LIKE '%now ends at%', '[3.5] end-only change worded as such: ' || coalesce(t, '-') || ' / ' || coalesce(b, '-');
  ASSERT pg_temp.told(c.alex, o) = 1, '[3.6] waitlisted saver told once about a reschedule (EJ-21)';
  ASSERT (SELECT rescheduled_at IS NOT NULL FROM events WHERE id = o), '[3.7] rescheduled_at set (EJ-23)';
  DELETE FROM notifications;

  -- Cancel: going + waitlisted saver each told exactly once.
  PERFORM pg_temp.as_user(c.host); PERFORM cancel_event(o); PERFORM pg_temp.su();
  ASSERT pg_temp.told(c.sam, o) = 1, '[3.8] going attendee told once about the cancellation';
  ASSERT pg_temp.told(c.alex, o) = 1, '[3.9] waitlisted saver told once (no duplicate)';
  DELETE FROM notifications;

  -- EJ-20: a pattern change notifies, before pruning the date-only RSVP.
  PERFORM pg_temp.series(p, - interval '7 days' + interval '2 hours');
  PERFORM pg_temp.as_user(c.alex); PERFORM join_event_with_capacity(p, 'going');
  PERFORM pg_temp.as_user(c.sam);  PERFORM set_occurrence_rsvp(p, pg_temp.week_date(p, 2), 'going');
  PERFORM pg_temp.su(); DELETE FROM notifications;
  PERFORM pg_temp.as_user(c.host);
  UPDATE events SET recurrence_pattern = '{"frequency":"weekly","interval":3}' WHERE id = p;
  PERFORM pg_temp.su();
  ASSERT (SELECT count(*) FROM notifications WHERE event_id = p AND title = 'Schedule changed' AND user_id IN (c.alex, c.sam)) = 2,
         '[3.10] series goer and the date-only goer both told the schedule changed';
  ASSERT NOT EXISTS (SELECT 1 FROM rsvp_occurrences WHERE event_id = p AND user_id = c.sam),
         '[3.11] (unchanged behaviour) the dropped date''s RSVP is still pruned';
  RAISE NOTICE '[3] ok';
END $$;

-- ---------------------------------------------------------------------------
-- [4] 20261117130000_date_only_chat_access — EJ-19 chat, EJ-22
-- ---------------------------------------------------------------------------
DO $$
DECLARE c ctx%ROWTYPE; s uuid := '9e170000-0000-4000-8000-000000000401';
        lone uuid := '9e170000-0000-4000-8000-000000000402'; r record;
BEGIN
  IF NOT pg_temp.has_fn('event_chat_member') THEN
    RAISE NOTICE '[4] skipped: migration 20261117130000 not applied'; RETURN;
  END IF;
  SELECT * INTO c FROM ctx;
  ASSERT NOT has_function_privilege('authenticated', 'public.event_chat_member(uuid, uuid)', 'EXECUTE'),
         '[4.0] event_chat_member is internal';

  PERFORM pg_temp.series(s, - interval '7 days' + interval '2 hours');
  PERFORM pg_temp.as_user(c.alex); PERFORM join_event_with_capacity(s, 'going');
  PERFORM pg_temp.as_user(c.sam);  PERFORM set_occurrence_rsvp(s, pg_temp.week_date(s, 2), 'going');
  SELECT * INTO r FROM get_event_chat_post_status(s);
  ASSERT r.can_read AND r.can_post, '[4.1] date-only goer can read and post';
  PERFORM pg_temp.as_user(c.alex);
  SELECT * INTO r FROM get_event_chat_post_status(s);
  ASSERT r.can_read, '[4.2] a date-only goer counts toward the two-going unlock';
  PERFORM pg_temp.su();

  -- Lone attendee, chat locked by "two going": a host message notifies nobody.
  PERFORM pg_temp.oneoff(lone);
  PERFORM pg_temp.as_user(c.alex); PERFORM join_event_with_capacity(lone, 'going');
  PERFORM pg_temp.su(); DELETE FROM notifications;
  INSERT INTO event_chat_messages (event_id, sender_id, body, mentions) VALUES (lone, c.host, 'hello', '{}');
  ASSERT (SELECT count(*) FROM notifications WHERE user_id = c.alex AND type LIKE 'chat_%') = 0,
         '[4.3] no chat notice for a chat the recipient cannot open';

  -- Announcement on an open chat: one notice, not two.
  DELETE FROM notifications;
  PERFORM pg_temp.as_user(c.host); PERFORM send_event_announcement(s, 'Doors at 7', 'going'); PERFORM pg_temp.su();
  ASSERT (SELECT count(*) FROM notifications WHERE user_id = c.alex AND event_id = s) = 1,
         '[4.4] announcement arrives once (no chat_message duplicate)';
  RAISE NOTICE '[4] ok';
END $$;

-- ---------------------------------------------------------------------------
-- [5] 20261117140000_move_past_series_end — EJ-14 (pending owner OK)
-- ---------------------------------------------------------------------------
DO $$
DECLARE c ctx%ROWTYPE; s uuid := '9e170000-0000-4000-8000-000000000501'; last_d date; m text;
BEGIN
  IF NOT pg_temp.fn_has('reschedule_occurrence', 'past the series end') THEN
    RAISE NOTICE '[5] skipped: migration 20261117140000 not applied'; RETURN;
  END IF;
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.series(s, - interval '7 days' + interval '2 hours');
  last_d := pg_temp.week_date(s, 2);
  UPDATE events SET recurrence_pattern = jsonb_build_object('frequency', 'weekly', 'interval', 1, 'endDate', last_d::text) WHERE id = s;

  PERFORM pg_temp.as_user(c.host);
  m := pg_temp.err(format('SELECT reschedule_occurrence(%L, %L::date, %L::timestamptz, %L::timestamptz, NULL, false)',
       s, last_d, (last_d + 7 + time '18:00') AT TIME ZONE 'UTC', (last_d + 7 + time '20:00') AT TIME ZONE 'UTC'));
  ASSERT m LIKE '%would add%', '[5.1] a move that would create another date is refused: ' || coalesce(m, 'accepted');
  m := pg_temp.err(format('SELECT reschedule_occurrence(%L, %L::date, %L::timestamptz, %L::timestamptz, NULL, false)',
       s, last_d, (last_d + 3 + time '18:00') AT TIME ZONE 'UTC', (last_d + 3 + time '20:00') AT TIME ZONE 'UTC'));
  ASSERT m IS NULL, '[5.2] moving the last date 3 days on is accepted: ' || coalesce(m, '');
  PERFORM pg_temp.su();
  ASSERT (SELECT recurrence_pattern->>'endDate' FROM events WHERE id = s) = (last_d + 3)::text,
         '[5.3] the series end moved with it';
  ASSERT NOT (SELECT event_has_ended(end_datetime, is_recurring, recurrence_pattern, timezone) FROM events WHERE id = s),
         '[5.4] the series is not over';
  RAISE NOTICE '[5] ok';
END $$;

-- ---------------------------------------------------------------------------
-- [6] 20261117150000_expire_requests_at_end — EJ-18
-- ---------------------------------------------------------------------------
DO $$
DECLARE c ctx%ROWTYPE; ended uuid := '9e170000-0000-4000-8000-000000000601';
        future uuid := '9e170000-0000-4000-8000-000000000602'; n integer;
BEGIN
  IF NOT pg_temp.has_fn('expire_ended_requests') THEN
    RAISE NOTICE '[6] skipped: migration 20261117150000 not applied'; RETURN;
  END IF;
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.oneoff(ended); PERFORM pg_temp.oneoff(future);
  PERFORM set_config('eventmap.allow_approval', 'true', true);
  UPDATE events SET rsvp_mode = 'approval' WHERE id IN (ended, future);
  PERFORM set_config('eventmap.allow_approval', '', true);
  PERFORM pg_temp.as_user(c.sam);
  PERFORM join_event_with_capacity(ended, 'going'); PERFORM join_event_with_capacity(future, 'going');
  PERFORM pg_temp.su();
  PERFORM pg_temp.end_it(ended);
  DELETE FROM notifications;

  n := expire_ended_requests();
  ASSERT n >= 1, '[6.1] at least the fixture request expired';
  ASSERT NOT EXISTS (SELECT 1 FROM rsvps WHERE event_id = ended AND user_id = c.sam), '[6.2] request on an ended event removed';
  ASSERT EXISTS (SELECT 1 FROM rsvps WHERE event_id = future AND user_id = c.sam AND status = 'requested'),
         '[6.3] request on a future event untouched';
  IF pg_temp.fn_has('expire_ended_requests', 'Request closed') THEN
    ASSERT (SELECT count(*) FROM notifications WHERE user_id = c.sam AND event_id = ended AND title = 'Request closed') = 1,
           '[6.4] requester told once';
  END IF;
  RAISE NOTICE '[6] ok';
END $$;

-- ---------------------------------------------------------------------------
-- [7] 20261117160000_attendance_per_session — EJ-16
-- ---------------------------------------------------------------------------
DO $$
DECLARE c ctx%ROWTYPE; s uuid := '9e170000-0000-4000-8000-000000000701'; first_d date; v json;
BEGIN
  IF NOT pg_temp.has_fn('user_series_sessions_attended') THEN
    RAISE NOTICE '[7] skipped: migration 20261117160000 not applied'; RETURN;
  END IF;
  SELECT * INTO c FROM ctx;
  -- Weekly, first date 21 days ago: finished dates at -21, -14, -7 days.
  PERFORM pg_temp.series(s, - interval '21 days');
  first_d := pg_temp.week_date(s, 0);
  PERFORM pg_temp.as_user(c.alex); PERFORM join_event_with_capacity(s, 'going'); PERFORM pg_temp.su();
  -- Opted out of the 2nd date; the host skipped the 3rd; sam went to the 1st only.
  INSERT INTO rsvp_occurrences (event_id, user_id, occurrence_date, status) VALUES
    (s, c.alex, first_d + 7, 'not_going'),
    (s, c.sam, first_d, 'going');
  INSERT INTO event_occurrence_exceptions (event_id, occurrence_date, kind, created_by)
    VALUES (s, first_d + 14, 'cancelled', c.host);

  ASSERT user_series_sessions_attended(s, c.alex) = 1,
         '[7.1] series goer: 3 finished dates − 1 opted out − 1 cancelled = 1, got ' || user_series_sessions_attended(s, c.alex);
  ASSERT user_series_sessions_attended(s, c.sam) = 1, '[7.2] date-only goer: their one date';

  PERFORM pg_temp.as_user(c.alex);
  v := get_user_attendance_counts(c.alex);
  ASSERT (v->>'attended_count')::int >= 1, '[7.3] the open-ended series is credited (was 0): ' || v::text;
  ASSERT EXISTS (SELECT 1 FROM json_array_elements(get_user_going_events(c.alex, 'past', 50, 0)) j WHERE (j->>'id')::uuid = s),
         '[7.4] the running series is listed under attended';
  PERFORM pg_temp.su();
  RAISE NOTICE '[7] ok';
END $$;

ROLLBACK;
