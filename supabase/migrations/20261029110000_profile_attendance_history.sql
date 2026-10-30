-- Profile attendance: server-side privacy for user event lists, an upcoming/past
-- split that uses the event end time (and recurrence end date) instead of the
-- start time, attendance counts for the profile header, and anonymous attendee
-- ids that no longer expose the underlying user id.
--
-- Public surface after this migration:
--   get_user_going_events(user_id, scope, limit, offset)  -> json array
--   get_user_upcoming_events(user_id)                      -> json array (kept, thin wrapper)
--   get_user_past_events(user_id, limit, offset)           -> json array (owner only)
--   get_user_attendance_counts(user_id)                    -> json object
--   get_user_saved_events(limit, offset)                   -> json array (caller's own saves)
--   get_event_attendees_public(event_id)                   -> json array (anon id fixed)
--   track_event_view(event_id)                             -> void (ON CONFLICT fixed)
--   get_event_attendees_page(event_id, limit, offset, q)   -> json {total, items, has_more}
--   send_event_reminders()                                 -> going + interested reminders

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Whether the caller may see another user's "going" list. Owners always can.
-- Others need the target to be a visible profile that shares future events.
-- Anonymous callers never can.
CREATE OR REPLACE FUNCTION can_view_user_events(target_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN auth.uid() = target_user THEN true
    ELSE EXISTS (
      SELECT 1
      FROM profiles p
      WHERE p.id = target_user
        AND COALESCE(p.is_profile_private, false) = false
        AND COALESCE(p.show_future_events, true) = true
    )
  END;
$$;

-- Single definition of "this event is over" shared by the attendance RPCs.
-- One-off events end at end_datetime. Recurring events end when their
-- recurrence end date has passed; without an end date they never end.
CREATE OR REPLACE FUNCTION event_has_ended(
  p_end_datetime timestamptz,
  p_is_recurring boolean,
  p_recurrence_pattern jsonb
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  -- Never returns NULL: callers compare the result with a boolean, and a NULL
  -- here would silently drop the row (open-ended recurring events, for one).
  SELECT CASE
    WHEN NOT COALESCE(p_is_recurring, false) THEN p_end_datetime <= now()
    WHEN COALESCE(p_recurrence_pattern->>'endDate', '') ~ '^\d{4}-\d{2}-\d{2}'
      THEN left(p_recurrence_pattern->>'endDate', 10)::date < CURRENT_DATE
    ELSE false
  END;
$$;

-- Next time an event happens, used to order the upcoming list. One-off events
-- (and recurring events that have not started yet) return their start time.
-- Recurring events that already started return the next occurrence on or
-- after now, following the client-side pattern: daily/weekly step by the
-- interval, monthly keeps the day-of-month.
CREATE OR REPLACE FUNCTION event_next_occurrence(
  p_start_datetime timestamptz,
  p_is_recurring boolean,
  p_recurrence_pattern jsonb
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_freq text;
  v_step integer;
  v_elapsed_steps numeric;
  v_candidate timestamptz;
  v_months integer;
BEGIN
  IF NOT COALESCE(p_is_recurring, false) OR p_start_datetime >= now() OR p_recurrence_pattern IS NULL THEN
    RETURN p_start_datetime;
  END IF;

  v_freq := p_recurrence_pattern->>'frequency';
  v_step := GREATEST(COALESCE(NULLIF(p_recurrence_pattern->>'interval', '')::integer, 1), 1);

  IF v_freq = 'daily' OR v_freq = 'weekly' THEN
    IF v_freq = 'weekly' THEN
      v_step := v_step * 7;
    END IF;
    v_elapsed_steps := ceil(extract(epoch FROM (now() - p_start_datetime)) / (86400.0 * v_step));
    RETURN p_start_datetime + (v_elapsed_steps * v_step) * interval '1 day';
  ELSIF v_freq = 'monthly' THEN
    v_months := (extract(year FROM now())::integer - extract(year FROM p_start_datetime)::integer) * 12
              + (extract(month FROM now())::integer - extract(month FROM p_start_datetime)::integer);
    v_months := GREATEST(v_months, 0);
    v_months := v_months - (v_months % v_step);
    v_candidate := p_start_datetime + (v_months * interval '1 month');
    WHILE v_candidate < now() LOOP
      v_candidate := v_candidate + (v_step * interval '1 month');
    END LOOP;
    RETURN v_candidate;
  END IF;

  -- Unknown frequency: fall back to the start time so the row still sorts.
  RETURN p_start_datetime;
EXCEPTION WHEN OTHERS THEN
  RETURN p_start_datetime;
END;
$$;

-- ---------------------------------------------------------------------------
-- Going-events list (upcoming or past)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_user_going_events(
  user_id_param uuid,
  p_scope text DEFAULT 'upcoming',
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
  want_past boolean;
  safe_limit integer;
  safe_offset integer;
BEGIN
  IF p_scope NOT IN ('upcoming', 'past', 'interested') THEN
    RAISE EXCEPTION 'Invalid scope %, expected upcoming, past or interested', p_scope;
  END IF;

  want_past := (p_scope = 'past');
  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  -- Privacy: upcoming lists follow the profile's sharing settings; history is
  -- only ever visible to its owner.
  IF NOT can_view_user_events(user_id_param) THEN
    RETURN '[]'::json;
  END IF;
  -- History and the lower-signal "interested" list are only for the owner.
  IF p_scope IN ('past', 'interested') AND auth.uid() IS DISTINCT FROM user_id_param THEN
    RETURN '[]'::json;
  END IF;

  SELECT COALESCE(
    json_agg(
      json_build_object(
        'id', sub.id,
        'business_id', sub.business_id,
        'title', sub.title,
        'description', sub.description,
        'category_id', sub.category_id,
        'start_datetime', sub.start_datetime,
        'end_datetime', sub.end_datetime,
        'lat', sub.lat,
        'lng', sub.lng,
        'address', sub.address,
        'cover_image_url', sub.cover_image_url,
        'is_recurring', sub.is_recurring,
        'recurrence_pattern', sub.recurrence_pattern,
        'created_at', sub.created_at,
        'updated_at', sub.updated_at,
        'business_name', sub.business_name,
        'business_logo_url', sub.business_logo_url,
        'category_label', sub.category_label,
        'category_slug', sub.category_slug,
        'rsvp_count', sub.rsvp_count,
        'save_count', sub.save_count,
        'next_start_datetime', sub.next_start_datetime
      )
      ORDER BY sub.sort_key, sub.start_datetime
    ),
    '[]'::json
  ) INTO result
  FROM (
    SELECT
      e.id,
      e.business_id,
      e.title,
      e.description,
      e.category_id,
      e.start_datetime,
      e.end_datetime,
      e.lat,
      e.lng,
      e.address,
      COALESCE(
        e.cover_image_url,
        (SELECT ep.image_url FROM event_photos ep WHERE ep.event_id = e.id ORDER BY ep.sort_order ASC LIMIT 1)
      ) AS cover_image_url,
      COALESCE(e.is_recurring, false) AS is_recurring,
      e.recurrence_pattern,
      e.created_at,
      e.updated_at,
      b.name AS business_name,
      b.logo_url AS business_logo_url,
      c.label AS category_label,
      c.slug AS category_slug,
      COALESCE(rc.count, 0) AS rsvp_count,
      COALESCE(sc.count, 0) AS save_count,
      event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern) AS next_start_datetime,
      -- Upcoming: whatever happens next comes first (an event already in
      -- progress keeps its past start and therefore leads). Past: most recent first.
      CASE WHEN want_past
        THEN -extract(epoch FROM e.start_datetime)
        ELSE  extract(epoch FROM event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern))
      END AS sort_key
    FROM rsvps r
    JOIN events e ON e.id = r.event_id
    JOIN businesses b ON b.id = e.business_id
    JOIN categories c ON c.id = e.category_id
    LEFT JOIN (
      SELECT event_id, COUNT(*) AS count FROM rsvps WHERE status = 'going' GROUP BY event_id
    ) rc ON rc.event_id = e.id
    LEFT JOIN (
      SELECT event_id, COUNT(*) AS count FROM saves GROUP BY event_id
    ) sc ON sc.event_id = e.id
    WHERE r.user_id = user_id_param
      AND r.status = CASE WHEN p_scope = 'interested' THEN 'interested' ELSE 'going' END
      AND event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern) = want_past
    ORDER BY sort_key, e.start_datetime
    LIMIT safe_limit
    OFFSET safe_offset
  ) sub;

  RETURN result;
END;
$$;

-- Kept for existing callers; now privacy-checked and end-time based.
CREATE OR REPLACE FUNCTION get_user_upcoming_events(user_id_param uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT get_user_going_events(user_id_param, 'upcoming', 20, 0);
$$;

-- Parameter names match the sibling migration drafted in another worktree so
-- both can CREATE OR REPLACE this function without a signature conflict.
CREATE OR REPLACE FUNCTION get_user_past_events(
  user_id_param uuid,
  result_limit integer DEFAULT 20,
  result_offset integer DEFAULT 0
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT get_user_going_events(user_id_param, 'past', result_limit, result_offset);
$$;

-- ---------------------------------------------------------------------------
-- Attendance counts for the profile header
-- ---------------------------------------------------------------------------

-- upcoming_count follows the same visibility rule as the upcoming list.
-- attended_count is private to the owner and comes back as 0 for everyone else.
CREATE OR REPLACE FUNCTION get_user_attendance_counts(user_id_param uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_upcoming integer := 0;
  v_attended integer := 0;
  v_saved integer := 0;
  v_interested integer := 0;
  v_is_owner boolean;
BEGIN
  IF NOT can_view_user_events(user_id_param) THEN
    RETURN json_build_object('upcoming_count', 0, 'attended_count', 0, 'saved_count', 0, 'interested_count', 0);
  END IF;

  v_is_owner := (auth.uid() = user_id_param);

  IF v_is_owner THEN
    SELECT COUNT(*) INTO v_saved FROM saves WHERE user_id = user_id_param;
    SELECT COUNT(*) INTO v_interested
    FROM rsvps r JOIN events e ON e.id = r.event_id
    WHERE r.user_id = user_id_param
      AND r.status = 'interested'
      AND NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern);
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern)),
    COUNT(*) FILTER (WHERE event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern))
  INTO v_upcoming, v_attended
  FROM rsvps r
  JOIN events e ON e.id = r.event_id
  WHERE r.user_id = user_id_param
    AND r.status = 'going';

  RETURN json_build_object(
    'upcoming_count', v_upcoming,
    'attended_count', CASE WHEN v_is_owner THEN v_attended ELSE 0 END,
    'saved_count', v_saved,
    'interested_count', v_interested
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Saved events for the caller (replaces one detail RPC per save on the client)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_user_saved_events(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
  safe_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  safe_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT COALESCE(
    json_agg(
      json_build_object(
        'id', sub.id,
        'business_id', sub.business_id,
        'title', sub.title,
        'description', sub.description,
        'category_id', sub.category_id,
        'start_datetime', sub.start_datetime,
        'end_datetime', sub.end_datetime,
        'lat', sub.lat,
        'lng', sub.lng,
        'address', sub.address,
        'cover_image_url', sub.cover_image_url,
        'is_recurring', sub.is_recurring,
        'recurrence_pattern', sub.recurrence_pattern,
        'created_at', sub.created_at,
        'updated_at', sub.updated_at,
        'business_name', sub.business_name,
        'business_logo_url', sub.business_logo_url,
        'category_label', sub.category_label,
        'category_slug', sub.category_slug,
        'rsvp_count', sub.rsvp_count,
        'save_count', sub.save_count,
        'next_start_datetime', sub.next_start_datetime,
        'has_ended', sub.has_ended,
        'saved_at', sub.saved_at
      )
      ORDER BY sub.has_ended, sub.sort_key
    ),
    '[]'::json
  ) INTO result
  FROM (
    SELECT
      e.id, e.business_id, e.title, e.description, e.category_id,
      e.start_datetime, e.end_datetime, e.lat, e.lng, e.address,
      COALESCE(
        e.cover_image_url,
        (SELECT ep.image_url FROM event_photos ep WHERE ep.event_id = e.id ORDER BY ep.sort_order ASC LIMIT 1)
      ) AS cover_image_url,
      COALESCE(e.is_recurring, false) AS is_recurring,
      e.recurrence_pattern,
      e.created_at, e.updated_at,
      b.name AS business_name,
      b.logo_url AS business_logo_url,
      c.label AS category_label,
      c.slug AS category_slug,
      COALESCE(rc.count, 0) AS rsvp_count,
      COALESCE(sc.count, 0) AS save_count,
      event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern) AS next_start_datetime,
      event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern) AS has_ended,
      s.created_at AS saved_at,
      -- Upcoming saves soonest-first, then past saves most-recent-first.
      CASE WHEN event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern)
        THEN -extract(epoch FROM e.start_datetime)
        ELSE  extract(epoch FROM event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern))
      END AS sort_key
    FROM saves s
    JOIN events e ON e.id = s.event_id
    JOIN businesses b ON b.id = e.business_id
    JOIN categories c ON c.id = e.category_id
    LEFT JOIN (
      SELECT event_id, COUNT(*) AS count FROM rsvps WHERE status = 'going' GROUP BY event_id
    ) rc ON rc.event_id = e.id
    LEFT JOIN (
      SELECT event_id, COUNT(*) AS count FROM saves GROUP BY event_id
    ) sc ON sc.event_id = e.id
    WHERE s.user_id = auth.uid()
    ORDER BY has_ended, sort_key
    LIMIT safe_limit
    OFFSET safe_offset
  ) sub;

  RETURN result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Attendees list: anonymous rows must not reveal the user id
