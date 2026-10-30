-- Self-serve premium fix (HIGH).
--
-- The businesses UPDATE policy (20260213092204) lets owners write any column,
-- including subscription_tier / subscription_expires_at, so any owner could
-- grant themselves premium with one API call and the server-side gates
-- (check_event_creation_limit, recurring-events check) would honor it.
--
-- Fix:
--   1. BEFORE INSERT/UPDATE trigger on businesses that rejects direct changes
--      to the subscription columns unless the context is privileged
--      (service_role / no request user, an admin, or the transaction-local
--      flag set by the RPCs below).
--   2. SECURITY DEFINER RPCs activate_premium_simulation /
--      cancel_premium_simulation that validate ownership and perform the
--      (simulated) tier change. Tier values stay exactly 'free' | 'premium'.
--
-- Client: services/premium.ts calls these RPCs with a direct-update fallback
-- until this migration is applied.

-- -----------------------------
-- 1. Column-protection trigger
-- -----------------------------
CREATE OR REPLACE FUNCTION protect_business_subscription_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Privileged contexts: service key / SQL jobs, admins, or the premium RPCs
  -- (which set a transaction-local flag before writing).
  IF auth.uid() IS NULL
     OR is_admin_user()
     OR COALESCE(current_setting('eventmap.allow_subscription_write', true), '') = 'true' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- New businesses always start on the free tier.
    NEW.subscription_tier := 'free';
    NEW.subscription_expires_at := NULL;
    RETURN NEW;
  END IF;

  IF NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier
     OR NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at THEN
    RAISE EXCEPTION 'not_allowed: subscription changes must go through the premium RPCs';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_protect_business_subscription_columns ON businesses;
CREATE TRIGGER trigger_protect_business_subscription_columns
  BEFORE INSERT OR UPDATE ON businesses
  FOR EACH ROW
  EXECUTE FUNCTION protect_business_subscription_columns();

-- -----------------------------
-- 2. Premium simulation RPCs
-- -----------------------------
CREATE OR REPLACE FUNCTION activate_premium_simulation(
  p_business_id uuid,
  p_interval text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expires timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM businesses
    WHERE id = p_business_id
      AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_allowed: you do not own this business';
  END IF;

  IF p_interval NOT IN ('monthly', 'yearly') THEN
    RAISE EXCEPTION 'invalid_interval: expected monthly or yearly, got %', p_interval;
  END IF;

  v_expires := CASE
    WHEN p_interval = 'yearly' THEN now() + interval '1 year'
    ELSE now() + interval '1 month'
  END;

  -- Transaction-local flag lets the write pass the column-protection trigger.
  PERFORM set_config('eventmap.allow_subscription_write', 'true', true);

  UPDATE businesses
  SET
    subscription_tier = 'premium',
    subscription_expires_at = v_expires
  WHERE id = p_business_id;

  PERFORM set_config('eventmap.allow_subscription_write', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION cancel_premium_simulation(p_business_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM businesses
    WHERE id = p_business_id
      AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_allowed: you do not own this business';
  END IF;

  PERFORM set_config('eventmap.allow_subscription_write', 'true', true);

  UPDATE businesses
  SET
    subscription_tier = 'free',
    subscription_expires_at = NULL
  WHERE id = p_business_id;

  PERFORM set_config('eventmap.allow_subscription_write', '', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION activate_premium_simulation(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION cancel_premium_simulation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION activate_premium_simulation(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cancel_premium_simulation(uuid) TO authenticated, service_role;
