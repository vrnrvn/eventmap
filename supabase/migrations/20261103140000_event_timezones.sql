-- Phase 2: time zones (plan §4D).
--
-- STATUS: prepared, NOT applied to the shared local DB (another dev session
-- owns it). Validated on an isolated scratch copy only. Apply after
-- 20261103130000_event_settings_and_announcements.sql.
--
-- Model: events keep their timestamptz instants and gain `timezone` (IANA id,
-- nullable). NULL means "created before this existed": the client renders the
-- instant in the viewer's zone exactly as today, and the server computes
-- calendar days in UTC exactly as today. Hosts are nudged to set a zone when
-- they next edit; new events get the device zone from the form.
--
-- Why the server cares: `event_has_ended` compared the recurrence end date
-- with CURRENT_DATE (server zone) and `event_next_occurrence` stepped whole
-- UTC days, so a weekly 7 pm Lisbon class drifted to 6 pm / 8 pm across DST
-- and "ended" a day early or late. With a zone, days are stepped on the
-- event's wall clock and compared with the event's local date.
--
--   1. events.timezone + validation trigger (is_valid_time_zone)
--   2. event_has_ended / event_next_occurrence gain a 4th arg (zone). The
--      3-arg forms stay and delegate with NULL (= UTC, today's behaviour) so
--      nothing breaks before callers are updated.
--   3. Callers updated to pass e.timezone: public SELECT policy,
--      get_ranked_events, get_user_going_events, get_user_saved_events,
--      get_user_attendance_counts (bodies identical to their latest versions
--      apart from the extra argument), event_is_open_for_rsvp.
--   4. create_event_with_limit_check gains p_timezone (13-arg form dropped).

-- 1. Column + validation --------------------------------------------------------

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS timezone text;

CREATE OR REPLACE FUNCTION public.is_valid_time_zone(p_tz text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
  IF p_tz IS NULL OR btrim(p_tz) = '' THEN RETURN false; END IF;
  -- Named zones only (they carry DST rules); refuse "+02:00" and bare abbreviations.
  IF p_tz <> 'UTC' AND p_tz !~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)+$' THEN RETURN false; END IF;
  PERFORM timezone(p_tz, '2000-01-01 00:00:00+00'::timestamptz);
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_event_timezone()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.timezone IS NOT NULL AND NOT is_valid_time_zone(NEW.timezone) THEN
    RAISE EXCEPTION 'invalid_timezone: % is not an IANA zone', NEW.timezone;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS c_validate_event_timezone ON events;
CREATE TRIGGER c_validate_event_timezone
  BEFORE INSERT OR UPDATE OF timezone ON events
  FOR EACH ROW
  EXECUTE FUNCTION validate_event_timezone();

-- 2. Zone-aware helpers ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.event_has_ended(
  p_end_datetime timestamptz,
  p_is_recurring boolean,
  p_recurrence_pattern jsonb,
  p_timezone text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN NOT COALESCE(p_is_recurring, false) THEN p_end_datetime <= now()
    WHEN COALESCE(p_recurrence_pattern->>'endDate', '') ~ '^\d{4}-\d{2}-\d{2}'
      -- Compare on the event's local calendar day (UTC when no zone is set).
      THEN left(p_recurrence_pattern->>'endDate', 10)::date
           < (now() AT TIME ZONE COALESCE(NULLIF(p_timezone, ''), 'UTC'))::date
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.event_has_ended(
  p_end_datetime timestamptz,
  p_is_recurring boolean,
  p_recurrence_pattern jsonb
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT event_has_ended(p_end_datetime, p_is_recurring, p_recurrence_pattern, NULL::text);
$function$;

CREATE OR REPLACE FUNCTION public.event_next_occurrence(
  p_start_datetime timestamptz,
  p_is_recurring boolean,
  p_recurrence_pattern jsonb,
  p_timezone text
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_tz text := COALESCE(NULLIF(p_timezone, ''), 'UTC');
  v_freq text;
  v_step integer;
  v_start_local timestamp;   -- wall clock in v_tz
  v_now_local timestamp;
  v_elapsed_steps numeric;
  v_candidate_local timestamp;
  v_months integer;
BEGIN
  IF NOT COALESCE(p_is_recurring, false) OR p_start_datetime >= now() OR p_recurrence_pattern IS NULL THEN
    RETURN p_start_datetime;
  END IF;

  v_freq := p_recurrence_pattern->>'frequency';
  v_step := GREATEST(COALESCE(NULLIF(p_recurrence_pattern->>'interval', '')::integer, 1), 1);

  -- Step on the wall clock so 19:00 stays 19:00 across DST, then convert back.
  v_start_local := p_start_datetime AT TIME ZONE v_tz;
  v_now_local := now() AT TIME ZONE v_tz;

  IF v_freq = 'daily' OR v_freq = 'weekly' THEN
    IF v_freq = 'weekly' THEN
      v_step := v_step * 7;
    END IF;
    v_elapsed_steps := ceil(extract(epoch FROM (v_now_local - v_start_local)) / (86400.0 * v_step));
    v_candidate_local := v_start_local + (v_elapsed_steps * v_step) * interval '1 day';
    -- Guard: a candidate still in the past (rounding at the boundary) moves one step on.
    WHILE v_candidate_local < v_now_local LOOP
      v_candidate_local := v_candidate_local + v_step * interval '1 day';
    END LOOP;
    RETURN v_candidate_local AT TIME ZONE v_tz;
  ELSIF v_freq = 'monthly' THEN
    v_months := (extract(year FROM v_now_local)::integer - extract(year FROM v_start_local)::integer) * 12
              + (extract(month FROM v_now_local)::integer - extract(month FROM v_start_local)::integer);
    v_months := GREATEST(v_months, 0);
    v_months := v_months - (v_months % v_step);
    v_candidate_local := v_start_local + (v_months * interval '1 month');
    WHILE v_candidate_local < v_now_local LOOP
      v_candidate_local := v_candidate_local + (v_step * interval '1 month');
    END LOOP;
    RETURN v_candidate_local AT TIME ZONE v_tz;
  END IF;

  RETURN p_start_datetime;
EXCEPTION WHEN OTHERS THEN
  RETURN p_start_datetime;
END;
$function$;

CREATE OR REPLACE FUNCTION public.event_next_occurrence(
  p_start_datetime timestamptz,
  p_is_recurring boolean,
  p_recurrence_pattern jsonb
)
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $function$
  SELECT event_next_occurrence(p_start_datetime, p_is_recurring, p_recurrence_pattern, NULL::text);
$function$;

-- 3. Callers ---------------------------------------------------------------------

DROP POLICY IF EXISTS "Anyone can view active upcoming events" ON events;
CREATE POLICY "Anyone can view active upcoming events"
  ON events
  FOR SELECT
  USING (
    status = 'active'
    AND NOT event_has_ended(end_datetime, is_recurring, recurrence_pattern, timezone)
  );

CREATE OR REPLACE FUNCTION public.event_is_open_for_rsvp(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = p_event_id
      AND e.status = 'active'
      AND NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
  );
$function$;

-- get_ranked_events: body identical to 20261102140000 apart from `e.timezone`.
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
  user_rsvp text, user_saved boolean,
  next_start_datetime timestamp with time zone, max_attendees integer, has_ended boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- Clamp so a client can't ask for the whole table in one call.
  v_limit integer := LEAST(GREATEST(COALESCE(result_limit, 100), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_radius double precision := GREATEST(COALESCE(radius_km, 50), 0.1);
  -- Degree deltas for a cheap bounding box, so idx_events_lat_lng can be used
  -- before the (much more expensive) haversine runs. Generous at high
  -- latitudes; the exact distance filter below still applies.
  v_dlat double precision := (v_radius / 111.045);
  v_dlng double precision := (v_radius / GREATEST(111.045 * cos(radians(user_lat)), 0.001));
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT
      e.*,
      calculate_distance(user_lat, user_lng, e.lat, e.lng) AS dist_km,
      event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern, e.timezone) AS next_start
    FROM events e
    WHERE e.status = 'active'
      AND e.lat BETWEEN user_lat - v_dlat AND user_lat + v_dlat
      AND e.lng BETWEEN user_lng - v_dlng AND user_lng + v_dlng
      AND NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
  ),
  scored AS (
    SELECT
      c.*,
      b.name AS biz_name,
      b.logo_url AS biz_logo,
      b.subscription_tier,
      cat.label AS cat_label,
      cat.slug AS cat_slug,
      COALESCE(rc.count, 0) AS going_count,
      COALESCE(sc.count, 0) AS saves_count,
      -- Hours until the next occurrence; already-running events get 0.
      GREATEST(EXTRACT(EPOCH FROM (c.next_start - now())) / 3600.0, 0) AS hours_away
    FROM candidate c
    JOIN businesses b ON b.id = c.business_id
    JOIN categories cat ON cat.id = c.category_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS count FROM rsvps r
      WHERE r.event_id = c.id AND r.status = 'going'
    ) rc ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS count FROM saves s WHERE s.event_id = c.id
    ) sc ON true
    WHERE c.dist_km <= v_radius
      AND NOT EXISTS (SELECT 1 FROM banned_users bu WHERE bu.user_id = b.owner_id)
      AND (category_ids IS NULL OR c.category_id = ANY(category_ids))
      AND (
        search_query IS NULL
        OR c.title ILIKE '%' || search_query || '%'
        OR c.description ILIKE '%' || search_query || '%'
        OR b.name ILIKE '%' || search_query || '%'
      )
      -- Date filter. One-offs: the next (only) occurrence must fall inside the
      -- window. Recurring: the series must overlap the window — its next
      -- occurrence may be before the window (e.g. a daily event when the
      -- user picks "this weekend") while later ones fall inside it, so we
      -- test overlap here and let the client's filterEventsByDateRange pick
      -- the exact occurrences.
      AND (
        (NOT COALESCE(c.is_recurring, false)
          AND (start_date IS NULL OR c.next_start >= start_date)
          AND (end_date IS NULL OR c.next_start <= end_date))
        OR
        (COALESCE(c.is_recurring, false)
          AND (end_date IS NULL OR c.next_start <= end_date)
          AND (
            start_date IS NULL
            OR (c.recurrence_pattern->>'endDate') IS NULL
            OR (c.recurrence_pattern->>'endDate') !~ '^\d{4}-\d{2}-\d{2}'
            OR left(c.recurrence_pattern->>'endDate', 10)::date >= start_date::date
          ))
      )
  )
  SELECT
    s.id,
    s.business_id,
    s.title,
    s.description,
    s.category_id,
    s.start_datetime,
    s.end_datetime,
    s.lat,
    s.lng,
    s.address,
    COALESCE(
      s.cover_image_url,
      (SELECT ep.image_url FROM event_photos ep WHERE ep.event_id = s.id ORDER BY ep.sort_order ASC LIMIT 1)
    ) AS cover_image_url,
    s.created_at,
    s.dist_km AS distance_km,
    (s.subscription_tier = 'premium') AS is_premium,
    s.going_count AS rsvp_count,
    s.saves_count AS save_count,
    s.biz_name AS business_name,
    s.biz_logo AS business_logo_url,
    s.cat_label AS category_label,
    s.cat_slug AS category_slug,
    COALESCE(s.is_recurring, false) AS is_recurring,
    s.recurrence_pattern,
    (SELECT ur.status FROM rsvps ur WHERE ur.event_id = s.id AND ur.user_id = auth.uid() LIMIT 1) AS user_rsvp,
    EXISTS (SELECT 1 FROM saves us WHERE us.event_id = s.id AND us.user_id = auth.uid()) AS user_saved,
    s.next_start AS next_start_datetime,
    s.max_attendees,
    false AS has_ended
  FROM scored s
  ORDER BY
    (
      -- Proximity: 1.0 at the viewer, decaying to ~0 at the radius edge.
      (1.0 - LEAST(s.dist_km / v_radius, 1.0)) * 1.0
      -- Imminence: full weight today, half at ~3 days, small past a week.
      + (1.0 / (1.0 + (s.hours_away / 72.0))) * 0.8
      -- Popularity: log-damped so a big event can't bury everything nearby.
      + LEAST(ln(1 + s.going_count) / 4.0, 1.0) * 0.3
      -- Premium: a real but bounded boost, not a separate tier.
      + CASE WHEN s.subscription_tier = 'premium' THEN 0.25 ELSE 0 END
    ) DESC,
    s.next_start ASC,
    s.id
  LIMIT v_limit
  OFFSET v_offset;
END;
$function$;

-- Attendance RPCs: bodies identical to 20261102100000 apart from `e.timezone`.
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
      AND r.status = CASE WHEN p_scope = 'interested' THEN 'interested' ELSE 'going' END
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
      event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern, e.timezone) AS next_start_datetime,
      -- A cancelled save sorts with the past ones: it is no longer "coming up".
      (e.status <> 'active'                                     -- changed
        OR event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)) AS has_ended,
      s.created_at AS saved_at,
      -- Upcoming saves soonest-first, then past saves most-recent-first.
      CASE WHEN e.status <> 'active'
             OR event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
        THEN -extract(epoch FROM e.start_datetime)
        ELSE  extract(epoch FROM event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern, e.timezone))
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
    'interested_count', v_interested
  );
