-- Isolated stress / edge-case suite for the event chat system.
-- Runs ONLY against the scratch clone:  scripts/db-scratch.sh refresh && scripts/db-scratch.sh apply scripts/chat-stress-test.sql
-- Each block impersonates a user with set_config(role/claims) inside its own transaction.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

-- Fixtures from seed.sql
\set EVENT  '''30000000-0000-4000-8000-000000000001'''
\set HOST   '''10000000-0000-4000-8000-000000000001'''
\set ALEX   '''10000000-0000-4000-8000-000000000002'''
\set SAM    '''10000000-0000-4000-8000-000000000003'''

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('role', 'anon', true);
END $$;

-- T1: rate limit burst (exactly 10 of 15 rapid inserts succeed)
UPDATE event_chat_messages SET created_at = created_at - interval '1 hour' WHERE sender_id = :SAM;
DO $$
DECLARE ok_count int := 0; limited int := 0; i int;
BEGIN
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000003');
  FOR i IN 1..15 LOOP
    BEGIN
      INSERT INTO event_chat_messages (event_id, sender_id, body) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'burst ' || i);
      ok_count := ok_count + 1;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%chat_rate_limited%' THEN limited := limited + 1; ELSE RAISE; END IF;
    END;
  END LOOP;
  ASSERT ok_count = 10 AND limited = 5, format('rate limit: %s ok / %s limited', ok_count, limited);
  RAISE NOTICE 'PASS T1 rate limit burst (10 allowed, 5 limited)';
END $$;

-- T2: pagination integrity across clustered timestamps (350 rows, many identical created_at)
INSERT INTO event_chat_messages (event_id, sender_id, body, created_at)
SELECT '30000000-0000-4000-8000-000000000001',
       CASE WHEN i % 2 = 0 THEN '10000000-0000-4000-8000-000000000002'::uuid ELSE '10000000-0000-4000-8000-000000000003'::uuid END,
       'page ' || i,
       now() - interval '2 days' + make_interval(secs => (i / 7))
FROM generate_series(1, 350) AS i;
DO $$
DECLARE total int; seen uuid[] := '{}'; page record; cur_created timestamptz := NULL; cur_id uuid := NULL; rows_in_page int; pages int := 0; dup int := 0;
BEGIN
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000002');
  SELECT count(*) INTO total FROM event_chat_messages WHERE event_id = '30000000-0000-4000-8000-000000000001';
  LOOP
    rows_in_page := 0; pages := pages + 1;
    FOR page IN SELECT * FROM get_event_chat_messages('30000000-0000-4000-8000-000000000001', 100, cur_created, cur_id) LOOP
      IF page.id = ANY(seen) THEN dup := dup + 1; END IF;
      seen := seen || page.id; rows_in_page := rows_in_page + 1;
      cur_created := page.created_at; cur_id := page.id;
    END LOOP;
    EXIT WHEN rows_in_page < 100 OR pages > 20;
  END LOOP;
  ASSERT dup = 0, format('duplicates across pages: %s', dup);
  ASSERT cardinality(seen) = total, format('paged %s of %s rows', cardinality(seen), total);
  RAISE NOTICE 'PASS T2 pagination integrity (% rows, % pages, 0 dupes)', total, pages;
END $$;

-- T3: since-cursor inclusivity and tombstone masking
DO $$
DECLARE m record; n int;
BEGIN
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000002');
  SELECT id, created_at INTO m FROM event_chat_messages WHERE event_id = '30000000-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 1;
  SELECT count(*) INTO n FROM get_event_chat_messages_since('30000000-0000-4000-8000-000000000001', m.created_at, 100) WHERE id = m.id;
  ASSERT n = 1, 'since cursor must be inclusive';
  RAISE NOTICE 'PASS T3 since-cursor inclusive';
END $$;

