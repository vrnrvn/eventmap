-- HOW TO RUN (rule since 2026-11-14): in a throwaway container on the stack's
-- own Postgres 17 image, never against the shared cluster —
--
--   PG17_NAME=<unique> scripts/pg17-isolated.sh init
--   PG17_NAME=<unique> scripts/pg17-isolated.sh apply scripts/test-lifecycle.sql
--
-- THE LIFECYCLE HARNESS (roadmap phase 3, approach A: move the event, never
-- the clock). One event is walked IN ORDER through the phases of its life,
-- and at each phase the scheduled jobs are called directly — pg_cron never
-- runs in isolation — and the server's time rules are asserted. now() is
-- frozen for the whole transaction, so each phase is created by re-dating the
-- event relative to that one instant; the known limit of this approach is
-- that no single row ever truly crosses a boundary while being watched.
--
-- pg_temp.set_phase(ev, phase) is THE canonical phase helper. Each phase is
-- aligned to a real server window, measured from the live definitions:
--
--   phase      start, end relative to now()     sits inside
--   ---------  -------------------------------  -----------------------------
--   before     +2 days                           no window (quiet)
--   dayof      +3 hours                          host day-of: (+2 h, +4 h]
--                                                  (20261113110000:48)
--   reminder   +60 minutes                       going reminder: pref 60 ± 5
--                                                  (20261109150000:369)
--   live       -dur/2 .. +dur/2                  mid-event
--   ended      end = -3 hours                    host post-event: [-26 h, -2 h)
--                                                  (20261113110000:81)
--
-- New suites that need a phase copy these helpers (suites are self-contained
-- single files by convention — the runner copies exactly one file into the
-- container). The browser-side twin of this harness is
-- scripts/fake-backend-e2e/suiteLifecycle.mjs, which walks the same phases on
-- the event page with a frozen browser clock.
--
-- One transaction, rolled back; every check is an ASSERT. Blocks that need an
-- object from a specific migration first look for it and SKIP with a NOTICE,
-- so the suite passes on a database with or without the 2026-11-17 set.
-- Impersonation is via JWT claims (auth.uid()); SET ROLE is never used (the
-- segfault rule, docs/ISSUES.md Ground rules) — policy predicates are
-- asserted through their functions instead.
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
CREATE FUNCTION pg_temp.has_col(t text, c text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = t AND column_name = c) $$;

CREATE TEMP TABLE ctx AS
SELECT e.business_id AS biz, e.category_id AS cat,
       '10000000-0000-4000-8000-000000000001'::uuid AS host,
       '10000000-0000-4000-8000-000000000002'::uuid AS alex,
       '10000000-0000-4000-8000-000000000003'::uuid AS sam
  FROM events e WHERE e.id = '30000000-0000-4000-8000-000000000001';

-- A published one-off, minute-aligned, created 'before' (starts in 2 days).
CREATE FUNCTION pg_temp.lc_oneoff(id uuid, mode text DEFAULT 'open') RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime,
                      lat, lng, address, status, publish_state, visibility, rsvp_mode, timezone)
  SELECT id, c.biz, 'lifecycle one-off', 'fixture', c.cat,
         date_trunc('minute', now()) + interval '2 days',
         date_trunc('minute', now()) + interval '2 days 2 hours',
         37.77, -122.41, 'x', 'active', 'published', 'public', mode, 'UTC'
    FROM ctx c
  RETURNING id $$;
-- A weekly UTC series whose first date is `first_offset` from now.
CREATE FUNCTION pg_temp.lc_series(id uuid, first_offset interval) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime,
                      lat, lng, address, status, publish_state, visibility, is_recurring, recurrence_pattern, timezone)
  SELECT id, c.biz, 'lifecycle series', 'fixture', c.cat,
         date_trunc('minute', now()) + first_offset, date_trunc('minute', now()) + first_offset + interval '2 hours',
         37.77, -122.41, 'x', 'active', 'published', 'public', true,
         '{"frequency":"weekly","interval":1}', 'UTC'
    FROM ctx c
  RETURNING id $$;
