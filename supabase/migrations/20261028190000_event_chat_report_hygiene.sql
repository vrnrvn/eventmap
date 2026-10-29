-- Chat report hygiene: complaints have no FK to messages, so hard-deleted
-- messages (event deletion cascades) left orphan reports inflating the admin
-- pending count. Count only reports whose message still exists, remove
-- existing orphans, and drop chat reports when their message row goes away.

CREATE OR REPLACE FUNCTION admin_count_pending_chat_reports()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE WHEN is_admin_user() THEN (
    SELECT count(DISTINCT c.target_id)::integer
    FROM complaints c
    JOIN event_chat_messages m ON m.id = c.target_id
    WHERE c.target_type = 'chat_message' AND c.status = 'pending'
  ) ELSE 0 END;
$$;

DELETE FROM complaints c
WHERE c.target_type = 'chat_message'
  AND NOT EXISTS (SELECT 1 FROM event_chat_messages m WHERE m.id = c.target_id);

CREATE OR REPLACE FUNCTION cleanup_chat_message_reports()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM complaints WHERE target_type = 'chat_message' AND target_id = OLD.id;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trigger_cleanup_chat_message_reports ON event_chat_messages;
CREATE TRIGGER trigger_cleanup_chat_message_reports
  AFTER DELETE ON event_chat_messages
  FOR EACH ROW EXECUTE FUNCTION cleanup_chat_message_reports();
