-- Visual-check fixture for host insights. SCRATCH COPIES ONLY: this COMMITs
-- synthetic rows. Apply after scripts/calendar-visual.fixture.sql:
--
--   SCRATCH_DB=eventmap_scratch_<yours> scripts/db-scratch.sh apply scripts/insights-visual.fixture.sql
--
-- Gives "Gallery night" (cafe…01, Europe/Lisbon) two weeks of views, saves,
-- RSVPs at different lead times, a capacity and an announcement.

BEGIN;

UPDATE events SET max_attendees = 10 WHERE id = 'cafe0000-0000-4000-8000-000000000001';

-- Two weeks of views: anonymous-style rows (no viewer) for volume, plus the
-- two demo attendees so "people who viewed" is non-zero.
INSERT INTO event_views (event_id, viewer_id, viewed_at, view_date)
SELECT 'cafe0000-0000-4000-8000-000000000001', NULL, now() - make_interval(days => d, hours => h), (now() - make_interval(days => d))::date
FROM generate_series(0, 13) d, generate_series(1, 1 + (13 - d) % 5) h;
INSERT INTO event_views (event_id, viewer_id, viewed_at, view_date) VALUES
  ('cafe0000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', now() - interval '12 days', (now() - interval '12 days')::date),
  ('cafe0000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', now() - interval '5 days', (now() - interval '5 days')::date)
ON CONFLICT DO NOTHING;

INSERT INTO saves (user_id, event_id, created_at)
VALUES ('10000000-0000-4000-8000-000000000002', 'cafe0000-0000-4000-8000-000000000001', now() - interval '12 days')
ON CONFLICT DO NOTHING;

-- RSVP lead times: alex 2 weeks out, sam 5 days out.
UPDATE rsvps SET created_at = now() - interval '12 days'
WHERE event_id = 'cafe0000-0000-4000-8000-000000000001' AND user_id = '10000000-0000-4000-8000-000000000002';
SELECT set_config('eventmap.allow_approval', 'true', true);
INSERT INTO rsvps (user_id, event_id, status, created_at)
VALUES ('10000000-0000-4000-8000-000000000003', 'cafe0000-0000-4000-8000-000000000001', 'going', now() - interval '5 days')
ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'going', created_at = EXCLUDED.created_at;
SELECT set_config('eventmap.allow_approval', '', true);

INSERT INTO host_announcements (event_id, created_by, body, audience, recipients)
VALUES ('cafe0000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Doors open at 7', 'going', 2);
INSERT INTO notifications (user_id, type, title, body, event_id, read) VALUES
  ('10000000-0000-4000-8000-000000000002', 'host_announcement', 'Doors open at 7', 'Gallery night', 'cafe0000-0000-4000-8000-000000000001', true),
  ('10000000-0000-4000-8000-000000000003', 'host_announcement', 'Doors open at 7', 'Gallery night', 'cafe0000-0000-4000-8000-000000000001', false);

-- Taps and RSVP movement (20261104090000), when those tables exist.
DO $$
BEGIN
  IF to_regclass('public.event_interactions') IS NULL THEN RETURN; END IF;
  INSERT INTO event_interactions (event_id, viewer_id, kind, created_at, day) VALUES
    ('cafe0000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'share',      now() - interval '3 days', (now() - interval '3 days')::date),
    ('cafe0000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'share',      now() - interval '2 days', (now() - interval '2 days')::date),
    ('cafe0000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'calendar',   now() - interval '2 days', (now() - interval '2 days')::date),
    ('cafe0000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'directions', now() - interval '1 day',  (now() - interval '1 day')::date)
  ON CONFLICT DO NOTHING;
  -- Synthetic departures (no user attached) so the drop-off line has data.
  INSERT INTO rsvp_history (event_id, user_id, from_status, to_status, changed_at) VALUES
    ('cafe0000-0000-4000-8000-000000000001', NULL, NULL, 'going', now() - interval '9 days'),
    ('cafe0000-0000-4000-8000-000000000001', NULL, 'going', 'left', now() - interval '4 days'),
    ('cafe0000-0000-4000-8000-000000000001', NULL, NULL, 'going', now() - interval '8 days'),
    ('cafe0000-0000-4000-8000-000000000001', NULL, 'going', 'interested', now() - interval '3 days');
END $$;

COMMIT;
