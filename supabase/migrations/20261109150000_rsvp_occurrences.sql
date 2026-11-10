-- Per-date "Going" for recurring series (docs/CATEGORIES_AND_SERIES_PLAN.md
-- Phase F, decision 2). Facebook-style: the series RSVP stays the default;
-- a per-date row overrides it for one date ("going to the series, not this
-- Tuesday") or adds a single date ("just this one").
--
-- NOT applied to the shared local database by the author; validated on an
-- isolated scratch copy only. Apply AFTER 20261109140000_occurrence_exceptions.
--
--  1. rsvp_occurrences (event, user, original date in the event zone,
--     'going' | 'not_going'). Users read their own rows; hosts/admins read
--     their events'; writes via set_occurrence_rsvp only.
--  2. set_occurrence_rsvp(event, date, status|NULL): NULL clears the
--     override. Same gates as series RSVPs (open event, not banned) plus the
--     date must be a real, future, not-cancelled occurrence.
--  3. get_occurrence_going_counts(event, dates[]): per-date going counts
--     (series going − opted out + date-only going). Public: counts only.
--  4. send_event_reminders: the "going" audience for a series date now
--     honours overrides (captured from the scratch snapshot with
--     20261109140000 applied; re-diff before applying, see G16).
-- Capacity: a date-only "going" is checked against max_attendees (G18).
-- Waitlist: per date (F-R2), following events.waitlist_mode. Approvals stay series-level.

CREATE TABLE IF NOT EXISTS public.rsvp_occurrences (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('going', 'not_going', 'waitlist')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id, occurrence_date)
);
-- Re-applying on a copy that has the two-value CHECK: widen it.
ALTER TABLE public.rsvp_occurrences DROP CONSTRAINT IF EXISTS rsvp_occurrences_status_check;
ALTER TABLE public.rsvp_occurrences
  ADD CONSTRAINT rsvp_occurrences_status_check CHECK (status IN ('going', 'not_going', 'waitlist'));
CREATE INDEX IF NOT EXISTS idx_rsvp_occurrences_event_date ON public.rsvp_occurrences (event_id, occurrence_date);
CREATE INDEX IF NOT EXISTS idx_rsvp_occurrences_user ON public.rsvp_occurrences (user_id);

ALTER TABLE public.rsvp_occurrences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own per-date RSVPs" ON public.rsvp_occurrences;
CREATE POLICY "Own per-date RSVPs" ON public.rsvp_occurrences FOR SELECT
  USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Hosts read per-date RSVPs" ON public.rsvp_occurrences;
CREATE POLICY "Hosts read per-date RSVPs" ON public.rsvp_occurrences FOR SELECT
  USING (is_admin_user() OR EXISTS (
    SELECT 1 FROM events e JOIN businesses b ON b.id = e.business_id
     WHERE e.id = event_id AND b.owner_id = (SELECT auth.uid())));

-- Going on one date: series goers minus opt-outs, plus date-only goers.
-- Internal (no visibility gate); the public counts RPC wraps it.
CREATE OR REPLACE FUNCTION public.occurrence_going_count(p_event_id uuid, p_date date)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT (SELECT count(*) FROM rsvps r
           WHERE r.event_id = p_event_id AND r.status = 'going'
             AND NOT EXISTS (SELECT 1 FROM rsvp_occurrences ro
                              WHERE ro.event_id = p_event_id AND ro.user_id = r.user_id
                                AND ro.occurrence_date = p_date AND ro.status = 'not_going'))
       + (SELECT count(*) FROM rsvp_occurrences ro
           WHERE ro.event_id = p_event_id AND ro.occurrence_date = p_date AND ro.status = 'going'
             AND NOT EXISTS (SELECT 1 FROM rsvps r WHERE r.event_id = p_event_id
                              AND r.user_id = ro.user_id AND r.status = 'going'));
$function$;
REVOKE EXECUTE ON FUNCTION public.occurrence_going_count(uuid, date) FROM PUBLIC;

