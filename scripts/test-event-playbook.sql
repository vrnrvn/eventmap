-- Regression suite for the per-event host checklist
-- (migration 20261113100000_event_host_playbook.sql;
--  docs/HOST_EVENT_PLAYBOOK_PLAN.md P5).
--
-- Runs ONLY against an isolated copy of the database, inside one transaction
-- that is rolled back; every check is an ASSERT, so the script stops on the
-- first failure:
--
--   SCRATCH_DB=eventmap_scratch_<you> scripts/db-scratch.sh refresh
--   scripts/db-scratch.sh apply supabase/migrations/20261113100000_event_host_playbook.sql
--   scripts/db-scratch.sh apply scripts/test-event-playbook.sql
--
-- Without Docker, the same on a throwaway native cluster:
--
--   scripts/db-isolated.sh init
--   scripts/db-isolated.sh apply scripts/test-event-playbook.sql
--
-- Needs the local seed: one business with an owner, plus one other profile.
BEGIN;
SET LOCAL client_min_messages = notice;

CREATE TEMP TABLE ctx AS
SELECT (SELECT id FROM businesses LIMIT 1) AS biz,
       (SELECT owner_id FROM businesses LIMIT 1) AS host,
       (SELECT id FROM profiles WHERE id <> (SELECT owner_id FROM businesses LIMIT 1) ORDER BY id LIMIT 1) AS other,
       (SELECT id FROM categories LIMIT 1) AS cat,
       '93000000-0000-4000-8000-000000000001'::uuid AS e1,
       '93000000-0000-4000-8000-000000000002'::uuid AS e2;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.as_owner() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL ROLE postgres';
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- Two events for the seeded business.
INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address)
SELECT c.e1, c.biz, 'Playbook test event', 'x', c.cat, now() + interval '7 days', now() + interval '7 days 2 hours', 37.77, -122.41, '1 Main St'
FROM ctx c;
INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address)
SELECT c.e2, c.biz, 'Playbook test event 2', 'x', c.cat, now() + interval '8 days', now() + interval '8 days 2 hours', 37.77, -122.41, '1 Main St'
FROM ctx c;

DO $$
DECLARE
  c ctx%ROWTYPE;
  v jsonb;
  n integer;
  ok boolean;
BEGIN
  SELECT * INTO c FROM ctx;

  -- ── Ticking ───────────────────────────────────────────────────────────────
  PERFORM pg_temp.as_user(c.host);

  v := set_event_playbook_item(c.e1, 'venue_confirmed', true);
  ASSERT v->'ticked' = '["venue_confirmed"]'::jsonb, 'first tick stored: ' || v::text;

  -- Idempotent: ticking twice does not duplicate.
  v := set_event_playbook_item(c.e1, 'venue_confirmed', true);
  ASSERT jsonb_array_length(v->'ticked') = 1, 'tick is idempotent: ' || v::text;

  -- A second item appends rather than replacing.
  v := set_event_playbook_item(c.e1, 'lessons', true);
  ASSERT v->'ticked' = '["venue_confirmed", "lessons"]'::jsonb, 'second tick appends: ' || v::text;

  -- Un-ticking removes just that one.
  v := set_event_playbook_item(c.e1, 'venue_confirmed', false);
  ASSERT v->'ticked' = '["lessons"]'::jsonb, 'un-tick removes one: ' || v::text;

  -- Un-ticking something never ticked is a no-op, not an error.
  v := set_event_playbook_item(c.e1, 'capacity', false);
  ASSERT v->'ticked' = '["lessons"]'::jsonb, 'un-tick of absent item is a no-op: ' || v::text;

  -- ── Dismissing ────────────────────────────────────────────────────────────
  v := dismiss_event_playbook_stage(c.e1, 'leadup');
  ASSERT v->'dismissed_stages' = '["leadup"]'::jsonb, 'stage dismissed: ' || v::text;
  v := dismiss_event_playbook_stage(c.e1, 'leadup');
  ASSERT jsonb_array_length(v->'dismissed_stages') = 1, 'dismiss is idempotent: ' || v::text;
  v := dismiss_event_playbook_stage(c.e1, 'after');
  ASSERT v->'dismissed_stages' = '["leadup", "after"]'::jsonb, 'second stage appends: ' || v::text;
  -- Ticks survive a dismissal (same row, different column).
  ASSERT v->'ticked' = '["lessons"]'::jsonb, 'dismiss keeps ticks: ' || v::text;

  -- ── Validation ────────────────────────────────────────────────────────────
  BEGIN
    v := dismiss_event_playbook_stage(c.e1, 'whenever');
    ASSERT false, 'an unknown stage must be refused';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;

  BEGIN
    v := set_event_playbook_item(c.e1, 'Robert''); DROP TABLE events;--', true);
    ASSERT false, 'a malformed item id must be refused';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;

  BEGIN
    v := set_event_playbook_item(c.e1, NULL, true);
    ASSERT false, 'a null item id must be refused';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;

  -- ── Ownership ─────────────────────────────────────────────────────────────
  PERFORM pg_temp.as_user(c.other);

  BEGIN
    v := set_event_playbook_item(c.e1, 'lessons', true);
    ASSERT false, 'a non-host must not write the host checklist';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    v := dismiss_event_playbook_stage(c.e1, 'after');
    ASSERT false, 'a non-host must not dismiss the host checklist';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- RLS: the row is invisible to anyone but the host.
  SELECT count(*) INTO n FROM event_host_playbook WHERE event_id = c.e1;
  ASSERT n = 0, 'a non-host must not read the host checklist, saw ' || n;

  PERFORM pg_temp.as_user(c.host);
  SELECT count(*) INTO n FROM event_host_playbook WHERE event_id = c.e1;
  ASSERT n = 1, 'the host reads their own row, saw ' || n;

  -- ── The table is RPC-only ────────────────────────────────────────────────
  -- No insert/update policy and no write grant, so even the host cannot put
  -- arbitrary text in the arrays by writing the table directly.
  ok := false;
  BEGIN
    INSERT INTO event_host_playbook (event_id, ticked) VALUES (c.e2, ARRAY['anything at all']);
  EXCEPTION WHEN insufficient_privilege OR sqlstate '42501' THEN ok := true;
  END;
  ASSERT ok, 'direct inserts must be refused';

  ok := false;
  BEGIN
    UPDATE event_host_playbook SET ticked = ARRAY['anything at all'] WHERE event_id = c.e1;
    -- An UPDATE with no permitted rows is silently 0 rows under RLS; the
    -- grant is what must stop it, so check nothing changed either way.
    SELECT (ticked = ARRAY['lessons']) INTO ok FROM event_host_playbook WHERE event_id = c.e1;
  EXCEPTION WHEN insufficient_privilege OR sqlstate '42501' THEN ok := true;
  END;
  ASSERT ok, 'direct updates must not change stored ticks';

  -- ── Cascade ───────────────────────────────────────────────────────────────
  PERFORM pg_temp.as_owner();
  DELETE FROM events WHERE id = c.e1;
  SELECT count(*) INTO n FROM event_host_playbook WHERE event_id = c.e1;
  ASSERT n = 0, 'checklist state follows its event on delete, saw ' || n;

  RAISE NOTICE 'test-event-playbook: all checks passed';
END $$;

ROLLBACK;
