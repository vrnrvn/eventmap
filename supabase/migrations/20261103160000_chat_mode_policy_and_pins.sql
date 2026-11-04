-- Phase 3 (continued): chat mode, open policy, pinned message (plan §4F).
--
-- STATUS: prepared, NOT applied to the shared local DB (another dev session
-- owns it). Validated on an isolated scratch copy only. Apply after
-- 20261103150000_event_publishing_and_lifecycle.sql.
--
--   1. event_chat_settings gains:
--        chat_mode   'open' (default) | 'announcements' | 'off'
--                    announcements = attendees read, only host/admins post
--                    (what `locked` meant); off = no chat at all.
--        open_policy 'two_going' (default, today's rule) | 'any_going'
--                    (chat works from the first going attendee — hosts of
--                    bigger events open it before the room fills).
--        pinned_message_id  one pinned message per event.
--      `locked` is kept in sync (locked = chat_mode <> 'open') so clients
--      built before this migration still render the right read-only state,
--      and set_event_chat_settings(p_locked) maps onto chat_mode.
--   2. user_can_access_event_chat honours both: mode 'off' closes the chat
--      for attendees (hosts/admins keep their moderation access through
--      user_is_event_host / is_admin_user as before); 'any_going' drops the
--      second-attendee requirement.
--   3. Posting: attendees only in 'open'; host/admins unless 'off'.
--   4. set_event_chat_mode(p_event_id, p_chat_mode, p_open_policy) and
--      set_event_chat_pin(p_event_id, p_message_id) (NULL unpins), both
--      host/admin, both logged in the moderation log.
--   5. get_event_chat_post_status returns chat_mode, open_policy and
--      pinned_message_id (return type changes, so the old function is
--      dropped; clients treat the new fields as optional).
--   6. send_event_announcement pins its chat mirror, so the latest
--      announcement is the pinned message.

-- 1. Columns -----------------------------------------------------------------

ALTER TABLE public.event_chat_settings
  ADD COLUMN IF NOT EXISTS chat_mode text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS open_policy text NOT NULL DEFAULT 'two_going',
  ADD COLUMN IF NOT EXISTS pinned_message_id uuid REFERENCES event_chat_messages(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.event_chat_settings
    ADD CONSTRAINT event_chat_settings_chat_mode_check CHECK (chat_mode IN ('open', 'announcements', 'off'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.event_chat_settings
    ADD CONSTRAINT event_chat_settings_open_policy_check CHECK (open_policy IN ('two_going', 'any_going'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Rows written while only `locked` existed: carry the state over once.
UPDATE public.event_chat_settings SET chat_mode = 'announcements' WHERE locked AND chat_mode = 'open';

ALTER TABLE public.event_chat_moderation_actions DROP CONSTRAINT IF EXISTS event_chat_moderation_actions_action_check;
ALTER TABLE public.event_chat_moderation_actions
  ADD CONSTRAINT event_chat_moderation_actions_action_check
  CHECK (action IN ('delete', 'block', 'unblock', 'dismiss_reports', 'resolve_reports', 'restore', 'auto_hide',
                    'lock', 'unlock', 'slow_mode', 'mode', 'open_policy', 'pin', 'unpin'));

-- 2. Access ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.user_can_access_event_chat(event_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND COALESCE((SELECT s.chat_mode FROM event_chat_settings s WHERE s.event_id = event_uuid), 'open') <> 'off'
    AND EXISTS (
      SELECT 1 FROM rsvps r
      WHERE r.event_id = event_uuid
        AND r.user_id = auth.uid()
        AND r.status = 'going'
    )
    AND (
      COALESCE((SELECT s.open_policy FROM event_chat_settings s WHERE s.event_id = event_uuid), 'two_going') = 'any_going'
      OR EXISTS (
        SELECT 1 FROM rsvps r
        WHERE r.event_id = event_uuid
          AND r.status = 'going'
          AND r.user_id <> auth.uid()
      )
    );
$function$;

-- 3. Posting -------------------------------------------------------------------

DROP POLICY IF EXISTS "Going attendees can send active event chat messages" ON event_chat_messages;
CREATE POLICY "Going attendees can send active event chat messages"
  ON event_chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND deleted_at IS NULL
    AND (user_can_access_event_chat(event_id) OR user_is_event_host(event_id))
    AND NOT user_is_banned(auth.uid())
    AND NOT user_is_blocked_from_event_chat(event_id, auth.uid())
    AND (
      -- Attendees post in 'open'; host/admins post unless 'off'.
      CASE COALESCE((SELECT s.chat_mode FROM event_chat_settings s WHERE s.event_id = event_chat_messages.event_id), 'open')
        WHEN 'open' THEN true
        WHEN 'announcements' THEN is_admin_user() OR user_is_event_host(event_id)
        ELSE false
      END
    )
  );

-- 4. Host controls ---------------------------------------------------------------

-- Old clients: p_locked maps onto chat_mode (true → announcements, false →
-- open) unless the host has switched the chat off entirely.
CREATE OR REPLACE FUNCTION public.set_event_chat_settings(p_event_id uuid, p_locked boolean DEFAULT NULL, p_slow_mode_seconds integer DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prev record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (is_admin_user() OR user_is_event_host(p_event_id)) THEN
    RAISE EXCEPTION 'Not allowed to moderate this chat';
  END IF;

  SELECT locked, slow_mode_seconds, chat_mode INTO v_prev FROM event_chat_settings WHERE event_id = p_event_id;

  INSERT INTO event_chat_settings (event_id, locked, chat_mode, slow_mode_seconds, updated_by, updated_at)
  VALUES (
    p_event_id,
    COALESCE(p_locked, false),
    CASE WHEN COALESCE(p_locked, false) THEN 'announcements' ELSE 'open' END,
    COALESCE(p_slow_mode_seconds, 0),
    auth.uid(),
    now()
  )
  ON CONFLICT (event_id) DO UPDATE SET
    -- An 'off' chat ignores the legacy lock entirely: both mode and locked
    -- stay put so the locked = (mode <> 'open') invariant holds.
    chat_mode = CASE
      WHEN p_locked IS NULL OR event_chat_settings.chat_mode = 'off' THEN event_chat_settings.chat_mode
      WHEN p_locked THEN 'announcements'
      ELSE 'open'
    END,
    locked = (CASE
      WHEN p_locked IS NULL OR event_chat_settings.chat_mode = 'off' THEN event_chat_settings.chat_mode
      WHEN p_locked THEN 'announcements'
      ELSE 'open'
    END) <> 'open',
    slow_mode_seconds = COALESCE(p_slow_mode_seconds, event_chat_settings.slow_mode_seconds),
    updated_by = auth.uid(),
    updated_at = now();

  IF p_locked IS NOT NULL AND COALESCE(v_prev.chat_mode, 'open') <> 'off'
     AND p_locked IS DISTINCT FROM COALESCE(v_prev.locked, false) THEN
    INSERT INTO event_chat_moderation_actions (event_id, actor_id, action)
    VALUES (p_event_id, auth.uid(), CASE WHEN p_locked THEN 'lock' ELSE 'unlock' END);
  END IF;
  IF p_slow_mode_seconds IS NOT NULL AND p_slow_mode_seconds IS DISTINCT FROM COALESCE(v_prev.slow_mode_seconds, 0) THEN
    INSERT INTO event_chat_moderation_actions (event_id, actor_id, action, reason)
    VALUES (p_event_id, auth.uid(), 'slow_mode',
            CASE WHEN p_slow_mode_seconds = 0 THEN 'Slow mode off' ELSE 'Slow mode ' || p_slow_mode_seconds || 's' END);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_event_chat_mode(
  p_event_id uuid,
  p_chat_mode text DEFAULT NULL,
  p_open_policy text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prev record;
  v_row event_chat_settings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT (is_admin_user() OR user_is_event_host(p_event_id)) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can change chat settings';
  END IF;
  IF p_chat_mode IS NOT NULL AND p_chat_mode NOT IN ('open', 'announcements', 'off') THEN
    RAISE EXCEPTION 'invalid_chat_mode';
  END IF;
  IF p_open_policy IS NOT NULL AND p_open_policy NOT IN ('two_going', 'any_going') THEN
    RAISE EXCEPTION 'invalid_open_policy';
  END IF;

  SELECT chat_mode, open_policy INTO v_prev FROM event_chat_settings WHERE event_id = p_event_id;

  INSERT INTO event_chat_settings (event_id, chat_mode, open_policy, locked, updated_by, updated_at)
  VALUES (
    p_event_id,
    COALESCE(p_chat_mode, 'open'),
    COALESCE(p_open_policy, 'two_going'),
    COALESCE(p_chat_mode, 'open') <> 'open',
    auth.uid(),
    now()
  )
  ON CONFLICT (event_id) DO UPDATE SET
    chat_mode = COALESCE(p_chat_mode, event_chat_settings.chat_mode),
    open_policy = COALESCE(p_open_policy, event_chat_settings.open_policy),
    locked = COALESCE(p_chat_mode, event_chat_settings.chat_mode) <> 'open',
    updated_by = auth.uid(),
    updated_at = now()
  RETURNING * INTO v_row;

  IF p_chat_mode IS NOT NULL AND p_chat_mode IS DISTINCT FROM COALESCE(v_prev.chat_mode, 'open') THEN
    INSERT INTO event_chat_moderation_actions (event_id, actor_id, action, reason)
    VALUES (p_event_id, auth.uid(), 'mode', 'Chat mode: ' || p_chat_mode);
  END IF;
  IF p_open_policy IS NOT NULL AND p_open_policy IS DISTINCT FROM COALESCE(v_prev.open_policy, 'two_going') THEN
    INSERT INTO event_chat_moderation_actions (event_id, actor_id, action, reason)
    VALUES (p_event_id, auth.uid(), 'open_policy',
            CASE WHEN p_open_policy = 'any_going' THEN 'Chat opens with the first attendee' ELSE 'Chat opens at two attendees' END);
  END IF;

  RETURN json_build_object('chat_mode', v_row.chat_mode, 'open_policy', v_row.open_policy);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_event_chat_mode(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_event_chat_mode(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_event_chat_pin(p_event_id uuid, p_message_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT (is_admin_user() OR user_is_event_host(p_event_id)) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can pin messages';
  END IF;
  IF p_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM event_chat_messages m
    WHERE m.id = p_message_id AND m.event_id = p_event_id AND m.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'message_not_found';
  END IF;

  INSERT INTO event_chat_settings (event_id, pinned_message_id, updated_by, updated_at)
  VALUES (p_event_id, p_message_id, auth.uid(), now())
  ON CONFLICT (event_id) DO UPDATE SET
    pinned_message_id = p_message_id,
    updated_by = auth.uid(),
    updated_at = now();

  INSERT INTO event_chat_moderation_actions (event_id, actor_id, action)
  VALUES (p_event_id, auth.uid(), CASE WHEN p_message_id IS NULL THEN 'unpin' ELSE 'pin' END);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_event_chat_pin(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_event_chat_pin(uuid, uuid) TO authenticated;

-- A deleted message must not stay pinned (RPC delete path and admin path both
-- set deleted_at with UPDATE, so a trigger catches every route).
CREATE OR REPLACE FUNCTION public.unpin_deleted_chat_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE event_chat_settings
    SET pinned_message_id = NULL
    WHERE event_id = NEW.event_id AND pinned_message_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_unpin_deleted_chat_message ON event_chat_messages;
CREATE TRIGGER trigger_unpin_deleted_chat_message
  AFTER UPDATE OF deleted_at ON event_chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION unpin_deleted_chat_message();

-- 5. Post status --------------------------------------------------------------
-- Return type grows, so the old signature must go first.

DROP FUNCTION IF EXISTS public.get_event_chat_post_status(uuid);

CREATE FUNCTION public.get_event_chat_post_status(event_uuid uuid)
RETURNS TABLE(
  can_read boolean, can_post boolean, is_banned boolean, is_blocked boolean,
  is_host boolean, is_admin boolean, muted boolean, locked boolean,
  slow_mode_seconds integer, block_expires_at timestamp with time zone,
  last_read_at timestamp with time zone, last_post_at timestamp with time zone,
  chat_mode text, open_policy text, pinned_message_id uuid
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH s AS (
    SELECT COALESCE(st.locked, false) AS locked,
           COALESCE(st.slow_mode_seconds, 0) AS slow,
           COALESCE(st.chat_mode, 'open') AS mode,
           COALESCE(st.open_policy, 'two_going') AS policy,
           st.pinned_message_id AS pinned
    FROM (SELECT 1) one LEFT JOIN event_chat_settings st ON st.event_id = event_uuid
  ),
  roles AS (
    SELECT user_is_event_host(event_uuid) AS host, is_admin_user() AS admin,
           user_can_access_event_chat(event_uuid) AS attendee,
           user_is_banned(auth.uid()) AS banned,
           user_is_blocked_from_event_chat(event_uuid, auth.uid()) AS blocked
  )
  SELECT
    -- Mode 'off' hides the chat from attendees (user_can_access_event_chat
    -- already returns false for them); host/admin keep read access so the
    -- history and moderation tools stay reachable.
    (roles.attendee OR roles.host OR roles.admin),
    ((roles.attendee OR roles.host) AND NOT roles.banned AND NOT roles.blocked
      AND (s.mode = 'open' OR (s.mode = 'announcements' AND (roles.host OR roles.admin)))),
    roles.banned, roles.blocked, roles.host, roles.admin,
    COALESCE((SELECT r.muted FROM event_chat_reads r WHERE r.event_id = event_uuid AND r.user_id = auth.uid()), false),
    s.locked, s.slow,
    (SELECT b.expires_at FROM event_chat_blocks b WHERE b.event_id = event_uuid AND b.user_id = auth.uid()),
    (SELECT NULLIF(r.last_read_at, 'epoch'::timestamptz) FROM event_chat_reads r WHERE r.event_id = event_uuid AND r.user_id = auth.uid()),
    (SELECT max(m.created_at) FROM event_chat_messages m WHERE m.event_id = event_uuid AND m.sender_id = auth.uid()),
    s.mode, s.policy, s.pinned
  FROM s, roles;
$function$;

GRANT EXECUTE ON FUNCTION public.get_event_chat_post_status(uuid) TO authenticated;

-- Anyone who can read the chat may read the pinned message even before they
-- scroll to it; the SELECT policy on messages already allows exactly that,
-- so no change is needed there.

-- 6. Announcements pin their chat mirror ---------------------------------------
-- Body identical to 20261103130000 apart from the pin of the mirrored message.

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
  v_mirror_id uuid;
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

  -- Mirror into the chat and pin it, so late joiners see the latest
  -- announcement without scrolling. SECURITY DEFINER bypasses the posting
  -- policy, so the mode check is explicit: a switched-off chat gets no
  -- mirror (attendees could never read it). Trigger failures (rate limits)
  -- stay best-effort.
  BEGIN
    IF COALESCE((SELECT cs.chat_mode FROM event_chat_settings cs WHERE cs.event_id = p_event_id), 'open') <> 'off' THEN
    INSERT INTO event_chat_messages (event_id, sender_id, body, mentions)
    VALUES (p_event_id, auth.uid(), '📣 ' || v_body, '{}')
    RETURNING id INTO v_mirror_id;

    INSERT INTO event_chat_settings (event_id, pinned_message_id, updated_by, updated_at)
    VALUES (p_event_id, v_mirror_id, auth.uid(), now())
    ON CONFLICT (event_id) DO UPDATE SET
      pinned_message_id = v_mirror_id,
      updated_by = auth.uid(),
      updated_at = now();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN json_build_object('id', v_announcement_id, 'recipients', v_recipients, 'sent_today', v_today + 1);
END;
$function$;
