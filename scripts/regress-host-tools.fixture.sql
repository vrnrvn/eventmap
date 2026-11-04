-- Must run inside one transaction: the reschedule flag is transaction-local.
BEGIN;
-- Fixture for scripts/regress-host-tools.mjs on the isolated scratch copy.
SELECT set_config('eventmap.allow_reschedule','true',true);
UPDATE events SET
  start_datetime = now() + interval '1 day', end_datetime = now() + interval '1 day 2 hours',
  status='active', rsvp_closed=false, waitlist_mode='notify', max_attendees=NULL,
  publish_state='published', visibility='public', timezone=NULL
WHERE id IN ('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002');
UPDATE events SET rsvp_mode='approval' WHERE id='30000000-0000-4000-8000-000000000001';
UPDATE events SET rsvp_mode='open' WHERE id='30000000-0000-4000-8000-000000000002';
SELECT set_config('eventmap.allow_reschedule','',true);
DELETE FROM rsvps WHERE event_id='30000000-0000-4000-8000-000000000001';
DELETE FROM rsvps WHERE event_id='30000000-0000-4000-8000-000000000002' AND user_id <> '10000000-0000-4000-8000-000000000002';
DELETE FROM rsvps WHERE event_id='30000000-0000-4000-8000-000000000002';
DELETE FROM event_waitlist; DELETE FROM event_bans; DELETE FROM host_announcements;
DELETE FROM event_chat_settings WHERE event_id='30000000-0000-4000-8000-000000000001';
UPDATE businesses SET events_created_this_month = 0 WHERE owner_id='10000000-0000-4000-8000-000000000001';
COMMIT;
