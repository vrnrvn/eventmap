-- Phase 4, migration 1 — E-R1: the effective next occurrence, everywhere.
--
-- STATUS: PREPARED, NOT APPLIED. Staged in supabase/prepared/; see this
-- folder's README. Apply FIRST among the phase-4 files: migration 3
-- (20261118140000) re-creates get_user_going_events on top of this version.
--
-- The bug (open since 2026-11-09): ranking, the saved/going lists, the
-- calendar and the three collection RPCs compute an event's next date with
-- event_next_occurrence, which ignores per-date exceptions
-- (event_occurrence_exceptions). A skipped or moved date still ranks and
-- renders as the next date unless the client's useEffectiveNextDates happens
-- to correct it.
--
-- The design is docs/MIGRATIONS_PENDING.md §2, decided as option A
-- (an EXISTS guard, benchmarked against a trigger-maintained column on the
-- 120k-event perf fixture; fingerprints identical, worst case 163 ms vs
-- 160 ms, and only the zero-exception case favoured B, by ~2 ms). At each
-- site the existing cheap-path guard is KEPT and the heavy call sits behind
-- a probe of event_occurrence_exceptions, which rides the
-- (event_id, occurrence_date) unique index:
--
--   exceptions exist  -> event_next_effective_occurrence(id, now())
--   recurring + begun -> event_next_occurrence(start, rec, pattern, tz)
--   otherwise         -> start_datetime
--
-- Six functions re-created in full from their live definitions
-- (pg_get_functiondef on a container at 130 migrations), with ONLY the
-- next-date expression changed. get_ranked_events computes next_start once
-- in its CTE and every consumer (score, date filters, ordering, the output
-- column) reads it, so its single rewritten CASE covers what the design
-- counted as two sites. Signatures and output columns are unchanged:
-- NO type regeneration and NO client change.
--
-- After this is applied, the client follow-up B4 (retire useEffectiveNextDates
-- where this makes it dead) becomes possible — docs/MIGRATIONS_PENDING.md 2b-8.

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
        WHEN COALESCE(e.is_recurring, false) AND e.recurrence_pattern IS NOT NULL
             AND EXISTS (SELECT 1 FROM event_occurrence_exceptions oxx WHERE oxx.event_id = e.id)
          THEN event_next_effective_occurrence(e.id, now())
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

CREATE OR REPLACE FUNCTION public.get_user_saved_events(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
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
        'timezone', sub.timezone,                               -- 20261104130000
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
      e.timezone,                                               -- 20261104130000
      e.status,                                                 -- added
      e.created_at, e.updated_at,
      b.name AS business_name,
      b.logo_url AS business_logo_url,
      c.label AS category_label,
      c.slug AS category_slug,
      COALESCE(rc.count, 0) AS rsvp_count,
      COALESCE(sc.count, 0) AS save_count,
      CASE
        WHEN COALESCE(e.is_recurring, false) AND e.recurrence_pattern IS NOT NULL
             AND EXISTS (SELECT 1 FROM event_occurrence_exceptions oxx WHERE oxx.event_id = e.id)
          THEN event_next_effective_occurrence(e.id, now())
        WHEN COALESCE(e.is_recurring, false) AND e.start_datetime < now() AND e.recurrence_pattern IS NOT NULL
          THEN event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
        ELSE e.start_datetime
      END AS next_start_datetime,
      -- A cancelled save sorts with the past ones: it is no longer "coming up".
      (e.status <> 'active'                                     -- changed
        OR event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)) AS has_ended,
      s.created_at AS saved_at,
      -- Upcoming saves soonest-first, then past saves most-recent-first.
      CASE WHEN e.status <> 'active'
             OR event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
        THEN -extract(epoch FROM e.start_datetime)
        ELSE  extract(epoch FROM CASE
        WHEN COALESCE(e.is_recurring, false) AND e.recurrence_pattern IS NOT NULL
             AND EXISTS (SELECT 1 FROM event_occurrence_exceptions oxx WHERE oxx.event_id = e.id)
          THEN event_next_effective_occurrence(e.id, now())
        WHEN COALESCE(e.is_recurring, false) AND e.start_datetime < now() AND e.recurrence_pattern IS NOT NULL
          THEN event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
        ELSE e.start_datetime
      END)
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
      CASE
        WHEN COALESCE(e.is_recurring, false) AND e.recurrence_pattern IS NOT NULL
             AND EXISTS (SELECT 1 FROM event_occurrence_exceptions oxx WHERE oxx.event_id = e.id)
          THEN event_next_effective_occurrence(e.id, now())
        WHEN COALESCE(e.is_recurring, false) AND e.start_datetime < now() AND e.recurrence_pattern IS NOT NULL
          THEN event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
        ELSE e.start_datetime
      END AS next_start_datetime,
      -- Upcoming: whatever happens next comes first (an event already in
      -- progress keeps its past start and therefore leads). Past: most recent first.
      CASE WHEN want_past
        THEN -extract(epoch FROM e.start_datetime)
        ELSE  extract(epoch FROM CASE
        WHEN COALESCE(e.is_recurring, false) AND e.recurrence_pattern IS NOT NULL
             AND EXISTS (SELECT 1 FROM event_occurrence_exceptions oxx WHERE oxx.event_id = e.id)
          THEN event_next_effective_occurrence(e.id, now())
        WHEN COALESCE(e.is_recurring, false) AND e.start_datetime < now() AND e.recurrence_pattern IS NOT NULL
          THEN event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
        ELSE e.start_datetime
      END)
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

