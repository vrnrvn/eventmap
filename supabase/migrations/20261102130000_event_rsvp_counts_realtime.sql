-- Live attendance counts (events-flow review Tier 1, 2026-11-02).
--
-- 20261030115000 added `rsvps` to the realtime publication so EventDetail
-- could stop polling, but postgres_changes applies the subscriber's RLS and
-- the only rsvps SELECT policy is `auth.uid() = user_id`: a viewer only ever
-- hears about their own RSVP, never "someone else joined", so the live
-- count and the 2-person chat unlock never fire. The client dropped that
-- subscription and polls every 20s.
--
-- This adds a small aggregate table that anyone may read, maintained by a
-- trigger on rsvps, and publishes it instead. Rows carry no user ids, so
-- publishing them leaks nothing the public attendee RPCs don't already show.
--
-- Client follow-up once applied (screens/EventDetail.tsx, the poll effect):
--   supabase.channel(`event-rsvp-counts:${id}`)
--     .on('postgres_changes', { event: '*', schema: 'public',
--          table: 'event_rsvp_counts', filter: `event_id=eq.${id}` },
--         () => void refetchCount())
--     .subscribe();
-- keeping the 20s poll as a fallback.
--
-- Validated on a scratch copy of the local DB; not applied to the shared DB.

CREATE TABLE IF NOT EXISTS public.event_rsvp_counts (
  event_id uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  going_count integer NOT NULL DEFAULT 0,
  interested_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_rsvp_counts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read event rsvp counts" ON public.event_rsvp_counts;
CREATE POLICY "Anyone can read event rsvp counts"
  ON public.event_rsvp_counts
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Writes happen only through the trigger below (SECURITY DEFINER).
REVOKE INSERT, UPDATE, DELETE ON public.event_rsvp_counts FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_event_rsvp_counts(p_event_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  INSERT INTO event_rsvp_counts (event_id, going_count, interested_count, updated_at)
  SELECT
    p_event_id,
    COUNT(*) FILTER (WHERE r.status = 'going'),
    COUNT(*) FILTER (WHERE r.status = 'interested'),
    now()
  FROM rsvps r
  WHERE r.event_id = p_event_id
  -- An event with no RSVPs left still gets a (zero) row via the HAVING-less
  -- aggregate; the FK keeps it attached to a live event.
  ON CONFLICT (event_id) DO UPDATE
    SET going_count = EXCLUDED.going_count,
        interested_count = EXCLUDED.interested_count,
        updated_at = EXCLUDED.updated_at;
$function$;

-- Internal helper: only the trigger below should call it.
REVOKE EXECUTE ON FUNCTION public.refresh_event_rsvp_counts(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_event_rsvp_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM refresh_event_rsvp_counts(NEW.event_id);
  END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') AND (TG_OP = 'DELETE' OR OLD.event_id IS DISTINCT FROM NEW.event_id) THEN
    -- The event may be mid-cascade-delete; skip if it's gone.
    IF EXISTS (SELECT 1 FROM events e WHERE e.id = OLD.event_id) THEN
      PERFORM refresh_event_rsvp_counts(OLD.event_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_sync_event_rsvp_counts ON rsvps;
CREATE TRIGGER trigger_sync_event_rsvp_counts
  AFTER INSERT OR UPDATE OR DELETE ON rsvps
  FOR EACH ROW
  EXECUTE FUNCTION sync_event_rsvp_counts();

-- Backfill for events that already have RSVPs.
INSERT INTO event_rsvp_counts (event_id, going_count, interested_count)
SELECT
  r.event_id,
  COUNT(*) FILTER (WHERE r.status = 'going'),
  COUNT(*) FILTER (WHERE r.status = 'interested')
FROM rsvps r
GROUP BY r.event_id
ON CONFLICT (event_id) DO UPDATE
  SET going_count = EXCLUDED.going_count,
      interested_count = EXCLUDED.interested_count,
      updated_at = now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'event_rsvp_counts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.event_rsvp_counts;
  END IF;
END $$;

-- rsvps itself no longer needs to be published (nothing can usefully
-- subscribe to it under its RLS); dropping it saves WAL/replication work.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'rsvps'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.rsvps;
  END IF;
END $$;
