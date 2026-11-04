-- Host tools, phase 1 (continued): capacity hardening, private-name guard,
-- batched host counts.
--
-- STATUS: prepared, NOT applied to the shared local DB (another dev session
-- owns it). Validated on an isolated scratch copy only. Apply after
-- 20261103110000_event_bans_and_waitlist_promote.sql.
--
-- A. Capacity
--   1. create_event_with_limit_check gains p_max_attendees (old 12-arg
--      signature dropped so PostgREST stays unambiguous). Creation is one write.
--   2. Trigger: max_attendees cannot be lowered below the current going count
--      on a plain UPDATE (guard_event_capacity_shrink; mirrors what is already
--      live on the shared DB without a migration file).
--   3. host_set_event_capacity(p_event_id, p_max_attendees): the host's
--      explicit path, sets the flag the trigger honours (same source).
--   4. Raising (or removing) the cap frees seats: tell the waitlist, the same
--      way a leave does. Factored into notify_event_waitlist_free_seats().
--
-- B. Private names (agreed 2026-11-03: only the event host sees identity, and
--    even then as "First L." for private profiles)
--   5. get_profiles_display leaked full name + avatar of private profiles to
--      any signed-in user (it backs chat sender names and the blocked list).
--      Private profiles now come back as "First L." with no avatar; the caller
--      still sees their own full profile.
--   6. Host RSVP notifications ("X is going to…", "X is no longer going…") and
--      chat pushes ("X: message", "X mentioned you") use the same rule.
--
-- C. get_host_events_counts(p_event_ids) for the My Events list: going /
--    interested / waitlist per event, restricted to events the caller hosts.

-- ---------------------------------------------------------------------------
-- A1. Capacity at creation
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_event_with_limit_check(
  uuid, text, text, uuid, timestamptz, timestamptz, double precision, double precision, text, text, boolean, jsonb
);

-- Body identical to 20261102110000 apart from the three '-- added' capacity lines.
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
  p_recurrence_pattern jsonb DEFAULT NULL::jsonb,
  p_max_attendees integer DEFAULT NULL::integer
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
  IF p_max_attendees IS NOT NULL AND p_max_attendees <= 0 THEN                -- added
    RAISE EXCEPTION 'invalid_capacity: must be a positive number';
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
    recurrence_pattern,
    max_attendees
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
    p_recurrence_pattern,
    p_max_attendees
  )
  RETURNING id INTO new_event_id;

  UPDATE businesses
  SET events_created_this_month = events_created_this_month + 1
  WHERE id = p_business_id;

  RETURN new_event_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_event_with_limit_check(
  uuid, text, text, uuid, timestamptz, timestamptz, double precision, double precision, text, text, boolean, jsonb, integer
) TO authenticated;

-- ---------------------------------------------------------------------------
-- A2 + A3. Capacity cannot silently drop below attendance
-- ---------------------------------------------------------------------------
-- The shared local DB already carries guard_event_capacity_shrink(),
-- b_guard_event_capacity_shrink and host_set_event_capacity() (added by the
-- other dev session directly, no migration file as of 2026-11-03). The
-- definitions below are byte-for-byte the same, so re-applying on the shared
-- DB is a no-op while a database built from files alone gets the guard too.
-- The host's explicit path is host_set_event_capacity; it sets the
-- transaction-local flag the trigger honours. The client confirms "below
-- current attendance" before calling it (screens/EditEvent.tsx).

CREATE OR REPLACE FUNCTION public.guard_event_capacity_shrink()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_going bigint;
BEGIN
  IF NEW.max_attendees IS NOT DISTINCT FROM OLD.max_attendees THEN
    RETURN NEW;
  END IF;
  IF NEW.max_attendees IS NULL THEN
    RETURN NEW; -- removing the cap can never strand anyone
  END IF;
  IF current_setting('eventmap.allow_capacity_shrink', true) = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_going
  FROM rsvps r WHERE r.event_id = NEW.id AND r.status = 'going';

  IF NEW.max_attendees < v_going THEN
    RAISE EXCEPTION 'capacity_below_going: % people are already going', v_going;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS b_guard_event_capacity_shrink ON events;
CREATE TRIGGER b_guard_event_capacity_shrink
  BEFORE UPDATE OF max_attendees ON events
  FOR EACH ROW
  EXECUTE FUNCTION guard_event_capacity_shrink();

