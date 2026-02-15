ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS has_completed_onboarding boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS preferred_categories uuid[] DEFAULT '{}';
