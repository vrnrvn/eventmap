-- "Run it again" (duplicate v2), 1 of 1.
--
-- STATUS: PREPARED, NOT APPLIED. Staged in supabase/prepared/ so no stack
-- start, reset or test harness applies it by accident. See this folder's
-- README for the apply runbook and the client cutover that follows it.
-- Independent of every other prepared file; apply in any order.
--
-- What is wrong with the live duplicate_event (20261103170000:840):
--   1. For a source in the past it shifts by (now() + 7 days) - start, so the
--      copy starts at the CURRENT CLOCK TIME a week out — 14:37:22 instead of
--      19:00. That is the ordinary "run last month's class again" case.
--   2. The shift is UTC interval arithmetic, so a daylight-saving change
--      inside that week moves the local start by an hour.
--   3. No way to say when the copy should run; the host fixes the date in
--      Edit afterwards.
--   4. " (copy)" is appended even when the host means "the same event, again".
--   5. A double tap makes a second draft: no idempotency key, unlike
--      create_event_with_limit_check.
--   6. chat_mode / open_policy / slow_mode_seconds are not copied; the client
--      patches chat_mode afterwards, best-effort (services/eventPresetSettings).
--   7. Nothing records that B came from A, so "Run it again" in the host
--      playbook can only read a device-local flag (utils/eventPlaybook.ts:441).
--
-- This file fixes 1-7. The client already fixes 1-4 for its own flow by
-- writing the chosen date to the fresh draft (hooks/useDuplicateEvent.ts);
-- after this is applied that second write is removed — see the README.
--
-- NOT in scope, deliberately: copying a series' recurrence (`p_keep_recurrence`).
-- Premium is enforced for recurrence by check_recurring_premium_on_update
-- (20261108110000:44), an UPDATE trigger, and in create_event_with_limit_check
-- — an INSERT here would bypass both and hand out a Premium feature. It needs
-- its own decision and an explicit business_has_premium() check. The copy
-- stays a one-off, as today, and the client now says so in the sheet.

