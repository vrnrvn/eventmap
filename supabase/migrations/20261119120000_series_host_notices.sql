-- EJ-17 — host day-of and post-event notices for recurring series.
--
-- STATUS: PREPARED, NOT APPLIED. Staged in supabase/prepared/; see this
-- folder's README. Independent of every other prepared file.
--
-- The gap: send_host_event_notices filters `is_recurring = false` for BOTH
-- notices (20261113110000:47,80), so a host who runs a weekly club and turns
-- on "Remind me on the day" or "Summary after the event" gets nothing, ever.
-- Batch A corrected the Settings copy to say "one-off events" as an interim;
-- this file makes the switches mean what they originally said, and the copy
-- goes back (client follow-up in the README).
--
-- Per OCCURRENCE, not per event:
--   * day-of fires for the series' next effective occurrence when it starts
--     in 2–4 hours — the same window one-offs use. "Effective" means
--     event_next_effective_occurrence, so a cancelled date is skipped and a
--     moved date uses its new time.
--   * post-event fires for each occurrence that ended 2–26 hours ago,
--     including dates moved INTO that window and excluding cancelled ones.
--   * the attendee count is the count for THAT DATE (series goers minus
--     per-date opt-outs, plus date-only goers, via the existing
--     occurrence_going_count), not the series total.
--
-- Dedupe: host_notifications_sent gains occurrence_start. Its primary key
-- (event_id, kind) becomes a unique index over
-- (event_id, kind, COALESCE(occurrence_start, '-infinity')), so rows already
-- in the table — one-offs, which keep writing NULL — behave exactly as
-- before and need no backfill.

ALTER TABLE public.host_notifications_sent
  ADD COLUMN IF NOT EXISTS occurrence_start timestamptz;

COMMENT ON COLUMN public.host_notifications_sent.occurrence_start IS
  'Which occurrence of a series this notice was for (EJ-17). NULL for a '
  'one-off, which has exactly one.';

ALTER TABLE public.host_notifications_sent DROP CONSTRAINT IF EXISTS host_notifications_sent_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS host_notifications_sent_key
  ON public.host_notifications_sent (event_id, kind, COALESCE(occurrence_start, '-infinity'::timestamptz));

-- The per-date attendee count already exists as occurrence_going_count
-- (20261109150000:51) — series goers minus per-date opt-outs, plus
-- date-only goers — so this file reuses it rather than restating the rule.

CREATE OR REPLACE FUNCTION public.send_host_event_notices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
  v_going integer;
  v_waitlist integer;
  v_views integer;
