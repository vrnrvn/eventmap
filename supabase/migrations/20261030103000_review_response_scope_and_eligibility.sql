-- Reviews hardening.
--
-- 1. The business-owner UPDATE policy from 20260217110000 had no column
--    restriction, so owners could rewrite a customer's rating/text. The
--    row-level policies stay (author + owner may UPDATE their rows); a
--    BEFORE UPDATE trigger now scopes WHICH columns each party may change:
--      * identity columns (user_id, business_id, created_at) are immutable,
--      * rating/text only by the review author,
--      * business_response only by the business owner.
--
-- 2. Review INSERT eligibility: the old policy only checked
--    auth.uid() = user_id, so anyone (including the owner) could review a
--    business they never attended. Inserts now require a 'going' RSVP to an
--    already-started event of that business, and the owner can never review
--    their own business. The check runs in a SECURITY DEFINER helper because
--    past events are not visible under the events SELECT policy.

-- -----------------------------
-- 1. Column scoping trigger
-- -----------------------------
CREATE OR REPLACE FUNCTION protect_review_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_author boolean;
  v_is_owner boolean;
BEGIN
  -- Service contexts and admins pass through.
  IF v_uid IS NULL OR is_admin_user() THEN
    RETURN NEW;
  END IF;

  v_is_author := (v_uid = OLD.user_id);
  v_is_owner := EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = OLD.business_id
      AND b.owner_id = v_uid
  );

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'not_allowed: review identity columns cannot be changed';
  END IF;

  IF (NEW.rating IS DISTINCT FROM OLD.rating OR NEW.text IS DISTINCT FROM OLD.text)
     AND NOT v_is_author THEN
    RAISE EXCEPTION 'not_allowed: only the review author can change rating or text';
  END IF;

  IF NEW.business_response IS DISTINCT FROM OLD.business_response
     AND NOT v_is_owner THEN
    RAISE EXCEPTION 'not_allowed: only the business owner can change the response';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_protect_review_columns ON reviews;
CREATE TRIGGER trigger_protect_review_columns
  BEFORE UPDATE ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION protect_review_columns();

-- -----------------------------
-- 2. INSERT eligibility
-- -----------------------------
-- SECURITY DEFINER: the caller's own 'going' RSVPs are visible under rsvps
-- RLS, but the joined events row may be a past event hidden by the events
-- SELECT policy, so this check must bypass RLS.
CREATE OR REPLACE FUNCTION user_can_review_business(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM businesses b
      WHERE b.id = p_business_id
        AND b.owner_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM rsvps r
      JOIN events e ON e.id = r.event_id
      WHERE r.user_id = auth.uid()
        AND r.status = 'going'
        AND e.business_id = p_business_id
        AND e.start_datetime <= now()
    );
$$;

DROP POLICY IF EXISTS "Authenticated users can create their own review" ON reviews;
DROP POLICY IF EXISTS "Attendees can create their own review" ON reviews;

CREATE POLICY "Attendees can create their own review"
  ON reviews FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND user_can_review_business(business_id)
  );
