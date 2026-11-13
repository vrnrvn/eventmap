-- Regression suite for private event collections
-- (migration 20261112100000_event_collections.sql; docs/EVENT_COLLECTIONS_PLAN.md).
--
-- Runs ONLY against an isolated copy of the database, inside one transaction
-- that is rolled back; every check is an ASSERT, so the script stops on the
-- first failure:
--
--   SCRATCH_DB=eventmap_scratch_<you> scripts/db-scratch.sh refresh
--   scripts/db-scratch.sh apply supabase/migrations/20261112100000_event_collections.sql
--   scripts/db-scratch.sh apply scripts/test-collections.sql
--
-- Without Docker, the same on a throwaway native cluster:
--
--   scripts/db-isolated.sh init
--   scripts/db-isolated.sh apply scripts/test-collections.sql
--
-- Needs the local seed: one premium business with an owner and two other
-- profiles. RLS is exercised by switching to the `authenticated` role, so the
-- API roles must be able to reach the public schema as they can on Supabase.
BEGIN;
SET LOCAL client_min_messages = notice;

CREATE TEMP TABLE ctx AS
SELECT (SELECT id FROM businesses LIMIT 1) AS biz,
       (SELECT owner_id FROM businesses LIMIT 1) AS host,
       (SELECT id FROM profiles WHERE id <> (SELECT owner_id FROM businesses LIMIT 1) ORDER BY id LIMIT 1) AS a,
       (SELECT id FROM profiles WHERE id <> (SELECT owner_id FROM businesses LIMIT 1) ORDER BY id OFFSET 1 LIMIT 1) AS b,
       (SELECT id FROM categories WHERE slug = 'live-music') AS cat_music,
       (SELECT id FROM categories WHERE slug = 'sports') AS cat_sports,
       '92000000-0000-4000-8000-000000000001'::uuid AS e_music1,
       '92000000-0000-4000-8000-000000000002'::uuid AS e_music2,
       '92000000-0000-4000-8000-000000000003'::uuid AS e_series,
       '92000000-0000-4000-8000-000000000004'::uuid AS e_sports,
       '92000000-0000-4000-8000-000000000005'::uuid AS e_past,
       '92000000-0000-4000-8000-000000000006'::uuid AS e_cancel;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL ROLE anon';
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_super() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.raises(p_sql text, p_like text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE p_like THEN RETURN true; END IF;
  RAISE NOTICE 'wrong error for %: %', p_sql, SQLERRM;
  RETURN false;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.ids(p json) RETURNS text[] LANGUAGE sql AS $$
  SELECT COALESCE(array_agg(x->>'id' ORDER BY ord), '{}') FROM json_array_elements(p) WITH ORDINALITY AS t(x, ord);
$$;
CREATE OR REPLACE FUNCTION pg_temp.row_of(p json, p_id uuid) RETURNS json LANGUAGE sql AS $$
  SELECT x FROM json_array_elements(p) x WHERE x->>'id' = p_id::text LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION pg_temp.collection_row(p json, p_id uuid) RETURNS json LANGUAGE sql AS $$
  SELECT x FROM json_array_elements(p) x WHERE x->>'id' = p_id::text LIMIT 1;
$$;

DO $$ BEGIN RAISE NOTICE 'collections regression suite starting'; END $$;

-- ---------------------------------------------------------------- fixtures
INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address,
                    status, publish_state, visibility, is_recurring, recurrence_pattern, timezone, cover_image_url)
SELECT e_music1, biz, 'Acoustic Night', 'fixture', cat_music, now() + interval '1 day', now() + interval '1 day 2 hours',
       37.77, -122.41, 'x', 'active', 'published', 'public', false, NULL::jsonb, 'UTC', 'https://img.test/acoustic.jpg'::text FROM ctx
UNION ALL
SELECT e_music2, biz, 'Band Night', 'fixture', cat_music, now() + interval '1 day 1 hour', now() + interval '1 day 3 hours',
       37.77, -122.41, 'x', 'active', 'published', 'public', false, NULL::jsonb, 'UTC', NULL::text FROM ctx
UNION ALL
SELECT e_series, biz, 'Choir Weekly', 'fixture', cat_music, now() + interval '2 days', now() + interval '2 days 2 hours',
       37.77, -122.41, 'x', 'active', 'published', 'public', true, '{"frequency":"weekly","interval":1}'::jsonb, 'UTC', 'https://img.test/choir.jpg' FROM ctx
UNION ALL
SELECT e_sports, biz, 'Derby Match', 'fixture', cat_sports, now() + interval '3 days', now() + interval '3 days 2 hours',
       37.77, -122.41, 'x', 'active', 'published', 'public', false, NULL, 'UTC', 'https://img.test/derby.jpg' FROM ctx
UNION ALL
SELECT e_past, biz, 'Early Gig', 'fixture', cat_music, now() - interval '5 days', now() - interval '5 days' + interval '2 hours',
       37.77, -122.41, 'x', 'active', 'published', 'public', false, NULL, 'UTC', 'https://img.test/early.jpg' FROM ctx
