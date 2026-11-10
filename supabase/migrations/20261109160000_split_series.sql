-- "This and following" (docs/CATEGORIES_AND_SERIES_PLAN.md decision 3,
-- Phase F). Splits a recurring series at one of its dates: the original
-- ends the day before; a new series (same details) starts at that date and
-- keeps the original end. The host then edits the new series freely.
--
-- NOT applied to the shared local database by the author; validated on an
-- isolated scratch copy only. Apply AFTER 20261109150000_rsvp_occurrences.
--
-- Moved to the new series: going/interested series RSVPs, saves, links
-- and photos (copied), exceptions and per-date RSVPs on or after the split
-- date (moved). Chat, reviews and history stay with the original (G20). Followers are NOT notified (inserted as draft,
-- then published through the sanctioned setting). Does not count towards
-- the monthly event quota (gap G21). Requires premium like any recurring
-- write (enforce_recurring_premium_on_update).

CREATE OR REPLACE FUNCTION public.split_series_from(p_event_id uuid, p_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  UPDATE events SET recurrence_pattern = v_old_pattern WHERE id = p_event_id;
  PERFORM set_config('eventmap.allow_reschedule', '', true);

  RETURN v_new_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.split_series_from(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.split_series_from(uuid, date) TO authenticated;
