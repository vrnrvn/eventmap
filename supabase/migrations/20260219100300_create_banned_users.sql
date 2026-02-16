-- Banned users table to preserve ban history
CREATE TABLE IF NOT EXISTS banned_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  banned_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason text,
  banned_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_banned_users_user_id ON banned_users(user_id);

ALTER TABLE banned_users ENABLE ROW LEVEL SECURITY;
