-- Event journey review, migration 7 of 7 (docs/EVENT_JOURNEY_REVIEW_2026-11-17.md).
--
-- STATUS: PREPARED, NOT APPLIED. Staged in supabase/prepared/; validated only
-- in a throwaway isolated container. See this folder's README.
--
-- EJ-16 (owner decision 2026-11-17): "attended" counts per session. It was
-- series-level and only once a series had ended, so a member of an
-- open-ended weekly series who went 20 times had attended it 0 times.
--   * get_user_attendance_counts.attended_count: one-offs once, series per
--     finished date attended (incl. date-only goers' dates).
--   * get_user_going_events(scope 'past'): also lists a running series once
--     at least one of its dates was attended.
-- Not covered (found while writing this, EJ-24): events someone attends only
-- through per-date RSVPs appear in no Joined list (the list reads series
-- RSVPs only). Their sessions do count in attended_count.

CREATE OR REPLACE FUNCTION public.user_series_sessions_attended(p_event_id uuid, p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
-- Finished sessions of a series that p_user_id attended, without check-in:
-- "attended" = going to that date. Series goers attend every finished,
-- non-cancelled date except those they set to not_going (or waited for on
-- the waitlist); date-only goers attend the dates they were going to.
-- Walks at most the last 3 years of dates (bounded cost per call).
-- Known limit: leaving a series removes the series RSVP, and with it the
-- credit for its past dates (date-only rows are kept).
DECLARE
  v_event events%ROWTYPE;
  v_tz text;
  v_local_start timestamp;
  v_duration interval;
  v_series_going boolean;
  v_from date;
  v_to date;
  v_end text;
  v_n integer;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF NOT FOUND OR NOT COALESCE(v_event.is_recurring, false) OR v_event.recurrence_pattern IS NULL THEN
    RETURN 0;
  END IF;
  v_tz := COALESCE(NULLIF(v_event.timezone, ''), 'UTC');
  v_local_start := v_event.start_datetime AT TIME ZONE v_tz;
  v_duration := v_event.end_datetime - v_event.start_datetime;
  v_series_going := EXISTS (SELECT 1 FROM rsvps r
                             WHERE r.event_id = p_event_id AND r.user_id = p_user_id AND r.status = 'going');
  v_to := (now() AT TIME ZONE v_tz)::date;
  v_end := v_event.recurrence_pattern->>'endDate';
  IF COALESCE(v_end, '') ~ '^\d{4}-\d{2}-\d{2}' THEN v_to := least(v_to, left(v_end, 10)::date); END IF;
  v_from := greatest(v_local_start::date, v_to - 1095);
  IF v_to < v_from THEN RETURN 0; END IF;

  SELECT count(*) INTO v_n
    FROM generate_series(v_from, v_to, interval '1 day') AS g(d)
    LEFT JOIN event_occurrence_exceptions x
           ON x.event_id = p_event_id AND x.occurrence_date = g.d::date
    LEFT JOIN rsvp_occurrences ro
           ON ro.event_id = p_event_id AND ro.user_id = p_user_id AND ro.occurrence_date = g.d::date
   WHERE event_recurrence_matches(v_local_start, v_event.recurrence_pattern, g.d::date)
     AND x.kind IS DISTINCT FROM 'cancelled'
     -- the session in effect (moved or not) has finished
     AND COALESCE(x.new_end, ((g.d::date + v_local_start::time) AT TIME ZONE v_tz) + v_duration) <= now()
     AND CASE WHEN v_series_going THEN ro.status IS NULL OR ro.status = 'going'
              ELSE ro.status = 'going' END;
  RETURN v_n;
END;
$function$;
-- Internal: answers about OTHER users; the RPCs below decide who may ask.
REVOKE EXECUTE ON FUNCTION public.user_series_sessions_attended(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_user_attendance_counts(user_id_param uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_upcoming integer := 0;
  v_attended integer := 0;
  v_saved integer := 0;
  v_interested integer := 0;
  v_requested integer := 0;                                    -- 20261104120000
  v_is_owner boolean;
BEGIN
  IF NOT can_view_user_events(user_id_param) THEN
    RETURN json_build_object('upcoming_count', 0, 'attended_count', 0, 'saved_count', 0, 'interested_count', 0, 'requested_count', 0);
  END IF;

  v_is_owner := (auth.uid() = user_id_param);

  IF v_is_owner THEN
    SELECT COUNT(*) INTO v_saved FROM saves WHERE user_id = user_id_param;
    SELECT COUNT(*) INTO v_interested
    FROM rsvps r JOIN events e ON e.id = r.event_id
    WHERE r.user_id = user_id_param
      AND r.status = 'interested'
      AND e.status = 'active'                                   -- added
      AND NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone);
    -- Pending approval requests (20261104120000), counted like interested.
    SELECT COUNT(*) INTO v_requested
    FROM rsvps r JOIN events e ON e.id = r.event_id
    WHERE r.user_id = user_id_param
      AND r.status = 'requested'
      AND e.status = 'active'
      AND NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone);
  END IF;

  -- Upcoming: unchanged (events not over). Attended (EJ-16, owner decision
  -- 2026-11-17): per session — an ended one-off counts once, a series counts
  -- each of its finished dates the user attended (series goers minus dates
  -- they opted out of; date-only goers for their dates).
  SELECT COUNT(*) FILTER (WHERE NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone))
  INTO v_upcoming
  FROM rsvps r
  JOIN events e ON e.id = r.event_id
  WHERE r.user_id = user_id_param
    AND r.status = 'going'
    AND e.status = 'active';

  SELECT COALESCE(SUM(CASE WHEN COALESCE(e.is_recurring, false)
                           THEN user_series_sessions_attended(e.id, user_id_param)
                           ELSE 1 END), 0)
  INTO v_attended
  FROM events e
  WHERE e.status = 'active'
    AND (
      (NOT COALESCE(e.is_recurring, false)
        AND event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
        AND EXISTS (SELECT 1 FROM rsvps r WHERE r.event_id = e.id AND r.user_id = user_id_param AND r.status = 'going'))
      OR (COALESCE(e.is_recurring, false) AND (
        EXISTS (SELECT 1 FROM rsvps r WHERE r.event_id = e.id AND r.user_id = user_id_param AND r.status = 'going')
        OR EXISTS (SELECT 1 FROM rsvp_occurrences ro WHERE ro.event_id = e.id AND ro.user_id = user_id_param AND ro.status = 'going')))
    );

  RETURN json_build_object(
    'upcoming_count', v_upcoming,
    'attended_count', CASE WHEN v_is_owner THEN v_attended ELSE 0 END,
    'saved_count', v_saved,
    'interested_count', v_interested,
    'requested_count', v_requested
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_going_events(user_id_param uuid, p_scope text DEFAULT 'upcoming'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result json;
  want_past boolean;
  safe_limit integer;
  safe_offset integer;
BEGIN
  IF p_scope NOT IN ('upcoming', 'past', 'interested', 'requested') THEN
    RAISE EXCEPTION 'Invalid scope %, expected upcoming, past, interested or requested', p_scope;
  END IF;

  want_past := (p_scope = 'past');
  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  -- Privacy: upcoming lists follow the profile's sharing settings; history is
  -- only ever visible to its owner.
  IF NOT can_view_user_events(user_id_param) THEN
    RETURN '[]'::json;
  END IF;
  -- History, the lower-signal "interested" list and pending approval
  -- requests are only for the owner.
  IF p_scope IN ('past', 'interested', 'requested') AND auth.uid() IS DISTINCT FROM user_id_param THEN
    RETURN '[]'::json;
  END IF;

  SELECT COALESCE(
    json_agg(
      json_build_object(
        'id', sub.id,
        'business_id', sub.business_id,
        'title', sub.title,
        'description', sub.description,
        'category_id', sub.category_id,
        'start_datetime', sub.start_datetime,
        'end_datetime', sub.end_datetime,
        'lat', sub.lat,
        'lng', sub.lng,
        'address', sub.address,
        'cover_image_url', sub.cover_image_url,
        'is_recurring', sub.is_recurring,
        'recurrence_pattern', sub.recurrence_pattern,
        'timezone', sub.timezone,                               -- 20261104120000
        'status', sub.status,                                   -- added
        'created_at', sub.created_at,
        'updated_at', sub.updated_at,
        'business_name', sub.business_name,
        'business_logo_url', sub.business_logo_url,
        'category_label', sub.category_label,
        'category_slug', sub.category_slug,
        'rsvp_count', sub.rsvp_count,
        'save_count', sub.save_count,
        'next_start_datetime', sub.next_start_datetime
      )
      ORDER BY sub.sort_key, sub.start_datetime
    ),
    '[]'::json
  ) INTO result
  FROM (
    SELECT
      e.id,
      e.business_id,
      e.title,
      e.description,
      e.category_id,
      e.start_datetime,
      e.end_datetime,
      e.lat,
      e.lng,
      e.address,
      COALESCE(
        e.cover_image_url,
        (SELECT ep.image_url FROM event_photos ep WHERE ep.event_id = e.id ORDER BY ep.sort_order ASC LIMIT 1)
      ) AS cover_image_url,
      COALESCE(e.is_recurring, false) AS is_recurring,
      e.recurrence_pattern,
      e.timezone,                                               -- 20261104120000
      e.status,                                                 -- added
      e.created_at,
      e.updated_at,
      b.name AS business_name,
      b.logo_url AS business_logo_url,
      c.label AS category_label,
      c.slug AS category_slug,
      COALESCE(rc.count, 0) AS rsvp_count,
      COALESCE(sc.count, 0) AS save_count,
      event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern, e.timezone) AS next_start_datetime,
      -- Upcoming: whatever happens next comes first (an event already in
      -- progress keeps its past start and therefore leads). Past: most recent first.
      CASE WHEN want_past
        THEN -extract(epoch FROM e.start_datetime)
        ELSE  extract(epoch FROM event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern, e.timezone))
      END AS sort_key
    FROM rsvps r
    JOIN events e ON e.id = r.event_id
    JOIN businesses b ON b.id = e.business_id
    JOIN categories c ON c.id = e.category_id
    LEFT JOIN (
      SELECT event_id, COUNT(*) AS count FROM rsvps WHERE status = 'going' GROUP BY event_id
    ) rc ON rc.event_id = e.id
    LEFT JOIN (
      SELECT event_id, COUNT(*) AS count FROM saves GROUP BY event_id
    ) sc ON sc.event_id = e.id
    WHERE r.user_id = user_id_param
      AND r.status = CASE p_scope WHEN 'interested' THEN 'interested' WHEN 'requested' THEN 'requested' ELSE 'going' END
      -- A cancelled event never happened: it is neither upcoming nor attended.
      AND e.status = 'active'                                   -- added
      -- EJ-16: "past" (attended) also lists a series still running once the
      -- user attended at least one of its dates, matching attended_count.
      AND CASE WHEN want_past
               THEN event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
                    OR (COALESCE(e.is_recurring, false) AND user_series_sessions_attended(e.id, user_id_param) > 0)
               ELSE NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
          END
    ORDER BY sort_key, e.start_datetime
    LIMIT safe_limit
    OFFSET safe_offset
  ) sub;

  RETURN result;
END;
$function$;