UNION ALL
SELECT e_cancel, biz, 'Fizzled Show', 'fixture', cat_music, now() + interval '4 days', now() + interval '4 days 2 hours',
       37.77, -122.41, 'x', 'cancelled', 'published', 'public', false, NULL::jsonb, 'UTC', NULL::text FROM ctx;

-- Alex: saves and RSVPs with controlled timestamps (the "added" sort reads them).
INSERT INTO saves (user_id, event_id, created_at)
SELECT a, e_music1, now() - interval '2 days' FROM ctx UNION ALL
SELECT a, e_music2, now() - interval '3 days' FROM ctx UNION ALL
SELECT a, e_past,   now() - interval '4 days' FROM ctx UNION ALL
SELECT a, e_cancel, now() - interval '5 days' FROM ctx;
INSERT INTO rsvps (user_id, event_id, status, created_at)
SELECT a, e_series, 'going', now() - interval '1 day' FROM ctx UNION ALL
SELECT a, e_sports, 'interested', now() - interval '6 days' FROM ctx UNION ALL
SELECT b, e_music1, 'going', now() - interval '1 day' FROM ctx;

-- ---------------------------------------------------------------- grants
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.get_user_collections()', 'EXECUTE'), '[0.1] anon cannot list collections';
  ASSERT NOT has_function_privilege('anon', 'public.get_collection_events(uuid, integer, integer, text, text, uuid[])', 'EXECUTE'), '[0.2] anon cannot read a collection';
  ASSERT NOT has_function_privilege('anon', 'public.get_event_collection_membership(uuid)', 'EXECUTE'), '[0.3] anon cannot read membership';
  ASSERT NOT has_function_privilege('anon', 'public.reorder_collections(uuid[])', 'EXECUTE'), '[0.4] anon cannot reorder';
  ASSERT has_function_privilege('authenticated', 'public.get_user_collections()', 'EXECUTE'), '[0.5] authenticated can list';
  ASSERT has_function_privilege('authenticated', 'public.get_collection_events(uuid, integer, integer, text, text, uuid[])', 'EXECUTE'), '[0.6] authenticated can read';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.collections'::regclass), '[0.7] RLS on collections';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.collection_items'::regclass), '[0.8] RLS on collection_items';
  RAISE NOTICE 'PASS: grants and RLS enabled';
END $$;

-- ---------------------------------------------------------------- creating collections
CREATE TEMP TABLE made (manual uuid, smart uuid);
-- The suite writes these while impersonating the API roles.
GRANT ALL ON ctx, made TO anon, authenticated;
DO $$
DECLARE f ctx%ROWTYPE; v_manual uuid; v_smart uuid; r collections%ROWTYPE;
BEGIN
  SELECT * INTO f FROM ctx;
  PERFORM pg_temp.as_user(f.a);

  INSERT INTO collections (user_id, name) VALUES (f.a, '  Weekend plans  ') RETURNING id INTO v_manual;
  SELECT * INTO r FROM collections WHERE id = v_manual;
  ASSERT r.name = 'Weekend plans', '[1.1] name is trimmed';
  ASSERT r.kind = 'manual' AND r.category_ids = '{}', '[1.2] manual by default, no categories';

  ASSERT pg_temp.raises(format($q$INSERT INTO collections (user_id, name) VALUES (%L, '   ')$q$, f.a), '%collection_name_required%'),
    '[1.3] blank name refused';
  ASSERT pg_temp.raises(format($q$INSERT INTO collections (user_id, name) VALUES (%L, repeat('x', 41))$q$, f.a), '%collection_name_too_long%'),
    '[1.4] 41-char name refused';
  ASSERT pg_temp.raises(format($q$INSERT INTO collections (user_id, name) VALUES (%L, 'WEEKEND PLANS')$q$, f.a), '%collections_manual_name_key%'),
    '[1.5] duplicate manual name (case-insensitive) refused';
  ASSERT pg_temp.raises(format($q$INSERT INTO collections (user_id, name, kind) VALUES (%L, 'Music', 'smart')$q$, f.a), '%collection_categories_required%'),
    '[1.6] smart without categories refused';
  ASSERT pg_temp.raises(format($q$INSERT INTO collections (user_id, name, kind, category_ids) VALUES (%L, 'Music', 'smart', ARRAY[gen_random_uuid()])$q$, f.a), '%collection_unknown_category%'),
    '[1.7] smart with an unknown category refused';
  ASSERT pg_temp.raises(format($q$INSERT INTO collections (user_id, name, kind) VALUES (%L, 'Nope', 'playlist')$q$, f.a), '%collections_kind_check%'),
    '[1.8] unknown kind refused';
  ASSERT pg_temp.raises(format($q$INSERT INTO collections (user_id, name) VALUES (%L, 'Not mine')$q$, f.b), '%row-level security%'),
    '[1.9] cannot create a collection for someone else';

  -- Favouriting a type: blank name + one category fills name / colour / icon from the category.
  INSERT INTO collections (user_id, name, kind, category_ids) VALUES (f.a, '', 'smart', ARRAY[f.cat_music]) RETURNING id INTO v_smart;
  SELECT * INTO r FROM collections WHERE id = v_smart;
  ASSERT r.name = (SELECT label FROM categories WHERE id = f.cat_music), format('[1.10] smart name defaults to the category label (%s)', r.name);
  ASSERT r.color = (SELECT color FROM categories WHERE id = f.cat_music), '[1.11] smart colour defaults to the category colour';
  ASSERT r.icon_key = (SELECT icon_key FROM categories WHERE id = f.cat_music), '[1.12] smart icon defaults to the category icon';
  ASSERT pg_temp.raises(format($q$INSERT INTO collections (user_id, name, kind, category_ids) VALUES (%L, 'Again', 'smart', ARRAY[%L::uuid])$q$, f.a, f.cat_music), '%collections_smart_rule_key%'),
    '[1.13] one smart collection per category';
  -- A manual collection may share a smart one's name.
  INSERT INTO collections (user_id, name) VALUES (f.a, r.name);
  DELETE FROM collections WHERE user_id = f.a AND kind = 'manual' AND name = r.name;

  ASSERT pg_temp.raises(format($q$UPDATE collections SET kind = 'manual' WHERE id = %L$q$, v_smart), '%collection_kind_immutable%'),
    '[1.14] kind cannot change';
  ASSERT pg_temp.raises(format($q$UPDATE collections SET user_id = %L WHERE id = %L$q$, f.b, v_manual), '%collection_owner_immutable%'),
    '[1.15] owner cannot be handed over';
  UPDATE collections SET name = 'Weekend plans!' WHERE id = v_manual;
  ASSERT (SELECT name FROM collections WHERE id = v_manual) = 'Weekend plans!', '[1.16] rename works';

  INSERT INTO made VALUES (v_manual, v_smart);

  -- Another user sees nothing.
  PERFORM pg_temp.as_user(f.b);
  ASSERT (SELECT count(*) FROM collections) = 0, '[1.17] other users cannot see the collections';
  ASSERT json_array_length(get_user_collections()) = 0, '[1.18] get_user_collections is scoped to the caller';
  ASSERT pg_temp.raises(format($q$INSERT INTO collection_items (collection_id, event_id) VALUES (%L, %L)$q$, v_manual, f.e_sports), '%row-level security%'),
    '[1.19] cannot pin into someone else''s collection';
  ASSERT json_array_length(get_collection_events(v_manual)) = 0, '[1.20] someone else''s collection reads as empty';
  PERFORM pg_temp.as_anon();
  ASSERT pg_temp.raises('SELECT get_user_collections()', '%permission denied%'), '[1.21] anonymous callers are refused outright';
  PERFORM pg_temp.as_super();
  RAISE NOTICE 'PASS: creating collections';
