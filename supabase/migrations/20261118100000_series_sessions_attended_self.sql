-- Batch C follow-up, 1 of 1 (docs/EVENT_JOURNEY_REVIEW_PLAN_2026-11-17.md §5a).
--
-- STATUS: PREPARED, NOT APPLIED. Staged in supabase/prepared/ so no stack
-- start, reset or test harness applies it by accident. See this folder's
-- README. Independent of everything else; nothing in the app depends on it
-- until it is applied (docs/ISSUES.md ground rules: no probe-and-retry).
--
-- Why: C6 (EJ-16) wants "You've been to N sessions" on a series' page, but
-- user_series_sessions_attended(uuid, uuid) — added by 20261117160000, which
-- IS applied — is deliberately REVOKEd from anon and authenticated, because
-- it answers about any user (`:73`). There is no granted path to the number
-- for the signed-in viewer: get_event_details doesn't carry it, and
-- get_user_attendance_counts is per-user totals, not per-series.
--
-- This adds the missing seam and nothing else: a wrapper that can only ever
-- answer about the caller. It passes auth.uid() itself, so a client cannot
-- ask about anyone else, and it re-uses the counting rule rather than
-- restating it (one definition of "attended").

CREATE OR REPLACE FUNCTION public.get_event_sessions_attended(p_event_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- 0 when signed out, for a one-off, or for an unknown id: the inner
  -- function already returns 0 for anything that is not a live series.
  SELECT CASE
           WHEN auth.uid() IS NULL THEN 0
           ELSE user_series_sessions_attended(p_event_id, auth.uid())
         END;
$function$;

COMMENT ON FUNCTION public.get_event_sessions_attended(uuid) IS
  'Finished sessions of this series the CALLER attended (EJ-16/C6). Self-only '
  'wrapper over user_series_sessions_attended, which stays internal because it '
  'can be asked about any user.';

REVOKE EXECUTE ON FUNCTION public.get_event_sessions_attended(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_sessions_attended(uuid) TO authenticated;
