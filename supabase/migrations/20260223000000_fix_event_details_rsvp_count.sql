-- Fix rsvp_count and save_count in get_event_details
-- RLS on rsvps/saves restricts SELECT to own rows, so INVOKER only saw 1.
-- Use SECURITY DEFINER so the function can count all rows.
-- Filter rsvp_count by status = 'going' to match attendees list.

CREATE OR REPLACE FUNCTION get_event_details(event_uuid uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'event', row_to_json(e.*),
    'business', row_to_json(b.*),
    'category', row_to_json(c.*),
    'links', COALESCE(
      (SELECT json_agg(row_to_json(el.*) ORDER BY el.sort_order)
       FROM event_links el
       WHERE el.event_id = e.id),
      '[]'::json
    ),
    'photos', COALESCE(
      (SELECT json_agg(row_to_json(ep.*) ORDER BY ep.sort_order)
       FROM event_photos ep
       WHERE ep.event_id = e.id),
      '[]'::json
    ),
    'rsvp_count', (
      SELECT COUNT(*) FROM rsvps WHERE event_id = e.id AND status = 'going'
    ),
    'save_count', (
      SELECT COUNT(*) FROM saves WHERE event_id = e.id
    ),
    'user_rsvp', (
      SELECT status FROM rsvps 
      WHERE event_id = e.id AND user_id = auth.uid()
    ),
    'user_saved', (
      SELECT EXISTS(
        SELECT 1 FROM saves 
        WHERE event_id = e.id AND user_id = auth.uid()
      )
    ),
    'user_following_business', (
      SELECT EXISTS(
        SELECT 1 FROM follows 
        WHERE business_id = b.id AND user_id = auth.uid()
      )
    )
  ) INTO result
  FROM events e
  JOIN businesses b ON b.id = e.business_id
  JOIN categories c ON c.id = e.category_id
  WHERE e.id = event_uuid;
  
  RETURN result;
END;
$$;