-- Seats freed on one date: honour the event's waitlist_mode. 'auto' moves
-- the longest-waiting people to going (and tells them); 'notify' tells them
-- a spot opened; 'off' does nothing. Per-date mirror of handle_event_seats_freed.
CREATE OR REPLACE FUNCTION public.promote_occurrence_waitlist(p_event_id uuid, p_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_free integer;
  v_row record;
  v_n integer := 0;
  v_when text;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF NOT FOUND OR v_event.max_attendees IS NULL OR COALESCE(v_event.waitlist_mode, 'notify') = 'off' THEN RETURN 0; END IF;
  v_free := v_event.max_attendees - occurrence_going_count(p_event_id, p_date);
  IF v_free <= 0 THEN RETURN 0; END IF;
  v_when := to_char(p_date, 'FMDay FMDD Mon');
  FOR v_row IN
    SELECT ro.user_id FROM rsvp_occurrences ro
     WHERE ro.event_id = p_event_id AND ro.occurrence_date = p_date AND ro.status = 'waitlist'
     ORDER BY ro.created_at, ro.user_id
     LIMIT v_free
  LOOP
    IF v_event.waitlist_mode = 'auto' THEN
      UPDATE rsvp_occurrences SET status = 'going', updated_at = now()
       WHERE event_id = p_event_id AND user_id = v_row.user_id AND occurrence_date = p_date;
      INSERT INTO notifications (user_id, type, title, body, event_id, data)
      VALUES (v_row.user_id, 'waitlist', 'You''re in',
              'A spot opened: you''re going to "' || COALESCE(v_event.title, 'the event') || '" on ' || v_when || '.',
              p_event_id, jsonb_build_object('eventId', p_event_id, 'kind', 'occurrence_waitlist_promoted', 'date', p_date));
    ELSE
      INSERT INTO notifications (user_id, type, title, body, event_id, data)
      VALUES (v_row.user_id, 'waitlist', 'A spot opened',
              'Room just opened for "' || COALESCE(v_event.title, 'the event') || '" on ' || v_when || '. Tap to join that date.',
              p_event_id, jsonb_build_object('eventId', p_event_id, 'kind', 'occurrence_waitlist_spot', 'date', p_date));
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.promote_occurrence_waitlist(uuid, date) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.set_occurrence_rsvp(p_event_id uuid, p_date date, p_status text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_event events%ROWTYPE;
  v_tz text;
  v_end text;
  v_prev text;
  v_series_going boolean;
  v_status text := p_status;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('going', 'not_going') THEN
    RAISE EXCEPTION 'invalid_status: going, not_going or null (waitlist is assigned by the server)';
  END IF;
  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF NOT FOUND OR NOT event_is_open_for_rsvp(p_event_id) THEN
    RAISE EXCEPTION 'rsvp_closed: this event is not taking RSVPs';
  END IF;
  IF user_is_banned_from_event(p_event_id, v_uid) THEN
    RAISE EXCEPTION 'not_allowed: you can''t join this event';
  END IF;
  IF NOT COALESCE(v_event.is_recurring, false) OR v_event.recurrence_pattern IS NULL THEN
    RAISE EXCEPTION 'not_recurring: use the event RSVP';
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
REVOKE EXECUTE ON FUNCTION public.set_occurrence_rsvp(uuid, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_occurrence_rsvp(uuid, date, text) TO authenticated;

DROP FUNCTION IF EXISTS public.get_occurrence_going_counts(uuid, date[]);
CREATE OR REPLACE FUNCTION public.get_occurrence_going_counts(p_event_id uuid, p_dates date[])
RETURNS TABLE (occurrence_date date, going_count bigint, waitlist_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  -- Counts only, for events the caller can see (event RLS is bypassed by
  -- SECURITY DEFINER, so check visibility explicitly). Max 60 dates.
  SELECT d.day,
         occurrence_going_count(p_event_id, d.day),
         (SELECT count(*) FROM rsvp_occurrences ro
           WHERE ro.event_id = p_event_id AND ro.occurrence_date = d.day AND ro.status = 'waitlist')
  FROM (SELECT DISTINCT unnest(p_dates[1:60]) AS day) d
  WHERE EXISTS (
    SELECT 1 FROM events e
     WHERE e.id = p_event_id AND e.status = 'active' AND e.publish_state = 'published'
       AND (e.visibility = 'public' OR is_admin_user()
            OR EXISTS (SELECT 1 FROM businesses b WHERE b.id = e.business_id AND b.owner_id = auth.uid())))
  ORDER BY d.day;
$function$;
GRANT EXECUTE ON FUNCTION public.get_occurrence_going_counts(uuid, date[]) TO anon, authenticated;

-- G19: leaving the series ('going' → anything else, or deleting the RSVP)
-- drops the user's 'not_going' overrides (meaningless without a series RSVP)
-- but KEEPS their date-only 'going' rows: "I left the series but I'm still
-- coming on the 24th" stays true.
CREATE OR REPLACE FUNCTION public.prune_date_rsvps_on_series_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.status <> 'going' AND OLD.status = 'going') THEN
    DELETE FROM rsvp_occurrences
     WHERE event_id = OLD.event_id AND user_id = OLD.user_id AND status = 'not_going';
    -- A series goer leaving frees a seat on every date that has a waitlist.
    IF OLD.status = 'going' THEN
      PERFORM promote_occurrence_waitlist(OLD.event_id, d.occurrence_date)
        FROM (SELECT DISTINCT ro.occurrence_date FROM rsvp_occurrences ro
               WHERE ro.event_id = OLD.event_id AND ro.status = 'waitlist') d;
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS z_prune_date_rsvps_on_series_leave ON public.rsvps;
CREATE TRIGGER z_prune_date_rsvps_on_series_leave
  AFTER UPDATE OF status OR DELETE ON public.rsvps
  FOR EACH ROW EXECUTE FUNCTION public.prune_date_rsvps_on_series_leave();

-- F-R3: who is going on ONE date (host/admin only). Same privacy handling
-- as get_event_host_attendees_page (host_display_name for private profiles).
CREATE OR REPLACE FUNCTION public.get_occurrence_attendees_page(
  p_event_id uuid, p_date date, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_owner uuid;
  safe_limit integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
  safe_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  result json;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT b.owner_id INTO v_owner FROM events e JOIN businesses b ON b.id = e.business_id WHERE e.id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can view attendees';
  END IF;
  WITH going AS (
    SELECT r.user_id, r.created_at AS joined_at, 'series'::text AS via
      FROM rsvps r
     WHERE r.event_id = p_event_id AND r.status = 'going'
       AND NOT EXISTS (SELECT 1 FROM rsvp_occurrences ro WHERE ro.event_id = p_event_id
                         AND ro.user_id = r.user_id AND ro.occurrence_date = p_date AND ro.status = 'not_going')
    UNION ALL
    SELECT ro.user_id, ro.created_at, 'date'::text
      FROM rsvp_occurrences ro
     WHERE ro.event_id = p_event_id AND ro.occurrence_date = p_date AND ro.status = 'going'
       AND NOT EXISTS (SELECT 1 FROM rsvps r WHERE r.event_id = p_event_id AND r.user_id = ro.user_id AND r.status = 'going')
  ),
  matched AS (
    SELECT p.id AS user_id, p.name, p.avatar_url, p.bio, g.joined_at, g.via,
           (COALESCE(p.is_profile_private, false) OR COALESCE(p.show_attendance_publicly, true) = false) AS is_private
      FROM going g JOIN profiles p ON p.id = g.user_id
  ),
  total AS (SELECT count(*) AS c FROM matched),
  page AS (SELECT * FROM matched ORDER BY joined_at, user_id LIMIT safe_limit OFFSET safe_offset)
  SELECT json_build_object(
    'total', (SELECT c FROM total),
    'items', COALESCE((SELECT json_agg(json_build_object(
        'user_id', user_id,
        'name', host_display_name(name, is_private),
        'avatar_url', CASE WHEN is_private THEN NULL ELSE avatar_url END,
        'is_private', is_private,
        'joined_at', joined_at,
        'via', via)) FROM page), '[]'::json),
    'has_more', (SELECT c FROM total) > safe_offset + safe_limit
  ) INTO result;
  RETURN result;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_occurrence_attendees_page(uuid, date, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_occurrence_attendees_page(uuid, date, integer, integer) TO authenticated;

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
    -- Phase F: series "going" minus per-date "not going", plus people going
    -- to just this date (rsvp_occurrences). One-offs are unaffected.
    JOIN LATERAL (
      SELECT r0.user_id FROM rsvps r0
       WHERE r0.event_id = e.id AND r0.status = 'going'
         AND NOT EXISTS (
           SELECT 1 FROM rsvp_occurrences ro
            WHERE ro.event_id = e.id AND ro.user_id = r0.user_id AND ro.status = 'not_going'
              AND COALESCE(e.is_recurring, false)
              AND ro.occurrence_date = (occ.at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'UTC'))::date)
      UNION
      SELECT ro.user_id FROM rsvp_occurrences ro
       WHERE ro.event_id = e.id AND ro.status = 'going' AND COALESCE(e.is_recurring, false)
         AND ro.occurrence_date = (occ.at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'UTC'))::date
    ) r ON true
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
