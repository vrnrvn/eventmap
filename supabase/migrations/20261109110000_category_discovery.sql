-- Category-aware discovery (docs/CATEGORIES_AND_SERIES_PLAN.md §3.3, Phase B).
--
-- NOT applied to the shared local database by the author; validated on an
-- isolated scratch copy only. Requires 20261109100000_category_taxonomy.sql
-- (categories.synonyms). Ask the owner before applying; then
-- `npm run backend:types`.
--
-- get_ranked_events, re-created from 20261108110000 with two changes:
--  1. New trailing parameter p_preferred_category_ids uuid[] DEFAULT NULL:
--     events in the viewer's interests get +0.3 score. NULL = no change in
--     ranking, so existing callers get identical results.
--  2. search_query also matches the category label and its synonyms, and is
--     trimmed/lower-cased once.
-- Output columns are unchanged. The 9-argument version is dropped first so
-- PostgREST does not see two overloads for the same named-argument call.

DROP FUNCTION IF EXISTS public.get_ranked_events(double precision, double precision, double precision, uuid[], timestamp with time zone, timestamp with time zone, text, integer, integer);

CREATE OR REPLACE FUNCTION public.get_ranked_events(user_lat double precision, user_lng double precision, radius_km double precision DEFAULT 50, category_ids uuid[] DEFAULT NULL::uuid[], start_date timestamp with time zone DEFAULT NULL::timestamp with time zone, end_date timestamp with time zone DEFAULT NULL::timestamp with time zone, search_query text DEFAULT NULL::text, result_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_preferred_category_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(id uuid, business_id uuid, title text, description text, category_id uuid, start_datetime timestamp with time zone, end_datetime timestamp with time zone, lat double precision, lng double precision, address text, cover_image_url text, created_at timestamp with time zone, distance_km double precision, is_premium boolean, rsvp_count bigint, save_count bigint, business_name text, business_logo_url text, category_label text, category_slug text, is_recurring boolean, recurrence_pattern jsonb, user_rsvp text, user_saved boolean, next_start_datetime timestamp with time zone, max_attendees integer, has_ended boolean)
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
  -- Normalised once: trimmed, lower-cased, NULL when blank.
  v_q text := NULLIF(lower(btrim(search_query)), '');
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
      (b.subscription_tier = 'premium' AND (b.subscription_expires_at IS NULL OR b.subscription_expires_at > now())) AS biz_premium,
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
        + CASE WHEN (b.subscription_tier = 'premium' AND (b.subscription_expires_at IS NULL OR b.subscription_expires_at > now())) THEN 0.25 ELSE 0 END
        -- Viewer interests (profiles.preferred_categories): a boost, never a
        -- filter, so a new user's map is never empty. Sized just above the
        -- premium boost and well under proximity/imminence.
        + CASE WHEN p_preferred_category_ids IS NOT NULL AND c.category_id = ANY(p_preferred_category_ids) THEN 0.3 ELSE 0 END
      ) AS score
    FROM candidate c
    JOIN businesses b ON b.id = c.business_id
    JOIN categories sc ON sc.id = c.category_id
    LEFT JOIN event_rsvp_counts erc ON erc.event_id = c.id
    WHERE c.dist_km <= v_radius
      AND NOT EXISTS (SELECT 1 FROM banned_users bu WHERE bu.user_id = b.owner_id)
      AND (category_ids IS NULL OR c.category_id = ANY(category_ids))
      AND (
        v_q IS NULL
        OR c.title ILIKE '%' || v_q || '%'
        OR c.description ILIKE '%' || v_q || '%'
        OR b.name ILIKE '%' || v_q || '%'
        -- Category words: "music" finds Live Music events, "gig" via synonyms.
        OR sc.label ILIKE '%' || v_q || '%'
        OR v_q = ANY(sc.synonyms)
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
    p.biz_premium AS is_premium,
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
