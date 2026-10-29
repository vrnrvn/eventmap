-- pgbench script: concurrent attendee inserts as Sam (rate limit under contention).
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', false);
SET ROLE authenticated;
INSERT INTO event_chat_messages (event_id, sender_id, body) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'concurrent');
RESET ROLE;