-- T4: unread counts (others only, tombstones excluded, mute epoch harmless)
DO $$
DECLARE c int; mid uuid;
BEGIN
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000002');
  PERFORM mark_event_chat_read('30000000-0000-4000-8000-000000000001');
  PERFORM set_config('role', 'postgres', true);
  -- Everything in this block shares one now(); move the marker back so new rows count as unread.
  UPDATE event_chat_reads SET last_read_at = now() - interval '1 minute' WHERE user_id = '10000000-0000-4000-8000-000000000002';
  UPDATE event_chat_messages SET created_at = created_at - interval '1 hour' WHERE sender_id = '10000000-0000-4000-8000-000000000003';
  INSERT INTO event_chat_messages (event_id, sender_id, body) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'u1'), ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'u2');
  INSERT INTO event_chat_messages (event_id, sender_id, body) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'u3') RETURNING id INTO mid;
  INSERT INTO event_chat_messages (event_id, sender_id, body) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'own message');
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000002');
  SELECT unread_count INTO c FROM get_event_chat_unread_counts(ARRAY['30000000-0000-4000-8000-000000000001'::uuid]);
  ASSERT c = 3, format('unread after 3 from others + 1 own = %s', c);
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000003');
  PERFORM delete_event_chat_message(mid);
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000002');
  SELECT unread_count INTO c FROM get_event_chat_unread_counts(ARRAY['30000000-0000-4000-8000-000000000001'::uuid]);
  ASSERT c = 2, format('unread after tombstone = %s', c);
  PERFORM set_event_chat_muted('30000000-0000-4000-8000-000000000001', true);
  SELECT unread_count INTO c FROM get_event_chat_unread_counts(ARRAY['30000000-0000-4000-8000-000000000001'::uuid]);
  ASSERT c = 2, 'mute must not change unread';
  PERFORM set_event_chat_muted('30000000-0000-4000-8000-000000000001', false);
  RAISE NOTICE 'PASS T4 unread counts';
END $$;

-- T5: notification throttles (chat_message 1/15min; mention 1 per sender per 5 min, max 3 per 15 min)
DO $$
DECLARE c int;
BEGIN
  DELETE FROM notifications WHERE type IN ('chat_message', 'chat_mention');
  UPDATE event_chat_reads SET last_read_at = now() - interval '1 hour' WHERE user_id = '10000000-0000-4000-8000-000000000002';
  UPDATE event_chat_messages SET created_at = created_at - interval '1 hour' WHERE sender_id = '10000000-0000-4000-8000-000000000003';
  INSERT INTO event_chat_messages (event_id, sender_id, body) SELECT '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'n' || i FROM generate_series(1, 5) i;
  SELECT count(*) INTO c FROM notifications WHERE user_id = '10000000-0000-4000-8000-000000000002' AND type = 'chat_message';
  ASSERT c = 1, format('chat_message throttle: %s', c);
  INSERT INTO event_chat_messages (event_id, sender_id, body, mentions) SELECT '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'm' || i, ARRAY['10000000-0000-4000-8000-000000000002'::uuid] FROM generate_series(1, 3) i;
  SELECT count(*) INTO c FROM notifications WHERE user_id = '10000000-0000-4000-8000-000000000002' AND type = 'chat_mention';
  ASSERT c = 1, format('mention per-sender throttle: %s', c);
  INSERT INTO notifications (user_id, type, title, body, event_id, data) SELECT '10000000-0000-4000-8000-000000000002', 'chat_mention', 'x', 'x', '30000000-0000-4000-8000-000000000001', jsonb_build_object('senderId', gen_random_uuid()) FROM generate_series(1, 2);
  INSERT INTO rsvps (user_id, event_id, status) VALUES ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'going') ON CONFLICT DO NOTHING;
  INSERT INTO event_chat_messages (event_id, sender_id, body, mentions) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'host ping', ARRAY['10000000-0000-4000-8000-000000000002'::uuid]);
  SELECT count(*) INTO c FROM notifications WHERE user_id = '10000000-0000-4000-8000-000000000002' AND type = 'chat_mention';
  ASSERT c = 3, format('mention cap 3/15min: %s', c);
  DELETE FROM rsvps WHERE user_id = '10000000-0000-4000-8000-000000000001' AND event_id = '30000000-0000-4000-8000-000000000001';
  RAISE NOTICE 'PASS T5 notification throttles';
END $$;

