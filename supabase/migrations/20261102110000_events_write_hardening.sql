-- Events write-path hardening (events-flow review Tier 1, 2026-11-02).
--
-- Today every server-side gate on event creation lives inside
-- create_event_with_limit_check (owner, premium-only recurrence, monthly
-- limit), but the table still has a plain INSERT policy, so a client that
-- POSTs to /rest/v1/events skips all of them. The UPDATE policy is likewise
-- unrestricted by column, so a host can flip a cancelled event back to
-- 'active' (nobody is told) or keep editing it after cancelling. Capacity is
-- only checked by join_event_with_capacity, not by the rsvps table.
--
-- This migration:
--  1. Drops the direct INSERT policy on events: creation goes through the
--     RPC (SECURITY DEFINER, unaffected by RLS). Seeds run as postgres.
--  2. Re-creates create_event_with_limit_check with a ban check, basic
--     input validation and a row lock on the business so two parallel
--     calls can't both pass the limit check.
--  3. Adds a BEFORE UPDATE trigger on events: `status` may only change
--     through cancel_event (no host or admin bypass), and a cancelled event
--     is read-only.
--  4. Re-creates cancel_event to set the trigger's allow flag and to notify
--     users who *saved* the event as well as those who RSVP'd.
--  5. Adds a BEFORE INSERT/UPDATE capacity trigger on rsvps so the cap holds
--     for every write path, not just the RPC.
--  6. Replaces the public events SELECT policy so visitors see recurring
--     series whose first occurrence has passed (the policy compared
--     end_datetime only; event_has_ended is recurrence-aware).
--
-- No client change is required; services/events.ts already uses the RPC and
-- services/social.ts already maps the EVENT_FULL / event_closed messages.
-- Validated on a scratch copy of the local DB; not applied to the shared DB.

-- 1. Creation only through the RPC --------------------------------------------

DROP POLICY IF EXISTS "Business owners can create events" ON events;

-- 2. create_event_with_limit_check ---------------------------------------------

