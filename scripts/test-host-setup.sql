-- Regression suite for host onboarding Stages 1–2:
--   20261110100000_profile_intent.sql
--   20261110110000_host_setup_foundations.sql
--
-- Self-contained: creates its own users through auth.users (the signup
-- trigger makes their profiles), acts as the real `authenticated` role with
-- JWT claims so RLS, grants and every businesses trigger are exercised, and
-- rolls everything back. Needs no demo data.
--
-- Run ONLY against an isolated database (never the shared one), e.g. a
-- throwaway local cluster with the full migration history applied:
--   psql -v ON_ERROR_STOP=1 -d <isolated db> -f scripts/test-host-setup.sql
\set ON_ERROR_STOP 1
BEGIN;

CREATE FUNCTION pg_temp.login(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL role authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
END $$;

CREATE FUNCTION pg_temp.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

CREATE FUNCTION pg_temp.expect_error(tag text, p_sql text, p_like text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE p_like THEN
      RAISE EXCEPTION '[%] wrong error: % (wanted %)', tag, SQLERRM, p_like;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION '[%] should have failed (%) but succeeded', tag, p_like;
END $$;

-- ── Fixtures ──────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('20000000-0000-4000-8000-00000000000a', 'hs-admin@test.local', '{"name":"HS Admin"}'),
  ('20000000-0000-4000-8000-000000000001', 'hs-venue@test.local', '{"name":"HS Venue"}'),
  ('20000000-0000-4000-8000-000000000002', 'hs-org@test.local',   '{"name":"HS Org"}'),
  ('20000000-0000-4000-8000-000000000003', 'hs-indiv@test.local', '{"name":"HS Indiv"}'),
  ('20000000-0000-4000-8000-000000000004', 'hs-legacy@test.local','{"name":"HS Legacy"}');
-- Signup trigger may or may not exist on the target; make sure profiles do.
INSERT INTO profiles (id, name)
SELECT id, raw_user_meta_data->>'name' FROM auth.users WHERE email LIKE 'hs-%@test.local'
ON CONFLICT (id) DO NOTHING;
UPDATE profiles SET is_admin = true WHERE id = '20000000-0000-4000-8000-00000000000a';

-- ── Stage 1: profiles.intent ─────────────────────────────────────────────────
SELECT pg_temp.login('20000000-0000-4000-8000-000000000002');
SELECT pg_temp.expect_error('intent check',
  $$UPDATE profiles SET intent = 'lurk' WHERE id = auth.uid()$$, '%profiles_intent_check%');
UPDATE profiles SET intent = 'both' WHERE id = auth.uid();
DO $$ BEGIN
  ASSERT (SELECT intent FROM profiles WHERE id = auth.uid()) = 'both', 'owner can set own intent';
END $$;

-- ── Organiser with no location (RLS insert path) ─────────────────────────────
INSERT INTO businesses (owner_id, name, category, host_type, location_kind,
                        host_terms_version, onboarding_completed_at, verified, host_terms_accepted_at)
VALUES (auth.uid(), 'HS Run Club', 'Fitness & Wellness', 'organiser', 'none',
        1, '2000-01-01', true, '2000-01-01');
DO $$ DECLARE b businesses; BEGIN
  SELECT * INTO b FROM businesses WHERE owner_id = auth.uid();
  ASSERT NOT b.verified, 'insert forces verified=false';
  ASSERT b.subscription_tier = 'free', 'subscription trigger still forces free';
  ASSERT b.host_terms_accepted_at > now() - interval '1 minute', 'accepted_at is server time';
  ASSERT b.onboarding_completed_at > now() - interval '1 minute', 'completed_at is server time';
  ASSERT b.address IS NULL AND b.lat IS NULL, 'no location stored';
END $$;

SELECT pg_temp.expect_error('self-verify',
  $$UPDATE businesses SET verified = true WHERE owner_id = auth.uid()$$, '%verification is set by EventMap%');
SELECT pg_temp.expect_error('withdraw terms',
  $$UPDATE businesses SET host_terms_version = NULL WHERE owner_id = auth.uid()$$, '%cannot be withdrawn%');
SELECT pg_temp.expect_error('wrong terms version',
  $$UPDATE businesses SET host_terms_version = 7 WHERE owner_id = auth.uid()$$, '%invalid_terms_version%');
SELECT pg_temp.expect_error('self-premium still blocked',
  $$UPDATE businesses SET subscription_tier = 'premium' WHERE owner_id = auth.uid()$$, '%premium RPCs%');
UPDATE businesses SET onboarding_completed_at = NULL, host_terms_accepted_at = '1999-01-01'
WHERE owner_id = auth.uid();
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM businesses WHERE owner_id = auth.uid()
                     AND (onboarding_completed_at IS NULL OR host_terms_accepted_at < now() - interval '1 minute')),
    'completion/acceptance cannot be cleared or backdated';
END $$;

-- Location shapes
SELECT pg_temp.expect_error('none with pin',
  $$UPDATE businesses SET lat = 1, lng = 2 WHERE owner_id = auth.uid()$$, '%businesses_location_shape_check%');
UPDATE businesses SET location_kind = 'area', lat = 1, lng = 2, address = 'Mission District' WHERE owner_id = auth.uid();
SELECT pg_temp.expect_error('area without pin',
  $$UPDATE businesses SET lat = NULL WHERE owner_id = auth.uid()$$, '%businesses_location_shape_check%');
SELECT pg_temp.expect_error('venue must be fixed',
  $$UPDATE businesses SET host_type = 'venue' WHERE owner_id = auth.uid()$$, '%businesses_venue_fixed_check%');
-- Settings "switch to venue" path: type + fixed + street address together.
UPDATE businesses SET host_type = 'venue', location_kind = 'fixed', address = '5 Market St', lat = 1, lng = 2
WHERE owner_id = auth.uid();

-- get_user_business: own row only, new columns present
DO $$ DECLARE n int; t text; BEGIN
  SELECT count(*), max(host_type) INTO n, t FROM get_user_business();
  ASSERT n = 1 AND t = 'venue', format('get_user_business returned %s / %s', n, t);
END $$;

-- One business per owner still enforced by RLS
SELECT pg_temp.expect_error('second business',
  $$INSERT INTO businesses (owner_id, name, category, host_type, location_kind)
    VALUES (auth.uid(), 'Again', 'Other', 'organiser', 'none')$$, '%row-level security%');

-- Owner cannot touch someone else's business
SELECT pg_temp.logout();

-- ── Individual: home area, accepts terms later ──────────────────────────────
SELECT pg_temp.login('20000000-0000-4000-8000-000000000003');
INSERT INTO businesses (owner_id, name, category, host_type, location_kind, lat, lng)
VALUES (auth.uid(), 'HS Sam', 'Community', 'individual', 'area', 3, 4);
UPDATE businesses SET host_terms_version = 1 WHERE owner_id = auth.uid();
DO $$ BEGIN
  ASSERT (SELECT host_terms_accepted_at FROM businesses WHERE owner_id = auth.uid()) IS NOT NULL,
    'accepting later stamps accepted_at';
  ASSERT (SELECT count(*) FROM get_user_business()) = 1, 'sees only own business';
END $$;
DO $$ DECLARE n int; BEGIN
  UPDATE businesses SET name = 'hijack' WHERE name = 'HS Run Club';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'cannot update another owner''s business';
END $$;
SELECT pg_temp.logout();

-- ── Venue rules and the legacy client payload ───────────────────────────────
SELECT pg_temp.login('20000000-0000-4000-8000-000000000004');
SELECT pg_temp.expect_error('venue without address',
  $$INSERT INTO businesses (owner_id, name, category, host_type, location_kind, lat, lng)
    VALUES (auth.uid(), 'X', 'Other', 'venue', 'fixed', 1, 1)$$, '%businesses_location_shape_check%');
-- What the pre-Stage-2 client sends: no host columns → venue/fixed defaults.
INSERT INTO businesses (owner_id, name, category, address, lat, lng, verified, subscription_tier)
VALUES (auth.uid(), 'HS Legacy', 'Other', '2 Main St', 1, 1, false, 'free');
DO $$ BEGIN
  ASSERT (SELECT host_type || '/' || location_kind FROM businesses WHERE owner_id = auth.uid()) = 'venue/fixed',
    'legacy insert defaults to venue/fixed';
END $$;
SELECT pg_temp.logout();

-- ── Admin may verify (directly and via the RPC) ─────────────────────────────
SELECT pg_temp.login('20000000-0000-4000-8000-00000000000a');
UPDATE businesses SET verified = true WHERE name = 'HS Sam';
SELECT admin_set_business_verified((SELECT id FROM businesses WHERE name = 'HS Legacy'), true);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM businesses WHERE name IN ('HS Sam', 'HS Legacy') AND verified) = 2, 'admin verifies';
END $$;
SELECT pg_temp.logout();

DO $$ BEGIN RAISE NOTICE 'test-host-setup: all assertions passed'; END $$;
ROLLBACK;
