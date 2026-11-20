-- Regenerates tests/fixtures/liveParity.json: the server's
-- event_occurrence_in_progress (prepared, 2026-11-20_live_events) for a set
-- of series shapes × probe instants, so tests/liveParity.test.ts can hold the
-- client's occurrenceInProgress / isEventInProgress to the same answers.
--
-- Run ONLY in a throwaway PG17 container (unique name; a sibling session
-- shares this Docker host), with the prepared file applied first:
--   PG17_NAME=<unique> scripts/pg17-isolated.sh init
--   PG17_NAME=<unique> scripts/pg17-isolated.sh apply supabase/prepared/2026-11-20_live_events/20261120100000_get_live_events.sql
--   docker exec -i -e PGPASSWORD=postgres <unique> psql -U postgres -d eventmap -Atq \
--     -f /dev/stdin < scripts/live-parity.sql > tests/fixtures/liveParity.json
BEGIN;

UPDATE businesses SET host_terms_version = host_terms_current_version(),
                      host_terms_accepted_at = COALESCE(host_terms_accepted_at, now());

CREATE TEMP TABLE cases (
  name text PRIMARY KEY,
  start_at timestamptz,
  dur interval,
  tz text,
  recurring boolean DEFAULT true,
  pattern jsonb,
  exceptions jsonb DEFAULT '[]',   -- [{date, kind, new_start, new_end}]
  nows jsonb                       -- probe instants, ISO
);

INSERT INTO cases (name, start_at, dur, tz, recurring, pattern, exceptions, nows) VALUES
-- One-off: inside / at start / at end / before.
('oneoff', '2026-12-01 19:00+00', '2 hours', 'UTC', false, NULL, '[]',
 '["2026-12-01T18:59:00Z","2026-12-01T19:00:00Z","2026-12-01T20:30:00Z","2026-12-01T21:00:00Z"]'),
-- Weekly: mid-session weeks later, between sessions, session edges.
('weekly-1', '2026-11-03 19:00+00', '2 hours', 'UTC', true, '{"frequency":"weekly","interval":1}', '[]',
 '["2026-11-17T19:30:00Z","2026-11-18T19:30:00Z","2026-11-17T19:00:00Z","2026-11-17T21:00:00Z","2026-11-17T20:59:59Z"]'),
-- Daily with a multi-weekday shape.
('weekly-tue-thu', '2026-11-03 19:00+00', '90 minutes', 'UTC', true, '{"frequency":"weekly","interval":1,"byWeekday":[2,4]}', '[]',
 '["2026-11-05T20:00:00Z","2026-11-06T20:00:00Z","2026-11-10T19:10:00Z"]'),
-- Month-end clamp: Jan 31 series, February session on the clamped day.
('monthly-31', '2027-01-31 10:00+00', '3 hours', 'UTC', true, '{"frequency":"monthly","interval":1}', '[]',
 '["2027-02-28T11:00:00Z","2027-02-27T11:00:00Z","2027-03-31T10:00:00Z"]'),
-- endDate: the last session still runs; after it nothing does.
('with-enddate', '2026-11-02 18:00+00', '1 hour', 'UTC', true, '{"frequency":"weekly","interval":1,"endDate":"2026-11-16"}', '[]',
 '["2026-11-16T18:30:00Z","2026-11-23T18:30:00Z"]'),
-- A cancelled date is not running; the next one is.
('cancelled-date', '2026-11-04 12:00+00', '2 hours', 'UTC', true, '{"frequency":"weekly","interval":1}',
 '[{"date":"2026-11-18","kind":"cancelled"}]',
 '["2026-11-18T13:00:00Z","2026-11-25T13:00:00Z"]'),
-- A moved date runs at the NEW time only (even on another day).
('moved-date', '2026-11-04 12:00+00', '2 hours', 'UTC', true, '{"frequency":"weekly","interval":1}',
 '[{"date":"2026-11-18","kind":"rescheduled","new_start":"2026-11-20T15:00:00Z","new_end":"2026-11-20T17:00:00Z"}]',
 '["2026-11-18T13:00:00Z","2026-11-20T16:00:00Z","2026-11-20T14:59:00Z"]'),
-- Overnight session: still running past local midnight.
('overnight', '2026-11-03 22:00+00', '4 hours', 'UTC', true, '{"frequency":"daily","interval":1}', '[]',
 '["2026-11-10T01:30:00Z","2026-11-10T02:00:00Z"]'),
-- Event zone with DST: 19:00 America/New_York stays 19:00 across the change.
('ny-dst', '2026-10-27 23:00+00', '2 hours', 'America/New_York', true, '{"frequency":"weekly","interval":1}', '[]',
 '["2026-11-04T00:30:00Z","2026-11-03T23:30:00Z","2026-10-28T00:30:00Z"]');

-- Fixture events (ids derived from the case name), via the same direct-insert
-- technique as scripts/test-series-reviews.sql.
CREATE TEMP TABLE made AS
SELECT c.name,
       (overlay(overlay(md5(c.name)::uuid::text placing '4' from 15) placing '8' from 20))::uuid AS id
  FROM cases c;

DO $$ BEGIN PERFORM set_config('eventmap.allow_reschedule', 'true', true); END $$;
INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime,
                    lat, lng, address, status, publish_state, visibility, is_recurring, recurrence_pattern, timezone)
SELECT m.id, e.business_id, 'live parity ' || c.name, 'x', e.category_id,
       c.start_at, c.start_at + c.dur, 1, 1, 'x', 'active', 'published', 'public',
       c.recurring, c.pattern, c.tz
  FROM cases c JOIN made m ON m.name = c.name
  CROSS JOIN (SELECT business_id, category_id FROM events WHERE id = '30000000-0000-4000-8000-000000000001') e;

INSERT INTO event_occurrence_exceptions (event_id, occurrence_date, kind, new_start, new_end, note)
SELECT m.id, (x->>'date')::date, x->>'kind',
       NULLIF(x->>'new_start', '')::timestamptz, NULLIF(x->>'new_end', '')::timestamptz, NULL
  FROM cases c JOIN made m ON m.name = c.name
  CROSS JOIN jsonb_array_elements(c.exceptions) x;

SELECT json_agg(row_to_json(t) ORDER BY t.name, t.at)::text FROM (
  SELECT c.name, c.start_at AS start, (c.start_at + c.dur) AS "end", c.tz,
         c.recurring, c.pattern, c.exceptions, n.at,
         o.o_start AS running_start, o.o_end AS running_end
    FROM cases c
    JOIN made m ON m.name = c.name
    CROSS JOIN LATERAL (SELECT (jsonb_array_elements_text(c.nows))::timestamptz AS at) n
    LEFT JOIN LATERAL event_occurrence_in_progress(m.id, n.at) o ON true
) t;

ROLLBACK;
