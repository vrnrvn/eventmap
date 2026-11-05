-- Analytics inputs for host insights (docs/ANALYTICS_AND_CALENDAR_PLAN.md §1.3 C, D).
--
-- STATUS: prepared, NOT applied to the shared DB. Validated on an isolated
-- scratch copy with scripts/test-event-insights.sql. Ordered before
-- 20261104100000 (get_event_insights reads both tables). Depends on the
-- 20261103* set.
--
--   1. event_interactions + track_event_interaction(p_event_id, p_kind):
--      share / ticket / calendar / directions taps. Same privacy posture as
--      event_views: signed-in callers only, at most one row per person, event,
--      kind and day, the host's own taps skipped, drafts skipped. Nobody can
--      read the table directly; insights expose counts only.
--   2. rsvp_history + trigger on rsvps: every status change and deletion,
--      classified by who made it (left = the attendee, declined = a host
--      turning down a request, removed = a host removing someone). Starts
--      empty: there is no history before this file is applied.

-- ── 1. Interactions ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.event_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  viewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('share', 'ticket', 'calendar', 'directions')),
  created_at timestamptz NOT NULL DEFAULT now(),
  day date NOT NULL DEFAULT CURRENT_DATE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_interactions_dedup_daily
  ON public.event_interactions (event_id, viewer_id, kind, day)
  WHERE viewer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_interactions_event_created
  ON public.event_interactions (event_id, created_at);

ALTER TABLE public.event_interactions ENABLE ROW LEVEL SECURITY;
-- No policies: writes go through the RPC, reads through get_event_insights.
REVOKE ALL ON public.event_interactions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.track_event_interaction(p_event_id uuid, p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('share', 'ticket', 'calendar', 'directions') THEN
    RAISE EXCEPTION 'invalid_kind';
  END IF;
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  -- Only published events count, and never the host's own taps.
  IF NOT EXISTS (
    SELECT 1 FROM events e JOIN businesses b ON b.id = e.business_id
    WHERE e.id = p_event_id
      AND COALESCE(e.publish_state, 'published') = 'published'
      AND b.owner_id <> v_uid
  ) THEN
    RETURN;
  END IF;

  INSERT INTO event_interactions (event_id, viewer_id, kind, created_at, day)
  VALUES (p_event_id, v_uid, p_kind, now(), CURRENT_DATE)
  ON CONFLICT (event_id, viewer_id, kind, day) WHERE viewer_id IS NOT NULL DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.track_event_interaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.track_event_interaction(uuid, text) TO authenticated;

-- ── 2. RSVP history ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rsvp_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- NULL from_status = a new RSVP.
  from_status text,
  -- An RSVP status, or for deletions: 'left' | 'declined' | 'removed'.
  to_status text NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rsvp_history_event_changed
  ON public.rsvp_history (event_id, changed_at);

ALTER TABLE public.rsvp_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rsvp_history FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_rsvp_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_to text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_to := CASE
      WHEN v_actor IS NULL OR v_actor = OLD.user_id THEN 'left'
      WHEN OLD.status = 'requested' THEN 'declined'
      ELSE 'removed'
    END;
  END IF;

  -- History must never block the RSVP change itself: when the delete is a
  -- cascade from a deleted event or account, the parent row is gone and the
  -- insert would violate a foreign key, so it is skipped.
  BEGIN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO rsvp_history (event_id, user_id, from_status, to_status, changed_by)
      VALUES (NEW.event_id, NEW.user_id, NULL, NEW.status, v_actor);
    ELSIF TG_OP = 'UPDATE' THEN
      INSERT INTO rsvp_history (event_id, user_id, from_status, to_status, changed_by)
      VALUES (NEW.event_id, NEW.user_id, OLD.status, NEW.status, v_actor);
    ELSE
      INSERT INTO rsvp_history (event_id, user_id, from_status, to_status, changed_by)
      VALUES (OLD.event_id, OLD.user_id, OLD.status, v_to, v_actor);
    END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.record_rsvp_history() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS z_record_rsvp_history ON public.rsvps;
CREATE TRIGGER z_record_rsvp_history
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.rsvps
  FOR EACH ROW
  EXECUTE FUNCTION public.record_rsvp_history();
