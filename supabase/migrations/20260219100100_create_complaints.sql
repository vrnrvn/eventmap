-- Complaints (reports) table for users to report events, businesses, users, or reviews
CREATE TABLE IF NOT EXISTS complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('event', 'business', 'user', 'review')),
  target_id uuid NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  resolved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_complaints_reporter_id ON complaints(reporter_id);
CREATE INDEX IF NOT EXISTS idx_complaints_target ON complaints(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_created_at ON complaints(created_at DESC);

ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;

-- Users can create their own complaints
CREATE POLICY "Users can create their own complaint"
  ON complaints FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

-- Users can view their own complaints
CREATE POLICY "Users can view their own complaints"
  ON complaints FOR SELECT
  TO authenticated
  USING (auth.uid() = reporter_id);
