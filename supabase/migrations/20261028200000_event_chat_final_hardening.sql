-- Event chat final hardening.
--  * Clients may only supply id/event_id/sender_id/body/mentions on insert;
--    created_at, deleted_at and deleted_by are server-controlled (closes a
--    rate-limit / slow-mode / ordering bypass).
--  * Self-deleted messages are retracted for good (not stashed, not restorable).
--  * Admin queue honours timed-block expiry.

REVOKE INSERT ON event_chat_messages FROM authenticated, anon;
GRANT INSERT (id, event_id, sender_id, body, mentions) ON event_chat_messages TO authenticated;

CREATE OR REPLACE FUNCTION delete_event_chat_message(p_message_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_msg record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT m.id, m.event_id, m.sender_id, m.deleted_at INTO v_msg FROM event_chat_messages m WHERE m.id = p_message_id;
  IF v_msg.id IS NULL OR v_msg.deleted_at IS NOT NULL THEN RETURN false; END IF;
  IF NOT (v_msg.sender_id = auth.uid() OR is_admin_user() OR user_is_event_host(v_msg.event_id)) THEN RETURN false; END IF;

  UPDATE event_chat_messages SET deleted_at = now(), deleted_by = auth.uid() WHERE id = p_message_id;

  IF v_msg.sender_id = auth.uid() THEN
    -- The author retracted it: drop the body for good.
    UPDATE event_chat_messages SET body = '' WHERE id = p_message_id;
    DELETE FROM event_chat_removed_bodies WHERE message_id = p_message_id;
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
      user_is_blocked_from_event_chat(m.event_id, m.sender_id)
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
