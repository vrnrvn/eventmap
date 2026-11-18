-- Event journey review, migration 5 of 7 (docs/EVENT_JOURNEY_REVIEW_2026-11-17.md).
--
-- STATUS: PREPARED, NOT APPLIED. Rule APPROVED by the owner 2026-11-17
-- (EJ-14, docs/EVENT_JOURNEY_REVIEW_PLAN_2026-11-17.md §5a). Independent of
-- the other files.
--
-- EJ-14: moving a series date past the series end made the series read as
-- ended on the day that session happens (reproduced). reschedule_occurrence
-- now extends endDate to the moved day when that adds no other occurrence (the
-- usual case: the last date pushed a few days), and refuses otherwise, naming
-- the date that would appear. Until this is applied, the app's move picker
-- refuses any date past the end (Batch A7); relax that guard after applying.
-- Body otherwise identical to the live definition (20261109140000).

CREATE OR REPLACE FUNCTION public.reschedule_occurrence(p_event_id uuid, p_date date, p_new_start timestamp with time zone, p_new_end timestamp with time zone, p_note text DEFAULT NULL::text, p_notify boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_tz text;
  v_n integer := 0;
  v_end_date date;
  v_new_day date;
  v_extra date;
BEGIN
  v_event := occurrence_guard(p_event_id, p_date);
  IF p_new_start IS NULL OR p_new_end IS NULL OR p_new_end <= p_new_start THEN
    RAISE EXCEPTION 'invalid_occurrence: the new end must be after the new start';
  END IF;
  IF p_new_start <= now() THEN
    RAISE EXCEPTION 'invalid_occurrence: the new time must be in the future';
  END IF;
  v_tz := COALESCE(NULLIF(v_event.timezone, ''), 'UTC');

  -- EJ-14: a series reads as ended once its endDate day has passed, so a
  -- date moved beyond it would be "over" on the day it happens (no RSVPs, no
  -- reminder). Extend endDate to the moved day when that adds no other
  -- occurrence; otherwise refuse, naming the date it would add.
  IF COALESCE(v_event.recurrence_pattern->>'endDate', '') ~ '^\d{4}-\d{2}-\d{2}' THEN
    v_end_date := left(v_event.recurrence_pattern->>'endDate', 10)::date;
    v_new_day := (p_new_start AT TIME ZONE v_tz)::date;
    IF v_new_day > v_end_date THEN
      IF v_new_day - v_end_date > 366 THEN
        RAISE EXCEPTION 'invalid_occurrence: that is more than a year past the series end';
      END IF;
      -- The pattern without its end date, over (end, new day] — the new day
      -- included: landing on a pattern date would make two sessions that day.
      SELECT min(d::date) INTO v_extra
        FROM generate_series(v_end_date + 1, v_new_day, interval '1 day') AS d
       WHERE event_recurrence_matches(v_event.start_datetime AT TIME ZONE v_tz,
                                      v_event.recurrence_pattern - 'endDate', d::date);
      IF v_extra IS NOT NULL THEN
        RAISE EXCEPTION 'invalid_occurrence: moving past the series end would add % to the series; extend the series end first', v_extra;
      END IF;
      -- The "Date changed" notice below covers it; no separate
      -- "Schedule changed" notice for the extension (migration 3).
      PERFORM set_config('eventmap.skip_update_notice', 'true', true);
      UPDATE events
         SET recurrence_pattern = jsonb_set(recurrence_pattern, '{endDate}', to_jsonb(v_new_day::text))
       WHERE id = p_event_id;
      PERFORM set_config('eventmap.skip_update_notice', '', true);
    END IF;
  END IF;

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
