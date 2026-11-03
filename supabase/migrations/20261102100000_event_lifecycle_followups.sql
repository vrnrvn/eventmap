-- Event lifecycle follow-ups (events-flow review, 2026-11-02).
--
-- The cancelled status (20261030106000) was only wired into discovery and
-- the RSVP gate. Everything that enumerates a user's events, and the two
-- notification producers, still treated cancelled events as live. This
-- migration closes those gaps without changing any function signature, so
-- existing clients keep working unchanged:
--
--  1. send_event_reminders: never remind about a cancelled event.
--  2. notify_rsvp_users_on_event_update: skip cancelled events, and clear the
--     per-user "reminder already sent" log when the start time moves so a
--     rescheduled event gets a fresh reminder at the new time.
--  3. get_ranked_events: deterministic ORDER BY (trailing e.id) so offset
--     pagination can't duplicate or skip rows between pages, and events of
--     suspended (banned) hosts are excluded from discovery.
--  4. get_user_going_events / get_user_attendance_counts: cancelled events
--     drop out of Going / Interested / Attended lists and counts.
--  5. get_user_going_events / get_user_saved_events: expose `status` so the
--     client can badge a saved event that was cancelled.
--
-- All bodies below are the current definitions with only the marked lines
-- added. Nothing here depends on data; safe to apply on any environment that
-- already has 20261030116000.

