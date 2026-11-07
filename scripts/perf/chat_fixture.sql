BEGIN;
SET LOCAL session_replication_role = replica;
-- Chat event: a future SF event owned by business #1's owner
CREATE TABLE IF NOT EXISTS public._perf_chat(k text primary key, v uuid);
TRUNCATE public._perf_chat;
INSERT INTO public._perf_chat SELECT 'event', id FROM events WHERE end_datetime > now() + interval '2 days' AND NOT is_recurring AND status='active' ORDER BY id LIMIT 1;
INSERT INTO public._perf_chat SELECT 'host', b.owner_id FROM events e JOIN businesses b ON b.id = e.business_id WHERE e.id = (SELECT v FROM _perf_chat WHERE k='event');
-- 50 going attendees (not the host)
DELETE FROM rsvps WHERE event_id = (SELECT v FROM _perf_chat WHERE k='event');
INSERT INTO rsvps (user_id, event_id, status)
SELECT p.id, (SELECT v FROM _perf_chat WHERE k='event'), 'going'
FROM profiles p WHERE p.id <> (SELECT v FROM _perf_chat WHERE k='host') ORDER BY p.id OFFSET 100 LIMIT 50;
INSERT INTO public._perf_chat SELECT 'viewer', user_id FROM rsvps WHERE event_id = (SELECT v FROM _perf_chat WHERE k='event') ORDER BY user_id LIMIT 1;
INSERT INTO public._perf_chat SELECT 'outsider', id FROM profiles WHERE id NOT IN (SELECT user_id FROM rsvps WHERE event_id = (SELECT v FROM _perf_chat WHERE k='event')) AND id <> (SELECT v FROM _perf_chat WHERE k='host') ORDER BY id DESC LIMIT 1;
-- viewer blocks two senders
INSERT INTO user_blocks (blocker_id, blocked_id)
SELECT (SELECT v FROM _perf_chat WHERE k='viewer'), user_id FROM rsvps WHERE event_id = (SELECT v FROM _perf_chat WHERE k='event') ORDER BY user_id OFFSET 1 LIMIT 2
ON CONFLICT DO NOTHING;
-- 20k messages, round-robin senders (incl. host), some tombstones
INSERT INTO event_chat_messages (event_id, sender_id, body, created_at, deleted_at)
SELECT (SELECT v FROM _perf_chat WHERE k='event'), s.user_id, 'message '||g,
       now() - interval '30 days' + g * interval '2 minutes',
       CASE WHEN g % 97 = 0 THEN now() - interval '1 day' END
FROM generate_series(1, 20000) g
JOIN (SELECT user_id, row_number() over (ORDER BY user_id) - 1 rn FROM rsvps WHERE event_id = (SELECT v FROM _perf_chat WHERE k='event')) s ON s.rn = g % 50;
-- other events' chatter so the table isn't single-event
INSERT INTO event_chat_messages (event_id, sender_id, body, created_at)
SELECT r.event_id, r.user_id, 'noise', now() - random() * interval '20 days'
FROM rsvps r WHERE r.status='going' AND r.event_id <> (SELECT v FROM _perf_chat WHERE k='event') LIMIT 150000;
INSERT INTO event_rsvp_counts (event_id, going_count, interested_count)
SELECT event_id, COUNT(*) FILTER (WHERE status='going'), COUNT(*) FILTER (WHERE status='interested') FROM rsvps WHERE event_id = (SELECT v FROM _perf_chat WHERE k='event') GROUP BY event_id
ON CONFLICT (event_id) DO UPDATE SET going_count = EXCLUDED.going_count;
COMMIT;
ANALYZE event_chat_messages; ANALYZE rsvps; ANALYZE user_blocks;
SELECT k, v FROM _perf_chat ORDER BY k;
SELECT count(*) msgs FROM event_chat_messages;
