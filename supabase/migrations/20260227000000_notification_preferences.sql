-- Notification preferences, promotional notifications, event reminders
-- Schema: profiles, businesses, promotional_notifications, event_reminder_sent
-- Triggers: preference checks, event_update, dispatch with data column

-- -----------------------------
-- 1. Schema: profiles
-- -----------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notification_preferences jsonb DEFAULT '{"new_follower":true,"new_event_from_followed":true,"event_update":true,"rsvp":true,"nearby_event":true}'::jsonb,
  ADD COLUMN IF NOT EXISTS event_reminder_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS event_reminder_minutes integer DEFAULT 60;

-- -----------------------------
-- 2. Schema: businesses
-- -----------------------------
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS notifications_enabled boolean DEFAULT true;

-- -----------------------------
-- 3. Schema: notifications - add data column for extra push payload
-- -----------------------------
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS data jsonb;

-- -----------------------------
-- 4. promotional_notifications table
-- -----------------------------
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

CREATE INDEX IF NOT EXISTS idx_promotional_notifications_active ON promotional_notifications(is_active);

ALTER TABLE promotional_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage promotional notifications"
  ON promotional_notifications
  FOR ALL
  TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

-- -----------------------------
-- 5. event_reminder_sent table (idempotency)
-- -----------------------------
CREATE TABLE IF NOT EXISTS event_reminder_sent (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reminder_minutes integer NOT NULL,
  sent_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (event_id, user_id, reminder_minutes)
);

-- -----------------------------
-- 6. Update dispatch_push to merge data column
-- -----------------------------
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
    'eventId', NEW.event_id
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

-- -----------------------------
-- 7. Modified: notify_business_on_new_follower (with preference checks)
-- -----------------------------
CREATE OR REPLACE FUNCTION notify_business_on_new_follower()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
  v_follower_name text;
  v_biz_notifications boolean;
  v_owner_pref boolean;
BEGIN
  SELECT b.owner_id, COALESCE(b.notifications_enabled, true)
  INTO v_owner_id, v_biz_notifications
  FROM businesses b
  WHERE b.id = NEW.business_id;

  IF v_owner_id IS NULL OR v_owner_id = NEW.user_id OR NOT v_biz_notifications THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(
    (p.notification_preferences->>'new_follower')::boolean,
    true
  ) INTO v_owner_pref
  FROM profiles p
  WHERE p.id = v_owner_id;

  IF NOT v_owner_pref THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.name, 'Someone')
  INTO v_follower_name
  FROM profiles p
  WHERE p.id = NEW.user_id;

  INSERT INTO notifications (user_id, type, title, body, business_id)
  VALUES (
    v_owner_id,
    'new_follower',
    'You have a new follower',
    v_follower_name || ' started following your business.',
    NEW.business_id
  );

  RETURN NEW;
END;
$$;

-- -----------------------------
-- 8. Modified: notify_business_on_rsvp (with preference checks)
-- -----------------------------
CREATE OR REPLACE FUNCTION notify_business_on_rsvp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
  v_event_title text;
  v_actor_name text;
  v_status text;
  v_biz_notifications boolean;
  v_owner_pref boolean;
BEGIN
  SELECT b.owner_id, e.title, COALESCE(b.notifications_enabled, true)
  INTO v_owner_id, v_event_title, v_biz_notifications
  FROM events e
  JOIN businesses b ON b.id = e.business_id
  WHERE e.id = NEW.event_id;

  IF v_owner_id IS NULL OR v_owner_id = NEW.user_id OR NOT v_biz_notifications THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(
    (p.notification_preferences->>'rsvp')::boolean,
    true
  ) INTO v_owner_pref
  FROM profiles p
  WHERE p.id = v_owner_id;

  IF NOT v_owner_pref THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.name, 'Someone')
  INTO v_actor_name
  FROM profiles p
  WHERE p.id = NEW.user_id;

  v_status := CASE NEW.status
    WHEN 'going' THEN 'is going to'
    WHEN 'interested' THEN 'is interested in'
    ELSE 'responded to'
  END;

  INSERT INTO notifications (user_id, type, title, body, event_id)
  VALUES (
    v_owner_id,
    'rsvp',
    'New RSVP on your event',
    v_actor_name || ' ' || v_status || ' "' || COALESCE(v_event_title, 'your event') || '".',
    NEW.event_id
  );

  RETURN NEW;
END;
$$;

-- -----------------------------
-- 9. Modified: notify_followers_on_new_event (with preference checks)
-- -----------------------------
CREATE OR REPLACE FUNCTION notify_followers_on_new_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notifications (user_id, type, title, body, event_id, business_id)
  SELECT
    f.user_id,
    'new_event_from_followed',
    b.name || ' posted a new event',
    NEW.title,
    NEW.id,
    NEW.business_id
  FROM follows f
  JOIN businesses b ON b.id = NEW.business_id
  JOIN profiles p ON p.id = f.user_id
  WHERE f.business_id = NEW.business_id
    AND f.user_id != b.owner_id
    AND COALESCE((p.notification_preferences->>'new_event_from_followed')::boolean, true) = true;
  RETURN NEW;
END;
$$;

-- -----------------------------
-- 10. New: notify_rsvp_users_on_event_update
-- -----------------------------
CREATE OR REPLACE FUNCTION notify_rsvp_users_on_event_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.start_datetime IS NOT DISTINCT FROM NEW.start_datetime
     AND OLD.end_datetime IS NOT DISTINCT FROM NEW.end_datetime
     AND OLD.address IS NOT DISTINCT FROM NEW.address
     AND OLD.lat IS NOT DISTINCT FROM NEW.lat
     AND OLD.lng IS NOT DISTINCT FROM NEW.lng THEN
    RETURN NEW;
  END IF;

  INSERT INTO notifications (user_id, type, title, body, event_id)
  SELECT
    r.user_id,
    'event_update',
    'Event updated',
    '"' || COALESCE(NEW.title, 'Event') || '" has been updated. Check the new details.',
    NEW.id
  FROM rsvps r
  JOIN profiles p ON p.id = r.user_id
  WHERE r.event_id = NEW.id
    AND r.status IN ('going', 'interested')
    AND r.user_id != (SELECT owner_id FROM businesses WHERE id = NEW.business_id)
    AND COALESCE((p.notification_preferences->>'event_update')::boolean, true) = true;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_rsvp_users_on_event_update ON events;
CREATE TRIGGER trigger_notify_rsvp_users_on_event_update
  AFTER UPDATE ON events
  FOR EACH ROW
  WHEN (
    OLD.start_datetime IS DISTINCT FROM NEW.start_datetime
    OR OLD.end_datetime IS DISTINCT FROM NEW.end_datetime
    OR OLD.address IS DISTINCT FROM NEW.address
    OR OLD.lat IS DISTINCT FROM NEW.lat
    OR OLD.lng IS DISTINCT FROM NEW.lng
  )
  EXECUTE FUNCTION notify_rsvp_users_on_event_update();
