-- Add Android channelId to push payload so system notifications appear on device.
-- Without channelId, Android may not display push notifications in the notification shade.

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
