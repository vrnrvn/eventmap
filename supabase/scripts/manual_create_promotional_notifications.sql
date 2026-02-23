-- Run in Supabase Dashboard → SQL Editor if promotional_notifications table is missing

CREATE TABLE IF NOT EXISTS promotional_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  link_url text,
  target_cities text[],
  target_lat float8,
  target_lng float8,
  target_radius_km float8,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  is_active boolean DEFAULT true NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_promotional_notifications_active ON promotional_notifications(is_active);

ALTER TABLE promotional_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage promotional notifications" ON promotional_notifications;
CREATE POLICY "Admins can manage promotional notifications"
  ON promotional_notifications
  FOR ALL
  TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());
