-- Cancelled soft state for events (DB groundwork; client wiring pending).
--
-- Deleting an event hard-cascades and strands attendees with no notice. This
-- adds an 'active'/'cancelled' status, a cancel_event RPC that notifies all
-- going/interested attendees (same pattern as notify_rsvp_users_on_event_update
-- in 20260227000000), hides cancelled events from non-owners, and keeps them
-- out of discovery (get_ranked_events) and out of new RSVPs.
--
-- The client delete flow stays as-is for now (tracked in docs/ISSUES.md).

-- -----------------------------
-- 1. Schema
-- -----------------------------
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

-- -----------------------------
-- 2. cancel_event RPC
-- -----------------------------
CREATE OR REPLACE FUNCTION cancel_event(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event events%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  IF NOT (
    EXISTS (
      SELECT 1 FROM businesses b
      WHERE b.id = v_event.business_id
        AND b.owner_id = auth.uid()
    )
    OR is_admin_user()
  ) THEN
    RAISE EXCEPTION 'not_allowed: only the event owner can cancel this event';
  END IF;

  IF v_event.status = 'cancelled' THEN
    RETURN; -- already cancelled, nothing to do
  END IF;

  UPDATE events SET status = 'cancelled' WHERE id = p_event_id;

  -- Notify every going/interested attendee (not the owner), honoring the same
  -- notification preference as other event-change notifications.
  INSERT INTO notifications (user_id, type, title, body, event_id)
  SELECT
    r.user_id,
    'event_update',
    'Event cancelled',
    '"' || COALESCE(v_event.title, 'Event') || '" has been cancelled by the organizer.',
    v_event.id
  FROM rsvps r
  JOIN profiles p ON p.id = r.user_id
  WHERE r.event_id = v_event.id
    AND r.status IN ('going', 'interested')
    AND r.user_id != (SELECT owner_id FROM businesses WHERE id = v_event.business_id)
    AND COALESCE((p.notification_preferences->>'event_update')::boolean, true) = true;
END;
$$;

REVOKE EXECUTE ON FUNCTION cancel_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cancel_event(uuid) TO authenticated, service_role;

-- -----------------------------
-- 3. Hide cancelled events from non-owners
-- -----------------------------
-- Owners keep full visibility via "Business owners can view their own events"
-- (20261030105000); admins via "Admins can view all events including past".
DROP POLICY IF EXISTS "Anyone can view upcoming events" ON events;
DROP POLICY IF EXISTS "Anyone can view active upcoming events" ON events;
CREATE POLICY "Anyone can view active upcoming events"
  ON events FOR SELECT
  TO public
  USING (status = 'active' AND end_datetime > now());

-- -----------------------------
-- 4. Cancelled events are closed for RSVPs
-- -----------------------------
CREATE OR REPLACE FUNCTION event_is_open_for_rsvp(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = p_event_id
      AND e.status = 'active'
      AND NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern)
  );
$$;

-- -----------------------------
-- 5. get_ranked_events: exclude cancelled
-- -----------------------------
-- Re-creation of the current definition (20260226100000) with the status
-- filter added; the signature is unchanged.
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
    e.status = 'active'
    AND (
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
