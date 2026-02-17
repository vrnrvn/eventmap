-- Include all attendees in "Who's Going"; show private users as "Anonymous"
-- rsvp_count already includes everyone. This RPC now returns ALL going attendees,
-- with private users represented as anonymous placeholders.

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
      CASE
        WHEN (p.is_profile_private = true OR p.show_attendance_publicly = false) THEN
          json_build_object(
            'id', 'anon-' || r.user_id::text,
            'name', 'Anonymous',
            'avatar_url', null,
            'bio', null,
            'is_anonymous', true
          )
        ELSE
          json_build_object(
            'id', p.id,
            'name', COALESCE(p.name, 'Anonymous'),
            'avatar_url', p.avatar_url,
            'bio', LEFT(COALESCE(p.bio, ''), 80),
            'is_anonymous', false
          )
      END
      ORDER BY r.created_at ASC
    ),
    '[]'::json
  ) INTO result
  FROM rsvps r
  JOIN profiles p ON p.id = r.user_id
  WHERE r.event_id = event_uuid
    AND r.status = 'going';

  RETURN result;
END;
$$;
