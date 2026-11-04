-- Phase 3 (final): RSVP approval mode (plan §4B).
--
-- STATUS: prepared, NOT applied to the shared local DB (another dev session
-- owns it). Validated on an isolated scratch copy only. Apply after
-- 20261103160000_chat_mode_policy_and_pins.sql.
--
--   1. events.rsvp_mode 'open' (default) | 'approval'. rsvps.status gains
--      'requested'. Under approval, tapping Join records a request; the host
--      approves (capacity-checked, "You're in") or declines (row removed,
--      polite notice). Interested never needs approval. 'invite' mode stays
--      deferred (plan §9).
--   2. Requested rows are invisible everywhere attendees look: Who's going,
--      counts, chat access and capacity all key off 'going' (and sometimes
--      'interested') already. The host sees them in the hub (attendee page +
--      overview) and gets a "Request to join your event" notification.
--   3. The guard trigger stops the direct-table bypass: without it a user
--      could INSERT/UPDATE their own row straight to 'going' through RLS.
--      Host-driven paths (review, waitlist promote, auto-promote) pre-approve
--      via a transaction-local flag.
--
-- Note on provenance: an equivalent of this design was found hand-applied on
-- the *scratch* database this worktree had been using (another session shares
-- that scratch name). This file is the converged, file-tracked version; the
-- shared DB itself has none of it.

-- 1. Columns and statuses --------------------------------------------------------

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS rsvp_mode text NOT NULL DEFAULT 'open';
DO $$ BEGIN
  ALTER TABLE public.events ADD CONSTRAINT events_rsvp_mode_check CHECK (rsvp_mode IN ('open', 'approval'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.rsvps DROP CONSTRAINT IF EXISTS rsvps_status_check;
ALTER TABLE public.rsvps ADD CONSTRAINT rsvps_status_check CHECK (status IN ('going', 'interested', 'requested'));

CREATE OR REPLACE FUNCTION public.event_requires_approval(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT e.rsvp_mode = 'approval' FROM events e WHERE e.id = p_event_id), false);
$function$;

-- 2. Guard: no self-service 'going' under approval -------------------------------

CREATE OR REPLACE FUNCTION public.guard_rsvp_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_allow boolean := COALESCE(current_setting('eventmap.allow_approval', true), '') = 'true';
BEGIN
  -- Nothing legitimately moves an RSVP between events; allowing it would let
  -- a row created under an open event slide into a closed/approval/full one
  -- past every join-time check.
  IF TG_OP = 'UPDATE' AND NEW.event_id IS DISTINCT FROM OLD.event_id THEN
    RAISE EXCEPTION 'not_allowed: an RSVP cannot move to another event';
  END IF;
  -- 'requested' is only meaningful under approval mode; a direct insert on an
  -- open event would ping the host about a request no UI will ever review.
  IF NEW.status = 'requested' AND NOT v_allow AND NOT event_requires_approval(NEW.event_id) THEN
    RAISE EXCEPTION 'not_allowed: this event does not take join requests';
  END IF;
  -- Postponed / closed-for-joining events accept only DOWNGRADES of an
  -- existing row (going/requested -> interested). The UPDATE policy allows
  -- own-row writes on postponed events so people aren't stranded; this is
  -- what stops the same relaxation from becoming a self-upgrade path.
  IF NOT v_allow AND NOT event_is_open_for_rsvp(NEW.event_id) THEN
    -- An upsert arrives here as TG_OP = 'INSERT' even when it will resolve to
    -- an UPDATE on conflict, so "existing row" is what marks a downgrade.
    IF NOT (NEW.status = 'interested'
            AND (TG_OP = 'UPDATE'
                 OR EXISTS (SELECT 1 FROM rsvps r
                            WHERE r.event_id = NEW.event_id AND r.user_id = NEW.user_id))) THEN
      RAISE EXCEPTION 'event_closed';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status <> 'going' OR v_allow THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'going' THEN RETURN NEW; END IF;
  IF event_requires_approval(NEW.event_id) THEN
    RAISE EXCEPTION 'approval_required: the host approves who joins this event';
  END IF;
  RETURN NEW;
END;
$function$;

-- "c_" sorts before trigger_enforce_event_capacity, so a refused request never
-- reaches the capacity check.
DROP TRIGGER IF EXISTS c_guard_rsvp_approval ON rsvps;
CREATE TRIGGER c_guard_rsvp_approval
  BEFORE INSERT OR UPDATE OF status, event_id ON rsvps
  FOR EACH ROW
  EXECUTE FUNCTION guard_rsvp_approval();

-- An attendee of a postponed (or closed) event must still be able to downgrade
-- going -> interested; only cancelled/ended/draft events freeze RSVP rows.
CREATE OR REPLACE FUNCTION public.event_allows_rsvp_changes(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = p_event_id
      AND e.status IN ('active', 'postponed')
      AND e.publish_state = 'published'
      AND NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
  );
$function$;

DROP POLICY IF EXISTS "Users can update their own RSVPs" ON rsvps;
CREATE POLICY "Users can update their own RSVPs"
  ON rsvps FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND NOT user_is_banned(auth.uid())
    AND NOT user_is_banned_from_event(event_id, auth.uid())
    AND event_allows_rsvp_changes(event_id)
  );

