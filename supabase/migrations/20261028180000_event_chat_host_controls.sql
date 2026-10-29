-- Event chat host controls: lock chat, slow mode, timed blocks, host restore,
-- and the caller's read marker (for the "new messages" divider).

-- -----------------------------
-- 1. Per-chat settings
-- -----------------------------
CREATE TABLE IF NOT EXISTS event_chat_settings (
  event_id uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  locked boolean NOT NULL DEFAULT false,
  slow_mode_seconds integer NOT NULL DEFAULT 0 CHECK (slow_mode_seconds IN (0, 10, 30, 60, 300)),
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE event_chat_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Chat readers can see chat settings" ON event_chat_settings;
CREATE POLICY "Chat readers can see chat settings"
  ON event_chat_settings FOR SELECT TO authenticated
  USING (user_can_access_event_chat(event_id) OR user_is_event_host(event_id) OR is_admin_user());

ALTER TABLE event_chat_moderation_actions DROP CONSTRAINT IF EXISTS event_chat_moderation_actions_action_check;
ALTER TABLE event_chat_moderation_actions
  ADD CONSTRAINT event_chat_moderation_actions_action_check
  CHECK (action IN ('delete', 'block', 'unblock', 'dismiss_reports', 'resolve_reports', 'restore', 'auto_hide',
                    'lock', 'unlock', 'slow_mode'));

CREATE OR REPLACE FUNCTION set_event_chat_settings(p_event_id uuid, p_locked boolean DEFAULT NULL, p_slow_mode_seconds integer DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prev record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (is_admin_user() OR user_is_event_host(p_event_id)) THEN
    RAISE EXCEPTION 'Not allowed to moderate this chat';
  END IF;

  SELECT locked, slow_mode_seconds INTO v_prev FROM event_chat_settings WHERE event_id = p_event_id;

  INSERT INTO event_chat_settings (event_id, locked, slow_mode_seconds, updated_by, updated_at)
  VALUES (p_event_id, COALESCE(p_locked, false), COALESCE(p_slow_mode_seconds, 0), auth.uid(), now())
  ON CONFLICT (event_id) DO UPDATE SET
    locked = COALESCE(p_locked, event_chat_settings.locked),
    slow_mode_seconds = COALESCE(p_slow_mode_seconds, event_chat_settings.slow_mode_seconds),
    updated_by = auth.uid(),
    updated_at = now();

  IF p_locked IS NOT NULL AND p_locked IS DISTINCT FROM COALESCE(v_prev.locked, false) THEN
    INSERT INTO event_chat_moderation_actions (event_id, actor_id, action)
    VALUES (p_event_id, auth.uid(), CASE WHEN p_locked THEN 'lock' ELSE 'unlock' END);
  END IF;
  IF p_slow_mode_seconds IS NOT NULL AND p_slow_mode_seconds IS DISTINCT FROM COALESCE(v_prev.slow_mode_seconds, 0) THEN
    INSERT INTO event_chat_moderation_actions (event_id, actor_id, action, reason)
    VALUES (p_event_id, auth.uid(), 'slow_mode',
            CASE WHEN p_slow_mode_seconds = 0 THEN 'Slow mode off' ELSE 'Slow mode ' || p_slow_mode_seconds || 's' END);
  END IF;
END;
$$;

-- -----------------------------
-- 2. Timed blocks
-- -----------------------------
ALTER TABLE event_chat_blocks ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE OR REPLACE FUNCTION user_is_blocked_from_event_chat(event_uuid uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM event_chat_blocks b
    WHERE b.event_id = event_uuid AND b.user_id = p_user_id
      AND (b.expires_at IS NULL OR b.expires_at > now())
  );
$$;

CREATE OR REPLACE FUNCTION block_event_chat_user(p_event_id uuid, p_user_id uuid, p_reason text DEFAULT NULL, p_duration_minutes integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_expires timestamptz := CASE WHEN p_duration_minutes IS NULL OR p_duration_minutes <= 0 THEN NULL
                                ELSE now() + make_interval(mins => p_duration_minutes) END;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (is_admin_user() OR user_is_event_host(p_event_id)) THEN
    RAISE EXCEPTION 'Not allowed to moderate this chat';
  END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'Cannot block yourself'; END IF;

  INSERT INTO event_chat_blocks (event_id, user_id, blocked_by, reason, expires_at)
  VALUES (p_event_id, p_user_id, auth.uid(), p_reason, v_expires)
  ON CONFLICT (event_id, user_id)
  DO UPDATE SET blocked_by = EXCLUDED.blocked_by, reason = EXCLUDED.reason, expires_at = EXCLUDED.expires_at, created_at = now();

  INSERT INTO event_chat_moderation_actions (event_id, target_user_id, actor_id, action, reason)
  VALUES (p_event_id, p_user_id, auth.uid(), 'block',
          COALESCE(p_reason, '') || CASE WHEN v_expires IS NULL THEN '' ELSE ' (until ' || to_char(v_expires AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC)' END);
END;
$$;

-- -----------------------------
-- 3. Posting rules: lock + slow mode
-- -----------------------------
DROP POLICY IF EXISTS "Going attendees can send active event chat messages" ON event_chat_messages;
CREATE POLICY "Going attendees can send active event chat messages"
  ON event_chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND deleted_at IS NULL
    AND user_can_access_event_chat(event_id)
    AND NOT user_is_banned(auth.uid())
    AND NOT user_is_blocked_from_event_chat(event_id, auth.uid())
    AND (
      NOT COALESCE((SELECT s.locked FROM event_chat_settings s WHERE s.event_id = event_chat_messages.event_id), false)
      OR is_admin_user() OR user_is_event_host(event_id)
    )
  );

CREATE OR REPLACE FUNCTION enforce_event_chat_slow_mode()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_seconds integer;
  v_last timestamptz;
BEGIN
  SELECT s.slow_mode_seconds INTO v_seconds FROM event_chat_settings s WHERE s.event_id = NEW.event_id;
  IF COALESCE(v_seconds, 0) = 0 THEN RETURN NEW; END IF;
  IF is_admin_user() OR user_is_event_host(NEW.event_id) THEN RETURN NEW; END IF;

  SELECT max(m.created_at) INTO v_last
  FROM event_chat_messages m WHERE m.event_id = NEW.event_id AND m.sender_id = NEW.sender_id;
  IF v_last IS NOT NULL AND v_last > now() - make_interval(secs => v_seconds) THEN
    RAISE EXCEPTION 'chat_slow_mode' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_event_chat_slow_mode ON event_chat_messages;
CREATE TRIGGER trigger_event_chat_slow_mode
  BEFORE INSERT ON event_chat_messages FOR EACH ROW EXECUTE FUNCTION enforce_event_chat_slow_mode();

CREATE INDEX IF NOT EXISTS idx_event_chat_messages_event_sender_created
  ON event_chat_messages(event_id, sender_id, created_at DESC);

-- -----------------------------
-- 4. Post status with settings, block expiry, read marker
-- -----------------------------
DROP FUNCTION IF EXISTS get_event_chat_post_status(uuid);
CREATE FUNCTION get_event_chat_post_status(event_uuid uuid)
RETURNS TABLE(
  can_read boolean, can_post boolean, is_banned boolean, is_blocked boolean,
  is_host boolean, is_admin boolean, muted boolean,
  locked boolean, slow_mode_seconds integer, block_expires_at timestamptz,
  last_read_at timestamptz, last_post_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH s AS (
    SELECT COALESCE(st.locked, false) AS locked, COALESCE(st.slow_mode_seconds, 0) AS slow
    FROM (SELECT 1) one LEFT JOIN event_chat_settings st ON st.event_id = event_uuid
  ),
  roles AS (
    SELECT user_is_event_host(event_uuid) AS host, is_admin_user() AS admin,
           user_can_access_event_chat(event_uuid) AS attendee,
           user_is_banned(auth.uid()) AS banned,
           user_is_blocked_from_event_chat(event_uuid, auth.uid()) AS blocked
  )
  SELECT
    (roles.attendee OR roles.host OR roles.admin),
    (roles.attendee AND NOT roles.banned AND NOT roles.blocked AND (NOT s.locked OR roles.host OR roles.admin)),
    roles.banned, roles.blocked, roles.host, roles.admin,
    COALESCE((SELECT r.muted FROM event_chat_reads r WHERE r.event_id = event_uuid AND r.user_id = auth.uid()), false),
    s.locked, s.slow,
    (SELECT b.expires_at FROM event_chat_blocks b WHERE b.event_id = event_uuid AND b.user_id = auth.uid()),
    (SELECT NULLIF(r.last_read_at, 'epoch'::timestamptz) FROM event_chat_reads r WHERE r.event_id = event_uuid AND r.user_id = auth.uid()),
    (SELECT max(m.created_at) FROM event_chat_messages m WHERE m.event_id = event_uuid AND m.sender_id = auth.uid())
  FROM s, roles;
$$;

-- -----------------------------
-- 5. Restore by host or admin
-- -----------------------------
CREATE OR REPLACE FUNCTION restore_event_chat_message(p_message_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_msg record;
  v_body text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT m.id, m.event_id, m.sender_id, m.deleted_at INTO v_msg FROM event_chat_messages m WHERE m.id = p_message_id;
  IF v_msg.id IS NULL OR v_msg.deleted_at IS NULL THEN RETURN false; END IF;
  IF NOT (is_admin_user() OR user_is_event_host(v_msg.event_id)) THEN
    RAISE EXCEPTION 'Not allowed to moderate this chat';
  END IF;
  SELECT rb.body INTO v_body FROM event_chat_removed_bodies rb WHERE rb.message_id = p_message_id;
  IF v_body IS NULL THEN RETURN false; END IF;

  UPDATE event_chat_messages SET body = v_body, deleted_at = NULL, deleted_by = NULL WHERE id = p_message_id;
  DELETE FROM event_chat_removed_bodies WHERE message_id = p_message_id;
  UPDATE complaints SET status = 'dismissed', resolved_by = auth.uid(), resolved_at = now()
  WHERE target_type = 'chat_message' AND target_id = p_message_id AND status = 'pending';
  INSERT INTO event_chat_moderation_actions (event_id, message_id, target_user_id, actor_id, action)
  VALUES (v_msg.event_id, p_message_id, v_msg.sender_id, auth.uid(), 'restore');
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION admin_restore_chat_message(p_message_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Unauthorized: admin access required'; END IF;
  RETURN restore_event_chat_message(p_message_id);
END;
$$;

-- The earlier 3-argument signature would otherwise remain as an ambiguous overload.
DROP FUNCTION IF EXISTS block_event_chat_user(uuid, uuid, text);
