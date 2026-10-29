-- Event chat moderation hardening.
--  * Reports on chat messages are validated server-side (no self-reports,
--    no reports from banned accounts or users without access to the chat).
--  * Auto-hide only counts pending reports, so admin dismissals stick.
--  * Admins can confirm (resolve) or undo (restore) an automatic hide.
--  * Block details are visible to moderators only.

-- -----------------------------
-- 1. Validate chat-message reports
-- -----------------------------
CREATE OR REPLACE FUNCTION validate_chat_message_report()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg record;
BEGIN
  IF NEW.target_type <> 'chat_message' THEN
    RETURN NEW;
  END IF;

  SELECT m.id, m.event_id, m.sender_id INTO v_msg
  FROM event_chat_messages m
  WHERE m.id = NEW.target_id;

  IF v_msg.id IS NULL THEN
    RAISE EXCEPTION 'chat_report_not_allowed: message not found';
  END IF;
  IF v_msg.sender_id = NEW.reporter_id THEN
    RAISE EXCEPTION 'chat_report_not_allowed: cannot report your own message';
  END IF;
  IF user_is_banned(NEW.reporter_id) THEN
    RAISE EXCEPTION 'chat_report_not_allowed: account suspended';
  END IF;
  IF NOT (
    user_can_access_event_chat(v_msg.event_id)
    OR user_is_event_host(v_msg.event_id)
    OR is_admin_user()
  ) THEN
    RAISE EXCEPTION 'chat_report_not_allowed: no access to this chat';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_chat_message_report ON complaints;
CREATE TRIGGER trigger_validate_chat_message_report
  BEFORE INSERT ON complaints
  FOR EACH ROW
  EXECUTE FUNCTION validate_chat_message_report();

-- -----------------------------
-- 2. Auto-hide counts pending reports only
-- -----------------------------
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

  -- Dismissed reports were reviewed by an admin and must not count again.
  SELECT count(DISTINCT c.reporter_id) INTO v_reporters
  FROM complaints c
  WHERE c.target_type = 'chat_message'
    AND c.target_id = NEW.target_id
    AND c.status = 'pending';

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

-- -----------------------------
-- 3. Resolve / restore
-- -----------------------------
ALTER TABLE event_chat_moderation_actions
  DROP CONSTRAINT IF EXISTS event_chat_moderation_actions_action_check;
ALTER TABLE event_chat_moderation_actions
  ADD CONSTRAINT event_chat_moderation_actions_action_check
  CHECK (action IN ('delete', 'block', 'unblock', 'dismiss_reports', 'resolve_reports', 'restore', 'auto_hide'));

-- Confirms an automatic hide (or any already-removed message): reports are
-- marked resolved rather than dismissed.
CREATE OR REPLACE FUNCTION admin_resolve_chat_reports(p_message_id uuid)
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
  SET status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
  WHERE target_type = 'chat_message' AND target_id = p_message_id AND status = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  SELECT m.event_id INTO v_event_id FROM event_chat_messages m WHERE m.id = p_message_id;
  IF v_event_id IS NOT NULL THEN
    INSERT INTO event_chat_moderation_actions (event_id, message_id, actor_id, action)
    VALUES (v_event_id, p_message_id, auth.uid(), 'resolve_reports');
  END IF;

  RETURN v_count;
END;
$$;

-- Undo a hide/delete (false-positive reports): message becomes visible again
-- and its pending reports are dismissed.
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

  UPDATE event_chat_messages SET deleted_at = NULL WHERE id = p_message_id;

  UPDATE complaints
  SET status = 'dismissed', resolved_by = auth.uid(), resolved_at = now()
  WHERE target_type = 'chat_message' AND target_id = p_message_id AND status = 'pending';

  INSERT INTO event_chat_moderation_actions (event_id, message_id, target_user_id, actor_id, action)
  VALUES (v_msg.event_id, p_message_id, v_msg.sender_id, auth.uid(), 'restore');

  RETURN true;
END;
$$;

-- -----------------------------
-- 4. Block details for moderators only (subjects learn their status via
--    get_event_chat_post_status, without the reason or who blocked them)
-- -----------------------------
DROP POLICY IF EXISTS "Chat blocks visible to subject, host and admins" ON event_chat_blocks;
DROP POLICY IF EXISTS "Chat blocks visible to host and admins" ON event_chat_blocks;
CREATE POLICY "Chat blocks visible to host and admins"
  ON event_chat_blocks
  FOR SELECT
  TO authenticated
  USING (is_admin_user() OR user_is_event_host(event_id));
