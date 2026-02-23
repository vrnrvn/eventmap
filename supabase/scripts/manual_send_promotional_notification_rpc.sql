-- Run in Supabase Dashboard → SQL Editor if send_promotional_notification RPC is missing
-- (Required for "Send Now" button on promotions edit page)

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
