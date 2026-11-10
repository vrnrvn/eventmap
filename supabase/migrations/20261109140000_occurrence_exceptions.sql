-- Per-date exceptions for recurring series (docs/CATEGORIES_AND_SERIES_PLAN.md
-- §4.3 / §4.6, Phase E).
--
-- NOT applied to the shared local database by the author; validated on an
-- isolated scratch copy only. Apply AFTER 20261109130000_recurrence_patterns_v2
-- (uses event_recurrence_matches and the 5-arg event_next_occurrence).
-- Then `npm run backend:types`.
--
--  1. event_occurrence_exceptions: one row per (event, calendar date in the
--     event's zone): 'cancelled', or 'rescheduled' with a new start/end.
--     Readable wherever the event is readable; written only via RPCs.
--  2. skip_occurrence / reschedule_occurrence / restore_occurrence: host (or
--     admin) only, series must be active, the date must be a real future
--     occurrence. Optionally notify going + interested + requested + savers
--     + waitlist (same audience and opt-out as postpone_event).
--  3. event_next_effective_occurrence(event_id, now): next date honouring
--     exceptions. Used by reminders now; the listing RPCs can adopt it later.
--  4. Reminders per occurrence: event_reminder_sent gains occurrence_start in
--     its key, and the "going" loop of send_event_reminders reminds for each
--     date of a series (previously only the first). The "interested" loop is
--     unchanged (one-off events only, as before).

CREATE TABLE IF NOT EXISTS public.event_occurrence_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cancelled', 'rescheduled')),
  new_start timestamptz,
  new_end timestamptz,
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, occurrence_date),
  CONSTRAINT occurrence_reschedule_times CHECK (
    (kind = 'cancelled' AND new_start IS NULL AND new_end IS NULL)
    OR (kind = 'rescheduled' AND new_start IS NOT NULL AND new_end IS NOT NULL AND new_end > new_start)
  )
);

COMMENT ON TABLE public.event_occurrence_exceptions IS
  'Per-date changes to a recurring series. occurrence_date is the ORIGINAL calendar date in the event zone.';

ALTER TABLE public.event_occurrence_exceptions ENABLE ROW LEVEL SECURITY;