END $$;

-- ---------------------------------------------------------------- pinning
DO $$
DECLARE f ctx%ROWTYPE; m made%ROWTYPE;
BEGIN
  SELECT * INTO f FROM ctx; SELECT * INTO m FROM made;
  PERFORM pg_temp.as_user(f.a);
  INSERT INTO collection_items (collection_id, event_id, note) VALUES (m.manual, f.e_sports, '  bring a scarf  ');
  INSERT INTO collection_items (collection_id, event_id) VALUES (m.manual, f.e_music1);
  INSERT INTO collection_items (collection_id, event_id) VALUES (m.smart, f.e_sports);
  ASSERT (SELECT note FROM collection_items WHERE collection_id = m.manual AND event_id = f.e_sports) = 'bring a scarf', '[2.1] note trimmed';
  ASSERT pg_temp.raises(format($q$INSERT INTO collection_items (collection_id, event_id) VALUES (%L, %L)$q$, m.manual, f.e_sports), '%duplicate key%'),
    '[2.2] pinning twice is a unique violation (client treats 23505 as success)';
  ASSERT pg_temp.raises(format($q$UPDATE collection_items SET note = repeat('n', 141) WHERE collection_id = %L AND event_id = %L$q$, m.manual, f.e_sports), '%collection_items_note_check%'),
    '[2.3] 141-char note refused';
  ASSERT pg_temp.raises(format($q$UPDATE collection_items SET event_id = %L WHERE collection_id = %L AND event_id = %L$q$, f.e_music2, m.manual, f.e_sports), '%collection_item_key_immutable%'),
    '[2.4] item key cannot be repointed';
  UPDATE collection_items SET note = '' WHERE collection_id = m.manual AND event_id = f.e_sports;
  ASSERT (SELECT note FROM collection_items WHERE collection_id = m.manual AND event_id = f.e_sports) IS NULL, '[2.5] blank note stored as NULL';
  UPDATE collection_items SET note = 'bring a scarf' WHERE collection_id = m.manual AND event_id = f.e_sports;
  -- A draft the user somehow knows the id of cannot be pinned (and so never read through the RPC).
  PERFORM pg_temp.as_super();
  INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address, status, publish_state, visibility)
  VALUES ('92000000-0000-4000-8000-00000000000d', f.biz, 'Secret Draft', 'fixture', f.cat_music, now() + interval '9 days', now() + interval '9 days 2 hours', 37.77, -122.41, 'x', 'active', 'draft', 'public');
  PERFORM pg_temp.as_user(f.a);
  ASSERT pg_temp.raises(format($q$INSERT INTO collection_items (collection_id, event_id) VALUES (%L, '92000000-0000-4000-8000-00000000000d')$q$, m.manual), '%row-level security%'),
    '[2.6] a draft event cannot be pinned';
  PERFORM pg_temp.as_super();
  DELETE FROM events WHERE id = '92000000-0000-4000-8000-00000000000d';
  RAISE NOTICE 'PASS: pinning';
