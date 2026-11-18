-- Event journey review, migration 3 of 7 (docs/EVENT_JOURNEY_REVIEW_2026-11-17.md).
--
-- STATUS: PREPARED, NOT APPLIED. Staged in supabase/prepared/; validated only
-- in a throwaway isolated container. See this folder's README.
--
-- Who is told what, made one rule:
--   EJ-19 date-only goers (going to one date of a series) were in no notice's
--         audience — reproduced: the host cancelled the one date a person
--         signed up for and they were not told.
--   EJ-21 audiences disagreed: savers missed reschedules; the waitlist-cancel
--         notice ignored the event_update opt-out.
--   EJ-20 a schedule change (pattern / end date) was silent while it pruned
--         per-date RSVPs; now a "Schedule changed" notice.
--   EJ-15 an end-only change said "rescheduled … now starts <same time>";
--         now "Event time changed … now ends at …".
--   EJ-23 events.rescheduled_at, set when reschedule_event moves the time, so
--         the event page can say "time changed — update your calendar".
--   EJ-22 (part) send_event_announcement flags its chat mirror so migration 4
--         can skip the duplicate chat notice.
--   split_series_from ("this and following") shortens the original series;
--         the dates continue in the new one, so it skips the new "Schedule
--         changed" notice (found by scripts/test-categories-series.sql).
-- Function bodies are the live definitions with only the marked changes.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS rescheduled_at timestamptz;
COMMENT ON COLUMN public.events.rescheduled_at IS
  'Last time reschedule_event changed the start/end (EJ-23). NULL = never.';

CREATE OR REPLACE FUNCTION public.event_notice_audience(p_event_id uuid, p_date date DEFAULT NULL)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Everyone with a stake in an event, for lifecycle notices (cancel,
  -- postpone, reschedule, per-date changes, edits). One rule instead of six
  -- hand-written ones that disagreed (EJ-19, EJ-21):
  --   going / interested / requested RSVPs, the waitlist, savers, and
  --   date-only goers (rsvp_occurrences going or waitlisted) — of p_date when
  --   the notice is about one date, otherwise of any date still ahead;
  --   never the owner; honours the event_update opt-out.
  WITH ev AS (
    SELECT b.owner_id, COALESCE(NULLIF(e.timezone, ''), 'UTC') AS tz
      FROM events e JOIN businesses b ON b.id = e.business_id
     WHERE e.id = p_event_id
  ), s AS (
    SELECT r.user_id FROM rsvps r
     WHERE r.event_id = p_event_id AND r.status IN ('going', 'interested', 'requested')
    UNION SELECT w.user_id FROM event_waitlist w WHERE w.event_id = p_event_id
    UNION SELECT sv.user_id FROM saves sv WHERE sv.event_id = p_event_id
    UNION SELECT ro.user_id FROM rsvp_occurrences ro, ev
     WHERE ro.event_id = p_event_id AND ro.status IN ('going', 'waitlist')
       AND CASE WHEN p_date IS NOT NULL THEN ro.occurrence_date = p_date
                ELSE ro.occurrence_date >= (now() AT TIME ZONE ev.tz)::date END
  )
  SELECT s.user_id
    FROM s
    JOIN profiles p ON p.id = s.user_id
    CROSS JOIN ev
   WHERE s.user_id IS DISTINCT FROM ev.owner_id
     AND COALESCE((p.notification_preferences->>'event_update')::boolean, true);
