-- Event chat: deleted-message tombstones, @mentions, admin report details.

-- -----------------------------
-- 1. Schema
-- -----------------------------
ALTER TABLE event_chat_messages
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mentions uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE event_chat_messages DROP CONSTRAINT IF EXISTS event_chat_messages_mentions_limit;
ALTER TABLE event_chat_messages
  ADD CONSTRAINT event_chat_messages_mentions_limit CHECK (cardinality(mentions) <= 20);

CREATE INDEX IF NOT EXISTS idx_event_chat_messages_mentions
  ON event_chat_messages USING gin (mentions);

-- -----------------------------
-- 2. Reads that mask removed content. SECURITY INVOKER: RLS still decides
--    which rows the caller may see; the body of removed messages is never
--    sent, only the fact that a message was removed and by whom (role).
-- -----------------------------
CREATE OR REPLACE FUNCTION get_event_chat_messages(
  event_uuid uuid,
  p_limit integer DEFAULT 100,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  event_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid,
  mentions uuid[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    m.id, m.event_id, m.sender_id,
    CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body,
    m.created_at, m.deleted_at, m.deleted_by, m.mentions
  FROM event_chat_messages m
  WHERE m.event_id = event_uuid
    AND (
      p_before_created_at IS NULL
      OR m.created_at < p_before_created_at
      OR (m.created_at = p_before_created_at AND p_before_id IS NOT NULL AND m.id < p_before_id)
    )
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 200));
$$;

