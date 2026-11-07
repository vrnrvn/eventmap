\set QUIET on
\pset footer off
SELECT v AS ev FROM _perf_chat WHERE k='event' \gset
SELECT v AS viewer FROM _perf_chat WHERE k='viewer' \gset
SELECT v AS host FROM _perf_chat WHERE k='host' \gset
SELECT v AS outsider FROM _perf_chat WHERE k='outsider' \gset
BEGIN;
SELECT set_config('request.jwt.claim.sub', :'viewer', true), set_config('request.jwt.claims', json_build_object('sub', :'viewer','role','authenticated')::text, true) \g /dev/null
SET LOCAL ROLE authenticated;
INSERT INTO event_chat_messages (event_id, sender_id, body) VALUES (:'ev', :'viewer', 'hi from viewer') RETURNING 'viewer insert+returning ok' AS result, body;
ROLLBACK;
BEGIN;
SELECT set_config('request.jwt.claim.sub', :'host', true), set_config('request.jwt.claims', json_build_object('sub', :'host','role','authenticated')::text, true) \g /dev/null
SET LOCAL ROLE authenticated;
INSERT INTO event_chat_messages (event_id, sender_id, body) VALUES (:'ev', :'host', 'hi from host') RETURNING 'host insert+returning ok' AS result, body;
ROLLBACK;
BEGIN;
SELECT set_config('request.jwt.claim.sub', :'outsider', true), set_config('request.jwt.claims', json_build_object('sub', :'outsider','role','authenticated')::text, true) \g /dev/null
SET LOCAL ROLE authenticated;
\set ON_ERROR_STOP off
INSERT INTO event_chat_messages (event_id, sender_id, body) VALUES (:'ev', :'outsider', 'should fail') RETURNING 'OUTSIDER INSERTED (BAD)';
ROLLBACK;