END $$;

-- ---------------------------------------------------------------- bans
DO $$
DECLARE f ctx%ROWTYPE;
BEGIN
  SELECT * INTO f FROM ctx;
  INSERT INTO banned_users (user_id, banned_by, reason) VALUES (f.b, f.host, 'fixture') ON CONFLICT DO NOTHING;
  PERFORM pg_temp.as_user(f.b);
  ASSERT pg_temp.raises(format($q$INSERT INTO collections (user_id, name) VALUES (%L, 'Banned list')$q$, f.b), '%row-level security%'),
    '[3.1] banned users cannot create collections';
  PERFORM pg_temp.as_super();
  DELETE FROM banned_users WHERE user_id = f.b AND reason = 'fixture';
  RAISE NOTICE 'PASS: bans';
END $$;

-- ---------------------------------------------------------------- membership helper
DO $$
DECLARE f ctx%ROWTYPE; m made%ROWTYPE; v_sources text[];
BEGIN
  SELECT * INTO f FROM ctx; SELECT * INTO m FROM made;
  PERFORM pg_temp.as_user(f.a);
  ASSERT (SELECT count(*) FROM collection_members(m.manual)) = 2, '[4.1] manual = its pinned items';
  ASSERT (SELECT count(*) FROM collection_members(m.smart)) = 6, format('[4.2] smart = saves + RSVPs in the category + pinned extras (%s)', (SELECT count(*) FROM collection_members(m.smart)));
  -- Alex is "interested" in the sports event: a pinned extra carries its relationship tags too.
  ASSERT (SELECT sources FROM collection_members(m.smart) WHERE event_id = f.e_sports) = ARRAY['pinned', 'interested'], '[4.3] pinned extra outside the rule: pinned + its own RSVP tag';
  ASSERT (SELECT sources FROM collection_members(m.manual) WHERE event_id = f.e_music1) = ARRAY['pinned', 'saved'], '[4.3b] manual pins carry the save tag';
  SELECT sources INTO v_sources FROM collection_members(m.smart) WHERE event_id = f.e_series;
  ASSERT v_sources = ARRAY['going'], format('[4.4] series via RSVP (%s)', v_sources);
  SELECT sources INTO v_sources FROM collection_members(m.smart) WHERE event_id = f.e_music1;
  ASSERT v_sources = ARRAY['saved'], format('[4.5] one-off via save (%s)', v_sources);
  -- Save + RSVP + pin on one event: fixed source order.
  INSERT INTO collection_items (collection_id, event_id) VALUES (m.smart, f.e_series);
  PERFORM pg_temp.as_super();
  INSERT INTO saves (user_id, event_id) VALUES (f.a, f.e_series);
  PERFORM pg_temp.as_user(f.a);
  SELECT sources INTO v_sources FROM collection_members(m.smart) WHERE event_id = f.e_series;
  ASSERT v_sources = ARRAY['pinned', 'going', 'saved'], format('[4.6] sources ordered pinned, going, saved (%s)', v_sources);
  DELETE FROM collection_items WHERE collection_id = m.smart AND event_id = f.e_series;
  PERFORM pg_temp.as_super();
  DELETE FROM saves WHERE user_id = f.a AND event_id = f.e_series;
  PERFORM pg_temp.as_user(f.b);
  ASSERT (SELECT count(*) FROM collection_members(m.smart)) = 0, '[4.7] helper is empty for non-owners';
  PERFORM pg_temp.as_super();
  RAISE NOTICE 'PASS: membership helper';
END $$;

-- ---------------------------------------------------------------- get_user_collections
DO $$
DECLARE f ctx%ROWTYPE; m made%ROWTYPE; res json; r json;
BEGIN
  SELECT * INTO f FROM ctx; SELECT * INTO m FROM made;
  PERFORM pg_temp.as_user(f.a);
  res := get_user_collections();
  ASSERT json_array_length(res) = 2, '[5.1] both collections listed';
  r := pg_temp.collection_row(res, m.smart);
  ASSERT (r->>'item_count')::int = 6, format('[5.2] smart item_count (%s)', r->>'item_count');
  ASSERT (r->>'upcoming_count')::int = 4, format('[5.3] smart upcoming_count excludes ended and cancelled (%s)', r->>'upcoming_count');
  ASSERT (r->>'recurring_count')::int = 1, '[5.4] smart recurring_count';
  ASSERT (r->>'next_start_datetime')::timestamptz BETWEEN now() + interval '23 hours' AND now() + interval '25 hours', '[5.5] next date is the soonest upcoming member';
  ASSERT json_array_length(r->'cover_urls') = 3, format('[5.6] at most three covers (%s)', r->'cover_urls');
  ASSERT r->'cover_urls'->>0 = 'https://img.test/acoustic.jpg', '[5.7] covers soonest-first';
  ASSERT r->>'kind' = 'smart' AND (r->'category_ids'->>0)::uuid = f.cat_music, '[5.8] rule exposed';
  r := pg_temp.collection_row(res, m.manual);
  ASSERT (r->>'item_count')::int = 2 AND (r->>'recurring_count')::int = 0, '[5.9] manual counts';
  PERFORM pg_temp.as_super();
  RAISE NOTICE 'PASS: get_user_collections';
