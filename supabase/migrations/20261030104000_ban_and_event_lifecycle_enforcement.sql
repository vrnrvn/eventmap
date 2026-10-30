-- Ban + lifecycle enforcement on social writes.
--
-- Bans were only enforced in event chat (user_is_banned, 20261028130000).
-- This extends the same check to rsvps, saves and reviews INSERTs, and adds a
-- lifecycle check so users cannot RSVP to events that already ended.
--
-- "Ended" uses event_has_ended (20261029110000) so open-ended recurring events
-- stay joinable even when their original end_datetime has passed. The check
-- runs in a SECURITY DEFINER helper because recurring events with a past
-- end_datetime are hidden by the events SELECT policy and a plain EXISTS in
-- the policy would wrongly fail for them.

CREATE OR REPLACE FUNCTION event_is_open_for_rsvp(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = p_event_id
      AND NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern)
  );
$$;

-- -----------------------------
-- rsvps: ban check + event not ended (INSERT and UPDATE)
-- -----------------------------
DROP POLICY IF EXISTS "Users can create their own RSVPs" ON rsvps;
CREATE POLICY "Users can create their own RSVPs"
  ON rsvps FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND NOT user_is_banned(auth.uid())
    AND event_is_open_for_rsvp(event_id)
  );

DROP POLICY IF EXISTS "Users can update their own RSVPs" ON rsvps;
CREATE POLICY "Users can update their own RSVPs"
  ON rsvps FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND NOT user_is_banned(auth.uid())
    AND event_is_open_for_rsvp(event_id)
  );

-- -----------------------------
-- saves: ban check
-- -----------------------------
DROP POLICY IF EXISTS "Users can create their own saves" ON saves;
CREATE POLICY "Users can create their own saves"
  ON saves FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND NOT user_is_banned(auth.uid())
  );

-- -----------------------------
-- reviews: ban check (keeps the eligibility check from 20261030103000)
-- -----------------------------
DROP POLICY IF EXISTS "Attendees can create their own review" ON reviews;
CREATE POLICY "Attendees can create their own review"
  ON reviews FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND NOT user_is_banned(auth.uid())
    AND user_can_review_business(business_id)
  );
