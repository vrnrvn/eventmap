-- Business owners lose sight of their own past events: the only public SELECT
-- policy on events is `end_datetime > now()` (20260213092204). MyEvents
-- queries the events table directly (services/events.ts getBusinessEvents),
-- so once this policy exists owners see their full history with no client
-- change.

DROP POLICY IF EXISTS "Business owners can view their own events" ON events;
CREATE POLICY "Business owners can view their own events"
  ON events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM businesses b
      WHERE b.id = events.business_id
        AND b.owner_id = auth.uid()
    )
  );
