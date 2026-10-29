-- Unread counts scanned every message of each joined event. Count only rows
-- after the caller's read marker via the (event_id, created_at) index, bounded
-- at 1000 (the UI shows "99+"), and take latest_message_at from the index.

CREATE OR REPLACE FUNCTION get_event_chat_unread_counts(p_event_ids uuid[] DEFAULT NULL)
RETURNS TABLE(event_id uuid, unread_count integer, latest_message_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    r.event_id,
    (
      SELECT count(*)::integer FROM (
        SELECT 1
        FROM event_chat_messages m
        WHERE m.event_id = r.event_id
          AND m.created_at > COALESCE(cr.last_read_at, 'epoch'::timestamptz)
          AND m.deleted_at IS NULL
          AND m.sender_id <> auth.uid()
        LIMIT 1000
      ) bounded
    ) AS unread_count,
    (
      SELECT m.created_at FROM event_chat_messages m
      WHERE m.event_id = r.event_id AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC LIMIT 1
    ) AS latest_message_at
  FROM rsvps r
  LEFT JOIN event_chat_reads cr ON cr.event_id = r.event_id AND cr.user_id = auth.uid()
  WHERE auth.uid() IS NOT NULL
    AND r.user_id = auth.uid()
    AND r.status = 'going'
    AND (p_event_ids IS NULL OR r.event_id = ANY(p_event_ids))
    AND EXISTS (SELECT 1 FROM event_chat_messages m WHERE m.event_id = r.event_id AND m.deleted_at IS NULL)
    AND user_can_access_event_chat(r.event_id);
$$;
