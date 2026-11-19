-- C3 / 2b-9 — get_host_dashboard(): the whole host dashboard in one request.
--
-- STATUS: PREPARED, NOT APPLIED. Staged in supabase/prepared/; see this
-- folder's README. Independent of every other prepared file. **Applying it
-- changes nothing by itself** — the client keeps using its current N-call
-- path until the cutover described in the README.
--
-- Today the dashboard costs up to 17 requests (docs/HOST_DASHBOARD_PLAN.md
-- §4): upcoming rows, batched counts, batched exceptions, up to 10 per-event
-- overviews, drafts, and one per-date count per series in the window. C1/C2
-- deliberately shipped on that path so this RPC has a measured baseline.
--
-- The bounds are the ones the client already applies, moved server-side:
--   * agenda rows: p_limit (default 50 = AGENDA_EVENT_LIMIT); `truncated`
--     says when the host has more than that.
--   * overviews: p_overview_limit (default 10 = MAX_OVERVIEW_TARGETS),
--     approval-mode events first then soonest (DC5), with `eligible` saying
--     how many could have been inspected.
--   * per-date counts: at most 10 series, only dates inside [p_from, p_to].
--
-- Only the three overview fields the dashboard actually reads are computed
-- (requested, waitlist, chat.open_reports — utils/hostDashboard.ts
-- AttentionOverview), not the whole get_event_host_overview payload.

