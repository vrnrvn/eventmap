-- Keep evidence for reported messages even when the author deletes them, and
-- tighten table privileges to what RLS actually allows.

CREATE OR REPLACE FUNCTION delete_event_chat_message(p_message_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_msg record;
  v_has_reports boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT m.id, m.event_id, m.sender_id, m.deleted_at INTO v_msg FROM event_chat_messages m WHERE m.id = p_message_id;
  IF v_msg.id IS NULL OR v_msg.deleted_at IS NOT NULL THEN RETURN false; END IF;
  IF NOT (v_msg.sender_id = auth.uid() OR is_admin_user() OR user_is_event_host(v_msg.event_id)) THEN RETURN false; END IF;

  UPDATE event_chat_messages SET deleted_at = now(), deleted_by = auth.uid() WHERE id = p_message_id;

  IF v_msg.sender_id = auth.uid() THEN
    -- Author retraction: unrecoverable, but reported content stays available
    -- to admins as evidence until the reports are closed.
    SELECT EXISTS (
      SELECT 1 FROM complaints c
      WHERE c.target_type = 'chat_message' AND c.target_id = p_message_id AND c.status = 'pending'
    ) INTO v_has_reports;
    IF v_has_reports THEN
      PERFORM stash_removed_chat_body(p_message_id);
    ELSE
      UPDATE event_chat_messages SET body = '' WHERE id = p_message_id;
      DELETE FROM event_chat_removed_bodies WHERE message_id = p_message_id;
    END IF;
  ELSE
    PERFORM stash_removed_chat_body(p_message_id);
    INSERT INTO event_chat_moderation_actions (event_id, message_id, target_user_id, actor_id, action)
    VALUES (v_msg.event_id, p_message_id, v_msg.sender_id, auth.uid(), 'delete');
    UPDATE complaints SET status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
    WHERE target_type = 'chat_message' AND target_id = p_message_id AND status = 'pending';
  END IF;
  RETURN true;
END;
$$;

-- Author retractions are never restorable, even if a stash exists for evidence.
CREATE OR REPLACE FUNCTION restore_event_chat_message(p_message_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_msg record;
  v_body text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT m.id, m.event_id, m.sender_id, m.deleted_at, m.deleted_by INTO v_msg FROM event_chat_messages m WHERE m.id = p_message_id;
  IF v_msg.id IS NULL OR v_msg.deleted_at IS NULL THEN RETURN false; END IF;
  IF v_msg.deleted_by IS NOT NULL AND v_msg.deleted_by = v_msg.sender_id THEN RETURN false; END IF;
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

-- Clients only ever read, insert (restricted columns) or call RPCs.
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON event_chat_messages FROM anon, authenticated;
