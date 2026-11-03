-- Event chat: host posting, live settings, block-aware notifications
-- (events-flow review Tier 1, 2026-11-02).
--
--  1. Hosts can post in their own event's chat without a 'going' RSVP. The
--     INSERT policy (20261028180000) required attendee access even for the
--     host, so a host who locked the chat locked themselves out too while
--     the UI said "only you can post". get_event_chat_post_status.can_post
--     is updated to match so the composer shows for hosts.
--  2. event_chat_settings joins the realtime publication: the client already
--     subscribes to it (services/eventChat.ts onSettingsChanged) so lock /
--     slow-mode changes reach attendees as they happen instead of on the
--     next failed send.
--  3. notify_attendees_on_chat_message and get_event_chat_unread_counts
--     honour user_blocks: a blocked sender can no longer push-notify or
--     @mention the person who blocked them, and the unread badge matches
--     the messages the blocker actually sees (20261030116000 hid them from
--     the SELECT policy but not from these SECURITY DEFINER paths).
--
-- Validated on a scratch copy of the local DB; not applied to the shared DB.

-- 1. Host posting ---------------------------------------------------------------

DROP POLICY IF EXISTS "Going attendees can send active event chat messages" ON event_chat_messages;
CREATE POLICY "Going attendees can send active event chat messages"
  ON event_chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND deleted_at IS NULL
    AND (user_can_access_event_chat(event_id) OR user_is_event_host(event_id))   -- host added
    AND NOT user_is_banned(auth.uid())
    AND NOT user_is_blocked_from_event_chat(event_id, auth.uid())
    AND (
      NOT COALESCE((SELECT s.locked FROM event_chat_settings s WHERE s.event_id = event_chat_messages.event_id), false)
      OR is_admin_user()
      OR user_is_event_host(event_id)
    )
  );

CREATE OR REPLACE FUNCTION public.get_event_chat_post_status(event_uuid uuid)
RETURNS TABLE(
  can_read boolean, can_post boolean, is_banned boolean, is_blocked boolean,
  is_host boolean, is_admin boolean, muted boolean, locked boolean,
  slow_mode_seconds integer, block_expires_at timestamp with time zone,
  last_read_at timestamp with time zone, last_post_at timestamp with time zone
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH s AS (
    SELECT COALESCE(st.locked, false) AS locked, COALESCE(st.slow_mode_seconds, 0) AS slow
    FROM (SELECT 1) one LEFT JOIN event_chat_settings st ON st.event_id = event_uuid
  ),
  roles AS (
    SELECT user_is_event_host(event_uuid) AS host, is_admin_user() AS admin,
           user_can_access_event_chat(event_uuid) AS attendee,
           user_is_banned(auth.uid()) AS banned,
           user_is_blocked_from_event_chat(event_uuid, auth.uid()) AS blocked
  )
  SELECT
    (roles.attendee OR roles.host OR roles.admin),
    ((roles.attendee OR roles.host) AND NOT roles.banned AND NOT roles.blocked   -- host added
      AND (NOT s.locked OR roles.host OR roles.admin)),
    roles.banned, roles.blocked, roles.host, roles.admin,
    COALESCE((SELECT r.muted FROM event_chat_reads r WHERE r.event_id = event_uuid AND r.user_id = auth.uid()), false),
    s.locked, s.slow,
    (SELECT b.expires_at FROM event_chat_blocks b WHERE b.event_id = event_uuid AND b.user_id = auth.uid()),
    (SELECT NULLIF(r.last_read_at, 'epoch'::timestamptz) FROM event_chat_reads r WHERE r.event_id = event_uuid AND r.user_id = auth.uid()),
    (SELECT max(m.created_at) FROM event_chat_messages m WHERE m.event_id = event_uuid AND m.sender_id = auth.uid())
  FROM s, roles;
$function$;

-- 2. Live chat settings ----------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'event_chat_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE event_chat_settings;
  END IF;
END $$;

-- 3. Blocks in notifications and unread counts -----------------------------------

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
  SELECT e.title INTO v_event_title FROM events e WHERE e.id = NEW.event_id;
  SELECT COALESCE(p.name, 'Someone') INTO v_sender_name FROM profiles p WHERE p.id = NEW.sender_id;
  v_snippet := left(NEW.body, 120) || CASE WHEN char_length(NEW.body) > 120 THEN '…' ELSE '' END;

  -- Mentions bypass the per-chat throttle and mute, but one sender can only
  -- ping a given person once every 5 minutes per event, and a recipient gets
  -- at most 3 mention pushes per event per 15 minutes. Recipients who
  -- blocked the sender are never notified.
  FOR v_recipient IN
    SELECT r.user_id
    FROM rsvps r
    JOIN profiles p ON p.id = r.user_id
    LEFT JOIN event_chat_reads cr ON cr.event_id = r.event_id AND cr.user_id = r.user_id
    WHERE r.event_id = NEW.event_id
      AND r.status = 'going'
      AND r.user_id <> NEW.sender_id
      AND r.user_id = ANY(NEW.mentions)
      AND NOT EXISTS (                                                     -- added
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
    SELECT r.user_id
    FROM rsvps r
    JOIN profiles p ON p.id = r.user_id
    LEFT JOIN event_chat_reads cr ON cr.event_id = r.event_id AND cr.user_id = r.user_id
    WHERE r.event_id = NEW.event_id
      AND r.status = 'going'
      AND r.user_id <> NEW.sender_id
      AND NOT (r.user_id = ANY(NEW.mentions))
      AND NOT EXISTS (                                                     -- added
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

CREATE OR REPLACE FUNCTION public.get_event_chat_unread_counts(p_event_ids uuid[] DEFAULT NULL::uuid[])
RETURNS TABLE(event_id uuid, unread_count integer, latest_message_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    r.event_id,
    (
      SELECT count(*)::integer FROM (
        SELECT 1
        FROM event_chat_messages m
        WHERE m.event_id = r.event_id
          AND m.created_at > COALESCE(cr.last_read_at, 'epoch'::timestamptz)
          AND m.deleted_at IS NULL
          AND m.sender_id <> auth.uid()
          AND NOT EXISTS (                                                 -- added
            SELECT 1 FROM user_blocks ub
            WHERE ub.blocker_id = auth.uid() AND ub.blocked_id = m.sender_id
          )
        LIMIT 1000
      ) bounded
    ) AS unread_count,
    (
      SELECT m.created_at FROM event_chat_messages m
      WHERE m.event_id = r.event_id AND m.deleted_at IS NULL
        AND NOT EXISTS (                                                   -- added
          SELECT 1 FROM user_blocks ub
          WHERE ub.blocker_id = auth.uid() AND ub.blocked_id = m.sender_id
        )
      ORDER BY m.created_at DESC LIMIT 1
    ) AS latest_message_at
  FROM rsvps r
  LEFT JOIN event_chat_reads cr ON cr.event_id = r.event_id AND cr.user_id = auth.uid()
  WHERE auth.uid() IS NOT NULL
    AND r.user_id = auth.uid()
    AND r.status = 'going'
    AND (p_event_ids IS NULL OR r.event_id = ANY(p_event_ids))
    AND EXISTS (SELECT 1 FROM event_chat_messages m WHERE m.event_id = r.event_id AND m.deleted_at IS NULL)
    AND user_can_access_event_chat(r.event_id);
$function$;
