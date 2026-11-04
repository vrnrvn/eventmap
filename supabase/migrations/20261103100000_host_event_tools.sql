-- Host "Manage event" hub: server foundations.
--
-- STATUS: prepared, NOT applied to the shared local DB (another dev session
-- owns it). Validated on an isolated scratch copy only; apply after the
-- 20261102* set. The client (services/hostTools.ts) falls back to the public
-- RPCs when these functions are missing, so it can ship ahead of this file.
--
-- What this adds, all host/admin only:
--   1. get_event_host_overview(p_event_id)       counts the host needs on the
--      Overview tab in one round-trip (going / interested / waitlist / saves /
--      views / chat health). Today the host can only see "going" and saves via
--      get_event_details; interested and waitlist rows are hidden by RLS.
--   2. get_event_host_attendees_page(...)         attendee list with REAL ids
--      and RSVP status so the host can act (remove, later: check-in, promote).
--      The public page RPC anonymises private profiles with a hashed id, which
--      makes "Remove attendee" impossible for exactly the rows a host most
--      often needs to act on.
--
--      Privacy decision (2026-11-03): attendees with a private profile or
--      "show me in Who's going" off are shown to the HOST as first name +
--      last initial ("Sam K."), with no avatar or bio. Rationale: the toggles
--      promise anonymity from other attendees, not from the organiser; the
--      host already receives the full name in the RSVP notification; and
--      every comparable service (Luma, Meetup, Partiful, Eventbrite) gives
--      hosts identity while hiding guests from each other.
--
-- host_remove_attendee (20261102150000) is unchanged and used as-is.

-- 0. Display-name helper ----------------------------------------------------------
--
-- "Samantha Kaur"  -> "Samantha K."     "sam"   -> "sam"
-- "Sam  van Dyke"  -> "Sam D."          ''/NULL -> 'Attendee'

CREATE OR REPLACE FUNCTION public.host_display_name(p_name text, p_private boolean)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN NULLIF(btrim(COALESCE(p_name, '')), '') IS NULL THEN 'Attendee'
    WHEN NOT COALESCE(p_private, false) THEN btrim(p_name)
    ELSE (
      WITH parts AS (
        SELECT regexp_split_to_array(btrim(p_name), '\s+') AS w
      )
      SELECT CASE
        WHEN array_length(w, 1) = 1 THEN w[1]
        ELSE w[1] || ' ' || left(w[array_length(w, 1)], 1) || '.'
      END
      FROM parts
    )
  END;
$function$;

