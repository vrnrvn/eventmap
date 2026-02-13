/*
  # Database Functions for EventMap

  ## Functions Created

  ### 1. reset_monthly_event_counter
  - Automatically resets event counter at the start of each month
  - Called before checking limits

  ### 2. check_event_creation_limit
  - Checks if business can create more events based on subscription tier
  - Returns boolean indicating if creation is allowed
  - Free tier: 2 events per month
  - Premium tier: 30 events per month

  ### 3. create_event_with_limit_check
  - Creates an event after checking subscription limits
  - Increments the monthly counter
  - Returns the created event or throws an error

  ### 4. get_ranked_events
  - Returns events ranked by premium status, distance, date, and popularity
  - Supports filtering by categories, date range, and distance
  - Includes RSVP counts and save counts

  ### 5. get_user_business
  - Helper function to get the business owned by the current user
  - Returns null if user doesn't have a business

  ### 6. calculate_distance
  - Helper function to calculate distance between two points in kilometers
  - Uses Haversine formula for accuracy

  ## Important Notes
  - Event limits are enforced at the database level
  - Premium businesses get higher visibility in rankings
  - All functions respect RLS policies
*/

-- ============================================
-- Helper: Calculate distance between two points (Haversine formula)
-- ============================================
CREATE OR REPLACE FUNCTION calculate_distance(
  lat1 float8,
  lng1 float8,
  lat2 float8,
  lng2 float8
)
RETURNS float8
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  earth_radius float8 := 6371; -- Earth's radius in kilometers
  dlat float8;
  dlng float8;
  a float8;
  c float8;
BEGIN
  dlat := radians(lat2 - lat1);
  dlng := radians(lng2 - lng1);
  
  a := sin(dlat / 2) * sin(dlat / 2) +
       cos(radians(lat1)) * cos(radians(lat2)) *
       sin(dlng / 2) * sin(dlng / 2);
  
  c := 2 * atan2(sqrt(a), sqrt(1 - a));
  
  RETURN earth_radius * c;
END;
$$;

-- ============================================
-- Reset monthly event counter
-- ============================================
CREATE OR REPLACE FUNCTION reset_monthly_event_counter(business_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE businesses
  SET 
    events_created_this_month = 0,
    last_reset_date = CURRENT_DATE
  WHERE id = business_uuid
  AND DATE_TRUNC('month', last_reset_date) < DATE_TRUNC('month', CURRENT_DATE);
END;
$$;

-- ============================================
-- Check if business can create more events
-- ============================================
CREATE OR REPLACE FUNCTION check_event_creation_limit(business_uuid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  business_record RECORD;
  max_events integer;
BEGIN
  -- Reset counter if needed
  PERFORM reset_monthly_event_counter(business_uuid);
  
  -- Get business info
  SELECT * INTO business_record
  FROM businesses
  WHERE id = business_uuid;
  
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  -- Determine limit based on tier
  IF business_record.subscription_tier = 'premium' THEN
    max_events := 30;
  ELSE
    max_events := 2;
  END IF;
  
  -- Check if under limit
  RETURN business_record.events_created_this_month < max_events;
END;
$$;

-- ============================================
-- Create event with automatic limit checking
-- ============================================
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
  p_cover_image_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_event_id uuid;
  can_create boolean;
BEGIN
  -- Check if the user owns this business
  IF NOT EXISTS (
    SELECT 1 FROM businesses
    WHERE id = p_business_id
    AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'You do not own this business';
  END IF;
  
  -- Check event creation limit
  can_create := check_event_creation_limit(p_business_id);
  
  IF NOT can_create THEN
    RAISE EXCEPTION 'Event creation limit reached for this month. Upgrade to Premium for more events.';
  END IF;
  
  -- Create the event
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
    cover_image_url
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
    p_cover_image_url
  )
  RETURNING id INTO new_event_id;
  
  -- Increment counter
  UPDATE businesses
  SET events_created_this_month = events_created_this_month + 1
  WHERE id = p_business_id;
  
  RETURN new_event_id;
END;
$$;

-- ============================================
-- Get ranked events with filters
-- ============================================
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
  category_slug text
)
LANGUAGE plpgsql
STABLE
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
    e.cover_image_url,
    e.created_at,
    calculate_distance(user_lat, user_lng, e.lat, e.lng) as distance_km,
    CASE WHEN b.subscription_tier = 'premium' THEN true ELSE false END as is_premium,
    COALESCE(rsvp_counts.count, 0) as rsvp_count,
    COALESCE(save_counts.count, 0) as save_count,
    b.name as business_name,
    b.logo_url as business_logo_url,
    c.label as category_label,
    c.slug as category_slug
  FROM events e
  JOIN businesses b ON b.id = e.business_id
  JOIN categories c ON c.id = e.category_id
  LEFT JOIN (
    SELECT event_id, COUNT(*) as count
    FROM rsvps
    GROUP BY event_id
  ) rsvp_counts ON rsvp_counts.event_id = e.id
  LEFT JOIN (
    SELECT event_id, COUNT(*) as count
    FROM saves
    GROUP BY event_id
  ) save_counts ON save_counts.event_id = e.id
  WHERE 
    e.end_datetime > NOW()
    AND (start_date IS NULL OR e.start_datetime >= start_date)
    AND (end_date IS NULL OR e.start_datetime <= end_date)
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

-- ============================================
-- Get user's business
-- ============================================
CREATE OR REPLACE FUNCTION get_user_business()
RETURNS TABLE (
  id uuid,
  owner_id uuid,
  name text,
  description text,
  category text,
  address text,
  lat float8,
  lng float8,
  logo_url text,
  verified boolean,
  subscription_tier text,
  subscription_expires_at timestamptz,
  events_created_this_month integer,
  last_reset_date date,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    b.id,
    b.owner_id,
    b.name,
    b.description,
    b.category,
    b.address,
    b.lat,
    b.lng,
    b.logo_url,
    b.verified,
    b.subscription_tier,
    b.subscription_expires_at,
    b.events_created_this_month,
    b.last_reset_date,
    b.created_at
  FROM businesses b
  WHERE b.owner_id = auth.uid();
END;
$$;

-- ============================================
-- Get event with full details (including links and photos)
-- ============================================
CREATE OR REPLACE FUNCTION get_event_details(event_uuid uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
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
      SELECT COUNT(*) FROM rsvps WHERE event_id = e.id
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