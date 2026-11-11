-- Host onboarding Stage 4 foundations (docs/HOST_ONBOARDING_PLAN.md §13):
-- one read for the getting-started checklist.
--
-- Returns what the server knows about the caller's own host profile as a
-- jsonb object (parsed defensively by utils/hostChecklist.parseHostStatus):
--   has_logo, has_description, notifications_enabled   booleans
--   published_events, events_with_capacity,
--   announcements, recurring_events                     counts
-- Device-only signals (a share, opening Manage event) stay on the device.
--
-- Caller-scoped through auth.uid(); returns NULL for someone with no host
-- profile. Read-only, STABLE, no new tables or columns. Idempotent.

CREATE OR REPLACE FUNCTION get_host_onboarding_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'has_logo',              b.logo_url IS NOT NULL AND btrim(b.logo_url) <> '',
    'has_description',       btrim(COALESCE(b.description, '')) <> '',
    'notifications_enabled', COALESCE(b.notifications_enabled, true),
    'published_events',      (SELECT count(*) FROM events e
                               WHERE e.business_id = b.id AND e.publish_state = 'published'),
    'events_with_capacity',  (SELECT count(*) FROM events e
                               WHERE e.business_id = b.id AND e.max_attendees IS NOT NULL),
    'recurring_events',      (SELECT count(*) FROM events e
                               WHERE e.business_id = b.id AND e.is_recurring),
    'announcements',         (SELECT count(*) FROM host_announcements a
                               JOIN events e ON e.id = a.event_id
                              WHERE e.business_id = b.id)
  )
  FROM businesses b
  WHERE b.owner_id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION get_host_onboarding_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_host_onboarding_status() TO authenticated, service_role;

COMMENT ON FUNCTION get_host_onboarding_status() IS
  'Getting-started checklist facts for the caller''s host profile (jsonb), or NULL without one.';
