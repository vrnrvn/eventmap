-- Moderation feedback, host attendee control, report hygiene
-- (events-flow review Tier 2, 2026-11-02).
--
--  1. Reports can be filed over and over for the same target: the unique
--     index only covers chat_message. Extended to every target type, so the
--     admin queue stops filling with duplicates and the client can turn a
--     23505 into "you've already reported this" (already handled client-side).
--
--  2. Reporters never learn what happened. A trigger on complaints now
--     notifies the reporter when an admin resolves or dismisses their report.
--
--  3. Moderated users are told nothing: being removed from a chat or having a
--     message deleted by a host is silent, discoverable only by reopening the
--     chat. Both RPCs now notify the affected user.
--
--  4. A host can remove someone from a chat but not from the event itself, so
--     a problem attendee keeps their seat, the going count and the reminders.
--     Adds host_remove_attendee(), which drops the RSVP, blocks them from the
--     chat, clears pending reminders and tells them.
--
--  5. The host is pushed on every going<->interested flap and never hears
--     about a leave. The RSVP trigger now fires only on a genuinely new RSVP
--     or a change into 'going', and a new DELETE trigger reports leaves.
--
-- New notification types: 'moderation' and 'report_update'. The client's
-- Notification.type is a plain string and the notifications screen falls back
-- to a neutral icon, so unknown types render safely before any client work.
--
-- Validated on a scratch copy of the local DB; not applied to the shared DB.

-- 1. Report dedupe --------------------------------------------------------------

-- Keep only the newest report per (reporter, target) before adding the index.
DELETE FROM complaints c
USING complaints newer
WHERE c.reporter_id = newer.reporter_id
  AND c.target_type = newer.target_type
  AND c.target_id = newer.target_id
  AND c.created_at < newer.created_at;

DROP INDEX IF EXISTS idx_complaints_unique_chat_report;
CREATE UNIQUE INDEX IF NOT EXISTS idx_complaints_unique_report
  ON complaints (reporter_id, target_type, target_id);