CREATE OR REPLACE FUNCTION public.get_user_calendar(p_from timestamp with time zone, p_to timestamp with time zone, p_sources text[] DEFAULT NULL::text[], p_limit integer DEFAULT 300)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 300), 1), 500);
  v_sources text[] := COALESCE(p_sources, ARRAY['going', 'requested', 'interested', 'saved', 'hosting']);
  v_rows json;
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;
  IF p_to - p_from > interval '400 days' THEN
    RAISE EXCEPTION 'range_too_long: at most 400 days';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_sources) s
    WHERE s IS NULL OR s NOT IN ('going', 'requested', 'interested', 'saved', 'hosting', 'collections')  -- 20261112100000
  ) THEN
    RAISE EXCEPTION 'invalid_source';
  END IF;

  WITH mine AS (
    -- RSVP statuses share their names with the sources.
    SELECT r.event_id, r.status AS source
    FROM rsvps r
    WHERE r.user_id = v_uid AND r.status = ANY (v_sources)
    UNION ALL
    SELECT s.event_id, 'saved'
    FROM saves s
    WHERE s.user_id = v_uid AND 'saved' = ANY (v_sources)
    UNION ALL
    SELECT e.id, 'hosting'
    FROM events e
    JOIN businesses b ON b.id = e.business_id
    WHERE b.owner_id = v_uid AND 'hosting' = ANY (v_sources)
    UNION ALL
    -- 20261112100000: every event in any of the caller's collections
    -- (pinned, or a save / RSVP matching a smart collection's categories).
    SELECT ci.event_id, 'collections'
    FROM collection_items ci
    JOIN collections c ON c.id = ci.collection_id
    WHERE c.user_id = v_uid AND 'collections' = ANY (v_sources)
    UNION ALL
    SELECT e.id, 'collections'
    FROM collections c
    JOIN events e ON e.category_id = ANY (c.category_ids)
    WHERE c.user_id = v_uid AND c.kind = 'smart' AND 'collections' = ANY (v_sources)
      AND (EXISTS (SELECT 1 FROM saves s WHERE s.user_id = v_uid AND s.event_id = e.id)
        OR EXISTS (SELECT 1 FROM rsvps r WHERE r.user_id = v_uid AND r.event_id = e.id
                     AND r.status IN ('going', 'interested', 'requested')))
  ),
  grouped AS (
    SELECT m.event_id, array_agg(DISTINCT m.source ORDER BY m.source) AS sources
    FROM mine m
    GROUP BY m.event_id
  ),
  hits AS (
    SELECT e.*, g.sources
    FROM grouped g
    JOIN events e ON e.id = g.event_id
    WHERE COALESCE(e.publish_state, 'published') = 'published'
      AND e.start_datetime <= p_to
      AND CASE
        WHEN COALESCE(e.is_recurring, false) AND e.recurrence_pattern IS NOT NULL THEN
          NOT (
            COALESCE(e.recurrence_pattern->>'endDate', '') ~ '^\d{4}-\d{2}-\d{2}'
            AND left(e.recurrence_pattern->>'endDate', 10)::date
                < (p_from AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'UTC'))::date
          )
        ELSE e.end_datetime >= p_from
      END
    ORDER BY e.start_datetime, e.id
    LIMIT v_limit + 1
  ),
  page AS (
    SELECT * FROM hits ORDER BY start_datetime, id LIMIT v_limit
  )
  SELECT
    COALESCE(json_agg(
      json_build_object(
        'id', p.id,
        'business_id', p.business_id,
        'title', p.title,
        'description', p.description,
        'category_id', p.category_id,
        'start_datetime', p.start_datetime,
        'end_datetime', p.end_datetime,
        'lat', p.lat,
        'lng', p.lng,
        'address', p.address,
        'cover_image_url', COALESCE(
          p.cover_image_url,
          (SELECT ep.image_url FROM event_photos ep WHERE ep.event_id = p.id ORDER BY ep.sort_order ASC LIMIT 1)
        ),
        'is_recurring', COALESCE(p.is_recurring, false),
        'recurrence_pattern', p.recurrence_pattern,
        'timezone', p.timezone,
        'status', p.status,
        'status_note', p.status_note,
        'visibility', p.visibility,
        'max_attendees', p.max_attendees,
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'business_name', b.name,
        'business_logo_url', b.logo_url,
        'category_label', c.label,
        'category_slug', c.slug,
        'sources', p.sources,
        'user_rsvp', (
          SELECT s FROM unnest(p.sources) s
          WHERE s IN ('going', 'requested', 'interested') LIMIT 1
        ),
        'next_start_datetime', CASE
        WHEN COALESCE(p.is_recurring, false) AND p.recurrence_pattern IS NOT NULL
             AND EXISTS (SELECT 1 FROM event_occurrence_exceptions oxx WHERE oxx.event_id = p.id)
          THEN event_next_effective_occurrence(p.id, now())
        WHEN COALESCE(p.is_recurring, false) AND p.start_datetime < now() AND p.recurrence_pattern IS NOT NULL
          THEN event_next_occurrence(p.start_datetime, p.is_recurring, p.recurrence_pattern, p.timezone)
        ELSE p.start_datetime
      END
      )
      ORDER BY p.start_datetime, p.id
    ), '[]'::json),
    (SELECT count(*) FROM hits)
  INTO v_rows, v_count
  FROM page p
  JOIN businesses b ON b.id = p.business_id
  JOIN categories c ON c.id = p.category_id;

  RETURN json_build_object('rows', v_rows, 'truncated', v_count > v_limit);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_collections()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result json;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT COALESCE(
    json_agg(
      json_build_object(
        'id', c.id,
        'name', c.name,
        'kind', c.kind,
        'category_ids', c.category_ids,
        'icon_key', c.icon_key,
        'color', c.color,
        'sort_order', c.sort_order,
        'created_at', c.created_at,
        'updated_at', c.updated_at,
        'item_count', COALESCE(agg.item_count, 0),
        'upcoming_count', COALESCE(agg.upcoming_count, 0),
        'recurring_count', COALESCE(agg.recurring_count, 0),
        'next_start_datetime', agg.next_start,
        'cover_urls', COALESCE(agg.cover_urls, '{}'::text[])
      )
      ORDER BY c.sort_order, c.created_at
    ),
    '[]'::json
  ) INTO result
  FROM collections c
  LEFT JOIN LATERAL (
    SELECT
      count(*) AS item_count,
      count(*) FILTER (WHERE NOT x.ended) AS upcoming_count,
      count(*) FILTER (WHERE NOT x.ended AND COALESCE(e.is_recurring, false)) AS recurring_count,
      min(x.next_start) FILTER (WHERE NOT x.ended) AS next_start,
      (array_agg(x.cover ORDER BY x.ended, x.next_start) FILTER (WHERE x.cover IS NOT NULL))[1:3] AS cover_urls
    FROM collection_members(c.id) m
    JOIN events e ON e.id = m.event_id
    CROSS JOIN LATERAL (
      SELECT
        (e.status <> 'active'
          OR event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)) AS ended,
        CASE
        WHEN COALESCE(e.is_recurring, false) AND e.recurrence_pattern IS NOT NULL
             AND EXISTS (SELECT 1 FROM event_occurrence_exceptions oxx WHERE oxx.event_id = e.id)
          THEN event_next_effective_occurrence(e.id, now())
        WHEN COALESCE(e.is_recurring, false) AND e.start_datetime < now() AND e.recurrence_pattern IS NOT NULL
          THEN event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
        ELSE e.start_datetime
      END AS next_start,
        COALESCE(
          e.cover_image_url,
          (SELECT ep.image_url FROM event_photos ep WHERE ep.event_id = e.id ORDER BY ep.sort_order ASC LIMIT 1)
        ) AS cover
    ) x
  ) agg ON true
  WHERE c.user_id = auth.uid();

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_collection_events(p_collection_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_sort text DEFAULT 'next'::text, p_filter text DEFAULT 'all'::text, p_category_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result json;
  safe_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  safe_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_sort text := COALESCE(p_sort, 'next');
  v_filter text := COALESCE(p_filter, 'all');
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::json;
  END IF;
  IF v_sort NOT IN ('next', 'rsvp', 'added', 'title') THEN
    RAISE EXCEPTION 'Invalid sort %, expected next, rsvp, added or title', v_sort;
  END IF;
  IF v_filter NOT IN ('all', 'upcoming', 'repeating', 'past', 'pinned', 'saved', 'going') THEN
    RAISE EXCEPTION 'Invalid filter %, expected all, upcoming, repeating, past, pinned, saved or going', v_filter;
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
        'timezone', sub.timezone,
        'status', sub.status,
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
        'sources', sub.sources,
        'added_at', sub.added_at,
        'note', sub.note
      )
      ORDER BY sub.ord_group, sub.ord_num, sub.ord_text, sub.ord_date, sub.id
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
      e.timezone,
      e.status,
      e.created_at, e.updated_at,
      b.name AS business_name,
      b.logo_url AS business_logo_url,
      c.label AS category_label,
      c.slug AS category_slug,
      COALESCE(rc.count, 0) AS rsvp_count,
      COALESCE(sc.count, 0) AS save_count,
      x.next_start AS next_start_datetime,
      x.ended AS has_ended,
      m.sources,
      m.added_at,
      m.note,
      -- Upcoming before ended for the date-based sorts; everything else flat.
      CASE WHEN v_sort IN ('next', 'rsvp') THEN x.ended::int ELSE 0 END AS ord_group,
      CASE v_sort
        WHEN 'rsvp'  THEN -COALESCE(rc.count, 0)
        WHEN 'added' THEN -extract(epoch FROM m.added_at)
        ELSE 0
      END AS ord_num,
      CASE WHEN v_sort = 'title' THEN lower(e.title) ELSE '' END AS ord_text,
      -- Shared date key, also the tie-break for the other sorts: upcoming
      -- soonest-first, ended most-recent-first.
      CASE WHEN x.ended THEN -extract(epoch FROM e.start_datetime)
           ELSE extract(epoch FROM x.next_start) END AS ord_date
    FROM collection_members(p_collection_id) m
    JOIN events e ON e.id = m.event_id
    JOIN businesses b ON b.id = e.business_id
    JOIN categories c ON c.id = e.category_id
    LEFT JOIN (
      SELECT event_id, COUNT(*) AS count FROM rsvps WHERE status = 'going' GROUP BY event_id
    ) rc ON rc.event_id = e.id
    LEFT JOIN (
      SELECT event_id, COUNT(*) AS count FROM saves GROUP BY event_id
    ) sc ON sc.event_id = e.id
    CROSS JOIN LATERAL (
      SELECT
        (e.status <> 'active'
          OR event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)) AS ended,
        CASE
        WHEN COALESCE(e.is_recurring, false) AND e.recurrence_pattern IS NOT NULL
             AND EXISTS (SELECT 1 FROM event_occurrence_exceptions oxx WHERE oxx.event_id = e.id)
          THEN event_next_effective_occurrence(e.id, now())
        WHEN COALESCE(e.is_recurring, false) AND e.start_datetime < now() AND e.recurrence_pattern IS NOT NULL
          THEN event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
        ELSE e.start_datetime
      END AS next_start
    ) x
    WHERE (p_category_ids IS NULL OR e.category_id = ANY (p_category_ids))
      AND CASE v_filter
            WHEN 'upcoming'  THEN NOT x.ended
            WHEN 'repeating' THEN NOT x.ended AND COALESCE(e.is_recurring, false)
            WHEN 'past'      THEN x.ended
            WHEN 'pinned'    THEN 'pinned' = ANY (m.sources)
            WHEN 'saved'     THEN 'saved' = ANY (m.sources)
            WHEN 'going'     THEN 'going' = ANY (m.sources)
            ELSE true
          END
    ORDER BY ord_group, ord_num, ord_text, ord_date, e.id
    LIMIT safe_limit
    OFFSET safe_offset
  ) sub;

  RETURN result;
END;
$function$;
