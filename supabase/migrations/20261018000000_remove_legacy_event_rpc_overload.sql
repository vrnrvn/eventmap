-- The recurrence-aware RPC replaced this signature, but CREATE OR REPLACE with
-- additional arguments left the old overload behind. PostgREST cannot resolve
-- calls which rely on defaults shared by both overloads.
DROP FUNCTION IF EXISTS public.create_event_with_limit_check(
  uuid, text, text, uuid, timestamptz, timestamptz, float8, float8, text, text
);