-- Visible exactly when the parent event is (the subquery runs under the
-- caller's events RLS: public upcoming events, own events, admins).
DROP POLICY IF EXISTS "Exceptions follow event visibility" ON public.event_occurrence_exceptions;
CREATE POLICY "Exceptions follow event visibility"
  ON public.event_occurrence_exceptions FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id));

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_next_effective_occurrence(p_event_id uuid, p_now timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_tz text;
  v_cursor timestamptz := p_now;
  v_candidate timestamptz;
  v_ex event_occurrence_exceptions%ROWTYPE;
  v_moved timestamptz;
  v_i integer;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT COALESCE(v_event.is_recurring, false) THEN
    RETURN v_event.start_datetime;
  END IF;
  v_tz := COALESCE(NULLIF(v_event.timezone, ''), 'UTC');

  -- A date moved EARLIER than the next regular occurrence would be missed by
  -- the walk below, so consider upcoming moved times up front.
  SELECT min(x.new_start) INTO v_moved
    FROM event_occurrence_exceptions x
   WHERE x.event_id = p_event_id AND x.kind = 'rescheduled' AND x.new_start >= p_now;

  FOR v_i IN 1..400 LOOP
    v_candidate := event_next_occurrence(v_event.start_datetime, true, v_event.recurrence_pattern, v_event.timezone, v_cursor);
    IF v_candidate IS NULL OR v_candidate < v_cursor THEN
      EXIT;  -- series exhausted / no further date
    END IF;
    IF (v_event.recurrence_pattern->>'endDate') ~ '^\d{4}-\d{2}-\d{2}'
       AND (v_candidate AT TIME ZONE v_tz)::date > left(v_event.recurrence_pattern->>'endDate', 10)::date THEN
      EXIT;
    END IF;
    SELECT * INTO v_ex FROM event_occurrence_exceptions
     WHERE event_id = p_event_id AND occurrence_date = (v_candidate AT TIME ZONE v_tz)::date;
    IF NOT FOUND THEN
      RETURN LEAST(v_candidate, COALESCE(v_moved, v_candidate));
    END IF;
    -- cancelled or moved: keep walking (a moved date is covered by v_moved).
    v_cursor := v_candidate + interval '1 minute';
  END LOOP;
  RETURN v_moved;
END;
$function$;

-- Shared checks for the three RPCs. Returns the locked event row.
CREATE OR REPLACE FUNCTION public.occurrence_guard(p_event_id uuid, p_date date)
RETURNS events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
  v_tz text;
  v_end text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = v_event.business_id;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can change dates';
  END IF;
  IF v_event.status <> 'active' THEN RAISE EXCEPTION 'event_not_active'; END IF;
  IF NOT COALESCE(v_event.is_recurring, false) OR v_event.recurrence_pattern IS NULL THEN
    RAISE EXCEPTION 'not_recurring: only repeating events have individual dates';
  END IF;
  v_tz := COALESCE(NULLIF(v_event.timezone, ''), 'UTC');
  IF p_date < (now() AT TIME ZONE v_tz)::date THEN
    RAISE EXCEPTION 'invalid_occurrence: that date has already passed';
  END IF;
  v_end := v_event.recurrence_pattern->>'endDate';
  IF NOT event_recurrence_matches(v_event.start_datetime AT TIME ZONE v_tz, v_event.recurrence_pattern, p_date)
     OR (v_end ~ '^\d{4}-\d{2}-\d{2}' AND p_date > left(v_end, 10)::date) THEN
    RAISE EXCEPTION 'invalid_occurrence: the series does not run on that date';
  END IF;
  RETURN v_event;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.occurrence_guard(uuid, date) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.notify_occurrence_change(p_event events, p_title text, p_body text, p_data jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    FROM (
      SELECT r.user_id FROM rsvps r WHERE r.event_id = p_event.id AND r.status IN ('going', 'interested', 'requested')
      UNION SELECT sv.user_id FROM saves sv WHERE sv.event_id = p_event.id
      UNION SELECT w.user_id FROM event_waitlist w WHERE w.event_id = p_event.id
    ) s
    JOIN profiles p ON p.id = s.user_id
    WHERE s.user_id IS DISTINCT FROM v_owner
      AND COALESCE((p.notification_preferences->>'event_update')::boolean, true)
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  RETURN v_n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.notify_occurrence_change(events, text, text, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.skip_occurrence(
  p_event_id uuid, p_date date, p_note text DEFAULT NULL, p_notify boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_next timestamptz;
  v_n integer := 0;
BEGIN
  v_event := occurrence_guard(p_event_id, p_date);
  INSERT INTO event_occurrence_exceptions (event_id, occurrence_date, kind, note, created_by)
  VALUES (p_event_id, p_date, 'cancelled', v_note, auth.uid())
  ON CONFLICT (event_id, occurrence_date) DO UPDATE
    SET kind = 'cancelled', new_start = NULL, new_end = NULL, note = EXCLUDED.note, updated_at = now();
  v_next := event_next_effective_occurrence(p_event_id, now());
  IF p_notify THEN
    v_n := notify_occurrence_change(v_event, 'Date cancelled',
      '"' || COALESCE(v_event.title, 'Event') || '" on ' || to_char(p_date, 'FMDay FMDD Mon') || ' is cancelled.'
        || CASE WHEN v_next IS NULL THEN '' ELSE ' The series continues on '
             || to_char(v_next AT TIME ZONE COALESCE(NULLIF(v_event.timezone, ''), 'UTC'), 'FMDay FMDD Mon') || '.' END
        || CASE WHEN v_note IS NULL THEN '' ELSE ' ' || v_note END,
      jsonb_build_object('eventId', p_event_id, 'kind', 'occurrence_cancelled', 'date', p_date));
  END IF;
  RETURN json_build_object('status', 'cancelled', 'date', p_date, 'next', v_next, 'notified', v_n);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_occurrence(
  p_event_id uuid, p_date date, p_new_start timestamptz, p_new_end timestamptz,
  p_note text DEFAULT NULL, p_notify boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_tz text;
  v_n integer := 0;
BEGIN
  v_event := occurrence_guard(p_event_id, p_date);
  IF p_new_start IS NULL OR p_new_end IS NULL OR p_new_end <= p_new_start THEN
    RAISE EXCEPTION 'invalid_occurrence: the new end must be after the new start';
  END IF;
  IF p_new_start <= now() THEN
    RAISE EXCEPTION 'invalid_occurrence: the new time must be in the future';
  END IF;
  v_tz := COALESCE(NULLIF(v_event.timezone, ''), 'UTC');
  -- Only this date's reminder markers (G14): its original start and any
  -- earlier move of it. Other dates already reminded stay reminded.
  DELETE FROM event_reminder_sent
   WHERE event_id = p_event_id
     AND occurrence_start IN (
       (p_date + (v_event.start_datetime AT TIME ZONE v_tz)::time) AT TIME ZONE v_tz,
       COALESCE((SELECT x.new_start FROM event_occurrence_exceptions x
                  WHERE x.event_id = p_event_id AND x.occurrence_date = p_date AND x.kind = 'rescheduled'), 'epoch')
     );
  INSERT INTO event_occurrence_exceptions (event_id, occurrence_date, kind, new_start, new_end, note, created_by)
  VALUES (p_event_id, p_date, 'rescheduled', p_new_start, p_new_end, v_note, auth.uid())
  ON CONFLICT (event_id, occurrence_date) DO UPDATE
    SET kind = 'rescheduled', new_start = EXCLUDED.new_start, new_end = EXCLUDED.new_end,
        note = EXCLUDED.note, updated_at = now();

  IF p_notify THEN
    v_n := notify_occurrence_change(v_event, 'Date changed',
      '"' || COALESCE(v_event.title, 'Event') || '" on ' || to_char(p_date, 'FMDay FMDD Mon')
        || ' moves to ' || to_char(p_new_start AT TIME ZONE v_tz, 'FMDay FMDD Mon, HH24:MI') || '.'
        || CASE WHEN v_note IS NULL THEN '' ELSE ' ' || v_note END,
      jsonb_build_object('eventId', p_event_id, 'kind', 'occurrence_rescheduled', 'date', p_date,
                         'newStart', p_new_start));
  END IF;
  RETURN json_build_object('status', 'rescheduled', 'date', p_date, 'notified', v_n);
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_occurrence(
  p_event_id uuid, p_date date, p_notify boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_deleted integer;
  v_n integer := 0;
BEGIN
  v_event := occurrence_guard(p_event_id, p_date);
  DELETE FROM event_occurrence_exceptions WHERE event_id = p_event_id AND occurrence_date = p_date;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RETURN json_build_object('status', 'unchanged', 'date', p_date, 'notified', 0);
  END IF;
  -- (Restore: the original start was never reminded while moved/skipped,
  -- so nothing to clear; the moved time's marker no longer matches.)
  IF p_notify THEN
    v_n := notify_occurrence_change(v_event, 'Date back on',
      '"' || COALESCE(v_event.title, 'Event') || '" on ' || to_char(p_date, 'FMDay FMDD Mon')
        || ' is happening as originally planned.',
      jsonb_build_object('eventId', p_event_id, 'kind', 'occurrence_restored', 'date', p_date));
  END IF;
  RETURN json_build_object('status', 'restored', 'date', p_date, 'notified', v_n);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.skip_occurrence(uuid, date, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reschedule_occurrence(uuid, date, timestamptz, timestamptz, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restore_occurrence(uuid, date, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.skip_occurrence(uuid, date, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_occurrence(uuid, date, timestamptz, timestamptz, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_occurrence(uuid, date, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- Reminders per occurrence. Existing rows keep 'epoch' (they are one-off
-- reminders or first-date reminders already sent; neither will match a
-- future occurrence_start, which is the intent).
ALTER TABLE public.event_reminder_sent
  ADD COLUMN IF NOT EXISTS occurrence_start timestamptz NOT NULL DEFAULT 'epoch';
ALTER TABLE public.event_reminder_sent DROP CONSTRAINT IF EXISTS event_reminder_sent_pkey;
ALTER TABLE public.event_reminder_sent
  ADD CONSTRAINT event_reminder_sent_pkey PRIMARY KEY (event_id, user_id, kind, reminder_minutes, occurrence_start);

-- send_event_reminders: captured from the shared-DB snapshot (which includes
-- the 25-hour bound patched in by 20261106140000) with only the "going"
-- loop changed. Diff it against the live body before applying (G1).
CREATE OR REPLACE FUNCTION public.send_event_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
  v_maps_url text;
  v_body text;
BEGIN
  -- 1. Going: lead-time reminder --------------------------------------------
  FOR v_row IN
    SELECT
      e.id AS event_id, e.title, e.address, e.lat, e.lng,
      b.address AS business_address,
      r.user_id,
      p.event_reminder_minutes AS reminder_minutes,
      occ.at AS occurrence_start
    FROM events e
    -- Phase E (§4.6): the date being reminded about. One-offs: the start.
    -- Series: the next effective occurrence (skips cancelled dates, uses
    -- moved times), so every date reminds once instead of only the first.
    CROSS JOIN LATERAL (
      SELECT CASE WHEN COALESCE(e.is_recurring, false)
                  THEN event_next_effective_occurrence(e.id, now())
                  ELSE e.start_datetime END AS at
    ) occ
    JOIN businesses b ON b.id = e.business_id
    JOIN rsvps r ON r.event_id = e.id AND r.status = 'going'
    JOIN profiles p ON p.id = r.user_id
    WHERE e.status = 'active'                                   -- added
      AND (
        (NOT COALESCE(e.is_recurring, false)
          AND e.start_datetime > now()
          AND e.start_datetime <= now() + interval '25 hours')
        OR (COALESCE(e.is_recurring, false)
          AND NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone))
      )
      AND occ.at > now()
      AND occ.at <= now() + interval '25 hours'
      AND COALESCE(p.event_reminder_enabled, true) = true
      AND p.event_reminder_minutes IN (10, 30, 60, 120, 1440)
      AND extract(epoch from (occ.at - now())) / 60
          BETWEEN p.event_reminder_minutes - 5 AND p.event_reminder_minutes + 5
      AND NOT EXISTS (
        SELECT 1 FROM event_reminder_sent ers
        WHERE ers.event_id = e.id AND ers.user_id = r.user_id
          AND ers.kind = 'going' AND ers.reminder_minutes = p.event_reminder_minutes
          AND ers.occurrence_start = occ.at
      )
  LOOP
    v_maps_url := 'https://www.google.com/maps/search/?api=1&query='
      || COALESCE(v_row.lat::text, '') || ',' || COALESCE(v_row.lng::text, '');
    -- The event's own address first: an event can be held away from the
    -- business premises.                                        -- changed
    v_body := COALESCE(NULLIF(v_row.address, ''), v_row.business_address, '');
    IF v_row.lat IS NOT NULL AND v_row.lng IS NOT NULL THEN
      v_body := v_body || E'\n\nGet directions: ' || v_maps_url;
    END IF;

    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    VALUES (
      v_row.user_id, 'event_reminder', 'Event starting soon',
      COALESCE(v_row.title, 'Event') || ' starts in ' || v_row.reminder_minutes || ' minutes. ' || v_body,
      v_row.event_id,
      jsonb_build_object('eventId', v_row.event_id, 'kind', 'going',
        'businessAddress', COALESCE(NULLIF(v_row.address, ''), v_row.business_address), 'mapsUrl', v_maps_url)
    );
    INSERT INTO event_reminder_sent (event_id, user_id, kind, reminder_minutes, occurrence_start)
    VALUES (v_row.event_id, v_row.user_id, 'going', v_row.reminder_minutes, v_row.occurrence_start)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- 2. Interested: a single nudge, day-before or ~2h-before for late interest --
  FOR v_row IN
    SELECT
      e.id AS event_id, e.title, r.user_id,
      CASE
        WHEN extract(epoch from (e.start_datetime - now())) / 60 BETWEEN 1380 AND 1500 THEN 1440
        ELSE 120
      END AS slot
    FROM events e
    JOIN rsvps r ON r.event_id = e.id AND r.status = 'interested'
    JOIN profiles p ON p.id = r.user_id
    WHERE e.status = 'active'                                   -- added
      AND e.start_datetime > now()
      AND e.start_datetime <= now() + interval '25 hours'
      AND NOT COALESCE(e.is_recurring, false)
      AND COALESCE(p.event_reminder_enabled, true) = true
      AND COALESCE((p.notification_preferences->>'interested_reminder')::boolean, true) = true
      AND (
        extract(epoch from (e.start_datetime - now())) / 60 BETWEEN 1380 AND 1500
        OR (
          extract(epoch from (e.start_datetime - now())) / 60 BETWEEN 105 AND 135
          AND r.created_at > e.start_datetime - interval '25 hours'
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM event_reminder_sent ers
        WHERE ers.event_id = e.id AND ers.user_id = r.user_id AND ers.kind = 'interested'
      )
  LOOP
    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    VALUES (
      v_row.user_id, 'event_reminder', 'Still interested?',
      COALESCE(v_row.title, 'An event you marked')
        || CASE WHEN v_row.slot = 1440 THEN ' starts tomorrow.' ELSE ' starts in about 2 hours.' END
        || ' Join to get a reminder and the event chat.',
      v_row.event_id,
      jsonb_build_object('eventId', v_row.event_id, 'kind', 'interested_nudge')
    );
    INSERT INTO event_reminder_sent (event_id, user_id, kind, reminder_minutes)
    VALUES (v_row.event_id, v_row.user_id, 'interested', v_row.slot)
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$function$;

-- ---------------------------------------------------------------------------
-- G13: when a series' start or pattern changes, exceptions (and per-date
-- RSVPs, if that table exists) on dates the series no longer runs are
-- removed, so they can't silently re-match after a later edit.
CREATE OR REPLACE FUNCTION public.prune_orphaned_occurrence_rows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tz text := COALESCE(NULLIF(NEW.timezone, ''), 'UTC');
  v_start_local timestamp := NEW.start_datetime AT TIME ZONE v_tz;
  v_end text := NEW.recurrence_pattern->>'endDate';
BEGIN
  IF NOT COALESCE(NEW.is_recurring, false) OR NEW.recurrence_pattern IS NULL THEN
    DELETE FROM event_occurrence_exceptions WHERE event_id = NEW.id;
    IF to_regclass('public.rsvp_occurrences') IS NOT NULL THEN
      EXECUTE 'DELETE FROM rsvp_occurrences WHERE event_id = $1' USING NEW.id;
    END IF;
    RETURN NULL;
  END IF;
  DELETE FROM event_occurrence_exceptions x
   WHERE x.event_id = NEW.id
     AND (NOT event_recurrence_matches(v_start_local, NEW.recurrence_pattern, x.occurrence_date)
          OR (v_end ~ '^\d{4}-\d{2}-\d{2}' AND x.occurrence_date > left(v_end, 10)::date));
  IF to_regclass('public.rsvp_occurrences') IS NOT NULL THEN
    EXECUTE $q$
      DELETE FROM rsvp_occurrences ro
       WHERE ro.event_id = $1
         AND (NOT event_recurrence_matches($2, $3, ro.occurrence_date)
              OR ($4 ~ '^\d{4}-\d{2}-\d{2}' AND ro.occurrence_date > left($4, 10)::date))
    $q$ USING NEW.id, v_start_local, NEW.recurrence_pattern, v_end;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS z_prune_orphaned_occurrence_rows ON public.events;
CREATE TRIGGER z_prune_orphaned_occurrence_rows
  AFTER UPDATE OF start_datetime, recurrence_pattern, is_recurring, timezone ON public.events
  FOR EACH ROW
  WHEN (OLD.start_datetime IS DISTINCT FROM NEW.start_datetime
     OR OLD.recurrence_pattern IS DISTINCT FROM NEW.recurrence_pattern
     OR OLD.is_recurring IS DISTINCT FROM NEW.is_recurring
     OR OLD.timezone IS DISTINCT FROM NEW.timezone)
  EXECUTE FUNCTION public.prune_orphaned_occurrence_rows();
