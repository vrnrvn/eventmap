-- Run this ENTIRE script in Supabase Dashboard → SQL Editor
-- Fixes: promotional_notifications table + RPC (when migrations couldn't be pushed)
-- Includes: promotion_type, business_id, event_id for "Promote business" and "Promote event"

-- 1. Add data and business_id columns to notifications if missing
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data jsonb;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES businesses(id) ON DELETE SET NULL;

-- 2. Create promotional_notifications table (if not exists)
CREATE TABLE IF NOT EXISTS promotional_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  link_url text,
  target_cities text[],
  target_lat float8,
  target_lng float8,
  target_radius_km float8,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  is_active boolean DEFAULT true NOT NULL
);

-- 3. Add promotion_type, business_id, event_id columns
ALTER TABLE promotional_notifications
  ADD COLUMN IF NOT EXISTS promotion_type text DEFAULT 'generic' NOT NULL,
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES businesses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_promotional_notifications_active ON promotional_notifications(is_active);

ALTER TABLE promotional_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage promotional notifications" ON promotional_notifications;
CREATE POLICY "Admins can manage promotional notifications"
  ON promotional_notifications
  FOR ALL
  TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

-- 4. Update dispatch_push_for_notification to include businessId in push payload
CREATE OR REPLACE FUNCTION dispatch_push_for_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
  v_payload jsonb;
  v_data jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN NEW;
  END IF;

  v_data := jsonb_build_object(
    'notificationId', NEW.id,
    'type', NEW.type,
    'eventId', NEW.event_id,
    'businessId', NEW.business_id
  );
  IF NEW.data IS NOT NULL AND jsonb_typeof(NEW.data) = 'object' THEN
    v_data := v_data || NEW.data;
  END IF;

  FOR v_token IN
    SELECT token
    FROM user_push_tokens
    WHERE user_id = NEW.user_id
      AND is_active = true
  LOOP
    v_payload := jsonb_build_object(
      'to', v_token,
      'title', NEW.title,
      'body', COALESCE(NEW.body, ''),
      'sound', 'default',
      'data', v_data
    );

    EXECUTE
      'SELECT net.http_post(url := $1, headers := $2::jsonb, body := $3::jsonb)'
      USING
        'https://exp.host/--/api/v2/push/send',
        '{"Content-Type":"application/json"}',
        v_payload;
  END LOOP;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NEW;
END;
$$;

-- 5. Create/update send_promotional_notification RPC
CREATE OR REPLACE FUNCTION send_promotional_notification(p_promotion_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promo record;
  v_count integer := 0;
  v_data jsonb;
  v_business_id uuid;
  v_event_id uuid;
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT id, title, body, link_url, target_cities, target_lat, target_lng, target_radius_km,
         promotion_type, business_id, event_id
  INTO v_promo
  FROM promotional_notifications
  WHERE id = p_promotion_id AND is_active = true;

  IF v_promo.id IS NULL THEN
    RAISE EXCEPTION 'Promotion not found or inactive';
  END IF;

  v_business_id := v_promo.business_id;
  v_event_id := v_promo.event_id;
  IF v_event_id IS NOT NULL AND v_business_id IS NULL THEN
    SELECT business_id INTO v_business_id FROM events WHERE id = v_event_id;
  END IF;

  v_data := '{}'::jsonb;
  IF v_event_id IS NOT NULL THEN
    v_data := v_data || jsonb_build_object('eventId', v_event_id::text);
  END IF;
  IF v_business_id IS NOT NULL THEN
    v_data := v_data || jsonb_build_object('businessId', v_business_id::text);
  END IF;
  IF v_promo.link_url IS NOT NULL THEN
    v_data := v_data || jsonb_build_object('linkUrl', v_promo.link_url);
  END IF;

  INSERT INTO notifications (user_id, type, title, body, event_id, business_id, data)
  SELECT
    p.id,
    'promotion',
    v_promo.title,
    v_promo.body,
    v_event_id,
    v_business_id,
    v_data
  FROM profiles p
  WHERE (
    (v_promo.target_cities IS NOT NULL AND array_length(v_promo.target_cities, 1) > 0
     AND (p.city IS NOT NULL AND EXISTS (
       SELECT 1 FROM unnest(v_promo.target_cities) c
       WHERE trim(lower(p.city)) = trim(lower(c))
     )))
    OR
    (v_promo.target_lat IS NOT NULL AND v_promo.target_lng IS NOT NULL AND v_promo.target_radius_km IS NOT NULL
     AND p.lat IS NOT NULL AND p.lng IS NOT NULL
     AND calculate_distance(p.lat, p.lng, v_promo.target_lat, v_promo.target_lng) <= v_promo.target_radius_km)
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
