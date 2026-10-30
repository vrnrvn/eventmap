-- Pin search_path on the remaining SECURITY DEFINER functions (MEDIUM).
--
-- Later migrations already create their definer functions with
-- `SET search_path = public`; these older ones were created without a pin:
--
--   20260213092246: reset_monthly_event_counter(uuid),
--                   check_event_creation_limit(uuid)
--   20260213140000 / 20260218120000:
--                   create_event_with_limit_check(12-arg form; the legacy
--                   10-arg overload was dropped in 20261018000000)
--   20260219100400: is_admin_user(), admin_reset_business_event_limit(uuid),
--                   admin_set_business_premium(uuid,boolean),
--                   admin_ban_user(uuid,text), admin_unban_user(uuid)
--   20260221000000: get_user_business()
--
-- Flagged but already pinned by later re-creations (nothing to do):
--   get_event_attendees_public(uuid) and get_user_upcoming_events(uuid)
--   (20260220000001 / 20260222000000) were re-created with a pinned
--   search_path in 20261029110000.
--
-- Guarded with to_regprocedure so the migration is idempotent and tolerant of
-- functions that were dropped or re-created elsewhere.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.reset_monthly_event_counter(uuid)',
    'public.check_event_creation_limit(uuid)',
    'public.create_event_with_limit_check(uuid, text, text, uuid, timestamptz, timestamptz, float8, float8, text, text, boolean, jsonb)',
    'public.get_user_business()',
    'public.is_admin_user()',
    'public.admin_reset_business_event_limit(uuid)',
    'public.admin_set_business_premium(uuid, boolean)',
    'public.admin_ban_user(uuid, text)',
    'public.admin_unban_user(uuid)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', fn);
    END IF;
  END LOOP;
END;
$$;