END $$;

-- ---------------------------------------------------------------- get_collection_events
DO $$
DECLARE f ctx%ROWTYPE; m made%ROWTYPE; res json; r json;
BEGIN
  SELECT * INTO f FROM ctx; SELECT * INTO m FROM made;
  PERFORM pg_temp.as_user(f.a);

  res := get_collection_events(m.smart);
  ASSERT pg_temp.ids(res) = ARRAY[f.e_music1, f.e_music2, f.e_series, f.e_sports, f.e_cancel, f.e_past]::text[],
    format('[6.1] default: upcoming soonest-first then ended most-recent-first (%s)', pg_temp.ids(res));
  r := pg_temp.row_of(res, f.e_series);
  ASSERT (r->>'is_recurring')::boolean AND r->>'next_start_datetime' IS NOT NULL AND r->'recurrence_pattern'->>'frequency' = 'weekly',
    '[6.2] series rows carry recurrence fields';
  ASSERT (r->'sources')::text = '["going"]' AND r->>'added_at' IS NOT NULL, '[6.3] sources and added_at present';
  ASSERT (pg_temp.row_of(res, f.e_cancel)->>'has_ended')::boolean AND pg_temp.row_of(res, f.e_cancel)->>'status' = 'cancelled',
    '[6.4] cancelled sorts with ended and keeps its status';
  ASSERT (pg_temp.row_of(res, f.e_music1)->>'rsvp_count')::int = 1 AND (pg_temp.row_of(res, f.e_music1)->>'save_count')::int = 1,
    '[6.5] counts in the shared row shape';
  ASSERT pg_temp.row_of(res, f.e_music1)->>'category_label' IS NOT NULL AND pg_temp.row_of(res, f.e_music1)->>'business_name' IS NOT NULL,
    '[6.6] joined labels present';

  res := get_collection_events(m.manual);
  ASSERT pg_temp.ids(res) = ARRAY[f.e_music1, f.e_sports]::text[], format('[6.7] manual rows (%s)', pg_temp.ids(res));
  ASSERT pg_temp.row_of(res, f.e_sports)->>'note' = 'bring a scarf', '[6.8] note returned';
  ASSERT (pg_temp.row_of(res, f.e_music1)->'sources')::text = '["pinned","saved"]', '[6.8b] manual rows carry save / RSVP tags';
  ASSERT pg_temp.ids(get_collection_events(m.manual, 50, 0, 'next', 'saved')) = ARRAY[f.e_music1]::text[], '[6.8c] saved filter works on a manual collection';

  -- sorts
  res := get_collection_events(m.smart, 50, 0, 'rsvp');
  ASSERT pg_temp.ids(res) = ARRAY[f.e_music1, f.e_series, f.e_music2, f.e_sports, f.e_cancel, f.e_past]::text[],
    format('[6.9] rsvp: most going first, upcoming before ended, ties by date (%s)', pg_temp.ids(res));
  res := get_collection_events(m.smart, 50, 0, 'added');
  ASSERT pg_temp.ids(res) = ARRAY[f.e_sports, f.e_series, f.e_music1, f.e_music2, f.e_past, f.e_cancel]::text[],
    format('[6.10] added: most recent relationship first (%s)', pg_temp.ids(res));
  res := get_collection_events(m.smart, 50, 0, 'title');
  ASSERT pg_temp.ids(res) = ARRAY[f.e_music1, f.e_music2, f.e_series, f.e_sports, f.e_past, f.e_cancel]::text[],
    format('[6.11] title: alphabetical (%s)', pg_temp.ids(res));

  -- filters
  ASSERT pg_temp.ids(get_collection_events(m.smart, 50, 0, 'next', 'repeating')) = ARRAY[f.e_series]::text[], '[6.12] repeating filter';
  ASSERT pg_temp.ids(get_collection_events(m.smart, 50, 0, 'next', 'past')) = ARRAY[f.e_cancel, f.e_past]::text[], '[6.13] past filter';
  ASSERT pg_temp.ids(get_collection_events(m.smart, 50, 0, 'next', 'upcoming')) = ARRAY[f.e_music1, f.e_music2, f.e_series, f.e_sports]::text[], '[6.14] upcoming filter';
  ASSERT pg_temp.ids(get_collection_events(m.smart, 50, 0, 'next', 'pinned')) = ARRAY[f.e_sports]::text[], '[6.15] pinned filter';
  ASSERT pg_temp.ids(get_collection_events(m.smart, 50, 0, 'next', 'going')) = ARRAY[f.e_series]::text[], '[6.16] going filter';
  ASSERT json_array_length(get_collection_events(m.smart, 50, 0, 'next', 'saved')) = 4, '[6.17] saved filter';
  ASSERT pg_temp.ids(get_collection_events(m.smart, 50, 0, 'next', 'all', ARRAY[f.cat_sports])) = ARRAY[f.e_sports]::text[], '[6.18] category filter';

  -- paging
  ASSERT pg_temp.ids(get_collection_events(m.smart, 2, 2)) = ARRAY[f.e_series, f.e_sports]::text[], '[6.19] limit/offset';
  ASSERT json_array_length(get_collection_events(m.smart, 0, -5)) = 1, '[6.20] limit clamps to at least 1, offset to 0';

  -- validation
  ASSERT pg_temp.raises(format($q$SELECT get_collection_events(%L, 50, 0, 'random')$q$, m.smart), '%Invalid sort%'), '[6.21] bad sort rejected';
  ASSERT pg_temp.raises(format($q$SELECT get_collection_events(%L, 50, 0, 'next', 'mine')$q$, m.smart), '%Invalid filter%'), '[6.22] bad filter rejected';
  ASSERT json_array_length(get_collection_events(gen_random_uuid())) = 0, '[6.23] unknown collection reads as empty';
  PERFORM pg_temp.as_super();
  RAISE NOTICE 'PASS: get_collection_events';
