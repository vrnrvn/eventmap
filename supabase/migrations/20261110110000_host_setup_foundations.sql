-- Host onboarding Stage 2 foundations (docs/HOST_ONBOARDING_PLAN.md §4 Stage 2, §6).
--
-- 1. Host shape: businesses.host_type (venue | organiser | individual) and
--    location_kind (fixed | area | none). Venues keep a required street
--    address; organisers and individuals may give a home area or nothing.
--    address/lat/lng become nullable, guarded by CHECKs.
-- 2. Host guidelines acceptance (host_terms_version + server-stamped
--    host_terms_accepted_at) and onboarding_completed_at.
-- 3. Guard trigger: stamps the acceptance/completion times server-side and
--    closes a pre-existing hole where an owner could set `verified` on their
--    own business (the owner UPDATE policy is row-scoped only and the
--    subscription trigger does not cover `verified`).
-- 4. get_user_business() returns SETOF businesses so new columns reach the
--    client without another signature change.
--
-- Existing rows: all have a street address, so they backfill to
-- host_type = 'venue', location_kind = 'fixed'. Their terms stay NULL (not
-- accepted). Nothing enforces acceptance yet (publish guard deferred, see
-- plan §9 Q2/Q4), so existing hosts are unaffected.
--
-- Display-only SQL uses of b.address (business_address in RPC payloads)
-- tolerate NULL. Events keep their own NOT NULL location.
-- Idempotent; safe to re-run.

-- ---------------------------------------------------------------- columns
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS host_type text,
  ADD COLUMN IF NOT EXISTS location_kind text,
  ADD COLUMN IF NOT EXISTS host_terms_version integer,
  ADD COLUMN IF NOT EXISTS host_terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

UPDATE businesses SET host_type = 'venue' WHERE host_type IS NULL;
UPDATE businesses SET location_kind = 'fixed' WHERE location_kind IS NULL;

ALTER TABLE businesses
  ALTER COLUMN host_type SET DEFAULT 'venue',
  ALTER COLUMN host_type SET NOT NULL,
  ALTER COLUMN location_kind SET DEFAULT 'fixed',
  ALTER COLUMN location_kind SET NOT NULL,
  ALTER COLUMN address DROP NOT NULL,
  ALTER COLUMN lat DROP NOT NULL,
  ALTER COLUMN lng DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'businesses_host_type_check') THEN
    ALTER TABLE businesses ADD CONSTRAINT businesses_host_type_check
      CHECK (host_type IN ('venue', 'organiser', 'individual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'businesses_location_kind_check') THEN
    ALTER TABLE businesses ADD CONSTRAINT businesses_location_kind_check
      CHECK (location_kind IN ('fixed', 'area', 'none'));
  END IF;
  -- fixed: full street address + pin. area: pin required, label optional.
  -- none: no location at all (stray coordinates would leak a pin).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'businesses_location_shape_check') THEN
    ALTER TABLE businesses ADD CONSTRAINT businesses_location_shape_check
      CHECK (
        CASE location_kind
          WHEN 'fixed' THEN address IS NOT NULL AND btrim(address) <> '' AND lat IS NOT NULL AND lng IS NOT NULL
          WHEN 'area'  THEN lat IS NOT NULL AND lng IS NOT NULL
          ELSE lat IS NULL AND lng IS NULL AND address IS NULL
        END
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'businesses_venue_fixed_check') THEN
    ALTER TABLE businesses ADD CONSTRAINT businesses_venue_fixed_check
      CHECK (host_type <> 'venue' OR location_kind = 'fixed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'businesses_host_terms_check') THEN
    ALTER TABLE businesses ADD CONSTRAINT businesses_host_terms_check
      CHECK (
        (host_terms_version IS NULL AND host_terms_accepted_at IS NULL)
        OR (host_terms_version >= 1 AND host_terms_accepted_at IS NOT NULL)
      );
  END IF;
END $$;

COMMENT ON COLUMN businesses.host_type IS 'Host persona from host setup: venue | organiser | individual. Prefills defaults only.';
COMMENT ON COLUMN businesses.location_kind IS 'fixed = street address (venues), area = approximate home area, none = no home location.';
COMMENT ON COLUMN businesses.host_terms_version IS 'Version of the host guidelines the owner accepted; see host_terms_current_version().';

-- ------------------------------------------------------ current terms version
CREATE OR REPLACE FUNCTION host_terms_current_version()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$ SELECT 1 $$;

GRANT EXECUTE ON FUNCTION host_terms_current_version() TO anon, authenticated, service_role;

-- ------------------------------------------------------------- guard trigger
CREATE OR REPLACE FUNCTION guard_business_host_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Privileged contexts (service key / SQL jobs / admins) pass through.
  IF auth.uid() IS NULL OR is_admin_user() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.verified := false;
  ELSIF NEW.verified IS DISTINCT FROM OLD.verified THEN
    RAISE EXCEPTION 'not_allowed: verification is set by EventMap'
      USING ERRCODE = '42501';
  END IF;

  -- Terms: only the current version may be accepted, never withdrawn or
  -- downgraded, and the time is always the server's.
  IF NEW.host_terms_version IS NOT NULL THEN
    IF NEW.host_terms_version <> host_terms_current_version() THEN
      IF TG_OP = 'INSERT' OR NEW.host_terms_version IS DISTINCT FROM OLD.host_terms_version THEN
        RAISE EXCEPTION 'invalid_terms_version: expected %', host_terms_current_version()
          USING ERRCODE = '22023';
      END IF;
    END IF;
    IF TG_OP = 'INSERT' OR NEW.host_terms_version IS DISTINCT FROM OLD.host_terms_version THEN
      NEW.host_terms_accepted_at := now();
    ELSE
      NEW.host_terms_accepted_at := OLD.host_terms_accepted_at;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.host_terms_version IS NOT NULL THEN
    RAISE EXCEPTION 'not_allowed: accepted host guidelines cannot be withdrawn'
      USING ERRCODE = '42501';
  ELSE
    NEW.host_terms_accepted_at := NULL;
  END IF;

  -- Onboarding completion: set once, server time, never cleared by the owner.
  IF TG_OP = 'INSERT' THEN
    IF NEW.onboarding_completed_at IS NOT NULL THEN
      NEW.onboarding_completed_at := now();
    END IF;
  ELSIF OLD.onboarding_completed_at IS NOT NULL THEN
    NEW.onboarding_completed_at := OLD.onboarding_completed_at;
  ELSIF NEW.onboarding_completed_at IS NOT NULL THEN
    NEW.onboarding_completed_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_guard_business_host_columns ON businesses;
CREATE TRIGGER trigger_guard_business_host_columns
  BEFORE INSERT OR UPDATE ON businesses
  FOR EACH ROW
  EXECUTE FUNCTION guard_business_host_columns();

-- --------------------------------------------------------- get_user_business
-- Was RETURNS TABLE(...) with an explicit column list (20260221000000), which
-- hid every column added since (notifications_enabled, and the ones above).
-- social_handles is nullable here; the client already treats NULL as {}.
DROP FUNCTION IF EXISTS get_user_business();
CREATE FUNCTION get_user_business()
RETURNS SETOF businesses
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.* FROM businesses b WHERE b.owner_id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION get_user_business() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_user_business() TO authenticated, service_role;
