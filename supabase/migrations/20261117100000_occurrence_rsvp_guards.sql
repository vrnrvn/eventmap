-- Event journey review, migration 1 of 7 (docs/EVENT_JOURNEY_REVIEW_2026-11-17.md).
--
-- STATUS: PREPARED, NOT APPLIED. Staged in supabase/prepared/, outside the
-- folder the Supabase CLI applies. Validated only in a throwaway isolated
-- container (scripts/pg17-isolated.sh). The owner moves it into
-- supabase/migrations/ and applies it; see this folder's README.
--
-- set_occurrence_rsvp hardening:
--   EJ-1  refuse a suspended account (user_is_banned), like its sibling RPCs.
--         Reproduced: a suspended user could take a seat on a capped date.
--   EJ-13 refuse any change for a date whose session already finished.
--         Reproduced: "going" accepted an hour after the session ended.
-- Body otherwise identical to the live definition (20261109150000).

CREATE OR REPLACE FUNCTION public.set_occurrence_rsvp(p_event_id uuid, p_date date, p_status text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_event events%ROWTYPE;
  v_tz text;
  v_end text;
  v_prev text;
  v_series_going boolean;
  v_status text := p_status;
  v_date_end timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('going', 'not_going') THEN
    RAISE EXCEPTION 'invalid_status: going, not_going or null (waitlist is assigned by the server)';
  END IF;
  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF NOT FOUND OR NOT event_is_open_for_rsvp(p_event_id) THEN
    RAISE EXCEPTION 'rsvp_closed: this event is not taking RSVPs';
  END IF;
  -- EJ-1: the sibling RPCs (join_event_with_capacity, join_event_waitlist)
  -- refuse a suspended account; this one did not.
  IF user_is_banned(v_uid) THEN
    RAISE EXCEPTION 'not_allowed: account suspended';
  END IF;
  IF user_is_banned_from_event(p_event_id, v_uid) THEN
    RAISE EXCEPTION 'not_allowed: you can''t join this event';
  END IF;
  IF NOT COALESCE(v_event.is_recurring, false) OR v_event.recurrence_pattern IS NULL THEN
    RAISE EXCEPTION 'not_recurring: use the event RSVP';
  END IF;

  -- EJ-13: a date whose session has already finished is attendance now, so
  -- no answer for it may change (the client stops offering it too). The
  -- session's end is the moved end for a rescheduled date, otherwise the
  -- date's local start + the series duration.
  v_tz := COALESCE(NULLIF(v_event.timezone, ''), 'UTC');
  SELECT x.new_end INTO v_date_end FROM event_occurrence_exceptions x
   WHERE x.event_id = p_event_id AND x.occurrence_date = p_date AND x.kind = 'rescheduled';
  IF v_date_end IS NULL THEN
    v_date_end := ((p_date + (v_event.start_datetime AT TIME ZONE v_tz)::time) AT TIME ZONE v_tz)
                  + (v_event.end_datetime - v_event.start_datetime);
  END IF;
  IF v_date_end <= now() THEN
    RAISE EXCEPTION 'invalid_occurrence: that date is over';
  END IF;

  SELECT status INTO v_prev FROM rsvp_occurrences
   WHERE event_id = p_event_id AND user_id = v_uid AND occurrence_date = p_date;
  v_series_going := EXISTS (SELECT 1 FROM rsvps r WHERE r.event_id = p_event_id AND r.user_id = v_uid AND r.status = 'going');

  IF p_status IS NULL THEN
    DELETE FROM rsvp_occurrences WHERE event_id = p_event_id AND user_id = v_uid AND occurrence_date = p_date;
    -- Clearing a date-only 'going' (or a not_going held by a series goer
    -- flipping back) can free or take a seat; only the free case matters.
    IF v_prev = 'going' AND NOT v_series_going THEN PERFORM promote_occurrence_waitlist(p_event_id, p_date); END IF;
    RETURN json_build_object('date', p_date, 'status', NULL);
  END IF;

  v_tz := COALESCE(NULLIF(v_event.timezone, ''), 'UTC');
  v_end := v_event.recurrence_pattern->>'endDate';
  IF p_date < (now() AT TIME ZONE v_tz)::date
     OR NOT event_recurrence_matches(v_event.start_datetime AT TIME ZONE v_tz, v_event.recurrence_pattern, p_date)
     OR (v_end ~ '^\d{4}-\d{2}-\d{2}' AND p_date > left(v_end, 10)::date) THEN
    RAISE EXCEPTION 'invalid_occurrence: the series does not run on that date';
  END IF;
  IF p_status = 'going' AND EXISTS (
    SELECT 1 FROM event_occurrence_exceptions x
     WHERE x.event_id = p_event_id AND x.occurrence_date = p_date AND x.kind = 'cancelled') THEN
    RAISE EXCEPTION 'invalid_occurrence: that date is cancelled';
  END IF;

  -- G18 / F-R2: a date-only "going" counts against max_attendees for that
  -- date. When the date is full the user goes on that date's waitlist
  -- (unless the host turned the waitlist off), like Eventbrite/Meetup do
  -- per occurrence. Series goers flipping back from not_going were counted
  -- when they joined the series, so they are never waitlisted here.
  IF p_status = 'going' AND v_event.max_attendees IS NOT NULL AND NOT v_series_going AND v_prev IS DISTINCT FROM 'going' THEN
    IF occurrence_going_count(p_event_id, p_date) >= v_event.max_attendees THEN
      IF COALESCE(v_event.waitlist_mode, 'notify') = 'off' THEN
        RAISE EXCEPTION 'event_full: that date is full';
      END IF;
      v_status := 'waitlist';
    END IF;
  END IF;

  INSERT INTO rsvp_occurrences (event_id, user_id, occurrence_date, status)
  VALUES (p_event_id, v_uid, p_date, v_status)
  ON CONFLICT (event_id, user_id, occurrence_date) DO UPDATE SET status = EXCLUDED.status, updated_at = now();

  -- A series goer opting out, or a date-only goer stepping back, frees a seat.
  IF p_status = 'not_going' AND (v_series_going OR v_prev = 'going') THEN
    PERFORM promote_occurrence_waitlist(p_event_id, p_date);
  END IF;
  RETURN json_build_object('date', p_date, 'status', v_status);
END;
$function$;
