-- Phase 3: publishing, lifecycle, details (plan §4B–C, §4G).
--
-- STATUS: prepared, NOT applied to the shared local DB (another dev session
-- owns it). Validated on an isolated scratch copy only. Apply after
-- 20261103140000_event_timezones.sql.
--
--   1. Columns: publish_state (draft|published), visibility (public|unlisted),
--      ticket_url, price_label, age_restriction, accessibility_notes,
--      what_to_bring, status_note; status gains 'postponed'.
--   2. Visibility: public SELECT policy = published + public + not ended +
--      status active/postponed. Drafts are owner-only everywhere (details RPC
--      refuses them to others). Unlisted events are reachable by id through
--      get_event_details (share link) but never listed by get_ranked_events
--      or direct table reads.
--   3. Drafts don't consume the monthly allowance: create_event_with_limit_check
--      gains p_publish_state; publish_event(p_event_id) checks the limit,
--      increments the counter, flips the state and notifies followers (the
--      INSERT trigger now skips drafts and unlisted events).
--   4. Reschedule is the only way to change time/place once anyone is going:
--      trigger d_guard_event_time_changes refuses plain UPDATEs with
--      'reschedule_required'; reschedule_event(...) sets the flag, applies the
--      change, re-activates a postponed event, resets reminders, re-arms the
--      waitlist and sends one "Event rescheduled" notice (with the host's
--      note) instead of the generic "Event updated".
--   5. postpone_event(p_event_id, p_note): status 'postponed' (RSVPs kept,
--      joining closed, still visible), notifies going/interested/savers/waitlist.
--   6. duplicate_event(p_event_id): new DRAFT with the same content, links,
--      photos, zone and settings, dates shifted a week.
--   7. Guard: business_id frozen; publish_state only moves draft→published
--      and only through publish_event.
--
-- Drift note (2026-11-03): a fresh dump of the shared DB already carried
-- hand-applied versions of this work — the seven columns, two extra CHECKs
-- (events_notes_len, events_price_label_len ≤ 80), publish_event(uuid)→void,
-- postpone_event(uuid)→void, reschedule_event(uuid,tstz,tstz,text)→void and a
-- duplicate_event that keeps the original dates. This file converges on one
-- shape: the older overloads are dropped (PostgREST cannot resolve a call
-- when both postpone_event(uuid) and postpone_event(uuid, text DEFAULT) exist),
-- the duplicate CHECKs are dropped in favour of the named ones below, and the
-- json-returning RPCs replace the void ones. supabase-js callers that ignore
-- the return value keep working.

-- 1. Columns ------------------------------------------------------------------

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS publish_state text NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS ticket_url text,
  ADD COLUMN IF NOT EXISTS price_label text,
  ADD COLUMN IF NOT EXISTS age_restriction text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS accessibility_notes text,
  ADD COLUMN IF NOT EXISTS what_to_bring text,
  ADD COLUMN IF NOT EXISTS status_note text;

