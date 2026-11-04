-- Host tools, phase 1 (continued): event bans + waitlist promote.
--
-- STATUS: prepared, NOT applied to the shared local DB (another dev session
-- owns it). Validated on an isolated scratch copy only. Apply after
-- 20261103100000_host_event_tools.sql.
--
-- Problem: host_remove_attendee (20261102150000) drops the RSVP and blocks the
-- chat, but nothing stops the person from tapping Join again a second later.
--
--   1. event_bans            per-event "may not rejoin" list, host/admin managed
--   2. host_remove_attendee  now also bans (p_ban, default true) and clears the
--                            waitlist row; same name, one extra defaulted arg
--   3. host_unban_attendee   lifts the ban and the chat block set by the removal
--   4. join_event_with_capacity / join_event_waitlist / rsvps policies refuse
--                            banned users with 'removed_from_event'
--   5. get_event_host_attendees_page gains p_status = 'removed'
--      get_event_host_overview gains 'removed'
--   6. host_promote_from_waitlist  host moves the next person into "going"
--                            when a seat is free; EVENT_FULL otherwise

-- 1. Table -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_bans (
  event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  banned_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

ALTER TABLE public.event_bans ENABLE ROW LEVEL SECURITY;

-- Host/admin can read; the subject can read their own row (so the client can
-- explain a refused join). All writes go through the RPCs below.
DROP POLICY IF EXISTS "Event bans visible to host, admins and subject" ON public.event_bans;
CREATE POLICY "Event bans visible to host, admins and subject"
  ON public.event_bans FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR user_is_event_host(event_id) OR is_admin_user());

REVOKE INSERT, UPDATE, DELETE ON public.event_bans FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.user_is_banned_from_event(p_event_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM event_bans b WHERE b.event_id = p_event_id AND b.user_id = p_user_id);
$function$;

-- 2. Remove (+ ban) ---------------------------------------------------------------

-- The 3-arg version must go: with both overloads present PostgREST cannot pick
-- one when p_ban is omitted.
DROP FUNCTION IF EXISTS public.host_remove_attendee(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.host_remove_attendee(
  p_event_id uuid,
  p_user_id uuid,
  p_reason text DEFAULT NULL::text,
  p_ban boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_title text;
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT e.title, b.owner_id INTO v_title, v_owner
  FROM events e JOIN businesses b ON b.id = e.business_id
  WHERE e.id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;

  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can remove attendees';
  END IF;
  IF p_user_id = v_owner THEN RAISE EXCEPTION 'not_allowed: the host cannot be removed'; END IF;

  DELETE FROM rsvps WHERE event_id = p_event_id AND user_id = p_user_id;
  DELETE FROM event_waitlist WHERE event_id = p_event_id AND user_id = p_user_id;

  IF COALESCE(p_ban, true) THEN
    INSERT INTO event_bans (event_id, user_id, banned_by, reason)
    VALUES (p_event_id, p_user_id, auth.uid(), NULLIF(btrim(COALESCE(p_reason, '')), ''))
    ON CONFLICT (event_id, user_id)
    DO UPDATE SET banned_by = EXCLUDED.banned_by, reason = EXCLUDED.reason, created_at = now();
  END IF;

  -- Chat block as before (indefinite; lifted by host_unban_attendee or the
  -- moderation sheet).
  INSERT INTO event_chat_blocks (event_id, user_id, blocked_by, reason, expires_at)
  VALUES (p_event_id, p_user_id, auth.uid(), COALESCE(p_reason, 'Removed from event'), NULL)
  ON CONFLICT (event_id, user_id)
  DO UPDATE SET blocked_by = EXCLUDED.blocked_by, reason = EXCLUDED.reason, expires_at = NULL, created_at = now();

  INSERT INTO event_chat_moderation_actions (event_id, target_user_id, actor_id, action, reason)
  VALUES (p_event_id, p_user_id, auth.uid(), 'block', COALESCE(p_reason, 'Removed from event'));

  DELETE FROM event_reminder_sent WHERE event_id = p_event_id AND user_id = p_user_id;

  INSERT INTO notifications (user_id, type, title, body, event_id, data)
  VALUES (
    p_user_id,
    'moderation',
    'Removed from an event',
    'The host removed you from "' || COALESCE(v_title, 'an event') || '".'
      || CASE WHEN p_reason IS NULL OR btrim(p_reason) = '' THEN '' ELSE ' Reason: ' || p_reason END,
    p_event_id,
    jsonb_build_object('eventId', p_event_id, 'kind', 'removed_from_event')
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.host_remove_attendee(uuid, uuid, text, boolean) TO authenticated;

-- 3. Unban -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.host_unban_attendee(p_event_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT b.owner_id INTO v_owner
  FROM events e JOIN businesses b ON b.id = e.business_id
  WHERE e.id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can lift a removal';
  END IF;

  DELETE FROM event_bans WHERE event_id = p_event_id AND user_id = p_user_id;
  -- The chat block that came with the removal goes too; a block the host set
  -- separately from the moderation sheet is indistinguishable here, which is
  -- acceptable: "allow back" means back in full.
  DELETE FROM event_chat_blocks WHERE event_id = p_event_id AND user_id = p_user_id;

  INSERT INTO event_chat_moderation_actions (event_id, target_user_id, actor_id, action, reason)
  VALUES (p_event_id, p_user_id, auth.uid(), 'unblock', 'Allowed back into the event');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.host_unban_attendee(uuid, uuid) TO authenticated;

-- 4. Enforce the ban on every join path ------------------------------------------

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

  -- Lock the event row so concurrent joins serialize on the capacity check.
  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  IF NOT event_is_open_for_rsvp(p_event_id) THEN
    RAISE EXCEPTION 'event_closed';
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
  IF v_event.max_attendees IS NULL THEN RAISE EXCEPTION 'waitlist_not_needed: event has no capacity limit'; END IF;

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

-- Direct-table path (the client's "interested" upsert and any future caller):
-- a banned user's INSERT/UPDATE is refused by RLS as well.
DROP POLICY IF EXISTS "Users can create their own RSVPs" ON rsvps;
CREATE POLICY "Users can create their own RSVPs"
  ON rsvps FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND NOT user_is_banned(auth.uid())
    AND NOT user_is_banned_from_event(event_id, auth.uid())
    AND event_is_open_for_rsvp(event_id)
  );

DROP POLICY IF EXISTS "Users can update their own RSVPs" ON rsvps;
CREATE POLICY "Users can update their own RSVPs"
  ON rsvps FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND NOT user_is_banned(auth.uid())
    AND NOT user_is_banned_from_event(event_id, auth.uid())
    AND event_is_open_for_rsvp(event_id)
  );

-- 5. Host views learn about removals -----------------------------------------------

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
  IF p_status NOT IN ('going', 'interested', 'waitlist', 'removed') THEN
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
      WHERE r.event_id = p_event_id AND p_status IN ('going', 'interested') AND r.status = p_status
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

-- 6. Promote from the waitlist ----------------------------------------------------

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
  INSERT INTO rsvps (user_id, event_id, status)
  VALUES (p_user_id, p_event_id, 'going')
  ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'going';

  INSERT INTO notifications (user_id, type, title, body, event_id, data)
  VALUES (
    p_user_id, 'waitlist', 'You''re in',
    'The host moved you off the waitlist: you''re going to "' || COALESCE(v_event.title, 'the event') || '".',
    p_event_id,
    jsonb_build_object('eventId', p_event_id, 'kind', 'waitlist_promoted')
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.host_promote_from_waitlist(uuid, uuid) TO authenticated;
