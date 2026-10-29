-- Serialize throttle checks per sender so concurrent inserts cannot slip past
-- the rate limit / slow mode between the count and the insert.

CREATE OR REPLACE FUNCTION enforce_event_chat_rate_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_recent integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  -- Transaction-scoped lock keyed on the sender; released at commit/rollback.
  PERFORM pg_advisory_xact_lock(hashtext('event_chat_rate:' || NEW.sender_id::text));
  SELECT count(*) INTO v_recent
  FROM event_chat_messages m
  WHERE m.sender_id = NEW.sender_id AND m.created_at > now() - interval '10 seconds';
  IF v_recent >= 10 THEN
    RAISE EXCEPTION 'chat_rate_limited' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_event_chat_slow_mode()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_seconds integer;
  v_last timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  SELECT s.slow_mode_seconds INTO v_seconds FROM event_chat_settings s WHERE s.event_id = NEW.event_id;
  IF COALESCE(v_seconds, 0) = 0 THEN RETURN NEW; END IF;
  IF is_admin_user() OR user_is_event_host(NEW.event_id) THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('event_chat_slow:' || NEW.event_id::text || ':' || NEW.sender_id::text));
  SELECT max(m.created_at) INTO v_last
  FROM event_chat_messages m WHERE m.event_id = NEW.event_id AND m.sender_id = NEW.sender_id;
  IF v_last IS NOT NULL AND v_last > now() - make_interval(secs => v_seconds) THEN
    RAISE EXCEPTION 'chat_slow_mode' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

-- Report validation targets client submissions; service-role / admin tooling
-- inserts (no auth.uid()) bypass RLS and must not be blocked here.
CREATE OR REPLACE FUNCTION validate_chat_message_report()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_msg record;
BEGIN
  IF NEW.target_type <> 'chat_message' OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  SELECT m.id, m.event_id, m.sender_id INTO v_msg FROM event_chat_messages m WHERE m.id = NEW.target_id;
  IF v_msg.id IS NULL THEN RAISE EXCEPTION 'chat_report_not_allowed: message not found'; END IF;
  IF v_msg.sender_id = NEW.reporter_id THEN RAISE EXCEPTION 'chat_report_not_allowed: cannot report your own message'; END IF;
  IF user_is_banned(NEW.reporter_id) THEN RAISE EXCEPTION 'chat_report_not_allowed: account suspended'; END IF;
  IF NOT (user_can_access_event_chat(v_msg.event_id) OR user_is_event_host(v_msg.event_id) OR is_admin_user()) THEN
    RAISE EXCEPTION 'chat_report_not_allowed: no access to this chat';
  END IF;
  RETURN NEW;
END;
$$;
