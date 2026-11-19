-- Phase 4, migration 2 — recurrence edge fixes S1, S2 and O-5
-- (docs/MIGRATIONS_PENDING.md 2b-4, 2b-5, 2b-6; found in
-- docs/HOST_DASHBOARD_AND_RECURRENCE_REVIEW_2026-11-16.md).
--
-- STATUS: PREPARED, NOT APPLIED. Staged in supabase/prepared/; see this
-- folder's README. Independent of the other phase-4 files.
--
-- S1 (2b-4): the monthly day-of-month walk added "+N months" to an already
--   CLAMPED candidate, so a 29th-31st series named 28 Mar instead of 31 Mar
--   for the hours between a short month's occurrence and that month's end.
--   Each candidate is now computed fresh from the start (start + k months),
--   which is also how the client's occurrenceCandidates does it.
--
-- S2 (2b-5): the v2 walk (byWeekday / nthWeekday) scanned at most 800
--   consecutive DAYS, so a legal monthly nthWeekday series with an interval
--   of 27+ months fell off the cap and returned the series start. It now
--   steps whole PERIODS (weeks / months) exactly like the client's generator,
--   with event_recurrence_matches kept as the single matching rule; the step
--   bound only guards malformed input.
--
-- O-5 (2b-6): validate_event_recurrence only checked endDate's format.
--   Create and Edit refuse an endDate before the first date client-side;
--   this adds the same rule server-side (defence in depth for API writes).
--
-- The 3- and 4-argument wrappers delegate to this 5-argument function and are
-- unchanged. Signature and semantics are otherwise identical: NO type
-- regeneration and NO client change. The client is already correct on S1/S2;
-- tests/fixtures/recurrenceParity.json is regenerated from this definition,
-- so the parity suite proves the two sides agree.

CREATE OR REPLACE FUNCTION public.event_next_occurrence(p_start_datetime timestamp with time zone, p_is_recurring boolean, p_recurrence_pattern jsonb, p_timezone text, p_now timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_tz text := COALESCE(NULLIF(p_timezone, ''), 'UTC');
  v_freq text;
  v_step integer;
  v_start_local timestamp;   -- wall clock in v_tz
  v_now_local timestamp;
  v_elapsed_steps numeric;
  v_candidate_local timestamp;
  v_months integer;
  v_day date;
  v_i integer;
  v_j integer;
  v_v2 boolean;
  v_week0 date;              -- Monday of the start's week (weeks run Mon-Sun)
  v_k integer;               -- whole periods (weeks / months) from the start
  v_first date;              -- first day of a candidate month
BEGIN
  IF NOT COALESCE(p_is_recurring, false) OR p_recurrence_pattern IS NULL THEN
    RETURN p_start_datetime;
  END IF;

  v_freq := p_recurrence_pattern->>'frequency';
  v_step := GREATEST(COALESCE(NULLIF(p_recurrence_pattern->>'interval', '')::integer, 1), 1);
  -- COALESCE: a missing key makes these comparisons NULL, and NULL here
  -- would skip the v1 shortcut below and change results for old rows.
  v_v2 := COALESCE(
            (v_freq = 'weekly' AND jsonb_typeof(p_recurrence_pattern->'byWeekday') = 'array'
               AND jsonb_array_length(p_recurrence_pattern->'byWeekday') > 0)
            OR (v_freq = 'monthly' AND p_recurrence_pattern->>'monthly' = 'nthWeekday'),
          false);

  -- v1: a future start is always the first occurrence. v2: it may not be
  -- (start on a Saturday, series "weekdays"), so walk from the start.
  IF p_start_datetime >= p_now AND NOT v_v2 THEN
    RETURN p_start_datetime;
  END IF;

  -- Step on the wall clock so 19:00 stays 19:00 across DST, then convert back.
  v_start_local := p_start_datetime AT TIME ZONE v_tz;
  v_now_local := p_now AT TIME ZONE v_tz;

  -- v2 keys: walk matching PERIODS with the shared matcher (S2). The old
  -- walk scanned 800 consecutive days, which a 27+-month nthWeekday
  -- interval legally exceeds.
  IF v_v2 THEN
    IF v_freq = 'weekly' THEN
      v_week0 := v_start_local::date - ((EXTRACT(dow FROM v_start_local)::int + 6) % 7);
      v_day := GREATEST(v_now_local::date, v_start_local::date);
      v_k := (((v_day - ((EXTRACT(dow FROM v_day)::int + 6) % 7)) - v_week0) / 7);
      v_k := GREATEST(v_k - (v_k % v_step), 0);   -- floor to the series' week grid
      FOR v_i IN 0..260 LOOP                       -- period steps; 260×99 wk ≈ 495 y
        FOR v_j IN 0..6 LOOP
          v_day := v_week0 + (v_k * 7) + v_j;
          IF v_day >= v_start_local::date
             AND event_recurrence_matches(v_start_local, p_recurrence_pattern, v_day) THEN
            v_candidate_local := v_day + v_start_local::time;
            IF v_candidate_local >= v_now_local THEN
              RETURN v_candidate_local AT TIME ZONE v_tz;
            END IF;
          END IF;
        END LOOP;
        v_k := v_k + v_step;
      END LOOP;
    ELSE  -- monthly, nthWeekday
      v_months := (EXTRACT(year FROM v_now_local)::integer - EXTRACT(year FROM v_start_local)::integer) * 12
                + (EXTRACT(month FROM v_now_local)::integer - EXTRACT(month FROM v_start_local)::integer);
      v_k := GREATEST(v_months, 0);
      v_k := v_k - (v_k % v_step);                 -- floor to the series' month grid
      FOR v_i IN 0..160 LOOP                       -- 160×99 mo ≈ 1,300 y
        v_first := (date_trunc('month', v_start_local)::date + make_interval(months => v_k))::date;
        FOR v_j IN 0..30 LOOP
          v_day := v_first + v_j;
          EXIT WHEN EXTRACT(month FROM v_day) <> EXTRACT(month FROM v_first);
          IF v_day >= v_start_local::date
             AND event_recurrence_matches(v_start_local, p_recurrence_pattern, v_day) THEN
            v_candidate_local := v_day + v_start_local::time;
            IF v_candidate_local >= v_now_local THEN
              RETURN v_candidate_local AT TIME ZONE v_tz;
            END IF;
          END IF;
        END LOOP;
        v_k := v_k + v_step;
      END LOOP;
    END IF;
    RETURN p_start_datetime;
  END IF;

  -- Original arithmetic path (daily / weekly unchanged).
  IF v_freq = 'daily' OR v_freq = 'weekly' THEN
    IF v_freq = 'weekly' THEN
      v_step := v_step * 7;
    END IF;
    v_elapsed_steps := ceil(extract(epoch FROM (v_now_local - v_start_local)) / (86400.0 * v_step));
    v_candidate_local := v_start_local + (v_elapsed_steps * v_step) * interval '1 day';
    WHILE v_candidate_local < v_now_local LOOP
      v_candidate_local := v_candidate_local + v_step * interval '1 day';
    END LOOP;
    RETURN v_candidate_local AT TIME ZONE v_tz;
  ELSIF v_freq = 'monthly' THEN
    v_months := (extract(year FROM v_now_local)::integer - extract(year FROM v_start_local)::integer) * 12
              + (extract(month FROM v_now_local)::integer - extract(month FROM v_start_local)::integer);
    v_months := GREATEST(v_months, 0);
    v_months := v_months - (v_months % v_step);
    -- S1: each candidate is start + k months, computed FRESH — never
    -- "+N months" on an already-clamped candidate, which turned a 31st
    -- series into the 28th after a short month.
    v_candidate_local := v_start_local + make_interval(months => v_months);
    WHILE v_candidate_local < v_now_local LOOP
      v_months := v_months + v_step;
      v_candidate_local := v_start_local + make_interval(months => v_months);
    END LOOP;
    RETURN v_candidate_local AT TIME ZONE v_tz;
  END IF;

  RETURN p_start_datetime;
EXCEPTION WHEN OTHERS THEN
  RETURN p_start_datetime;
END;
$function$;

-- O-5: endDate must not predate the event's first date (defence in depth —
-- Create and Edit already refuse it client-side).
CREATE OR REPLACE FUNCTION public.validate_event_recurrence()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  p jsonb := NEW.recurrence_pattern;
  v_interval numeric;
  v_bad integer;
