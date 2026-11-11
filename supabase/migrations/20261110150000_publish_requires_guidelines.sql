-- Host onboarding Stage 6: publishing requires the current host guidelines
-- (docs/HOST_ONBOARDING_PLAN.md §14 Q6, §18).
--
-- Kept separate from 20261110140000 on purpose: it changes behaviour for
-- every existing host. Hosts created before Stage 2 have
-- host_terms_version = NULL and will be asked to accept on their NEXT
-- publish (the client catches `guidelines_required` and shows the
-- guidelines with an Accept button, then retries). Drafts are never blocked.
--
-- Apply after 20261110110000 (host_terms_current_version) and after
-- 20261110140000 (trigger naming / order). Regression suites that publish as
-- an `authenticated` demo host must accept the guidelines for that host first
-- or they will fail with `guidelines_required` — that is this migration
-- working, not a regression.
--
-- Privileged contexts (no request user, or an admin) pass. Idempotent.

CREATE OR REPLACE FUNCTION guard_event_publish_guidelines()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_becoming_published boolean;
  v_version integer;
BEGIN
  IF auth.uid() IS NULL OR is_admin_user() THEN
    RETURN NEW;
  END IF;
  v_becoming_published :=
    COALESCE(NEW.publish_state, 'published') = 'published'
    AND (TG_OP = 'INSERT' OR COALESCE(OLD.publish_state, 'published') <> 'published');
  IF NOT v_becoming_published THEN
    RETURN NEW;
  END IF;
  SELECT b.host_terms_version INTO v_version FROM businesses b WHERE b.id = NEW.business_id;
  IF COALESCE(v_version, 0) < host_terms_current_version() THEN
    RAISE EXCEPTION 'guidelines_required: accept the host guidelines to publish'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a4_guard_event_publish_guidelines ON events;
CREATE TRIGGER a4_guard_event_publish_guidelines
  BEFORE INSERT OR UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION guard_event_publish_guidelines();
