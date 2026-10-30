-- Event capacity model (DB groundwork; tolerant client already wired).
--
-- Adds an optional events.max_attendees cap (NULL = unlimited) and a
-- join_event_with_capacity RPC that enforces the cap atomically (row lock on
-- the event), reusing the ban/lifecycle helpers from 20261030104000 and
-- 20261030106000. The client (services/social.ts) calls the RPC first and
-- falls back to the plain rsvps upsert while this migration is unapplied.
--
-- Discovery (get_ranked_events) is intentionally left untouched for now:
-- surfacing remaining-capacity there is a post-apply enhancement.

-- -----------------------------
-- 1. Schema
-- -----------------------------
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS max_attendees integer
    CHECK (max_attendees IS NULL OR max_attendees > 0);

-- -----------------------------
-- 2. join_event_with_capacity RPC
-- -----------------------------
CREATE OR REPLACE FUNCTION join_event_with_capacity(p_event_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event events%ROWTYPE;
  v_going_count bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_status NOT IN ('going', 'interested') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  IF user_is_banned(auth.uid()) THEN
    RAISE EXCEPTION 'not_allowed: account suspended';
  END IF;

  -- Lock the event row so concurrent joins serialize on the capacity check.
  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  IF NOT event_is_open_for_rsvp(p_event_id) THEN
    RAISE EXCEPTION 'event_closed';
  END IF;

  IF p_status = 'going' AND v_event.max_attendees IS NOT NULL THEN
    SELECT COUNT(*) INTO v_going_count
    FROM rsvps r
    WHERE r.event_id = p_event_id
      AND r.status = 'going'
      AND r.user_id != auth.uid();

    IF v_going_count >= v_event.max_attendees THEN
      RAISE EXCEPTION 'EVENT_FULL';
    END IF;
  END IF;

  -- Same shape/conflict target as the client upsert (UNIQUE(user_id, event_id)).
  INSERT INTO rsvps (user_id, event_id, status)
  VALUES (auth.uid(), p_event_id, p_status)
  ON CONFLICT (user_id, event_id)
  DO UPDATE SET status = EXCLUDED.status;
END;
$$;

REVOKE EXECUTE ON FUNCTION join_event_with_capacity(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION join_event_with_capacity(uuid, text) TO authenticated, service_role;
