-- Notifications + push pipeline hardening
-- - Ensure follower + RSVP notifications are generated
-- - Add push token registry for users
-- - Dispatch Expo push when a notification is inserted

-- -----------------------------
-- Push token registry
-- -----------------------------
CREATE TABLE IF NOT EXISTS user_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  platform text NOT NULL DEFAULT 'unknown',
  device_id text,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_push_tokens_platform_check
    CHECK (platform IN ('ios', 'android', 'web', 'unknown'))
);

CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_id
  ON user_push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_user_push_tokens_active
  ON user_push_tokens(user_id, is_active);

ALTER TABLE user_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own push tokens" ON user_push_tokens;
CREATE POLICY "Users can read own push tokens"
  ON user_push_tokens
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own push tokens" ON user_push_tokens;
CREATE POLICY "Users can insert own push tokens"
  ON user_push_tokens
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own push tokens" ON user_push_tokens;
CREATE POLICY "Users can update own push tokens"
  ON user_push_tokens
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own push tokens" ON user_push_tokens;
CREATE POLICY "Users can delete own push tokens"
  ON user_push_tokens
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION set_user_push_tokens_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_user_push_tokens_updated_at_trigger ON user_push_tokens;
CREATE TRIGGER set_user_push_tokens_updated_at_trigger
  BEFORE UPDATE ON user_push_tokens
  FOR EACH ROW
  EXECUTE FUNCTION set_user_push_tokens_updated_at();

CREATE OR REPLACE FUNCTION upsert_push_token(
  p_token text,
  p_platform text DEFAULT 'unknown',
  p_device_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO user_push_tokens (
    user_id,
    token,
    platform,
    device_id,
    is_active,
    last_seen_at
  )
  VALUES (
    v_user_id,
    p_token,
    CASE
      WHEN p_platform IN ('ios', 'android', 'web') THEN p_platform
      ELSE 'unknown'
    END,
    p_device_id,
    true,
    now()
  )
  ON CONFLICT (token)
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    platform = EXCLUDED.platform,
    device_id = EXCLUDED.device_id,
    is_active = true,
    last_seen_at = now(),
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION deactivate_push_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE user_push_tokens
  SET is_active = false, updated_at = now()
  WHERE token = p_token
    AND user_id = auth.uid();
END;
$$;

-- -----------------------------
-- Notification generators
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
BEGIN
  SELECT b.owner_id
  INTO v_owner_id
  FROM businesses b
  WHERE b.id = NEW.business_id;

  IF v_owner_id IS NULL OR v_owner_id = NEW.user_id THEN
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

DROP TRIGGER IF EXISTS trigger_notify_business_on_new_follower ON follows;
CREATE TRIGGER trigger_notify_business_on_new_follower
  AFTER INSERT ON follows
  FOR EACH ROW
  EXECUTE FUNCTION notify_business_on_new_follower();

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
BEGIN
  SELECT b.owner_id, e.title
  INTO v_owner_id, v_event_title
  FROM events e
  JOIN businesses b ON b.id = e.business_id
  WHERE e.id = NEW.event_id;

  IF v_owner_id IS NULL OR v_owner_id = NEW.user_id THEN
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

DROP TRIGGER IF EXISTS trigger_notify_business_on_rsvp_insert ON rsvps;
CREATE TRIGGER trigger_notify_business_on_rsvp_insert
  AFTER INSERT ON rsvps
  FOR EACH ROW
  EXECUTE FUNCTION notify_business_on_rsvp();

DROP TRIGGER IF EXISTS trigger_notify_business_on_rsvp_update ON rsvps;
CREATE TRIGGER trigger_notify_business_on_rsvp_update
  AFTER UPDATE OF status ON rsvps
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION notify_business_on_rsvp();

-- -----------------------------
-- Push dispatch (best effort)
-- Uses pg_net if available.
-- -----------------------------
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION
  WHEN OTHERS THEN
    -- Continue without push dispatch if extension can't be enabled.
    NULL;
END;
$$;

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

    -- Dynamic SQL avoids hard dependency when pg_net isn't enabled.
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
    -- Never block notification writes because push failed.
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_dispatch_push_for_notification ON notifications;
CREATE TRIGGER trigger_dispatch_push_for_notification
  AFTER INSERT ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION dispatch_push_for_notification();