BEGIN
  -- 1. Day-of: a one-off event starting in the next 2–4 hours. Unchanged.
  FOR v_row IN
    SELECT e.id, e.title, e.business_id, b.owner_id
      FROM events e
      JOIN businesses b ON b.id = e.business_id
     WHERE COALESCE(e.publish_state, 'published') = 'published'
       AND COALESCE(e.status, 'active') = 'active'
       AND COALESCE(e.is_recurring, false) = false
       AND e.start_datetime > now() + interval '2 hours'
       AND e.start_datetime <= now() + interval '4 hours'
       AND COALESCE(b.notifications_enabled, true)
       AND COALESCE(b.host_day_of_notice, false)
       AND NOT EXISTS (
         SELECT 1 FROM host_notifications_sent s
          WHERE s.event_id = e.id AND s.kind = 'day_of' AND s.occurrence_start IS NULL
       )
  LOOP
    SELECT count(*) INTO v_going FROM rsvps r WHERE r.event_id = v_row.id AND r.status = 'going';
    INSERT INTO notifications (user_id, type, title, body, event_id, business_id)
    VALUES (
      v_row.owner_id,
      'host_day_of',
      'Your event is today',
      COALESCE(v_row.title, 'Your event') || ' starts in a few hours with ' || v_going
        || CASE WHEN v_going = 1 THEN ' person going.' ELSE ' people going.' END
        || ' Pin a message or send an announcement if anything changed.',
      v_row.id,
      v_row.business_id
    );
    INSERT INTO host_notifications_sent (event_id, kind) VALUES (v_row.id, 'day_of')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- 1b. EJ-17 — day-of for a SERIES: its next effective occurrence, same
  -- 2–4 hour window, one notice per date.
  FOR v_row IN
    SELECT e.id, e.title, e.business_id, b.owner_id, occ.at AS occ_start,
           (occ.at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'UTC'))::date AS occ_date
      FROM events e
      JOIN businesses b ON b.id = e.business_id
      CROSS JOIN LATERAL (SELECT event_next_effective_occurrence(e.id, now()) AS at) occ
     WHERE COALESCE(e.publish_state, 'published') = 'published'
       AND COALESCE(e.status, 'active') = 'active'
       AND COALESCE(e.is_recurring, false)
       AND e.recurrence_pattern IS NOT NULL
       AND occ.at > now() + interval '2 hours'
       AND occ.at <= now() + interval '4 hours'
       AND COALESCE(b.notifications_enabled, true)
       AND COALESCE(b.host_day_of_notice, false)
       AND NOT EXISTS (
         SELECT 1 FROM host_notifications_sent s
          WHERE s.event_id = e.id AND s.kind = 'day_of' AND s.occurrence_start = occ.at
       )
  LOOP
    v_going := occurrence_going_count(v_row.id, v_row.occ_date);
    INSERT INTO notifications (user_id, type, title, body, event_id, business_id)
    VALUES (
      v_row.owner_id,
      'host_day_of',
      'Your event is today',
      COALESCE(v_row.title, 'Your event') || ' has a session in a few hours with ' || v_going
        || CASE WHEN v_going = 1 THEN ' person going.' ELSE ' people going.' END
        || ' Pin a message or send an announcement if anything changed.',
      v_row.id,
      v_row.business_id
    );
    INSERT INTO host_notifications_sent (event_id, kind, occurrence_start)
    VALUES (v_row.id, 'day_of', v_row.occ_start)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- 2. Post-event: a one-off that ended 2–26 hours ago. Unchanged.
  FOR v_row IN
    SELECT e.id, e.title, e.business_id, b.owner_id
      FROM events e
      JOIN businesses b ON b.id = e.business_id
     WHERE COALESCE(e.publish_state, 'published') = 'published'
       AND COALESCE(e.status, 'active') = 'active'
       AND COALESCE(e.is_recurring, false) = false
       AND e.end_datetime < now() - interval '2 hours'
       AND e.end_datetime >= now() - interval '26 hours'
       AND COALESCE(b.notifications_enabled, true)
       AND COALESCE(b.host_post_event_notice, false)
       AND NOT EXISTS (
         SELECT 1 FROM host_notifications_sent s
          WHERE s.event_id = e.id AND s.kind = 'post_event' AND s.occurrence_start IS NULL
       )
  LOOP
    SELECT count(*) INTO v_going FROM rsvps r WHERE r.event_id = v_row.id AND r.status = 'going';
    SELECT count(*) INTO v_waitlist FROM event_waitlist w WHERE w.event_id = v_row.id;
    SELECT count(*) INTO v_views FROM event_views v WHERE v.event_id = v_row.id;
    INSERT INTO notifications (user_id, type, title, body, event_id, business_id)
    VALUES (
      v_row.owner_id,
      'host_post_event_summary',
      'How ' || COALESCE(v_row.title, 'your event') || ' went',
      v_going || ' going · ' || v_waitlist || ' on the waitlist · ' || v_views
        || ' views. Duplicate it or turn it into a series to run it again.',
      v_row.id,
      v_row.business_id
    );
    INSERT INTO host_notifications_sent (event_id, kind) VALUES (v_row.id, 'post_event')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- 2b. EJ-17 — post-event for a SERIES: every occurrence that ended 2–26
  -- hours ago. Natural dates that were not cancelled or moved, plus dates
  -- moved INTO the window by a reschedule.
  FOR v_row IN
    SELECT e.id, e.title, e.business_id, b.owner_id, occ.occ_start, occ.occ_date
      FROM events e
      JOIN businesses b ON b.id = e.business_id
      CROSS JOIN LATERAL (
        SELECT COALESCE(NULLIF(e.timezone, ''), 'UTC') AS tz,
               (e.start_datetime AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'UTC'))::time AS start_time,
               e.end_datetime - e.start_datetime AS dur
      ) z
      CROSS JOIN LATERAL (
        -- Dates the pattern produces, untouched by an exception.
        SELECT ((g.d::date + z.start_time) AT TIME ZONE z.tz) AS occ_start,
               ((g.d::date + z.start_time) AT TIME ZONE z.tz) + z.dur AS occ_end,
               g.d::date AS occ_date
          FROM generate_series((now() AT TIME ZONE z.tz)::date - 3,
                               (now() AT TIME ZONE z.tz)::date, interval '1 day') g(d)
         WHERE event_recurrence_matches(e.start_datetime AT TIME ZONE z.tz, e.recurrence_pattern, g.d::date)
           AND NOT EXISTS (
             SELECT 1 FROM event_occurrence_exceptions x
              WHERE x.event_id = e.id AND x.occurrence_date = g.d::date)
        UNION ALL
        -- Dates moved by the host: their new slot decides.
        SELECT x.new_start, x.new_end, x.occurrence_date
          FROM event_occurrence_exceptions x
         WHERE x.event_id = e.id AND x.kind = 'rescheduled'
           AND x.new_start IS NOT NULL AND x.new_end IS NOT NULL
      ) occ
     WHERE COALESCE(e.publish_state, 'published') = 'published'
       AND COALESCE(e.status, 'active') = 'active'
       AND COALESCE(e.is_recurring, false)
       AND e.recurrence_pattern IS NOT NULL
       AND occ.occ_end < now() - interval '2 hours'
       AND occ.occ_end >= now() - interval '26 hours'
       AND COALESCE(b.notifications_enabled, true)
       AND COALESCE(b.host_post_event_notice, false)
       AND NOT EXISTS (
         SELECT 1 FROM host_notifications_sent s
          WHERE s.event_id = e.id AND s.kind = 'post_event' AND s.occurrence_start = occ.occ_start
       )
  LOOP
    v_going := occurrence_going_count(v_row.id, v_row.occ_date);
    SELECT count(*) INTO v_waitlist FROM event_waitlist w WHERE w.event_id = v_row.id;
    SELECT count(*) INTO v_views FROM event_views v WHERE v.event_id = v_row.id;
    INSERT INTO notifications (user_id, type, title, body, event_id, business_id)
    VALUES (
      v_row.owner_id,
      'host_post_event_summary',
      'How ' || COALESCE(v_row.title, 'your event') || ' went',
      v_going || ' going · ' || v_waitlist || ' on the waitlist · ' || v_views
        || ' views. The next session carries on as scheduled.',
      v_row.id,
      v_row.business_id
    );
    INSERT INTO host_notifications_sent (event_id, kind, occurrence_start)
    VALUES (v_row.id, 'post_event', v_row.occ_start)
    ON CONFLICT DO NOTHING;
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN NULL;   -- never break the cron worker
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.send_host_event_notices() FROM PUBLIC, anon, authenticated;
