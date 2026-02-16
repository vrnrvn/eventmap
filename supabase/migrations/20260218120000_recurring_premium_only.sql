-- Recurring events are premium-only. Reject recurring event creation for free tier.
CREATE OR REPLACE FUNCTION create_event_with_limit_check(
  p_business_id uuid,
  p_title text,
  p_description text,
  p_category_id uuid,
  p_start_datetime timestamptz,
  p_end_datetime timestamptz,
  p_lat float8,
  p_lng float8,
  p_address text,
  p_cover_image_url text DEFAULT NULL,
  p_is_recurring boolean DEFAULT false,
  p_recurrence_pattern jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_event_id uuid;
  can_create boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM businesses
    WHERE id = p_business_id
    AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'You do not own this business';
  END IF;

  -- Recurring events require premium subscription
  IF p_is_recurring AND NOT EXISTS (
    SELECT 1 FROM businesses
    WHERE id = p_business_id
    AND subscription_tier = 'premium'
  ) THEN
    RAISE EXCEPTION 'Recurring events are only available for Premium businesses. Upgrade to create recurring events.';
  END IF;

  can_create := check_event_creation_limit(p_business_id);

  IF NOT can_create THEN
    RAISE EXCEPTION 'Event creation limit reached for this month. Upgrade to Premium for more events.';
  END IF;

  INSERT INTO events (
    business_id,
    title,
    description,
    category_id,
    start_datetime,
    end_datetime,
    lat,
    lng,
    address,
    cover_image_url,
    is_recurring,
    recurrence_pattern
  ) VALUES (
    p_business_id,
    p_title,
    p_description,
    p_category_id,
    p_start_datetime,
    p_end_datetime,
    p_lat,
    p_lng,
    p_address,
    p_cover_image_url,
    COALESCE(p_is_recurring, false),
    p_recurrence_pattern
  )
  RETURNING id INTO new_event_id;

  UPDATE businesses
  SET events_created_this_month = events_created_this_month + 1
  WHERE id = p_business_id;

  RETURN new_event_id;
END;
$$;