-- nth weekly date of a series, from its stored start.
CREATE FUNCTION pg_temp.week_date(ev uuid, n integer) RETURNS date LANGUAGE sql AS $$
  SELECT ((start_datetime AT TIME ZONE 'UTC')::date + 7 * n) FROM events WHERE id = ev $$;

-- The phase mover. Keeps the event's duration; bypasses the reschedule guard
-- and the update notice the way pg_temp.end_it in test-event-journey.sql does.
CREATE FUNCTION pg_temp.set_phase(ev uuid, phase text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_dur interval; v_start timestamptz;
BEGIN
  SELECT end_datetime - start_datetime INTO v_dur FROM events WHERE id = ev;
  IF v_dur IS NULL THEN RAISE EXCEPTION 'set_phase: unknown event %', ev; END IF;
  v_start := CASE phase
    WHEN 'before'   THEN date_trunc('minute', now()) + interval '2 days'
    WHEN 'dayof'    THEN date_trunc('minute', now()) + interval '3 hours'
    WHEN 'reminder' THEN date_trunc('minute', now()) + interval '60 minutes'
    WHEN 'live'     THEN now() - (v_dur / 2)
    WHEN 'ended'    THEN now() - interval '3 hours' - v_dur
    -- Past every after-the-end window: the host post-event notice ([-26h,-2h))
    -- is behind it, and the 7-day posting window (D1, 20261118150000) closed.
    WHEN 'ended_week' THEN now() - interval '8 days' - v_dur
  END;
  IF v_start IS NULL THEN RAISE EXCEPTION 'set_phase: unknown phase %', phase; END IF;
  PERFORM set_config('eventmap.allow_reschedule', 'true', true);
  PERFORM set_config('eventmap.skip_update_notice', 'true', true);
  UPDATE events SET start_datetime = v_start, end_datetime = v_start + v_dur WHERE id = ev;
  PERFORM set_config('eventmap.allow_reschedule', '', true);
  PERFORM set_config('eventmap.skip_update_notice', '', true);
END $$;
CREATE FUNCTION pg_temp.ended(ev uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
    FROM events e WHERE e.id = ev $$;
CREATE FUNCTION pg_temp.reminders_for(ev uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::int FROM event_reminder_sent WHERE event_id = ev $$;
CREATE FUNCTION pg_temp.host_notices_for(ev uuid, k text) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::int FROM host_notifications_sent WHERE event_id = ev AND kind = k $$;

-- ---------------------------------------------------------------------------
-- [0] The harness itself: each phase puts the event where it claims.
-- ---------------------------------------------------------------------------
DO $$
DECLARE ev uuid := '9e1f0000-0000-4000-8000-000000000001'; e events%ROWTYPE;
BEGIN
  PERFORM pg_temp.lc_oneoff(ev);

  PERFORM pg_temp.set_phase(ev, 'before');
  SELECT * INTO e FROM events WHERE id = ev;
  ASSERT e.start_datetime > now() + interval '47 hours', '[0.1] before: starts in ~2 days';
  ASSERT NOT pg_temp.ended(ev) AND event_is_open_for_rsvp(ev), '[0.1] before: not ended, open';

  PERFORM pg_temp.set_phase(ev, 'dayof');
  SELECT * INTO e FROM events WHERE id = ev;
  ASSERT e.start_datetime > now() + interval '2 hours' AND e.start_datetime <= now() + interval '4 hours',
    '[0.2] dayof: inside the host day-of window (2h, 4h]';

  PERFORM pg_temp.set_phase(ev, 'reminder');
  SELECT * INTO e FROM events WHERE id = ev;
  ASSERT extract(epoch FROM (e.start_datetime - now())) / 60 BETWEEN 55 AND 65,
    '[0.3] reminder: inside the default going-reminder window (60 ± 5 min)';

  PERFORM pg_temp.set_phase(ev, 'live');
  SELECT * INTO e FROM events WHERE id = ev;
  ASSERT e.start_datetime <= now() AND e.end_datetime > now(), '[0.4] live: now is mid-event';
  ASSERT NOT pg_temp.ended(ev) AND event_is_open_for_rsvp(ev), '[0.4] live: not ended, still open';

  PERFORM pg_temp.set_phase(ev, 'ended');
  SELECT * INTO e FROM events WHERE id = ev;
  ASSERT e.end_datetime < now() - interval '2 hours' AND e.end_datetime >= now() - interval '26 hours',
    '[0.5] ended: inside the host post-event window [-26h, -2h)';
  ASSERT pg_temp.ended(ev) AND NOT event_is_open_for_rsvp(ev), '[0.5] ended: ended and closed';
  ASSERT e.end_datetime - e.start_datetime = interval '2 hours', '[0.6] duration survived every move';

  DELETE FROM events WHERE id = ev;
END $$;

-- ---------------------------------------------------------------------------
-- [1..5] One event, walked through its whole life in order. alex is going,
-- sam is interested and has saved it; ev2 is approval-mode with sam's join
-- request pending. The jobs run at EVERY phase: what matters is as much that
-- they stay silent outside their window as that they fire inside it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c ctx%ROWTYPE;
  ev  uuid := '9e1f0000-0000-4000-8000-000000000002';
  ev2 uuid := '9e1f0000-0000-4000-8000-000000000003';
  n integer; att_live integer; att_ended integer; m text;
BEGIN
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.lc_oneoff(ev);
  PERFORM pg_temp.lc_oneoff(ev2, 'approval');
  -- Deterministic prefs: the default reminder lead and both host notices on.
  UPDATE profiles SET event_reminder_minutes = 60, event_reminder_enabled = true WHERE id = c.alex;
  UPDATE businesses SET notifications_enabled = true, host_day_of_notice = true, host_post_event_notice = true
   WHERE id = c.biz;

  -- [1] BEFORE ---------------------------------------------------------------
  PERFORM pg_temp.set_phase(ev, 'before'); PERFORM pg_temp.set_phase(ev2, 'before');
  INSERT INTO rsvps (event_id, user_id, status) VALUES (ev, c.alex, 'going'), (ev, c.sam, 'interested'),
                                                       (ev2, c.sam, 'requested');
  INSERT INTO saves (event_id, user_id) VALUES (ev, c.sam);
  PERFORM send_event_reminders();
  PERFORM send_host_event_notices();
  ASSERT pg_temp.reminders_for(ev) = 0, '[1.1] before: no reminder two days out';
  ASSERT pg_temp.host_notices_for(ev, 'day_of') = 0, '[1.2] before: no day-of notice two days out';

  -- [2] DAY OF ---------------------------------------------------------------
  PERFORM pg_temp.set_phase(ev, 'dayof');
  PERFORM send_host_event_notices();
  PERFORM send_event_reminders();
  ASSERT pg_temp.host_notices_for(ev, 'day_of') = 1, '[2.1] dayof: the host day-of notice fired';
  PERFORM send_host_event_notices();
  ASSERT pg_temp.host_notices_for(ev, 'day_of') = 1, '[2.2] dayof: it fires once, not per cron run';
  ASSERT pg_temp.reminders_for(ev) = 0, '[2.3] dayof: 3 h out is outside every reminder window';

  -- [3] REMINDER (start in 60 min) --------------------------------------------
  PERFORM pg_temp.set_phase(ev, 'reminder');
  PERFORM send_event_reminders();
  SELECT count(*) INTO n FROM event_reminder_sent WHERE event_id = ev AND user_id = c.alex AND kind = 'going';
  ASSERT n = 1, '[3.1] reminder: the going reminder fired for alex, got ' || n;
  PERFORM send_event_reminders();
  SELECT count(*) INTO n FROM event_reminder_sent WHERE event_id = ev AND user_id = c.alex AND kind = 'going';
  ASSERT n = 1, '[3.2] reminder: it fires once, not per cron run';
  SELECT count(*) INTO n FROM notifications
   WHERE event_id = ev AND user_id = c.alex AND type = 'event_reminder';
  ASSERT n = 1, '[3.3] reminder: exactly one notification row for alex';
  ASSERT NOT EXISTS (SELECT 1 FROM event_reminder_sent WHERE event_id = ev AND user_id = c.sam),
    '[3.4] reminder: 60 min out is outside both interested-nudge windows';

  -- [4] LIVE -----------------------------------------------------------------
  PERFORM pg_temp.set_phase(ev, 'live');
  ASSERT event_is_open_for_rsvp(ev), '[4.1] live: joining is open until the END, not the start';
  IF pg_temp.has_fn('event_is_over') THEN
    ASSERT NOT event_is_over(ev), '[4.2] live: not over, so leaving is still allowed '
      || '(the DELETE policy itself is pinned by test-event-journey [2])';
  END IF;
  INSERT INTO rsvps (event_id, user_id, status) VALUES (ev, c.host, 'going');  -- a second goer
  PERFORM pg_temp.as_user(c.alex);
  ASSERT user_can_access_event_chat(ev), '[4.3] live: chat open for a goer once two are going';
  SELECT (get_user_attendance_counts(c.alex)->>'attended_count')::int INTO att_live;
  PERFORM pg_temp.su();

  -- [5] ENDED ----------------------------------------------------------------
  PERFORM pg_temp.set_phase(ev, 'ended'); PERFORM pg_temp.set_phase(ev2, 'ended');
  ASSERT pg_temp.ended(ev) AND NOT event_is_open_for_rsvp(ev), '[5.1] ended: joining is closed';
  IF pg_temp.has_fn('event_is_over') THEN
    ASSERT event_is_over(ev), '[5.2] ended: over, so the leave-freeze policy applies';
  END IF;

  PERFORM send_event_reminders();
  ASSERT pg_temp.reminders_for(ev) = 1, '[5.3] ended: no reminder fires after the end';

  PERFORM send_host_event_notices();
  ASSERT pg_temp.host_notices_for(ev, 'post_event') = 1, '[5.4] ended: the host post-event summary fired';
  PERFORM send_host_event_notices();
  ASSERT pg_temp.host_notices_for(ev, 'post_event') = 1, '[5.5] ended: it fires once, not per cron run';

  -- Attendance appears once the event is over (counted live from the data).
  PERFORM pg_temp.as_user(c.alex);
  SELECT (get_user_attendance_counts(c.alex)->>'attended_count')::int INTO att_ended;
  ASSERT att_ended = att_live + 1,
    '[5.6] ended: attended rose by exactly this event: ' || att_live || ' -> ' || att_ended;
  -- Reading survives the end, with or without D1 (which closes POSTING a
  -- week later — block [8] pins that half once 20261118150000 is applied).
  ASSERT user_can_access_event_chat(ev), '[5.7] ended: a goer can still read the chat';
  PERFORM pg_temp.su();

  -- Pending requests are swept once the event is over (EJ-18).
  IF pg_temp.has_fn('expire_ended_requests') THEN
    PERFORM expire_ended_requests();
    ASSERT NOT EXISTS (SELECT 1 FROM rsvps WHERE event_id = ev2 AND user_id = c.sam AND status = 'requested'),
      '[5.8] ended: sam''s stranded join request was removed';
    SELECT count(*) INTO n FROM notifications
     WHERE event_id = ev2 AND user_id = c.sam AND data->>'kind' = 'request_expired';
    ASSERT n = 1, '[5.9] ended: sam was told the request lapsed, got ' || n;
  ELSE
    RAISE NOTICE '[5.8-5.9] skipped: 20261117150000 not applied';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- [6] Reschedule marks the event (EJ-23): rescheduled_at is what the client's
-- "Time changed — update your calendar" notice compares the RSVP time with.
-- ---------------------------------------------------------------------------
DO $$
DECLARE c ctx%ROWTYPE; ev uuid := '9e1f0000-0000-4000-8000-000000000004'; e events%ROWTYPE;
BEGIN
  IF NOT pg_temp.has_col('events', 'rescheduled_at') THEN
    RAISE NOTICE '[6] skipped: 20261117120000 not applied'; RETURN;
  END IF;
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.lc_oneoff(ev);
  SELECT * INTO e FROM events WHERE id = ev;
  ASSERT e.rescheduled_at IS NULL, '[6.1] a new event carries no reschedule mark';
  PERFORM pg_temp.as_user(c.host);
  PERFORM reschedule_event(ev, e.start_datetime + interval '1 day', e.end_datetime + interval '1 day');
  PERFORM pg_temp.su();
  SELECT * INTO e FROM events WHERE id = ev;
  ASSERT e.rescheduled_at = now(), '[6.2] a real reschedule sets rescheduled_at to the move time';
  -- set_phase must NOT look like a host reschedule: it is test plumbing.
  PERFORM pg_temp.set_phase(ev, 'ended');
  ASSERT (SELECT rescheduled_at FROM events WHERE id = ev) = e.rescheduled_at,
    '[6.3] set_phase leaves the reschedule mark untouched';
END $$;

-- ---------------------------------------------------------------------------
-- [7] A series' per-session attendance (EJ-16): the count follows the dates
-- that have actually finished, per person.
-- ---------------------------------------------------------------------------
DO $$
DECLARE c ctx%ROWTYPE; ev uuid := '9e1f0000-0000-4000-8000-000000000005'; n integer;
BEGIN
  IF NOT pg_temp.has_fn('user_series_sessions_attended') THEN
    RAISE NOTICE '[7] skipped: 20261117160000 not applied'; RETURN;
  END IF;
  SELECT * INTO c FROM ctx;
  -- First date 21 d 3 h ago, 2 h long: four finished sessions, today's ended
  -- an hour ago (the count includes a session only once its end has passed).
  PERFORM pg_temp.lc_series(ev, - interval '21 days 3 hours');
  INSERT INTO rsvps (event_id, user_id, status) VALUES (ev, c.alex, 'going');
  -- alex skipped one date; sam came to exactly one, by a per-date RSVP.
  INSERT INTO rsvp_occurrences (event_id, user_id, occurrence_date, status)
  VALUES (ev, c.alex, pg_temp.week_date(ev, 2), 'not_going'),
         (ev, c.sam,  pg_temp.week_date(ev, 1), 'going');

  n := user_series_sessions_attended(ev, c.alex);
  ASSERT n = 3, '[7.1] series goer: 4 finished sessions minus 1 opt-out = 3, got ' || n;
  n := user_series_sessions_attended(ev, c.sam);
  ASSERT n = 1, '[7.2] date-only goer: exactly the date they went to, got ' || n;
  n := user_series_sessions_attended(ev, c.host);
  ASSERT n = 0, '[7.3] not going at all: 0, got ' || n;
END $$;

-- ---------------------------------------------------------------------------
-- [8] D1 (EJ-7, 20261118150000): posting stays open for 7 days after the end,
-- then the chat is read-only — for the host too. Announcement notifications
-- keep flowing; only the chat mirror stops.
-- ---------------------------------------------------------------------------
DO $$
DECLARE c ctx%ROWTYPE; ev uuid := '9e1f0000-0000-4000-8000-000000000006'; p record; n int;
BEGIN
  IF NOT pg_temp.has_fn('event_chat_posting_open') THEN
    RAISE NOTICE '[8] skipped: 20261118150000 not applied'; RETURN;
  END IF;
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.lc_oneoff(ev);
  INSERT INTO rsvps (event_id, user_id, status) VALUES (ev, c.alex, 'going'), (ev, c.sam, 'going');

  PERFORM pg_temp.set_phase(ev, 'ended');
  ASSERT event_chat_posting_open(ev), '[8.1] 3 h after the end: the posting window is open';
  PERFORM pg_temp.as_user(c.alex);
  SELECT * INTO p FROM get_event_chat_post_status(ev);
  ASSERT p.can_read AND p.can_post, '[8.2] goer inside the window: read + post';
  PERFORM pg_temp.su();

  PERFORM pg_temp.set_phase(ev, 'ended_week');
  ASSERT NOT event_chat_posting_open(ev), '[8.3] 8 days after the end: read-only';
  PERFORM pg_temp.as_user(c.alex);
  SELECT * INTO p FROM get_event_chat_post_status(ev);
  ASSERT p.can_read AND NOT p.can_post, '[8.4] goer after the window: the history stays readable';
  PERFORM pg_temp.su();
  PERFORM pg_temp.as_user(c.host);
  SELECT * INTO p FROM get_event_chat_post_status(ev);
  ASSERT NOT p.can_post, '[8.5] the host is read-only too';
  -- The announcement still reaches people; the chat mirror is skipped.
  PERFORM send_event_announcement(ev, 'lost property is at the bar');
  PERFORM pg_temp.su();
  SELECT count(*) INTO n FROM event_chat_messages WHERE event_id = ev AND body LIKE '📣%';
  ASSERT n = 0, '[8.6] no mirror into a read-only chat, got ' || n;
  SELECT count(*) INTO n FROM notifications WHERE event_id = ev AND user_id = c.alex AND type = 'host_announcement';
  ASSERT n >= 1, '[8.7] the announcement itself still arrived, got ' || n;
END $$;

-- ---------------------------------------------------------------------------
-- [9] EJ-17 (20261119120000): a SERIES host gets the day-of and post-event
-- notices too, once per occurrence, counted for that date. Blocks [1]–[5]
-- above pin the one-off halves, which this must not disturb.
-- ---------------------------------------------------------------------------
DO $$
DECLARE c ctx%ROWTYPE; ev uuid := '9e1f0000-0000-4000-8000-000000000007'; n int; v_body text;
BEGIN
  IF NOT pg_temp.has_col('host_notifications_sent', 'occurrence_start') THEN
    RAISE NOTICE '[9] skipped: 20261119120000 not applied'; RETURN;
  END IF;
  SELECT * INTO c FROM ctx;
  UPDATE businesses SET notifications_enabled = true, host_day_of_notice = true, host_post_event_notice = true
   WHERE id = c.biz;
  PERFORM pg_temp.lc_series(ev, interval '2 days');
  -- alex goes to the series; sam signed up for just the next date.
  INSERT INTO rsvps (event_id, user_id, status) VALUES (ev, c.alex, 'going');

  -- Day of: the next session is 3 hours away.
  PERFORM pg_temp.set_phase(ev, 'dayof');
  INSERT INTO rsvp_occurrences (event_id, user_id, occurrence_date, status)
  VALUES (ev, c.sam, (SELECT (start_datetime AT TIME ZONE 'UTC')::date FROM events WHERE id = ev), 'going');
  PERFORM send_host_event_notices();
  SELECT count(*) INTO n FROM notifications WHERE event_id = ev AND type = 'host_day_of';
  ASSERT n = 1, '[9.1] a series host is told on the day, got ' || n;
  SELECT n.body INTO v_body FROM notifications n WHERE n.event_id = ev AND n.type = 'host_day_of';
  ASSERT v_body LIKE '%2 people going%',
    '[9.2] counted for THAT date (series goer + date-only goer): ' || v_body;
  PERFORM send_host_event_notices();
  SELECT count(*) INTO n FROM notifications WHERE event_id = ev AND type = 'host_day_of';
  ASSERT n = 1, '[9.3] once per occurrence, not per cron run, got ' || n;

  -- After that session: it ended 3 hours ago.
  PERFORM pg_temp.set_phase(ev, 'ended');
  PERFORM send_host_event_notices();
  SELECT count(*) INTO n FROM notifications WHERE event_id = ev AND type = 'host_post_event_summary';
  ASSERT n = 1, '[9.4] a series host gets the session summary, got ' || n;
  PERFORM send_host_event_notices();
  SELECT count(*) INTO n FROM notifications WHERE event_id = ev AND type = 'host_post_event_summary';
  ASSERT n = 1, '[9.5] the summary fires once for that session, got ' || n;
  ASSERT (SELECT count(*) FROM host_notifications_sent
           WHERE event_id = ev AND occurrence_start IS NOT NULL) = 2,
    '[9.6] both markers are per occurrence';
END $$;

ROLLBACK;
