\set QUIET on
\pset footer off
BEGIN;
-- a signed-in user who actually has RSVPs/saves in SF so user_rsvp/user_saved are exercised
SELECT r.user_id AS uid FROM rsvps r JOIN events e ON e.id = r.event_id
 WHERE e.lat BETWEEN 37.5 AND 38 AND e.lng BETWEEN -122.7 AND -122.1 AND e.end_datetime > now()
 GROUP BY r.user_id ORDER BY count(*) DESC LIMIT 1 \gset
SELECT id AS cat1 FROM categories ORDER BY id LIMIT 1 \gset
CREATE TEMP TABLE cases(n int, lat float8, lng float8, rad float8, cats uuid[], sd timestamptz, ed timestamptz, q text, lim int, off int);
INSERT INTO cases VALUES
 (1, 37.7749,-122.4194, 50, NULL, NULL, NULL, NULL, 100, 0),
 (2, 37.7749,-122.4194, 50, NULL, NULL, NULL, NULL, 100, 100),
 (3, 37.7749,-122.4194, 50, NULL, NULL, NULL, NULL, 100, 200),
 (4, 37.7749,-122.4194, 50, NULL, NULL, NULL, NULL, 200, 5000),
 (5, 37.7749,-122.4194, 10, NULL, NULL, NULL, NULL, 100, 0),
 (6, 37.7749,-122.4194, 50, NULL, NULL, NULL, 'jazz', 100, 0),
 (7, 37.7749,-122.4194, 50, NULL, NULL, NULL, 'Biz 12', 100, 0),
 (8, 37.7749,-122.4194, 50, ARRAY[:'cat1']::uuid[], NULL, NULL, NULL, 100, 0),
 (9, 37.7749,-122.4194, 50, NULL, now(), now() + interval '3 days', NULL, 100, 0),
 (10, 37.7749,-122.4194, 50, NULL, now() + interval '7 days', now() + interval '9 days', NULL, 200, 0),
 (11, 40.7128,-74.0060, 25, NULL, NULL, NULL, NULL, 100, 300),
 (12, 38.5,-98.0, 50, NULL, NULL, NULL, NULL, 100, 0),
 (13, 38.5,-98.0, 200, NULL, NULL, NULL, NULL, 200, 0),
 (14, 64.8,-147.7, 50, NULL, NULL, NULL, NULL, 100, 0),
 (15, 37.7749,-122.4194, 0.05, NULL, NULL, NULL, NULL, 100, 0),
 (16, 37.7749,-122.4194, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
 (17, 37.7749,-122.4194, 50, NULL, NULL, NULL, NULL, 1000, -5);
CREATE TEMP TABLE results(who text, n int, same boolean, rows_old int, rows_new int);
GRANT ALL ON cases, results TO anon, authenticated;
DO $$ BEGIN END $$;
-- anonymous
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true) \g /dev/null
SET LOCAL ROLE anon;
INSERT INTO results SELECT 'anon', c.n,
  (SELECT array_agg(o ORDER BY ord) FROM (SELECT o, row_number() over () ord FROM get_ranked_events_old(c.lat,c.lng,c.rad,c.cats,c.sd,c.ed,c.q,c.lim,c.off) o) x)
  IS NOT DISTINCT FROM
  (SELECT array_agg(o ORDER BY ord) FROM (SELECT o, row_number() over () ord FROM get_ranked_events(c.lat,c.lng,c.rad,c.cats,c.sd,c.ed,c.q,c.lim,c.off) o) x),
  (SELECT count(*) FROM get_ranked_events_old(c.lat,c.lng,c.rad,c.cats,c.sd,c.ed,c.q,c.lim,c.off)),
  (SELECT count(*) FROM get_ranked_events(c.lat,c.lng,c.rad,c.cats,c.sd,c.ed,c.q,c.lim,c.off))
FROM cases c;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'uid', true), set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, true) \g /dev/null
SET LOCAL ROLE authenticated;
INSERT INTO results SELECT 'user', c.n,
  (SELECT array_agg(o ORDER BY ord) FROM (SELECT o, row_number() over () ord FROM get_ranked_events_old(c.lat,c.lng,c.rad,c.cats,c.sd,c.ed,c.q,c.lim,c.off) o) x)
  IS NOT DISTINCT FROM
  (SELECT array_agg(o ORDER BY ord) FROM (SELECT o, row_number() over () ord FROM get_ranked_events(c.lat,c.lng,c.rad,c.cats,c.sd,c.ed,c.q,c.lim,c.off) o) x),
  (SELECT count(*) FROM get_ranked_events_old(c.lat,c.lng,c.rad,c.cats,c.sd,c.ed,c.q,c.lim,c.off)),
  (SELECT count(*) FROM get_ranked_events(c.lat,c.lng,c.rad,c.cats,c.sd,c.ed,c.q,c.lim,c.off))
FROM cases c;
-- user_rsvp / user_saved actually populated somewhere?
SELECT 'user flags exercised' AS check, count(*) FILTER (WHERE user_rsvp IS NOT NULL) rsvp_rows, count(*) FILTER (WHERE user_saved) saved_rows
FROM get_ranked_events(37.7749,-122.4194, 50, NULL, NULL, NULL, NULL, 200, 0);
RESET ROLE;
SELECT who, count(*) cases, count(*) FILTER (WHERE same) identical, string_agg(n::text || '(' || rows_old || '/' || rows_new || ')', ' ' ORDER BY n) FILTER (WHERE NOT same) mismatches, sum(rows_old) total_rows FROM results GROUP BY who;
ROLLBACK;
