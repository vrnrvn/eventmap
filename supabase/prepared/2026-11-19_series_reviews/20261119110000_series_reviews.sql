-- D2 step 2 of 3 — reviews per recurring series (EJ-9).
--
-- STATUS: PREPARED, NOT APPLIED. **Do NOT apply this until the client release
-- that submits reviews through submit_review() is live** (step 1,
-- 20261119100000). This file replaces the plain UNIQUE (user_id, business_id)
-- with two PARTIAL unique indexes, and PostgREST's
-- `upsert(..., { onConflict: 'user_id,business_id' })` cannot name a partial
-- index as its arbiter — the old client path would start failing here. See
-- this folder's README for the three-step order.
--
-- Owner decisions (2026-11-18): a recurring series gets reviews of its own,
-- and those reviews DO count toward the venue's overall rating. One-off
-- events keep reviewing the venue, exactly as today.
--
-- What changes:
--   1. reviews.event_id (nullable). NULL = a review of the venue, as today.
--      Set = a review of that recurring series.
--   2. Two partial unique indexes replace the old constraint: one review per
--      (user, venue) and one per (user, series). A person can hold both.
--   3. user_can_review_event(): eligibility for a series review — attended at
--      least one finished session, reusing user_series_sessions_attended from
--      20261117160000. That also retires EJ-3's series nuance.
--   4. The INSERT policy accepts both kinds and pins a series review's
--      business_id to the event's own venue.
--   5. A new BEFORE UPDATE trigger stops a review being moved between scopes
--      (editing your venue review into a series review would otherwise skip
--      the eligibility check).
--   6. submit_review() gains p_event_id (defaulted), so a client written
--      against step 1's signature keeps working unchanged.
--   7. get_event_review_summary() for the series' own average.
--
-- The venue's overall rating needs NO change: get_business_review_summary
-- (20261106150000) averages by business_id, and a series review carries the
-- venue's business_id — which is exactly the decision that was taken.

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.reviews.event_id IS
  'NULL = a review of the venue (the original behaviour). Set = a review of '
  'that recurring series (D2/EJ-9). business_id stays set either way, so the '
  'venue average includes series reviews.';

-- One review per person per venue, and per person per series.
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_user_id_business_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_user_venue_key
  ON public.reviews (user_id, business_id) WHERE event_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_user_series_key
  ON public.reviews (user_id, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reviews_event_id
  ON public.reviews (event_id) WHERE event_id IS NOT NULL;

-- Eligibility for a series review: a finished session actually attended.
-- SECURITY DEFINER for the same reason user_can_review_business is — the
-- events row may be a past event the viewer's SELECT policy hides.
CREATE OR REPLACE FUNCTION public.user_can_review_event(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM events e JOIN businesses b ON b.id = e.business_id
       WHERE e.id = p_event_id
         AND COALESCE(e.is_recurring, false)          -- series only; one-offs review the venue
         AND b.owner_id IS DISTINCT FROM auth.uid()   -- never your own
    )
    AND user_series_sessions_attended(p_event_id, auth.uid()) > 0;
$function$;
GRANT EXECUTE ON FUNCTION public.user_can_review_event(uuid) TO authenticated;

-- The venue a reviewable series belongs to. SECURITY DEFINER on purpose: a
-- series people want to review has usually ENDED, and the events SELECT
-- policy hides ended events from attendees — reading business_id as the
-- caller returns NULL and the review is refused for the wrong reason
-- (caught in validation). Scoped to published recurring events, so it tells
-- a caller nothing they could not already see about anything else.
CREATE OR REPLACE FUNCTION public.review_event_venue(p_event_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT e.business_id FROM events e
   WHERE e.id = p_event_id
     AND e.publish_state = 'published'
     AND COALESCE(e.is_recurring, false);
$function$;
GRANT EXECUTE ON FUNCTION public.review_event_venue(uuid) TO authenticated;

DROP POLICY IF EXISTS "Attendees can create their own review" ON public.reviews;
CREATE POLICY "Attendees can create their own review"
  ON public.reviews FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND NOT user_is_banned((SELECT auth.uid()))
    AND (
      -- A review of the venue: unchanged rule.
      (event_id IS NULL AND user_can_review_business(business_id))
      -- A review of one series: eligibility is per series, and the venue it
      -- is filed under must be that series' own venue.
      OR (event_id IS NOT NULL
          AND user_can_review_event(event_id)
          AND business_id = review_event_venue(event_id))
    )
  );

-- A review cannot change scope after the fact: editing a venue review into a
-- series review (or vice versa) would sidestep the eligibility checks above.
CREATE OR REPLACE FUNCTION public.guard_review_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'invalid_review: a review cannot be moved to another event or venue';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS a_guard_review_scope ON public.reviews;
CREATE TRIGGER a_guard_review_scope
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.guard_review_scope();

-- submit_review v2. DROP first: adding a defaulted parameter beside the
-- 3-argument version would make duplicate_event's ambiguity mistake. A client
-- calling it with the three named arguments still resolves here.
DROP FUNCTION IF EXISTS public.submit_review(uuid, integer, text);

CREATE OR REPLACE FUNCTION public.submit_review(
  p_business_id uuid,
  p_rating integer,
  p_text text DEFAULT NULL,
  p_event_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_text text := NULLIF(btrim(COALESCE(p_text, '')), '');
  v_business uuid := p_business_id;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'invalid_review: rating must be 1 to 5';
  END IF;

  -- A series review is always filed under that series' own venue; the
  -- caller's business id is not trusted for this.
  IF p_event_id IS NOT NULL THEN
    v_business := review_event_venue(p_event_id);
    IF v_business IS NULL THEN
      -- One-off events are reviewed through their venue, as before; a draft
      -- or unknown id lands here too.
      RAISE EXCEPTION 'invalid_review: only a published recurring series can be reviewed on its own';
    END IF;
  END IF;

  -- Update-then-insert: no ON CONFLICT arbiter is named, so the partial
  -- unique indexes above need no special handling.
  UPDATE reviews
     SET rating = p_rating, text = v_text, updated_at = now()
   WHERE user_id = v_user
     AND ((p_event_id IS NULL AND event_id IS NULL AND business_id = v_business)
       OR (p_event_id IS NOT NULL AND event_id = p_event_id))
   RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    BEGIN
      INSERT INTO reviews (user_id, business_id, event_id, rating, text)
      VALUES (v_user, v_business, p_event_id, p_rating, v_text)
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      UPDATE reviews
         SET rating = p_rating, text = v_text, updated_at = now()
       WHERE user_id = v_user
         AND ((p_event_id IS NULL AND event_id IS NULL AND business_id = v_business)
           OR (p_event_id IS NOT NULL AND event_id = p_event_id))
       RETURNING id INTO v_id;
    END;
  END IF;

  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.submit_review(uuid, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, integer, text, uuid) TO authenticated;

-- The series' own average, mirroring get_business_review_summary's shape and
-- rounding so the client can reuse its formatting.
CREATE OR REPLACE FUNCTION public.get_event_review_summary(p_event_id uuid)
RETURNS TABLE (average numeric, review_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(round(avg(r.rating)::numeric, 1), 0) AS average,
         count(*) AS review_count
  FROM reviews r
  WHERE r.event_id = p_event_id;
$function$;
GRANT EXECUTE ON FUNCTION public.get_event_review_summary(uuid) TO anon, authenticated;