DO $$ BEGIN
  ALTER TABLE public.events ADD CONSTRAINT events_publish_state_check CHECK (publish_state IN ('draft', 'published'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.events ADD CONSTRAINT events_visibility_check CHECK (visibility IN ('public', 'unlisted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.events ADD CONSTRAINT events_age_restriction_check CHECK (age_restriction IN ('none', '18+', '21+'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.events ADD CONSTRAINT events_ticket_url_check
    CHECK (ticket_url IS NULL OR (char_length(ticket_url) <= 500 AND ticket_url ~* '^https?://'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.events ADD CONSTRAINT events_price_label_check CHECK (price_label IS NULL OR char_length(price_label) <= 60);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.events ADD CONSTRAINT events_accessibility_notes_check CHECK (accessibility_notes IS NULL OR char_length(accessibility_notes) <= 500);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.events ADD CONSTRAINT events_what_to_bring_check CHECK (what_to_bring IS NULL OR char_length(what_to_bring) <= 500);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.events ADD CONSTRAINT events_status_note_check CHECK (status_note IS NULL OR char_length(status_note) <= 300);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Hand-applied duplicates of the named constraints above (see drift note).
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_notes_len;
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_price_label_len;

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE public.events ADD CONSTRAINT events_status_check CHECK (status IN ('active', 'cancelled', 'postponed'));

CREATE INDEX IF NOT EXISTS idx_events_business_publish_state ON public.events (business_id, publish_state);

-- 2. Visibility ----------------------------------------------------------------

DROP POLICY IF EXISTS "Anyone can view active upcoming events" ON events;
CREATE POLICY "Anyone can view active upcoming events"
  ON events
  FOR SELECT
  USING (
    status IN ('active', 'postponed')
    AND publish_state = 'published'
    AND visibility = 'public'
    AND NOT event_has_ended(end_datetime, is_recurring, recurrence_pattern, timezone)
  );

CREATE OR REPLACE FUNCTION public.event_is_open_for_rsvp(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = p_event_id
      AND e.status = 'active'
      AND e.publish_state = 'published'
      AND NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
  );
$function$;

-- get_ranked_events: body identical to 20261103140000 apart from the two
-- '-- added (phase 3)' predicates.
CREATE OR REPLACE FUNCTION public.get_ranked_events(
  user_lat double precision,
  user_lng double precision,
  radius_km double precision DEFAULT 50,
  category_ids uuid[] DEFAULT NULL::uuid[],
  start_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  end_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  search_query text DEFAULT NULL::text,
  result_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, business_id uuid, title text, description text, category_id uuid,
  start_datetime timestamp with time zone, end_datetime timestamp with time zone,
  lat double precision, lng double precision, address text, cover_image_url text,
  created_at timestamp with time zone, distance_km double precision, is_premium boolean,
  rsvp_count bigint, save_count bigint, business_name text, business_logo_url text,
  category_label text, category_slug text, is_recurring boolean, recurrence_pattern jsonb,
  user_rsvp text, user_saved boolean,
  next_start_datetime timestamp with time zone, max_attendees integer, has_ended boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- Clamp so a client can't ask for the whole table in one call.
  v_limit integer := LEAST(GREATEST(COALESCE(result_limit, 100), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_radius double precision := GREATEST(COALESCE(radius_km, 50), 0.1);
  -- Degree deltas for a cheap bounding box, so idx_events_lat_lng can be used
  -- before the (much more expensive) haversine runs. Generous at high
  -- latitudes; the exact distance filter below still applies.
  v_dlat double precision := (v_radius / 111.045);
  v_dlng double precision := (v_radius / GREATEST(111.045 * cos(radians(user_lat)), 0.001));
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT
      e.*,
      calculate_distance(user_lat, user_lng, e.lat, e.lng) AS dist_km,
      event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern, e.timezone) AS next_start
    FROM events e
    WHERE e.status = 'active'
      AND e.publish_state = 'published'                                  -- added (phase 3)
      AND e.visibility = 'public'                                        -- added (phase 3)
      AND e.lat BETWEEN user_lat - v_dlat AND user_lat + v_dlat
      AND e.lng BETWEEN user_lng - v_dlng AND user_lng + v_dlng
      AND NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
  ),
  scored AS (
    SELECT
      c.*,
      b.name AS biz_name,
      b.logo_url AS biz_logo,
      b.subscription_tier,
      cat.label AS cat_label,
      cat.slug AS cat_slug,
      COALESCE(rc.count, 0) AS going_count,
      COALESCE(sc.count, 0) AS saves_count,
      -- Hours until the next occurrence; already-running events get 0.
      GREATEST(EXTRACT(EPOCH FROM (c.next_start - now())) / 3600.0, 0) AS hours_away
    FROM candidate c
    JOIN businesses b ON b.id = c.business_id
    JOIN categories cat ON cat.id = c.category_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS count FROM rsvps r
      WHERE r.event_id = c.id AND r.status = 'going'
    ) rc ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS count FROM saves s WHERE s.event_id = c.id
    ) sc ON true
    WHERE c.dist_km <= v_radius
      AND NOT EXISTS (SELECT 1 FROM banned_users bu WHERE bu.user_id = b.owner_id)
      AND (category_ids IS NULL OR c.category_id = ANY(category_ids))
      AND (
        search_query IS NULL
        OR c.title ILIKE '%' || search_query || '%'
        OR c.description ILIKE '%' || search_query || '%'
        OR b.name ILIKE '%' || search_query || '%'
      )
      -- Date filter. One-offs: the next (only) occurrence must fall inside the
      -- window. Recurring: the series must overlap the window — its next
      -- occurrence may be before the window (e.g. a daily event when the
      -- user picks "this weekend") while later ones fall inside it, so we
      -- test overlap here and let the client's filterEventsByDateRange pick
      -- the exact occurrences.
      AND (
        (NOT COALESCE(c.is_recurring, false)
          AND (start_date IS NULL OR c.next_start >= start_date)
          AND (end_date IS NULL OR c.next_start <= end_date))
        OR
        (COALESCE(c.is_recurring, false)
          AND (end_date IS NULL OR c.next_start <= end_date)
          AND (
            start_date IS NULL
            OR (c.recurrence_pattern->>'endDate') IS NULL
            OR (c.recurrence_pattern->>'endDate') !~ '^\d{4}-\d{2}-\d{2}'
            OR left(c.recurrence_pattern->>'endDate', 10)::date >= start_date::date
          ))
      )
  )
  SELECT
    s.id,
    s.business_id,
    s.title,
    s.description,
    s.category_id,
    s.start_datetime,
    s.end_datetime,
    s.lat,
    s.lng,
    s.address,
    COALESCE(
      s.cover_image_url,
      (SELECT ep.image_url FROM event_photos ep WHERE ep.event_id = s.id ORDER BY ep.sort_order ASC LIMIT 1)
    ) AS cover_image_url,
    s.created_at,
    s.dist_km AS distance_km,
    (s.subscription_tier = 'premium') AS is_premium,
    s.going_count AS rsvp_count,
    s.saves_count AS save_count,
    s.biz_name AS business_name,
    s.biz_logo AS business_logo_url,
    s.cat_label AS category_label,
    s.cat_slug AS category_slug,
    COALESCE(s.is_recurring, false) AS is_recurring,
    s.recurrence_pattern,
    (SELECT ur.status FROM rsvps ur WHERE ur.event_id = s.id AND ur.user_id = auth.uid() LIMIT 1) AS user_rsvp,
    EXISTS (SELECT 1 FROM saves us WHERE us.event_id = s.id AND us.user_id = auth.uid()) AS user_saved,
    s.next_start AS next_start_datetime,
    s.max_attendees,
    false AS has_ended
  FROM scored s
  ORDER BY
    (
      -- Proximity: 1.0 at the viewer, decaying to ~0 at the radius edge.
      (1.0 - LEAST(s.dist_km / v_radius, 1.0)) * 1.0
      -- Imminence: full weight today, half at ~3 days, small past a week.
      + (1.0 / (1.0 + (s.hours_away / 72.0))) * 0.8
      -- Popularity: log-damped so a big event can't bury everything nearby.
      + LEAST(ln(1 + s.going_count) / 4.0, 1.0) * 0.3
      -- Premium: a real but bounded boost, not a separate tier.
      + CASE WHEN s.subscription_tier = 'premium' THEN 0.25 ELSE 0 END
    ) DESC,
    s.next_start ASC,
    s.id
  LIMIT v_limit
  OFFSET v_offset;
END;
$function$;

-- get_event_details: body identical to 20261102160000 plus the draft guard.
CREATE OR REPLACE FUNCTION public.get_event_details(event_uuid uuid)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  result json;
  v_draft boolean;
  v_owner uuid;
BEGIN
  -- Drafts are the host's alone (phase 3). Unlisted events stay reachable by
  -- id here: that is the share-link path.
  SELECT e.publish_state = 'draft', b.owner_id INTO v_draft, v_owner
  FROM events e JOIN businesses b ON b.id = e.business_id WHERE e.id = event_uuid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_draft AND NOT (v_owner = auth.uid() OR is_admin_user()) THEN RETURN NULL; END IF;

  SELECT json_build_object(
    'event', row_to_json(e.*),
    'business', row_to_json(b.*),
    'category', row_to_json(c.*),
    'links', COALESCE(
      (SELECT json_agg(row_to_json(el.*) ORDER BY el.sort_order)
       FROM event_links el
       WHERE el.event_id = e.id),
      '[]'::json
    ),
    'photos', COALESCE(
      (SELECT json_agg(row_to_json(ep.*) ORDER BY ep.sort_order)
       FROM event_photos ep
       WHERE ep.event_id = e.id),
      '[]'::json
    ),
    'rsvp_count', (
      SELECT COUNT(*) FROM rsvps WHERE event_id = e.id AND status = 'going'
    ),
    'save_count', (
      SELECT COUNT(*) FROM saves WHERE event_id = e.id
    ),
    'user_rsvp', (
      SELECT status FROM rsvps
      WHERE event_id = e.id AND user_id = auth.uid()
    ),
    'user_saved', (
      SELECT EXISTS(
        SELECT 1 FROM saves
        WHERE event_id = e.id AND user_id = auth.uid()
      )
    ),
    'user_following_business', (
      SELECT EXISTS(
        SELECT 1 FROM follows
        WHERE business_id = b.id AND user_id = auth.uid()
      )
    ),
    'waitlist', json_build_object(                                   -- added
      'count', (SELECT COUNT(*) FROM event_waitlist w WHERE w.event_id = e.id),
      'position', (
        SELECT COUNT(*) FROM event_waitlist w
        WHERE w.event_id = e.id
          AND w.created_at <= (SELECT mine.created_at FROM event_waitlist mine
                               WHERE mine.event_id = e.id AND mine.user_id = auth.uid())
      ),
      'notified_at', (SELECT w.notified_at FROM event_waitlist w WHERE w.event_id = e.id AND w.user_id = auth.uid())
    )
  ) INTO result
  FROM events e
  JOIN businesses b ON b.id = e.business_id
  JOIN categories c ON c.id = e.category_id
  WHERE e.id = event_uuid;

  RETURN result;
END;
$function$;

-- 7. Guards ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_event_publishing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_allow_publish boolean :=
    COALESCE(current_setting('eventmap.allow_publish_change', true), '') = 'true';
BEGIN
  IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'not_allowed: an event cannot move to another business';
  END IF;
  IF NEW.publish_state IS DISTINCT FROM OLD.publish_state THEN
    IF NOT v_allow_publish THEN
      RAISE EXCEPTION 'not_allowed: use publish_event to publish a draft';
    END IF;
    IF OLD.publish_state = 'published' AND NEW.publish_state = 'draft' THEN
      RAISE EXCEPTION 'not_allowed: a published event cannot go back to draft';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS a2_protect_event_publishing ON events;
CREATE TRIGGER a2_protect_event_publishing
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION protect_event_publishing();

-- 4. Time/place changes need the reschedule path once anyone is going -----------

CREATE OR REPLACE FUNCTION public.guard_event_time_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_allow boolean := COALESCE(current_setting('eventmap.allow_reschedule', true), '') = 'true';
  v_going bigint;
BEGIN
  IF v_allow OR NEW.publish_state = 'draft' THEN RETURN NEW; END IF;
  IF OLD.start_datetime IS NOT DISTINCT FROM NEW.start_datetime
     AND OLD.end_datetime IS NOT DISTINCT FROM NEW.end_datetime
     AND OLD.address IS NOT DISTINCT FROM NEW.address
     AND OLD.lat IS NOT DISTINCT FROM NEW.lat
     AND OLD.lng IS NOT DISTINCT FROM NEW.lng THEN
    RETURN NEW;
  END IF;
  SELECT COUNT(*) INTO v_going FROM rsvps r WHERE r.event_id = NEW.id AND r.status = 'going';
  IF v_going > 0 THEN
    RAISE EXCEPTION 'reschedule_required: % people are going; use reschedule_event', v_going;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS d_guard_event_time_changes ON events;
CREATE TRIGGER d_guard_event_time_changes
  BEFORE UPDATE OF start_datetime, end_datetime, address, lat, lng ON events
  FOR EACH ROW
  EXECUTE FUNCTION guard_event_time_changes();

-- The generic "Event updated" notice steps aside when reschedule_event sends
-- its own richer one. Body otherwise identical to 20261102100000.
CREATE OR REPLACE FUNCTION public.notify_rsvp_users_on_event_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(current_setting('eventmap.skip_update_notice', true), '') = 'true' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM 'active' OR NEW.publish_state <> 'published' THEN
    RETURN NEW;
  END IF;

  IF OLD.start_datetime IS NOT DISTINCT FROM NEW.start_datetime
     AND OLD.end_datetime IS NOT DISTINCT FROM NEW.end_datetime
     AND OLD.address IS NOT DISTINCT FROM NEW.address
     AND OLD.lat IS NOT DISTINCT FROM NEW.lat
     AND OLD.lng IS NOT DISTINCT FROM NEW.lng THEN
    RETURN NEW;
  END IF;

  IF OLD.start_datetime IS DISTINCT FROM NEW.start_datetime THEN
    DELETE FROM event_reminder_sent WHERE event_id = NEW.id;
  END IF;

  INSERT INTO notifications (user_id, type, title, body, event_id)
  SELECT
    r.user_id,
    'event_update',
    'Event updated',
    '"' || COALESCE(NEW.title, 'Event') || '" has been updated. Check the new details.',
    NEW.id
  FROM rsvps r
  JOIN profiles p ON p.id = r.user_id
  WHERE r.event_id = NEW.id
    -- 'requested' exists once 20261103170000 is applied; they asked to join,
    -- so a changed event is news to them too.
    AND r.status IN ('going', 'interested', 'requested')
    AND r.user_id != (SELECT owner_id FROM businesses WHERE id = NEW.business_id)
    AND COALESCE((p.notification_preferences->>'event_update')::boolean, true) = true;

  RETURN NEW;
END;
$function$;

-- Older hand-applied overload (see drift note); keeping both would make
-- PostgREST calls with four named args ambiguous.
DROP FUNCTION IF EXISTS public.reschedule_event(uuid, timestamptz, timestamptz, text);

CREATE OR REPLACE FUNCTION public.reschedule_event(
  p_event_id uuid,
  p_start_datetime timestamptz,
  p_end_datetime timestamptz,
  p_note text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_when text;
  v_tz text;
  v_time_changed boolean;
  v_place_changed boolean;
  v_recipients integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_start_datetime IS NULL OR p_end_datetime IS NULL OR p_end_datetime <= p_start_datetime THEN
    RAISE EXCEPTION 'invalid_dates: end must be after start';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 300 THEN RAISE EXCEPTION 'invalid_note: too long'; END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = v_event.business_id;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can reschedule';
  END IF;
  IF v_event.status = 'cancelled' THEN RAISE EXCEPTION 'event_cancelled: cancelled events cannot be rescheduled'; END IF;

  v_time_changed := v_event.start_datetime IS DISTINCT FROM p_start_datetime
                 OR v_event.end_datetime IS DISTINCT FROM p_end_datetime;
  v_place_changed := p_address IS NOT NULL AND (p_address IS DISTINCT FROM v_event.address
                 OR p_lat IS DISTINCT FROM v_event.lat OR p_lng IS DISTINCT FROM v_event.lng);

  PERFORM set_config('eventmap.allow_reschedule', 'true', true);
  PERFORM set_config('eventmap.skip_update_notice', 'true', true);
  PERFORM set_config('eventmap.allow_status_change', 'true', true);
  UPDATE events
  SET start_datetime = p_start_datetime,
      end_datetime = p_end_datetime,
      address = COALESCE(p_address, address),
      lat = COALESCE(p_lat, lat),
      lng = COALESCE(p_lng, lng),
      status = CASE WHEN status = 'postponed' THEN 'active' ELSE status END,
      status_note = CASE WHEN status = 'postponed' THEN NULL ELSE status_note END
  WHERE id = p_event_id
  RETURNING * INTO v_event;
  PERFORM set_config('eventmap.allow_reschedule', '', true);
  PERFORM set_config('eventmap.skip_update_notice', '', true);
  PERFORM set_config('eventmap.allow_status_change', '', true);

  IF v_time_changed THEN
    DELETE FROM event_reminder_sent WHERE event_id = p_event_id;
    -- Waitlisted people may be told again about free seats for the new date.
    UPDATE event_waitlist SET notified_at = NULL WHERE event_id = p_event_id;
  END IF;

  IF v_event.publish_state = 'published' AND (v_time_changed OR v_place_changed) THEN
    v_tz := COALESCE(NULLIF(v_event.timezone, ''), 'UTC');
    v_when := to_char(v_event.start_datetime AT TIME ZONE v_tz, 'Dy, Mon DD, HH12:MI AM')
              || CASE WHEN v_event.timezone IS NULL THEN ' UTC' ELSE '' END;
    WITH ins AS (
      INSERT INTO notifications (user_id, type, title, body, event_id, data)
      SELECT DISTINCT s.user_id, 'event_update',
             CASE WHEN v_time_changed THEN 'Event rescheduled' ELSE 'Event location changed' END,
             '"' || COALESCE(v_event.title, 'Event') || '"'
               || CASE WHEN v_time_changed THEN ' now starts ' || v_when ELSE ' has a new location: ' || v_event.address END
               || '.' || CASE WHEN v_note IS NULL THEN '' ELSE ' ' || v_note END,
             p_event_id,
             jsonb_build_object('eventId', p_event_id, 'kind', CASE WHEN v_time_changed THEN 'rescheduled' ELSE 'relocated' END)
      FROM (
        SELECT r.user_id FROM rsvps r WHERE r.event_id = p_event_id AND r.status IN ('going', 'interested', 'requested')
        UNION
        SELECT w.user_id FROM event_waitlist w WHERE w.event_id = p_event_id
      ) s
      JOIN profiles p ON p.id = s.user_id
      WHERE s.user_id IS DISTINCT FROM v_owner
        AND COALESCE((p.notification_preferences->>'event_update')::boolean, true)
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_recipients FROM ins;
  END IF;

  RETURN json_build_object('status', v_event.status, 'notified', v_recipients);
END;
$function$;

REVOKE ALL ON FUNCTION public.reschedule_event(uuid, timestamptz, timestamptz, text, text, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_event(uuid, timestamptz, timestamptz, text, text, double precision, double precision) TO authenticated;

-- 5. Postpone --------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.postpone_event(uuid);

CREATE OR REPLACE FUNCTION public.postpone_event(p_event_id uuid, p_note text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_recipients integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 300 THEN RAISE EXCEPTION 'invalid_note: too long'; END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = v_event.business_id;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can postpone';
  END IF;
  IF v_event.status = 'cancelled' THEN RAISE EXCEPTION 'event_cancelled'; END IF;
  IF v_event.status = 'postponed' THEN
    RETURN json_build_object('status', 'postponed', 'notified', 0);
  END IF;

  PERFORM set_config('eventmap.allow_status_change', 'true', true);
  UPDATE events SET status = 'postponed', status_note = v_note WHERE id = p_event_id;
  PERFORM set_config('eventmap.allow_status_change', '', true);

  DELETE FROM event_reminder_sent WHERE event_id = p_event_id;

  IF v_event.publish_state = 'published' THEN
    WITH ins AS (
      INSERT INTO notifications (user_id, type, title, body, event_id, data)
      SELECT DISTINCT s.user_id, 'event_update', 'Event postponed',
             '"' || COALESCE(v_event.title, 'Event') || '" has been postponed; a new date is coming. Your RSVP is kept.'
               || CASE WHEN v_note IS NULL THEN '' ELSE ' ' || v_note END,
             p_event_id,
             jsonb_build_object('eventId', p_event_id, 'kind', 'postponed')
      FROM (
        SELECT r.user_id FROM rsvps r WHERE r.event_id = p_event_id AND r.status IN ('going', 'interested', 'requested')
        UNION SELECT sv.user_id FROM saves sv WHERE sv.event_id = p_event_id
        UNION SELECT w.user_id FROM event_waitlist w WHERE w.event_id = p_event_id
      ) s
      JOIN profiles p ON p.id = s.user_id
      WHERE s.user_id IS DISTINCT FROM v_owner
        AND COALESCE((p.notification_preferences->>'event_update')::boolean, true)
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_recipients FROM ins;
  END IF;

  RETURN json_build_object('status', 'postponed', 'notified', v_recipients);
END;
$function$;

REVOKE ALL ON FUNCTION public.postpone_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.postpone_event(uuid, text) TO authenticated;

-- 3. Drafts and publishing --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_followers_for_event(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  WITH ins AS (
    INSERT INTO notifications (user_id, type, title, body, event_id, business_id)
    SELECT
      f.user_id,
      'new_event_from_followed',
      b.name || ' posted a new event',
      e.title,
      e.id,
      e.business_id
    FROM events e
    JOIN businesses b ON b.id = e.business_id
    JOIN follows f ON f.business_id = e.business_id
    JOIN profiles p ON p.id = f.user_id
    WHERE e.id = p_event_id
      AND e.publish_state = 'published'
      AND e.visibility = 'public'
      AND f.user_id != b.owner_id
      AND COALESCE((p.notification_preferences->>'new_event_from_followed')::boolean, true) = true
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = f.user_id AND n.event_id = e.id AND n.type = 'new_event_from_followed'
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM ins;
  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.notify_followers_for_event(uuid) FROM PUBLIC, anon, authenticated;

-- INSERT trigger: drafts and unlisted events don't ping followers.
CREATE OR REPLACE FUNCTION public.notify_followers_on_new_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.publish_state = 'published' THEN
    PERFORM notify_followers_for_event(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

-- Hand-applied version returned void; the return type cannot be changed in place.
DROP FUNCTION IF EXISTS public.publish_event(uuid);

CREATE OR REPLACE FUNCTION public.publish_event(p_event_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_business businesses%ROWTYPE;
  v_notified integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF user_is_banned(auth.uid()) THEN RAISE EXCEPTION 'not_allowed: account suspended'; END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  SELECT * INTO v_business FROM businesses WHERE id = v_event.business_id FOR UPDATE;
  IF NOT (v_business.owner_id = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can publish';
  END IF;
  IF v_event.publish_state = 'published' THEN
    RETURN json_build_object('publish_state', 'published', 'notified', 0);
  END IF;
  IF v_event.status = 'cancelled' THEN RAISE EXCEPTION 'event_cancelled'; END IF;
  IF event_has_ended(v_event.end_datetime, v_event.is_recurring, v_event.recurrence_pattern, v_event.timezone) THEN
    RAISE EXCEPTION 'invalid_dates: the event is already over';
  END IF;

  IF NOT check_event_creation_limit(v_event.business_id) THEN
    RAISE EXCEPTION 'Event creation limit reached for this month. Upgrade to Premium for more events.';
  END IF;

  PERFORM set_config('eventmap.allow_publish_change', 'true', true);
  UPDATE events SET publish_state = 'published' WHERE id = p_event_id;
  PERFORM set_config('eventmap.allow_publish_change', '', true);

  UPDATE businesses
  SET events_created_this_month = events_created_this_month + 1
  WHERE id = v_event.business_id;

  v_notified := notify_followers_for_event(p_event_id);
  RETURN json_build_object('publish_state', 'published', 'notified', v_notified);
END;
$function$;

REVOKE ALL ON FUNCTION public.publish_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_event(uuid) TO authenticated;

-- 6. Duplicate --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.duplicate_event(p_event_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
  v_new_id uuid;
  v_shift interval;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF user_is_banned(auth.uid()) THEN RAISE EXCEPTION 'not_allowed: account suspended'; END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = v_event.business_id;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can duplicate';
  END IF;

  -- A week after the original, or a week from now when the original is past.
  v_shift := CASE WHEN v_event.start_datetime > now() THEN interval '7 days'
                  ELSE (now() + interval '7 days') - v_event.start_datetime END;

  INSERT INTO events (
    business_id, title, description, category_id,
    start_datetime, end_datetime, lat, lng, address,
    cover_image_url, is_recurring, recurrence_pattern, max_attendees,
    rsvp_closed, waitlist_mode, timezone,
    publish_state, visibility, ticket_url, price_label, age_restriction, accessibility_notes, what_to_bring,
    status
  ) VALUES (
    v_event.business_id, left(v_event.title || ' (copy)', 200), v_event.description, v_event.category_id,
    v_event.start_datetime + v_shift, v_event.end_datetime + v_shift, v_event.lat, v_event.lng, v_event.address,
    v_event.cover_image_url, false, NULL, v_event.max_attendees,
    false, v_event.waitlist_mode, v_event.timezone,
    'draft', v_event.visibility, v_event.ticket_url, v_event.price_label, v_event.age_restriction, v_event.accessibility_notes, v_event.what_to_bring,
    'active'
  )
  RETURNING id INTO v_new_id;

  INSERT INTO event_links (event_id, label, url, sort_order)
  SELECT v_new_id, l.label, l.url, l.sort_order FROM event_links l WHERE l.event_id = p_event_id;

  INSERT INTO event_photos (event_id, image_url, sort_order)
  SELECT v_new_id, ph.image_url, ph.sort_order FROM event_photos ph WHERE ph.event_id = p_event_id;

  RETURN v_new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.duplicate_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.duplicate_event(uuid) TO authenticated;

-- create_event_with_limit_check: body identical to 20261103140000 apart from
-- the '-- added (phase 3)' lines.
DROP FUNCTION IF EXISTS public.create_event_with_limit_check(
  uuid, text, text, uuid, timestamptz, timestamptz, double precision, double precision, text, text, boolean, jsonb, integer, text
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
  p_publish_state text DEFAULT 'published'::text
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

  IF user_is_banned(auth.uid()) THEN                              -- added
    RAISE EXCEPTION 'not_allowed: account suspended';
  END IF;

  -- Lock the business row: the limit check and the counter increment below
  -- are now serialized across concurrent calls.                 -- added
  SELECT * INTO v_business
  FROM businesses
  WHERE id = p_business_id AND owner_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You do not own this business';
  END IF;

  -- Basic shape checks the table doesn't enforce.                -- added
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
  IF p_max_attendees IS NOT NULL AND p_max_attendees <= 0 THEN                -- added
    RAISE EXCEPTION 'invalid_capacity: must be a positive number';
  END IF;
  IF p_timezone IS NOT NULL AND NOT is_valid_time_zone(p_timezone) THEN       -- added (tz)
    RAISE EXCEPTION 'invalid_timezone';
  END IF;
  IF p_publish_state NOT IN ('draft', 'published') THEN                        -- added (phase 3)
    RAISE EXCEPTION 'invalid_publish_state';
  END IF;
  IF COALESCE(p_is_recurring, false) AND p_recurrence_pattern IS NULL THEN
    RAISE EXCEPTION 'invalid_recurrence: recurring events need a pattern';
  END IF;

  -- Recurring events require premium subscription
  IF COALESCE(p_is_recurring, false) AND v_business.subscription_tier <> 'premium' THEN
    RAISE EXCEPTION 'Recurring events are only available for Premium businesses. Upgrade to create recurring events.';
  END IF;

  -- Drafts don't consume the monthly allowance; publish_event checks it later.
  IF p_publish_state = 'published' THEN                                        -- added (phase 3)
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
    publish_state
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
    p_publish_state
  )
  RETURNING id INTO new_event_id;

  IF p_publish_state = 'published' THEN                                        -- added (phase 3)
    UPDATE businesses
    SET events_created_this_month = events_created_this_month + 1
    WHERE id = p_business_id;
  END IF;

  RETURN new_event_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_event_with_limit_check(
  uuid, text, text, uuid, timestamptz, timestamptz, double precision, double precision, text, text, boolean, jsonb, integer, text, text
) TO authenticated;
