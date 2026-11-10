-- "New event in your interests near you" (docs/CATEGORIES_AND_SERIES_PLAN.md
-- Phase F). Opt-in: notification_preferences.interest_events must be true
-- (absent = off, unlike most preferences, so no one is opted in by the
-- migration). Requires 20261109100000 (taxonomy) for category labels only.
--
-- NOT applied to the shared local database by the author; validated on an
-- isolated scratch copy only.
--
-- Fires when a public, active event becomes published (insert or publish).
-- Recipients: profiles whose preferred_categories include the event's
-- category, with a home area (lat/lng) within 25 km, not the host, not a
-- follower of the business (they already get notify_followers_for_event),
-- not banned, at most one such notification per user per 24 h. Capped at
-- 500 recipients per event, nearest first.

CREATE OR REPLACE FUNCTION public.notify_interested_for_event(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
  v_label text;
  v_n integer := 0;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF NOT FOUND OR v_event.publish_state IS DISTINCT FROM 'published'
     OR v_event.status <> 'active' OR v_event.visibility IS DISTINCT FROM 'public' THEN
    RETURN 0;
  END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = v_event.business_id;
  SELECT c.label INTO v_label FROM categories c WHERE c.id = v_event.category_id;

  WITH recipients AS (
    SELECT p.id, calculate_distance(p.lat, p.lng, v_event.lat, v_event.lng) AS km
      FROM profiles p
     WHERE v_event.category_id = ANY (COALESCE(p.preferred_categories, '{}'))
       AND COALESCE((p.notification_preferences->>'interest_events')::boolean, false)
       AND p.lat IS NOT NULL AND p.lng IS NOT NULL
       AND p.lat BETWEEN v_event.lat - 0.25 AND v_event.lat + 0.25
       AND p.id IS DISTINCT FROM v_owner
       AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.user_id = p.id AND f.business_id = v_event.business_id)
       AND NOT EXISTS (SELECT 1 FROM banned_users bu WHERE bu.user_id = p.id)
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
          WHERE n.user_id = p.id AND n.type = 'interest_event' AND n.created_at > now() - interval '24 hours')
  ),
  ins AS (
    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    SELECT r.id, 'interest_event',
           'New ' || COALESCE(v_label, 'event') || ' near you',
           '"' || COALESCE(v_event.title, 'An event') || '" was just posted '
             || CASE WHEN r.km < 1 THEN 'nearby' ELSE round(r.km::numeric, 0) || ' km away' END || '.',
           v_event.id,
           jsonb_build_object('eventId', v_event.id, 'kind', 'interest_event', 'categoryId', v_event.category_id)
      FROM recipients r
     WHERE r.km <= 25
     ORDER BY r.km
     LIMIT 500
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  RETURN v_n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.notify_interested_for_event(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.notify_interested_on_publish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.publish_state = 'published'
     AND (TG_OP = 'INSERT' OR OLD.publish_state IS DISTINCT FROM 'published') THEN
    PERFORM notify_interested_for_event(NEW.id);
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_notify_interested_on_publish ON public.events;
CREATE TRIGGER trigger_notify_interested_on_publish
  AFTER INSERT OR UPDATE OF publish_state ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.notify_interested_on_publish();
