-- Pending approval requests in the attendee's own lists, and event zones in
-- list rows (docs/ANALYTICS_AND_CALENDAR_PLAN.md §2.4, Phase B).
--
-- STATUS: prepared, NOT applied to the shared DB. Validated on an isolated
-- scratch copy with scripts/test-calendar.sql. Depends on the 20261103* set
-- (rsvps.status 'requested', events.timezone).
--
-- Both functions are re-created from their live definitions (dumped
-- read-only from the shared DB on 2026-11-04) with only these changes:
--   get_user_going_events: new p_scope 'requested' (owner-only, upcoming,
--     active events) and a 'timezone' key on every row, so the Joined list
--     and the calendar's list fallback walk zoned series on the event's
--     calendar instead of the viewer's.
--   get_user_attendance_counts: new 'requested_count' (owner-only). Clients
--     use it to decide whether to show a Requests tab, which also works as
--     feature detection while this file is unapplied (the key is absent).
-- Signatures and grants are unchanged.

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
      AND event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone) = want_past
    ORDER BY sort_key, e.start_datetime
    LIMIT safe_limit
    OFFSET safe_offset
  ) sub;

  RETURN result;
END;
$function$;

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

  SELECT
    COUNT(*) FILTER (WHERE NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)),
    COUNT(*) FILTER (WHERE event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone))
  INTO v_upcoming, v_attended
  FROM rsvps r
  JOIN events e ON e.id = r.event_id
  WHERE r.user_id = user_id_param
    AND r.status = 'going'
    AND e.status = 'active';                                    -- added

  RETURN json_build_object(
    'upcoming_count', v_upcoming,
    'attended_count', CASE WHEN v_is_owner THEN v_attended ELSE 0 END,
    'saved_count', v_saved,
    'interested_count', v_interested,
    'requested_count', v_requested
  );
END;
$function$;
