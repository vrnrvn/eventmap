-- Waitlist for full events + trigram search index
-- (events-flow review Tier 3, 2026-11-02).
--
-- 1. Waitlist. "Event full" was a dead end: the only thing an interested
--    person could do was re-open the page and hope. This adds a first-come
--    waitlist. When a 'going' seat frees up, the earliest waitlisted people
--    (one per free seat) are notified; joining is still their explicit tap on
--    the event page, which keeps the capacity check in one place
--    (join_event_with_capacity / the rsvps trigger). Joining removes them from
--    the waitlist; cancelling the event clears and notifies it.
--
--    get_event_details gains an additive `waitlist` key
--    ({count, position, notified_at}); the client shows the waitlist controls
--    only when that key is present, so nothing changes until this is applied.
--
-- 2. Search. get_ranked_events filters with ILIKE '%q%' on title, description
--    and business name, which can't use a btree. pg_trgm GIN indexes make
--    those predicates indexable.
--
-- Validated on a scratch copy of the local DB; not applied to the shared DB.

-- 1. Waitlist ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_waitlist (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  /** Last time this person was told a spot opened; null until then. */
  notified_at timestamptz,
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_waitlist_event_created
  ON public.event_waitlist (event_id, created_at);

ALTER TABLE public.event_waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own waitlist rows" ON public.event_waitlist;
CREATE POLICY "Users can view their own waitlist rows"
  ON public.event_waitlist FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Writes only through the RPCs below.
REVOKE INSERT, UPDATE, DELETE ON public.event_waitlist FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.join_event_waitlist(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_going bigint;
  v_position integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF user_is_banned(auth.uid()) THEN RAISE EXCEPTION 'not_allowed: account suspended'; END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF NOT event_is_open_for_rsvp(p_event_id) THEN RAISE EXCEPTION 'event_closed'; END IF;
  IF v_event.max_attendees IS NULL THEN RAISE EXCEPTION 'waitlist_not_needed: event has no capacity limit'; END IF;

  IF EXISTS (SELECT 1 FROM rsvps r WHERE r.event_id = p_event_id AND r.user_id = auth.uid() AND r.status = 'going') THEN
    RAISE EXCEPTION 'already_going';
  END IF;

  SELECT COUNT(*) INTO v_going FROM rsvps r WHERE r.event_id = p_event_id AND r.status = 'going';
  IF v_going < v_event.max_attendees THEN
    -- A seat is free right now: the client should just join.
    RAISE EXCEPTION 'spot_available';
  END IF;

  INSERT INTO event_waitlist (event_id, user_id)
  VALUES (p_event_id, auth.uid())
  ON CONFLICT (event_id, user_id) DO NOTHING;

  SELECT COUNT(*) INTO v_position
  FROM event_waitlist w
  WHERE w.event_id = p_event_id
    AND w.created_at <= (SELECT created_at FROM event_waitlist WHERE event_id = p_event_id AND user_id = auth.uid());
  RETURN v_position;
END;
$function$;

CREATE OR REPLACE FUNCTION public.leave_event_waitlist(p_event_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  DELETE FROM event_waitlist WHERE event_id = p_event_id AND user_id = auth.uid();
$function$;

GRANT EXECUTE ON FUNCTION public.join_event_waitlist(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_event_waitlist(uuid) TO authenticated;

-- Seat freed (leave, or going -> interested): tell the next people in line.
-- Joining as going: drop the joiner from the waitlist.
CREATE OR REPLACE FUNCTION public.sync_event_waitlist_on_rsvp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event_id uuid := COALESCE(NEW.event_id, OLD.event_id);
  v_max integer;
  v_going bigint;
  v_free integer;
  v_title text;
  v_row record;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.status = 'going' THEN
    DELETE FROM event_waitlist WHERE event_id = NEW.event_id AND user_id = NEW.user_id;
  END IF;

  -- Did a going seat just open?
  IF NOT (
    (TG_OP = 'DELETE' AND OLD.status = 'going')
    OR (TG_OP = 'UPDATE' AND OLD.status = 'going' AND NEW.status <> 'going')
  ) THEN
    RETURN NULL;
  END IF;

  SELECT e.max_attendees, e.title INTO v_max, v_title FROM events e WHERE e.id = v_event_id AND e.status = 'active';
  IF v_max IS NULL THEN RETURN NULL; END IF;

  SELECT COUNT(*) INTO v_going FROM rsvps r WHERE r.event_id = v_event_id AND r.status = 'going';
  v_free := v_max - v_going;
  IF v_free <= 0 THEN RETURN NULL; END IF;

  -- Notify up to v_free people who haven't been pinged in the last day.
  FOR v_row IN
    SELECT w.user_id
    FROM event_waitlist w
    WHERE w.event_id = v_event_id
      AND (w.notified_at IS NULL OR w.notified_at < now() - interval '1 day')
    ORDER BY w.created_at
    LIMIT v_free
  LOOP
    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    VALUES (
      v_row.user_id, 'waitlist', 'A spot opened up',
      'A place just opened in "' || COALESCE(v_title, 'an event') || '". Join now before it fills again.',
      v_event_id,
      jsonb_build_object('eventId', v_event_id, 'kind', 'waitlist_spot')
    );
    UPDATE event_waitlist SET notified_at = now() WHERE event_id = v_event_id AND user_id = v_row.user_id;
  END LOOP;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_sync_event_waitlist ON rsvps;
CREATE TRIGGER trigger_sync_event_waitlist
  AFTER INSERT OR UPDATE OF status OR DELETE ON rsvps
  FOR EACH ROW
  EXECUTE FUNCTION sync_event_waitlist_on_rsvp();

-- Cancelled event: tell the waitlist and clear it.
CREATE OR REPLACE FUNCTION public.clear_event_waitlist_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    INSERT INTO notifications (user_id, type, title, body, event_id)
    SELECT w.user_id, 'event_update', 'Event cancelled',
           '"' || COALESCE(NEW.title, 'Event') || '" has been cancelled by the organizer.', NEW.id
    FROM event_waitlist w
    WHERE w.event_id = NEW.id
      -- Don't double up with the RSVP / saves notice from cancel_event.
      AND NOT EXISTS (SELECT 1 FROM rsvps r WHERE r.event_id = NEW.id AND r.user_id = w.user_id)
      AND NOT EXISTS (SELECT 1 FROM saves s WHERE s.event_id = NEW.id AND s.user_id = w.user_id);
    DELETE FROM event_waitlist WHERE event_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_clear_event_waitlist_on_cancel ON events;
CREATE TRIGGER trigger_clear_event_waitlist_on_cancel
  AFTER UPDATE OF status ON events
  FOR EACH ROW
  EXECUTE FUNCTION clear_event_waitlist_on_cancel();

-- get_event_details: additive `waitlist` key. Body otherwise = 20260223000000.
CREATE OR REPLACE FUNCTION public.get_event_details(event_uuid uuid)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'event', row_to_json(e.*),
    'business', row_to_json(b.*),
    'category', row_to_json(c.*),
    'links', COALESCE(
      (SELECT json_agg(row_to_json(el.*) ORDER BY el.sort_order)
       FROM event_links el
       WHERE el.event_id = e.id),
      '[]'::json
    ),
    'photos', COALESCE(
      (SELECT json_agg(row_to_json(ep.*) ORDER BY ep.sort_order)
       FROM event_photos ep
       WHERE ep.event_id = e.id),
      '[]'::json
    ),
    'rsvp_count', (
      SELECT COUNT(*) FROM rsvps WHERE event_id = e.id AND status = 'going'
    ),
    'save_count', (
      SELECT COUNT(*) FROM saves WHERE event_id = e.id
    ),
    'user_rsvp', (
      SELECT status FROM rsvps
      WHERE event_id = e.id AND user_id = auth.uid()
    ),
    'user_saved', (
      SELECT EXISTS(
        SELECT 1 FROM saves
        WHERE event_id = e.id AND user_id = auth.uid()
      )
    ),
    'user_following_business', (
      SELECT EXISTS(
        SELECT 1 FROM follows
        WHERE business_id = b.id AND user_id = auth.uid()
      )
    ),
    'waitlist', json_build_object(                                   -- added
      'count', (SELECT COUNT(*) FROM event_waitlist w WHERE w.event_id = e.id),
      'position', (
        SELECT COUNT(*) FROM event_waitlist w
        WHERE w.event_id = e.id
          AND w.created_at <= (SELECT mine.created_at FROM event_waitlist mine
                               WHERE mine.event_id = e.id AND mine.user_id = auth.uid())
      ),
      'notified_at', (SELECT w.notified_at FROM event_waitlist w WHERE w.event_id = e.id AND w.user_id = auth.uid())
    )
  ) INTO result
  FROM events e
  JOIN businesses b ON b.id = e.business_id
  JOIN categories c ON c.id = e.category_id
  WHERE e.id = event_uuid;

  RETURN result;
END;
$function$;

-- 2. Trigram search index -------------------------------------------------------------

-- Supabase convention: extensions live in the `extensions` schema.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_events_title_trgm
  ON events USING gin (title extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_events_description_trgm
  ON events USING gin (description extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_businesses_name_trgm
  ON businesses USING gin (name extensions.gin_trgm_ops);
