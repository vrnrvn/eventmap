\set QUIET on
\timing off
SELECT id AS uid FROM profiles ORDER BY id LIMIT 1 \gset
SELECT set_config('request.jwt.claim.sub', :'uid', false), set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, false);
SET ROLE authenticated;
-- warm
SELECT count(*) FROM get_ranked_events(37.7749, -122.4194);
\timing on
\echo '--- SF 50km page 1'
SELECT count(*) FROM get_ranked_events(37.7749, -122.4194);
SELECT count(*) FROM get_ranked_events(37.7749, -122.4194);
\echo '--- SF 50km page 3 (offset 200)'
SELECT count(*) FROM get_ranked_events(37.7749, -122.4194, 50, NULL, NULL, NULL, NULL, 100, 200);
\echo '--- SF 10km'
SELECT count(*) FROM get_ranked_events(37.7749, -122.4194, 10);
\echo '--- SF 50km search jazz'
SELECT count(*) FROM get_ranked_events(37.7749, -122.4194, 50, NULL, NULL, NULL, 'jazz');
\echo '--- Kansas 50km (sparse)'
SELECT count(*) FROM get_ranked_events(38.5, -98.0);
\echo '--- Kansas 200km'
SELECT count(*) FROM get_ranked_events(38.5, -98.0, 200);
\timing off
RESET ROLE;
\echo '--- result fingerprint (top 100 ids, SF 50km) and page-3 fingerprint'
SET ROLE authenticated;
SELECT md5(string_agg(id::text || ':' || rsvp_count || ':' || save_count || ':' || coalesce(user_rsvp,'-') || ':' || user_saved, ',' ORDER BY ord)) FROM (SELECT *, row_number() over () ord FROM get_ranked_events(37.7749, -122.4194)) t;
SELECT md5(string_agg(id::text, ',' ORDER BY ord)) FROM (SELECT *, row_number() over () ord FROM get_ranked_events(37.7749, -122.4194, 50, NULL, NULL, NULL, NULL, 100, 200)) t;
SELECT md5(string_agg(id::text, ',' ORDER BY ord)) FROM (SELECT *, row_number() over () ord FROM get_ranked_events(37.7749, -122.4194, 50, NULL, NULL, NULL, 'jazz')) t;
SELECT md5(string_agg(id::text, ',' ORDER BY ord)) FROM (SELECT *, row_number() over () ord FROM get_ranked_events(38.5, -98.0, 200)) t;
