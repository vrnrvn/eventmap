-- Host onboarding Stage 7: stop hosting (docs/HOST_ONBOARDING_PLAN.md
-- §4 Stage 7 "Account changes", §6 `archive_business()`).
--
-- `archive_business()` lets an owner close their host profile:
--   * every upcoming published event is cancelled through cancel_event, so
--     attendees get the normal "Event cancelled" notification;
--   * drafts are left as they are (nobody is waiting on them);
--   * the business row is kept and marked archived, because events, RSVPs,
--     chat history and past attendance all reference it — deleting it would
--     take real history with it (businesses.owner_id has ON DELETE CASCADE).
--
-- An archived host is hidden from discovery and cannot publish; the owner can
-- reopen with `reopen_business()`. Transfer of ownership is NOT included:
-- it needs co-hosts / member roles first (plan §8) and a way to accept a
-- transfer, so it stays listed as remaining.
--
-- Archiving is a privileged write on businesses, so the Stage 2 / Stage 6
-- guards (verified, standing, terms) are unaffected: those columns are not
-- touched here.
-- Idempotent; safe to re-run.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN businesses.archived_at IS
  'Set when the owner stops hosting (archive_business). Hidden from discovery; publishing blocked; reversible with reopen_business.';

-- Hide archived hosts from publishing. Discovery filtering happens in the
-- ranked-events RPCs, which read events; an archived host has no upcoming
-- published events left, so nothing extra is needed there.
CREATE OR REPLACE FUNCTION guard_event_publish_archived()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_becoming_published boolean;
  v_archived timestamptz;
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
  SELECT b.archived_at INTO v_archived FROM businesses b WHERE b.id = NEW.business_id;
  IF v_archived IS NOT NULL THEN
    RAISE EXCEPTION 'host_archived: reopen your host profile to publish again'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a5_guard_event_publish_archived ON events;
CREATE TRIGGER a5_guard_event_publish_archived
  BEFORE INSERT OR UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION guard_event_publish_archived();

/**
 * Closes the caller's host profile. Returns how many upcoming events were
 * cancelled, so the client can say what happened.
 */
CREATE OR REPLACE FUNCTION archive_business()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business businesses;
  v_event record;
  v_cancelled integer := 0;
BEGIN
  SELECT * INTO v_business FROM businesses WHERE owner_id = auth.uid();
  IF v_business.id IS NULL THEN
    RAISE EXCEPTION 'no_host_profile' USING ERRCODE = 'P0002';
  END IF;
  IF v_business.archived_at IS NOT NULL THEN
    RETURN 0;   -- already archived
  END IF;

  -- Cancel what people are still waiting on. cancel_event checks ownership
  -- against auth.uid() (the same owner) and notifies attendees.
  FOR v_event IN
    SELECT e.id
      FROM events e
     WHERE e.business_id = v_business.id
       AND COALESCE(e.publish_state, 'published') = 'published'
       AND COALESCE(e.status, 'active') <> 'cancelled'
       AND (e.end_datetime >= now() OR COALESCE(e.is_recurring, false))
  LOOP
    PERFORM cancel_event(v_event.id);
    v_cancelled := v_cancelled + 1;
  END LOOP;

  -- The guard below blocks direct writes; these RPCs announce themselves with
  -- a transaction-local flag, like cancel_event does for status changes.
  PERFORM set_config('eventmap.allow_archive_write', 'true', true);
  UPDATE businesses SET archived_at = now() WHERE id = v_business.id;
  PERFORM set_config('eventmap.allow_archive_write', '', true);
  RETURN v_cancelled;
END;
$$;

REVOKE EXECUTE ON FUNCTION archive_business() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION archive_business() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION reopen_business()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM businesses WHERE owner_id = auth.uid();
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'no_host_profile' USING ERRCODE = 'P0002';
  END IF;
  -- Cancelled events stay cancelled: reopening does not resurrect events
  -- attendees were already told were off.
  PERFORM set_config('eventmap.allow_archive_write', 'true', true);
  UPDATE businesses SET archived_at = NULL WHERE id = v_id;
  PERFORM set_config('eventmap.allow_archive_write', '', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION reopen_business() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reopen_business() TO authenticated, service_role;

-- Owners must not set or clear archived_at directly (it has side effects).
CREATE OR REPLACE FUNCTION guard_business_archived_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR is_admin_user()
     OR COALESCE(current_setting('eventmap.allow_archive_write', true), '') = 'true' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.archived_at := NULL;
    RETURN NEW;
  END IF;
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'not_allowed: use archive_business / reopen_business'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_guard_business_archived ON businesses;
CREATE TRIGGER trigger_guard_business_archived
  BEFORE INSERT OR UPDATE ON businesses
  FOR EACH ROW
  EXECUTE FUNCTION guard_business_archived_column();