-- T6: body / mention constraints
DO $$
DECLARE r record; failed boolean;
BEGIN
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000002');
  PERFORM set_config('role', 'postgres', true);
  UPDATE event_chat_messages SET created_at = created_at - interval '1 hour' WHERE sender_id = '10000000-0000-4000-8000-000000000002';
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000002');
  failed := false;
  BEGIN INSERT INTO event_chat_messages (event_id, sender_id, body) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '    '); EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, 'whitespace-only body must be rejected';
  INSERT INTO event_chat_messages (event_id, sender_id, body) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', repeat('é', 1000));
  failed := false;
  BEGIN INSERT INTO event_chat_messages (event_id, sender_id, body) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', repeat('a', 1001)); EXCEPTION WHEN check_violation THEN failed := true; END;
  ASSERT failed, '1001 chars must be rejected';
  INSERT INTO event_chat_messages (event_id, sender_id, body) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '🎉 café — "quotes" & <tags> \ backslash') RETURNING * INTO r;
  ASSERT r.body = '🎉 café — "quotes" & <tags> \ backslash', 'unicode roundtrip';
  INSERT INTO event_chat_messages (event_id, sender_id, body, mentions) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'm', (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 25))) RETURNING * INTO r;
  ASSERT r.mentions = '{}', 'unknown mention ids stripped';
  failed := false;
  BEGIN INSERT INTO event_chat_messages (event_id, sender_id, body, created_at) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'x', now() - interval '1 day'); EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ASSERT failed, 'created_at must not be client-settable';
  RAISE NOTICE 'PASS T6 body/mention constraints';
END $$;

-- T7: lock, slow mode boundary, host bypass
DO $$
DECLARE failed boolean; last_id uuid;
BEGIN
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000001');
  PERFORM set_event_chat_settings('30000000-0000-4000-8000-000000000001', true, 10);
  PERFORM set_config('role', 'postgres', true);
  UPDATE event_chat_messages SET created_at = created_at - interval '1 hour' WHERE sender_id = '10000000-0000-4000-8000-000000000003';
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000003');
  failed := false;
  BEGIN INSERT INTO event_chat_messages (event_id, sender_id, body) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'locked'); EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  ASSERT failed, 'locked chat must reject attendee insert';
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000001');
  PERFORM set_event_chat_settings('30000000-0000-4000-8000-000000000001', false, NULL);
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000003');
  INSERT INTO event_chat_messages (event_id, sender_id, body) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'slow 1') RETURNING id INTO last_id;
  failed := false;
  BEGIN INSERT INTO event_chat_messages (event_id, sender_id, body) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'slow 2'); EXCEPTION WHEN OTHERS THEN failed := SQLERRM LIKE '%chat_slow_mode%'; END;
  ASSERT failed, 'second message inside the slow window must fail';
  PERFORM set_config('role', 'postgres', true);
  UPDATE event_chat_messages SET created_at = now() - interval '11 seconds' WHERE id = last_id;
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000003');
  INSERT INTO event_chat_messages (event_id, sender_id, body) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'slow 3');
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000001');
  PERFORM set_event_chat_settings('30000000-0000-4000-8000-000000000001', false, 0);
  RAISE NOTICE 'PASS T7 lock + slow-mode boundary';
END $$;

-- T8: RLS matrix
DO $$
DECLARE n int;
BEGIN
  PERFORM pg_temp.as_anon();
  SELECT count(*) INTO n FROM event_chat_messages;
  ASSERT n = 0, 'anon must read nothing';
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000001');
  PERFORM set_config('role', 'postgres', true);
  UPDATE profiles SET is_admin = false WHERE id = '10000000-0000-4000-8000-000000000001';
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000001');
  SELECT count(*) INTO n FROM event_chat_messages WHERE event_id = '30000000-0000-4000-8000-000000000001';
  ASSERT n > 0, 'non-admin host must read own event chat';
  SELECT count(*) INTO n FROM event_chat_messages WHERE event_id = '30000000-0000-4000-8000-000000000002';
  ASSERT n = 0 OR EXISTS (SELECT 1 FROM events e JOIN businesses b ON b.id = e.business_id WHERE e.id = '30000000-0000-4000-8000-000000000002' AND b.owner_id = '10000000-0000-4000-8000-000000000001'), 'host must not read chats of events they do not own';
  SELECT count(*) INTO n FROM event_chat_removed_bodies;
  ASSERT n = 0, 'non-admin must not read removed bodies';
  PERFORM set_config('role', 'postgres', true);
  UPDATE profiles SET is_admin = true WHERE id = '10000000-0000-4000-8000-000000000001';
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000003');
  PERFORM set_config('role', 'postgres', true);
  INSERT INTO event_chat_blocks (event_id, user_id, blocked_by) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001');
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000003');
  SELECT count(*) INTO n FROM event_chat_messages WHERE event_id = '30000000-0000-4000-8000-000000000001';
  ASSERT n > 0, 'blocked user can still read';
  SELECT count(*) INTO n FROM event_chat_blocks;
  ASSERT n = 0, 'blocked user must not see block rows';
  PERFORM set_config('role', 'postgres', true);
  DELETE FROM event_chat_blocks WHERE user_id = '10000000-0000-4000-8000-000000000003';
  RAISE NOTICE 'PASS T8 RLS matrix';
