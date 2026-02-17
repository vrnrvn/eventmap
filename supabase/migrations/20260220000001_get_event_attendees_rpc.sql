-- RPC: Get event attendees who have opted to be visible
-- Filters: status = 'going', is_profile_private = false, show_attendance_publicly = true

CREATE OR REPLACE FUNCTION get_event_attendees_public(event_uuid uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'id', p.id,
        'name', p.name,
        'avatar_url', p.avatar_url,
        'bio', LEFT(COALESCE(p.bio, ''), 80)
      )
      ORDER BY r.created_at ASC
    ),
    '[]'::json
  ) INTO result
  FROM rsvps r
  JOIN profiles p ON p.id = r.user_id
  WHERE r.event_id = event_uuid
    AND r.status = 'going'
    AND (p.is_profile_private IS NULL OR p.is_profile_private = false)
    AND (p.show_attendance_publicly IS NULL OR p.show_attendance_publicly = true);

  RETURN result;
END;
$$;

-- RPC: Get a user's upcoming events (RSVP'd "going", start_datetime > now)
-- Client should only call when viewing own profile or when profile.show_future_events = true

CREATE OR REPLACE FUNCTION get_user_upcoming_events(user_id_param uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
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
        'created_at', sub.created_at,
        'updated_at', sub.updated_at,
        'business_name', sub.business_name,
        'business_logo_url', sub.business_logo_url,
        'category_label', sub.category_label,
        'category_slug', sub.category_slug,
        'rsvp_count', sub.rsvp_count,
        'save_count', sub.save_count
      )
      ORDER BY sub.start_datetime ASC
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
      e.cover_image_url,
      e.created_at,
      e.updated_at,
      b.name AS business_name,
      b.logo_url AS business_logo_url,
      c.label AS category_label,
      c.slug AS category_slug,
      (SELECT COUNT(*) FROM rsvps WHERE event_id = e.id AND status = 'going') AS rsvp_count,
      (SELECT COUNT(*) FROM saves WHERE event_id = e.id) AS save_count
    FROM rsvps r
    JOIN events e ON e.id = r.event_id
    JOIN businesses b ON b.id = e.business_id
    JOIN categories c ON c.id = e.category_id
    WHERE r.user_id = user_id_param
      AND r.status = 'going'
      AND e.start_datetime > now()
    ORDER BY e.start_datetime ASC
    LIMIT 20
  ) sub;

  RETURN result;
END;
$$;
