-- Host tools, phase 1 (final): organiser settings + announcements.
--
-- STATUS: prepared, NOT applied to the shared local DB (another dev session
-- owns it). Validated on an isolated scratch copy only. Apply after
-- 20261103120000_capacity_hardening_and_private_names.sql.
--
--   1. events.rsvp_closed     host switch: "Accepting RSVPs" off. Existing
--                             attendees keep their seat; new going / interested
--                             / waitlist joins are refused with 'rsvps_closed'.
--   2. events.waitlist_mode   'off' | 'notify' (today's behaviour, default) |
--                             'auto' (the first person in line is moved to going
--                             when a seat frees, instead of being pinged).
--   3. host_set_event_settings(p_event_id, p_rsvp_closed, p_waitlist_mode)
--   4. join RPCs + rsvps INSERT policy honour rsvp_closed; waitlist join honours
--      waitlist_mode = 'off'. (Bodies otherwise identical to 20261103110000.)
--   5. Seat-freed handling (leave, going→interested, cap raised) respects the
--      mode: auto promotes, notify pings, off does nothing.
--   6. host_announcements + send_event_announcement(p_event_id, p_body,
--      p_audience 'going' | 'all'): one in-app notification per recipient of
--      type 'host_announcement', honouring a new notification preference of
--      the same name, at most 3 announcements per event per day. Also posts
--      the text into the event chat as the host so late joiners can read it.

-- 1 + 2. Columns -----------------------------------------------------------------

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS rsvp_closed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS waitlist_mode text NOT NULL DEFAULT 'notify';

DO $$ BEGIN
  ALTER TABLE public.events
    ADD CONSTRAINT events_waitlist_mode_check CHECK (waitlist_mode IN ('off', 'notify', 'auto'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Settings RPC ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.host_set_event_settings(
  p_event_id uuid,
  p_rsvp_closed boolean DEFAULT NULL,
  p_waitlist_mode text DEFAULT NULL
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
      waitlist_mode = COALESCE(p_waitlist_mode, waitlist_mode)
  WHERE id = p_event_id
  RETURNING * INTO v_event;

  -- Re-opening with a waitlist and free seats: treat it like seats freeing.
  IF v_was_closed AND NOT v_event.rsvp_closed THEN
    PERFORM handle_event_seats_freed(p_event_id);
  END IF;

  RETURN json_build_object('rsvp_closed', v_event.rsvp_closed, 'waitlist_mode', v_event.waitlist_mode);
END;
$function$;

REVOKE ALL ON FUNCTION public.host_set_event_settings(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.host_set_event_settings(uuid, boolean, text) TO authenticated;

-- 4. Joins honour the switch ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.event_rsvps_closed(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT e.rsvp_closed FROM events e WHERE e.id = p_event_id), false);
$function$;

CREATE OR REPLACE FUNCTION public.join_event_with_capacity(p_event_id uuid, p_status text)
RETURNS void
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
    RAISE EXCEPTION 'event_closed';
  END IF;

  -- Host closed RSVPs: people already in may still change going <-> interested.
  IF v_event.rsvp_closed
     AND NOT EXISTS (SELECT 1 FROM rsvps r WHERE r.event_id = p_event_id AND r.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'rsvps_closed';
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
END;
$function$;

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

-- Direct-table path: a *new* row while closed is refused; updates to an
-- existing row are untouched (see the UPDATE policy from 20261103110000).
DROP POLICY IF EXISTS "Users can create their own RSVPs" ON rsvps;
CREATE POLICY "Users can create their own RSVPs"
  ON rsvps FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND NOT user_is_banned(auth.uid())
    AND NOT user_is_banned_from_event(event_id, auth.uid())
    AND NOT event_rsvps_closed(event_id)
    AND event_is_open_for_rsvp(event_id)
  );

-- 5. Seats freed: one function, three modes ------------------------------------

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
      INSERT INTO rsvps (user_id, event_id, status)
      VALUES (v_row.user_id, p_event_id, 'going')
      ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'going';

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

REVOKE EXECUTE ON FUNCTION public.handle_event_seats_freed(uuid) FROM PUBLIC, anon, authenticated;

-- 20261103120000's helper now defers to the mode-aware one.
CREATE OR REPLACE FUNCTION public.notify_event_waitlist_free_seats(p_event_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT handle_event_seats_freed(p_event_id);
$function$;

-- rsvps trigger from 20261102160000: same shape, seat-freed branch delegates.
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
    PERFORM handle_event_seats_freed(v_event_id);
  END IF;
  RETURN NULL;
END;
$function$;

-- 6. Announcements ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.host_announcements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  audience   text NOT NULL CHECK (audience IN ('going', 'all')),
  recipients integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_host_announcements_event_created
  ON public.host_announcements (event_id, created_at DESC);

ALTER TABLE public.host_announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Announcements visible to host, admins and attendees" ON public.host_announcements;
CREATE POLICY "Announcements visible to host, admins and attendees"
  ON public.host_announcements FOR SELECT
  TO authenticated
  USING (
    user_is_event_host(event_id)
    OR is_admin_user()
    OR EXISTS (SELECT 1 FROM rsvps r WHERE r.event_id = host_announcements.event_id AND r.user_id = auth.uid())
  );

REVOKE INSERT, UPDATE, DELETE ON public.host_announcements FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.send_event_announcement(
  p_event_id uuid,
  p_body text,
  p_audience text DEFAULT 'going'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
  v_body text := btrim(COALESCE(p_body, ''));
  v_today integer;
  v_recipients integer := 0;
  v_announcement_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_audience NOT IN ('going', 'all') THEN RAISE EXCEPTION 'invalid_audience'; END IF;
  IF char_length(v_body) = 0 THEN RAISE EXCEPTION 'invalid_body: empty'; END IF;
  IF char_length(v_body) > 500 THEN RAISE EXCEPTION 'invalid_body: too long'; END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = v_event.business_id;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can announce';
  END IF;
  IF v_event.status = 'cancelled' THEN RAISE EXCEPTION 'event_cancelled'; END IF;

  SELECT COUNT(*) INTO v_today
  FROM host_announcements a
  WHERE a.event_id = p_event_id AND a.created_at > now() - interval '1 day';
  IF v_today >= 3 THEN RAISE EXCEPTION 'announcement_limit: at most 3 per event per day'; END IF;

  INSERT INTO host_announcements (event_id, created_by, body, audience)
  VALUES (p_event_id, auth.uid(), v_body, p_audience)
  RETURNING id INTO v_announcement_id;

  -- Recipients: going (+ interested for 'all'), minus the host, honouring the
  -- 'host_announcement' preference and user blocks against the host.
  WITH targets AS (
    SELECT r.user_id
    FROM rsvps r
    JOIN profiles p ON p.id = r.user_id
    WHERE r.event_id = p_event_id
      AND r.user_id <> auth.uid()
      AND (p_audience = 'all' OR r.status = 'going')
      AND COALESCE((p.notification_preferences->>'host_announcement')::boolean, true)
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks ub WHERE ub.blocker_id = r.user_id AND ub.blocked_id = auth.uid()
      )
  ), inserted AS (
    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    SELECT t.user_id, 'host_announcement',
           'Update from the host: ' || COALESCE(v_event.title, 'your event'),
           v_body, p_event_id,
           jsonb_build_object('eventId', p_event_id, 'kind', 'host_announcement', 'announcementId', v_announcement_id)
    FROM targets t
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_recipients FROM inserted;

  UPDATE host_announcements SET recipients = v_recipients WHERE id = v_announcement_id;

  -- Mirror into the chat so people who join later still see it. Host posts
  -- are allowed without an RSVP (20261102120000); the chat triggers handle
  -- their own throttles and will skip pushes to people just notified above
  -- only when they fall inside the existing 15-minute window.
  BEGIN
    INSERT INTO event_chat_messages (event_id, sender_id, body, mentions)
    VALUES (p_event_id, auth.uid(), '📣 ' || v_body, '{}');
  EXCEPTION WHEN OTHERS THEN
    -- Chat mirror is best-effort (locked chat rules, rate limits).
    NULL;
  END;

  RETURN json_build_object('id', v_announcement_id, 'recipients', v_recipients, 'sent_today', v_today + 1);
END;
$function$;

REVOKE ALL ON FUNCTION public.send_event_announcement(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_event_announcement(uuid, text, text) TO authenticated;

-- Overview: how many announcements the host has left today.
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