CREATE OR REPLACE FUNCTION public.host_set_event_capacity(p_event_id uuid, p_max_attendees integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_max_attendees IS NOT NULL AND p_max_attendees <= 0 THEN
    RAISE EXCEPTION 'invalid_capacity: max attendees must be a positive number';
  END IF;

  SELECT b.owner_id INTO v_owner
  FROM events e JOIN businesses b ON b.id = e.business_id
  WHERE e.id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can change capacity';
  END IF;

  PERFORM set_config('eventmap.allow_capacity_shrink', 'on', true);
  UPDATE events SET max_attendees = p_max_attendees WHERE id = p_event_id;
  PERFORM set_config('eventmap.allow_capacity_shrink', '', true);
END;
$function$;

-- On the shared DB this function is executable by PUBLIC/anon (hand-applied).
-- It checks auth.uid() itself, but there is no reason for anon to see it.
REVOKE ALL ON FUNCTION public.host_set_event_capacity(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.host_set_event_capacity(uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- A4. More room → tell the waitlist
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_event_waitlist_free_seats(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_max integer;
  v_title text;
  v_going bigint;
  v_free integer;
  v_row record;
  v_sent integer := 0;
BEGIN
  SELECT e.max_attendees, e.title INTO v_max, v_title
  FROM events e WHERE e.id = p_event_id AND e.status = 'active';
  IF NOT FOUND THEN RETURN 0; END IF;

  IF v_max IS NULL THEN
    v_free := 100; -- cap removed: everyone waiting can join; bound the fan-out
  ELSE
    SELECT COUNT(*) INTO v_going FROM rsvps r WHERE r.event_id = p_event_id AND r.status = 'going';
    v_free := v_max - v_going;
  END IF;
  IF v_free <= 0 THEN RETURN 0; END IF;

  FOR v_row IN
    SELECT w.user_id
    FROM event_waitlist w
    WHERE w.event_id = p_event_id
      AND (w.notified_at IS NULL OR w.notified_at < now() - interval '1 day')
    ORDER BY w.created_at
    LIMIT v_free
  LOOP
    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    VALUES (
      v_row.user_id, 'waitlist', 'A spot opened up',
      'A place just opened in "' || COALESCE(v_title, 'an event') || '". Join now before it fills again.',
      p_event_id,
      jsonb_build_object('eventId', p_event_id, 'kind', 'waitlist_spot')
    );
    UPDATE event_waitlist SET notified_at = now() WHERE event_id = p_event_id AND user_id = v_row.user_id;
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.notify_event_waitlist_free_seats(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_waitlist_on_capacity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.max_attendees IS DISTINCT FROM OLD.max_attendees
     AND (NEW.max_attendees IS NULL OR OLD.max_attendees IS NULL OR NEW.max_attendees > OLD.max_attendees) THEN
    PERFORM notify_event_waitlist_free_seats(NEW.id);
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_notify_waitlist_on_capacity_change ON events;
CREATE TRIGGER trigger_notify_waitlist_on_capacity_change
  AFTER UPDATE OF max_attendees ON events
  FOR EACH ROW
  EXECUTE FUNCTION notify_waitlist_on_capacity_change();

-- ---------------------------------------------------------------------------
-- B5. Display names respect privacy everywhere, not only in Who's going
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_profiles_display(user_ids uuid[])
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN auth.uid() IS NULL THEN '[]'::json ELSE COALESCE(
    (SELECT json_agg(json_build_object(
        'id', p.id,
        'name', CASE
          WHEN p.id = auth.uid() THEN p.name
          ELSE host_display_name(p.name, COALESCE(p.is_profile_private, false))
        END,
        'avatar_url', CASE
          WHEN p.id = auth.uid() OR NOT COALESCE(p.is_profile_private, false) THEN p.avatar_url
          ELSE NULL
        END,
        'is_private', (p.id <> auth.uid() AND COALESCE(p.is_profile_private, false))
      ))
     FROM profiles p
     WHERE p.id IN (SELECT DISTINCT u FROM unnest(user_ids[1:200]) AS u)),
    '[]'::json
  ) END;
$function$;

-- ---------------------------------------------------------------------------
-- B6. Notifications that carry an attendee's name
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_business_on_rsvp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner_id uuid;
  v_event_title text;
  v_actor_name text;
  v_status text;
  v_biz_notifications boolean;
  v_owner_pref boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (NEW.status = 'going' AND OLD.status IS DISTINCT FROM 'going') THEN
    RETURN NEW;
  END IF;

  SELECT b.owner_id, e.title, COALESCE(b.notifications_enabled, true)
  INTO v_owner_id, v_event_title, v_biz_notifications
  FROM events e
  JOIN businesses b ON b.id = e.business_id
  WHERE e.id = NEW.event_id;

  IF v_owner_id IS NULL OR v_owner_id = NEW.user_id OR NOT v_biz_notifications THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE((p.notification_preferences->>'rsvp')::boolean, true)
  INTO v_owner_pref FROM profiles p WHERE p.id = v_owner_id;
  IF NOT v_owner_pref THEN RETURN NEW; END IF;

  -- Same identity rule as the host attendee list: "First L." for private
  -- profiles or people hidden from Who's going.
  SELECT host_display_name(
           p.name,
           (COALESCE(p.is_profile_private, false) OR COALESCE(p.show_attendance_publicly, true) = false)
         )
  INTO v_actor_name FROM profiles p WHERE p.id = NEW.user_id;
  v_actor_name := COALESCE(v_actor_name, 'Someone');

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

-- Chat pushes: the only change from 20261102120000 is the sender-name lookup.
CREATE OR REPLACE FUNCTION public.notify_attendees_on_chat_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event_title text;
  v_sender_name text;
  v_snippet text;
  v_recipient record;
BEGIN
  SELECT e.title INTO v_event_title FROM events e WHERE e.id = NEW.event_id;
  SELECT host_display_name(p.name, COALESCE(p.is_profile_private, false))
  INTO v_sender_name FROM profiles p WHERE p.id = NEW.sender_id;
  v_sender_name := COALESCE(v_sender_name, 'Someone');
  v_snippet := left(NEW.body, 120) || CASE WHEN char_length(NEW.body) > 120 THEN '…' ELSE '' END;

  FOR v_recipient IN
    SELECT r.user_id
    FROM rsvps r
    JOIN profiles p ON p.id = r.user_id
    LEFT JOIN event_chat_reads cr ON cr.event_id = r.event_id AND cr.user_id = r.user_id
    WHERE r.event_id = NEW.event_id
      AND r.status = 'going'
      AND r.user_id <> NEW.sender_id
      AND r.user_id = ANY(NEW.mentions)
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks ub
        WHERE ub.blocker_id = r.user_id AND ub.blocked_id = NEW.sender_id
      )
      AND COALESCE((p.notification_preferences->>'chat_message')::boolean, true)
      AND (cr.last_read_at IS NULL OR cr.last_read_at < now() - interval '1 minute')
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = r.user_id AND n.type = 'chat_mention' AND n.event_id = NEW.event_id
          AND n.data->>'senderId' = NEW.sender_id::text
          AND n.created_at > now() - interval '5 minutes'
      )
      AND (
        SELECT count(*) FROM notifications n
        WHERE n.user_id = r.user_id AND n.type = 'chat_mention' AND n.event_id = NEW.event_id
          AND n.created_at > now() - interval '15 minutes'
      ) < 3
  LOOP
    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    VALUES (
      v_recipient.user_id, 'chat_mention',
      v_sender_name || ' mentioned you in ' || COALESCE(v_event_title, 'an event chat'),
      v_snippet, NEW.event_id,
      jsonb_build_object('eventId', NEW.event_id, 'kind', 'chat', 'messageId', NEW.id, 'senderId', NEW.sender_id)
    );
  END LOOP;

  FOR v_recipient IN
    SELECT r.user_id
    FROM rsvps r
    JOIN profiles p ON p.id = r.user_id
    LEFT JOIN event_chat_reads cr ON cr.event_id = r.event_id AND cr.user_id = r.user_id
    WHERE r.event_id = NEW.event_id
      AND r.status = 'going'
      AND r.user_id <> NEW.sender_id
      AND NOT (r.user_id = ANY(NEW.mentions))
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks ub
        WHERE ub.blocker_id = r.user_id AND ub.blocked_id = NEW.sender_id
      )
      AND COALESCE((p.notification_preferences->>'chat_message')::boolean, true)
      AND NOT COALESCE(cr.muted, false)
      AND (cr.last_read_at IS NULL OR cr.last_read_at < now() - interval '1 minute')
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = r.user_id AND n.type IN ('chat_message', 'chat_mention')
          AND n.event_id = NEW.event_id AND n.created_at > now() - interval '15 minutes'
      )
  LOOP
    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    VALUES (
      v_recipient.user_id, 'chat_message', COALESCE(v_event_title, 'Event chat'),
      v_sender_name || ': ' || v_snippet, NEW.event_id,
      jsonb_build_object('eventId', NEW.event_id, 'kind', 'chat')
    );
  END LOOP;
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- C. Batched counts for the host's event list
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_host_events_counts(p_event_ids uuid[])
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN auth.uid() IS NULL THEN '[]'::json ELSE COALESCE(
    (SELECT json_agg(json_build_object(
        'event_id',   e.id,
        'going',      (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'going'),
        'interested', (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'interested'),
        'waitlist',   (SELECT COUNT(*) FROM event_waitlist w WHERE w.event_id = e.id)
      ))
     FROM events e
     JOIN businesses b ON b.id = e.business_id
     WHERE e.id IN (SELECT DISTINCT u FROM unnest(p_event_ids[1:100]) AS u)
       AND (b.owner_id = auth.uid() OR is_admin_user())),
    '[]'::json
  ) END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_host_events_counts(uuid[]) TO authenticated;
