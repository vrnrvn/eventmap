-- Personal calendar, Phase B foundation (docs/ANALYTICS_AND_CALENDAR_PLAN.md §2.4).
--
-- STATUS: prepared, NOT applied to the shared DB. Validated on an isolated
-- scratch copy with scripts/test-calendar.sql. Depends on the 20261103* set
-- (rsvps.status 'requested', events.timezone / publish_state / postponed).
--
-- get_user_calendar(p_from, p_to, p_sources, p_limit) returns the caller's
-- event *series* that can have an occurrence inside [p_from, p_to], in one
-- round trip, tagged with every relationship the caller has to the event:
--
--   going / requested / interested  — the caller's RSVP (requested = waiting
--                                     for host approval, which no list RPC
--                                     returned before)
--   saved                           — the caller saved it
--   hosting                         — the caller owns the event's business
--
-- Occurrences are NOT expanded here: the client keeps the single recurrence
-- implementation (utils/recurrence.ts) and expands the series it gets back.
-- Unlike get_user_going_events, rows carry `timezone` (so zoned series are
-- walked on the event's calendar) and keep cancelled / postponed events with
-- their status (so the calendar can badge them instead of silently dropping
-- a date the user had planned around). Drafts are never returned.
--
-- Shape: { "rows": [...], "truncated": bool }, rows ordered by start.

CREATE OR REPLACE FUNCTION public.get_user_calendar(
  p_from timestamptz,
  p_to timestamptz,
  p_sources text[] DEFAULT ARRAY['going', 'requested', 'interested', 'saved', 'hosting'],
  p_limit integer DEFAULT 300
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    WHERE s IS NULL OR s NOT IN ('going', 'requested', 'interested', 'saved', 'hosting')
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
          -- A series reaches the range unless its inclusive end date (a local
          -- day in the event zone, UTC for legacy rows) is before the first
          -- day of the range in that zone.
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
        'next_start_datetime', event_next_occurrence(p.start_datetime, p.is_recurring, p.recurrence_pattern, p.timezone)
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
$$;

REVOKE ALL ON FUNCTION public.get_user_calendar(timestamptz, timestamptz, text[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_calendar(timestamptz, timestamptz, text[], integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_calendar(timestamptz, timestamptz, text[], integer) TO authenticated;

COMMENT ON FUNCTION public.get_user_calendar(timestamptz, timestamptz, text[], integer) IS
  'Caller''s event series (going / requested / interested / saved / hosting) that can occur in [p_from, p_to]. Client expands occurrences.';