-- ---------------------------------------------------------------------------

-- The previous version built the anonymous id from the real user uuid, which
-- let any client correlate a private user across events. The rsvp row id is a
-- random uuid that RLS never exposes to other users, so a short hash of it is
-- stable within one event (good for list keys) and useless across events.
CREATE OR REPLACE FUNCTION get_event_attendees_public(event_uuid uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  SELECT COALESCE(
    json_agg(
      CASE
        WHEN (p.is_profile_private = true OR p.show_attendance_publicly = false) THEN
          json_build_object(
            'id', 'anon-' || left(md5(r.id::text), 16),
            'name', 'Anonymous',
            'avatar_url', null,
            'bio', null,
            'is_anonymous', true
          )
        ELSE
          json_build_object(
            'id', p.id,
            'name', COALESCE(p.name, 'Anonymous'),
            'avatar_url', p.avatar_url,
            'bio', LEFT(COALESCE(p.bio, ''), 80),
            'is_anonymous', false
          )
      END
      ORDER BY r.created_at ASC
    ),
    '[]'::json
  ) INTO result
  FROM (
    SELECT r.id, r.created_at, r.user_id
    FROM rsvps r
    JOIN profiles p ON p.id = r.user_id
    WHERE r.event_id = event_uuid
      AND r.status = 'going'
    -- Named attendees first so mention autocomplete sees useful rows; capped so
    -- a huge event cannot push a multi-hundred-KB payload to every chat client.
    ORDER BY (p.is_profile_private = true OR p.show_attendance_publicly = false), r.created_at
    LIMIT 500
  ) r
  JOIN profiles p ON p.id = r.user_id;

  RETURN result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Profiles: close the open SELECT policy
-- ---------------------------------------------------------------------------
-- The original policy let any client read every column of every profile
-- (privacy flags, admin flag, saved coordinates, a private user's bio).
-- Table reads are now owner-only (the admin policy from
-- 20260219100400 still applies); everyone else goes through the two RPCs
-- below, which expose only intentional columns and honor is_profile_private.

DROP POLICY IF EXISTS "Anyone can view profiles" ON profiles;

DO $$
BEGIN
  CREATE POLICY "Users can view their own profile"
    ON profiles
    FOR SELECT
    TO authenticated
    USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- Public view of one profile: the private flag or the safe public columns.
CREATE OR REPLACE FUNCTION get_public_profile(user_id_param uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p profiles%ROWTYPE;
BEGIN
  SELECT * INTO p FROM profiles WHERE id = user_id_param;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF COALESCE(p.is_profile_private, false) AND auth.uid() IS DISTINCT FROM user_id_param THEN
    RETURN json_build_object('is_private', true);
  END IF;

  RETURN json_build_object(
    'is_private', false,
    'profile', json_build_object(
      'id', p.id,
      'name', p.name,
      'avatar_url', p.avatar_url,
      'bio', p.bio,
      'hobbies', p.hobbies,
      'city', p.city,
      'social_handles', p.social_handles,
      'show_future_events', COALESCE(p.show_future_events, true),
      'created_at', p.created_at
    )
  );
END;
$$;

-- Display identity (name + avatar) for a batch of users, e.g. chat senders and
-- mentions. Available to any signed-in user; being in a chat or attendee list
-- is itself a public act, so this intentionally includes private profiles.
CREATE OR REPLACE FUNCTION get_profiles_display(user_ids uuid[])
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN '[]'::json ELSE COALESCE(
    (SELECT json_agg(json_build_object('id', p.id, 'name', p.name, 'avatar_url', p.avatar_url))
     FROM profiles p
     WHERE p.id IN (SELECT DISTINCT u FROM unnest(user_ids[1:200]) AS u)),
    '[]'::json
  ) END;
$$;

-- ---------------------------------------------------------------------------
-- Fix: event views were never recorded
-- ---------------------------------------------------------------------------
-- idx_event_views_dedup_daily is a partial unique index (WHERE viewer_id IS NOT
-- NULL). ON CONFLICT can only infer a partial index when the same predicate is
-- spelled out, so every call failed with 42P10 and analytics never saw a view.
CREATE OR REPLACE FUNCTION track_event_view(event_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  viewer uuid := auth.uid();
BEGIN
  IF viewer IS NULL THEN
    RETURN;
  END IF;

  -- Do not count self-views by the business owner.
  IF EXISTS (
    SELECT 1
    FROM events e
    JOIN businesses b ON b.id = e.business_id
    WHERE e.id = event_uuid
      AND b.owner_id = viewer
  ) THEN
    RETURN;
  END IF;

  INSERT INTO event_views (event_id, viewer_id, viewed_at, view_date)
  VALUES (event_uuid, viewer, now(), CURRENT_DATE)
  ON CONFLICT (event_id, viewer_id, view_date) WHERE viewer_id IS NOT NULL
  DO UPDATE SET viewed_at = EXCLUDED.viewed_at;
END;
$$;

-- ---------------------------------------------------------------------------
-- Attendees: paginated, searchable page for the "Who's going" sheet
-- ---------------------------------------------------------------------------
-- get_event_attendees_public stays for small consumers (mention autocomplete);
-- the sheet uses this page RPC. Named attendees sort first, then anonymous
-- rows; searching by name only ever matches public attendees.
CREATE OR REPLACE FUNCTION get_event_attendees_page(
  event_uuid uuid,
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  safe_limit integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
  safe_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  search text := NULLIF(trim(COALESCE(p_search, '')), '');
  pattern text;
  result json;
BEGIN
  IF search IS NOT NULL THEN
    pattern := '%' || replace(replace(replace(search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  WITH matched AS (
    SELECT r.id AS rsvp_id, r.created_at, p.id AS profile_id, p.name, p.avatar_url, p.bio,
           (p.is_profile_private = true OR p.show_attendance_publicly = false) AS anon,
           (r.user_id = auth.uid()) AS is_viewer
    FROM rsvps r
    JOIN profiles p ON p.id = r.user_id
    WHERE r.event_id = event_uuid
      AND r.status = 'going'
      AND (
        pattern IS NULL
        OR (
          COALESCE(p.is_profile_private, false) = false
          AND COALESCE(p.show_attendance_publicly, true) = true
          AND p.name ILIKE pattern
        )
      )
  ),
  total AS (SELECT COUNT(*) AS c FROM matched),
  -- The viewer sees themselves first, then named attendees, then anonymous rows.
  page AS (
    SELECT * FROM matched
    ORDER BY is_viewer DESC, anon, created_at, rsvp_id
    LIMIT safe_limit OFFSET safe_offset
  )
  SELECT json_build_object(
    'total', (SELECT c FROM total),
    'items', COALESCE((
      SELECT json_agg(
        CASE WHEN anon THEN
          json_build_object(
            'id', 'anon-' || left(md5(rsvp_id::text), 16),
            'name', 'Anonymous', 'avatar_url', null, 'bio', null, 'is_anonymous', true)
        ELSE
          json_build_object(
            'id', profile_id, 'name', COALESCE(name, 'Anonymous'), 'avatar_url', avatar_url,
            'bio', LEFT(COALESCE(bio, ''), 80), 'is_anonymous', false)
        END
        ORDER BY is_viewer DESC, anon, created_at, rsvp_id)
      FROM page), '[]'::json),
    'has_more', (safe_offset + (SELECT COUNT(*) FROM page)) < (SELECT c FROM total)
  ) INTO result;

  RETURN result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Reminders that follow the RSVP context
-- ---------------------------------------------------------------------------
-- going      -> "starting soon" at the user's chosen lead time (unchanged)
-- interested -> one "still interested?" nudge the day before (or ~2h before
--               when the interest was registered inside the last day)
-- no RSVP / removed -> nothing; the job only reads live rsvps rows
--
-- event_reminder_sent gains a `kind` so a going reminder and an interested
-- nudge for the same event never collide on the primary key.
ALTER TABLE event_reminder_sent ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'going';
ALTER TABLE event_reminder_sent DROP CONSTRAINT IF EXISTS event_reminder_sent_pkey;
ALTER TABLE event_reminder_sent ADD PRIMARY KEY (event_id, user_id, kind, reminder_minutes);

CREATE OR REPLACE FUNCTION send_event_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_maps_url text;
  v_body text;
BEGIN
  -- 1. Going: lead-time reminder --------------------------------------------
  FOR v_row IN
    SELECT
      e.id AS event_id, e.title, e.address, e.lat, e.lng,
      b.address AS business_address,
      r.user_id,
      p.event_reminder_minutes AS reminder_minutes
    FROM events e
    JOIN businesses b ON b.id = e.business_id
    JOIN rsvps r ON r.event_id = e.id AND r.status = 'going'
    JOIN profiles p ON p.id = r.user_id
    WHERE e.start_datetime > now()
      AND e.start_datetime <= now() + interval '25 hours'
      AND COALESCE(p.event_reminder_enabled, true) = true
      AND p.event_reminder_minutes IN (10, 30, 60, 120, 1440)
      AND extract(epoch from (e.start_datetime - now())) / 60
          BETWEEN p.event_reminder_minutes - 5 AND p.event_reminder_minutes + 5
      AND NOT EXISTS (
        SELECT 1 FROM event_reminder_sent ers
        WHERE ers.event_id = e.id AND ers.user_id = r.user_id
          AND ers.kind = 'going' AND ers.reminder_minutes = p.event_reminder_minutes
      )
  LOOP
    v_maps_url := 'https://www.google.com/maps/search/?api=1&query='
      || COALESCE(v_row.lat::text, '') || ',' || COALESCE(v_row.lng::text, '');
    v_body := COALESCE(v_row.business_address, v_row.address, '');
    IF v_row.lat IS NOT NULL AND v_row.lng IS NOT NULL THEN
      v_body := v_body || E'\n\nGet directions: ' || v_maps_url;
    END IF;

    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    VALUES (
      v_row.user_id, 'event_reminder', 'Event starting soon',
      COALESCE(v_row.title, 'Event') || ' starts in ' || v_row.reminder_minutes || ' minutes. ' || v_body,
      v_row.event_id,
      jsonb_build_object('eventId', v_row.event_id, 'kind', 'going',
        'businessAddress', COALESCE(v_row.business_address, v_row.address), 'mapsUrl', v_maps_url)
    );
    INSERT INTO event_reminder_sent (event_id, user_id, kind, reminder_minutes)
    VALUES (v_row.event_id, v_row.user_id, 'going', v_row.reminder_minutes)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- 2. Interested: a single nudge, day-before or ~2h-before for late interest --
  FOR v_row IN
    SELECT
      e.id AS event_id, e.title, r.user_id,
      CASE
        WHEN extract(epoch from (e.start_datetime - now())) / 60 BETWEEN 1380 AND 1500 THEN 1440
        ELSE 120
      END AS slot
    FROM events e
    JOIN rsvps r ON r.event_id = e.id AND r.status = 'interested'
    JOIN profiles p ON p.id = r.user_id
    WHERE e.start_datetime > now()
      AND NOT COALESCE(e.is_recurring, false)
      AND COALESCE(p.event_reminder_enabled, true) = true
      AND COALESCE((p.notification_preferences->>'interested_reminder')::boolean, true) = true
      AND (
        extract(epoch from (e.start_datetime - now())) / 60 BETWEEN 1380 AND 1500
        OR (
          extract(epoch from (e.start_datetime - now())) / 60 BETWEEN 105 AND 135
          AND r.created_at > e.start_datetime - interval '25 hours'
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM event_reminder_sent ers
        WHERE ers.event_id = e.id AND ers.user_id = r.user_id AND ers.kind = 'interested'
      )
  LOOP
    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    VALUES (
      v_row.user_id, 'event_reminder', 'Still interested?',
      COALESCE(v_row.title, 'An event you marked')
        || CASE WHEN v_row.slot = 1440 THEN ' starts tomorrow.' ELSE ' starts in about 2 hours.' END
        || ' Join to get a reminder and the event chat.',
      v_row.event_id,
      jsonb_build_object('eventId', v_row.event_id, 'kind', 'interested_nudge')
    );
    INSERT INTO event_reminder_sent (event_id, user_id, kind, reminder_minutes)
    VALUES (v_row.event_id, v_row.user_id, 'interested', v_row.slot)
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

-- The reminder job is for pg_cron only; it was callable by any signed-in user
-- through PostgREST before (default EXECUTE grant to PUBLIC).
REVOKE EXECUTE ON FUNCTION send_event_reminders() FROM PUBLIC, anon, authenticated;

-- Supporting index for per-user attendance lookups (event lists and counts).
CREATE INDEX IF NOT EXISTS idx_rsvps_user_status_event
  ON rsvps(user_id, status, event_id);
CREATE INDEX IF NOT EXISTS idx_saves_user_event
  ON saves(user_id, event_id);
