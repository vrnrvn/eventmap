-- Event journey review, migration 6 of 7 (docs/EVENT_JOURNEY_REVIEW_2026-11-17.md).
--
-- STATUS: PREPARED, NOT APPLIED. Staged in supabase/prepared/; validated only
-- in a throwaway isolated container. See this folder's README.
--
-- EJ-18 (owner decision 2026-11-17: "they should just go away"): once an
-- event is over, host_review_rsvp refuses (event_closed), so a pending join
-- request was stranded forever and the requester never heard back
-- (reproduced). A cron job now removes requests for events that are over.
--
-- The one-line notice to the requester was APPROVED by the owner 2026-11-17.
-- It stays isolated in the marked block below, should it ever need to go.

CREATE OR REPLACE FUNCTION public.expire_ended_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer := 0;
BEGIN
  WITH gone AS (
    DELETE FROM rsvps r
     USING events e
     WHERE e.id = r.event_id
       AND r.status = 'requested'
       AND event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
    RETURNING r.user_id, e.id AS event_id, e.title, e.business_id
  ), told AS (
    -- >>> NOTICE (approved 2026-11-17) — removable from here …
    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    SELECT g.user_id, 'event_update', 'Request closed',
           '"' || COALESCE(g.title, 'The event') || '" took place before the host replied to your request.',
           g.event_id,
           jsonb_build_object('eventId', g.event_id, 'kind', 'request_expired')
      FROM gone g
      JOIN profiles p ON p.id = g.user_id
      JOIN businesses b ON b.id = g.business_id
     WHERE g.user_id IS DISTINCT FROM b.owner_id
       AND COALESCE((p.notification_preferences->>'event_update')::boolean, true)
    RETURNING 1
    -- … to here (and the "told" CTE name below) <<<
  )
  SELECT count(*) INTO v_n FROM gone;
  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.expire_ended_requests() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('expire_ended_requests', '*/15 * * * *', 'SELECT expire_ended_requests()');
EXCEPTION
  WHEN OTHERS THEN NULL;   -- pg_cron absent (e.g. a test copy): the function still works
END;
$$;
