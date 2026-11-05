-- Visual-check fixture for the personal calendar. SCRATCH COPIES ONLY:
-- this COMMITs synthetic rows. Never apply it to the shared `postgres` DB
-- (db-scratch.sh refuses SCRATCH_DB=postgres).
--
--   SCRATCH_DB=eventmap_scratch_<yours> scripts/db-scratch.sh apply scripts/calendar-visual.fixture.sql
--
-- Gives the demo attendee (alex) a November 2026 with every case the screen
-- draws: an overlap, a pending approval request, a cancellation with a note,
-- a three-day festival, a weekly zoned series, a saved and an interested
-- event. Times are Europe/Lisbon wall clock.

BEGIN;

DELETE FROM events WHERE id::text LIKE 'cafe0000-%';

UPDATE businesses SET subscription_tier = 'premium', subscription_expires_at = now() + interval '1 year'
WHERE owner_id = '10000000-0000-4000-8000-000000000001';

INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime,
                    lat, lng, address, is_recurring, recurrence_pattern, timezone, rsvp_mode, publish_state)
SELECT v.id::uuid, b.id, v.title, 'Synthetic calendar fixture', (SELECT id FROM categories ORDER BY slug LIMIT 1),
       (v.s || ' Europe/Lisbon')::timestamptz, (v.e || ' Europe/Lisbon')::timestamptz,
       38.7223, -9.1393, 'Synthetic venue, Lisbon', v.rec, v.pat::jsonb, 'Europe/Lisbon', v.mode, 'published'
FROM businesses b,
LATERAL (VALUES
  ('cafe0000-0000-4000-8000-000000000001', 'Gallery night',        '2026-11-06 19:00', '2026-11-06 21:00', false, NULL, 'open'),
  ('cafe0000-0000-4000-8000-000000000002', 'Book swap',            '2026-11-06 19:30', '2026-11-06 21:30', false, NULL, 'open'),
  ('cafe0000-0000-4000-8000-000000000003', 'Riverside run club',   '2026-10-06 19:00', '2026-10-06 20:00', true, '{"frequency":"weekly","interval":1}', 'open'),
  ('cafe0000-0000-4000-8000-000000000004', 'Pottery workshop',     '2026-11-12 18:00', '2026-11-12 20:30', false, NULL, 'approval'),
  ('cafe0000-0000-4000-8000-000000000005', 'Rooftop cinema',       '2026-11-14 21:00', '2026-11-14 23:30', false, NULL, 'open'),
  ('cafe0000-0000-4000-8000-000000000006', 'Lisbon jazz weekend',  '2026-11-20 16:00', '2026-11-22 23:00', false, NULL, 'open'),
  ('cafe0000-0000-4000-8000-000000000007', 'Saturday food market', '2026-11-07 10:00', '2026-11-07 14:00', false, NULL, 'open'),
  ('cafe0000-0000-4000-8000-000000000008', 'Design talk',          '2026-11-18 18:30', '2026-11-18 20:00', false, NULL, 'open')
) AS v(id, title, s, e, rec, pat, mode)
WHERE b.owner_id = '10000000-0000-4000-8000-000000000001';

INSERT INTO rsvps (user_id, event_id, status)
SELECT '10000000-0000-4000-8000-000000000002', x.id::uuid, x.status
FROM (VALUES
  ('cafe0000-0000-4000-8000-000000000001', 'going'),
  ('cafe0000-0000-4000-8000-000000000002', 'going'),
  ('cafe0000-0000-4000-8000-000000000003', 'going'),
  ('cafe0000-0000-4000-8000-000000000005', 'going'),
  ('cafe0000-0000-4000-8000-000000000006', 'going'),
  ('cafe0000-0000-4000-8000-000000000008', 'interested')
) AS x(id, status);
INSERT INTO saves (user_id, event_id) VALUES
  ('10000000-0000-4000-8000-000000000002', 'cafe0000-0000-4000-8000-000000000007');

-- Pending request through the app's join path, as alex.
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT join_event_with_capacity('cafe0000-0000-4000-8000-000000000004', 'going');
-- Cancellation through the sanctioned path, as the host.
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT cancel_event('cafe0000-0000-4000-8000-000000000005');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

COMMIT;
