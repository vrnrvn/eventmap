-- Host onboarding Stage 6 foundations: trust (docs/HOST_ONBOARDING_PLAN.md
-- §4 Stage 7 "Ongoing responsibilities and trust", §18).
--
-- 1. Host standing on businesses: good | warning | restricted, with a reason.
--    Only admins change it. `restricted` blocks publishing (new events and
--    draft → published) through one trigger on events, so the large create /
--    publish functions are not redefined here.
-- 2. Verification requests: a host asks to be verified with a link EventMap
--    can check (website, socials, press). No document upload — that would
--    mean storing identity documents (plan §9 Q3); links are enough to start.
--    One open request per host; admins approve, ask for more, or reject.
--    Approval is the only way `verified` becomes true for a host (the
--    20261110110000 guard already stops owners setting it).
--
-- Not here (by design): requiring accepted guidelines to publish — that
-- changes behaviour for every existing host and lives in its own, separately
-- appliable migration (20261110150000). Owner notifications for review
-- decisions are a later step (the client shows the status in Settings).
--
-- Privileged contexts (no request user: service key, SQL jobs, seeds; or an
-- admin) pass every guard, matching the other businesses triggers.
-- Idempotent; safe to re-run.

-- ------------------------------------------------------------ 1. standing
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS standing text NOT NULL DEFAULT 'good',
  ADD COLUMN IF NOT EXISTS standing_reason text,
  ADD COLUMN IF NOT EXISTS standing_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'businesses_standing_check') THEN
    ALTER TABLE businesses ADD CONSTRAINT businesses_standing_check
      CHECK (standing IN ('good', 'warning', 'restricted'));
  END IF;
  -- A warning or restriction always says why; the host sees the reason.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'businesses_standing_reason_check') THEN
    ALTER TABLE businesses ADD CONSTRAINT businesses_standing_reason_check
      CHECK (standing = 'good' OR (standing_reason IS NOT NULL AND btrim(standing_reason) <> ''));
  END IF;
END $$;

COMMENT ON COLUMN businesses.standing IS
  'good | warning | restricted. Set by admins only (admin_set_host_standing); restricted blocks publishing.';

CREATE OR REPLACE FUNCTION guard_business_standing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR is_admin_user() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.standing := 'good';
    NEW.standing_reason := NULL;
    NEW.standing_updated_at := NULL;
    RETURN NEW;
  END IF;
  IF NEW.standing IS DISTINCT FROM OLD.standing
     OR NEW.standing_reason IS DISTINCT FROM OLD.standing_reason
     OR NEW.standing_updated_at IS DISTINCT FROM OLD.standing_updated_at THEN
    RAISE EXCEPTION 'not_allowed: host standing is set by EventMap'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_guard_business_standing ON businesses;
CREATE TRIGGER trigger_guard_business_standing
  BEFORE INSERT OR UPDATE ON businesses
  FOR EACH ROW
  EXECUTE FUNCTION guard_business_standing();

CREATE OR REPLACE FUNCTION admin_set_host_standing(
  p_business_id uuid,
  p_standing text,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_standing NOT IN ('good', 'warning', 'restricted') THEN
    RAISE EXCEPTION 'invalid_standing: %', p_standing USING ERRCODE = '22023';
  END IF;
  IF p_standing <> 'good' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'reason_required: say why, the host will see it' USING ERRCODE = '22023';
  END IF;
  UPDATE businesses
     SET standing = p_standing,
         standing_reason = CASE WHEN p_standing = 'good' THEN NULL ELSE btrim(p_reason) END,
         standing_updated_at = now()
   WHERE id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: business %', p_business_id USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_set_host_standing(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_set_host_standing(uuid, text, text) TO authenticated, service_role;

-- A restricted host cannot publish: covers INSERT of a published event
-- (create_event_with_limit_check) and UPDATE draft → published
-- (publish_event). Drafts stay allowed so nothing the host wrote is lost.
CREATE OR REPLACE FUNCTION guard_event_publish_standing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_becoming_published boolean;
  v_standing text;
BEGIN
  IF auth.uid() IS NULL OR is_admin_user() THEN
    RETURN NEW;
  END IF;
  v_becoming_published :=
    COALESCE(NEW.publish_state, 'published') = 'published'
    AND (TG_OP = 'INSERT' OR COALESCE(OLD.publish_state, 'published') <> 'published');
  IF NOT v_becoming_published THEN
    RETURN NEW;
  END IF;
  SELECT b.standing INTO v_standing FROM businesses b WHERE b.id = NEW.business_id;
  IF v_standing = 'restricted' THEN
    RAISE EXCEPTION 'host_restricted: publishing is paused for this host'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a3_guard_event_publish_standing ON events;
CREATE TRIGGER a3_guard_event_publish_standing
  BEFORE INSERT OR UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION guard_event_publish_standing();

-- ------------------------------------------------- 2. verification requests
CREATE TABLE IF NOT EXISTS host_verification_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'needs_info', 'approved', 'rejected')),
  evidence_url  text NOT NULL CHECK (evidence_url ~* '^https?://\S+$' AND char_length(evidence_url) <= 500),
  note          text CHECK (note IS NULL OR char_length(note) <= 1000),
  reviewer_note text CHECK (reviewer_note IS NULL OR char_length(reviewer_note) <= 1000),
  reviewed_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- At most one open request per host.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_host_verification_open
  ON host_verification_requests (business_id)
  WHERE status IN ('pending', 'needs_info');