END $$;

-- T9: event deletion cascades everything chat-related
DO $$
DECLARE ev uuid := gen_random_uuid(); mid uuid := gen_random_uuid(); n int;
BEGIN
  INSERT INTO events SELECT * FROM jsonb_populate_record(NULL::events, (SELECT to_jsonb(e) - 'id' || jsonb_build_object('id', ev, 'title', 'cascade test') FROM events e WHERE id = '30000000-0000-4000-8000-000000000001'));
  INSERT INTO rsvps (user_id, event_id, status) VALUES ('10000000-0000-4000-8000-000000000002', ev, 'going'), ('10000000-0000-4000-8000-000000000003', ev, 'going');
  INSERT INTO event_chat_messages (id, event_id, sender_id, body) VALUES (mid, ev, '10000000-0000-4000-8000-000000000003', 'to cascade');
  INSERT INTO complaints (reporter_id, target_type, target_id, reason) VALUES ('10000000-0000-4000-8000-000000000002', 'chat_message', mid, 'x');
  INSERT INTO event_chat_settings (event_id, locked) VALUES (ev, true);
  INSERT INTO event_chat_blocks (event_id, user_id, blocked_by) VALUES (ev, '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001');
  INSERT INTO event_chat_reads (user_id, event_id) VALUES ('10000000-0000-4000-8000-000000000002', ev);
  INSERT INTO event_chat_moderation_actions (event_id, message_id, actor_id, action) VALUES (ev, mid, '10000000-0000-4000-8000-000000000001', 'delete');
  INSERT INTO event_chat_removed_bodies (message_id, body) VALUES (mid, 'stash');
  DELETE FROM events WHERE id = ev;
  SELECT (SELECT count(*) FROM event_chat_messages WHERE event_id = ev) + (SELECT count(*) FROM complaints WHERE target_id = mid)
       + (SELECT count(*) FROM event_chat_settings WHERE event_id = ev) + (SELECT count(*) FROM event_chat_blocks WHERE event_id = ev)
       + (SELECT count(*) FROM event_chat_reads WHERE event_id = ev) + (SELECT count(*) FROM event_chat_moderation_actions WHERE event_id = ev)
       + (SELECT count(*) FROM event_chat_removed_bodies WHERE message_id = mid) INTO n;
  ASSERT n = 0, format('leftover rows after cascade: %s', n);
  RAISE NOTICE 'PASS T9 event deletion cascade';
END $$;

-- T10: query plans use indexes at ~400 messages (sanity; prints timings)
DO $$
DECLARE plan text; t0 timestamptz; ms numeric;
BEGIN
  PERFORM pg_temp.as_user('10000000-0000-4000-8000-000000000002');
  t0 := clock_timestamp();
  PERFORM * FROM get_event_chat_messages('30000000-0000-4000-8000-000000000001', 100);
  ms := extract(milliseconds from clock_timestamp() - t0);
  RAISE NOTICE 'TIMING page load (100 rows, RLS): % ms', round(ms, 1);
  t0 := clock_timestamp();
  PERFORM * FROM get_event_chat_unread_counts(ARRAY['30000000-0000-4000-8000-000000000001'::uuid]);
  ms := extract(milliseconds from clock_timestamp() - t0);
  RAISE NOTICE 'TIMING unread counts: % ms', round(ms, 1);
  t0 := clock_timestamp();
  PERFORM * FROM get_event_chat_post_status('30000000-0000-4000-8000-000000000001');
  ms := extract(milliseconds from clock_timestamp() - t0);
  RAISE NOTICE 'TIMING post status: % ms', round(ms, 1);
END $$;