CREATE OR REPLACE FUNCTION get_event_chat_messages_since(
  event_uuid uuid,
  p_since timestamptz,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(
  id uuid,
  event_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid,
  mentions uuid[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    m.id, m.event_id, m.sender_id,
    CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body,
    m.created_at, m.deleted_at, m.deleted_by, m.mentions
  FROM event_chat_messages m
  WHERE m.event_id = event_uuid
    AND m.created_at >= p_since
  ORDER BY m.created_at ASC, m.id ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 200));
$$;

-- -----------------------------
-- 3. Record who removed a message
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

  UPDATE event_chat_messages
  SET deleted_at = now(), deleted_by = auth.uid()
  WHERE id = p_message_id;

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

CREATE OR REPLACE FUNCTION admin_restore_chat_message(p_message_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg record;
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  SELECT m.id, m.event_id, m.sender_id, m.deleted_at INTO v_msg
  FROM event_chat_messages m WHERE m.id = p_message_id;
  IF v_msg.id IS NULL OR v_msg.deleted_at IS NULL THEN
    RETURN false;
  END IF;

  UPDATE event_chat_messages SET deleted_at = NULL, deleted_by = NULL WHERE id = p_message_id;

  UPDATE complaints
  SET status = 'dismissed', resolved_by = auth.uid(), resolved_at = now()
  WHERE target_type = 'chat_message' AND target_id = p_message_id AND status = 'pending';

  INSERT INTO event_chat_moderation_actions (event_id, message_id, target_user_id, actor_id, action)
  VALUES (v_msg.event_id, p_message_id, v_msg.sender_id, auth.uid(), 'restore');

  RETURN true;
END;
$$;

-- -----------------------------
-- 4. Notifications: mentions bypass the per-chat throttle and mute
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

  -- Mentioned attendees: always notified (unless reading live or opted out).
  FOR v_recipient IN
    SELECT r.user_id
    FROM rsvps r
    JOIN profiles p ON p.id = r.user_id
    LEFT JOIN event_chat_reads cr
      ON cr.event_id = r.event_id AND cr.user_id = r.user_id
    WHERE r.event_id = NEW.event_id
      AND r.status = 'going'
      AND r.user_id <> NEW.sender_id
      AND r.user_id = ANY(NEW.mentions)
      AND COALESCE((p.notification_preferences->>'chat_message')::boolean, true)
      AND (cr.last_read_at IS NULL OR cr.last_read_at < now() - interval '1 minute')
  LOOP
    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    VALUES (
      v_recipient.user_id,
      'chat_mention',
      v_sender_name || ' mentioned you in ' || COALESCE(v_event_title, 'an event chat'),
      v_snippet,
      NEW.event_id,
      jsonb_build_object('eventId', NEW.event_id, 'kind', 'chat', 'messageId', NEW.id)
    );
  END LOOP;

  -- Everyone else: throttled, mute-aware.
  FOR v_recipient IN
    SELECT r.user_id
    FROM rsvps r
    JOIN profiles p ON p.id = r.user_id
    LEFT JOIN event_chat_reads cr
      ON cr.event_id = r.event_id AND cr.user_id = r.user_id
    WHERE r.event_id = NEW.event_id
      AND r.status = 'going'
      AND r.user_id <> NEW.sender_id
      AND NOT (r.user_id = ANY(NEW.mentions))
      AND COALESCE((p.notification_preferences->>'chat_message')::boolean, true)
      AND NOT COALESCE(cr.muted, false)
      AND (cr.last_read_at IS NULL OR cr.last_read_at < now() - interval '1 minute')
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = r.user_id
          AND n.type IN ('chat_message', 'chat_mention')
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

-- -----------------------------
-- 5. Admin: report details (reporters + surrounding context) and a cheap
--    pending count for the sidebar badge
-- -----------------------------
CREATE OR REPLACE FUNCTION admin_get_chat_report_details(p_message_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN is_admin_user() THEN json_build_object(
    'reporters', COALESCE((
      SELECT json_agg(json_build_object(
        'reporter_id', c.reporter_id,
        'reporter_name', rp.name,
        'reason', c.reason,
        'status', c.status,
        'created_at', c.created_at,
        'reporter_total_reports', (SELECT count(*) FROM complaints c2 WHERE c2.reporter_id = c.reporter_id)
      ) ORDER BY c.created_at ASC)
      FROM complaints c
      LEFT JOIN profiles rp ON rp.id = c.reporter_id
      WHERE c.target_type = 'chat_message' AND c.target_id = p_message_id
    ), '[]'::json),
    'context', COALESCE((
      SELECT json_agg(json_build_object(
        'id', x.id,
        'sender_name', sp.name,
        'body', CASE WHEN x.deleted_at IS NULL THEN x.body ELSE '' END,
        'created_at', x.created_at,
        'deleted_at', x.deleted_at,
        'is_target', x.id = p_message_id
      ) ORDER BY x.created_at ASC)
      FROM (
        (SELECT m2.* FROM event_chat_messages m2, event_chat_messages t
          WHERE t.id = p_message_id AND m2.event_id = t.event_id AND m2.created_at < t.created_at
          ORDER BY m2.created_at DESC LIMIT 3)
        UNION ALL
        (SELECT m2.* FROM event_chat_messages m2 WHERE m2.id = p_message_id)
        UNION ALL
        (SELECT m2.* FROM event_chat_messages m2, event_chat_messages t
          WHERE t.id = p_message_id AND m2.event_id = t.event_id AND m2.created_at > t.created_at
          ORDER BY m2.created_at ASC LIMIT 3)
      ) x
      LEFT JOIN profiles sp ON sp.id = x.sender_id
    ), '[]'::json),
    'sender_history', (
      SELECT json_build_object(
        'messages_total', (SELECT count(*) FROM event_chat_messages m WHERE m.sender_id = t.sender_id),
        'messages_removed', (SELECT count(*) FROM event_chat_messages m WHERE m.sender_id = t.sender_id AND m.deleted_at IS NOT NULL),
        'reports_received', (SELECT count(*) FROM complaints c JOIN event_chat_messages m ON m.id = c.target_id
                               WHERE c.target_type = 'chat_message' AND m.sender_id = t.sender_id),
        'blocks', (SELECT count(*) FROM event_chat_blocks b WHERE b.user_id = t.sender_id)
      )
      FROM event_chat_messages t WHERE t.id = p_message_id
    )
  ) ELSE NULL END;
$$;

CREATE OR REPLACE FUNCTION admin_count_pending_chat_reports()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN is_admin_user() THEN (
    SELECT count(DISTINCT c.target_id)::integer
    FROM complaints c
    WHERE c.target_type = 'chat_message' AND c.status = 'pending'
  ) ELSE 0 END;
$$;
