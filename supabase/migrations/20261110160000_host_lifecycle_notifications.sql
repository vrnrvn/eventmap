-- Host onboarding Stage 6: notifications the host receives
-- (docs/HOST_ONBOARDING_PLAN.md §4 Stage 6, §18).
--
-- 1. host_day_of            — "your event starts in a few hours" (cron)
-- 2. host_post_event_summary — what happened, with a nudge to run it again (cron)
-- 3. host_verification_update — a decision on a verification request (trigger)
-- 4. host_standing_update    — a warning or restriction, or its removal (trigger)
--
-- Per-RSVP notifications to the host already exist (notify_business_on_rsvp,
-- 20260227000000), so the "first RSVP" push asked for in Stage 5 is already
-- delivered by that path; Stage 5 only added the in-app explanation.
--
-- Both cron notices are deduped in host_notifications_sent, so a re-run or an
-- overlapping schedule cannot send twice. The job is wrapped so a failure
-- cannot break the cron worker, matching send_event_reminders.
--
-- Recurring events are skipped for both notices: "the event ended" is not a
-- meaningful statement about a series, and per-occurrence reminders need the
-- occurrence work in CATEGORIES_AND_SERIES_PLAN. Noted in the plan.
-- Idempotent; safe to re-run.

CREATE TABLE IF NOT EXISTS host_notifications_sent (
  event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('day_of', 'post_event')),
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, kind)
);

ALTER TABLE host_notifications_sent ENABLE ROW LEVEL SECURITY;
-- Bookkeeping for the cron job only: no policies, so only SECURITY DEFINER
-- functions and the service role can see or write it.
REVOKE ALL ON host_notifications_sent FROM anon, authenticated;

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

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('host_event_notices', '*/15 * * * *', 'SELECT send_host_event_notices()');
EXCEPTION
  WHEN OTHERS THEN NULL;   -- pg_cron absent (e.g. a test copy): the function still works
END;
$$;

-- 3. Verification decisions ---------------------------------------------------
CREATE OR REPLACE FUNCTION notify_host_on_verification_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_title text;
  v_body text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = NEW.business_id;
  IF v_owner IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'approved' THEN
    v_title := 'You are verified';
    v_body := 'Your events now show a verified badge.';
  ELSIF NEW.status = 'needs_info' THEN
    v_title := 'More information needed';
    v_body := COALESCE(NEW.reviewer_note, 'EventMap needs a bit more to verify you.');
  ELSIF NEW.status = 'rejected' THEN
    v_title := 'Verification not approved';
    v_body := COALESCE(NEW.reviewer_note, 'You can try again with a different link.');
  ELSE
    RETURN NEW;   -- back to pending (the host resubmitted): nothing to say
  END IF;
  INSERT INTO notifications (user_id, type, title, body, business_id)
  VALUES (v_owner, 'host_verification_update', v_title, v_body, NEW.business_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_host_verification ON host_verification_requests;
CREATE TRIGGER trigger_notify_host_verification
  AFTER UPDATE ON host_verification_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_host_on_verification_decision();

-- 4. Standing changes ----------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_host_on_standing_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_body text;
BEGIN
  IF NEW.standing IS NOT DISTINCT FROM OLD.standing THEN
    RETURN NEW;
  END IF;
  IF NEW.standing = 'restricted' THEN
    v_title := 'Publishing is paused';
    v_body := COALESCE(NEW.standing_reason, 'Contact support for details.')
      || ' You can still edit drafts and manage existing events.';
  ELSIF NEW.standing = 'warning' THEN
    v_title := 'Your account has a warning';
    v_body := COALESCE(NEW.standing_reason, 'Contact support for details.');
  ELSE
    v_title := 'Your account is in good standing';
    v_body := 'You can publish events again.';
  END IF;
  INSERT INTO notifications (user_id, type, title, body, business_id)
  VALUES (NEW.owner_id, 'host_standing_update', v_title, v_body, NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_host_standing ON businesses;
CREATE TRIGGER trigger_notify_host_standing
  AFTER UPDATE ON businesses
  FOR EACH ROW
  EXECUTE FUNCTION notify_host_on_standing_change();