-- 1. Overview counts ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_event_host_overview(p_event_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  result json;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT b.owner_id INTO v_owner
  FROM events e JOIN businesses b ON b.id = e.business_id
  WHERE e.id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can view this';
  END IF;

  SELECT json_build_object(
    'going',      (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = p_event_id AND r.status = 'going'),
    'interested', (SELECT COUNT(*) FROM rsvps r WHERE r.event_id = p_event_id AND r.status = 'interested'),
    'waitlist',   (SELECT COUNT(*) FROM event_waitlist w WHERE w.event_id = p_event_id),
    'saves',      (SELECT COUNT(*) FROM saves s WHERE s.event_id = p_event_id),
    'views_total',(SELECT COUNT(*) FROM event_views v WHERE v.event_id = p_event_id),
    'views_7d',   (SELECT COUNT(*) FROM event_views v
                   WHERE v.event_id = p_event_id AND v.viewed_at >= now() - interval '7 days'),
    'chat', json_build_object(
      'locked',            COALESCE((SELECT cs.locked FROM event_chat_settings cs WHERE cs.event_id = p_event_id), false),
      'slow_mode_seconds', COALESCE((SELECT cs.slow_mode_seconds FROM event_chat_settings cs WHERE cs.event_id = p_event_id), 0),
      'message_count',     (SELECT COUNT(*) FROM event_chat_messages m
                            WHERE m.event_id = p_event_id AND m.deleted_at IS NULL),
      'blocked_count',     (SELECT COUNT(*) FROM event_chat_blocks bl
                            WHERE bl.event_id = p_event_id
                              AND (bl.expires_at IS NULL OR bl.expires_at > now())),
      'open_reports',      (SELECT COUNT(DISTINCT c.target_id) FROM complaints c
                            JOIN event_chat_messages m ON m.id = c.target_id
                            WHERE c.target_type = 'chat_message'
                              AND c.status = 'pending'
                              AND m.event_id = p_event_id)
    )
  ) INTO result;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_host_overview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_host_overview(uuid) TO authenticated;

-- 2. Host attendee list -------------------------------------------------------------
--
-- p_status: 'going' (default) | 'interested' | 'waitlist'. Waitlist rows come
-- from event_waitlist ordered by join time, which is also their position.

CREATE OR REPLACE FUNCTION public.get_event_host_attendees_page(
  p_event_id uuid,
  p_status text DEFAULT 'going',
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  safe_limit integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
  safe_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  search text := NULLIF(trim(COALESCE(p_search, '')), '');
  pattern text;
  result json;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_status NOT IN ('going', 'interested', 'waitlist') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  SELECT b.owner_id INTO v_owner
  FROM events e JOIN businesses b ON b.id = e.business_id
  WHERE e.id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can view attendees';
  END IF;

  IF search IS NOT NULL THEN
    pattern := '%' || replace(replace(replace(search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  WITH matched AS (
    SELECT
      p.id          AS user_id,
      p.name,
      p.avatar_url,
      p.bio,
      (COALESCE(p.is_profile_private, false) OR COALESCE(p.show_attendance_publicly, true) = false) AS is_private,
      src.status,
      src.joined_at,
      EXISTS (
        SELECT 1 FROM event_chat_blocks bl
        WHERE bl.event_id = p_event_id AND bl.user_id = p.id
          AND (bl.expires_at IS NULL OR bl.expires_at > now())
      ) AS chat_blocked
    FROM (
      SELECT r.user_id, r.status, r.created_at AS joined_at
      FROM rsvps r
      WHERE r.event_id = p_event_id AND p_status <> 'waitlist' AND r.status = p_status
      UNION ALL
      SELECT w.user_id, 'waitlist'::text, w.created_at
      FROM event_waitlist w
      WHERE w.event_id = p_event_id AND p_status = 'waitlist'
    ) src
    JOIN profiles p ON p.id = src.user_id
    WHERE pattern IS NULL
       OR host_display_name(
            p.name,
            (COALESCE(p.is_profile_private, false) OR COALESCE(p.show_attendance_publicly, true) = false)
          ) ILIKE pattern
  ),
  total AS (SELECT COUNT(*) AS c FROM matched),
  page AS (
    SELECT * FROM matched
    ORDER BY joined_at, user_id
    LIMIT safe_limit OFFSET safe_offset
  )
  SELECT json_build_object(
    'total', (SELECT c FROM total),
    'items', COALESCE((
      SELECT json_agg(json_build_object(
        'user_id',     user_id,
        -- Private profiles: "First L." only, no avatar or bio (see header).
        'name',        host_display_name(name, is_private),
        'avatar_url',  CASE WHEN is_private THEN NULL ELSE avatar_url END,
        'bio',         CASE WHEN is_private THEN NULL ELSE LEFT(COALESCE(bio, ''), 80) END,
        'is_private',  is_private,
        'status',      status,
        'joined_at',   joined_at,
        'chat_blocked', chat_blocked
      ) ORDER BY joined_at, user_id)
      FROM page), '[]'::json),
    'has_more', (safe_offset + (SELECT COUNT(*) FROM page)) < (SELECT c FROM total)
  ) INTO result;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_host_attendees_page(uuid, text, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_host_attendees_page(uuid, text, integer, integer, text) TO authenticated;

-- event_waitlist (event_id, created_at) is already indexed by 20261102160000.
