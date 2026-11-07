-- Synthetic perf fixture for the ISOLATED container only.
SET session_replication_role = replica;  -- skip user triggers (notifications etc.) during bulk load
SELECT setseed(0.42);
INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data, created_at, updated_at)
SELECT gen_random_uuid(), 'u'||g||'@perf.test', 'authenticated', 'authenticated', jsonb_build_object('name','User '||g), now(), now()
FROM generate_series(1, 20000) g;
INSERT INTO public.profiles (id, name)
SELECT id, raw_user_meta_data->>'name' FROM auth.users ON CONFLICT DO NOTHING;
-- Metros: SF, NYC, LA, Chicago, Austin
CREATE TEMP TABLE metro(lat float8, lng float8, w int);
INSERT INTO metro VALUES (37.7749,-122.4194,30),(40.7128,-74.0060,30),(34.0522,-118.2437,20),(41.8781,-87.6298,10),(30.2672,-97.7431,10);
INSERT INTO public.businesses (owner_id, name, category, address, lat, lng, subscription_tier)
SELECT p.id, 'Biz '||row_number() over (), 'music', 'addr', 37, -122, CASE WHEN random() < 0.1 THEN 'premium' ELSE 'free' END
FROM (SELECT id FROM profiles ORDER BY id LIMIT 3000) p;
CREATE TEMP TABLE biz AS SELECT id, row_number() over () rn FROM businesses;
CREATE TEMP TABLE cat AS SELECT id, row_number() over () rn FROM categories;
INSERT INTO public.events (business_id, title, description, category_id, start_datetime, end_datetime, lat, lng, address,
                           is_recurring, recurrence_pattern, status, timezone)
SELECT b.id, 'Event '||g||' '||(ARRAY['jazz','yoga','market','comedy','run','food'])[1+(g%6)],
       repeat('Lorem ipsum dolor sit amet. ', 20),
       c.id, st, st + interval '3 hours', loc.lat, loc.lng, 'somewhere',
       rec, CASE WHEN rec THEN jsonb_build_object('frequency','weekly','interval',1,'daysOfWeek',jsonb_build_array(1+(g%6)),
                 'endDate', to_char(now() + ((g%90)-20) * interval '1 day','YYYY-MM-DD')) END,
       CASE WHEN g % 40 = 0 THEN 'cancelled' ELSE 'active' END, 'America/Los_Angeles'
FROM generate_series(1, 120000) g
CROSS JOIN LATERAL (SELECT now() + ((random()*120 - 60) * interval '1 day') AS st, (g % 10 = 0) AS rec) t
CROSS JOIN LATERAL (
  SELECT CASE WHEN g % 10 < 8 THEN
           (SELECT m.lat + (random()-0.5)*0.8 FROM metro m ORDER BY m.w * random() DESC, g LIMIT 1)
         ELSE 25 + random()*24 END AS lat0
) l0
CROSS JOIN LATERAL (
  SELECT CASE WHEN g % 10 < 8 THEN (SELECT m.lat FROM metro m ORDER BY abs(m.lat - l0.lat0) LIMIT 1) + (random()-0.5)*0.8 ELSE l0.lat0 END AS lat,
         CASE WHEN g % 10 < 8 THEN (SELECT m.lng FROM metro m ORDER BY abs(m.lat - l0.lat0) LIMIT 1) + (random()-0.5)*1.0 ELSE -124 + random()*57 END AS lng
) loc
JOIN biz b ON b.rn = 1 + (g % 3000)
JOIN cat c ON c.rn = 1 + (g % 10);
-- RSVPs: ~400k, skewed
INSERT INTO public.rsvps (user_id, event_id, status)
SELECT DISTINCT ON (u.id, e.id) u.id, e.id, CASE WHEN random() < 0.8 THEN 'going' ELSE 'interested' END
FROM (SELECT id, row_number() over () rn FROM events) e
JOIN LATERAL (SELECT id FROM profiles OFFSET floor(random()*19900)::int LIMIT (1 + (e.rn % 7))::int) u ON true
ON CONFLICT DO NOTHING;
INSERT INTO public.saves (user_id, event_id)
SELECT DISTINCT ON (u.id, e.id) u.id, e.id
FROM (SELECT id, row_number() over () rn FROM events WHERE random() < 0.5) e
JOIN LATERAL (SELECT id FROM profiles OFFSET floor(random()*19900)::int LIMIT (1 + (e.rn % 3))::int) u ON true
ON CONFLICT DO NOTHING;
INSERT INTO event_rsvp_counts (event_id, going_count, interested_count)
SELECT event_id, COUNT(*) FILTER (WHERE status='going'), COUNT(*) FILTER (WHERE status='interested') FROM rsvps GROUP BY event_id
ON CONFLICT (event_id) DO UPDATE SET going_count = EXCLUDED.going_count, interested_count = EXCLUDED.interested_count;
SET session_replication_role = origin;
ANALYZE;
SELECT (SELECT count(*) FROM events) events, (SELECT count(*) FROM rsvps) rsvps, (SELECT count(*) FROM saves) saves,
       (SELECT count(*) FROM events WHERE lat BETWEEN 37.32 AND 38.23 AND lng BETWEEN -122.99 AND -121.85) sf_box;