END $$;

-- ---------------------------------------------------------------- membership of one event
DO $$
DECLARE f ctx%ROWTYPE; m made%ROWTYPE; res json;
BEGIN
  SELECT * INTO f FROM ctx; SELECT * INTO m FROM made;
  PERFORM pg_temp.as_user(f.a);
  res := get_event_collection_membership(f.e_music1);
  ASSERT json_array_length(res) = 2, format('[7.1] saved music event: pinned in manual, by rule in smart (%s)', res);
  ASSERT EXISTS (SELECT 1 FROM json_array_elements(res) x WHERE x->>'collection_id' = m.smart::text AND NOT (x->>'pinned')::boolean AND (x->>'by_rule')::boolean), '[7.2] smart by rule only';
  ASSERT EXISTS (SELECT 1 FROM json_array_elements(res) x WHERE x->>'collection_id' = m.manual::text AND (x->>'pinned')::boolean AND NOT (x->>'by_rule')::boolean), '[7.3] manual pinned only';
  res := get_event_collection_membership(f.e_sports);
  ASSERT json_array_length(res) = 2 AND NOT EXISTS (SELECT 1 FROM json_array_elements(res) x WHERE (x->>'by_rule')::boolean), '[7.4] sports pinned in both, matches no rule';
  ASSERT json_array_length(get_event_collection_membership(gen_random_uuid())) = 0, '[7.5] unknown event: none';
  PERFORM pg_temp.as_user(f.b);
  ASSERT json_array_length(get_event_collection_membership(f.e_music1)) = 0, '[7.6] scoped to the caller';
  PERFORM pg_temp.as_super();
  RAISE NOTICE 'PASS: get_event_collection_membership';
END $$;

-- ---------------------------------------------------------------- reorder
DO $$
DECLARE f ctx%ROWTYPE; m made%ROWTYPE; other uuid;
BEGIN
  SELECT * INTO f FROM ctx; SELECT * INTO m FROM made;
  PERFORM pg_temp.as_user(f.b);
  INSERT INTO collections (user_id, name) VALUES (f.b, 'Sam''s list') RETURNING id INTO other;
  PERFORM pg_temp.as_user(f.a);
  PERFORM reorder_collections(ARRAY[m.smart, m.manual]);
  ASSERT (SELECT sort_order FROM collections WHERE id = m.smart) = 1 AND (SELECT sort_order FROM collections WHERE id = m.manual) = 2, '[8.1] order applied';
  ASSERT pg_temp.ids(get_user_collections()) = ARRAY[m.smart, m.manual]::text[], '[8.2] listing follows sort_order';
  ASSERT pg_temp.raises(format($q$SELECT reorder_collections(ARRAY[%L, %L]::uuid[])$q$, m.smart, m.smart), '%Duplicate%'), '[8.3] duplicates refused';
  ASSERT pg_temp.raises(format($q$SELECT reorder_collections(ARRAY[%L, %L]::uuid[])$q$, m.smart, other), '%not_allowed%'), '[8.4] someone else''s id refused';
  ASSERT (SELECT sort_order FROM collections WHERE id = m.smart) = 1, '[8.5] failed reorder changed nothing';
  PERFORM reorder_collections('{}'::uuid[]);
  PERFORM pg_temp.as_super();
  DELETE FROM collections WHERE id = other;
  RAISE NOTICE 'PASS: reorder_collections';
END $$;