CREATE OR REPLACE FUNCTION public.get_host_dashboard(
  p_business_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_overview_limit integer DEFAULT 10
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_from timestamptz := COALESCE(p_from, now());
  v_to timestamptz;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_overviews integer := LEAST(GREATEST(COALESCE(p_overview_limit, 10), 0), 25);
  result json;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = p_business_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'business_not_found'; END IF;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the host can see this dashboard';
  END IF;
  -- A month of agenda is more than any dashboard shows; the cap keeps the
  -- per-date expansion bounded whatever the caller asks for.
  v_to := LEAST(COALESCE(p_to, v_from + interval '7 days'), v_from + interval '31 days');

  WITH upcoming AS (
    -- Mirrors eventsService.getBusinessEvents(scope: 'upcoming').
    SELECT e.*
      FROM events e
     WHERE e.business_id = p_business_id
       AND COALESCE(e.publish_state, 'published') = 'published'
       AND COALESCE(e.status, 'active') IN ('active', 'postponed')
       AND (e.end_datetime > now() OR COALESCE(e.is_recurring, false))
     ORDER BY e.start_datetime
     LIMIT v_limit
  ), drafts AS (
    SELECT e.*
      FROM events e
     WHERE e.business_id = p_business_id
       AND e.publish_state = 'draft'
     ORDER BY e.updated_at DESC
     LIMIT v_limit
  ), live AS (
    SELECT * FROM upcoming WHERE COALESCE(status, 'active') <> 'cancelled'
  ), counts AS (
    SELECT l.id,
           (SELECT count(*) FROM rsvps r WHERE r.event_id = l.id AND r.status = 'going') AS going,
           (SELECT count(*) FROM event_waitlist w WHERE w.event_id = l.id) AS waitlist
      FROM live l
  ), exceptions AS (
    SELECT x.event_id, x.occurrence_date, x.kind, x.new_start, x.new_end, x.note
      FROM event_occurrence_exceptions x
     WHERE x.event_id IN (SELECT id FROM live WHERE COALESCE(is_recurring, false))
  ), eligible AS (
    -- utils/hostDashboard.ts overviewTargets: nothing cancelled, draft or
    -- over; approval-mode first (that is where requests pile up), then
    -- soonest.
    SELECT l.id, l.rsvp_mode, l.start_datetime
      FROM live l
     WHERE NOT event_has_ended(l.end_datetime, l.is_recurring, l.recurrence_pattern, l.timezone)
  ), targets AS (
    SELECT id FROM eligible
     ORDER BY (COALESCE(rsvp_mode, 'open') = 'approval') DESC, start_datetime
     LIMIT v_overviews
  ), overviews AS (
    SELECT t.id,
           (SELECT count(*) FROM rsvps r WHERE r.event_id = t.id AND r.status = 'requested') AS requested,
           (SELECT count(*) FROM event_waitlist w WHERE w.event_id = t.id) AS waitlist,
           (SELECT count(DISTINCT c.target_id)
              FROM complaints c
              JOIN event_chat_messages m ON m.id = c.target_id
             WHERE c.target_type = 'chat_message' AND c.status = 'pending'
               AND m.event_id = t.id) AS open_reports
      FROM targets t
  ), series_in_window AS (
    -- At most 10 series, soonest first: the same bound the client applies
    -- (MAX_SERIES_DATE_COUNTS).
    SELECT l.id, l.start_datetime, l.recurrence_pattern,
           COALESCE(NULLIF(l.timezone, ''), 'UTC') AS tz
      FROM live l
     WHERE COALESCE(l.is_recurring, false) AND l.recurrence_pattern IS NOT NULL
     ORDER BY l.start_datetime
     LIMIT 10
  ), series_dates AS (
    -- Dates the pattern produces inside the window, minus cancelled ones;
    -- a moved date is counted under the date it was moved from, which is the
    -- key the client's agenda uses.
    SELECT s.id,
           to_char(g.d::date, 'YYYY-MM-DD') AS date_key,
           occurrence_going_count(s.id, g.d::date) AS going
      FROM series_in_window s
      CROSS JOIN LATERAL generate_series(
             GREATEST((v_from AT TIME ZONE s.tz)::date, (s.start_datetime AT TIME ZONE s.tz)::date),
             (v_to AT TIME ZONE s.tz)::date, interval '1 day') g(d)
     WHERE event_recurrence_matches(s.start_datetime AT TIME ZONE s.tz, s.recurrence_pattern, g.d::date)
       AND NOT EXISTS (
         SELECT 1 FROM event_occurrence_exceptions x
          WHERE x.event_id = s.id AND x.occurrence_date = g.d::date AND x.kind = 'cancelled')
  )
  SELECT json_build_object(
    'events',  COALESCE((SELECT json_agg(row_to_json(u.*) ORDER BY u.start_datetime) FROM upcoming u), '[]'::json),
    'drafts',  COALESCE((SELECT json_agg(row_to_json(d.*) ORDER BY d.updated_at DESC) FROM drafts d), '[]'::json),
    'counts',  COALESCE((SELECT json_object_agg(c.id::text,
                          json_build_object('going', c.going, 'waitlist', c.waitlist)) FROM counts c), '{}'::json),
    'exceptions', COALESCE((SELECT json_agg(row_to_json(x.*)) FROM exceptions x), '[]'::json),
    'overviews', COALESCE((SELECT json_object_agg(o.id::text,
                            json_build_object('requested', o.requested,
                                              'waitlist', o.waitlist,
                                              'chat', json_build_object('open_reports', o.open_reports)))
                           FROM overviews o), '{}'::json),
    'date_going', COALESCE((SELECT json_object_agg(sd.id::text, sd.dates)
                            FROM (SELECT id, json_object_agg(date_key, going) AS dates
                                    FROM series_dates GROUP BY id) sd), '{}'::json),
    'inspected', (SELECT count(*) FROM targets),
    'eligible',  (SELECT count(*) FROM eligible),
    'truncated', (SELECT count(*) FROM upcoming) >= v_limit,
    'window', json_build_object('from', v_from, 'to', v_to)
  ) INTO result;

  RETURN result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_host_dashboard(uuid, timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_host_dashboard(uuid, timestamptz, timestamptz, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.get_host_dashboard(uuid, timestamptz, timestamptz, integer, integer) IS
  'The host dashboard in one request: agenda rows, drafts, going/waitlist '
  'counts, per-date exceptions and counts, and the bounded needs-attention '
  'facts. Replaces up to 17 calls (docs/HOST_DASHBOARD_PLAN.md C3).';
