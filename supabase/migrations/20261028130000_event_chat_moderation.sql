-- Event chat moderation.
--  * Server-side ban enforcement and per-chat blocks (host or admin).
--  * Hosts and admins can read and moderate their chats; moderator deletes
--    resolve pending reports and are logged.
--  * Audit log of moderation actions; automatic hide after repeated reports.
--  * Admin report queue RPC; one report per user per message.
--  * Per-chat notification mute.

-- -----------------------------
-- 1. Helpers
-- -----------------------------
CREATE OR REPLACE FUNCTION user_is_banned(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM banned_users b WHERE b.user_id = p_user_id);
$$;

CREATE OR REPLACE FUNCTION user_is_event_host(event_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM events e
    JOIN businesses b ON b.id = e.business_id
    WHERE e.id = event_uuid
      AND b.owner_id = auth.uid()
  );
$$;

-- -----------------------------
-- 2. Per-chat blocks
-- -----------------------------
CREATE TABLE IF NOT EXISTS event_chat_blocks (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

ALTER TABLE event_chat_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Chat blocks visible to subject, host and admins" ON event_chat_blocks;
CREATE POLICY "Chat blocks visible to subject, host and admins"
  ON event_chat_blocks
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR is_admin_user() OR user_is_event_host(event_id));
-- Writes go through the RPCs below.

CREATE OR REPLACE FUNCTION user_is_blocked_from_event_chat(event_uuid uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM event_chat_blocks b
    WHERE b.event_id = event_uuid AND b.user_id = p_user_id
  );
$$;

-- -----------------------------
-- 3. Read/post rules
-- -----------------------------
DROP POLICY IF EXISTS "Going attendees can send active event chat messages" ON event_chat_messages;
CREATE POLICY "Going attendees can send active event chat messages"
  ON event_chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND deleted_at IS NULL
    AND user_can_access_event_chat(event_id)
    AND NOT user_is_banned(auth.uid())
    AND NOT user_is_blocked_from_event_chat(event_id, auth.uid())
  );

-- Hosts can read (and therefore moderate) their own event's chat even when
-- they are not attending. Posting still requires a "going" RSVP.
DROP POLICY IF EXISTS "Hosts can read own event chat" ON event_chat_messages;
CREATE POLICY "Hosts can read own event chat"
  ON event_chat_messages
  FOR SELECT
  TO authenticated
  USING (user_is_event_host(event_id));

