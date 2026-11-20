-- Live events page (roadmap phase 3, decisions owner 2026-11-19):
--   * events IN PROGRESS first, a smaller "starting soon" block after;
--   * tailored to the viewer's interests when possible (a BOOST, never a
--     filter, so thin areas still show whatever is available);
--   * a seeded random sprinkle so the list varies between visits but holds
--     still within one (p_seed = one value per screen visit).
--
-- STATUS: PREPARED, NOT APPLIED. Nothing calls these functions until the
-- client cutover; the client ships first with a ranked-events fallback and
-- probes for this RPC (services/liveEvents.ts), so applying is safe any time.
--
-- Two functions:
--   * event_occurrence_in_progress(): the SQL twin of the client's
--     occurrenceInProgress (utils/occurrences.ts) — which session of a series
--     is running at p_now, honouring moved dates (running at their NEW time,
--     not at the original), cancelled dates, and the pattern's endDate.
--     Held to the client's answers by scripts/test-live-events.sql §parity.
--   * get_live_events(): ranked rows (same columns as get_ranked_events plus
--     occ_start / occ_end / live_status) for everything running now within
--     the radius, then everything starting within p_soon_minutes.

CREATE OR REPLACE FUNCTION public.event_occurrence_in_progress(p_event_id uuid, p_now timestamptz)
RETURNS TABLE (o_start timestamptz, o_end timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  e events%ROWTYPE;
  v_tz text;
  v_start_local timestamp;
  v_duration interval;
  v_end_date date;
  v_day date;
  v_from date;
  v_cand timestamptz;
BEGIN
  SELECT * INTO e FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT COALESCE(e.is_recurring, false) OR e.recurrence_pattern IS NULL THEN
    IF e.start_datetime <= p_now AND p_now < e.end_datetime THEN
      RETURN QUERY SELECT e.start_datetime, e.end_datetime;
    END IF;
    RETURN;
  END IF;

  v_duration := e.end_datetime - e.start_datetime;
  IF v_duration <= interval '0' THEN RETURN; END IF;
  -- The client walks back one duration from now; cap the scan like the
  -- occurrence RPCs do so a corrupt duration cannot make this unbounded.
  v_duration := LEAST(v_duration, interval '31 days');
  v_tz := COALESCE(NULLIF(e.timezone, ''), 'UTC');
  v_start_local := e.start_datetime AT TIME ZONE v_tz;
  IF (e.recurrence_pattern->>'endDate') ~ '^\d{4}-\d{2}-\d{2}' THEN
    v_end_date := left(e.recurrence_pattern->>'endDate', 10)::date;
  END IF;

  -- A moved date runs at its NEW time, whatever day it was generated from
  -- (the client checks these first, from their own rows).
  SELECT x.new_start, x.new_end INTO o_start, o_end
    FROM event_occurrence_exceptions x
   WHERE x.event_id = e.id AND x.kind = 'rescheduled'
     AND x.new_start <= p_now AND p_now < x.new_end
   ORDER BY x.new_start
   LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT o_start, o_end;
    RETURN;
  END IF;

  -- Pattern dates whose [start, start+duration) window can contain p_now:
  -- every local day from (now - duration) to now. The occurrence is built
  -- exactly as event_next_occurrence builds one (local day + local start
  -- time, converted in the event zone), so the two agree across DST.
  v_from := ((p_now - v_duration) AT TIME ZONE v_tz)::date;
  v_day := v_from;
  WHILE v_day <= (p_now AT TIME ZONE v_tz)::date LOOP
    IF v_day >= v_start_local::date
       AND (v_end_date IS NULL OR v_day <= v_end_date)
       AND event_recurrence_matches(v_start_local, e.recurrence_pattern, v_day)
       AND NOT EXISTS (
         SELECT 1 FROM event_occurrence_exceptions x
          WHERE x.event_id = e.id AND x.occurrence_date = v_day)  -- cancelled, or moved away
    THEN
      v_cand := (v_day + v_start_local::time) AT TIME ZONE v_tz;
      IF v_cand <= p_now AND p_now < v_cand + v_duration THEN
        RETURN QUERY SELECT v_cand, v_cand + v_duration;
        RETURN;
      END IF;
    END IF;
    v_day := v_day + 1;
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.event_occurrence_in_progress(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_occurrence_in_progress(uuid, timestamptz) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_live_events(
  user_lat double precision,
  user_lng double precision,
  radius_km double precision DEFAULT 25,
  p_limit integer DEFAULT 30,
  p_soon_minutes integer DEFAULT 60,
  p_preferred_category_ids uuid[] DEFAULT NULL,
  p_seed text DEFAULT NULL
)
RETURNS TABLE (
  id uuid, business_id uuid, title text, description text, category_id uuid,
  start_datetime timestamptz, end_datetime timestamptz,
  lat double precision, lng double precision, address text,
  cover_image_url text, created_at timestamptz, distance_km double precision,
  is_premium boolean, rsvp_count bigint, save_count bigint,
  business_name text, business_logo_url text, category_label text,
  category_slug text, is_recurring boolean, recurrence_pattern jsonb,
  user_rsvp text, user_saved boolean, max_attendees integer,
  occ_start timestamptz, occ_end timestamptz, live_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_radius double precision := LEAST(GREATEST(COALESCE(radius_km, 25), 1), 100);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
  v_soon interval := make_interval(mins => LEAST(GREATEST(COALESCE(p_soon_minutes, 60), 0), 240));
  v_dlat double precision := v_radius / 111.0;
  v_dlng double precision := v_radius / GREATEST(111.0 * cos(radians(user_lat)), 0.01);
BEGIN
  RETURN QUERY
  WITH candidate AS (
    -- Everything in the box that could be running now or starting soon.
    -- One-offs are judged on their own window; series get the occurrence
    -- functions. The ended part of the table is skipped the same way
    -- get_ranked_events skips it.
    SELECT e.*, calculate_distance(user_lat, user_lng, e.lat, e.lng) AS dist_km
      FROM events e
     WHERE e.status = 'active'
       AND e.publish_state = 'published'
       AND e.visibility = 'public'
       AND e.lat BETWEEN user_lat - v_dlat AND user_lat + v_dlat
       AND e.lng BETWEEN user_lng - v_dlng AND user_lng + v_dlng
       AND ((NOT e.is_recurring AND e.end_datetime > now()
               AND e.start_datetime <= now() + v_soon)
            OR (e.is_recurring
               AND NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)))
  ), placed AS (
    -- live: running at now()  ·  soon: first effective start within v_soon
    SELECT c.*, o.o_start, o.o_end, 'live'::text AS l_status
      FROM candidate c
      CROSS JOIN LATERAL event_occurrence_in_progress(c.id, now()) o
     WHERE c.dist_km <= v_radius
    UNION ALL
    SELECT c.*, s.next_start, s.next_start + (c.end_datetime - c.start_datetime), 'soon'::text
      FROM candidate c
      CROSS JOIN LATERAL (
        SELECT CASE WHEN c.is_recurring THEN event_next_effective_occurrence(c.id, now())
                    ELSE c.start_datetime END AS next_start
      ) s
     WHERE c.dist_km <= v_radius
       AND s.next_start > now() AND s.next_start <= now() + v_soon
       -- a series running now is live; do not also list its next date
       AND NOT EXISTS (SELECT 1 FROM event_occurrence_in_progress(c.id, now()))
  ), scored AS (
    SELECT p.*,
           b.name AS biz_name, b.logo_url AS biz_logo,
           (b.subscription_tier = 'premium' AND (b.subscription_expires_at IS NULL OR b.subscription_expires_at > now())) AS biz_premium,
           COALESCE(erc.going_count, 0)::bigint AS going_count,
           (SELECT COUNT(*) FROM saves sv2 WHERE sv2.event_id = p.id)::bigint AS saves_count,
           cat.label AS cat_label, cat.slug AS cat_slug,
           (
             -- Proximity carries the ranking, as on Discover.
             (1.0 - LEAST(p.dist_km / v_radius, 1.0)) * 1.0
             -- Popularity, log-damped.
             + LEAST(ln(1 + COALESCE(erc.going_count, 0)) / 4.0, 1.0) * 0.3
             + CASE WHEN (b.subscription_tier = 'premium' AND (b.subscription_expires_at IS NULL OR b.subscription_expires_at > now())) THEN 0.25 ELSE 0 END
             -- Interests: a boost, never a filter (decision: thin areas
             -- just show what is available).
             + CASE WHEN p_preferred_category_ids IS NOT NULL AND p.category_id = ANY (p_preferred_category_ids) THEN 0.3 ELSE 0 END
             -- The sprinkle: deterministic for one seed, different for the
             -- next visit. Sized to reorder neighbours, not bury proximity.
             + (abs(hashtextextended(p.id::text || COALESCE(p_seed, ''), 42)) % 1000) / 1000.0 * 0.2
           ) AS score
      FROM placed p
      JOIN businesses b ON b.id = p.business_id
      JOIN categories cat ON cat.id = p.category_id
      LEFT JOIN event_rsvp_counts erc ON erc.event_id = p.id
     WHERE NOT EXISTS (SELECT 1 FROM banned_users bu WHERE bu.user_id = b.owner_id)
  )
  SELECT s.id, s.business_id, s.title, s.description, s.category_id,
         s.start_datetime, s.end_datetime, s.lat, s.lng, s.address,
         s.cover_image_url, s.created_at, s.dist_km,
         s.biz_premium, s.going_count, s.saves_count,
         s.biz_name, s.biz_logo, s.cat_label, s.cat_slug,
         s.is_recurring, s.recurrence_pattern,
         (SELECT r.status FROM rsvps r WHERE r.event_id = s.id AND r.user_id = v_uid),
         EXISTS (SELECT 1 FROM saves sv WHERE sv.event_id = s.id AND sv.user_id = v_uid),
         s.max_attendees, s.o_start, s.o_end, s.l_status
    FROM scored s
   ORDER BY (s.l_status = 'live') DESC,
            CASE WHEN s.l_status = 'live' THEN -s.score END,
            s.o_start, s.id
   LIMIT v_limit;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_live_events(double precision, double precision, double precision, integer, integer, uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_live_events(double precision, double precision, double precision, integer, integer, uuid[], text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_live_events(double precision, double precision, double precision, integer, integer, uuid[], text) IS
  'Events running right now within the radius (ranked: proximity, popularity, '
  'premium, viewer interests, a seeded sprinkle), then events starting within '
  'p_soon_minutes ordered by start. Same row shape as get_ranked_events plus '
  'occ_start/occ_end/live_status.';
