-- get_events_compare: every column of an event comparison in one call
-- (docs/EVENT_COMPARISON_PLAN.md §3.5 P6; ROADMAP.md "Phase 8 in detail").
--
-- PREPARED 2026-11-15, NOT APPLIED to the shared local database and never to
-- a hosted one. Validated on the isolated PG17 container only
-- (scripts/pg17-isolated.sh) with scripts/test-events-compare.sql. The owner
-- applies migrations; see docs/MIGRATIONS_PENDING.md.
--
-- The client does NOT call this yet (decision D7: the per-event
-- get_event_details path stays until usage warrants the cutover). When it
-- does, hooks/useCompareEvents.ts gains a batch path — no probe-and-retry
-- fallback, per the client/schema policy in docs/ISSUES.md.
--
-- Visibility mirrors get_event_details exactly, because the comparison must
-- see what the event page sees: SECURITY DEFINER, drafts only for the owner
-- or an admin, unlisted events reachable by id (the share-link path), and
-- cancelled / postponed events returned with their status so the column can
-- say so. Anything else missing simply isn't in the result — never an error.
--
-- Up to 4 ids (COMPARE_MAX in stores/compareStore.ts); more raises
-- too_many_events. Duplicates collapse, nulls are ignored, and the output
-- keeps the caller's order.
--
-- next_start_datetime uses event_next_effective_occurrence (20261109140000),
-- so skipped and moved dates are honoured here even though get_ranked_events
-- still uses the plain helper (docs/ISSUES.md, E-R1).

DROP FUNCTION IF EXISTS public.get_events_compare(uuid[], double precision, double precision);

CREATE OR REPLACE FUNCTION public.get_events_compare(
  p_event_ids uuid[],
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
  v_viewer uuid := auth.uid();
  v_admin boolean := is_admin_user();
  result json;
BEGIN
  -- Distinct, non-null, in first-seen order.
  SELECT COALESCE(array_agg(id ORDER BY ord), '{}'::uuid[]) INTO v_ids
  FROM (
    SELECT id, min(ord) AS ord
    FROM unnest(p_event_ids) WITH ORDINALITY AS t(id, ord)
    WHERE id IS NOT NULL
    GROUP BY id
  ) d;

  IF array_length(v_ids, 1) IS NULL THEN
    RETURN '[]'::json;
  END IF;
  IF array_length(v_ids, 1) > 4 THEN
    RAISE EXCEPTION 'too_many_events: compare up to 4 events at a time'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(json_agg(row ORDER BY ord), '[]'::json) INTO result
  FROM (
    SELECT
      t.ord,
      to_jsonb(e.*) || jsonb_build_object(
        'business_name',     b.name,
        'business_logo_url', b.logo_url,
        'business_verified', COALESCE(b.verified, false),
        'category_label',    c.label,
        'category_slug',     c.slug,
        'rsvp_count',   (SELECT count(*) FROM rsvps r WHERE r.event_id = e.id AND r.status = 'going'),
        'save_count',   (SELECT count(*) FROM saves s WHERE s.event_id = e.id),
        'waitlist_count', (SELECT count(*) FROM event_waitlist w WHERE w.event_id = e.id),
        'user_rsvp',    CASE WHEN v_viewer IS NULL THEN NULL
                             ELSE (SELECT r.status FROM rsvps r WHERE r.event_id = e.id AND r.user_id = v_viewer) END,
        'user_saved',   CASE WHEN v_viewer IS NULL THEN false
                             ELSE EXISTS (SELECT 1 FROM saves s WHERE s.event_id = e.id AND s.user_id = v_viewer) END,
        'distance_km',  CASE WHEN p_lat IS NULL OR p_lng IS NULL THEN NULL
                             ELSE calculate_distance(p_lat, p_lng, e.lat, e.lng) END,
        'next_start_datetime',
                        CASE WHEN COALESCE(e.is_recurring, false)
                             THEN event_next_effective_occurrence(e.id, now())
                             ELSE e.start_datetime END
      ) AS row
    FROM unnest(v_ids) WITH ORDINALITY AS t(id, ord)
    JOIN events e ON e.id = t.id
    JOIN businesses b ON b.id = e.business_id
    JOIN categories c ON c.id = e.category_id
    -- Same gate as get_event_details: drafts are the host's (or an admin's) alone.
    WHERE NOT (e.publish_state = 'draft' AND NOT (b.owner_id = v_viewer OR v_admin))
  ) rows;

  RETURN result;
END;
$function$;

COMMENT ON FUNCTION public.get_events_compare(uuid[], double precision, double precision) IS
  'Event comparison: up to 4 events by id with host, category, counts, viewer state, distance from (p_lat,p_lng) and the effective next date. Visibility mirrors get_event_details.';

-- Callable signed in or out, like get_event_details (a shared comparison link
-- opens signed-out); viewer fields are null / false for anon.
REVOKE ALL ON FUNCTION public.get_events_compare(uuid[], double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_events_compare(uuid[], double precision, double precision) TO anon, authenticated;
