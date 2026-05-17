-- Lean MVP event chat.
-- A chat is active when at least two users have RSVP'd "going" to an event.

CREATE TABLE IF NOT EXISTS event_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  deleted_at timestamptz,
  CONSTRAINT event_chat_messages_body_length CHECK (
    char_length(btrim(body)) BETWEEN 1 AND 1000
  )
);

CREATE INDEX IF NOT EXISTS idx_event_chat_messages_event_created
  ON event_chat_messages(event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_chat_messages_sender
  ON event_chat_messages(sender_id);

ALTER TABLE event_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION user_can_access_event_chat(event_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM rsvps r
      WHERE r.event_id = event_uuid
        AND r.user_id = auth.uid()
        AND r.status = 'going'
    )
    AND (
      SELECT COUNT(*)
      FROM rsvps r
      WHERE r.event_id = event_uuid
        AND r.status = 'going'
    ) >= 2;
$$;

DROP POLICY IF EXISTS "Going attendees can read active event chat" ON event_chat_messages;
CREATE POLICY "Going attendees can read active event chat"
  ON event_chat_messages
  FOR SELECT
  TO authenticated
  USING (user_can_access_event_chat(event_id));

DROP POLICY IF EXISTS "Going attendees can send active event chat messages" ON event_chat_messages;
CREATE POLICY "Going attendees can send active event chat messages"
  ON event_chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND deleted_at IS NULL
    AND user_can_access_event_chat(event_id)
  );

ALTER TABLE event_chat_messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'event_chat_messages'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE event_chat_messages;
  END IF;
END $$;
