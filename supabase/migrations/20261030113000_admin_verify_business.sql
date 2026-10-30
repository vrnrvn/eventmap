-- Verified-badge pipeline: admin RPC to set businesses.verified.
--
-- businesses.verified has existed since the initial schema but nothing could
-- ever set it to true (createBusiness hardcodes false and owners have no
-- write path), so the badge was unreachable. Follows the
-- admin_set_business_premium pattern (20260219100400) with the search_path
-- pin applied by 20261030107000 included from the start.
--
-- Client: admin dashboard Verify/Unverify action (businesses table + detail
-- page); the app shows the badge on the public business page
-- (screens/BusinessDetail.tsx) and the business-mode profile avatar.

CREATE OR REPLACE FUNCTION admin_set_business_verified(p_business_id uuid, p_verified boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  UPDATE businesses
  SET verified = p_verified
  WHERE id = p_business_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_set_business_verified(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_set_business_verified(uuid, boolean) TO authenticated, service_role;