-- 1. Reminders ---------------------------------------------------------------

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
      p.event_reminder_minutes AS reminder_minutes
    FROM events e
    JOIN businesses b ON b.id = e.business_id
    JOIN rsvps r ON r.event_id = e.id AND r.status = 'going'
    JOIN profiles p ON p.id = r.user_id
    WHERE e.status = 'active'                                   -- added
      AND e.start_datetime > now()
      AND e.start_datetime <= now() + interval '25 hours'
      AND COALESCE(p.event_reminder_enabled, true) = true
      AND p.event_reminder_minutes IN (10, 30, 60, 120, 1440)
      AND extract(epoch from (e.start_datetime - now())) / 60
          BETWEEN p.event_reminder_minutes - 5 AND p.event_reminder_minutes + 5
      AND NOT EXISTS (
        SELECT 1 FROM event_reminder_sent ers
        WHERE ers.event_id = e.id AND ers.user_id = r.user_id
          AND ers.kind = 'going' AND ers.reminder_minutes = p.event_reminder_minutes
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
    INSERT INTO event_reminder_sent (event_id, user_id, kind, reminder_minutes)
    VALUES (v_row.event_id, v_row.user_id, 'going', v_row.reminder_minutes)
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

-- 2. "Event updated" notifications --------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_rsvp_users_on_event_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Cancelled events are read-only from the attendee's point of view; the
  -- cancel_event RPC already told them. Don't follow up with "updated".
  IF NEW.status IS DISTINCT FROM 'active' THEN               -- added
    RETURN NEW;
  END IF;

  IF OLD.start_datetime IS NOT DISTINCT FROM NEW.start_datetime
     AND OLD.end_datetime IS NOT DISTINCT FROM NEW.end_datetime
     AND OLD.address IS NOT DISTINCT FROM NEW.address
     AND OLD.lat IS NOT DISTINCT FROM NEW.lat
     AND OLD.lng IS NOT DISTINCT FROM NEW.lng THEN
    RETURN NEW;
  END IF;

  -- A rescheduled event needs a fresh reminder at the new time. The sent-log
  -- is keyed per (event, user, kind, lead time), so without this a user who
  -- already got "starts in 60 minutes" for the old slot never gets one for
  -- the new slot.
  IF OLD.start_datetime IS DISTINCT FROM NEW.start_datetime THEN  -- added
    DELETE FROM event_reminder_sent WHERE event_id = NEW.id;
  END IF;

  INSERT INTO notifications (user_id, type, title, body, event_id)
  SELECT
    r.user_id,
    'event_update',
    'Event updated',
    '"' || COALESCE(NEW.title, 'Event') || '" has been updated. Check the new details.',
    NEW.id
  FROM rsvps r
  JOIN profiles p ON p.id = r.user_id
  WHERE r.event_id = NEW.id
    AND r.status IN ('going', 'interested')
    AND r.user_id != (SELECT owner_id FROM businesses WHERE id = NEW.business_id)
    AND COALESCE((p.notification_preferences->>'event_update')::boolean, true) = true;

  RETURN NEW;
END;
$function$;

-- 3. Stable discovery ordering ----------------------------------------------

CREATE OR REPLACE FUNCTION public.get_ranked_events(
  user_lat double precision,
  user_lng double precision,
  radius_km double precision DEFAULT 50,
  category_ids uuid[] DEFAULT NULL::uuid[],
  start_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  end_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  search_query text DEFAULT NULL::text,
  result_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, business_id uuid, title text, description text, category_id uuid,
  start_datetime timestamp with time zone, end_datetime timestamp with time zone,
  lat double precision, lng double precision, address text, cover_image_url text,
  created_at timestamp with time zone, distance_km double precision, is_premium boolean,
  rsvp_count bigint, save_count bigint, business_name text, business_logo_url text,
  category_label text, category_slug text, is_recurring boolean, recurrence_pattern jsonb,
  user_rsvp text, user_saved boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
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
    ) as cover_image_url,
    e.created_at,
    calculate_distance(user_lat, user_lng, e.lat, e.lng) as distance_km,
    CASE WHEN b.subscription_tier = 'premium' THEN true ELSE false END as is_premium,
    COALESCE(rsvp_counts.count, 0) as rsvp_count,
    COALESCE(save_counts.count, 0) as save_count,
    b.name as business_name,
    b.logo_url as business_logo_url,
    c.label as category_label,
    c.slug as category_slug,
    COALESCE(e.is_recurring, false) as is_recurring,
    e.recurrence_pattern,
    (SELECT ur.status FROM rsvps ur WHERE ur.event_id = e.id AND ur.user_id = auth.uid() LIMIT 1) as user_rsvp,
    EXISTS (SELECT 1 FROM saves us WHERE us.event_id = e.id AND us.user_id = auth.uid()) as user_saved
  FROM events e
  JOIN businesses b ON b.id = e.business_id
  JOIN categories c ON c.id = e.category_id
  LEFT JOIN (
    SELECT event_id, COUNT(*) as count
    FROM rsvps
    WHERE status = 'going'
    GROUP BY event_id
  ) rsvp_counts ON rsvp_counts.event_id = e.id
  LEFT JOIN (
    SELECT event_id, COUNT(*) as count
    FROM saves
    GROUP BY event_id
  ) save_counts ON save_counts.event_id = e.id
  WHERE
    e.status = 'active'
    -- Suspended hosts' events are not discoverable.               -- added
    AND NOT EXISTS (SELECT 1 FROM banned_users bu WHERE bu.user_id = b.owner_id)
    AND (
      (NOT COALESCE(e.is_recurring, false) AND e.end_datetime > NOW())
      OR
      (COALESCE(e.is_recurring, false) AND (
        e.recurrence_pattern IS NULL
        OR (e.recurrence_pattern->>'endDate') IS NULL
        OR (e.recurrence_pattern->>'endDate') !~ '^\d{4}-\d{2}-\d{2}'
        OR (e.recurrence_pattern->>'endDate')::date >= CURRENT_DATE
      ))
    )
    AND (
      (start_date IS NULL AND end_date IS NULL)
      OR
      (NOT COALESCE(e.is_recurring, false) AND (start_date IS NULL OR e.start_datetime >= start_date) AND (end_date IS NULL OR e.start_datetime <= end_date))
      OR
      (COALESCE(e.is_recurring, false) AND end_date IS NOT NULL AND e.start_datetime <= end_date
       AND (
         e.recurrence_pattern IS NULL
         OR (e.recurrence_pattern->>'endDate') IS NULL
         OR (e.recurrence_pattern->>'endDate') !~ '^\d{4}-\d{2}-\d{2}'
         OR (start_date IS NULL)
         OR (e.recurrence_pattern->>'endDate')::date >= (start_date)::date
       ))
    )
    AND (category_ids IS NULL OR e.category_id = ANY(category_ids))
    AND (search_query IS NULL OR
         e.title ILIKE '%' || search_query || '%' OR
         e.description ILIKE '%' || search_query || '%' OR
         b.name ILIKE '%' || search_query || '%')
    AND calculate_distance(user_lat, user_lng, e.lat, e.lng) <= radius_km
  ORDER BY
    CASE WHEN b.subscription_tier = 'premium' THEN 0 ELSE 1 END,
    calculate_distance(user_lat, user_lng, e.lat, e.lng),
    e.start_datetime,
    COALESCE(rsvp_counts.count, 0) DESC,
    e.id                                                        -- added
  LIMIT result_limit
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$function$;

-- 4 + 5. Attendance lists and counts ----------------------------------------

CREATE OR REPLACE FUNCTION public.get_user_going_events(
  user_id_param uuid,
  p_scope text DEFAULT 'upcoming'::text,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
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
  IF p_scope NOT IN ('upcoming', 'past', 'interested') THEN
    RAISE EXCEPTION 'Invalid scope %, expected upcoming, past or interested', p_scope;
  END IF;

  want_past := (p_scope = 'past');
  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  -- Privacy: upcoming lists follow the profile's sharing settings; history is
  -- only ever visible to its owner.
  IF NOT can_view_user_events(user_id_param) THEN
    RETURN '[]'::json;
  END IF;
  -- History and the lower-signal "interested" list are only for the owner.
  IF p_scope IN ('past', 'interested') AND auth.uid() IS DISTINCT FROM user_id_param THEN
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
      e.status,                                                 -- added
      e.created_at,
      e.updated_at,
      b.name AS business_name,
      b.logo_url AS business_logo_url,
      c.label AS category_label,
      c.slug AS category_slug,
      COALESCE(rc.count, 0) AS rsvp_count,
      COALESCE(sc.count, 0) AS save_count,
      event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern) AS next_start_datetime,
      -- Upcoming: whatever happens next comes first (an event already in
      -- progress keeps its past start and therefore leads). Past: most recent first.
      CASE WHEN want_past
        THEN -extract(epoch FROM e.start_datetime)
        ELSE  extract(epoch FROM event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern))
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
      AND r.status = CASE WHEN p_scope = 'interested' THEN 'interested' ELSE 'going' END
      -- A cancelled event never happened: it is neither upcoming nor attended.
      AND e.status = 'active'                                   -- added
      AND event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern) = want_past
    ORDER BY sort_key, e.start_datetime
    LIMIT safe_limit
    OFFSET safe_offset
  ) sub;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_saved_events(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  result json;
  safe_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  safe_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF auth.uid() IS NULL THEN
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
        'status', sub.status,                                   -- added
        'created_at', sub.created_at,
        'updated_at', sub.updated_at,
        'business_name', sub.business_name,
        'business_logo_url', sub.business_logo_url,
        'category_label', sub.category_label,
        'category_slug', sub.category_slug,
        'rsvp_count', sub.rsvp_count,
        'save_count', sub.save_count,
        'next_start_datetime', sub.next_start_datetime,
        'has_ended', sub.has_ended,
        'saved_at', sub.saved_at
      )
      ORDER BY sub.has_ended, sub.sort_key
    ),
    '[]'::json
  ) INTO result
  FROM (
    SELECT
      e.id, e.business_id, e.title, e.description, e.category_id,
      e.start_datetime, e.end_datetime, e.lat, e.lng, e.address,
      COALESCE(
        e.cover_image_url,
        (SELECT ep.image_url FROM event_photos ep WHERE ep.event_id = e.id ORDER BY ep.sort_order ASC LIMIT 1)
      ) AS cover_image_url,
      COALESCE(e.is_recurring, false) AS is_recurring,
      e.recurrence_pattern,
      e.status,                                                 -- added
      e.created_at, e.updated_at,
      b.name AS business_name,
      b.logo_url AS business_logo_url,
      c.label AS category_label,
      c.slug AS category_slug,
      COALESCE(rc.count, 0) AS rsvp_count,
      COALESCE(sc.count, 0) AS save_count,
      event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern) AS next_start_datetime,
      -- A cancelled save sorts with the past ones: it is no longer "coming up".
      (e.status <> 'active'                                     -- changed
        OR event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern)) AS has_ended,
      s.created_at AS saved_at,
      -- Upcoming saves soonest-first, then past saves most-recent-first.
      CASE WHEN e.status <> 'active'
             OR event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern)
        THEN -extract(epoch FROM e.start_datetime)
        ELSE  extract(epoch FROM event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern))
      END AS sort_key
    FROM saves s
    JOIN events e ON e.id = s.event_id
    JOIN businesses b ON b.id = e.business_id
    JOIN categories c ON c.id = e.category_id
    LEFT JOIN (
      SELECT event_id, COUNT(*) AS count FROM rsvps WHERE status = 'going' GROUP BY event_id
    ) rc ON rc.event_id = e.id
    LEFT JOIN (
      SELECT event_id, COUNT(*) AS count FROM saves GROUP BY event_id
    ) sc ON sc.event_id = e.id
    WHERE s.user_id = auth.uid()
    ORDER BY has_ended, sort_key
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
  v_is_owner boolean;
BEGIN
  IF NOT can_view_user_events(user_id_param) THEN
    RETURN json_build_object('upcoming_count', 0, 'attended_count', 0, 'saved_count', 0, 'interested_count', 0);
  END IF;

  v_is_owner := (auth.uid() = user_id_param);

  IF v_is_owner THEN
    SELECT COUNT(*) INTO v_saved FROM saves WHERE user_id = user_id_param;
    SELECT COUNT(*) INTO v_interested
    FROM rsvps r JOIN events e ON e.id = r.event_id
    WHERE r.user_id = user_id_param
      AND r.status = 'interested'
      AND e.status = 'active'                                   -- added
      AND NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern);
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern)),
    COUNT(*) FILTER (WHERE event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern))
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
    'interested_count', v_interested
  );
END;
$function$;