-- ── Lineage ─────────────────────────────────────────────────────────────────
-- Which event this one was copied from. ON DELETE SET NULL: deleting the
-- original must never cascade into the copy.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS duplicated_from uuid REFERENCES public.events(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.events.duplicated_from IS
  'The event this one was duplicated from (duplicate v2). Lets "Run it again" '
  'be answered from the database instead of a device-local flag, and lets '
  'insights compare one edition with the last.';

CREATE INDEX IF NOT EXISTS events_duplicated_from_idx
  ON public.events (duplicated_from) WHERE duplicated_from IS NOT NULL;

-- ── The function ────────────────────────────────────────────────────────────
-- DROP the ONE-ARGUMENT function first: adding defaulted parameters alongside
-- it would create an OVERLOAD, and duplicate_event(uuid) would then be
-- ambiguous for every existing caller. Same pattern as 20261103160000's
-- get_event_chat_post_status.
--
-- The new signature is then CREATE OR REPLACE, not CREATE, so re-applying
-- this file is a no-op instead of "function already exists with same argument
-- types" (caught when validating idempotency).
DROP FUNCTION IF EXISTS public.duplicate_event(uuid);

CREATE OR REPLACE FUNCTION public.duplicate_event(
  p_event_id uuid,
  p_start timestamptz DEFAULT NULL,
  p_end timestamptz DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
  v_new_id uuid;
  v_tz text;
  v_src_day date;
  v_today date;
  v_day date;
  v_local_time time;
  v_start timestamptz;
  v_end timestamptz;
  v_title text;
  v_existing uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF user_is_banned(auth.uid()) THEN RAISE EXCEPTION 'not_allowed: account suspended'; END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = v_event.business_id;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can duplicate';
  END IF;

  -- Idempotency (fix 5): the same key from the same business returns the copy
  -- that already exists instead of making a second draft. Mirrors
  -- create_event_with_limit_check's contract (20261108100000), and rides the
  -- same partial unique index.
  IF p_client_request_id IS NOT NULL THEN
    SELECT e.id INTO v_existing FROM events e
     WHERE e.business_id = v_event.business_id
       AND e.client_request_id = p_client_request_id;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  END IF;

  v_tz := COALESCE(NULLIF(v_event.timezone, ''), 'UTC');

  -- When it runs (fixes 1-3). An explicit p_start wins; otherwise keep the
  -- source's LOCAL time of day and move the day:
  --   * still ahead  -> a week after it ("same thing again next week");
  --   * already past -> the next time that weekday comes round, after today.
  -- The arithmetic is done on the zone's wall clock and converted back with
  -- AT TIME ZONE, so a DST change between the two dates keeps 19:00 at 19:00.
  IF p_start IS NOT NULL THEN
    v_start := p_start;
  ELSE
    v_src_day := (v_event.start_datetime AT TIME ZONE v_tz)::date;
    v_today := (now() AT TIME ZONE v_tz)::date;
    v_local_time := (v_event.start_datetime AT TIME ZONE v_tz)::time;
    IF v_src_day > v_today THEN
      v_day := v_src_day + 7;
    ELSE
      v_day := v_today + 1;
      WHILE EXTRACT(dow FROM v_day) <> EXTRACT(dow FROM v_src_day) LOOP
        v_day := v_day + 1;
      END LOOP;
    END IF;
    v_start := (v_day + v_local_time) AT TIME ZONE v_tz;
  END IF;

  -- The source's exact duration unless the caller says otherwise.
  v_end := COALESCE(p_end, v_start + (v_event.end_datetime - v_event.start_datetime));

  IF v_end <= v_start THEN
    RAISE EXCEPTION 'invalid_duplicate: the new end must be after the new start';
  END IF;
  -- A copy is for running the thing again; publish_event refuses an event
  -- that is already over, so a past start can only ever be a mistake.
  IF v_start <= now() THEN
    RAISE EXCEPTION 'invalid_duplicate: the new start must be in the future';
  END IF;

  -- Title (fix 4): the caller's, else the old " (copy)" default so that an
  -- unchanged caller behaves exactly as before.
  v_title := NULLIF(btrim(COALESCE(p_title, '')), '');
  v_title := left(COALESCE(v_title, v_event.title || ' (copy)'), 200);

  INSERT INTO events (
    business_id, title, description, category_id,
    start_datetime, end_datetime, lat, lng, address,
    cover_image_url, is_recurring, recurrence_pattern, max_attendees,
    rsvp_closed, waitlist_mode, rsvp_mode, timezone,
    publish_state, visibility, ticket_url, price_label, age_restriction, accessibility_notes, what_to_bring,
    status, event_type, duplicated_from, client_request_id
  ) VALUES (
    v_event.business_id, v_title, v_event.description, v_event.category_id,
    v_start, v_end, v_event.lat, v_event.lng, v_event.address,
    v_event.cover_image_url, false, NULL, v_event.max_attendees,
    false, v_event.waitlist_mode, COALESCE(v_event.rsvp_mode, 'open'), v_event.timezone,
    'draft', v_event.visibility, v_event.ticket_url, v_event.price_label, v_event.age_restriction, v_event.accessibility_notes, v_event.what_to_bring,
    'active', v_event.event_type, p_event_id, p_client_request_id
  )
  RETURNING id INTO v_new_id;

  INSERT INTO event_links (event_id, label, url, sort_order)
  SELECT v_new_id, l.label, l.url, l.sort_order FROM event_links l WHERE l.event_id = p_event_id;

  INSERT INTO event_photos (event_id, image_url, sort_order)
  SELECT v_new_id, ph.image_url, ph.sort_order FROM event_photos ph WHERE ph.event_id = p_event_id;

  -- Chat set-up (fix 6): how the host runs the room carries over. Never the
  -- room's state — `locked` and `pinned_message_id` belong to the old event.
  INSERT INTO event_chat_settings (event_id, chat_mode, open_policy, slow_mode_seconds, updated_by)
  SELECT v_new_id, s.chat_mode, s.open_policy, s.slow_mode_seconds, auth.uid()
    FROM event_chat_settings s
   WHERE s.event_id = p_event_id
  ON CONFLICT (event_id) DO NOTHING;

  RETURN v_new_id;
END;
$function$;

-- Unchanged from the live function: callable by signed-in hosts only.
REVOKE EXECUTE ON FUNCTION public.duplicate_event(uuid, timestamptz, timestamptz, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_event(uuid, timestamptz, timestamptz, text, uuid) TO authenticated;
