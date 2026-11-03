-- Discovery ranking and card fields (events-flow review Tier 2, 2026-11-02).
--
-- Supersedes the get_ranked_events re-creation in 20261102100000 (apply that
-- one first; this keeps its banned-host exclusion and id tiebreaker).
--
-- Problems addressed:
--
--  1. Ranking was `premium first, then distance, then start, then rsvp`. The
--     hard premium partition meant a promoted event 49 km away outranked a
--     free one 500 m down the road, and because time was only the third key,
--     an event three months out beat tomorrow's if it was marginally closer.
--     Replaced with a weighted score: proximity + imminence + a little
--     popularity, with premium as a bounded boost rather than a partition.
--
--  2. Recurring events were ranked and returned with their original
--     start_datetime, so a weekly event that began months ago sorted last
--     and displayed a stale date. `next_start_datetime` (event_next_occurrence,
--     20261029110000) is now returned and used for ordering and filtering.
--
--  3. Cards could not show capacity: `max_attendees` was not returned, so
--     "3 spots left" / "Full" was impossible in discovery.
--
-- New returned columns (appended, so positional callers are unaffected):
--   next_start_datetime timestamptz, max_attendees integer, has_ended boolean
--
-- Client follow-up once applied: Discover can render spots-left and sort
-- labels off next_start_datetime instead of recomputing occurrences locally.
--
-- Validated on a scratch copy of the local DB; not applied to the shared DB.

DROP FUNCTION IF EXISTS get_ranked_events(float8, float8, float8, uuid[], timestamptz, timestamptz, text, integer, integer);

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
      event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern) AS next_start
    FROM events e
    WHERE e.status = 'active'
      AND e.lat BETWEEN user_lat - v_dlat AND user_lat + v_dlat
      AND e.lng BETWEEN user_lng - v_dlng AND user_lng + v_dlng
      AND NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern)
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

-- Supporting indexes for the new shape of the query.
CREATE INDEX IF NOT EXISTS idx_events_active_start
  ON events (start_datetime)
  WHERE status = 'active';

-- idx_events_status is near-useless (two values) now that every discovery
-- query also filters on the bounding box.
DROP INDEX IF EXISTS idx_events_status;
