-- Event journey review, migration 2 of 7 (docs/EVENT_JOURNEY_REVIEW_2026-11-17.md).
--
-- STATUS: PREPARED, NOT APPLIED. Staged in supabase/prepared/; validated only
-- in a throwaway isolated container. See this folder's README.
--
-- EJ-12: a "going" RSVP is attendance once the event is over. The UPDATE
-- policy already freezes it (event_allows_rsvp_changes); the DELETE policy
-- only checked ownership, so leaving after the end erased attendance, told the
-- host "Someone left your event" and the waitlist "A spot opened up"
-- (reproduced). Now:
--   * the DELETE policy refuses deleting one's own GOING row once the event is
--     over (interested / requested rows stay deletable; host removal and
--     account deletion run as definer / cascade and are unaffected);
--   * the waitlist and host-notice triggers do nothing for an event that is
--     over (covers the cascade paths the policy does not see).
-- "Over" = event_has_ended (series: after their end date), the same rule the
-- UPDATE policy and attendance counts use.

-- Events past their end can be hidden from the caller by the events SELECT
-- policy, so the check runs as definer (like user_can_review_business).
CREATE OR REPLACE FUNCTION public.event_is_over(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
      FROM events e WHERE e.id = p_event_id
  ), false);
$function$;
REVOKE EXECUTE ON FUNCTION public.event_is_over(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_is_over(uuid) TO authenticated;

DROP POLICY IF EXISTS "Users can delete their own RSVPs" ON public.rsvps;
CREATE POLICY "Users can delete their own RSVPs" ON public.rsvps
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (
    (( SELECT auth.uid() AS uid) = user_id)
    AND NOT (status = 'going' AND event_is_over(event_id))
  );

CREATE OR REPLACE FUNCTION public.sync_event_waitlist_on_rsvp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event_id uuid := COALESCE(NEW.event_id, OLD.event_id);
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.status = 'going' THEN
    DELETE FROM event_waitlist WHERE event_id = NEW.event_id AND user_id = NEW.user_id;
  END IF;

  IF (TG_OP = 'DELETE' AND OLD.status = 'going')
     OR (TG_OP = 'UPDATE' AND OLD.status = 'going' AND NEW.status <> 'going') THEN
    -- EJ-12: a seat freed after the event is over is not a spot anyone can
    -- take; it used to send the waitlist "A spot opened up".
    IF NOT event_is_over(v_event_id) THEN
      PERFORM handle_event_seats_freed(v_event_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_business_on_rsvp_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner_id uuid;
  v_event_title text;
  v_actor_name text;
  v_biz_notifications boolean;
  v_owner_pref boolean;
BEGIN
  IF OLD.status <> 'going' THEN RETURN OLD; END IF;
  -- EJ-12: nobody "leaves" an event that is already over (an account
  -- deletion cascading here, for instance); don't tell the host they did.
  IF event_is_over(OLD.event_id) THEN RETURN OLD; END IF;

  SELECT b.owner_id, e.title, COALESCE(b.notifications_enabled, true)
  INTO v_owner_id, v_event_title, v_biz_notifications
  FROM events e
  JOIN businesses b ON b.id = e.business_id
  WHERE e.id = OLD.event_id;

  IF v_owner_id IS NULL OR v_owner_id = OLD.user_id OR v_owner_id = auth.uid() OR NOT v_biz_notifications THEN
    RETURN OLD;
  END IF;

  SELECT COALESCE((p.notification_preferences->>'rsvp')::boolean, true)
  INTO v_owner_pref FROM profiles p WHERE p.id = v_owner_id;
  IF NOT v_owner_pref THEN RETURN OLD; END IF;

  SELECT host_display_name(
           p.name,
           (COALESCE(p.is_profile_private, false) OR COALESCE(p.show_attendance_publicly, true) = false)
         )
  INTO v_actor_name FROM profiles p WHERE p.id = OLD.user_id;
  v_actor_name := COALESCE(v_actor_name, 'Someone');

  INSERT INTO notifications (user_id, type, title, body, event_id)
  VALUES (
    v_owner_id,
    'rsvp',
    'Someone left your event',
    v_actor_name || ' is no longer going to "' || COALESCE(v_event_title, 'your event') || '".',
    OLD.event_id
  );

  RETURN OLD;
END;
$function$;