-- 3. Join: a first "going" becomes a request ------------------------------------
-- Body identical to 20261103130000 apart from the approval branch and the
-- text return.

-- Return type changes (void -> text) so callers learn whether the tap became
-- a request; supabase-js callers that ignore the result keep working.
DROP FUNCTION IF EXISTS public.join_event_with_capacity(uuid, text);

CREATE OR REPLACE FUNCTION public.join_event_with_capacity(p_event_id uuid, p_status text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_going_count bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_status NOT IN ('going', 'interested') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  IF user_is_banned(auth.uid()) THEN
    RAISE EXCEPTION 'not_allowed: account suspended';
  END IF;

  IF user_is_banned_from_event(p_event_id, auth.uid()) THEN
    RAISE EXCEPTION 'removed_from_event';
  END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  IF NOT event_is_open_for_rsvp(p_event_id) THEN
    -- Postponed keeps everyone: an existing attendee may still downgrade to
    -- interested (leaving is a DELETE and always allowed). New joins wait.
    IF NOT (p_status = 'interested'
            AND event_allows_rsvp_changes(p_event_id)
            AND EXISTS (SELECT 1 FROM rsvps r WHERE r.event_id = p_event_id AND r.user_id = auth.uid())) THEN
      RAISE EXCEPTION 'event_closed';
    END IF;
  END IF;

  -- Host closed RSVPs: people already in may still change going <-> interested.
  IF v_event.rsvp_closed
     AND NOT EXISTS (SELECT 1 FROM rsvps r WHERE r.event_id = p_event_id AND r.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'rsvps_closed';
  END IF;

  -- Approval mode: a first "going" lands as a request the host reviews.
  -- Interested needs no approval; an already-approved attendee stays going.
  IF p_status = 'going' AND COALESCE(v_event.rsvp_mode, 'open') = 'approval'
     AND NOT EXISTS (SELECT 1 FROM rsvps r WHERE r.event_id = p_event_id AND r.user_id = auth.uid() AND r.status = 'going') THEN
    INSERT INTO rsvps (user_id, event_id, status)
    VALUES (auth.uid(), p_event_id, 'requested')
    ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'requested';
    RETURN 'requested';
  END IF;

  IF p_status = 'going' AND v_event.max_attendees IS NOT NULL THEN
    SELECT COUNT(*) INTO v_going_count
    FROM rsvps r
    WHERE r.event_id = p_event_id
      AND r.status = 'going'
      AND r.user_id != auth.uid();

    IF v_going_count >= v_event.max_attendees THEN
      RAISE EXCEPTION 'EVENT_FULL';
    END IF;
  END IF;

  INSERT INTO rsvps (user_id, event_id, status)
  VALUES (auth.uid(), p_event_id, p_status)
  ON CONFLICT (user_id, event_id)
  DO UPDATE SET status = EXCLUDED.status;
  RETURN p_status;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.join_event_with_capacity(uuid, text) TO authenticated;

-- The join RPC inserts 'requested' itself; that insert must pass the guard.
-- Rather than widen the guard, the RPC's requested-branch needs no flag
-- (status is 'requested', not 'going').

-- 4. Review ----------------------------------------------------------------------

-- Approve / decline a pending request. Approval re-checks capacity under the
-- event row lock (approvals race with open joins) and tells the requester
-- either way.
CREATE OR REPLACE FUNCTION public.host_review_rsvp(p_event_id uuid, p_user_id uuid, p_decision text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
  v_going bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_decision NOT IN ('approve', 'decline') THEN RAISE EXCEPTION 'invalid_decision'; END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = v_event.business_id;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can review requests';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rsvps r WHERE r.event_id = p_event_id AND r.user_id = p_user_id AND r.status = 'requested') THEN
    RAISE EXCEPTION 'not_requested';
  END IF;

  IF p_decision = 'decline' THEN
    DELETE FROM rsvps WHERE event_id = p_event_id AND user_id = p_user_id;
    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    VALUES (
      p_user_id, 'event_update', 'Request not approved',
      'The host could not approve your request to join "' || COALESCE(v_event.title, 'the event') || '".',
      p_event_id, jsonb_build_object('eventId', p_event_id, 'kind', 'request_declined')
    );
    RETURN;
  END IF;

  IF NOT event_is_open_for_rsvp(p_event_id) THEN RAISE EXCEPTION 'event_closed'; END IF;
  IF v_event.max_attendees IS NOT NULL THEN
    SELECT COUNT(*) INTO v_going FROM rsvps r WHERE r.event_id = p_event_id AND r.status = 'going';
    IF v_going >= v_event.max_attendees THEN RAISE EXCEPTION 'EVENT_FULL'; END IF;
  END IF;

  PERFORM set_config('eventmap.allow_approval', 'true', true);
  UPDATE rsvps SET status = 'going' WHERE event_id = p_event_id AND user_id = p_user_id;
  PERFORM set_config('eventmap.allow_approval', '', true);

  INSERT INTO notifications (user_id, type, title, body, event_id, data)
  VALUES (
    p_user_id, 'rsvp', 'You''re in',
    'The host approved your request: you''re going to "' || COALESCE(v_event.title, 'the event') || '".',
    p_event_id, jsonb_build_object('eventId', p_event_id, 'kind', 'request_approved')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.host_review_rsvp(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.host_review_rsvp(uuid, uuid, text) TO authenticated;

-- 5. Host-driven promotions pre-approve ------------------------------------------
-- Bodies identical to 20261103110000 / 20261103130000 apart from the flag.

CREATE OR REPLACE FUNCTION public.host_promote_from_waitlist(p_event_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
  v_going bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  -- Lock the event row: this races with attendees joining on their own.
  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;

  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = v_event.business_id;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can promote from the waitlist';
  END IF;

  IF NOT event_is_open_for_rsvp(p_event_id) THEN RAISE EXCEPTION 'event_closed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM event_waitlist w WHERE w.event_id = p_event_id AND w.user_id = p_user_id) THEN
    RAISE EXCEPTION 'not_on_waitlist';
  END IF;
  IF user_is_banned(p_user_id) THEN RAISE EXCEPTION 'not_allowed: account suspended'; END IF;

  IF v_event.max_attendees IS NOT NULL THEN
    SELECT COUNT(*) INTO v_going FROM rsvps r WHERE r.event_id = p_event_id AND r.status = 'going';
    IF v_going >= v_event.max_attendees THEN RAISE EXCEPTION 'EVENT_FULL'; END IF;
  END IF;

  -- The rsvps triggers take it from here: waitlist row removed, counts synced,
  -- host RSVP notification. The capacity trigger re-checks under the same lock.
  -- A host-driven promotion is pre-approved, so the approval guard steps aside.
  PERFORM set_config('eventmap.allow_approval', 'true', true);
  INSERT INTO rsvps (user_id, event_id, status)
  VALUES (p_user_id, p_event_id, 'going')
  ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'going';
  PERFORM set_config('eventmap.allow_approval', '', true);

  INSERT INTO notifications (user_id, type, title, body, event_id, data)
  VALUES (
    p_user_id, 'waitlist', 'You''re in',
    'The host moved you off the waitlist: you''re going to "' || COALESCE(v_event.title, 'the event') || '".',
    p_event_id,
    jsonb_build_object('eventId', p_event_id, 'kind', 'waitlist_promoted')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_event_seats_freed(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_going bigint;
  v_free integer;
  v_row record;
  v_done integer := 0;
BEGIN
  SELECT * INTO v_event FROM events e WHERE e.id = p_event_id AND e.status = 'active';
  IF NOT FOUND THEN RETURN 0; END IF;
  IF v_event.waitlist_mode = 'off' OR v_event.rsvp_closed THEN RETURN 0; END IF;
  -- Approval mode: nobody is admitted (or invited to self-admit) without the
  -- host; pending requests are the queue, the host promotes from the hub.
  IF COALESCE(v_event.rsvp_mode, 'open') = 'approval' THEN RETURN 0; END IF;

  IF v_event.max_attendees IS NULL THEN
    v_free := 100; -- cap removed: everyone waiting can join; bound the fan-out
  ELSE
    SELECT COUNT(*) INTO v_going FROM rsvps r WHERE r.event_id = p_event_id AND r.status = 'going';
    v_free := v_event.max_attendees - v_going;
  END IF;
  IF v_free <= 0 THEN RETURN 0; END IF;

  IF v_event.waitlist_mode = 'auto' THEN
    FOR v_row IN
      SELECT w.user_id FROM event_waitlist w
      WHERE w.event_id = p_event_id
        AND NOT user_is_banned(w.user_id)
      ORDER BY w.created_at
      LIMIT v_free
    LOOP
      -- The rsvps triggers drop the waitlist row and sync counts; the
      -- capacity trigger re-checks under the row lock the caller holds.
      -- Auto-promotion is host-configured, so it counts as pre-approved.
      PERFORM set_config('eventmap.allow_approval', 'true', true);
      INSERT INTO rsvps (user_id, event_id, status)
      VALUES (v_row.user_id, p_event_id, 'going')
      ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'going';
      PERFORM set_config('eventmap.allow_approval', '', true);

      INSERT INTO notifications (user_id, type, title, body, event_id, data)
      VALUES (
        v_row.user_id, 'waitlist', 'You''re in',
        'A spot opened up in "' || COALESCE(v_event.title, 'the event') || '" and you''ve been moved off the waitlist. You''re going!',
        p_event_id,
        jsonb_build_object('eventId', p_event_id, 'kind', 'waitlist_promoted')
      );
      v_done := v_done + 1;
    END LOOP;
    RETURN v_done;
  END IF;

  -- notify mode (previous behaviour)
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
      'A place just opened in "' || COALESCE(v_event.title, 'an event') || '". Join now before it fills again.',
      p_event_id,
      jsonb_build_object('eventId', p_event_id, 'kind', 'waitlist_spot')
    );
    UPDATE event_waitlist SET notified_at = now() WHERE event_id = p_event_id AND user_id = v_row.user_id;
    v_done := v_done + 1;
  END LOOP;
  RETURN v_done;
END;
$function$;

-- 6. The host hears about requests -----------------------------------------------
-- Body identical to 20261103120000 apart from the 'requested' handling.

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
  -- Worth a ping: a brand-new RSVP (going / interested / requested) or a move
  -- into 'going'. The host approving a request flips requested -> going
  -- themselves, so that transition stays quiet.
  IF TG_OP = 'UPDATE' AND NOT (NEW.status = 'going' AND OLD.status IS DISTINCT FROM 'going') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'requested' THEN
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
    WHEN 'requested' THEN 'asked to join'
    ELSE 'responded to'
  END;

  INSERT INTO notifications (user_id, type, title, body, event_id)
  VALUES (
    v_owner_id,
    'rsvp',
    CASE WHEN NEW.status = 'requested' THEN 'Request to join your event' ELSE 'New RSVP on your event' END,
    v_actor_name || ' ' || v_status || ' "' || COALESCE(v_event_title, 'your event') || '".',
    NEW.event_id
  );

  RETURN NEW;
END;
$function$;

-- 6b. Cancellation reaches requesters too ----------------------------------------
-- Body identical to 20261102110000 apart from 'requested' in the audience:
-- someone whose request is pending deserves to hear the event is off.

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
    WHERE r.event_id = v_event.id AND r.status IN ('going', 'interested', 'requested')
    UNION                                                                -- added
    SELECT sv.user_id FROM saves sv WHERE sv.event_id = v_event.id
  ) s
  JOIN profiles p ON p.id = s.user_id
  WHERE s.user_id IS DISTINCT FROM v_owner
    AND COALESCE((p.notification_preferences->>'event_update')::boolean, true) = true;
END;
$function$;

-- 7. Host views and settings ------------------------------------------------------
-- Bodies identical to 20261103110000 / 20261103130000 apart from 'requested'
-- and p_rsvp_mode.

CREATE OR REPLACE FUNCTION public.get_event_host_attendees_page(
  p_event_id uuid,
  p_status text DEFAULT 'going',
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  safe_limit integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
  safe_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  search text := NULLIF(trim(COALESCE(p_search, '')), '');
  pattern text;
  result json;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_status NOT IN ('going', 'interested', 'requested', 'waitlist', 'removed') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  SELECT b.owner_id INTO v_owner
  FROM events e JOIN businesses b ON b.id = e.business_id
  WHERE e.id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can view attendees';
  END IF;

  IF search IS NOT NULL THEN
    pattern := '%' || replace(replace(replace(search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  WITH matched AS (
    SELECT
      p.id          AS user_id,
      p.name,
      p.avatar_url,
      p.bio,
      (COALESCE(p.is_profile_private, false) OR COALESCE(p.show_attendance_publicly, true) = false) AS is_private,
      src.status,
      src.joined_at,
      src.reason,
      EXISTS (
        SELECT 1 FROM event_chat_blocks bl
        WHERE bl.event_id = p_event_id AND bl.user_id = p.id
          AND (bl.expires_at IS NULL OR bl.expires_at > now())
      ) AS chat_blocked
    FROM (
      SELECT r.user_id, r.status, r.created_at AS joined_at, NULL::text AS reason
      FROM rsvps r
      WHERE r.event_id = p_event_id AND p_status IN ('going', 'interested', 'requested') AND r.status = p_status
      UNION ALL
      SELECT w.user_id, 'waitlist'::text, w.created_at, NULL::text
      FROM event_waitlist w
      WHERE w.event_id = p_event_id AND p_status = 'waitlist'
      UNION ALL
      SELECT eb.user_id, 'removed'::text, eb.created_at, eb.reason
      FROM event_bans eb
      WHERE eb.event_id = p_event_id AND p_status = 'removed'
    ) src
    JOIN profiles p ON p.id = src.user_id
    -- Search matches what the host can see: the abbreviated name for private
    -- profiles, so a hidden surname cannot be probed letter by letter.
    WHERE pattern IS NULL
       OR host_display_name(
            p.name,
            (COALESCE(p.is_profile_private, false) OR COALESCE(p.show_attendance_publicly, true) = false)
          ) ILIKE pattern
  ),
  total AS (SELECT COUNT(*) AS c FROM matched),
  page AS (
    SELECT * FROM matched
    ORDER BY joined_at, user_id
    LIMIT safe_limit OFFSET safe_offset
  )
  SELECT json_build_object(
    'total', (SELECT c FROM total),
    'items', COALESCE((
      SELECT json_agg(json_build_object(
        'user_id',     user_id,
        'name',        host_display_name(name, is_private),
        'avatar_url',  CASE WHEN is_private THEN NULL ELSE avatar_url END,
        'bio',         CASE WHEN is_private THEN NULL ELSE LEFT(COALESCE(bio, ''), 80) END,
        'is_private',  is_private,
        'status',      status,
        'joined_at',   joined_at,
        'reason',      reason,
        'chat_blocked', chat_blocked
      ) ORDER BY joined_at, user_id)
      FROM page), '[]'::json),
    'has_more', (safe_offset + (SELECT COUNT(*) FROM page)) < (SELECT c FROM total)
  ) INTO result;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_host_overview(p_event_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  result json;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT b.owner_id INTO v_owner
  FROM events e JOIN businesses b ON b.id = e.business_id
  WHERE e.id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can view this';
  END IF;

  SELECT json_build_object(
    'going',      (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = p_event_id AND r.status = 'going'),
    'interested', (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = p_event_id AND r.status = 'interested'),
    'waitlist',   (SELECT COUNT(*) FROM event_waitlist w WHERE w.event_id = p_event_id),
    'removed',    (SELECT COUNT(*) FROM event_bans eb WHERE eb.event_id = p_event_id),
    'requested',  (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = p_event_id AND r.status = 'requested'),
    'saves',      (SELECT COUNT(*) FROM saves s WHERE s.event_id = p_event_id),
    'views_total',(SELECT COUNT(*) FROM event_views v WHERE v.event_id = p_event_id),
    'views_7d',   (SELECT COUNT(*) FROM event_views v
                   WHERE v.event_id = p_event_id AND v.viewed_at >= now() - interval '7 days'),
    'announcements_today', (SELECT COUNT(*) FROM host_announcements a
                            WHERE a.event_id = p_event_id AND a.created_at > now() - interval '1 day'),
    'chat', json_build_object(
      'locked',            COALESCE((SELECT cs.locked FROM event_chat_settings cs WHERE cs.event_id = p_event_id), false),
      'slow_mode_seconds', COALESCE((SELECT cs.slow_mode_seconds FROM event_chat_settings cs WHERE cs.event_id = p_event_id), 0),
      'message_count',     (SELECT COUNT(*) FROM event_chat_messages m
                            WHERE m.event_id = p_event_id AND m.deleted_at IS NULL),
      'blocked_count',     (SELECT COUNT(*) FROM event_chat_blocks bl
                            WHERE bl.event_id = p_event_id
                              AND (bl.expires_at IS NULL OR bl.expires_at > now())),
      'open_reports',      (SELECT COUNT(DISTINCT c.target_id) FROM complaints c
                            JOIN event_chat_messages m ON m.id = c.target_id
                            WHERE c.target_type = 'chat_message'
                              AND c.status = 'pending'
                              AND m.event_id = p_event_id)
    )
  ) INTO result;

  RETURN result;
END;
$function$;

DROP FUNCTION IF EXISTS public.host_set_event_settings(uuid, boolean, text);

CREATE OR REPLACE FUNCTION public.host_set_event_settings(
  p_event_id uuid,
  p_rsvp_closed boolean DEFAULT NULL,
  p_waitlist_mode text DEFAULT NULL,
  p_rsvp_mode text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
  v_was_closed boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_waitlist_mode IS NOT NULL AND p_waitlist_mode NOT IN ('off', 'notify', 'auto') THEN
    RAISE EXCEPTION 'invalid_waitlist_mode';
  END IF;
  IF p_rsvp_mode IS NOT NULL AND p_rsvp_mode NOT IN ('open', 'approval') THEN
    RAISE EXCEPTION 'invalid_rsvp_mode';
  END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = v_event.business_id;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can change settings';
  END IF;
  IF v_event.status = 'cancelled' THEN RAISE EXCEPTION 'event_cancelled: cancelled events cannot be edited'; END IF;

  v_was_closed := v_event.rsvp_closed;

  UPDATE events
  SET rsvp_closed = COALESCE(p_rsvp_closed, rsvp_closed),
      waitlist_mode = COALESCE(p_waitlist_mode, waitlist_mode),
      rsvp_mode = COALESCE(p_rsvp_mode, rsvp_mode)
  WHERE id = p_event_id
  RETURNING * INTO v_event;

  -- Re-opening with a waitlist and free seats: treat it like seats freeing.
  IF v_was_closed AND NOT v_event.rsvp_closed THEN
    PERFORM handle_event_seats_freed(p_event_id);
  END IF;

  RETURN json_build_object(
    'rsvp_closed', v_event.rsvp_closed,
    'waitlist_mode', v_event.waitlist_mode,
    'rsvp_mode', v_event.rsvp_mode
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.host_set_event_settings(uuid, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.host_set_event_settings(uuid, boolean, text, text) TO authenticated;


-- 8. Approval-aware waitlist and duplication --------------------------------------
-- join_event_waitlist: body identical to 20261103130000 plus the approval
-- refusal. duplicate_event: body identical to 20261103150000 plus rsvp_mode
-- carried into the copy (20261103150000 predates the column).

CREATE OR REPLACE FUNCTION public.join_event_waitlist(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_going bigint;
  v_position integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF user_is_banned(auth.uid()) THEN RAISE EXCEPTION 'not_allowed: account suspended'; END IF;
  IF user_is_banned_from_event(p_event_id, auth.uid()) THEN RAISE EXCEPTION 'removed_from_event'; END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF NOT event_is_open_for_rsvp(p_event_id) THEN RAISE EXCEPTION 'event_closed'; END IF;
  IF v_event.rsvp_closed THEN RAISE EXCEPTION 'rsvps_closed'; END IF;
  IF COALESCE(v_event.rsvp_mode, 'open') = 'approval' THEN
    -- The request queue replaces the waitlist: the host decides who gets in.
    RAISE EXCEPTION 'approval_required: ask to join instead';
  END IF;
  IF v_event.max_attendees IS NULL THEN RAISE EXCEPTION 'waitlist_not_needed: event has no capacity limit'; END IF;
  IF v_event.waitlist_mode = 'off' THEN RAISE EXCEPTION 'waitlist_off'; END IF;

  IF EXISTS (SELECT 1 FROM rsvps r WHERE r.event_id = p_event_id AND r.user_id = auth.uid() AND r.status = 'going') THEN
    RAISE EXCEPTION 'already_going';
  END IF;

  SELECT COUNT(*) INTO v_going FROM rsvps r WHERE r.event_id = p_event_id AND r.status = 'going';
  IF v_going < v_event.max_attendees THEN
    RAISE EXCEPTION 'spot_available';
  END IF;

  INSERT INTO event_waitlist (event_id, user_id)
  VALUES (p_event_id, auth.uid())
  ON CONFLICT (event_id, user_id) DO NOTHING;

  SELECT COUNT(*) INTO v_position
  FROM event_waitlist w
  WHERE w.event_id = p_event_id
    AND w.created_at <= (SELECT created_at FROM event_waitlist WHERE event_id = p_event_id AND user_id = auth.uid());
  RETURN v_position;
END;
$function$;

CREATE OR REPLACE FUNCTION public.duplicate_event(p_event_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
  v_new_id uuid;
  v_shift interval;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF user_is_banned(auth.uid()) THEN RAISE EXCEPTION 'not_allowed: account suspended'; END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = v_event.business_id;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can duplicate';
  END IF;

  -- A week after the original, or a week from now when the original is past.
  v_shift := CASE WHEN v_event.start_datetime > now() THEN interval '7 days'
                  ELSE (now() + interval '7 days') - v_event.start_datetime END;

  INSERT INTO events (
    business_id, title, description, category_id,
    start_datetime, end_datetime, lat, lng, address,
    cover_image_url, is_recurring, recurrence_pattern, max_attendees,
    rsvp_closed, waitlist_mode, rsvp_mode, timezone,
    publish_state, visibility, ticket_url, price_label, age_restriction, accessibility_notes, what_to_bring,
    status
  ) VALUES (
    v_event.business_id, left(v_event.title || ' (copy)', 200), v_event.description, v_event.category_id,
    v_event.start_datetime + v_shift, v_event.end_datetime + v_shift, v_event.lat, v_event.lng, v_event.address,
    v_event.cover_image_url, false, NULL, v_event.max_attendees,
    false, v_event.waitlist_mode, COALESCE(v_event.rsvp_mode, 'open'), v_event.timezone,
    'draft', v_event.visibility, v_event.ticket_url, v_event.price_label, v_event.age_restriction, v_event.accessibility_notes, v_event.what_to_bring,
    'active'
  )
  RETURNING id INTO v_new_id;

  INSERT INTO event_links (event_id, label, url, sort_order)
  SELECT v_new_id, l.label, l.url, l.sort_order FROM event_links l WHERE l.event_id = p_event_id;

  INSERT INTO event_photos (event_id, image_url, sort_order)
  SELECT v_new_id, ph.image_url, ph.sort_order FROM event_photos ph WHERE ph.event_id = p_event_id;

  RETURN v_new_id;
END;
$function$;