-- -----------------------------
-- 4. Per-chat mute
-- -----------------------------
ALTER TABLE event_chat_reads ADD COLUMN IF NOT EXISTS muted boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION set_event_chat_muted(p_event_id uuid, p_muted boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO event_chat_reads (user_id, event_id, last_read_at, muted)
  VALUES (auth.uid(), p_event_id, 'epoch'::timestamptz, p_muted)
  ON CONFLICT (user_id, event_id)
  DO UPDATE SET muted = EXCLUDED.muted;
END;
$$;

-- Everything the client needs to render the composer and moderation controls.
CREATE OR REPLACE FUNCTION get_event_chat_post_status(event_uuid uuid)
RETURNS TABLE(
  can_read boolean,
  can_post boolean,
  is_banned boolean,
  is_blocked boolean,
  is_host boolean,
  is_admin boolean,
  muted boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (user_can_access_event_chat(event_uuid) OR user_is_event_host(event_uuid) OR is_admin_user()) AS can_read,
    (user_can_access_event_chat(event_uuid)
      AND NOT user_is_banned(auth.uid())
      AND NOT user_is_blocked_from_event_chat(event_uuid, auth.uid())) AS can_post,
    user_is_banned(auth.uid()) AS is_banned,
    user_is_blocked_from_event_chat(event_uuid, auth.uid()) AS is_blocked,
    user_is_event_host(event_uuid) AS is_host,
    is_admin_user() AS is_admin,
    COALESCE(
      (SELECT r.muted FROM event_chat_reads r WHERE r.event_id = event_uuid AND r.user_id = auth.uid()),
      false
    ) AS muted;
$$;

-- -----------------------------
-- 5. Audit log
-- -----------------------------
CREATE TABLE IF NOT EXISTS event_chat_moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  message_id uuid REFERENCES event_chat_messages(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  -- NULL actor = automatic (system) action.
  actor_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('delete', 'block', 'unblock', 'dismiss_reports', 'auto_hide')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_moderation_actions_event_created
  ON event_chat_moderation_actions(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_moderation_actions_created
  ON event_chat_moderation_actions(created_at DESC);

ALTER TABLE event_chat_moderation_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hosts and admins can read chat moderation log" ON event_chat_moderation_actions;
CREATE POLICY "Hosts and admins can read chat moderation log"
  ON event_chat_moderation_actions
  FOR SELECT
  TO authenticated
  USING (is_admin_user() OR user_is_event_host(event_id));

-- -----------------------------
-- 6. Block / unblock (host or admin)
-- -----------------------------
CREATE OR REPLACE FUNCTION block_event_chat_user(p_event_id uuid, p_user_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (is_admin_user() OR user_is_event_host(p_event_id)) THEN
    RAISE EXCEPTION 'Not allowed to moderate this chat';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot block yourself';
  END IF;

  INSERT INTO event_chat_blocks (event_id, user_id, blocked_by, reason)
  VALUES (p_event_id, p_user_id, auth.uid(), p_reason)
  ON CONFLICT (event_id, user_id)
  DO UPDATE SET blocked_by = EXCLUDED.blocked_by, reason = EXCLUDED.reason, created_at = now();

  INSERT INTO event_chat_moderation_actions (event_id, target_user_id, actor_id, action, reason)
  VALUES (p_event_id, p_user_id, auth.uid(), 'block', p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION unblock_event_chat_user(p_event_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (is_admin_user() OR user_is_event_host(p_event_id)) THEN
    RAISE EXCEPTION 'Not allowed to moderate this chat';
  END IF;

  DELETE FROM event_chat_blocks WHERE event_id = p_event_id AND user_id = p_user_id;

  INSERT INTO event_chat_moderation_actions (event_id, target_user_id, actor_id, action)
  VALUES (p_event_id, p_user_id, auth.uid(), 'unblock');
END;
$$;

-- -----------------------------
-- 7. Delete: sender, host or admin. Moderator deletes are logged and resolve
--    pending reports on the message.
-- -----------------------------
CREATE OR REPLACE FUNCTION delete_event_chat_message(p_message_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT m.id, m.event_id, m.sender_id, m.deleted_at
  INTO v_msg
  FROM event_chat_messages m
  WHERE m.id = p_message_id;

  IF v_msg.id IS NULL OR v_msg.deleted_at IS NOT NULL THEN
    RETURN false;
  END IF;

  IF NOT (v_msg.sender_id = auth.uid() OR is_admin_user() OR user_is_event_host(v_msg.event_id)) THEN
    RETURN false;
  END IF;

  UPDATE event_chat_messages SET deleted_at = now() WHERE id = p_message_id;

  IF v_msg.sender_id <> auth.uid() THEN
    INSERT INTO event_chat_moderation_actions (event_id, message_id, target_user_id, actor_id, action)
    VALUES (v_msg.event_id, p_message_id, v_msg.sender_id, auth.uid(), 'delete');

    UPDATE complaints
    SET status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
    WHERE target_type = 'chat_message' AND target_id = p_message_id AND status = 'pending';
  END IF;

  RETURN true;
END;
$$;

-- -----------------------------
-- 8. Reports: one per reporter per message; auto-hide after 3 reporters
-- -----------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_complaints_unique_chat_report
  ON complaints(reporter_id, target_id)
  WHERE target_type = 'chat_message';

CREATE OR REPLACE FUNCTION auto_hide_reported_chat_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reporters integer;
  v_msg record;
BEGIN
  IF NEW.target_type <> 'chat_message' THEN
    RETURN NEW;
  END IF;

  SELECT count(DISTINCT c.reporter_id) INTO v_reporters
  FROM complaints c
  WHERE c.target_type = 'chat_message' AND c.target_id = NEW.target_id;

  IF v_reporters >= 3 THEN
    SELECT m.id, m.event_id, m.sender_id, m.deleted_at INTO v_msg
    FROM event_chat_messages m WHERE m.id = NEW.target_id;

    IF v_msg.id IS NOT NULL AND v_msg.deleted_at IS NULL THEN
      UPDATE event_chat_messages SET deleted_at = now() WHERE id = v_msg.id;
      INSERT INTO event_chat_moderation_actions (event_id, message_id, target_user_id, actor_id, action, reason)
      VALUES (v_msg.event_id, v_msg.id, v_msg.sender_id, NULL, 'auto_hide',
              'Hidden automatically after ' || v_reporters || ' reports');
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_hide_reported_chat_message ON complaints;
CREATE TRIGGER trigger_auto_hide_reported_chat_message
  AFTER INSERT ON complaints
  FOR EACH ROW
  EXECUTE FUNCTION auto_hide_reported_chat_message();

-- -----------------------------
-- 9. Admin: report queue, dismissal, moderation log
-- -----------------------------
CREATE OR REPLACE FUNCTION admin_get_chat_reports(p_status text DEFAULT 'pending')
RETURNS TABLE(
  message_id uuid,
  event_id uuid,
  event_title text,
  sender_id uuid,
  sender_name text,
  body text,
  message_created_at timestamptz,
  deleted_at timestamptz,
  report_count integer,
  reasons text[],
  first_reported_at timestamptz,
  last_reported_at timestamptz,
  report_status text,
  sender_banned boolean,
  sender_blocked boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM (
    SELECT
      m.id AS message_id,
      m.event_id AS event_id,
      e.title AS event_title,
      m.sender_id AS sender_id,
      p.name AS sender_name,
      m.body AS body,
      m.created_at AS message_created_at,
      m.deleted_at AS deleted_at,
      count(c.id)::integer AS report_count,
      COALESCE(array_agg(DISTINCT c.reason) FILTER (WHERE c.reason IS NOT NULL), '{}'::text[]) AS reasons,
      min(c.created_at) AS first_reported_at,
      max(c.created_at) AS last_reported_at,
      CASE
        WHEN bool_or(c.status = 'pending') THEN 'pending'
        WHEN bool_or(c.status = 'resolved') THEN 'resolved'
        ELSE 'dismissed'
      END AS report_status,
      user_is_banned(m.sender_id) AS sender_banned,
      EXISTS (
        SELECT 1 FROM event_chat_blocks b
        WHERE b.event_id = m.event_id AND b.user_id = m.sender_id
      ) AS sender_blocked
    FROM complaints c
    JOIN event_chat_messages m ON m.id = c.target_id
    LEFT JOIN events e ON e.id = m.event_id
    LEFT JOIN profiles p ON p.id = m.sender_id
    WHERE c.target_type = 'chat_message'
      AND is_admin_user()
    GROUP BY m.id, m.event_id, e.title, m.sender_id, p.name, m.body, m.created_at, m.deleted_at
  ) agg
  WHERE p_status = 'all' OR agg.report_status = p_status
  ORDER BY agg.last_reported_at DESC;
$$;

CREATE OR REPLACE FUNCTION admin_dismiss_chat_reports(p_message_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_event_id uuid;
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  UPDATE complaints
  SET status = 'dismissed', resolved_by = auth.uid(), resolved_at = now()
  WHERE target_type = 'chat_message' AND target_id = p_message_id AND status = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  SELECT m.event_id INTO v_event_id FROM event_chat_messages m WHERE m.id = p_message_id;
  IF v_event_id IS NOT NULL THEN
    INSERT INTO event_chat_moderation_actions (event_id, message_id, actor_id, action)
    VALUES (v_event_id, p_message_id, auth.uid(), 'dismiss_reports');
  END IF;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION admin_get_chat_moderation_log(p_limit integer DEFAULT 50)
RETURNS TABLE(
  id uuid,
  event_id uuid,
  event_title text,
  message_id uuid,
  message_body text,
  target_user_id uuid,
  target_user_name text,
  actor_id uuid,
  actor_name text,
  action text,
  reason text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    a.event_id,
    e.title,
    a.message_id,
    m.body,
    a.target_user_id,
    tp.name,
    a.actor_id,
    ap.name,
    a.action,
    a.reason,
    a.created_at
  FROM event_chat_moderation_actions a
  LEFT JOIN events e ON e.id = a.event_id
  LEFT JOIN event_chat_messages m ON m.id = a.message_id
  LEFT JOIN profiles tp ON tp.id = a.target_user_id
  LEFT JOIN profiles ap ON ap.id = a.actor_id
  WHERE is_admin_user()
  ORDER BY a.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;

-- -----------------------------
-- 10. Notifications: respect per-chat mute (full redefinition)
-- -----------------------------
CREATE OR REPLACE FUNCTION notify_attendees_on_chat_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_title text;
  v_sender_name text;
  v_snippet text;
  v_recipient record;
BEGIN
  SELECT e.title INTO v_event_title FROM events e WHERE e.id = NEW.event_id;
  SELECT COALESCE(p.name, 'Someone') INTO v_sender_name FROM profiles p WHERE p.id = NEW.sender_id;
  v_snippet := left(NEW.body, 120) || CASE WHEN char_length(NEW.body) > 120 THEN '…' ELSE '' END;

  FOR v_recipient IN
    SELECT r.user_id
    FROM rsvps r
    JOIN profiles p ON p.id = r.user_id
    LEFT JOIN event_chat_reads cr
      ON cr.event_id = r.event_id AND cr.user_id = r.user_id
    WHERE r.event_id = NEW.event_id
      AND r.status = 'going'
      AND r.user_id <> NEW.sender_id
      AND COALESCE((p.notification_preferences->>'chat_message')::boolean, true)
      AND NOT COALESCE(cr.muted, false)
      -- Someone reading the chat right now sees the message live.
      AND (cr.last_read_at IS NULL OR cr.last_read_at < now() - interval '1 minute')
      -- At most one chat notification per event per recipient per 15 minutes.
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = r.user_id
          AND n.type = 'chat_message'
          AND n.event_id = NEW.event_id
          AND n.created_at > now() - interval '15 minutes'
      )
  LOOP
    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    VALUES (
      v_recipient.user_id,
      'chat_message',
      COALESCE(v_event_title, 'Event chat'),
      v_sender_name || ': ' || v_snippet,
      NEW.event_id,
      jsonb_build_object('eventId', NEW.event_id, 'kind', 'chat')
    );
  END LOOP;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NEW;
END;
$$;
