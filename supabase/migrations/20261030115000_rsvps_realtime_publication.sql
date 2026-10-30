-- Realtime attendance: publish rsvps (docs/ISSUES.md [DB] item).
--
-- Only event_chat_messages is in the supabase_realtime publication
-- (20260301000000), so EventDetail's attendee count / chat unlock falls back
-- to a 20s focus-scoped poll. Publishing rsvps lets the client replace the
-- poll with a debounced postgres_changes subscription filtered by event_id;
-- the subscription is already wired client-side and simply starts firing once
-- this is applied.
--
-- REPLICA IDENTITY FULL matches the event_chat_messages setup and is required
-- so DELETE payloads (user leaves an event) carry the old row's event_id —
-- without it the client's event_id filter can never match deletes.
-- postgres_changes respects RLS, so subscribers only receive rows the rsvps
-- SELECT policies let them see.

ALTER TABLE rsvps REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'rsvps'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE rsvps;
  END IF;
END $$;
