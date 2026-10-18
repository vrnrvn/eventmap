-- Local-only synthetic fixtures. Never import production accounts or personal data.
-- Passwords here belong exclusively to disposable demo accounts.
DO $$
DECLARE
  account record;
BEGIN
  FOR account IN SELECT * FROM (VALUES
    ('10000000-0000-4000-8000-000000000001'::uuid, 'host@example.test', 'Demo Host'),
    ('10000000-0000-4000-8000-000000000002'::uuid, 'alex@example.test', 'Demo Alex'),
    ('10000000-0000-4000-8000-000000000003'::uuid, 'sam@example.test', 'Demo Sam')
  ) AS users(id, email, name)
  LOOP
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    VALUES (account.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      account.email, extensions.crypt('LocalDemo123!', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('name', account.name),
      now(), now(), '', '', '', '') ON CONFLICT (id) DO NOTHING;
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
    VALUES (account.id, account.id, account.id::text,
      jsonb_build_object('sub', account.id, 'email', account.email, 'email_verified', true),
      'email', now(), now()) ON CONFLICT (provider_id, provider) DO NOTHING;
    UPDATE public.profiles SET has_completed_onboarding = true, city = 'San Francisco',
      lat = 37.7749, lng = -122.4194, bio = 'Synthetic demo account',
      is_admin = (account.email = 'host@example.test') WHERE id = account.id;
  END LOOP;
END $$;

INSERT INTO public.businesses (id, owner_id, name, description, category, address, lat, lng, subscription_tier)
VALUES ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  'Demo Community Studio', 'A fictional venue for local development.', 'culture',
  'Demo venue, San Francisco', 37.7749, -122.4194, 'premium') ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events (id, business_id, title, description, category_id, start_datetime,
  end_datetime, lat, lng, address)
SELECT ('30000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '20000000-0000-4000-8000-000000000001', title,
  'Fictional event for testing discovery, attendance, and chat.',
  (SELECT id FROM public.categories WHERE slug = category),
  date_trunc('day', now()) + make_interval(days => n, hours => 18),
  date_trunc('day', now()) + make_interval(days => n, hours => 20),
  37.7749 + n * 0.002, -122.4194 + n * 0.002, 'Demo venue, San Francisco'
FROM (VALUES (1, 'Community Art Evening', 'culture'), (2, 'Weekend Run Club', 'fitness'),
  (3, 'Coffee and Conversation', 'food-drink')) AS demo(n, title, category)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.rsvps (event_id, user_id, status) VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'going'),
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'going'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'going')
ON CONFLICT (user_id, event_id) DO NOTHING;

INSERT INTO public.event_chat_messages (id, event_id, sender_id, body, created_at) VALUES
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000002', 'Looking forward to the art evening!', now() - interval '2 minutes'),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000003', 'See you there!', now() - interval '1 minute') ON CONFLICT (id) DO NOTHING;
