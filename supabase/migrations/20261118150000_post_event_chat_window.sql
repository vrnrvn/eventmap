-- Phase 4, migration 4 — D1 (EJ-7): the chat after the event ends.
--
-- STATUS: PREPARED, NOT APPLIED. Staged in supabase/prepared/; see this
-- folder's README. Independent of the other phase-4 files.
--
-- Owner decision (Batch D, answered 2026-11-18 as the recommended default):
-- attendees can post for SEVEN DAYS after the event is over, then the chat is
-- read-only; the history stays visible to the people who could read it.
--   * A series counts from the SERIES end (a weekly club's chat never closes
--     mid-run; no endDate = never closes).
--   * A cancelled event follows the same rule from its scheduled end: the
--     existing "the chat stays open for everyone who was going" promise now
--     lasts a week rather than forever.
--   * The constant lives in event_chat_posting_open below; the client half
--     mirrors it as CHAT_AFTER_END_DAYS in utils/eventChatAccess.ts
--     (NOT built yet — nothing client-side may depend on this file until it
--     is applied; see the README's client cutover).
--
-- Four objects:
--   1. event_chat_posting_open(event) — the rule, once. event_has_ended's
--      boundary pushed 7 days out.
--   2. The INSERT policy on event_chat_messages gains it (hosts too:
--      read-only is read-only).
--   3. get_event_chat_post_status.can_post gains it, so the client learns
--      the state from the same answer it already fetches.
--   4. send_event_announcement skips the chat mirror once read-only; the
--      announcement itself and its notifications are unaffected.
-- can_read is untouched everywhere.

CREATE OR REPLACE FUNCTION public.event_chat_posting_open(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- CHAT_AFTER_END_DAYS = 7 (mirrored by the client once this is applied).
  -- One-off (cancelled included, from its scheduled end): end + 7 days.
  -- Series: the 7 days count in whole local days after its endDate, matching
  -- event_has_ended's local-calendar-day boundary; open on the endDate + 7th
  -- day, closed on the 8th. No endDate: never closes.
  SELECT COALESCE((
    SELECT CASE
      WHEN NOT COALESCE(e.is_recurring, false)
        THEN e.end_datetime + interval '7 days' > now()
      WHEN COALESCE(e.recurrence_pattern->>'endDate', '') ~ '^\d{4}-\d{2}-\d{2}'
        THEN left(e.recurrence_pattern->>'endDate', 10)::date + 7
             >= (now() AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'UTC'))::date
      ELSE true
    END
    FROM events e WHERE e.id = p_event_id
  ), false);
$function$;
-- The INSERT policy evaluates it as the querying role.
GRANT EXECUTE ON FUNCTION public.event_chat_posting_open(uuid) TO authenticated;

DROP POLICY IF EXISTS "Going attendees can send active event chat messages" ON public.event_chat_messages;
CREATE POLICY "Going attendees can send active event chat messages"
  ON public.event_chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND deleted_at IS NULL
    AND (user_can_access_event_chat(event_id) OR user_is_event_host(event_id))
    AND NOT user_is_banned((SELECT auth.uid()))
    AND NOT user_is_blocked_from_event_chat(event_id, (SELECT auth.uid()))
    -- D1 (EJ-7): read-only once the posting window has closed.
    AND event_chat_posting_open(event_id)
    AND CASE COALESCE((SELECT s.chat_mode FROM event_chat_settings s WHERE s.event_id = event_chat_messages.event_id), 'open')
          WHEN 'open' THEN true
          WHEN 'announcements' THEN ((SELECT is_admin_user()) OR user_is_event_host(event_id))
          ELSE false
        END
  );