-- 2. Report outcome notifications ------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_reporter_on_complaint_resolution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('resolved', 'dismissed') THEN
    RETURN NEW;
  END IF;

  INSERT INTO notifications (user_id, type, title, body, event_id, data)
  VALUES (
    NEW.reporter_id,
    'report_update',
    CASE WHEN NEW.status = 'resolved' THEN 'We acted on your report' ELSE 'Report reviewed' END,
    CASE
      WHEN NEW.status = 'resolved'
        THEN 'Thanks for flagging this. A moderator reviewed your report and took action.'
      ELSE 'A moderator reviewed your report and found no violation of our guidelines.'
    END,
    CASE WHEN NEW.target_type = 'event' THEN NEW.target_id ELSE NULL END,
    jsonb_build_object('complaintId', NEW.id, 'targetType', NEW.target_type, 'status', NEW.status)
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_notify_reporter_on_resolution ON complaints;
CREATE TRIGGER trigger_notify_reporter_on_resolution
  AFTER UPDATE OF status ON complaints
  FOR EACH ROW
  EXECUTE FUNCTION notify_reporter_on_complaint_resolution();

-- 3. Tell moderated users ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.block_event_chat_user(
  p_event_id uuid,
  p_user_id uuid,
  p_reason text DEFAULT NULL::text,
  p_duration_minutes integer DEFAULT NULL::integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_expires timestamptz := CASE WHEN p_duration_minutes IS NULL OR p_duration_minutes <= 0 THEN NULL
                                ELSE now() + make_interval(mins => p_duration_minutes) END;
  v_title text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (is_admin_user() OR user_is_event_host(p_event_id)) THEN
    RAISE EXCEPTION 'Not allowed to moderate this chat';
  END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'Cannot block yourself'; END IF;

  INSERT INTO event_chat_blocks (event_id, user_id, blocked_by, reason, expires_at)
  VALUES (p_event_id, p_user_id, auth.uid(), p_reason, v_expires)
  ON CONFLICT (event_id, user_id)
  DO UPDATE SET blocked_by = EXCLUDED.blocked_by, reason = EXCLUDED.reason, expires_at = EXCLUDED.expires_at, created_at = now();

  INSERT INTO event_chat_moderation_actions (event_id, target_user_id, actor_id, action, reason)
  VALUES (p_event_id, p_user_id, auth.uid(), 'block',
          COALESCE(p_reason, '') || CASE WHEN v_expires IS NULL THEN '' ELSE ' (until ' || to_char(v_expires AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC)' END);

  -- Tell the person: otherwise the first they know is a failed send.  -- added
  SELECT title INTO v_title FROM events WHERE id = p_event_id;
  INSERT INTO notifications (user_id, type, title, body, event_id, data)
  VALUES (
    p_user_id,
    'moderation',
    'Your chat access changed',
    CASE
      WHEN v_expires IS NULL
        THEN 'The host paused your posting in "' || COALESCE(v_title, 'an event') || '" chat. You can still read along.'
      ELSE 'The host paused your posting in "' || COALESCE(v_title, 'an event')
           || '" chat until ' || to_char(v_expires AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC.'
    END,
    p_event_id,
    jsonb_build_object('eventId', p_event_id, 'kind', 'chat_block', 'expiresAt', v_expires)
  );
END;
$function$;

-- Current definition (20261028240000: boolean result, evidence stashing,
-- report resolution) with only the author notification added.
CREATE OR REPLACE FUNCTION public.delete_event_chat_message(p_message_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_msg record;
  v_has_reports boolean;
  v_title text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT m.id, m.event_id, m.sender_id, m.deleted_at INTO v_msg FROM event_chat_messages m WHERE m.id = p_message_id;
  IF v_msg.id IS NULL OR v_msg.deleted_at IS NOT NULL THEN RETURN false; END IF;
  IF NOT (v_msg.sender_id = auth.uid() OR is_admin_user() OR user_is_event_host(v_msg.event_id)) THEN RETURN false; END IF;

  UPDATE event_chat_messages SET deleted_at = now(), deleted_by = auth.uid() WHERE id = p_message_id;

  IF v_msg.sender_id = auth.uid() THEN
    -- Author retraction: unrecoverable, but reported content stays available
    -- to admins as evidence until the reports are closed.
    SELECT EXISTS (
      SELECT 1 FROM complaints c
      WHERE c.target_type = 'chat_message' AND c.target_id = p_message_id AND c.status = 'pending'
    ) INTO v_has_reports;
    IF v_has_reports THEN
      PERFORM stash_removed_chat_body(p_message_id);
    ELSE
      UPDATE event_chat_messages SET body = '' WHERE id = p_message_id;
      DELETE FROM event_chat_removed_bodies WHERE message_id = p_message_id;
    END IF;
  ELSE
    PERFORM stash_removed_chat_body(p_message_id);
    INSERT INTO event_chat_moderation_actions (event_id, message_id, target_user_id, actor_id, action)
    VALUES (v_msg.event_id, p_message_id, v_msg.sender_id, auth.uid(), 'delete');
    UPDATE complaints SET status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
    WHERE target_type = 'chat_message' AND target_id = p_message_id AND status = 'pending';

    -- Tell the author their message was removed by someone else.     -- added
    SELECT title INTO v_title FROM events WHERE id = v_msg.event_id;
    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    VALUES (
      v_msg.sender_id,
      'moderation',
      'A message of yours was removed',
      'A moderator removed one of your messages in "' || COALESCE(v_title, 'an event') || '" chat.',
      v_msg.event_id,
      jsonb_build_object('eventId', v_msg.event_id, 'kind', 'message_removed')
    );
  END IF;
  RETURN true;
END;
$function$;

-- 4. Host can remove an attendee from the event -------------------------------------

CREATE OR REPLACE FUNCTION public.host_remove_attendee(
  p_event_id uuid,
  p_user_id uuid,
  p_reason text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_title text;
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT e.title, b.owner_id INTO v_title, v_owner
  FROM events e JOIN businesses b ON b.id = e.business_id
  WHERE e.id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;

  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can remove attendees';
  END IF;
  IF p_user_id = v_owner THEN RAISE EXCEPTION 'not_allowed: the host cannot be removed'; END IF;

  DELETE FROM rsvps WHERE event_id = p_event_id AND user_id = p_user_id;

  -- Removing the RSVP alone would let them simply re-join, so also block the
  -- chat (indefinitely; the host can lift it from the moderation sheet).
  INSERT INTO event_chat_blocks (event_id, user_id, blocked_by, reason, expires_at)
  VALUES (p_event_id, p_user_id, auth.uid(), COALESCE(p_reason, 'Removed from event'), NULL)
  ON CONFLICT (event_id, user_id)
  DO UPDATE SET blocked_by = EXCLUDED.blocked_by, reason = EXCLUDED.reason, expires_at = NULL, created_at = now();

  INSERT INTO event_chat_moderation_actions (event_id, target_user_id, actor_id, action, reason)
  VALUES (p_event_id, p_user_id, auth.uid(), 'block', COALESCE(p_reason, 'Removed from event'));

  DELETE FROM event_reminder_sent WHERE event_id = p_event_id AND user_id = p_user_id;

  INSERT INTO notifications (user_id, type, title, body, event_id, data)
  VALUES (
    p_user_id,
    'moderation',
    'Removed from an event',
    'The host removed you from "' || COALESCE(v_title, 'an event') || '".'
      || CASE WHEN p_reason IS NULL OR btrim(p_reason) = '' THEN '' ELSE ' Reason: ' || p_reason END,
    p_event_id,
    jsonb_build_object('eventId', p_event_id, 'kind', 'removed_from_event')
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.host_remove_attendee(uuid, uuid, text) TO authenticated;

-- 5. Saner host RSVP notifications ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_business_on_rsvp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner_id uuid;
  v_event_title text;
  v_actor_name text;
  v_status text;
  v_biz_notifications boolean;
  v_owner_pref boolean;
BEGIN
  -- Only a new RSVP or a move into 'going' is worth a push. Flipping
  -- going -> interested -> going used to notify every time.
  IF TG_OP = 'UPDATE' AND NOT (NEW.status = 'going' AND OLD.status IS DISTINCT FROM 'going') THEN
    RETURN NEW;
  END IF;

  SELECT b.owner_id, e.title, COALESCE(b.notifications_enabled, true)
  INTO v_owner_id, v_event_title, v_biz_notifications
  FROM events e
  JOIN businesses b ON b.id = e.business_id
  WHERE e.id = NEW.event_id;

  IF v_owner_id IS NULL OR v_owner_id = NEW.user_id OR NOT v_biz_notifications THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE((p.notification_preferences->>'rsvp')::boolean, true)
  INTO v_owner_pref FROM profiles p WHERE p.id = v_owner_id;
  IF NOT v_owner_pref THEN RETURN NEW; END IF;

  SELECT COALESCE(p.name, 'Someone') INTO v_actor_name FROM profiles p WHERE p.id = NEW.user_id;

  v_status := CASE NEW.status
    WHEN 'going' THEN 'is going to'
    WHEN 'interested' THEN 'is interested in'
    ELSE 'responded to'
  END;

  INSERT INTO notifications (user_id, type, title, body, event_id)
  VALUES (
    v_owner_id,
    'rsvp',
    'New RSVP on your event',
    v_actor_name || ' ' || v_status || ' "' || COALESCE(v_event_title, 'your event') || '".',
    NEW.event_id
  );

  RETURN NEW;
END;
$function$;

-- Leaves: the host currently never hears about them.
CREATE OR REPLACE FUNCTION public.notify_business_on_rsvp_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner_id uuid;
  v_event_title text;
  v_actor_name text;
  v_biz_notifications boolean;
  v_owner_pref boolean;
BEGIN
  -- Only a 'going' seat opening up matters to the host.
  IF OLD.status <> 'going' THEN RETURN OLD; END IF;

  SELECT b.owner_id, e.title, COALESCE(b.notifications_enabled, true)
  INTO v_owner_id, v_event_title, v_biz_notifications
  FROM events e
  JOIN businesses b ON b.id = e.business_id
  WHERE e.id = OLD.event_id;

  -- Event gone (cascade delete), self-leave, or the host removing someone
  -- themselves (host_remove_attendee): nothing to say.
  IF v_owner_id IS NULL OR v_owner_id = OLD.user_id OR v_owner_id = auth.uid() OR NOT v_biz_notifications THEN
    RETURN OLD;
  END IF;

  SELECT COALESCE((p.notification_preferences->>'rsvp')::boolean, true)
  INTO v_owner_pref FROM profiles p WHERE p.id = v_owner_id;
  IF NOT v_owner_pref THEN RETURN OLD; END IF;

  SELECT COALESCE(p.name, 'Someone') INTO v_actor_name FROM profiles p WHERE p.id = OLD.user_id;
  -- Account deletion cascades through rsvps after the profile row is gone.
  v_actor_name := COALESCE(v_actor_name, 'Someone');

  INSERT INTO notifications (user_id, type, title, body, event_id)
  VALUES (
    v_owner_id,
    'rsvp',
    'Someone left your event',
    v_actor_name || ' is no longer going to "' || COALESCE(v_event_title, 'your event') || '".',
    OLD.event_id
  );

  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_notify_business_on_rsvp_delete ON rsvps;
CREATE TRIGGER trigger_notify_business_on_rsvp_delete
  AFTER DELETE ON rsvps
  FOR EACH ROW
  EXECUTE FUNCTION notify_business_on_rsvp_delete();
