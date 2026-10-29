-- Event chat moderation hardening, round 2.
--  * Removed message bodies move to an admin-only table, so they cannot be
--    read through the table API or realtime payloads after removal.
--  * Mentions are sanitized on insert (going attendees only, no self) and
--    mention notifications are throttled per sender→recipient.
--  * Hosts can see and act on reports in their own event's chat.

-- -----------------------------
-- 1. Removed bodies (admin-only)
-- -----------------------------
CREATE TABLE IF NOT EXISTS event_chat_removed_bodies (
  message_id uuid PRIMARY KEY REFERENCES event_chat_messages(id) ON DELETE CASCADE,
  body text NOT NULL,
  removed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE event_chat_removed_bodies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can read removed chat bodies" ON event_chat_removed_bodies;
CREATE POLICY "Admins can read removed chat bodies"
  ON event_chat_removed_bodies FOR SELECT TO authenticated USING (is_admin_user());

CREATE OR REPLACE FUNCTION stash_removed_chat_body(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO event_chat_removed_bodies (message_id, body)
  SELECT m.id, m.body FROM event_chat_messages m WHERE m.id = p_message_id AND m.body <> ''
  ON CONFLICT (message_id) DO UPDATE SET body = EXCLUDED.body, removed_at = now();
  UPDATE event_chat_messages SET body = '' WHERE id = p_message_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION stash_removed_chat_body(uuid) FROM PUBLIC, anon, authenticated;

-- Body length check must allow the blanked body of removed rows.
ALTER TABLE event_chat_messages DROP CONSTRAINT IF EXISTS event_chat_messages_body_length;
ALTER TABLE event_chat_messages
  ADD CONSTRAINT event_chat_messages_body_length CHECK (
    (deleted_at IS NOT NULL AND body = '') OR char_length(btrim(body)) BETWEEN 1 AND 1000
  );

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
  INTO v_msg FROM event_chat_messages m WHERE m.id = p_message_id;

  IF v_msg.id IS NULL OR v_msg.deleted_at IS NOT NULL THEN
    RETURN false;
  END IF;
  IF NOT (v_msg.sender_id = auth.uid() OR is_admin_user() OR user_is_event_host(v_msg.event_id)) THEN
    RETURN false;
  END IF;

  UPDATE event_chat_messages SET deleted_at = now(), deleted_by = auth.uid() WHERE id = p_message_id;
  PERFORM stash_removed_chat_body(p_message_id);

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
  WHERE c.target_type = 'chat_message' AND c.target_id = NEW.target_id AND c.status = 'pending';

  IF v_reporters >= 3 THEN
    SELECT m.id, m.event_id, m.sender_id, m.deleted_at INTO v_msg
    FROM event_chat_messages m WHERE m.id = NEW.target_id;
    IF v_msg.id IS NOT NULL AND v_msg.deleted_at IS NULL THEN
      UPDATE event_chat_messages SET deleted_at = now(), deleted_by = NULL WHERE id = v_msg.id;
      PERFORM stash_removed_chat_body(v_msg.id);
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

CREATE OR REPLACE FUNCTION admin_restore_chat_message(p_message_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg record;
  v_body text;
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;
  SELECT m.id, m.event_id, m.sender_id, m.deleted_at INTO v_msg
  FROM event_chat_messages m WHERE m.id = p_message_id;
  IF v_msg.id IS NULL OR v_msg.deleted_at IS NULL THEN
    RETURN false;
  END IF;
  SELECT rb.body INTO v_body FROM event_chat_removed_bodies rb WHERE rb.message_id = p_message_id;
  IF v_body IS NULL THEN
    RETURN false;
  END IF;

  UPDATE event_chat_messages SET body = v_body, deleted_at = NULL, deleted_by = NULL WHERE id = p_message_id;
  DELETE FROM event_chat_removed_bodies WHERE message_id = p_message_id;

  UPDATE complaints
  SET status = 'dismissed', resolved_by = auth.uid(), resolved_at = now()
  WHERE target_type = 'chat_message' AND target_id = p_message_id AND status = 'pending';
  INSERT INTO event_chat_moderation_actions (event_id, message_id, target_user_id, actor_id, action)
  VALUES (v_msg.event_id, p_message_id, v_msg.sender_id, auth.uid(), 'restore');
  RETURN true;
END;
$$;

-- Admin views read the stashed body for removed messages.
CREATE OR REPLACE FUNCTION admin_get_chat_reports(p_status text DEFAULT 'pending')
RETURNS TABLE(
  message_id uuid, event_id uuid, event_title text, sender_id uuid, sender_name text, body text,
  message_created_at timestamptz, deleted_at timestamptz, report_count integer, reasons text[],
  first_reported_at timestamptz, last_reported_at timestamptz, report_status text,
  sender_banned boolean, sender_blocked boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM (
    SELECT
      m.id, m.event_id, e.title, m.sender_id, p.name,
      COALESCE(NULLIF(m.body, ''), rb.body, '') AS body,
      m.created_at, m.deleted_at,
      count(c.id)::integer,
      COALESCE(array_agg(DISTINCT c.reason) FILTER (WHERE c.reason IS NOT NULL), '{}'::text[]),
      min(c.created_at), max(c.created_at),
      CASE WHEN bool_or(c.status = 'pending') THEN 'pending'
           WHEN bool_or(c.status = 'resolved') THEN 'resolved' ELSE 'dismissed' END,
      user_is_banned(m.sender_id),
      EXISTS (SELECT 1 FROM event_chat_blocks b WHERE b.event_id = m.event_id AND b.user_id = m.sender_id)
    FROM complaints c
    JOIN event_chat_messages m ON m.id = c.target_id
    LEFT JOIN event_chat_removed_bodies rb ON rb.message_id = m.id
    LEFT JOIN events e ON e.id = m.event_id
    LEFT JOIN profiles p ON p.id = m.sender_id
    WHERE c.target_type = 'chat_message' AND is_admin_user()
    GROUP BY m.id, m.event_id, e.title, m.sender_id, p.name, m.body, rb.body, m.created_at, m.deleted_at
  ) agg(message_id, event_id, event_title, sender_id, sender_name, body, message_created_at, deleted_at,
        report_count, reasons, first_reported_at, last_reported_at, report_status, sender_banned, sender_blocked)
  WHERE p_status = 'all' OR agg.report_status = p_status
  ORDER BY agg.last_reported_at DESC;
$$;

CREATE OR REPLACE FUNCTION admin_get_chat_report_details(p_message_id uuid)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE WHEN is_admin_user() THEN json_build_object(
    'reporters', COALESCE((
      SELECT json_agg(json_build_object(
        'reporter_id', c.reporter_id, 'reporter_name', rp.name, 'reason', c.reason, 'status', c.status,
        'created_at', c.created_at,
        'reporter_total_reports', (SELECT count(*) FROM complaints c2 WHERE c2.reporter_id = c.reporter_id)
      ) ORDER BY c.created_at ASC)
      FROM complaints c LEFT JOIN profiles rp ON rp.id = c.reporter_id
      WHERE c.target_type = 'chat_message' AND c.target_id = p_message_id
    ), '[]'::json),
    'context', COALESCE((
      SELECT json_agg(json_build_object(
        'id', x.id, 'sender_name', sp.name,
        'body', COALESCE(NULLIF(x.body, ''), rb.body, ''),
        'created_at', x.created_at, 'deleted_at', x.deleted_at, 'is_target', x.id = p_message_id
      ) ORDER BY x.created_at ASC)
      FROM (
        (SELECT m2.* FROM event_chat_messages m2, event_chat_messages t
          WHERE t.id = p_message_id AND m2.event_id = t.event_id AND m2.created_at < t.created_at
          ORDER BY m2.created_at DESC LIMIT 3)
        UNION ALL (SELECT m2.* FROM event_chat_messages m2 WHERE m2.id = p_message_id)
        UNION ALL
        (SELECT m2.* FROM event_chat_messages m2, event_chat_messages t
          WHERE t.id = p_message_id AND m2.event_id = t.event_id AND m2.created_at > t.created_at
          ORDER BY m2.created_at ASC LIMIT 3)
      ) x
      LEFT JOIN profiles sp ON sp.id = x.sender_id
      LEFT JOIN event_chat_removed_bodies rb ON rb.message_id = x.id
    ), '[]'::json),
    'sender_history', (
      SELECT json_build_object(
        'messages_total', (SELECT count(*) FROM event_chat_messages m WHERE m.sender_id = t.sender_id),
        'messages_removed', (SELECT count(*) FROM event_chat_messages m WHERE m.sender_id = t.sender_id AND m.deleted_at IS NOT NULL),
        'reports_received', (SELECT count(*) FROM complaints c JOIN event_chat_messages m ON m.id = c.target_id
                               WHERE c.target_type = 'chat_message' AND m.sender_id = t.sender_id),
        'blocks', (SELECT count(*) FROM event_chat_blocks b WHERE b.user_id = t.sender_id)
      ) FROM event_chat_messages t WHERE t.id = p_message_id
    )
  ) ELSE NULL END;
$$;

-- -----------------------------
-- 2. Mentions: sanitize on insert, throttle notifications
-- -----------------------------
CREATE OR REPLACE FUNCTION sanitize_event_chat_mentions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.mentions IS NULL OR cardinality(NEW.mentions) = 0 THEN
    NEW.mentions := '{}';
    RETURN NEW;
  END IF;
  -- Only people going to this event (never yourself) can be mentioned.
  NEW.mentions := ARRAY(
    SELECT DISTINCT u
    FROM unnest(NEW.mentions) AS u
    JOIN rsvps r ON r.user_id = u AND r.event_id = NEW.event_id AND r.status = 'going'
    WHERE u <> NEW.sender_id
    LIMIT 20
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_sanitize_event_chat_mentions ON event_chat_messages;
CREATE TRIGGER trigger_sanitize_event_chat_mentions
  BEFORE INSERT ON event_chat_messages
  FOR EACH ROW EXECUTE FUNCTION sanitize_event_chat_mentions();

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

  -- Mentions bypass the per-chat throttle and mute, but one sender can only
  -- ping a given person once every 5 minutes per event, and a recipient gets
  -- at most 3 mention pushes per event per 15 minutes.
  FOR v_recipient IN
    SELECT r.user_id
    FROM rsvps r
    JOIN profiles p ON p.id = r.user_id
    LEFT JOIN event_chat_reads cr ON cr.event_id = r.event_id AND cr.user_id = r.user_id
    WHERE r.event_id = NEW.event_id
      AND r.status = 'going'
      AND r.user_id <> NEW.sender_id
      AND r.user_id = ANY(NEW.mentions)
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
$$;

-- -----------------------------
-- 3. Hosts see and act on reports in their own chat
-- -----------------------------
CREATE OR REPLACE FUNCTION get_event_chat_reported_messages(event_uuid uuid)
RETURNS TABLE(
  message_id uuid, sender_id uuid, sender_name text, body text, created_at timestamptz,
  deleted_at timestamptz, report_count integer, reasons text[], last_reported_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    m.id, m.sender_id, p.name,
    CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END,
    m.created_at, m.deleted_at,
    count(c.id)::integer,
    COALESCE(array_agg(DISTINCT c.reason) FILTER (WHERE c.reason IS NOT NULL), '{}'::text[]),
    max(c.created_at)
  FROM complaints c
  JOIN event_chat_messages m ON m.id = c.target_id
  LEFT JOIN profiles p ON p.id = m.sender_id
  WHERE c.target_type = 'chat_message'
    AND c.status = 'pending'
    AND m.event_id = event_uuid
    AND (is_admin_user() OR user_is_event_host(event_uuid))
  GROUP BY m.id, m.sender_id, p.name, m.body, m.created_at, m.deleted_at
  ORDER BY max(c.created_at) DESC;
$$;

-- Host/admin: keep the message, clear its pending reports (logged).
CREATE OR REPLACE FUNCTION dismiss_event_chat_reports(p_message_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT m.event_id INTO v_event_id FROM event_chat_messages m WHERE m.id = p_message_id;
  IF v_event_id IS NULL OR NOT (is_admin_user() OR user_is_event_host(v_event_id)) THEN
    RAISE EXCEPTION 'Not allowed to moderate this chat';
  END IF;
  UPDATE complaints
  SET status = 'dismissed', resolved_by = auth.uid(), resolved_at = now()
  WHERE target_type = 'chat_message' AND target_id = p_message_id AND status = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO event_chat_moderation_actions (event_id, message_id, actor_id, action)
  VALUES (v_event_id, p_message_id, auth.uid(), 'dismiss_reports');
  RETURN v_count;
END;
$$;
