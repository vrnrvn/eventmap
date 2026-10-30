-- Global user blocking (foundation).
--
-- Adds the user_blocks table so "Block user" can accompany "Report user" on
-- profiles (ISSUES.md P0). This migration only stores the block relationship;
-- content-level enforcement (hiding blocked users' chat messages/events in
-- RPCs and policies) is a follow-up tracked in ISSUES.md.
--
-- Client (services/social.ts blockUser/unblockUser/isBlocked) tolerates this
-- migration being unapplied: 42P01 (undefined_table) is surfaced as a typed
-- NOT_AVAILABLE error and the UI degrades gracefully.

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

-- Reverse lookups ("who blocked this user") for future content enforcement;
-- the PK already covers blocker-side lookups.
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);

ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;

-- The blocker manages their own block list. The blocked user is deliberately
-- given no visibility (knowing you were blocked invites harassment).
DROP POLICY IF EXISTS "Users can view own blocks" ON user_blocks;
CREATE POLICY "Users can view own blocks"
  ON user_blocks FOR SELECT
  TO authenticated
  USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own blocks" ON user_blocks;
CREATE POLICY "Users can create own blocks"
  ON user_blocks FOR INSERT
  TO authenticated
  WITH CHECK (blocker_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own blocks" ON user_blocks;
CREATE POLICY "Users can delete own blocks"
  ON user_blocks FOR DELETE
  TO authenticated
  USING (blocker_id = auth.uid());
