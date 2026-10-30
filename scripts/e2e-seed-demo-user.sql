-- Puts the demo attendee (alex) back into a brand-new-user state inside a scratch copy,
-- plus a past, a live, and an ended-unjoined event so every tab has content.
-- Scratch DB only; never run against the shared database.
-- Simulate alex as a brand-new user in the scratch copy, with some history to look at.
UPDATE profiles SET has_completed_onboarding = false, bio = NULL, hobbies = NULL, social_handles = '{}'::jsonb,
  city = NULL, lat = NULL, lng = NULL, avatar_url = NULL, preferred_categories = '{}',
  is_profile_private = false, show_attendance_publicly = true, show_future_events = true
WHERE id = '10000000-0000-4000-8000-000000000002';
INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address)
VALUES
 ('3e000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Past Poetry Night','Already happened', (SELECT id FROM categories WHERE slug='culture'), now() - interval '9 days', now() - interval '9 days' + interval '2 hours', 37.77, -122.41, 'Demo venue, San Francisco'),
 ('3e000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Live Jazz Right Now','In progress', (SELECT id FROM categories WHERE slug='culture'), now() - interval '40 minutes', now() + interval '80 minutes', 37.78, -122.42, 'Demo venue, San Francisco'),
 ('3e000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','Ended Workshop','Ended, never joined', (SELECT id FROM categories WHERE slug='culture'), now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 37.76, -122.40, 'Demo venue, San Francisco')
ON CONFLICT (id) DO NOTHING;
INSERT INTO rsvps (user_id, event_id, status) VALUES
 ('10000000-0000-4000-8000-000000000002','3e000000-0000-4000-8000-000000000001','going'),
 ('10000000-0000-4000-8000-000000000002','3e000000-0000-4000-8000-000000000002','going'),
 ('10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003','interested')
ON CONFLICT (user_id, event_id) DO UPDATE SET status = EXCLUDED.status;
DELETE FROM saves WHERE user_id = '10000000-0000-4000-8000-000000000002';
INSERT INTO saves (user_id, event_id) VALUES ('10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002') ON CONFLICT DO NOTHING;
SELECT name, has_completed_onboarding FROM profiles WHERE id='10000000-0000-4000-8000-000000000002';

-- 45 synthetic attendees on "Coffee and Conversation" so the attendees sheet has
-- more than one page (alex is "interested" there and joins during the run).
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change)
SELECT ('7a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'bulk' || n || '@example.test', 'x', now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('name', 'Bulk User ' || n),
  now(), now(), '', '', '', ''
FROM generate_series(1, 45) n
ON CONFLICT (id) DO NOTHING;
INSERT INTO profiles (id, name, bio)
SELECT ('7a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Bulk User ' || n, 'Synthetic attendee' FROM generate_series(1, 45) n
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
UPDATE profiles SET show_attendance_publicly = false WHERE id IN (
  SELECT ('7a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid FROM generate_series(40, 45) n);
INSERT INTO rsvps (user_id, event_id, status, created_at)
SELECT ('7a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '30000000-0000-4000-8000-000000000003', 'going', now() - (n || ' minutes')::interval
FROM generate_series(1, 45) n
ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'going';
