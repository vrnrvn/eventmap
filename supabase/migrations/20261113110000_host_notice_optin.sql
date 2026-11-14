-- Host notices become opt-in (docs/HOST_EVENT_PLAYBOOK_PLAN.md P6).
--
-- 20261110160000 added two cron notices to the host — 'host_day_of' and
-- 'host_post_event_summary' — gated on businesses.notifications_enabled,
-- which defaults to TRUE. That makes them opt-out: applying that migration
-- would start pushing to every existing host without being asked.
--
-- The owner's decision (2026-11-13) is consent first: both notices are off
-- until the host turns them on in Settings. This migration adds one column
-- per notice, defaulting to FALSE, and re-creates send_host_event_notices()
-- to require them.
--
-- Apply AFTER 20261110160000 (it replaces that function). Idempotent.
--
-- notifications_enabled stays the master switch for host notifications
-- (RSVPs, followers): turning it off silences these two as well, so a host
-- who wants nothing does not have to find three switches.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS host_day_of_notice boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS host_post_event_notice boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.businesses.host_day_of_notice IS
  'Opt-in: notify the host a few hours before their event starts. Off by default.';
COMMENT ON COLUMN public.businesses.host_post_event_notice IS
  'Opt-in: notify the host with a summary after their event ends. Off by default.';

CREATE OR REPLACE FUNCTION send_host_event_notices()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_going integer;
  v_waitlist integer;
  v_views integer;
BEGIN
  -- 1. Day-of: a one-off event starting in the next 2–4 hours.
  FOR v_row IN
    SELECT e.id, e.title, e.business_id, b.owner_id
      FROM events e
      JOIN businesses b ON b.id = e.business_id
     WHERE COALESCE(e.publish_state, 'published') = 'published'
       AND COALESCE(e.status, 'active') = 'active'
       AND COALESCE(e.is_recurring, false) = false
       AND e.start_datetime > now() + interval '2 hours'
       AND e.start_datetime <= now() + interval '4 hours'
       AND COALESCE(b.notifications_enabled, true)
       AND COALESCE(b.host_day_of_notice, false)
       AND NOT EXISTS (
         SELECT 1 FROM host_notifications_sent s
          WHERE s.event_id = e.id AND s.kind = 'day_of'
       )
  LOOP
    SELECT count(*) INTO v_going FROM rsvps r WHERE r.event_id = v_row.id AND r.status = 'going';
    INSERT INTO notifications (user_id, type, title, body, event_id, business_id)
    VALUES (
      v_row.owner_id,
      'host_day_of',
      'Your event is today',
      COALESCE(v_row.title, 'Your event') || ' starts in a few hours with ' || v_going
        || CASE WHEN v_going = 1 THEN ' person going.' ELSE ' people going.' END
        || ' Pin a message or send an announcement if anything changed.',
      v_row.id,
      v_row.business_id
    );
    INSERT INTO host_notifications_sent (event_id, kind) VALUES (v_row.id, 'day_of')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- 2. Post-event: ended between 2 and 26 hours ago (one pass per event).
  FOR v_row IN
    SELECT e.id, e.title, e.business_id, b.owner_id
      FROM events e
      JOIN businesses b ON b.id = e.business_id
     WHERE COALESCE(e.publish_state, 'published') = 'published'
       AND COALESCE(e.status, 'active') = 'active'
       AND COALESCE(e.is_recurring, false) = false
       AND e.end_datetime < now() - interval '2 hours'
       AND e.end_datetime >= now() - interval '26 hours'
       AND COALESCE(b.notifications_enabled, true)
       AND COALESCE(b.host_post_event_notice, false)
       AND NOT EXISTS (
         SELECT 1 FROM host_notifications_sent s
          WHERE s.event_id = e.id AND s.kind = 'post_event'
       )
  LOOP
    SELECT count(*) INTO v_going FROM rsvps r WHERE r.event_id = v_row.id AND r.status = 'going';
    SELECT count(*) INTO v_waitlist FROM event_waitlist w WHERE w.event_id = v_row.id;
    SELECT count(*) INTO v_views FROM event_views v WHERE v.event_id = v_row.id;
    INSERT INTO notifications (user_id, type, title, body, event_id, business_id)
    VALUES (
      v_row.owner_id,
      'host_post_event_summary',
      'How ' || COALESCE(v_row.title, 'your event') || ' went',
      v_going || ' going · ' || v_waitlist || ' on the waitlist · ' || v_views
        || ' views. Duplicate it or turn it into a series to run it again.',
      v_row.id,
      v_row.business_id
    );
    INSERT INTO host_notifications_sent (event_id, kind) VALUES (v_row.id, 'post_event')
    ON CONFLICT DO NOTHING;
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN NULL;   -- never break the cron worker
END;
$$;

REVOKE EXECUTE ON FUNCTION send_host_event_notices() FROM PUBLIC, anon, authenticated;
