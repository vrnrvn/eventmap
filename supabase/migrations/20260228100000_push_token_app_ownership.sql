-- Push tokens: track app ownership so we only send to standalone app, not Expo Go.
-- Expo Go and standalone app register different tokens; sending to both causes
-- notifications to appear in Expo Go instead of the EventMap app.

ALTER TABLE user_push_tokens
  ADD COLUMN IF NOT EXISTS app_ownership text;

COMMENT ON COLUMN user_push_tokens.app_ownership IS 'expo = Expo Go, standalone = dev/production build. Null = legacy.';

CREATE OR REPLACE FUNCTION upsert_push_token(
  p_token text,
  p_platform text DEFAULT 'unknown',
  p_device_id text DEFAULT NULL,
  p_app_ownership text DEFAULT NULL
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

  -- When registering from standalone, deactivate all other tokens for this user
  -- so we clear any old Expo Go tokens and avoid sending to both apps.
  IF p_app_ownership = 'standalone' THEN
    UPDATE user_push_tokens
    SET is_active = false, updated_at = now()
    WHERE user_id = v_user_id AND token != p_token;
  END IF;

  INSERT INTO user_push_tokens (
    user_id,
    token,
    platform,
    device_id,
    app_ownership,
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
    p_app_ownership,
    true,
    now()
  )
  ON CONFLICT (token)
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    platform = EXCLUDED.platform,
    device_id = EXCLUDED.device_id,
    app_ownership = COALESCE(EXCLUDED.app_ownership, user_push_tokens.app_ownership),
    is_active = true,
    last_seen_at = now(),
    updated_at = now();
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
    'eventId', NEW.event_id,
    'businessId', NEW.business_id
  );
  IF NEW.data IS NOT NULL AND jsonb_typeof(NEW.data) = 'object' THEN
    v_data := v_data || NEW.data;
  END IF;

  -- Only send to standalone app tokens. Skip Expo Go (app_ownership = 'expo').
  -- Legacy tokens (app_ownership IS NULL) are skipped to avoid sending to old Expo Go tokens.
  FOR v_token IN
    SELECT token
    FROM user_push_tokens
    WHERE user_id = NEW.user_id
      AND is_active = true
      AND app_ownership = 'standalone'
  LOOP
    v_payload := jsonb_build_object(
      'to', v_token,
      'title', NEW.title,
      'body', COALESCE(NEW.body, ''),
      'sound', 'default',
      'channelId', 'default',
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
