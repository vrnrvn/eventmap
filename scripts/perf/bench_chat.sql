\set QUIET on
\pset footer off
BEGIN;
SELECT v AS ev FROM _perf_chat WHERE k='event' \gset
SELECT id AS admin FROM profiles WHERE id NOT IN (SELECT v FROM _perf_chat) ORDER BY id OFFSET 7 LIMIT 1 \gset
UPDATE profiles SET is_admin = true WHERE id = :'admin';
SELECT created_at AS mid_at, id AS mid_id FROM event_chat_messages WHERE event_id = :'ev' ORDER BY created_at DESC OFFSET 10000 LIMIT 1 \gset
CREATE TEMP TABLE out(who text, call text, ms numeric, fp text, n int);
GRANT ALL ON out TO anon, authenticated;
CREATE OR REPLACE FUNCTION pg_temp.run(who text, ev uuid, mid_at timestamptz, mid_id uuid) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE t0 timestamptz; i int; fp text; n int; reps int := 20;
BEGIN
  -- latest page
  t0 := clock_timestamp();
  FOR i IN 1..reps LOOP PERFORM count(*) FROM get_event_chat_messages(ev, 100); END LOOP;
  SELECT md5(coalesce(string_agg(m::text, '|'), '')), count(*) INTO fp, n FROM get_event_chat_messages(ev, 100) m;
  INSERT INTO out VALUES (who, 'page_latest', round(extract(epoch FROM clock_timestamp()-t0)*1000/reps, 2), fp, n);
  -- deep keyset page
  t0 := clock_timestamp();
  FOR i IN 1..reps LOOP PERFORM count(*) FROM get_event_chat_messages(ev, 100, mid_at, mid_id); END LOOP;
  SELECT md5(coalesce(string_agg(m::text, '|'), '')), count(*) INTO fp, n FROM get_event_chat_messages(ev, 100, mid_at, mid_id) m;
  INSERT INTO out VALUES (who, 'page_deep', round(extract(epoch FROM clock_timestamp()-t0)*1000/reps, 2), fp, n);
  -- since (gap recovery)
  t0 := clock_timestamp();
  FOR i IN 1..reps LOOP PERFORM count(*) FROM get_event_chat_messages_since(ev, now() - interval '3 days', 100); END LOOP;
  SELECT md5(coalesce(string_agg(m::text, '|'), '')), count(*) INTO fp, n FROM get_event_chat_messages_since(ev, now() - interval '3 days', 100) m;
  INSERT INTO out VALUES (who, 'since', round(extract(epoch FROM clock_timestamp()-t0)*1000/reps, 2), fp, n);
  -- direct table read (getLatestMessage)
  t0 := clock_timestamp();
  FOR i IN 1..reps LOOP PERFORM 1 FROM (SELECT * FROM event_chat_messages WHERE event_id = ev AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) x; END LOOP;
  SELECT md5(coalesce(string_agg(m::text, '|'), '')), count(*) INTO fp, n FROM (SELECT * FROM event_chat_messages WHERE event_id = ev AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) m;
  INSERT INTO out VALUES (who, 'latest_direct', round(extract(epoch FROM clock_timestamp()-t0)*1000/reps, 2), fp, n);
END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.run(text, uuid, timestamptz, uuid) TO anon, authenticated;
\set roles 'viewer host outsider'
SELECT v AS u FROM _perf_chat WHERE k='viewer' \gset
SELECT set_config('request.jwt.claim.sub', :'u', true), set_config('request.jwt.claims', json_build_object('sub', :'u', 'role','authenticated')::text, true) \g /dev/null
SET LOCAL ROLE authenticated; SELECT pg_temp.run('viewer', :'ev', :'mid_at', :'mid_id') \g /dev/null
RESET ROLE;
SELECT v AS u FROM _perf_chat WHERE k='host' \gset
SELECT set_config('request.jwt.claim.sub', :'u', true), set_config('request.jwt.claims', json_build_object('sub', :'u', 'role','authenticated')::text, true) \g /dev/null
SET LOCAL ROLE authenticated; SELECT pg_temp.run('host', :'ev', :'mid_at', :'mid_id') \g /dev/null
RESET ROLE;
SELECT v AS u FROM _perf_chat WHERE k='outsider' \gset
SELECT set_config('request.jwt.claim.sub', :'u', true), set_config('request.jwt.claims', json_build_object('sub', :'u', 'role','authenticated')::text, true) \g /dev/null
SET LOCAL ROLE authenticated; SELECT pg_temp.run('outsider', :'ev', :'mid_at', :'mid_id') \g /dev/null
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'admin', true), set_config('request.jwt.claims', json_build_object('sub', :'admin', 'role','authenticated')::text, true) \g /dev/null
SET LOCAL ROLE authenticated; SELECT pg_temp.run('admin', :'ev', :'mid_at', :'mid_id') \g /dev/null
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '{"role":"anon"}', true) \g /dev/null
SET LOCAL ROLE anon; SELECT pg_temp.run('anon', :'ev', :'mid_at', :'mid_id') \g /dev/null
RESET ROLE;
SELECT who, call, ms, n, left(fp, 10) fp FROM out ORDER BY who, call;
ROLLBACK;
