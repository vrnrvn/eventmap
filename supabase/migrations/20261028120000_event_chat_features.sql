-- Event chat: access-check performance, send rate limiting, soft-delete RPC,
-- per-user read tracking with unread counts, throttled push notifications,
-- and chat-message reporting.

-- -----------------------------
-- 1. Access check performance
-- -----------------------------
-- The RLS policy evaluates user_can_access_event_chat() per message row; give
-- it a covering index and replace COUNT(*) with an EXISTS for "someone else
-- is also going" (same semantics as count >= 2 given the caller is going).
CREATE INDEX IF NOT EXISTS idx_rsvps_event_status_user
  ON rsvps(event_id, status, user_id);

CREATE OR REPLACE FUNCTION user_can_access_event_chat(event_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM rsvps r
      WHERE r.event_id = event_uuid
        AND r.user_id = auth.uid()
        AND r.status = 'going'
    )
    AND EXISTS (
      SELECT 1 FROM rsvps r
      WHERE r.event_id = event_uuid
        AND r.status = 'going'
        AND r.user_id <> auth.uid()
    );
$$;

-- -----------------------------
-- 2. Send rate limit (server-side)
-- -----------------------------
CREATE INDEX IF NOT EXISTS idx_event_chat_messages_sender_created
  ON event_chat_messages(sender_id, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_event_chat_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent integer;
BEGIN
  SELECT count(*) INTO v_recent
  FROM event_chat_messages m
  WHERE m.sender_id = NEW.sender_id
    AND m.created_at > now() - interval '10 seconds';

  IF v_recent >= 10 THEN
    -- The client maps this message to a friendly "slow down" notice.
    RAISE EXCEPTION 'chat_rate_limited' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_event_chat_rate_limit ON event_chat_messages;
CREATE TRIGGER trigger_event_chat_rate_limit
  BEFORE INSERT ON event_chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION enforce_event_chat_rate_limit();

-- -----------------------------
-- 3. Soft delete (own message, or admin)
-- -----------------------------
CREATE OR REPLACE FUNCTION delete_event_chat_message(p_message_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_found boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE event_chat_messages
  SET deleted_at = now()
  WHERE id = p_message_id
    AND deleted_at IS NULL
    AND (sender_id = auth.uid() OR is_admin_user());

  GET DIAGNOSTICS v_found = ROW_COUNT;
  RETURN v_found;
END;
$$;

-- -----------------------------
-- 4. Read tracking + unread counts
-- -----------------------------
CREATE TABLE IF NOT EXISTS event_chat_reads (
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

ALTER TABLE event_chat_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own chat reads" ON event_chat_reads;
CREATE POLICY "Users manage own chat reads"
  ON event_chat_reads
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION mark_event_chat_read(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO event_chat_reads (user_id, event_id, last_read_at)
  VALUES (auth.uid(), p_event_id, now())
  ON CONFLICT (user_id, event_id)
  DO UPDATE SET last_read_at = GREATEST(event_chat_reads.last_read_at, EXCLUDED.last_read_at);
END;
$$;

-- Unread = messages from others after the caller's last read, for chats the
-- caller can currently access. Optionally scoped to specific events.
CREATE OR REPLACE FUNCTION get_event_chat_unread_counts(p_event_ids uuid[] DEFAULT NULL)
RETURNS TABLE(event_id uuid, unread_count integer, latest_message_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.event_id,
    count(*) FILTER (
      WHERE m.sender_id <> auth.uid()
        AND m.created_at > COALESCE(cr.last_read_at, 'epoch'::timestamptz)
    )::integer AS unread_count,
    max(m.created_at) AS latest_message_at
  FROM event_chat_messages m
  JOIN rsvps mine
    ON mine.event_id = m.event_id
   AND mine.user_id = auth.uid()
   AND mine.status = 'going'
  LEFT JOIN event_chat_reads cr
    ON cr.event_id = m.event_id
   AND cr.user_id = auth.uid()
  WHERE auth.uid() IS NOT NULL
    AND m.deleted_at IS NULL
    AND (p_event_ids IS NULL OR m.event_id = ANY(p_event_ids))
  GROUP BY m.event_id
  HAVING user_can_access_event_chat(m.event_id);
$$;

-- -----------------------------
-- 5. Chat notifications (throttled, preference-aware)
-- -----------------------------
ALTER TABLE profiles
  ALTER COLUMN notification_preferences
  SET DEFAULT '{"new_follower":true,"new_event_from_followed":true,"event_update":true,"rsvp":true,"nearby_event":true,"chat_message":true}'::jsonb;

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
    -- Never block a message send because notifications failed.
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_attendees_on_chat_message ON event_chat_messages;
CREATE TRIGGER trigger_notify_attendees_on_chat_message
  AFTER INSERT ON event_chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_attendees_on_chat_message();

-- -----------------------------
-- 6. Reporting chat messages
-- -----------------------------
-- Moderators need to read a reported message even when they aren't attending.
DROP POLICY IF EXISTS "Admins can read event chat" ON event_chat_messages;
CREATE POLICY "Admins can read event chat"
  ON event_chat_messages
  FOR SELECT
  TO authenticated
  USING (is_admin_user());

ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_target_type_check;
ALTER TABLE complaints
  ADD CONSTRAINT complaints_target_type_check
  CHECK (target_type IN ('event', 'business', 'user', 'review', 'chat_message'));
