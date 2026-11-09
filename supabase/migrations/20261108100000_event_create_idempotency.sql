-- Applied to the local database on 2026-11-08; hosted databases are separate.
--
-- Event create idempotency (docs/ISSUES.md "Publishing twice creates a
-- duplicate"). A lost response followed by a second Publish used to insert a
-- second event and consume a second monthly slot.
--
--   1. events.client_request_id: a uuid the create form generates once per
--      form session; unique per business.
--   2. create_event_with_limit_check gains p_client_request_id (DEFAULT NULL).
--      When a row with the same (business_id, client_request_id) exists it
--      returns that id: no new row, no second slot. The check runs after the
--      business row lock, so two racing calls with one key are serialized.
--
-- The client (services/events.ts createEvent) sends the key and, while this
-- file is unapplied, retries without it (PGRST202) and falls back to a
-- best-effort lookup of the event it may already have created.
--
-- Body identical to 20261103150000 apart from the lines marked '-- idem' and
-- the recurring check, which now uses business_has_premium() (expiry-aware;
-- see 20261108110000_premium_expiry_enforcement.sql).

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS client_request_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS events_business_client_request_id_key
  ON public.events (business_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.create_event_with_limit_check(
  uuid, text, text, uuid, timestamptz, timestamptz, double precision, double precision, text, text, boolean, jsonb, integer, text, text
);

CREATE OR REPLACE FUNCTION public.create_event_with_limit_check(
  p_business_id uuid,
  p_title text,
  p_description text,
  p_category_id uuid,
  p_start_datetime timestamp with time zone,
  p_end_datetime timestamp with time zone,
  p_lat double precision,
  p_lng double precision,
  p_address text,
  p_cover_image_url text DEFAULT NULL::text,
  p_is_recurring boolean DEFAULT false,
  p_recurrence_pattern jsonb DEFAULT NULL::jsonb,
  p_max_attendees integer DEFAULT NULL::integer,
  p_timezone text DEFAULT NULL::text,
  p_publish_state text DEFAULT 'published'::text,
  p_client_request_id uuid DEFAULT NULL::uuid                                  -- idem
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_event_id uuid;
  can_create boolean;
  v_business businesses%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF user_is_banned(auth.uid()) THEN
    RAISE EXCEPTION 'not_allowed: account suspended';
  END IF;

  -- Lock the business row: the limit check, the counter increment and the
  -- idempotency lookup below are serialized across concurrent calls.
  SELECT * INTO v_business
  FROM businesses
  WHERE id = p_business_id AND owner_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You do not own this business';
  END IF;

  -- A retry of a create that already succeeded: hand back the same event.   -- idem
  IF p_client_request_id IS NOT NULL THEN                                      -- idem
    SELECT id INTO new_event_id                                                -- idem
    FROM events                                                                -- idem
    WHERE business_id = p_business_id AND client_request_id = p_client_request_id; -- idem
    IF FOUND THEN                                                              -- idem
      RETURN new_event_id;                                                     -- idem
    END IF;                                                                    -- idem
  END IF;                                                                      -- idem

  IF length(btrim(COALESCE(p_title, ''))) = 0 THEN
    RAISE EXCEPTION 'invalid_title: title is required';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN
    RAISE EXCEPTION 'invalid_location: coordinates out of range';
  END IF;
  IF p_end_datetime <= p_start_datetime THEN
    RAISE EXCEPTION 'invalid_dates: end must be after start';
  END IF;
  IF p_max_attendees IS NOT NULL AND p_max_attendees <= 0 THEN
    RAISE EXCEPTION 'invalid_capacity: must be a positive number';
  END IF;
  IF p_timezone IS NOT NULL AND NOT is_valid_time_zone(p_timezone) THEN
    RAISE EXCEPTION 'invalid_timezone';
  END IF;
  IF p_publish_state NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'invalid_publish_state';
  END IF;
  IF COALESCE(p_is_recurring, false) AND p_recurrence_pattern IS NULL THEN
    RAISE EXCEPTION 'invalid_recurrence: recurring events need a pattern';
  END IF;

  -- Recurring events require premium subscription
  IF COALESCE(p_is_recurring, false) AND NOT business_has_premium(p_business_id) THEN -- expiry-aware
    RAISE EXCEPTION 'Recurring events are only available for Premium businesses. Upgrade to create recurring events.';
  END IF;

  -- Drafts don't consume the monthly allowance; publish_event checks it later.
  IF p_publish_state = 'published' THEN
    can_create := check_event_creation_limit(p_business_id);
    IF NOT can_create THEN
      RAISE EXCEPTION 'Event creation limit reached for this month. Upgrade to Premium for more events.';
    END IF;
  END IF;

  INSERT INTO events (
    business_id,
    title,
    description,
    category_id,
    start_datetime,
    end_datetime,
    lat,
    lng,
    address,
    cover_image_url,
    is_recurring,
    recurrence_pattern,
    max_attendees,
    timezone,
    publish_state,
    client_request_id                                                          -- idem
  ) VALUES (
    p_business_id,
    btrim(p_title),
    COALESCE(p_description, ''),
    p_category_id,
    p_start_datetime,
    p_end_datetime,
    p_lat,
    p_lng,
    COALESCE(p_address, ''),
    p_cover_image_url,
    COALESCE(p_is_recurring, false),
    p_recurrence_pattern,
    p_max_attendees,
    p_timezone,
    p_publish_state,
    p_client_request_id                                                        -- idem
  )
  RETURNING id INTO new_event_id;

  IF p_publish_state = 'published' THEN
    UPDATE businesses
    SET events_created_this_month = events_created_this_month + 1
    WHERE id = p_business_id;
  END IF;

  RETURN new_event_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_event_with_limit_check(
  uuid, text, text, uuid, timestamptz, timestamptz, double precision, double precision, text, text, boolean, jsonb, integer, text, text, uuid
) TO authenticated;
