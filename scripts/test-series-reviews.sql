-- HOW TO RUN (rule since 2026-11-14): in a throwaway container on the stack's
-- own Postgres 17 image, never against the shared cluster —
--
--   PG17_NAME=<unique> scripts/pg17-isolated.sh init
--   PG17_NAME=<unique> scripts/pg17-isolated.sh apply supabase/prepared/2026-11-19_series_reviews/20261119100000_submit_review_rpc.sql
--   PG17_NAME=<unique> scripts/pg17-isolated.sh apply supabase/prepared/2026-11-19_series_reviews/20261119110000_series_reviews.sql
--   PG17_NAME=<unique> scripts/pg17-isolated.sh apply scripts/test-series-reviews.sql
--
-- D2 (EJ-9): reviews per recurring series, and the submit_review() seam that
-- lets the reviews schema change without breaking the deployed client.
-- Blocks skip with a NOTICE when their migration is not applied, so this
-- passes on a database with neither, one, or both. NOTE for editors: block
-- [1] must not mention reviews.event_id — step 1 can be applied for a while
-- before step 2, and that intermediate state is a supported deployment.
--
-- One transaction, rolled back; every check is an ASSERT. Impersonation is by
-- JWT claims; SET ROLE is never used (the segfault rule, docs/ISSUES.md), so
-- the RLS POLICY wiring is asserted on the catalog and the rules it calls are
-- asserted directly. The policy was exercised for real against a restricted
-- role during validation — see the folder README.
BEGIN;
SET LOCAL client_min_messages = notice;

UPDATE businesses SET host_terms_version = host_terms_current_version(),
                      host_terms_accepted_at = COALESCE(host_terms_accepted_at, now());

CREATE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.su() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '', true) $$;
CREATE FUNCTION pg_temp.has_fn(n text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = n) $$;
CREATE FUNCTION pg_temp.has_col(t text, c text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = t AND column_name = c) $$;
CREATE FUNCTION pg_temp.err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

CREATE TEMP TABLE ctx AS
SELECT e.business_id AS biz, e.category_id AS cat, b.owner_id AS host,
       '10000000-0000-4000-8000-000000000002'::uuid AS alex,
       '10000000-0000-4000-8000-000000000003'::uuid AS sam
  FROM events e JOIN businesses b ON b.id = e.business_id
 WHERE e.id = '30000000-0000-4000-8000-000000000001';

-- Events are created in the future (so people can join), then moved — the
-- lifecycle-harness technique (scripts/test-lifecycle.sql).
CREATE FUNCTION pg_temp.mk(id uuid, recurring boolean) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO events (id, business_id, title, description, category_id, start_datetime, end_datetime,
                      lat, lng, address, status, publish_state, visibility, is_recurring, recurrence_pattern, timezone)
  SELECT id, c.biz, 'review fixture', 'x', c.cat,
         date_trunc('minute', now()) + interval '2 days', date_trunc('minute', now()) + interval '2 days 2 hours',
         1, 1, 'x', 'active', 'published', 'public', recurring,
         CASE WHEN recurring THEN '{"frequency":"weekly","interval":1}'::jsonb END, 'UTC'
    FROM ctx c
  RETURNING id $$;
