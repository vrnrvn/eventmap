-- Manual "Notify followers" tool for hosts (MyEvents row action).
--
-- notify_followers_on_new_event (20260227000000) already notifies followers
-- when an event is created, but followers gained *after* creation never hear
-- about it and hosts have no re-engagement tool. This RPC lets the business
-- owner push the same in-app notification on demand.
--
-- Spam guard: rows are deduped against existing notifications per
-- (follower, event, type) — a follower only ever gets one
-- 'new_event_from_followed' notification for a given event, whether it came
-- from the creation trigger or from this RPC, no matter how often the host
-- taps the button.
--
-- Conventions copied from the notification triggers in 20260225800000 /
-- 20260227000000: same row shape (user_id, type, title, body, event_id,
-- business_id), same type ('new_event_from_followed', so the existing
-- notifications UI renders it), same preference checks
-- (businesses.notifications_enabled + the follower's
-- notification_preferences->>'new_event_from_followed').
--
-- Client: services/businesses.ts notifyFollowersAboutEvent(eventId); the
-- MyEvents action tolerates 42883/PGRST202 while this is unapplied.

CREATE OR REPLACE FUNCTION notify_followers_about_event(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_business_id uuid;
  v_owner_id uuid;
  v_event_title text;
  v_business_name text;
  v_notifications_enabled boolean;
  v_status text;
  v_inserted integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT
    e.business_id,
    b.owner_id,
    e.title,
    b.name,
    COALESCE(b.notifications_enabled, true),
    -- events.status exists from 20261030106000 (ordered before this file).
    COALESCE(e.status, 'active')
  INTO
    v_business_id,
    v_owner_id,
    v_event_title,
    v_business_name,
    v_notifications_enabled,
    v_status
  FROM events e
  JOIN businesses b ON b.id = e.business_id
  WHERE e.id = p_event_id;

  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  IF v_owner_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_allowed: you do not own this event''s business';
  END IF;

  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'not_allowed: event is cancelled';
  END IF;

  IF NOT v_notifications_enabled THEN
    RETURN 0;
  END IF;

  INSERT INTO notifications (user_id, type, title, body, event_id, business_id)
  SELECT
    f.user_id,
    'new_event_from_followed',
    v_business_name || ' posted a new event',
    v_event_title,
    p_event_id,
    v_business_id
  FROM follows f
  JOIN profiles p ON p.id = f.user_id
  WHERE f.business_id = v_business_id
    AND f.user_id <> v_owner_id
    AND COALESCE((p.notification_preferences->>'new_event_from_followed')::boolean, true)
    -- Dedupe: skip followers who already have this (event, type) notification,
    -- whether from the creation trigger or an earlier call of this RPC.
    AND NOT EXISTS (
      SELECT 1
      FROM notifications n
      WHERE n.user_id = f.user_id
        AND n.event_id = p_event_id
        AND n.type = 'new_event_from_followed'
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION notify_followers_about_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION notify_followers_about_event(uuid) TO authenticated, service_role;