$function$;
-- Internal: called only from SECURITY DEFINER functions and triggers.
REVOKE EXECUTE ON FUNCTION public.event_notice_audience(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancel_event(p_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  SELECT owner_id INTO v_owner FROM businesses WHERE id = v_event.business_id;

  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event owner can cancel this event';
  END IF;

  IF v_event.status = 'cancelled' THEN
    RETURN; -- already cancelled, nothing to do
  END IF;

  PERFORM set_config('eventmap.allow_status_change', 'true', true);      -- added
  UPDATE events SET status = 'cancelled' WHERE id = p_event_id;
  PERFORM set_config('eventmap.allow_status_change', '', true);          -- added

  -- Pending reminders for this event are moot now.                      -- added
  DELETE FROM event_reminder_sent WHERE event_id = p_event_id;

  -- Notify everyone with a stake in the event: going/interested RSVPs and
  -- people who saved it (not the owner), honoring the event_update pref.
  INSERT INTO notifications (user_id, type, title, body, event_id)
  SELECT DISTINCT
    s.user_id,
    'event_update',
    'Event cancelled',
    '"' || COALESCE(v_event.title, 'Event') || '" has been cancelled by the organizer.',
    v_event.id
  -- EJ-19/21: the shared audience (adds date-only goers; the waitlist was
  -- told and cleared by trigger_clear_event_waitlist_on_cancel above).
  FROM event_notice_audience(v_event.id) s;
END;
$function$;

CREATE OR REPLACE FUNCTION public.postpone_event(p_event_id uuid, p_note text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_recipients integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 300 THEN RAISE EXCEPTION 'invalid_note: too long'; END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = v_event.business_id;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can postpone';
  END IF;
  IF v_event.status = 'cancelled' THEN RAISE EXCEPTION 'event_cancelled'; END IF;
  IF v_event.status = 'postponed' THEN
    RETURN json_build_object('status', 'postponed', 'notified', 0);
  END IF;

  PERFORM set_config('eventmap.allow_status_change', 'true', true);
  UPDATE events SET status = 'postponed', status_note = v_note WHERE id = p_event_id;
  PERFORM set_config('eventmap.allow_status_change', '', true);

  DELETE FROM event_reminder_sent WHERE event_id = p_event_id;

  IF v_event.publish_state = 'published' THEN
    WITH ins AS (
      INSERT INTO notifications (user_id, type, title, body, event_id, data)
      SELECT DISTINCT s.user_id, 'event_update', 'Event postponed',
             '"' || COALESCE(v_event.title, 'Event') || '" has been postponed; a new date is coming. Your RSVP is kept.'
               || CASE WHEN v_note IS NULL THEN '' ELSE ' ' || v_note END,
             p_event_id,
             jsonb_build_object('eventId', p_event_id, 'kind', 'postponed')
      FROM event_notice_audience(p_event_id) s   -- EJ-19: + date-only goers
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_recipients FROM ins;
  END IF;

  RETURN json_build_object('status', 'postponed', 'notified', v_recipients);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_event(p_event_id uuid, p_start_datetime timestamp with time zone, p_end_datetime timestamp with time zone, p_note text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_when text;
  v_until text;
  v_start_changed boolean;
  v_tz text;
  v_time_changed boolean;
  v_place_changed boolean;
  v_recipients integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_start_datetime IS NULL OR p_end_datetime IS NULL OR p_end_datetime <= p_start_datetime THEN
    RAISE EXCEPTION 'invalid_dates: end must be after start';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 300 THEN RAISE EXCEPTION 'invalid_note: too long'; END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = v_event.business_id;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can reschedule';
  END IF;
  IF v_event.status = 'cancelled' THEN RAISE EXCEPTION 'event_cancelled: cancelled events cannot be rescheduled'; END IF;

  v_time_changed := v_event.start_datetime IS DISTINCT FROM p_start_datetime
                 OR v_event.end_datetime IS DISTINCT FROM p_end_datetime;
  -- EJ-15: an end-only change ("running late") is not a new start.
  v_start_changed := v_event.start_datetime IS DISTINCT FROM p_start_datetime;
  v_place_changed := p_address IS NOT NULL AND (p_address IS DISTINCT FROM v_event.address
                 OR p_lat IS DISTINCT FROM v_event.lat OR p_lng IS DISTINCT FROM v_event.lng);

  PERFORM set_config('eventmap.allow_reschedule', 'true', true);
  PERFORM set_config('eventmap.skip_update_notice', 'true', true);
  PERFORM set_config('eventmap.allow_status_change', 'true', true);
  UPDATE events
  SET start_datetime = p_start_datetime,
      end_datetime = p_end_datetime,
      address = COALESCE(p_address, address),
      lat = COALESCE(p_lat, lat),
      lng = COALESCE(p_lng, lng),
      status = CASE WHEN status = 'postponed' THEN 'active' ELSE status END,
      status_note = CASE WHEN status = 'postponed' THEN NULL ELSE status_note END,
      -- EJ-23: lets the event page tell attendees their calendar entry is stale.
      rescheduled_at = CASE WHEN v_time_changed THEN now() ELSE rescheduled_at END
  WHERE id = p_event_id
  RETURNING * INTO v_event;
  PERFORM set_config('eventmap.allow_reschedule', '', true);
  PERFORM set_config('eventmap.skip_update_notice', '', true);
  PERFORM set_config('eventmap.allow_status_change', '', true);

  IF v_time_changed THEN
    DELETE FROM event_reminder_sent WHERE event_id = p_event_id;
    -- Waitlisted people may be told again about free seats for the new date.
    UPDATE event_waitlist SET notified_at = NULL WHERE event_id = p_event_id;
  END IF;

  IF v_event.publish_state = 'published' AND (v_time_changed OR v_place_changed) THEN
    v_tz := COALESCE(NULLIF(v_event.timezone, ''), 'UTC');
    v_when := to_char(v_event.start_datetime AT TIME ZONE v_tz, 'Dy, Mon DD, HH12:MI AM')
              || CASE WHEN v_event.timezone IS NULL THEN ' UTC' ELSE '' END;
    v_until := to_char(v_event.end_datetime AT TIME ZONE v_tz, 'HH12:MI AM')
              || CASE WHEN v_event.timezone IS NULL THEN ' UTC' ELSE '' END;
    WITH ins AS (
      INSERT INTO notifications (user_id, type, title, body, event_id, data)
      SELECT DISTINCT s.user_id, 'event_update',
             CASE WHEN v_start_changed THEN 'Event rescheduled'
                  WHEN v_time_changed THEN 'Event time changed'
                  ELSE 'Event location changed' END,
             '"' || COALESCE(v_event.title, 'Event') || '"'
               || CASE WHEN v_start_changed THEN ' now starts ' || v_when
                       WHEN v_time_changed THEN ' now ends at ' || v_until
                       ELSE ' has a new location: ' || v_event.address END
               || '.' || CASE WHEN v_note IS NULL THEN '' ELSE ' ' || v_note END,
             p_event_id,
             jsonb_build_object('eventId', p_event_id, 'kind', CASE WHEN v_time_changed THEN 'rescheduled' ELSE 'relocated' END)
      FROM event_notice_audience(p_event_id) s   -- EJ-19/21: + savers, + date-only goers
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_recipients FROM ins;
  END IF;

  RETURN json_build_object('status', v_event.status, 'notified', v_recipients);
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_occurrence_change(p_event events, p_title text, p_body text, p_data jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_n integer := 0;
BEGIN
  IF p_event.publish_state IS DISTINCT FROM 'published' THEN RETURN 0; END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = p_event.business_id;
  WITH ins AS (
    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    SELECT DISTINCT s.user_id, 'event_update', p_title, p_body, p_event.id, p_data
    -- EJ-19: + the date-only goers of exactly this date (callers put it in
    -- p_data->'date'); they were the ones not told their date was cancelled.
    FROM event_notice_audience(p_event.id, NULLIF(p_data->>'date', '')::date) s
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_event_waitlist_on_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    INSERT INTO notifications (user_id, type, title, body, event_id)
    SELECT w.user_id, 'event_update', 'Event cancelled',
           '"' || COALESCE(NEW.title, 'Event') || '" has been cancelled by the organizer.', NEW.id
    FROM event_waitlist w
    JOIN profiles p ON p.id = w.user_id
    WHERE w.event_id = NEW.id
      -- EJ-21: honour the event_update opt-out, like cancel_event does.
      AND COALESCE((p.notification_preferences->>'event_update')::boolean, true)
      -- Don't double up with cancel_event's notice (RSVPs, saves, date-only goers).
      AND NOT EXISTS (SELECT 1 FROM rsvps r WHERE r.event_id = NEW.id AND r.user_id = w.user_id)
      AND NOT EXISTS (SELECT 1 FROM saves s WHERE s.event_id = NEW.id AND s.user_id = w.user_id)
      AND NOT EXISTS (SELECT 1 FROM rsvp_occurrences ro WHERE ro.event_id = NEW.id AND ro.user_id = w.user_id
                        AND ro.status IN ('going', 'waitlist'));
    DELETE FROM event_waitlist WHERE event_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_rsvp_users_on_event_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_schedule_changed boolean;
BEGIN
  IF COALESCE(current_setting('eventmap.skip_update_notice', true), '') = 'true' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM 'active' OR NEW.publish_state <> 'published' THEN
    RETURN NEW;
  END IF;

  v_schedule_changed := OLD.recurrence_pattern IS DISTINCT FROM NEW.recurrence_pattern
                     OR OLD.is_recurring IS DISTINCT FROM NEW.is_recurring;
  IF OLD.start_datetime IS NOT DISTINCT FROM NEW.start_datetime
     AND OLD.end_datetime IS NOT DISTINCT FROM NEW.end_datetime
     AND OLD.address IS NOT DISTINCT FROM NEW.address
     AND OLD.lat IS NOT DISTINCT FROM NEW.lat
     AND OLD.lng IS NOT DISTINCT FROM NEW.lng
     AND NOT v_schedule_changed THEN
    RETURN NEW;
  END IF;

  IF OLD.start_datetime IS DISTINCT FROM NEW.start_datetime THEN
    DELETE FROM event_reminder_sent WHERE event_id = NEW.id;
  END IF;

  -- EJ-20: a schedule change (pattern / end date / one-off <-> series) used
  -- to be silent while it dropped dates and pruned per-date RSVPs. This
  -- trigger fires before z_prune_orphaned_occurrence_rows (AFTER triggers run
  -- in name order), so the date-only goers about to lose a date are still in
  -- the audience. EJ-19/21: the shared audience for the plain update too.
  INSERT INTO notifications (user_id, type, title, body, event_id, data)
  SELECT
    s.user_id,
    'event_update',
    CASE WHEN v_schedule_changed THEN 'Schedule changed' ELSE 'Event updated' END,
    '"' || COALESCE(NEW.title, 'Event') || '" '
      || CASE WHEN v_schedule_changed THEN 'has a new schedule. Check which dates still work for you.'
              ELSE 'has been updated. Check the new details.' END,
    NEW.id,
    jsonb_build_object('eventId', NEW.id, 'kind', CASE WHEN v_schedule_changed THEN 'schedule_changed' ELSE 'updated' END)
  FROM event_notice_audience(NEW.id) s;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_notify_rsvp_users_on_event_update ON public.events;
CREATE TRIGGER trigger_notify_rsvp_users_on_event_update
  AFTER UPDATE ON public.events
  FOR EACH ROW
  WHEN (((old.start_datetime IS DISTINCT FROM new.start_datetime)
      OR (old.end_datetime IS DISTINCT FROM new.end_datetime)
      OR (old.address IS DISTINCT FROM new.address)
      OR (old.lat IS DISTINCT FROM new.lat)
      OR (old.lng IS DISTINCT FROM new.lng)
      -- EJ-20
      OR (old.recurrence_pattern IS DISTINCT FROM new.recurrence_pattern)
      OR (old.is_recurring IS DISTINCT FROM new.is_recurring)))
  EXECUTE FUNCTION notify_rsvp_users_on_event_update();

CREATE OR REPLACE FUNCTION public.send_event_announcement(p_event_id uuid, p_body text, p_audience text DEFAULT 'going'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
  v_body text := btrim(COALESCE(p_body, ''));
  v_today integer;
  v_recipients integer := 0;
  v_announcement_id uuid;
  v_mirror_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_audience NOT IN ('going', 'all') THEN RAISE EXCEPTION 'invalid_audience'; END IF;
  IF char_length(v_body) = 0 THEN RAISE EXCEPTION 'invalid_body: empty'; END IF;
  IF char_length(v_body) > 500 THEN RAISE EXCEPTION 'invalid_body: too long'; END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = v_event.business_id;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can announce';
  END IF;
  IF v_event.status = 'cancelled' THEN RAISE EXCEPTION 'event_cancelled'; END IF;

  SELECT COUNT(*) INTO v_today
  FROM host_announcements a
  WHERE a.event_id = p_event_id AND a.created_at > now() - interval '1 day';
  IF v_today >= 3 THEN RAISE EXCEPTION 'announcement_limit: at most 3 per event per day'; END IF;

  INSERT INTO host_announcements (event_id, created_by, body, audience)
  VALUES (p_event_id, auth.uid(), v_body, p_audience)
  RETURNING id INTO v_announcement_id;

  WITH people AS (
    SELECT r.user_id FROM rsvps r
     WHERE r.event_id = p_event_id AND (p_audience = 'all' OR r.status = 'going')
    -- EJ-19: date-only goers with a date still ahead count as "going".
    UNION
    SELECT ro.user_id FROM rsvp_occurrences ro
     WHERE ro.event_id = p_event_id
       AND (ro.status = 'going' OR (p_audience = 'all' AND ro.status = 'waitlist'))
       AND ro.occurrence_date >= (now() AT TIME ZONE COALESCE(NULLIF(v_event.timezone, ''), 'UTC'))::date
  ), targets AS (
    SELECT DISTINCT pe.user_id
    FROM people pe
    JOIN profiles p ON p.id = pe.user_id
    WHERE pe.user_id <> auth.uid()
      AND COALESCE((p.notification_preferences->>'host_announcement')::boolean, true)
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks ub WHERE ub.blocker_id = pe.user_id AND ub.blocked_id = auth.uid()
      )
  ), inserted AS (
    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    SELECT t.user_id, 'host_announcement',
           'Update from the host: ' || COALESCE(v_event.title, 'your event'),
           v_body, p_event_id,
           jsonb_build_object('eventId', p_event_id, 'kind', 'host_announcement', 'announcementId', v_announcement_id)
    FROM targets t
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_recipients FROM inserted;

  UPDATE host_announcements SET recipients = v_recipients WHERE id = v_announcement_id;

  -- Mirror into the chat and pin it, so late joiners see the latest
  -- announcement without scrolling. SECURITY DEFINER bypasses the posting
  -- policy, so the mode check is explicit: a switched-off chat gets no
  -- mirror (attendees could never read it). Trigger failures (rate limits)
  -- stay best-effort.
  BEGIN
    IF COALESCE((SELECT cs.chat_mode FROM event_chat_settings cs WHERE cs.event_id = p_event_id), 'open') <> 'off' THEN
    -- EJ-22: everyone just got the announcement itself; the chat-message
    -- trigger skips its own notice for this mirror (migration 4 reads it).
    PERFORM set_config('eventmap.skip_chat_notice', 'true', true);
    INSERT INTO event_chat_messages (event_id, sender_id, body, mentions)
    VALUES (p_event_id, auth.uid(), '📣 ' || v_body, '{}')
    RETURNING id INTO v_mirror_id;
    PERFORM set_config('eventmap.skip_chat_notice', '', true);

    INSERT INTO event_chat_settings (event_id, pinned_message_id, updated_by, updated_at)
    VALUES (p_event_id, v_mirror_id, auth.uid(), now())
    ON CONFLICT (event_id) DO UPDATE SET
      pinned_message_id = v_mirror_id,
      updated_by = auth.uid(),
      updated_at = now();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN json_build_object('id', v_announcement_id, 'recipients', v_recipients, 'sent_today', v_today + 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.split_series_from(p_event_id uuid, p_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
  v_tz text;
  v_end text;
  v_new_id uuid := gen_random_uuid();
  v_start_local timestamp;
  v_new_start timestamptz;
  v_duration interval;
  v_new_pattern jsonb;
  v_old_pattern jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = v_event.business_id;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can split a series';
  END IF;
  IF v_event.status <> 'active' THEN RAISE EXCEPTION 'event_not_active'; END IF;
  IF NOT COALESCE(v_event.is_recurring, false) OR v_event.recurrence_pattern IS NULL THEN
    RAISE EXCEPTION 'not_recurring: only repeating events can be split';
  END IF;

  v_tz := COALESCE(NULLIF(v_event.timezone, ''), 'UTC');
  v_start_local := v_event.start_datetime AT TIME ZONE v_tz;
  v_end := v_event.recurrence_pattern->>'endDate';
  IF p_date <= v_start_local::date THEN
    RAISE EXCEPTION 'invalid_occurrence: pick a date after the first one (edit the whole series instead)';
  END IF;
  IF p_date < (now() AT TIME ZONE v_tz)::date
     OR NOT event_recurrence_matches(v_start_local, v_event.recurrence_pattern, p_date)
     OR (v_end ~ '^\d{4}-\d{2}-\d{2}' AND p_date > left(v_end, 10)::date) THEN
    RAISE EXCEPTION 'invalid_occurrence: the series does not run on that date';
  END IF;

  v_new_start := (p_date + v_start_local::time) AT TIME ZONE v_tz;
  v_duration := v_event.end_datetime - v_event.start_datetime;
  v_new_pattern := v_event.recurrence_pattern;  -- keeps the original endDate (or none)
  v_old_pattern := jsonb_set(v_event.recurrence_pattern, '{endDate}', to_jsonb(to_char(p_date - 1, 'YYYY-MM-DD')));

  -- New series: copy every column, then override identity/timing/state.
  INSERT INTO events
  SELECT * FROM jsonb_populate_record(NULL::events,
    to_jsonb(v_event) || jsonb_build_object(
      'id', v_new_id,
      'start_datetime', v_new_start,
      'end_datetime', v_new_start + v_duration,
      'recurrence_pattern', v_new_pattern,
      'publish_state', 'draft',
      'created_at', now(),
      'updated_at', now()));

  IF v_event.publish_state = 'published' THEN
    PERFORM set_config('eventmap.allow_publish_change', 'true', true);
    UPDATE events SET publish_state = 'published' WHERE id = v_new_id;
    PERFORM set_config('eventmap.allow_publish_change', '', true);
  END IF;

  INSERT INTO rsvps (event_id, user_id, status)
  SELECT v_new_id, r.user_id, r.status FROM rsvps r
   WHERE r.event_id = p_event_id AND r.status IN ('going', 'interested')
  ON CONFLICT DO NOTHING;
  -- Copying RSVPs fires notify_business_on_rsvp ("X is going") to the
  -- host for every attendee; those are not news. now() is the transaction
  -- start, so this removes exactly the ones created here.
  DELETE FROM notifications
   WHERE event_id = v_new_id AND user_id = v_owner AND created_at >= now();
  INSERT INTO saves (event_id, user_id)
  SELECT v_new_id, s.user_id FROM saves s WHERE s.event_id = p_event_id
  ON CONFLICT DO NOTHING;
  -- 20261112100000: pinned collection items follow the event like saves do,
  -- so a list that held the series still holds both halves.
  INSERT INTO collection_items (collection_id, event_id, added_at, note)
  SELECT ci.collection_id, v_new_id, ci.added_at, ci.note
    FROM collection_items ci WHERE ci.event_id = p_event_id
  ON CONFLICT DO NOTHING;
  -- Links and photos are copied so the new series' page is complete
  -- (photos share the same stored image URLs).
  INSERT INTO event_links (event_id, label, url, sort_order)
  SELECT v_new_id, l.label, l.url, l.sort_order FROM event_links l WHERE l.event_id = p_event_id;
  INSERT INTO event_photos (event_id, image_url, sort_order)
  SELECT v_new_id, ph.image_url, ph.sort_order FROM event_photos ph WHERE ph.event_id = p_event_id;
  UPDATE event_occurrence_exceptions SET event_id = v_new_id
   WHERE event_id = p_event_id AND occurrence_date >= p_date;
  UPDATE rsvp_occurrences SET event_id = v_new_id
   WHERE event_id = p_event_id AND occurrence_date >= p_date;

  -- End the original the day before the split. Done AFTER moving the
  -- per-date rows above: the z_prune_orphaned_occurrence_rows trigger
  -- (20261109140000) removes rows past a series' end date, so shortening
  -- first would delete exactly the rows that belong to the new series.
  PERFORM set_config('eventmap.allow_reschedule', 'true', true);
  -- The dates continue in the new series, so attendees see no change: no
  -- "Schedule changed" notice (added for pattern edits in this migration).
  PERFORM set_config('eventmap.skip_update_notice', 'true', true);
  UPDATE events SET recurrence_pattern = v_old_pattern WHERE id = p_event_id;
  PERFORM set_config('eventmap.skip_update_notice', '', true);
  PERFORM set_config('eventmap.allow_reschedule', '', true);

  RETURN v_new_id;
END;
$function$;