BEGIN
  IF NOT COALESCE(NEW.is_recurring, false) OR p IS NULL THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'invalid_recurrence: pattern must be an object';
  END IF;
  IF p->>'frequency' IS NULL OR p->>'frequency' NOT IN ('daily', 'weekly', 'monthly') THEN
    RAISE EXCEPTION 'invalid_recurrence: frequency must be daily, weekly or monthly';
  END IF;
  BEGIN
    v_interval := (p->>'interval')::numeric;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_recurrence: interval must be a number';
  END;
  IF v_interval IS NULL OR v_interval <> floor(v_interval) OR v_interval < 1 OR v_interval > 99 THEN
    RAISE EXCEPTION 'invalid_recurrence: interval must be a whole number from 1 to 99';
  END IF;
  IF p ? 'byWeekday' THEN
    IF p->>'frequency' <> 'weekly' THEN
      RAISE EXCEPTION 'invalid_recurrence: byWeekday only applies to weekly patterns';
    END IF;
    IF jsonb_typeof(p->'byWeekday') <> 'array' OR jsonb_array_length(p->'byWeekday') = 0 THEN
      RAISE EXCEPTION 'invalid_recurrence: byWeekday must be a non-empty array';
    END IF;
    SELECT count(*) INTO v_bad FROM jsonb_array_elements_text(p->'byWeekday') t(x) WHERE x !~ '^[0-6]$';
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'invalid_recurrence: byWeekday values must be 0 (Sunday) to 6 (Saturday)';
    END IF;
  END IF;
  IF p ? 'monthly' THEN
    IF p->>'frequency' <> 'monthly' THEN
      RAISE EXCEPTION 'invalid_recurrence: monthly mode only applies to monthly patterns';
    END IF;
    IF p->>'monthly' NOT IN ('dayOfMonth', 'nthWeekday') THEN
      RAISE EXCEPTION 'invalid_recurrence: monthly must be dayOfMonth or nthWeekday';
    END IF;
  END IF;
  IF p ? 'endDate' AND (p->>'endDate') !~ '^\d{4}-\d{2}-\d{2}' THEN
    RAISE EXCEPTION 'invalid_recurrence: endDate must be YYYY-MM-DD';
  END IF;
  -- O-5 (2b-6): a series cannot end before its first date.
  IF p ? 'endDate' AND (p->>'endDate') ~ '^\d{4}-\d{2}-\d{2}' AND NEW.start_datetime IS NOT NULL THEN
    IF left(p->>'endDate', 10)::date
       < (NEW.start_datetime AT TIME ZONE COALESCE(NULLIF(NEW.timezone, ''), 'UTC'))::date THEN
      RAISE EXCEPTION 'invalid_recurrence: endDate is before the event''s first date';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
