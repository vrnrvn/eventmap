-- Regression suite for 20261110140000_host_trust_foundations.sql and
-- 20261110150000_publish_requires_guidelines.sql.
-- Self-contained (own users, real `authenticated` role + JWT claims), rolled
-- back. Run ONLY against an isolated database, never the shared one.
\set ON_ERROR_STOP 1
BEGIN;
CREATE FUNCTION pg_temp.login(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL role authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
END $$;
CREATE FUNCTION pg_temp.logout() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); END $$;
CREATE FUNCTION pg_temp.expect_error(tag text, p_sql text, p_like text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE p_like THEN RAISE EXCEPTION '[%] wrong error: % (wanted %)', tag, SQLERRM, p_like; END IF;
    RETURN;
  END;
  RAISE EXCEPTION '[%] should have failed (%) but succeeded', tag, p_like;
END $$;
-- Insert an event while the JWT claims of the current user are set. SECURITY
-- DEFINER only to get past RLS (the app inserts through an RPC); the triggers
-- still see auth.uid() from the claims, which is what is under test.
CREATE FUNCTION pg_temp.publish(p_biz uuid, p_state text DEFAULT 'published') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO events (business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address, publish_state)
  VALUES (p_biz, 'T', 'd', (SELECT id FROM categories LIMIT 1), now() + interval '2 days', now() + interval '2 days 2 hours', 1, 2, 'x', p_state)
  RETURNING id INTO v;
  RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.publish(uuid, text) TO authenticated;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('40000000-0000-4000-8000-00000000000a', 'tr-admin@test.local', '{"name":"TR Admin"}'),
  ('40000000-0000-4000-8000-000000000001', 'tr-host@test.local',  '{"name":"TR Host"}'),
  ('40000000-0000-4000-8000-000000000002', 'tr-other@test.local', '{"name":"TR Other"}');
INSERT INTO profiles (id, name) SELECT id, raw_user_meta_data->>'name' FROM auth.users
WHERE email LIKE 'tr-%@test.local' ON CONFLICT (id) DO NOTHING;
UPDATE profiles SET is_admin = true WHERE id = '40000000-0000-4000-8000-00000000000a';
-- Fixtures as a privileged writer: one host with accepted guidelines.
INSERT INTO businesses (id, owner_id, name, category, address, lat, lng, description, host_terms_version, host_terms_accepted_at)
VALUES ('41000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'TR Bar', 'Other', '1 Main', 1, 2, '', 1, now()),
       ('41000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'TR Other', 'Other', '2 Main', 1, 2, 'Desc', NULL, NULL);

-- ── Standing ────────────────────────────────────────────────────────────────
SELECT pg_temp.login('40000000-0000-4000-8000-000000000001');
DO $$ BEGIN ASSERT (SELECT standing FROM businesses WHERE id = '41000000-0000-4000-8000-000000000001') = 'good', 'default good'; END $$;
SELECT pg_temp.expect_error('owner cannot change standing',
  $$UPDATE businesses SET standing = 'good', standing_reason = 'x' WHERE owner_id = auth.uid()$$, '%standing is set by EventMap%');
SELECT pg_temp.expect_error('owner cannot call admin RPC',
  $$SELECT admin_set_host_standing('41000000-0000-4000-8000-000000000001', 'good')$$, '%admin access required%');
SELECT pg_temp.publish('41000000-0000-4000-8000-000000000001');   -- good host publishes
SELECT pg_temp.logout();

SELECT pg_temp.login('40000000-0000-4000-8000-00000000000a');
SELECT pg_temp.expect_error('reason required',
  $$SELECT admin_set_host_standing('41000000-0000-4000-8000-000000000001', 'restricted', '  ')$$, '%reason_required%');
SELECT admin_set_host_standing('41000000-0000-4000-8000-000000000001', 'restricted', 'Repeated misleading listings');
SELECT pg_temp.logout();

SELECT pg_temp.login('40000000-0000-4000-8000-000000000001');
SELECT pg_temp.expect_error('restricted host cannot publish new',
  $$SELECT pg_temp.publish('41000000-0000-4000-8000-000000000001')$$, '%host_restricted%');
-- Drafts still allowed, so nothing is lost.
CREATE TEMP TABLE tr_draft AS SELECT pg_temp.publish('41000000-0000-4000-8000-000000000001', 'draft') AS id;
GRANT SELECT ON tr_draft TO authenticated;
SELECT pg_temp.expect_error('restricted host cannot publish a draft',
  $$SELECT publish_event((SELECT id FROM tr_draft))$$, '%host_restricted%');
SELECT pg_temp.expect_error('restricted host cannot request verification',
  $$SELECT submit_verification_request('https://tr.example')$$, '%host_restricted%');
DO $$ BEGIN
  ASSERT (SELECT standing_reason FROM businesses WHERE owner_id = auth.uid()) = 'Repeated misleading listings', 'host sees the reason';
END $$;
SELECT pg_temp.logout();

SELECT pg_temp.login('40000000-0000-4000-8000-00000000000a');
SELECT admin_set_host_standing('41000000-0000-4000-8000-000000000001', 'good');
DO $$ BEGIN
  ASSERT (SELECT standing_reason IS NULL AND standing_updated_at IS NOT NULL FROM businesses
          WHERE id = '41000000-0000-4000-8000-000000000001'), 'good clears the reason, stamps the time';
END $$;
SELECT pg_temp.logout();

-- ── Verification ────────────────────────────────────────────────────────────
SELECT pg_temp.login('40000000-0000-4000-8000-000000000001');
SELECT pg_temp.expect_error('needs a description',
  $$SELECT submit_verification_request('https://tr.example')$$, '%add a description%');
SELECT pg_temp.logout();
UPDATE businesses SET description = 'Jazz bar' WHERE id = '41000000-0000-4000-8000-000000000001';

SELECT pg_temp.login('40000000-0000-4000-8000-000000000001');
SELECT pg_temp.expect_error('bad url', $$SELECT submit_verification_request('not a url')$$, '%invalid_evidence_url%');
-- Refused by the revoked grant or, where defaults re-grant it, by RLS (no
-- INSERT policy). Either way it must not land.
DO $$ BEGIN
  BEGIN
    INSERT INTO host_verification_requests (business_id, evidence_url)
    VALUES ('41000000-0000-4000-8000-000000000001', 'https://x.example');
  EXCEPTION WHEN insufficient_privilege THEN RETURN;   -- 42501: grant or RLS
  END;
  RAISE EXCEPTION '[no direct insert] should have been refused';
END $$;
CREATE TEMP TABLE tr_req AS SELECT submit_verification_request('https://tr.example', 'Our site') AS id;
GRANT SELECT ON tr_req TO authenticated;
SELECT pg_temp.expect_error('one open request', $$SELECT submit_verification_request('https://tr2.example')$$, '%request_pending%');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM host_verification_requests) = 1, 'host sees own request only';
END $$;
SELECT pg_temp.logout();

-- Another host cannot see it.
SELECT pg_temp.login('40000000-0000-4000-8000-000000000002');
DO $$ BEGIN ASSERT (SELECT count(*) FROM host_verification_requests) = 0, 'others see nothing'; END $$;
SELECT pg_temp.expect_error('not an admin', $$SELECT admin_review_verification((SELECT id FROM tr_req), 'approved')$$, '%admin access required%');
SELECT pg_temp.logout();

SELECT pg_temp.login('40000000-0000-4000-8000-00000000000a');
SELECT pg_temp.expect_error('needs_info needs a note',
  $$SELECT admin_review_verification((SELECT id FROM tr_req), 'needs_info')$$, '%note_required%');
SELECT admin_review_verification((SELECT id FROM tr_req), 'needs_info', 'Link to your Instagram, please');
SELECT pg_temp.logout();

-- The host answers on the same request.
SELECT pg_temp.login('40000000-0000-4000-8000-000000000001');
DO $$ BEGIN
  ASSERT submit_verification_request('https://instagram.com/trbar') = (SELECT id FROM tr_req), 'resubmit reuses the request';
  ASSERT (SELECT status FROM host_verification_requests) = 'pending', 'back to pending';
END $$;
SELECT pg_temp.logout();

SELECT pg_temp.login('40000000-0000-4000-8000-00000000000a');
SELECT admin_review_verification((SELECT id FROM tr_req), 'approved');
SELECT pg_temp.expect_error('decided once', $$SELECT admin_review_verification((SELECT id FROM tr_req), 'rejected', 'no')$$, '%not_pending%');
DO $$ BEGIN
  ASSERT (SELECT verified FROM businesses WHERE id = '41000000-0000-4000-8000-000000000001'), 'approval verifies';
END $$;
SELECT pg_temp.logout();

SELECT pg_temp.login('40000000-0000-4000-8000-000000000001');
SELECT pg_temp.expect_error('already verified', $$SELECT submit_verification_request('https://tr.example')$$, '%already_verified%');
SELECT pg_temp.logout();

-- ── Guidelines guard (20261110150000) ──────────────────────────────────────
SELECT pg_temp.login('40000000-0000-4000-8000-000000000002');
SELECT pg_temp.expect_error('no guidelines, no publish',
  $$SELECT pg_temp.publish('41000000-0000-4000-8000-000000000002')$$, '%guidelines_required%');
SELECT pg_temp.publish('41000000-0000-4000-8000-000000000002', 'draft');   -- drafts fine
UPDATE businesses SET host_terms_version = 1 WHERE owner_id = auth.uid();
SELECT pg_temp.publish('41000000-0000-4000-8000-000000000002');           -- accepted → publishes
SELECT pg_temp.logout();

DO $$ BEGIN RAISE NOTICE 'test-host-trust: all assertions passed'; END $$;
ROLLBACK;
