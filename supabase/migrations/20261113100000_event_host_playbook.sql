-- Per-event host checklist state (docs/HOST_EVENT_PLAYBOOK_PLAN.md P5).
--
-- NOT applied to the shared local database by the author; validated on an
-- isolated throwaway cluster (scripts/db-isolated.sh) that had every earlier
-- migration applied. Ask the owner before applying; afterwards run
-- `npm run backend:types`. Requires 20261028130000 (user_is_event_host) and
-- 20260219100400 (is_admin_user).
--
-- What this adds
--  1. event_host_playbook: one row per event holding the host's manual ticks
--     ("venue confirmed", "no limit, on purpose") and the stages whose card
--     they dismissed. Phases P1-P4 keep this on the device only, so a tick
--     does not follow the host to a second device; this is the server half.
--
--     Deliberately NOT a column on `events`: get_event_details returns the
--     whole events row to every viewer, so a column there would ship the
--     host's private checklist state to attendees.
--
--  2. RLS: readable by the event's host (and admins) only. There is no
--     insert/update/delete policy and no write grant, so the table can only
--     be written through the two RPCs below. That is what keeps the stored
--     vocabulary valid: a direct PostgREST write could otherwise put
--     arbitrary text in the arrays.
--
--  3. RPCs, both SECURITY DEFINER and host-checked, merging server-side so
--     two devices cannot clobber each other's ticks (the reason this is not
--     a whole-array replace):
--       set_event_playbook_item(event, item, done) -> jsonb
--       dismiss_event_playbook_stage(event, stage) -> jsonb
--
-- Everything is idempotent (IF NOT EXISTS / OR REPLACE / DROP POLICY IF
-- EXISTS) so it can be re-applied.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_host_playbook (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  -- Checklist item ids the host ticked by hand (utils/eventPlaybook.ts).
  ticked text[] NOT NULL DEFAULT '{}',
  -- 'before' | 'leadup' | 'dayof' | 'after' — stages whose card was hidden.
  dismissed_stages text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Bounds, not vocabulary: the client owns the item list, and the RPCs
  -- below are the only writers, so a runaway array is the only real risk.
  CONSTRAINT event_host_playbook_ticked_max CHECK (cardinality(ticked) <= 40),
  CONSTRAINT event_host_playbook_stages_max CHECK (cardinality(dismissed_stages) <= 8)
);

COMMENT ON TABLE public.event_host_playbook IS
  'Per-event host checklist state (manual ticks, dismissed stages). Host-readable only; written solely through set_event_playbook_item / dismiss_event_playbook_stage.';

ALTER TABLE public.event_host_playbook ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Playbook visible to the event host" ON public.event_host_playbook;
CREATE POLICY "Playbook visible to the event host"
  ON public.event_host_playbook FOR SELECT
  TO authenticated
  USING (user_is_event_host(event_id) OR is_admin_user());

-- Read-only to clients; the RPCs (SECURITY DEFINER) do every write.
GRANT SELECT ON public.event_host_playbook TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Writes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_event_playbook_item(
  p_event_id uuid,
  p_item text,
  p_done boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.event_host_playbook;
BEGIN
  IF NOT user_is_event_host(p_event_id) THEN
    RAISE EXCEPTION 'not_event_host' USING ERRCODE = '42501';
  END IF;
  -- Shape only: which ids exist is the client's business, but it must look
  -- like one of ours so the column cannot become a free-text store.
  IF p_item IS NULL OR p_item !~ '^[a-z][a-z0-9_]{0,39}$' THEN
    RAISE EXCEPTION 'invalid_item';
  END IF;

  INSERT INTO public.event_host_playbook AS p (event_id, ticked)
  VALUES (p_event_id, CASE WHEN COALESCE(p_done, false) THEN ARRAY[p_item] ELSE '{}'::text[] END)
  ON CONFLICT (event_id) DO UPDATE
    SET ticked = CASE
          WHEN COALESCE(p_done, false) THEN
            CASE WHEN p_item = ANY (p.ticked) THEN p.ticked ELSE p.ticked || p_item END
          ELSE array_remove(p.ticked, p_item)
        END,
        updated_at = now()
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.dismiss_event_playbook_stage(
  p_event_id uuid,
  p_stage text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.event_host_playbook;
BEGIN
  IF NOT user_is_event_host(p_event_id) THEN
    RAISE EXCEPTION 'not_event_host' USING ERRCODE = '42501';
  END IF;
  IF p_stage IS NULL OR p_stage NOT IN ('before', 'leadup', 'dayof', 'after') THEN
    RAISE EXCEPTION 'invalid_stage';
  END IF;

  INSERT INTO public.event_host_playbook AS p (event_id, dismissed_stages)
  VALUES (p_event_id, ARRAY[p_stage])
  ON CONFLICT (event_id) DO UPDATE
    SET dismissed_stages = CASE
          WHEN p_stage = ANY (p.dismissed_stages) THEN p.dismissed_stages
          ELSE p.dismissed_stages || p_stage
        END,
        updated_at = now()
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_event_playbook_item(uuid, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dismiss_event_playbook_stage(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_event_playbook_item(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_event_playbook_stage(uuid, text) TO authenticated;