-- ---------------------------------------------------------------- caps
DO $$
DECLARE f ctx%ROWTYPE; m made%ROWTYPE; n integer;
BEGIN
  SELECT * INTO f FROM ctx; SELECT * INTO m FROM made;
  PERFORM pg_temp.as_user(f.a);
  SELECT count(*) INTO n FROM collections WHERE user_id = f.a;
  INSERT INTO collections (user_id, name) SELECT f.a, 'Filler ' || g FROM generate_series(1, 50 - n) g;
  ASSERT (SELECT count(*) FROM collections WHERE user_id = f.a) = 50, '[9.1] fifty collections allowed';
  ASSERT pg_temp.raises(format($q$INSERT INTO collections (user_id, name) VALUES (%L, 'One too many')$q$, f.a), '%collection_limit%'), '[9.2] 51st refused';
  PERFORM pg_temp.as_super();
  DELETE FROM collections WHERE user_id = f.a AND name LIKE 'Filler %';

  -- 500 pinned events per collection.
  INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address, status, publish_state, visibility)
  SELECT ('93000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, f.biz, 'Bulk ' || g, 'fixture', f.cat_sports,
         now() + interval '10 days', now() + interval '10 days 1 hour', 37.77, -122.41, 'x', 'active', 'published', 'public'
  FROM generate_series(1, 499) g;
  PERFORM pg_temp.as_user(f.a);
  INSERT INTO collection_items (collection_id, event_id)
  SELECT m.manual, ('93000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid FROM generate_series(1, 498) g;
  ASSERT (SELECT count(*) FROM collection_items WHERE collection_id = m.manual) = 500, '[9.3] five hundred items allowed';
  ASSERT pg_temp.raises(format($q$INSERT INTO collection_items (collection_id, event_id) VALUES (%L, '93000000-0000-4000-8000-000000000499')$q$, m.manual), '%collection_items_limit%'),
    '[9.4] 501st refused';
  PERFORM pg_temp.as_super();
  DELETE FROM events WHERE id::text LIKE '93000000-0000-4000-8000-%';
  ASSERT (SELECT count(*) FROM collection_items WHERE collection_id = m.manual) = 2, '[9.5] deleting events cascades to items';
  RAISE NOTICE 'PASS: caps and event cascade';
END $$;

-- ---------------------------------------------------------------- series split keeps pins
DO $$
DECLARE f ctx%ROWTYPE; m made%ROWTYPE; v_new uuid; v_date date;
BEGIN
  SELECT * INTO f FROM ctx; SELECT * INTO m FROM made;
  PERFORM pg_temp.as_user(f.a);
  INSERT INTO collection_items (collection_id, event_id, note) VALUES (m.manual, f.e_series, 'front row');
  PERFORM pg_temp.as_user(f.host);
  SELECT ((start_datetime AT TIME ZONE 'UTC')::date + 7) INTO v_date FROM events WHERE id = f.e_series;
  v_new := split_series_from(f.e_series, v_date);
  PERFORM pg_temp.as_user(f.a);
  ASSERT EXISTS (SELECT 1 FROM collection_items WHERE collection_id = m.manual AND event_id = v_new AND note = 'front row'), '[10.1] pinned item copied to the new series with its note';
  ASSERT EXISTS (SELECT 1 FROM collection_items WHERE collection_id = m.manual AND event_id = f.e_series), '[10.2] original keeps its pin';
  ASSERT (pg_temp.row_of(get_collection_events(m.smart), v_new)->'sources')::text = '["going"]', '[10.3] new series is in the smart collection through the copied RSVP';
  PERFORM pg_temp.as_super();
  DELETE FROM collection_items WHERE collection_id = m.manual AND event_id IN (f.e_series, v_new);
  RAISE NOTICE 'PASS: split_series_from copies pins';
END $$;

-- ---------------------------------------------------------------- batched membership (Phase F)
DO $$
DECLARE f ctx%ROWTYPE; m made%ROWTYPE; res json; r json;
BEGIN
  SELECT * INTO f FROM ctx; SELECT * INTO m FROM made;
  PERFORM pg_temp.as_user(f.a);
  res := get_events_collection_membership(ARRAY[f.e_music1, f.e_sports, f.e_music2, gen_random_uuid()]);
  ASSERT json_array_length(res) = 3, format('[12.1] one row per event in at least one collection (%s)', res);
  SELECT x INTO r FROM json_array_elements(res) x WHERE x->>'event_id' = f.e_music1::text;
  ASSERT json_array_length(r->'collection_ids') = 2, '[12.2] saved music event: manual (pinned) + smart (rule)';
  SELECT x INTO r FROM json_array_elements(res) x WHERE x->>'event_id' = f.e_music2::text;
  ASSERT (r->'collection_ids'->>0)::uuid = m.smart, '[12.3] rule-only member lists the smart collection';
  ASSERT json_array_length(get_events_collection_membership('{}'::uuid[])) = 0, '[12.4] empty input';
  PERFORM pg_temp.as_user(f.b);
  ASSERT json_array_length(get_events_collection_membership(ARRAY[f.e_music1])) = 0, '[12.5] scoped to the caller';
  PERFORM pg_temp.as_anon();
  ASSERT pg_temp.raises(format($q$SELECT get_events_collection_membership(ARRAY[%L::uuid])$q$, f.e_music1), '%permission denied%'), '[12.6] anon refused';
  PERFORM pg_temp.as_super();
  RAISE NOTICE 'PASS: batched membership';
END $$;

-- ---------------------------------------------------------------- interest notification names the favourite collection (Phase F)
DO $$
DECLARE f ctx%ROWTYPE; m made%ROWTYPE; v_new uuid := gen_random_uuid(); n notifications%ROWTYPE;
BEGIN
  SELECT * INTO f FROM ctx; SELECT * INTO m FROM made;
  -- Alex: interested in music, opted in, lives where the fixtures are; no interest notice in the last day.
  UPDATE profiles SET preferred_categories = ARRAY[f.cat_music], lat = 37.77, lng = -122.41,
         notification_preferences = COALESCE(notification_preferences, '{}'::jsonb) || '{"interest_events": true}'::jsonb
   WHERE id = f.a;
  DELETE FROM notifications WHERE user_id = f.a AND type = 'interest_event';
  INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address, status, publish_state, visibility)
  VALUES (v_new, f.biz, 'Pop-up Jazz', 'fixture', f.cat_music, now() + interval '2 days', now() + interval '2 days 2 hours', 37.77, -122.41, 'x', 'active', 'published', 'public');
  SELECT * INTO n FROM notifications WHERE user_id = f.a AND type = 'interest_event' AND event_id = v_new;
  ASSERT FOUND, '[13.1] interest notification created';
  ASSERT (n.data->>'collectionId')::uuid = m.smart, format('[13.2] data names the Music smart collection (%s)', n.data);
  ASSERT n.body LIKE '%joins your Live Music collection%', format('[13.3] body mentions the collection (%s)', n.body);
  -- Sam has no favourite: no collectionId, plain body.
  UPDATE profiles SET preferred_categories = ARRAY[f.cat_music], lat = 37.77, lng = -122.41,
         notification_preferences = COALESCE(notification_preferences, '{}'::jsonb) || '{"interest_events": true}'::jsonb
   WHERE id = f.b;
  DELETE FROM notifications WHERE user_id = f.b AND type = 'interest_event';
  PERFORM notify_interested_for_event(v_new);
  SELECT * INTO n FROM notifications WHERE user_id = f.b AND type = 'interest_event' AND event_id = v_new;
  ASSERT FOUND AND n.data->>'collectionId' IS NULL AND n.body NOT LIKE '%collection%', '[13.4] no favourite → unchanged notice';
  DELETE FROM events WHERE id = v_new;
  RAISE NOTICE 'PASS: interest notification names the favourite collection';
END $$;

-- ---------------------------------------------------------------- calendar source 'collections' (post-F)
DO $$
DECLARE f ctx%ROWTYPE; m made%ROWTYPE; cal json; ids text[];
BEGIN
  SELECT * INTO f FROM ctx; SELECT * INTO m FROM made;
  PERFORM pg_temp.as_user(f.a);
  cal := get_user_calendar(now() - interval '1 day', now() + interval '30 days', ARRAY['collections'], 300);
  SELECT COALESCE(array_agg(x->>'id'), '{}') INTO ids FROM json_array_elements(cal->'rows') x;
  ASSERT ids @> ARRAY[f.e_music1, f.e_music2, f.e_series, f.e_sports]::text[], format('[14.1] upcoming members of any collection (%s)', ids);
  ASSERT NOT (ids && ARRAY[f.e_past]::text[]), '[14.2] ended members are outside the range';
  ASSERT EXISTS (SELECT 1 FROM json_array_elements(cal->'rows') x WHERE x->>'id' = f.e_music1::text AND (x->'sources')::text LIKE '%collections%'),
    '[14.3] rows are tagged collections';
  cal := get_user_calendar(now() - interval '1 day', now() + interval '30 days', ARRAY['going', 'collections'], 300);
  ASSERT EXISTS (SELECT 1 FROM json_array_elements(cal->'rows') x WHERE x->>'id' = f.e_series::text AND (x->'sources')::text = '["collections","going"]'),
    '[14.4] combined with other sources, deduplicated per event';
  ASSERT pg_temp.raises($q$SELECT get_user_calendar(now(), now() + interval '1 day', ARRAY['bookmarks'], 10)$q$, '%invalid_source%'), '[14.5] unknown sources still refused';
  PERFORM pg_temp.as_user(f.b);
  cal := get_user_calendar(now() - interval '1 day', now() + interval '30 days', ARRAY['collections'], 300);
  ASSERT json_array_length(cal->'rows') = 0, '[14.6] scoped to the caller';
  PERFORM pg_temp.as_super();
  RAISE NOTICE 'PASS: calendar source collections';
END $$;

-- ---------------------------------------------------------------- account cascade
DO $$
DECLARE f ctx%ROWTYPE; m made%ROWTYPE;
BEGIN
  SELECT * INTO f FROM ctx; SELECT * INTO m FROM made;
  DELETE FROM profiles WHERE id = f.a;
  ASSERT NOT EXISTS (SELECT 1 FROM collections WHERE id IN (m.manual, m.smart)), '[11.1] deleting the profile removes the collections';
  ASSERT NOT EXISTS (SELECT 1 FROM collection_items WHERE collection_id IN (m.manual, m.smart)), '[11.2] and their items';
  RAISE NOTICE 'PASS: profile cascade';
END $$;

DO $$ BEGIN RAISE NOTICE 'collections regression suite: all checks passed'; END $$;
ROLLBACK;
