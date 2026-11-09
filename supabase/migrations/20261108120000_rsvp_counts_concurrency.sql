-- Independent of the other
-- files; any order.
--
-- event_rsvp_counts drifts under concurrent RSVP changes. The AFTER trigger
-- recounts the event's rows, but a transaction that recounts while another
-- one's change is uncommitted writes a count missing that change, and the
-- later writer wins. Joins lock the event row (enforce_event_capacity), but
-- leaves / downgrades don't. Reproduced on scratch 2026-11-08:
--   join + concurrent leave   -> stored 1, actual 2
--   leave + concurrent leave  -> stored 1, actual 0
-- The count stays wrong until the next RSVP change on that event, and it
-- feeds Discover cards, ranking and the event page.
--
-- Fix: a per-event transaction-scoped advisory lock before recounting. The
-- second transaction waits for the first to commit; under READ COMMITTED its
-- recount (a new statement in a volatile function) then sees both changes.
-- Also repairs any counts that already drifted.

CREATE OR REPLACE FUNCTION public.sync_event_rsvp_counts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('event_rsvp_counts:' || NEW.event_id::text, 0));
    PERFORM refresh_event_rsvp_counts(NEW.event_id);
  END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') AND (TG_OP = 'DELETE' OR OLD.event_id IS DISTINCT FROM NEW.event_id) THEN
    -- The event may be mid-cascade-delete; skip if it's gone.
    IF EXISTS (SELECT 1 FROM events e WHERE e.id = OLD.event_id) THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('event_rsvp_counts:' || OLD.event_id::text, 0));
      PERFORM refresh_event_rsvp_counts(OLD.event_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

-- One-off repair of counts that already drifted.
SELECT refresh_event_rsvp_counts(c.event_id)
FROM event_rsvp_counts c
LEFT JOIN LATERAL (
  SELECT COUNT(*) FILTER (WHERE r.status = 'going') AS going,
         COUNT(*) FILTER (WHERE r.status = 'interested') AS interested
  FROM rsvps r WHERE r.event_id = c.event_id
) a ON true
WHERE c.going_count <> a.going OR c.interested_count <> a.interested;
