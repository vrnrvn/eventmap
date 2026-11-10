-- Regenerates tests/fixtures/recurrenceParity.json: the server's
-- event_next_occurrence (5-arg form with an explicit "now") for a set of
-- pattern shapes × "now" instants, all in UTC. Run ONLY against a scratch
-- database, never the shared one:
--   SCRATCH_DB=eventmap_scratch_<you> scripts/db-scratch.sh psql -At -f - \
--     < scripts/recurrence-parity.sql > tests/fixtures/recurrenceParity.json
WITH cases(name, start_at, pattern) AS (VALUES
  ('daily-3',            '2026-11-03 19:00+00'::timestamptz, '{"frequency":"daily","interval":3}'::jsonb),
  ('weekly-1',           '2026-11-03 19:00+00', '{"frequency":"weekly","interval":1}'),
  ('weekly-2',           '2026-11-03 19:00+00', '{"frequency":"weekly","interval":2}'),
  ('weekly-tue-thu',     '2026-11-03 19:00+00', '{"frequency":"weekly","interval":1,"byWeekday":[2,4]}'),
  ('biweekly-tue-thu',   '2026-11-03 19:00+00', '{"frequency":"weekly","interval":2,"byWeekday":[2,4]}'),
  ('weekdays-from-sat',  '2026-11-07 07:00+00', '{"frequency":"weekly","interval":1,"byWeekday":[1,2,3,4,5]}'),
  ('biweekly-weekend',   '2026-11-07 10:00+00', '{"frequency":"weekly","interval":2,"byWeekday":[0,6]}'),
  ('triweekly-sun-wed',  '2026-11-04 10:00+00', '{"frequency":"weekly","interval":3,"byWeekday":[0,3]}'),
  ('monthly-31',         '2027-01-31 10:00+00', '{"frequency":"monthly","interval":1}'),
  ('bimonthly-day',      '2026-11-15 10:00+00', '{"frequency":"monthly","interval":2}'),
  ('monthly-2nd-tue',    '2026-11-10 19:00+00', '{"frequency":"monthly","interval":1,"monthly":"nthWeekday"}'),
  ('monthly-last-fri',   '2026-11-27 20:00+00', '{"frequency":"monthly","interval":1,"monthly":"nthWeekday"}'),
  ('quarterly-1st-mon',  '2026-11-02 18:00+00', '{"frequency":"monthly","interval":3,"monthly":"nthWeekday"}'),
  ('monthly-5th-is-last','2026-11-30 19:00+00', '{"frequency":"monthly","interval":1,"monthly":"nthWeekday"}')
),
nows(at) AS (
  SELECT '2026-11-01 00:00+00'::timestamptz + n * interval '11 days 5 hours' FROM generate_series(0, 39) n
)
SELECT jsonb_pretty(jsonb_agg(jsonb_build_object(
  'name', name,
  'start', to_char(start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'pattern', pattern,
  'next', (SELECT jsonb_agg(jsonb_build_array(
              to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
              to_char(event_next_occurrence(start_at, true, pattern, 'UTC', at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
            ORDER BY at) FROM nows)
) ORDER BY name))
FROM cases;
