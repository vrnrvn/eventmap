-- Regenerates tests/fixtures/recurrenceParity.json: the server's
-- event_next_occurrence (5-arg form with an explicit "now") for a set of
-- pattern shapes × "now" instants, all in UTC, plus each shape's FIRST FIVE
-- dates (chained: next at start, then next a second after each answer).
-- Run ONLY against a scratch database or a throwaway container, never the
-- shared one:
--   SCRATCH_DB=eventmap_scratch_<you> scripts/db-scratch.sh psql -At -f - \
--     < scripts/recurrence-parity.sql > tests/fixtures/recurrenceParity.json
-- or, in a throwaway PG17 container (unique name; a sibling session shares
-- this Docker host):
--   PG17_NAME=<unique> scripts/pg17-isolated.sh init
--   docker cp scripts/recurrence-parity.sql <unique>:/tmp/parity.sql
--   docker exec -i -e PGPASSWORD=postgres <unique> psql -U postgres -d eventmap -At -f /tmp/parity.sql > tests/fixtures/recurrenceParity.json
--
-- Widened 2026-11-18 (2b-3): first-5 dates per shape; long-interval
-- (nthWeekday every 36 months, Saturday every 99 weeks), a far-future v2
-- start, a leap-day month-end shape; and "now" instants inside the S1 drift
-- window (the hours between a short month's clamped occurrence and that
-- month's end), which the original 11-day grid happened to dodge.
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
  ('monthly-5th-is-last','2026-11-30 19:00+00', '{"frequency":"monthly","interval":1,"monthly":"nthWeekday"}'),
  -- 2b-3 additions.
  ('nthweekday-36mo',    '2026-11-10 19:00+00', '{"frequency":"monthly","interval":36,"monthly":"nthWeekday"}'),
  ('weekly-sat-99',      '2026-11-07 10:00+00', '{"frequency":"weekly","interval":99,"byWeekday":[6]}'),
  ('far-future-weekdays','2029-06-02 07:00+00', '{"frequency":"weekly","interval":1,"byWeekday":[1,2,3,4,5]}'),
  ('monthly-29-leap',    '2028-01-29 12:00+00', '{"frequency":"monthly","interval":1}')
),
nows(at) AS (
  SELECT '2026-11-01 00:00+00'::timestamptz + n * interval '11 days 5 hours' FROM generate_series(0, 39) n
  UNION ALL
  -- S1 drift-window instants: after monthly-31's clamped 28 Feb 10:00
  -- occurrence but before March; the leap edition for monthly-29-leap; and a
  -- same-day instant just before the 31 Mar occurrence.
  SELECT unnest(ARRAY['2027-02-28 22:00+00'::timestamptz,
                      '2027-03-31 09:00+00',
                      '2028-02-29 18:00+00'])
)
SELECT jsonb_pretty(jsonb_agg(jsonb_build_object(
  'name', name,
  'start', to_char(start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'pattern', pattern,
  'first', (WITH RECURSIVE seq(i, d) AS (
              SELECT 0, event_next_occurrence(start_at, true, pattern, 'UTC', start_at)
              UNION ALL
              SELECT i + 1, event_next_occurrence(start_at, true, pattern, 'UTC', d + interval '1 second')
                FROM seq WHERE i < 4
            )
            SELECT jsonb_agg(to_char(d AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ORDER BY i) FROM seq),
  'next', (SELECT jsonb_agg(jsonb_build_array(
              to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
              to_char(event_next_occurrence(start_at, true, pattern, 'UTC', at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
            ORDER BY at) FROM nows)
) ORDER BY name))
FROM cases;