END;
$function$;

-- 4. Capacity + zone at creation --------------------------------------------------

DROP FUNCTION IF EXISTS public.create_event_with_limit_check(
  uuid, text, text, uuid, timestamptz, timestamptz, double precision, double precision, text, text, boolean, jsonb, integer
);

-- Body identical to 20261103120000 apart from the '-- added (tz)' lines.
CREATE OR REPLACE FUNCTION public.create_event_with_limit_check(
  p_business_id uuid,
  p_title text,
  p_description text,
  p_category_id uuid,
  p_start_datetime timestamp with time zone,
  p_end_datetime timestamp with time zone,
  p_lat double precision,
  p_lng double precision,
  p_address text,
  p_cover_image_url text DEFAULT NULL::text,
  p_is_recurring boolean DEFAULT false,
  p_recurrence_pattern jsonb DEFAULT NULL::jsonb,
  p_max_attendees integer DEFAULT NULL::integer,
  p_timezone text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_event_id uuid;
  can_create boolean;
  v_business businesses%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF user_is_banned(auth.uid()) THEN                              -- added
    RAISE EXCEPTION 'not_allowed: account suspended';
  END IF;

  -- Lock the business row: the limit check and the counter increment below
  -- are now serialized across concurrent calls.                 -- added
  SELECT * INTO v_business
  FROM businesses
  WHERE id = p_business_id AND owner_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You do not own this business';
  END IF;

  -- Basic shape checks the table doesn't enforce.                -- added
  IF length(btrim(COALESCE(p_title, ''))) = 0 THEN
    RAISE EXCEPTION 'invalid_title: title is required';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN
    RAISE EXCEPTION 'invalid_location: coordinates out of range';
  END IF;
  IF p_end_datetime <= p_start_datetime THEN
    RAISE EXCEPTION 'invalid_dates: end must be after start';
  END IF;
  IF p_max_attendees IS NOT NULL AND p_max_attendees <= 0 THEN                -- added
    RAISE EXCEPTION 'invalid_capacity: must be a positive number';
  END IF;
  IF p_timezone IS NOT NULL AND NOT is_valid_time_zone(p_timezone) THEN       -- added (tz)
    RAISE EXCEPTION 'invalid_timezone';
  END IF;
  IF COALESCE(p_is_recurring, false) AND p_recurrence_pattern IS NULL THEN
    RAISE EXCEPTION 'invalid_recurrence: recurring events need a pattern';
  END IF;

  -- Recurring events require premium subscription
  IF COALESCE(p_is_recurring, false) AND v_business.subscription_tier <> 'premium' THEN
    RAISE EXCEPTION 'Recurring events are only available for Premium businesses. Upgrade to create recurring events.';
  END IF;

  can_create := check_event_creation_limit(p_business_id);

  IF NOT can_create THEN
    RAISE EXCEPTION 'Event creation limit reached for this month. Upgrade to Premium for more events.';
  END IF;

  INSERT INTO events (
    business_id,
    title,
    description,
    category_id,
    start_datetime,
    end_datetime,
    lat,
    lng,
    address,
    cover_image_url,
    is_recurring,
    recurrence_pattern,
    max_attendees,
    timezone
  ) VALUES (
    p_business_id,
    btrim(p_title),
    COALESCE(p_description, ''),
    p_category_id,
    p_start_datetime,
    p_end_datetime,
    p_lat,
    p_lng,
    COALESCE(p_address, ''),
    p_cover_image_url,
    COALESCE(p_is_recurring, false),
    p_recurrence_pattern,
    p_max_attendees,
    p_timezone
  )
  RETURNING id INTO new_event_id;

  UPDATE businesses
  SET events_created_this_month = events_created_this_month + 1
  WHERE id = p_business_id;

  RETURN new_event_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_event_with_limit_check(
  uuid, text, text, uuid, timestamptz, timestamptz, double precision, double precision, text, text, boolean, jsonb, integer, text
) TO authenticated;