CREATE OR REPLACE FUNCTION public.create_event_with_limit_check(
  p_business_id uuid,
  p_title text,
  p_description text,
  p_category_id uuid,
  p_start_datetime timestamp with time zone,
  p_end_datetime timestamp with time zone,
  p_lat double precision,
  p_lng double precision,
  p_address text,
  p_cover_image_url text DEFAULT NULL::text,
  p_is_recurring boolean DEFAULT false,
  p_recurrence_pattern jsonb DEFAULT NULL::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_event_id uuid;
  can_create boolean;
  v_business businesses%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF user_is_banned(auth.uid()) THEN                              -- added
    RAISE EXCEPTION 'not_allowed: account suspended';
  END IF;

  -- Lock the business row: the limit check and the counter increment below
  -- are now serialized across concurrent calls.                 -- added
  SELECT * INTO v_business
  FROM businesses
  WHERE id = p_business_id AND owner_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You do not own this business';
  END IF;

  -- Basic shape checks the table doesn't enforce.                -- added
  IF length(btrim(COALESCE(p_title, ''))) = 0 THEN
    RAISE EXCEPTION 'invalid_title: title is required';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN
    RAISE EXCEPTION 'invalid_location: coordinates out of range';
  END IF;
  IF p_end_datetime <= p_start_datetime THEN
    RAISE EXCEPTION 'invalid_dates: end must be after start';
  END IF;
  IF COALESCE(p_is_recurring, false) AND p_recurrence_pattern IS NULL THEN
    RAISE EXCEPTION 'invalid_recurrence: recurring events need a pattern';
  END IF;

  -- Recurring events require premium subscription
  IF COALESCE(p_is_recurring, false) AND v_business.subscription_tier <> 'premium' THEN
    RAISE EXCEPTION 'Recurring events are only available for Premium businesses. Upgrade to create recurring events.';
  END IF;

  can_create := check_event_creation_limit(p_business_id);

  IF NOT can_create THEN
    RAISE EXCEPTION 'Event creation limit reached for this month. Upgrade to Premium for more events.';
  END IF;

  INSERT INTO events (
    business_id,
    title,
    description,
    category_id,
    start_datetime,
    end_datetime,
    lat,
    lng,
    address,
    cover_image_url,
    is_recurring,
    recurrence_pattern
  ) VALUES (
    p_business_id,
    btrim(p_title),
    COALESCE(p_description, ''),
    p_category_id,
    p_start_datetime,
    p_end_datetime,
    p_lat,
    p_lng,
    COALESCE(p_address, ''),
    p_cover_image_url,
    COALESCE(p_is_recurring, false),
    p_recurrence_pattern
  )
  RETURNING id INTO new_event_id;

  UPDATE businesses
  SET events_created_this_month = events_created_this_month + 1
  WHERE id = p_business_id;

  RETURN new_event_id;
END;
$function$;

-- 3. Lifecycle protection on UPDATE -------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_event_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_allow_status boolean :=
    COALESCE(current_setting('eventmap.allow_status_change', true), '') = 'true';
BEGIN
  -- Status flips only via cancel_event (which sets the flag). Nobody — host
  -- or admin — may "un-cancel" with a plain UPDATE: attendees were already
  -- told the event is off, and a silent reactivation contradicts that. The
  -- admin dashboard has no status writes (it only hard-deletes), so the
  -- exemption bought nothing and cost a loophole.
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT v_allow_status THEN
    RAISE EXCEPTION 'not_allowed: event status can only be changed through cancel_event';
  END IF;

  -- A cancelled event is read-only (everything except updated_at).
  IF OLD.status = 'cancelled' AND NEW.status = 'cancelled'
     AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'event_cancelled: cancelled events cannot be edited';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS a_protect_event_lifecycle ON events;
-- Named to sort before the other BEFORE UPDATE triggers (alphabetical
-- firing order) so a rejected write never reaches them.
CREATE TRIGGER a_protect_event_lifecycle
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION protect_event_lifecycle();

-- 4. cancel_event ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_event(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  SELECT owner_id INTO v_owner FROM businesses WHERE id = v_event.business_id;

  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event owner can cancel this event';
  END IF;

  IF v_event.status = 'cancelled' THEN
    RETURN; -- already cancelled, nothing to do
  END IF;

  PERFORM set_config('eventmap.allow_status_change', 'true', true);      -- added
  UPDATE events SET status = 'cancelled' WHERE id = p_event_id;
  PERFORM set_config('eventmap.allow_status_change', '', true);          -- added

  -- Pending reminders for this event are moot now.                      -- added
  DELETE FROM event_reminder_sent WHERE event_id = p_event_id;

  -- Notify everyone with a stake in the event: going/interested RSVPs and
  -- people who saved it (not the owner), honoring the event_update pref.
  INSERT INTO notifications (user_id, type, title, body, event_id)
  SELECT DISTINCT
    s.user_id,
    'event_update',
    'Event cancelled',
    '"' || COALESCE(v_event.title, 'Event') || '" has been cancelled by the organizer.',
    v_event.id
  FROM (
    SELECT r.user_id FROM rsvps r
    WHERE r.event_id = v_event.id AND r.status IN ('going', 'interested')
    UNION                                                                -- added
    SELECT sv.user_id FROM saves sv WHERE sv.event_id = v_event.id
  ) s
  JOIN profiles p ON p.id = s.user_id
  WHERE s.user_id IS DISTINCT FROM v_owner
    AND COALESCE((p.notification_preferences->>'event_update')::boolean, true) = true;
END;
$function$;

-- 5. Capacity at the table ------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_event_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_max integer;
  v_going bigint;
BEGIN
  -- Only a transition *into* 'going' consumes a seat.
  IF NEW.status <> 'going' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'going' AND OLD.event_id = NEW.event_id THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent joins on the event row (same lock as the RPC).
  SELECT e.max_attendees INTO v_max FROM events e WHERE e.id = NEW.event_id FOR UPDATE;
  IF v_max IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_going
  FROM rsvps r
  WHERE r.event_id = NEW.event_id
    AND r.status = 'going'
    AND r.user_id <> NEW.user_id;

  IF v_going >= v_max THEN
    RAISE EXCEPTION 'EVENT_FULL';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_enforce_event_capacity ON rsvps;
CREATE TRIGGER trigger_enforce_event_capacity
  BEFORE INSERT OR UPDATE OF status, event_id ON rsvps
  FOR EACH ROW
  EXECUTE FUNCTION enforce_event_capacity();

-- 6. Recurrence-aware public visibility ----------------------------------------

DROP POLICY IF EXISTS "Anyone can view active upcoming events" ON events;
CREATE POLICY "Anyone can view active upcoming events"
  ON events
  FOR SELECT
  USING (
    status = 'active'
    AND NOT event_has_ended(end_datetime, is_recurring, recurrence_pattern)
  );
