-- D2 step 1 of 3 — submit_review(): the seam that lets the reviews schema move.
--
-- STATUS: PREPARED, NOT APPLIED. Staged in supabase/prepared/; see this
-- folder's README for the three-step order. **Apply this one FIRST, and ship
-- the client release that uses it, BEFORE applying step 2.**
--
-- Why this exists (the hazard that deferred D2 in phase 4): the app submits
-- reviews with PostgREST's upsert, `onConflict: 'user_id,business_id'`
-- (services/reviews.ts:40-50). Step 2 replaces that plain UNIQUE constraint
-- with two PARTIAL unique indexes, and Postgres will not infer a partial
-- index as an ON CONFLICT arbiter — so the moment step 2 applied, every
-- review submission from the deployed app would fail. This RPC gives the
-- client an arbiter-free way to submit, so the schema can change underneath
-- it later without a breakage window.
--
-- Deliberately NOT security definer. The insert and update go through the
-- same RLS policies as today — "Attendees can create their own review"
-- (user_can_review_business) and "Users can update their own review" — so
-- eligibility, the owner exclusion and the ban check are enforced exactly as
-- they are now. This migration adds NO new privilege and changes NO
-- constraint, policy or column: applying it is invisible to the running app.
--
-- Step 2 re-creates this function with a p_event_id parameter (defaulted), so
-- a client written against this signature keeps working afterwards.

CREATE OR REPLACE FUNCTION public.submit_review(
  p_business_id uuid,
  p_rating integer,
  p_text text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_text text := NULLIF(btrim(COALESCE(p_text, '')), '');
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'invalid_review: rating must be 1 to 5';
  END IF;

  -- Update-then-insert rather than ON CONFLICT: no arbiter is named, so this
  -- body survives step 2's switch to partial unique indexes untouched.
  UPDATE reviews
     SET rating = p_rating, text = v_text, updated_at = now()
   WHERE user_id = v_user AND business_id = p_business_id
   RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    BEGIN
      INSERT INTO reviews (user_id, business_id, rating, text)
      VALUES (v_user, p_business_id, p_rating, v_text)
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      -- Someone else's write landed between the UPDATE and the INSERT.
      UPDATE reviews
         SET rating = p_rating, text = v_text, updated_at = now()
       WHERE user_id = v_user AND business_id = p_business_id
       RETURNING id INTO v_id;
    END;
  END IF;

  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.submit_review(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, integer, text) TO authenticated;

COMMENT ON FUNCTION public.submit_review(uuid, integer, text) IS
  'Create or update the caller''s review of a venue. SECURITY INVOKER: RLS '
  'decides eligibility, exactly as the direct upsert did. Exists so the '
  'reviews unique constraints can change without breaking the client (D2).';