CREATE FUNCTION pg_temp.move(ev uuid, new_start timestamptz, pattern jsonb DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_dur interval;
BEGIN
  SELECT end_datetime - start_datetime INTO v_dur FROM events WHERE id = ev;
  PERFORM set_config('eventmap.allow_reschedule', 'true', true);
  PERFORM set_config('eventmap.skip_update_notice', 'true', true);
  UPDATE events SET start_datetime = new_start, end_datetime = new_start + v_dur,
                    recurrence_pattern = COALESCE(pattern, recurrence_pattern) WHERE id = ev;
  PERFORM set_config('eventmap.allow_reschedule', '', true);
  PERFORM set_config('eventmap.skip_update_notice', '', true);
END $$;

-- ---------------------------------------------------------------------------
-- [1] Step 1 (20261119100000): submit_review() behaves like the upsert it
--     replaces — one row per person per venue, created then updated.
-- ---------------------------------------------------------------------------
DO $$
DECLARE c ctx%ROWTYPE; ev uuid := '9e1f0000-0000-4000-8000-00000000c001'; id1 uuid; id2 uuid; n int;
BEGIN
  IF NOT pg_temp.has_fn('submit_review') THEN
    RAISE NOTICE '[1] skipped: 20261119100000 not applied'; RETURN;
  END IF;
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.mk(ev, false);
  INSERT INTO rsvps (event_id, user_id, status) VALUES (ev, c.alex, 'going');
  PERFORM pg_temp.move(ev, now() - interval '5 hours');
  DELETE FROM reviews WHERE business_id = c.biz AND user_id IN (c.alex, c.sam);

  -- By oid: the signature gains p_event_id in step 2.
  ASSERT (SELECT bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
            FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'submit_review'),
    '[1.1] authenticated may submit';
  ASSERT (SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
            FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'submit_review'),
    '[1.2] anon may not';

  PERFORM pg_temp.as_user(c.alex);
  id1 := submit_review(c.biz, 5, '  loved it  ');
  SELECT count(*) INTO n FROM reviews WHERE user_id = c.alex AND business_id = c.biz;
  ASSERT n = 1, '[1.3] one venue review created, got ' || n;
  ASSERT (SELECT text FROM reviews WHERE id = id1) = 'loved it', '[1.4] the text is trimmed';
  id2 := submit_review(c.biz, 3, NULL);
  ASSERT id1 = id2, '[1.5] submitting again updates the same row';
  SELECT count(*) INTO n FROM reviews WHERE user_id = c.alex AND business_id = c.biz;
  ASSERT n = 1 AND (SELECT rating FROM reviews WHERE id = id1) = 3,
    '[1.6] still one row, now rated 3';
  ASSERT pg_temp.err(format('SELECT submit_review(%L, 9)', c.biz)) LIKE '%rating must be 1 to 5%',
    '[1.7] a rating outside 1-5 is refused';
  PERFORM pg_temp.su();
  ASSERT pg_temp.err(format('SELECT submit_review(%L, 4)', c.biz)) LIKE '%not_authenticated%',
    '[1.8] signed out is refused';
END $$;

-- ---------------------------------------------------------------------------
-- [2] Step 2 (20261119110000): a series gets reviews of its own, they count
--     toward the venue average, and the scopes cannot be mixed up.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c ctx%ROWTYPE;
  srs uuid := '9e1f0000-0000-4000-8000-00000000c002';   -- finished series
  one uuid := '9e1f0000-0000-4000-8000-00000000c003';   -- finished one-off
  rid uuid; n int; venue_avg numeric; series_avg numeric;
BEGIN
  IF NOT pg_temp.has_col('reviews', 'event_id') THEN
    RAISE NOTICE '[2] skipped: 20261119110000 not applied'; RETURN;
  END IF;
  SELECT * INTO c FROM ctx;
  PERFORM pg_temp.mk(srs, true);
  PERFORM pg_temp.mk(one, false);
  INSERT INTO rsvps (event_id, user_id, status)
  VALUES (srs, c.alex, 'going'), (one, c.alex, 'going');
  -- The series ran weekly for seven weeks and finished a week ago.
  PERFORM pg_temp.move(srs, now() - interval '56 days',
    jsonb_build_object('frequency','weekly','interval',1,
      'endDate', to_char((now() - interval '7 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD')));
  PERFORM pg_temp.move(one, now() - interval '5 hours');
  DELETE FROM reviews WHERE business_id = c.biz;

  -- The unique indexes replaced the old constraint.
  ASSERT NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_user_id_business_id_key'),
    '[2.1] the plain (user, business) constraint is gone';
  SELECT count(*) INTO n FROM pg_indexes WHERE tablename = 'reviews'
   AND indexname IN ('reviews_user_venue_key', 'reviews_user_series_key');
  ASSERT n = 2, '[2.2] both partial unique indexes exist, got ' || n;

  -- Eligibility is per series, and only for series.
  PERFORM pg_temp.as_user(c.alex);
  ASSERT user_can_review_event(srs), '[2.3] someone who attended sessions may review the series';
  ASSERT NOT user_can_review_event(one), '[2.4] a one-off is reviewed through its venue, not on its own';
  PERFORM pg_temp.as_user(c.sam);
  ASSERT NOT user_can_review_event(srs), '[2.5] someone who never came may not';
  PERFORM pg_temp.as_user(c.host);
  ASSERT NOT user_can_review_event(srs), '[2.6] the host may not review their own series';

  -- A finished series is hidden from attendees by the events SELECT policy;
  -- the venue lookup must still resolve (it is SECURITY DEFINER for this).
  ASSERT review_event_venue(srs) = c.biz, '[2.7] a finished series still resolves to its venue';
  ASSERT review_event_venue(one) IS NULL, '[2.8] one-offs are not series-reviewable';

  PERFORM pg_temp.as_user(c.alex);
  PERFORM submit_review(c.biz, 3, 'the venue itself');
  rid := submit_review(c.biz, 5, 'the class was great', srs);
  SELECT count(*) INTO n FROM reviews WHERE user_id = c.alex AND business_id = c.biz;
  ASSERT n = 2, '[2.9] a venue review and a series review coexist, got ' || n;
  ASSERT (SELECT business_id FROM reviews WHERE id = rid) = c.biz,
    '[2.10] the series review is filed under the series own venue';
  ASSERT submit_review(c.biz, 4, 'still good', srs) = rid,
    '[2.11] reviewing the series again updates that row';

  -- The decision: series reviews count toward the venue average.
  SELECT average INTO venue_avg FROM get_business_review_summary(c.biz);
  SELECT average INTO series_avg FROM get_event_review_summary(srs);
  ASSERT venue_avg = 3.5, '[2.12] venue average counts both (3 and 4), got ' || venue_avg;
  ASSERT series_avg = 4.0, '[2.13] the series has its own average, got ' || series_avg;

  -- Scope cannot be edited afterwards, and a second series review is refused.
  ASSERT pg_temp.err(format('UPDATE reviews SET event_id = %L WHERE id = (SELECT id FROM reviews WHERE user_id = %L AND event_id IS NULL)', srs, c.alex))
    LIKE '%cannot be moved%', '[2.14] a venue review cannot become a series review';
  ASSERT pg_temp.err(format('INSERT INTO reviews (user_id, business_id, event_id, rating) VALUES (%L, %L, %L, 5)', c.alex, c.biz, srs))
    LIKE '%duplicate key%', '[2.15] one series review per person';
  PERFORM pg_temp.su();

  -- The INSERT policy carries both rules (asserted on the catalog; exercising
  -- it needs a restricted role, which the folder README covers).
  ASSERT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.reviews'::regclass AND polcmd = 'a'
       AND pg_get_expr(polwithcheck, polrelid) LIKE '%user_can_review_event%'
       AND pg_get_expr(polwithcheck, polrelid) LIKE '%review_event_venue%'),
    '[2.16] the INSERT policy gates series reviews on eligibility and the venue';
END $$;

ROLLBACK;
