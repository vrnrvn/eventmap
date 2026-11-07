-- Discovery query performance (perf review P0 #3, 2026-11-06).
--
-- get_ranked_events is the map/list query. Measured on an isolated copy with
-- 120k events / 480k RSVPs (dense metro: ~19k events within 50 km), one page
-- took ~285 ms, and every page cost the same. The (lat, lng) btree was NOT
-- the problem (bitmap scan ~2 ms; the lng range is checked inside the index).
-- The time went to work done for every in-radius candidate before the sort:
--
--   * COUNT(*) over rsvps per candidate, although event_rsvp_counts
--     (20261102130000, trigger-maintained + backfilled) already holds it;
--   * COUNT(*) over saves per candidate, although save_count is display-only
--     (it is not part of the score);
--   * the cover-photo fallback subquery per candidate (also display-only);
--   * event_next_occurrence() per candidate: plpgsql whose body is wrapped in
--     EXCEPTION WHEN OTHERS, so every call opens a subtransaction, even the
--     trivial non-recurring case that just returns start_datetime;
--   * calculate_distance() per candidate: plpgsql, so it can't be inlined.
--
-- This version scores candidates with the cheap columns only, takes the page
-- (ORDER BY ... LIMIT/OFFSET), and only then fetches the display-only fields
-- for those rows. Same signature, same columns, same filters, same ordering.
-- One-off and recurring candidates are read separately so ended one-off
-- events (which accumulate forever) are skipped inside a partial index.
--
-- Measured (same isolated dataset, dense metro, 50 km, 100 rows/page):
--   before: ~285 ms per page; ~210-260 ms with +300k past events
--   after:  ~80 ms per page;  ~69 ms with +300k past events
-- Sparse areas were already ~1-4 ms and stay there.
--
-- Validated on an isolated Postgres container (not the shared local DB):
-- identical result fingerprints for page 1, page 3, search and sparse-area
-- queries, before vs after.

-- Same formula, same float8 arithmetic (identical results), but a single SQL
-- expression so the planner inlines it instead of calling plpgsql per row.
-- Other caller: send_promotional_notification (benefits the same way).
CREATE OR REPLACE FUNCTION public.calculate_distance(
  lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT 6371 * (2 * atan2(
    sqrt(
      sin(radians(lat2 - lat1) / 2) * sin(radians(lat2 - lat1) / 2)
      + cos(radians(lat1)) * cos(radians(lat2))
        * sin(radians(lng2 - lng1) / 2) * sin(radians(lng2 - lng1) / 2)
    ),
    sqrt(1 - (
      sin(radians(lat2 - lat1) / 2) * sin(radians(lat2 - lat1) / 2)
      + cos(radians(lat1)) * cos(radians(lat2))
        * sin(radians(lng2 - lng1) / 2) * sin(radians(lng2 - lng1) / 2)
    ))
  ));
$function$;

-- Discovery candidates, one index per half of the split in get_ranked_events.
-- (lat is the range boundary; lng and end_datetime are checked inside the
-- index.) Partial on the public/published/active predicate, so drafts,
-- cancelled and unlisted events don't occupy them.
CREATE INDEX IF NOT EXISTS idx_events_discovery_oneoff
  ON public.events (lat, lng, end_datetime)
  WHERE status = 'active' AND publish_state = 'published' AND visibility = 'public' AND NOT is_recurring;
CREATE INDEX IF NOT EXISTS idx_events_discovery_recurring
  ON public.events (lat, lng)
  WHERE status = 'active' AND publish_state = 'published' AND visibility = 'public' AND is_recurring;

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
  user_rsvp text, user_saved boolean, next_start_datetime timestamp with time zone,
  max_attendees integer, has_ended boolean
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
  -- before the exact distance runs. Generous at high latitudes; the exact
  -- distance filter below still applies.
  v_dlat double precision := (v_radius / 111.045);
  v_dlng double precision := (v_radius / GREATEST(111.045 * cos(radians(user_lat)), 0.001));
  v_uid uuid := auth.uid();
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT
      e.id, e.business_id, e.category_id, e.title, e.description,
      e.start_datetime, e.end_datetime, e.lat, e.lng, e.address,
      e.cover_image_url, e.created_at, e.is_recurring, e.recurrence_pattern,
      e.max_attendees,
      calculate_distance(user_lat, user_lng, e.lat, e.lng) AS dist_km,
      -- event_next_occurrence returns start_datetime unchanged unless the
      -- event is recurring, already started and has a pattern; skip the
      -- (subtransaction-opening) plpgsql call in that common case.
      CASE
        WHEN COALESCE(e.is_recurring, false) AND e.start_datetime < now() AND e.recurrence_pattern IS NOT NULL
          THEN event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
        ELSE e.start_datetime
      END AS next_start
    -- Split by is_recurring (NOT NULL, so the halves are exhaustive). For a
    -- one-off, event_has_ended() is exactly end_datetime <= now(), which the
    -- partial index below checks inside the index: past events — the part of
    -- the table that grows forever — are skipped without heap visits.
    FROM (
      SELECT e1.* FROM events e1
      WHERE e1.status = 'active'
        AND e1.publish_state = 'published'
        AND e1.visibility = 'public'
        AND NOT e1.is_recurring
        AND e1.lat BETWEEN user_lat - v_dlat AND user_lat + v_dlat
        AND e1.lng BETWEEN user_lng - v_dlng AND user_lng + v_dlng
        AND e1.end_datetime > now()
      UNION ALL
      SELECT e2.* FROM events e2
      WHERE e2.status = 'active'
        AND e2.publish_state = 'published'
        AND e2.visibility = 'public'
        AND e2.is_recurring
        AND e2.lat BETWEEN user_lat - v_dlat AND user_lat + v_dlat
        AND e2.lng BETWEEN user_lng - v_dlng AND user_lng + v_dlng
        AND NOT event_has_ended(e2.end_datetime, e2.is_recurring, e2.recurrence_pattern, e2.timezone)
    ) e
  ),
  scored AS (
    SELECT
      c.*,
      b.name AS biz_name,
      b.logo_url AS biz_logo,
      b.subscription_tier,
      COALESCE(erc.going_count, 0)::bigint AS going_count,
      (
        -- Proximity: 1.0 at the viewer, decaying to ~0 at the radius edge.
        (1.0 - LEAST(c.dist_km / v_radius, 1.0)) * 1.0
        -- Imminence: full weight today, half at ~3 days, small past a week.
        -- (Hours until the next occurrence; already-running events get 0.)
        + (1.0 / (1.0 + (GREATEST(EXTRACT(EPOCH FROM (c.next_start - now())) / 3600.0, 0) / 72.0))) * 0.8
        -- Popularity: log-damped so a big event can't bury everything nearby.
        + LEAST(ln(1 + COALESCE(erc.going_count, 0)) / 4.0, 1.0) * 0.3
        -- Premium: a real but bounded boost, not a separate tier.
        + CASE WHEN b.subscription_tier = 'premium' THEN 0.25 ELSE 0 END
      ) AS score
    FROM candidate c
    JOIN businesses b ON b.id = c.business_id
    LEFT JOIN event_rsvp_counts erc ON erc.event_id = c.id
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
  ),
  page AS MATERIALIZED (
    -- MATERIALIZED: the page is fixed here, so the display-only lookups in
    -- the final SELECT run for these rows only, never for every candidate.
    SELECT s.*
    FROM scored s
    ORDER BY s.score DESC, s.next_start ASC, s.id
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    p.id,
    p.business_id,
    p.title,
    p.description,
    p.category_id,
    p.start_datetime,
    p.end_datetime,
    p.lat,
    p.lng,
    p.address,
    COALESCE(
      p.cover_image_url,
      (SELECT ep.image_url FROM event_photos ep WHERE ep.event_id = p.id ORDER BY ep.sort_order ASC LIMIT 1)
    ) AS cover_image_url,
    p.created_at,
    p.dist_km AS distance_km,
    (p.subscription_tier = 'premium') AS is_premium,
    p.going_count AS rsvp_count,
    (SELECT COUNT(*) FROM saves sv WHERE sv.event_id = p.id) AS save_count,
    p.biz_name AS business_name,
    p.biz_logo AS business_logo_url,
    cat.label AS category_label,
    cat.slug AS category_slug,
    COALESCE(p.is_recurring, false) AS is_recurring,
    p.recurrence_pattern,
    (SELECT ur.status FROM rsvps ur WHERE ur.event_id = p.id AND ur.user_id = v_uid LIMIT 1) AS user_rsvp,
    EXISTS (SELECT 1 FROM saves us WHERE us.event_id = p.id AND us.user_id = v_uid) AS user_saved,
    p.next_start AS next_start_datetime,
    p.max_attendees,
    false AS has_ended
  FROM page p
  JOIN categories cat ON cat.id = p.category_id
  ORDER BY p.score DESC, p.next_start ASC, p.id;
END;
$function$;