CREATE OR REPLACE FUNCTION public.get_event_chat_post_status(event_uuid uuid)
 RETURNS TABLE(can_read boolean, can_post boolean, is_banned boolean, is_blocked boolean, is_host boolean, is_admin boolean, muted boolean, locked boolean, slow_mode_seconds integer, block_expires_at timestamp with time zone, last_read_at timestamp with time zone, last_post_at timestamp with time zone, chat_mode text, open_policy text, pinned_message_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH s AS (
    SELECT COALESCE(st.locked, false) AS locked,
           COALESCE(st.slow_mode_seconds, 0) AS slow,
           COALESCE(st.chat_mode, 'open') AS mode,
           COALESCE(st.open_policy, 'two_going') AS policy,
           st.pinned_message_id AS pinned
    FROM (SELECT 1) one LEFT JOIN event_chat_settings st ON st.event_id = event_uuid
  ),
  roles AS (
    SELECT user_is_event_host(event_uuid) AS host, is_admin_user() AS admin,
           user_can_access_event_chat(event_uuid) AS attendee,
           user_is_banned(auth.uid()) AS banned,
           user_is_blocked_from_event_chat(event_uuid, auth.uid()) AS blocked
  )
  SELECT
    -- Mode 'off' hides the chat from attendees (user_can_access_event_chat
    -- already returns false for them); host/admin keep read access so the
    -- history and moderation tools stay reachable.
    (roles.attendee OR roles.host OR roles.admin),
    ((roles.attendee OR roles.host) AND NOT roles.banned AND NOT roles.blocked
      -- D1 (EJ-7): read-only once the posting window has closed.
      AND event_chat_posting_open(event_uuid)
      AND (s.mode = 'open' OR (s.mode = 'announcements' AND (roles.host OR roles.admin)))),
    roles.banned, roles.blocked, roles.host, roles.admin,
    COALESCE((SELECT r.muted FROM event_chat_reads r WHERE r.event_id = event_uuid AND r.user_id = auth.uid()), false),
    s.locked, s.slow,
    (SELECT b.expires_at FROM event_chat_blocks b WHERE b.event_id = event_uuid AND b.user_id = auth.uid()),
    (SELECT NULLIF(r.last_read_at, 'epoch'::timestamptz) FROM event_chat_reads r WHERE r.event_id = event_uuid AND r.user_id = auth.uid()),
    (SELECT max(m.created_at) FROM event_chat_messages m WHERE m.event_id = event_uuid AND m.sender_id = auth.uid()),
    s.mode, s.policy, s.pinned
  FROM s, roles;
$function$;

CREATE OR REPLACE FUNCTION public.send_event_announcement(p_event_id uuid, p_body text, p_audience text DEFAULT 'going'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
  v_body text := btrim(COALESCE(p_body, ''));
  v_today integer;
  v_recipients integer := 0;
  v_announcement_id uuid;
  v_mirror_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_audience NOT IN ('going', 'all') THEN RAISE EXCEPTION 'invalid_audience'; END IF;
  IF char_length(v_body) = 0 THEN RAISE EXCEPTION 'invalid_body: empty'; END IF;
  IF char_length(v_body) > 500 THEN RAISE EXCEPTION 'invalid_body: too long'; END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = v_event.business_id;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can announce';
  END IF;
  IF v_event.status = 'cancelled' THEN RAISE EXCEPTION 'event_cancelled'; END IF;

  SELECT COUNT(*) INTO v_today
  FROM host_announcements a
  WHERE a.event_id = p_event_id AND a.created_at > now() - interval '1 day';
  IF v_today >= 3 THEN RAISE EXCEPTION 'announcement_limit: at most 3 per event per day'; END IF;

  INSERT INTO host_announcements (event_id, created_by, body, audience)
  VALUES (p_event_id, auth.uid(), v_body, p_audience)
  RETURNING id INTO v_announcement_id;

  WITH people AS (
    SELECT r.user_id FROM rsvps r
     WHERE r.event_id = p_event_id AND (p_audience = 'all' OR r.status = 'going')
    -- EJ-19: date-only goers with a date still ahead count as "going".
    UNION
    SELECT ro.user_id FROM rsvp_occurrences ro
     WHERE ro.event_id = p_event_id
       AND (ro.status = 'going' OR (p_audience = 'all' AND ro.status = 'waitlist'))
       AND ro.occurrence_date >= (now() AT TIME ZONE COALESCE(NULLIF(v_event.timezone, ''), 'UTC'))::date
  ), targets AS (
    SELECT DISTINCT pe.user_id
    FROM people pe
    JOIN profiles p ON p.id = pe.user_id
    WHERE pe.user_id <> auth.uid()
      AND COALESCE((p.notification_preferences->>'host_announcement')::boolean, true)
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks ub WHERE ub.blocker_id = pe.user_id AND ub.blocked_id = auth.uid()
      )
  ), inserted AS (
    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    SELECT t.user_id, 'host_announcement',
           'Update from the host: ' || COALESCE(v_event.title, 'your event'),
           v_body, p_event_id,
           jsonb_build_object('eventId', p_event_id, 'kind', 'host_announcement', 'announcementId', v_announcement_id)
    FROM targets t
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_recipients FROM inserted;

  UPDATE host_announcements SET recipients = v_recipients WHERE id = v_announcement_id;

  -- Mirror into the chat and pin it, so late joiners see the latest
  -- announcement without scrolling. SECURITY DEFINER bypasses the posting
  -- policy, so the mode check is explicit: a switched-off chat gets no
  -- mirror (attendees could never read it). Trigger failures (rate limits)
  -- stay best-effort.
  BEGIN
    -- D1 (EJ-7): a read-only chat gets no mirror either; the announcement
    -- notifications above are unaffected.
    IF COALESCE((SELECT cs.chat_mode FROM event_chat_settings cs WHERE cs.event_id = p_event_id), 'open') <> 'off'
       AND event_chat_posting_open(p_event_id) THEN
    -- EJ-22: everyone just got the announcement itself; the chat-message
    -- trigger skips its own notice for this mirror (migration 4 reads it).
    PERFORM set_config('eventmap.skip_chat_notice', 'true', true);
    INSERT INTO event_chat_messages (event_id, sender_id, body, mentions)
    VALUES (p_event_id, auth.uid(), '📣 ' || v_body, '{}')
    RETURNING id INTO v_mirror_id;
    PERFORM set_config('eventmap.skip_chat_notice', '', true);

    INSERT INTO event_chat_settings (event_id, pinned_message_id, updated_by, updated_at)
    VALUES (p_event_id, v_mirror_id, auth.uid(), now())
    ON CONFLICT (event_id) DO UPDATE SET
      pinned_message_id = v_mirror_id,
      updated_by = auth.uid(),
      updated_at = now();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN json_build_object('id', v_announcement_id, 'recipients', v_recipients, 'sent_today', v_today + 1);
END;
$function$;