CREATE INDEX IF NOT EXISTS idx_host_verification_status_created
  ON host_verification_requests (status, created_at);

ALTER TABLE host_verification_requests ENABLE ROW LEVEL SECURITY;

-- Hosts read their own requests; admins read all. Writes only through the
-- RPCs below (no INSERT / UPDATE / DELETE policies).
DROP POLICY IF EXISTS "Hosts read own verification requests" ON host_verification_requests;
CREATE POLICY "Hosts read own verification requests" ON host_verification_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM businesses b WHERE b.id = business_id AND b.owner_id = (SELECT auth.uid()))
    OR (SELECT is_admin_user())
  );

REVOKE INSERT, UPDATE, DELETE ON host_verification_requests FROM anon, authenticated;
GRANT SELECT ON host_verification_requests TO authenticated;

CREATE OR REPLACE FUNCTION submit_verification_request(p_evidence_url text, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business businesses;
  v_open host_verification_requests;
  v_url text := btrim(COALESCE(p_evidence_url, ''));
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_id uuid;
BEGIN
  SELECT * INTO v_business FROM businesses WHERE owner_id = auth.uid();
  IF v_business.id IS NULL THEN
    RAISE EXCEPTION 'no_host_profile' USING ERRCODE = 'P0002';
  END IF;
  IF v_business.verified THEN
    RAISE EXCEPTION 'already_verified' USING ERRCODE = '22023';
  END IF;
  IF v_business.standing = 'restricted' THEN
    RAISE EXCEPTION 'host_restricted: resolve the restriction first' USING ERRCODE = '42501';
  END IF;
  IF v_url !~* '^https?://\S+$' OR char_length(v_url) > 500 THEN
    RAISE EXCEPTION 'invalid_evidence_url' USING ERRCODE = '22023';
  END IF;
  -- Eligibility (plan §4 Stage 7): a real profile and at least one published
  -- event, so reviewers have something to check.
  IF btrim(COALESCE(v_business.description, '')) = '' THEN
    RAISE EXCEPTION 'not_eligible: add a description first' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM events e WHERE e.business_id = v_business.id AND e.publish_state = 'published'
  ) THEN
    RAISE EXCEPTION 'not_eligible: publish an event first' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_open FROM host_verification_requests
   WHERE business_id = v_business.id AND status IN ('pending', 'needs_info');
  IF v_open.id IS NOT NULL THEN
    IF v_open.status = 'pending' THEN
      RAISE EXCEPTION 'request_pending' USING ERRCODE = '22023';
    END IF;
    -- needs_info: the host answers on the same request.
    UPDATE host_verification_requests
       SET status = 'pending', evidence_url = v_url, note = v_note, updated_at = now()
     WHERE id = v_open.id;
    RETURN v_open.id;
  END IF;

  INSERT INTO host_verification_requests (business_id, evidence_url, note)
  VALUES (v_business.id, v_url, v_note)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION submit_verification_request(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION submit_verification_request(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION admin_review_verification(
  p_request_id uuid,
  p_decision text,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req host_verification_requests;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('approved', 'needs_info', 'rejected') THEN
    RAISE EXCEPTION 'invalid_decision: %', p_decision USING ERRCODE = '22023';
  END IF;
  IF p_decision <> 'approved' AND v_note IS NULL THEN
    RAISE EXCEPTION 'note_required: tell the host what to do next' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_req FROM host_verification_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'not_found: request %', p_request_id USING ERRCODE = 'P0002';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'not_pending: request is %', v_req.status USING ERRCODE = '22023';
  END IF;

  UPDATE host_verification_requests
     SET status = p_decision,
         reviewer_note = v_note,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         updated_at = now()
   WHERE id = p_request_id;

  IF p_decision = 'approved' THEN
    -- Admin context: the businesses guards let this through.
    UPDATE businesses SET verified = true WHERE id = v_req.business_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_review_verification(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_review_verification(uuid, text, text) TO authenticated, service_role;
