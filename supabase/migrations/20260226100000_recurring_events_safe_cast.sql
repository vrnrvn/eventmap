-- Safer handling for recurrence_pattern: support both endDate and end_date keys,
-- and use safe cast to avoid errors on malformed dates.

DROP FUNCTION IF EXISTS get_ranked_events(float8, float8, float8, uuid[], timestamptz, timestamptz, text, integer);

CREATE OR REPLACE FUNCTION get_ranked_events(
  user_lat float8,
  user_lng float8,
  radius_km float8 DEFAULT 50,
  category_ids uuid[] DEFAULT NULL,
  start_date timestamptz DEFAULT NULL,
  end_date timestamptz DEFAULT NULL,
  search_query text DEFAULT NULL,
  result_limit integer DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  business_id uuid,
  title text,
  description text,
  category_id uuid,
  start_datetime timestamptz,
  end_datetime timestamptz,
  lat float8,
  lng float8,
  address text,
  cover_image_url text,
  created_at timestamptz,
  distance_km float8,
  is_premium boolean,
  rsvp_count bigint,
  save_count bigint,
  business_name text,
  business_logo_url text,
  category_label text,
  category_slug text,
  is_recurring boolean,
  recurrence_pattern jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    e.recurrence_pattern
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
    (
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
    COALESCE(rsvp_counts.count, 0) DESC
  LIMIT result_limit;
END;
$$;
