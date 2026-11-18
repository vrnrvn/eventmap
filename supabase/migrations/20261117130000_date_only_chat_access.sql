-- Event journey review, migration 4 of 7 (docs/EVENT_JOURNEY_REVIEW_2026-11-17.md).
--
-- STATUS: PREPARED, NOT APPLIED. Staged in supabase/prepared/; validated only
-- in a throwaway isolated container. See this folder's README. Apply after
-- migration 3 (which sets eventmap.skip_chat_notice on announcement mirrors).
--
--   EJ-19 (owner decision 2026-11-17) date-only goers get the event chat: a
--         per-date "going" row counts as going for reading, posting and the
--         two-going unlock. Like series goers, they keep access after their
--         date (chat after the end is decision EJ-7, still open).
--   EJ-22 chat notifications go only to people who can open the chat (they
--         went to every "going" row, e.g. the lone attendee of a chat still
--         locked by "two going"), and not for the announcement mirror, which
--         produced a second notice for the same announcement (reproduced).
-- user_can_access_event_chat keeps its signature; it now delegates to a
-- per-user event_chat_member() so the notification trigger can ask the same
-- question about each recipient. Policies and get_event_chat_post_status call
-- user_can_access_event_chat and follow automatically.

CREATE OR REPLACE FUNCTION public.event_chat_member(p_event_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p_user_id IS NOT NULL
    AND COALESCE((SELECT s.chat_mode FROM event_chat_settings s WHERE s.event_id = p_event_id), 'open') <> 'off'
    AND (
      EXISTS (SELECT 1 FROM rsvps r
               WHERE r.event_id = p_event_id AND r.user_id = p_user_id AND r.status = 'going')
      OR EXISTS (SELECT 1 FROM rsvp_occurrences ro
                  WHERE ro.event_id = p_event_id AND ro.user_id = p_user_id AND ro.status = 'going')
    )
    AND (
      COALESCE((SELECT s.open_policy FROM event_chat_settings s WHERE s.event_id = p_event_id), 'two_going') = 'any_going'
      OR EXISTS (SELECT 1 FROM rsvps r
                  WHERE r.event_id = p_event_id AND r.status = 'going' AND r.user_id <> p_user_id)
      OR EXISTS (SELECT 1 FROM rsvp_occurrences ro
                  WHERE ro.event_id = p_event_id AND ro.status = 'going' AND ro.user_id <> p_user_id)
    );
$function$;
-- Internal: asked about OTHER users, so not callable by clients.
REVOKE EXECUTE ON FUNCTION public.event_chat_member(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.user_can_access_event_chat(event_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND event_chat_member(event_uuid, auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.notify_attendees_on_chat_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event_title text;
  v_sender_name text;
  v_snippet text;
  v_recipient record;
BEGIN
  -- EJ-22: the host's announcement mirror — everyone just got the
  -- announcement notice itself (send_event_announcement sets this).
  IF COALESCE(current_setting('eventmap.skip_chat_notice', true), '') = 'true' THEN
    RETURN NEW;
  END IF;
  SELECT e.title INTO v_event_title FROM events e WHERE e.id = NEW.event_id;
  SELECT host_display_name(p.name, COALESCE(p.is_profile_private, false))
  INTO v_sender_name FROM profiles p WHERE p.id = NEW.sender_id;
  v_sender_name := COALESCE(v_sender_name, 'Someone');
  v_snippet := left(NEW.body, 120) || CASE WHEN char_length(NEW.body) > 120 THEN '…' ELSE '' END;

  FOR v_recipient IN
    -- EJ-19/22: chat members only (series goers and date-only goers who can
    -- actually open this chat), not every "going" row.
    SELECT r.user_id
    FROM (
      SELECT g.user_id FROM rsvps g WHERE g.event_id = NEW.event_id AND g.status = 'going'
      UNION
      SELECT ro.user_id FROM rsvp_occurrences ro WHERE ro.event_id = NEW.event_id AND ro.status = 'going'
    ) r
    JOIN profiles p ON p.id = r.user_id
    LEFT JOIN event_chat_reads cr ON cr.event_id = NEW.event_id AND cr.user_id = r.user_id
    WHERE r.user_id <> NEW.sender_id
      AND event_chat_member(NEW.event_id, r.user_id)
      AND r.user_id = ANY(NEW.mentions)
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks ub
        WHERE ub.blocker_id = r.user_id AND ub.blocked_id = NEW.sender_id
      )
      AND COALESCE((p.notification_preferences->>'chat_message')::boolean, true)
      AND (cr.last_read_at IS NULL OR cr.last_read_at < now() - interval '1 minute')
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = r.user_id AND n.type = 'chat_mention' AND n.event_id = NEW.event_id
          AND n.data->>'senderId' = NEW.sender_id::text
          AND n.created_at > now() - interval '5 minutes'
      )
      AND (
        SELECT count(*) FROM notifications n
        WHERE n.user_id = r.user_id AND n.type = 'chat_mention' AND n.event_id = NEW.event_id
          AND n.created_at > now() - interval '15 minutes'
      ) < 3
  LOOP
    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    VALUES (
      v_recipient.user_id, 'chat_mention',
      v_sender_name || ' mentioned you in ' || COALESCE(v_event_title, 'an event chat'),
      v_snippet, NEW.event_id,
      jsonb_build_object('eventId', NEW.event_id, 'kind', 'chat', 'messageId', NEW.id, 'senderId', NEW.sender_id)
    );
  END LOOP;

  FOR v_recipient IN
    -- EJ-19/22: chat members only (series goers and date-only goers who can
    -- actually open this chat), not every "going" row.
    SELECT r.user_id
    FROM (
      SELECT g.user_id FROM rsvps g WHERE g.event_id = NEW.event_id AND g.status = 'going'
      UNION
      SELECT ro.user_id FROM rsvp_occurrences ro WHERE ro.event_id = NEW.event_id AND ro.status = 'going'
    ) r
    JOIN profiles p ON p.id = r.user_id
    LEFT JOIN event_chat_reads cr ON cr.event_id = NEW.event_id AND cr.user_id = r.user_id
    WHERE r.user_id <> NEW.sender_id
      AND event_chat_member(NEW.event_id, r.user_id)
      AND NOT (r.user_id = ANY(NEW.mentions))
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks ub
        WHERE ub.blocker_id = r.user_id AND ub.blocked_id = NEW.sender_id
      )
      AND COALESCE((p.notification_preferences->>'chat_message')::boolean, true)
      AND NOT COALESCE(cr.muted, false)
      AND (cr.last_read_at IS NULL OR cr.last_read_at < now() - interval '1 minute')
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = r.user_id AND n.type IN ('chat_message', 'chat_mention')
          AND n.event_id = NEW.event_id AND n.created_at > now() - interval '15 minutes'
      )
  LOOP
    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    VALUES (
      v_recipient.user_id, 'chat_message', COALESCE(v_event_title, 'Event chat'),
      v_sender_name || ': ' || v_snippet, NEW.event_id,
      jsonb_build_object('eventId', NEW.event_id, 'kind', 'chat')
    );
  END LOOP;
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NEW;
END;
$function$;
