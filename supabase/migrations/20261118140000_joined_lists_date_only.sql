-- Phase 4, migration 3 — EJ-24: events attended only by date join the lists.
--
-- STATUS: PREPARED, NOT APPLIED. Staged in supabase/prepared/; see this
-- folder's README. Apply AFTER 20261118120000: this re-creates
-- get_user_going_events ON TOP of that file's version (its next-date CASE is
-- included below), so applying this one alone would also apply E-R1 to this
-- single function — harmless, but confusing to reason about.
--
-- The gap (found 2026-11-17 while writing the per-session attendance
-- migration): someone going to an event ONLY through per-date RSVPs
-- (rsvp_occurrences, 20261109150000) appeared in no Joined list —
-- get_user_going_events selected from rsvps alone. Reminders, chat access
-- and every lifecycle notice already count these people; the lists were the
-- one surface that did not.
--
-- The membership becomes a UNION of series RSVPs and per-date "going" rows
-- (for the upcoming/past scopes only — interested/requested have no per-date
-- form). "Past" works unchanged through user_series_sessions_attended, which
-- already credits date-only goers for the dates they went to. Signature and
-- row shape are unchanged: NO type regeneration and NO client change.

CREATE OR REPLACE FUNCTION public.get_user_going_events(user_id_param uuid, p_scope text DEFAULT 'upcoming'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result json;
  want_past boolean;
  safe_limit integer;
  safe_offset integer;
BEGIN
  IF p_scope NOT IN ('upcoming', 'past', 'interested', 'requested') THEN
    RAISE EXCEPTION 'Invalid scope %, expected upcoming, past, interested or requested', p_scope;
  END IF;

  want_past := (p_scope = 'past');
  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  -- Privacy: upcoming lists follow the profile's sharing settings; history is
  -- only ever visible to its owner.
  IF NOT can_view_user_events(user_id_param) THEN
    RETURN '[]'::json;
  END IF;
  -- History, the lower-signal "interested" list and pending approval
  -- requests are only for the owner.
  IF p_scope IN ('past', 'interested', 'requested') AND auth.uid() IS DISTINCT FROM user_id_param THEN
    RETURN '[]'::json;
  END IF;

  SELECT COALESCE(
    json_agg(
      json_build_object(
        'id', sub.id,
        'business_id', sub.business_id,
        'title', sub.title,
        'description', sub.description,
        'category_id', sub.category_id,
        'start_datetime', sub.start_datetime,
        'end_datetime', sub.end_datetime,
        'lat', sub.lat,
        'lng', sub.lng,
        'address', sub.address,
        'cover_image_url', sub.cover_image_url,
        'is_recurring', sub.is_recurring,
        'recurrence_pattern', sub.recurrence_pattern,
        'timezone', sub.timezone,                               -- 20261104120000
        'status', sub.status,                                   -- added
        'created_at', sub.created_at,
        'updated_at', sub.updated_at,
        'business_name', sub.business_name,
        'business_logo_url', sub.business_logo_url,
        'category_label', sub.category_label,
        'category_slug', sub.category_slug,
        'rsvp_count', sub.rsvp_count,
        'save_count', sub.save_count,
        'next_start_datetime', sub.next_start_datetime
      )
      ORDER BY sub.sort_key, sub.start_datetime
    ),
    '[]'::json
  ) INTO result
  FROM (
    SELECT
      e.id,
      e.business_id,
      e.title,
      e.description,
      e.category_id,
      e.start_datetime,
      e.end_datetime,
      e.lat,
      e.lng,
      e.address,
      COALESCE(
        e.cover_image_url,
        (SELECT ep.image_url FROM event_photos ep WHERE ep.event_id = e.id ORDER BY ep.sort_order ASC LIMIT 1)
      ) AS cover_image_url,
      COALESCE(e.is_recurring, false) AS is_recurring,
      e.recurrence_pattern,
      e.timezone,                                               -- 20261104120000
      e.status,                                                 -- added
      e.created_at,
      e.updated_at,
      b.name AS business_name,
      b.logo_url AS business_logo_url,
      c.label AS category_label,
      c.slug AS category_slug,
      COALESCE(rc.count, 0) AS rsvp_count,
      COALESCE(sc.count, 0) AS save_count,
      CASE
        WHEN COALESCE(e.is_recurring, false) AND e.recurrence_pattern IS NOT NULL
             AND EXISTS (SELECT 1 FROM event_occurrence_exceptions oxx WHERE oxx.event_id = e.id)
          THEN event_next_effective_occurrence(e.id, now())
        WHEN COALESCE(e.is_recurring, false) AND e.start_datetime < now() AND e.recurrence_pattern IS NOT NULL
          THEN event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
        ELSE e.start_datetime
      END AS next_start_datetime,
      -- Upcoming: whatever happens next comes first (an event already in
      -- progress keeps its past start and therefore leads). Past: most recent first.
      CASE WHEN want_past
        THEN -extract(epoch FROM e.start_datetime)
        ELSE  extract(epoch FROM CASE
        WHEN COALESCE(e.is_recurring, false) AND e.recurrence_pattern IS NOT NULL
             AND EXISTS (SELECT 1 FROM event_occurrence_exceptions oxx WHERE oxx.event_id = e.id)
          THEN event_next_effective_occurrence(e.id, now())
        WHEN COALESCE(e.is_recurring, false) AND e.start_datetime < now() AND e.recurrence_pattern IS NOT NULL
          THEN event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
        ELSE e.start_datetime
      END)
      END AS sort_key
    FROM (
      SELECT r0.event_id
        FROM rsvps r0
       WHERE r0.user_id = user_id_param
         AND r0.status = CASE p_scope WHEN 'interested' THEN 'interested' WHEN 'requested' THEN 'requested' ELSE 'going' END
      UNION
      -- EJ-24: a per-date "going" with no series RSVP still joins the list.
      -- Reminders, chat access and every lifecycle notice already count
      -- these people; the Joined lists were the one place that did not.
      SELECT ro.event_id
        FROM rsvp_occurrences ro
       WHERE p_scope IN ('upcoming', 'past')
         AND ro.user_id = user_id_param
         AND ro.status = 'going'
    ) r
    JOIN events e ON e.id = r.event_id
    JOIN businesses b ON b.id = e.business_id
    JOIN categories c ON c.id = e.category_id
    LEFT JOIN (
      SELECT event_id, COUNT(*) AS count FROM rsvps WHERE status = 'going' GROUP BY event_id
    ) rc ON rc.event_id = e.id
    LEFT JOIN (
      SELECT event_id, COUNT(*) AS count FROM saves GROUP BY event_id
    ) sc ON sc.event_id = e.id
    -- A cancelled event never happened: it is neither upcoming nor attended.
    WHERE e.status = 'active'
      -- EJ-16: "past" (attended) also lists a series still running once the
      -- user attended at least one of its dates, matching attended_count.
      AND CASE WHEN want_past
               THEN event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
                    OR (COALESCE(e.is_recurring, false) AND user_series_sessions_attended(e.id, user_id_param) > 0)
               ELSE NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
          END
    ORDER BY sort_key, e.start_datetime
    LIMIT safe_limit
    OFFSET safe_offset
  ) sub;

  RETURN result;
END;
$function$;
