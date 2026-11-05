-- Event zone on saved-event rows (docs/ANALYTICS_AND_CALENDAR_PLAN.md §2.7).
--
-- STATUS: prepared, NOT applied to the shared DB. Validated on an isolated
-- scratch copy (scripts/test-calendar.sql section 5). Depends on
-- 20261103140000 (events.timezone).
--
-- get_user_saved_events is re-created from its live definition (dumped
-- read-only from the shared DB on 2026-11-04) with one change: every row
-- carries 'timezone', so the Saved list and the calendar's list fallback walk
-- zoned series on the event's calendar and can show the event-zone time.
-- Signature and grants are unchanged.

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
