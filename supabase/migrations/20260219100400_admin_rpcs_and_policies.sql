-- Admin RPCs and RLS policies
-- All admin functions verify is_admin at the start

-- Helper to check if current user is admin
CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM profiles WHERE id = auth.uid()),
    false
  );
$$;

-- Reset business event limit to 0
CREATE OR REPLACE FUNCTION admin_reset_business_event_limit(p_business_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  UPDATE businesses
  SET
    events_created_this_month = 0,
    last_reset_date = CURRENT_DATE
  WHERE id = p_business_id;
END;
$$;

-- Set business premium tier
CREATE OR REPLACE FUNCTION admin_set_business_premium(p_business_id uuid, p_is_premium boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  UPDATE businesses
  SET subscription_tier = CASE WHEN p_is_premium THEN 'premium' ELSE 'free' END
  WHERE id = p_business_id;
END;
$$;

-- Ban user
CREATE OR REPLACE FUNCTION admin_ban_user(p_user_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  INSERT INTO banned_users (user_id, banned_by, reason)
  VALUES (p_user_id, auth.uid(), p_reason)
  ON CONFLICT (user_id) DO UPDATE SET
    banned_by = EXCLUDED.banned_by,
    reason = EXCLUDED.reason,
    banned_at = now();
END;
$$;

-- Unban user
CREATE OR REPLACE FUNCTION admin_unban_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  DELETE FROM banned_users WHERE user_id = p_user_id;
END;
$$;

-- Admin policies for businesses
CREATE POLICY "Admins can update any business"
  ON businesses FOR UPDATE
  TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

-- Admin policies for events
CREATE POLICY "Admins can delete any event"
  ON events FOR DELETE
  TO authenticated
  USING (is_admin_user());

CREATE POLICY "Admins can view all events including past"
  ON events FOR SELECT
  TO authenticated
  USING (is_admin_user());

-- Admin policies for profiles (read all)
CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (is_admin_user());

-- Admin policies for complaints
CREATE POLICY "Admins can view all complaints"
  ON complaints FOR SELECT
  TO authenticated
  USING (is_admin_user());

CREATE POLICY "Admins can update complaints"
  ON complaints FOR UPDATE
  TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

-- Admin policies for app_banners
CREATE POLICY "Admins can manage app_banners"
  ON app_banners FOR ALL
  TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

-- Public read for active banners (for mobile app)
CREATE POLICY "Anyone can view active banners"
  ON app_banners FOR SELECT
  TO public
  USING (
    is_active = true
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at >= now())
  );

-- Admin policies for banned_users
CREATE POLICY "Admins can manage banned_users"
  ON banned_users FOR ALL
  TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

-- Users can check if they are banned (for mobile app)
CREATE POLICY "Users can check own ban status"
  ON banned_users FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admin policies for reviews
CREATE POLICY "Admins can view all reviews"
  ON reviews FOR SELECT
  TO authenticated
  USING (is_admin_user());

CREATE POLICY "Admins can delete any review"
  ON reviews FOR DELETE
  TO authenticated
  USING (is_admin_user());
