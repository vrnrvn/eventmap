-- Host onboarding Stage 1 (docs/HOST_ONBOARDING_PLAN.md): record what the user
-- said brings them to the app. Used for host nudges only; nothing is gated on it.
-- User-owned column, so the existing row-scoped UPDATE policy and the
-- privileged-column trigger need no change. Idempotent.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS intent text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_intent_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_intent_check
      CHECK (intent IS NULL OR intent IN ('attend', 'host', 'both'));
  END IF;
END $$;

COMMENT ON COLUMN profiles.intent IS
  'Onboarding answer to "What brings you here?" (attend | host | both). NULL = not asked yet.';
