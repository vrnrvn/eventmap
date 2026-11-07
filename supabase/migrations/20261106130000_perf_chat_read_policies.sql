-- Chat read policies: reject non-members without a full scan
-- (perf review P0 #4, 2026-11-06).
--
-- event_chat_messages has three permissive SELECT policies (admin, host,
-- going attendee). Each called a SECURITY DEFINER helper with the row's
-- event_id, which Postgres can't inline or cache, so all three ran per row.
--
-- Measured on an isolated copy (one event with 20k messages, 50 attendees):
-- for members this is cheap (~2 ms per 100-message page). The problem is a
-- caller who may NOT read the room: every row is filtered out, so the LIMIT
-- never fills and the scan walks every message of the event, running all
-- three policy functions on each. ~300 ms per call, for any signed-in user,
-- on any event, through get_event_chat_messages, the direct "latest message"
-- read, or a stale client — an easy way to burn database CPU.
--
-- The fix keeps every original check and adds, in front of each, a cheap
-- necessary condition that Postgres evaluates ONCE per query:
--   * admin: (SELECT is_admin_user()) — an init plan instead of per-row;
--   * host:  event_id IN (events the caller hosts) — a hashed subplan;
--   * going: event_id IN (events the caller is going to) — a hashed subplan.
-- A non-member's rows now fail on a hash probe before any function runs.
-- The original helpers still decide for rows that pass the prefilter, so
-- what each caller can read is unchanged (verified by result fingerprints for
-- attendee-with-blocks, host, outsider, admin and anon, before vs after).
-- Realtime evaluates these same policies for every change, per subscriber,
-- so it benefits too.

-- Events the caller is going to. SECURITY DEFINER so the policy doesn't
-- depend on rsvps' own RLS; only ever returns the caller's rows.
CREATE OR REPLACE FUNCTION public.chat_viewer_going_event_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT r.event_id
  FROM rsvps r
  WHERE r.user_id = auth.uid()
    AND r.status = 'going';
$function$;

-- Events the caller hosts (owns the business of). Same shape as
-- user_is_event_host(), as a set.
CREATE OR REPLACE FUNCTION public.chat_viewer_hosted_event_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT e.id
  FROM events e
  JOIN businesses b ON b.id = e.business_id
  WHERE b.owner_id = auth.uid();
$function$;

REVOKE ALL ON FUNCTION public.chat_viewer_going_event_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_viewer_hosted_event_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_viewer_going_event_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_viewer_hosted_event_ids() TO authenticated;

DROP POLICY IF EXISTS "Admins can read event chat" ON public.event_chat_messages;
CREATE POLICY "Admins can read event chat"
  ON public.event_chat_messages
  FOR SELECT
  TO authenticated
  USING ((SELECT is_admin_user()));

DROP POLICY IF EXISTS "Hosts can read own event chat" ON public.event_chat_messages;
CREATE POLICY "Hosts can read own event chat"
  ON public.event_chat_messages
  FOR SELECT
  TO authenticated
  USING (
    event_id IN (SELECT public.chat_viewer_hosted_event_ids())
    AND user_is_event_host(event_id)
  );

DROP POLICY IF EXISTS "Going attendees can read active event chat" ON public.event_chat_messages;
CREATE POLICY "Going attendees can read active event chat"
  ON public.event_chat_messages
  FOR SELECT
  TO authenticated
  USING (
    event_id IN (SELECT public.chat_viewer_going_event_ids())
    AND user_can_access_event_chat(event_id)
    AND NOT EXISTS (
      SELECT 1 FROM user_blocks ub
      WHERE ub.blocker_id = (SELECT auth.uid())
        AND ub.blocked_id = event_chat_messages.sender_id
    )
  );
