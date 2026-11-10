-- Recurrence patterns v2 (docs/CATEGORIES_AND_SERIES_PLAN.md §4.2, Phase D).
--
-- NOT applied to the shared local database by the author; validated on an
-- isolated scratch copy only. Independent of the category migrations.
--
-- COMPATIBILITY: the shared database snapshot already contains objects of
-- the same names from another session (a 5-arg event_next_occurrence with
-- p_now, and validate_event_recurrence / trigger c_validate_event_recurrence)
-- that no migration in this worktree defines. This file uses the SAME names,
-- argument lists, pattern keys and week convention, so applying it over
-- them (or them over it) replaces like with like. One deliberate difference
-- is documented in §7 Phase D: for a future start that is not itself an
-- occurrence, this version returns the first real occurrence.
--
-- `events.recurrence_pattern` keys (all optional except frequency/interval):
--   byWeekday int[] 0=Sun..6=Sat   weekly: run on these days; `interval`
--                                  counts Monday-based weeks from the start
--   monthly   'dayOfMonth' | 'nthWeekday'   monthly: same date (default,
--             clamped) or the start's weekday in the start's week of the
--             month — "last" when the start is in the final seven days
-- Mirrors utils/recurrence.ts; tests/recurrenceParity.test.ts holds the two
-- to the same answers.

CREATE OR REPLACE FUNCTION public.event_recurrence_matches(
  p_start_local timestamp,
  p_pattern jsonb,
  p_day date
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_freq text := p_pattern->>'frequency';
  v_step integer := GREATEST(COALESCE(NULLIF(p_pattern->>'interval', '')::integer, 1), 1);
  v_start date := p_start_local::date;
  v_days integer[];
  v_months integer;
  v_dim integer;
  v_start_dim integer;
  v_start_is_last boolean;
BEGIN
  IF p_day < v_start THEN
    RETURN false;
  END IF;

  IF v_freq = 'daily' THEN
    RETURN (p_day - v_start) % v_step = 0;

  ELSIF v_freq = 'weekly' THEN
    IF jsonb_typeof(p_pattern->'byWeekday') = 'array' THEN
      SELECT array_agg(DISTINCT x::integer) INTO v_days
        FROM jsonb_array_elements_text(p_pattern->'byWeekday') x
       WHERE x ~ '^[0-6]$';
    END IF;
    IF v_days IS NULL OR array_length(v_days, 1) IS NULL THEN
      v_days := ARRAY[extract(dow FROM v_start)::integer];
    END IF;
    IF NOT (extract(dow FROM p_day)::integer = ANY (v_days)) THEN
      RETURN false;
    END IF;
    -- Monday of each week: d - ((dow + 6) % 7).
    RETURN (((p_day - ((extract(dow FROM p_day)::integer + 6) % 7))
           - (v_start - ((extract(dow FROM v_start)::integer + 6) % 7))) / 7) % v_step = 0;

  ELSIF v_freq = 'monthly' THEN
    v_months := (extract(year FROM p_day)::integer - extract(year FROM v_start)::integer) * 12
              + (extract(month FROM p_day)::integer - extract(month FROM v_start)::integer);
    IF v_months % v_step <> 0 THEN
      RETURN false;
    END IF;
    v_dim := extract(day FROM (date_trunc('month', p_day) + interval '1 month - 1 day'))::integer;
    IF p_pattern->>'monthly' = 'nthWeekday' THEN
      IF extract(dow FROM p_day) <> extract(dow FROM v_start) THEN
        RETURN false;
      END IF;
      v_start_dim := extract(day FROM (date_trunc('month', v_start) + interval '1 month - 1 day'))::integer;
      v_start_is_last := extract(day FROM v_start)::integer + 7 > v_start_dim;
      IF v_start_is_last THEN
        RETURN extract(day FROM p_day)::integer + 7 > v_dim;
      END IF;
      RETURN ceil(extract(day FROM p_day) / 7.0) = ceil(extract(day FROM v_start) / 7.0);
    END IF;
    RETURN extract(day FROM p_day)::integer = LEAST(extract(day FROM v_start)::integer, v_dim);
  END IF;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$;

-- 5-arg form with an explicit "now" (testable; same signature as the shared
-- snapshot's). The 4-arg form below delegates with now().
CREATE OR REPLACE FUNCTION public.event_next_occurrence(
  p_start_datetime timestamptz,
  p_is_recurring boolean,
  p_recurrence_pattern jsonb,
  p_timezone text,
  p_now timestamptz
)
RETURNS timestamptz
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
  v_v2 boolean;
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

  -- v2 keys: walk calendar days (bounded, ~2 years) with the shared matcher.
  IF v_v2 THEN
    v_day := GREATEST(v_now_local::date, v_start_local::date);
    FOR v_i IN 0..800 LOOP
      IF event_recurrence_matches(v_start_local, p_recurrence_pattern, v_day) THEN
        v_candidate_local := v_day + v_start_local::time;
        IF v_candidate_local >= v_now_local THEN
          RETURN v_candidate_local AT TIME ZONE v_tz;
        END IF;
      END IF;
      v_day := v_day + 1;
    END LOOP;
    RETURN p_start_datetime;
  END IF;

  -- Original arithmetic path (unchanged from 20261103140000, now() → p_now).
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
    v_candidate_local := v_start_local + (v_months * interval '1 month');
    WHILE v_candidate_local < v_now_local LOOP
      v_candidate_local := v_candidate_local + (v_step * interval '1 month');
    END LOOP;
    RETURN v_candidate_local AT TIME ZONE v_tz;
  END IF;

  RETURN p_start_datetime;
EXCEPTION WHEN OTHERS THEN
  RETURN p_start_datetime;
END;
$function$;

CREATE OR REPLACE FUNCTION public.event_next_occurrence(
  p_start_datetime timestamptz,
  p_is_recurring boolean,
  p_recurrence_pattern jsonb,
  p_timezone text
)
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $function$
  SELECT public.event_next_occurrence(p_start_datetime, p_is_recurring, p_recurrence_pattern, p_timezone, now());
$function$;

-- Validation (same name, trigger and rules as the shared snapshot's).
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
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS c_validate_event_recurrence ON public.events;
CREATE TRIGGER c_validate_event_recurrence
  BEFORE INSERT OR UPDATE OF recurrence_pattern, is_recurring ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.validate_event_recurrence();
