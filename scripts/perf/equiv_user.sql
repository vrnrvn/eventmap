\set QUIET on
BEGIN;
CREATE TEMP TABLE p1 AS SELECT * FROM get_ranked_events(37.7749,-122.4194);
-- make a user who has an RSVP on one page-1 event and a save on another
SELECT r.user_id AS uid FROM rsvps r WHERE r.event_id IN (SELECT id FROM p1) LIMIT 1 \gset
INSERT INTO saves(user_id, event_id) SELECT :'uid', id FROM p1 WHERE id NOT IN (SELECT event_id FROM saves WHERE user_id = :'uid') ORDER BY id LIMIT 3;
SELECT set_config('request.jwt.claim.sub', :'uid', true), set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, true) \g /dev/null
SET LOCAL ROLE authenticated;
SELECT
 (SELECT array_agg(o ORDER BY ord) FROM (SELECT o, row_number() over () ord FROM get_ranked_events_old(37.7749,-122.4194) o) x)
 IS NOT DISTINCT FROM
 (SELECT array_agg(o ORDER BY ord) FROM (SELECT o, row_number() over () ord FROM get_ranked_events(37.7749,-122.4194) o) x) AS identical,
 (SELECT count(*) FILTER (WHERE user_rsvp IS NOT NULL) FROM get_ranked_events(37.7749,-122.4194)) rsvp_rows,
 (SELECT count(*) FILTER (WHERE user_saved) FROM get_ranked_events(37.7749,-122.4194)) saved_rows;
ROLLBACK;
