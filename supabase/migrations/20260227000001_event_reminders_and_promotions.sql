-- Event reminders (pg_cron) and promotional notification RPC

-- -----------------------------
-- 1. send_event_reminders function
-- Events where start_datetime is within user's reminder window (e.g. 55-65 min for 60-min setting)
-- -----------------------------
CREATE OR REPLACE FUNCTION send_event_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_maps_url text;
  v_body text;
BEGIN
  FOR v_row IN
    SELECT
      e.id AS event_id,
      e.title,
      e.address,
      e.lat,
      e.lng,
      b.address AS business_address,
      r.user_id,
      p.event_reminder_minutes AS reminder_minutes
    FROM events e
    JOIN businesses b ON b.id = e.business_id
    JOIN rsvps r ON r.event_id = e.id AND r.status = 'going'
    JOIN profiles p ON p.id = r.user_id
    WHERE e.start_datetime > now()
      AND e.start_datetime <= now() + interval '25 hours'
      AND COALESCE(p.event_reminder_enabled, true) = true
      AND p.event_reminder_minutes IN (10, 30, 60, 120, 1440)
      AND extract(epoch from (e.start_datetime - now())) / 60
          BETWEEN p.event_reminder_minutes - 5 AND p.event_reminder_minutes + 5
      AND NOT EXISTS (
        SELECT 1 FROM event_reminder_sent ers
        WHERE ers.event_id = e.id
          AND ers.user_id = r.user_id
          AND ers.reminder_minutes = p.event_reminder_minutes
      )
  LOOP
    v_maps_url := 'https://www.google.com/maps/search/?api=1&query='
      || COALESCE(v_row.lat::text, '') || ',' || COALESCE(v_row.lng::text, '');
    v_body := COALESCE(v_row.business_address, v_row.address, '');
    IF v_row.lat IS NOT NULL AND v_row.lng IS NOT NULL THEN
      v_body := v_body || E'\n\nGet directions: ' || v_maps_url;
    END IF;

    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    VALUES (
      v_row.user_id,
      'event_reminder',
      'Event starting soon',
      COALESCE(v_row.title, 'Event') || ' starts in ' || v_row.reminder_minutes || ' minutes. ' || v_body,
      v_row.event_id,
      jsonb_build_object(
        'eventId', v_row.event_id,
        'businessAddress', COALESCE(v_row.business_address, v_row.address),
        'mapsUrl', v_maps_url
      )
    );

    INSERT INTO event_reminder_sent (event_id, user_id, reminder_minutes)
    VALUES (v_row.event_id, v_row.user_id, v_row.reminder_minutes);
  END LOOP;
END;
$$;

-- -----------------------------
-- 2. pg_cron job (if extension available)
-- -----------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('event_reminders');
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'event_reminders',
    '*/5 * * * *',
    'SELECT send_event_reminders()'
  );
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END;
$$;

-- -----------------------------
-- 3. send_promotional_notification RPC
-- -----------------------------
CREATE OR REPLACE FUNCTION send_promotional_notification(p_promotion_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promo record;
  v_count integer := 0;
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT id, title, body, link_url, target_cities, target_lat, target_lng, target_radius_km
  INTO v_promo
  FROM promotional_notifications
  WHERE id = p_promotion_id AND is_active = true;

  IF v_promo.id IS NULL THEN
    RAISE EXCEPTION 'Promotion not found or inactive';
  END IF;

  INSERT INTO notifications (user_id, type, title, body, data)
  SELECT
    p.id,
    'promotion',
    v_promo.title,
    v_promo.body,
    CASE WHEN v_promo.link_url IS NOT NULL THEN jsonb_build_object('linkUrl', v_promo.link_url) ELSE '{}'::jsonb END
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
