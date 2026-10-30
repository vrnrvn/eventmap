-- Privilege escalation fix (CRITICAL).
--
-- The profiles UPDATE policy (20260213092204) is row-scoped only, and
-- is_admin (20260219100000) is an ordinary column, so any user could grant
-- themselves admin with a single PATCH. is_admin_user() and every admin
-- RPC/policy trust that flag.
--
-- is_admin is the only privileged column on profiles (ban state lives in
-- banned_users; everything else is user-owned preference/profile data).
-- A trigger is used instead of column grants because PostgREST sends full-row
-- updates and column REVOKEs would break ordinary profile edits.
--
-- Privileged contexts that may change is_admin:
--   * no request user (service_role key, psql, SECURITY DEFINER jobs,
--     the auth signup trigger) -> auth.uid() IS NULL
--   * an existing admin        -> is_admin_user()

CREATE OR REPLACE FUNCTION protect_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Privileged contexts pass through untouched.
  IF auth.uid() IS NULL OR is_admin_user() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A user inserting their own profile row can never seed privileges.
    NEW.is_admin := false;
    RETURN NEW;
  END IF;

  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION 'not_allowed: is_admin can only be changed by an administrator';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_protect_profile_privileged_columns ON profiles;
CREATE TRIGGER trigger_protect_profile_privileged_columns
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION protect_profile_privileged_columns();
