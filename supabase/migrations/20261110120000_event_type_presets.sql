-- Host onboarding Stage 3 (docs/HOST_ONBOARDING_PLAN.md §11.2 step 1):
-- record which size preset an event was created from.
--
-- Analytics and copy only — nothing is enforced from this column, and the
-- preset's actual effects (capacity, waitlist mode, chat mode) are stored in
-- their own columns as before. Values are the stable preset ids in
-- utils/eventPresets.ts; NULL = created without a preset (every existing row).
--
-- Owner-writable like the other event content columns; the publish/business
-- freeze trigger (20261103150000) does not cover it, so a host can correct the
-- preset after publishing. Idempotent.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS event_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_event_type_check'
  ) THEN
    ALTER TABLE events
      ADD CONSTRAINT events_event_type_check
      CHECK (event_type IS NULL OR event_type IN ('casual', 'class', 'venue_show', 'large'));
  END IF;
END $$;

COMMENT ON COLUMN events.event_type IS
  'Size preset the event was created from (casual | class | venue_show | large). Analytics only; nothing is enforced from it.';
