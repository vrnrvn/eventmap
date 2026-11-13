-- Private event collections (docs/EVENT_COLLECTIONS_PLAN.md §3, Phase A).
--
-- NOT applied to the shared local database by the author; validated on an
-- isolated Postgres copy that had every earlier migration applied (see the
-- plan's §8 implementation log). Ask the owner before applying; afterwards
-- run `npm run backend:types`. Requires 20261109160000 (split_series_from is
-- re-created here) and 20261109100000 (categories.color / icon_key).
--
-- What this adds
--  1. collections: a user's private, named lists. kind = 'manual' (exactly
--     its pinned items) or 'smart' (a favourited event type: everything the
--     owner has saved or RSVP'd to in category_ids, plus pinned extras).
--     Name trimmed and 1..40 chars; manual names unique per user (case-
--     insensitive); one smart collection per (user, category set); 50 per
--     user. Smart collections default their name, colour and icon from the
--     category.
--  2. collection_items: pinned (collection, event) pairs with an optional
--     140-char note; 500 per collection. Caps apply to the owner's own
--     writes only, so system copies (split_series_from) never hit them.
--  3. RLS: owner-only on both tables (same shape as `saves`; insert also
--     requires not banned). Cascades from profiles and events.
--  4. RPCs (SECURITY DEFINER, auth.uid()-scoped, json like the attendance
--     RPCs):
--       get_user_collections()                       -> collections + counts + covers
--       get_collection_events(id, limit, offset, sort, filter, category_ids)
--                                                    -> list rows + sources/added_at/note
--       get_event_collection_membership(event_id)    -> [{collection_id, pinned, by_rule}]
--       reorder_collections(ids[])                   -> void
--     and the internal helper collection_members(collection_id).
--  5. split_series_from copies pinned items to the new series, as it does
--     for saves (gap noted in the plan §7).
--  6. Phase F additions (G-prep): get_events_collection_membership(uuid[])
--     for list screens ("in 2 collections" without one call per row), and
--     notify_interested_for_event re-created so the "new event in your
--     interests" notification names the recipient's favourite-type
--     collection (data.collectionId + body suffix) when they have one.
--  7. Post-F (G-prep): get_user_calendar re-created from 20261104110000 with
--     one more source, 'collections' = every event in any of the caller's
--     collections (pinned or by smart rule). Older clients never send it and
--     see identical output; new clients retry without it on 'invalid_source'.
--
-- Everything is idempotent (IF NOT EXISTS / OR REPLACE / DROP POLICY IF
-- EXISTS) so it can be re-applied.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'smart')),
  -- smart: the favourited categories; manual: always empty (trigger-enforced)
  category_ids uuid[] NOT NULL DEFAULT '{}',
  icon_key text,
  color text CHECK (color IS NULL OR color ~ '^#[0-9a-f]{6}$'),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.collections IS
  'Private per-user event lists. manual = pinned items only; smart = a favourited event type (category_ids) filled from the owner''s saves and RSVPs, plus pinned extras.';

CREATE UNIQUE INDEX IF NOT EXISTS collections_manual_name_key
  ON public.collections (user_id, lower(name)) WHERE kind = 'manual';
CREATE UNIQUE INDEX IF NOT EXISTS collections_smart_rule_key
  ON public.collections (user_id, category_ids) WHERE kind = 'smart';
CREATE INDEX IF NOT EXISTS idx_collections_user_order
  ON public.collections (user_id, sort_order, created_at);

CREATE TABLE IF NOT EXISTS public.collection_items (
  collection_id uuid NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  note text CHECK (note IS NULL OR char_length(note) <= 140),
  PRIMARY KEY (collection_id, event_id)
);

COMMENT ON TABLE public.collection_items IS
  'Events pinned into a collection. Smart collections also contain the owner''s saves/RSVPs in their categories without a row here.';

CREATE INDEX IF NOT EXISTS idx_collection_items_event ON public.collection_items (event_id);

-- ---------------------------------------------------------------------------
-- 2. Validation triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.collections_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  NEW.name := btrim(COALESCE(NEW.name, ''));
  IF NEW.kind = 'smart' THEN
    IF COALESCE(cardinality(NEW.category_ids), 0) = 0 THEN
      RAISE EXCEPTION 'collection_categories_required: a smart collection needs at least one category';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(NEW.category_ids) AS u(id)
      WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = u.id)
    ) THEN
      RAISE EXCEPTION 'collection_unknown_category: category does not exist';
    END IF;
    -- De-duplicated and sorted so the (user, category_ids) uniqueness does
    -- not depend on the order the client sent them in.
    SELECT array_agg(DISTINCT u.id ORDER BY u.id) INTO NEW.category_ids
    FROM unnest(NEW.category_ids) AS u(id);
    IF NEW.name = '' THEN
      SELECT string_agg(c.label, ' + ' ORDER BY c.sort_order, c.label) INTO NEW.name
      FROM categories c WHERE c.id = ANY (NEW.category_ids);
    END IF;
    IF cardinality(NEW.category_ids) = 1 THEN
      IF NEW.color IS NULL THEN
        SELECT c.color INTO NEW.color FROM categories c WHERE c.id = NEW.category_ids[1];
      END IF;
      IF NEW.icon_key IS NULL THEN
        SELECT c.icon_key INTO NEW.icon_key FROM categories c WHERE c.id = NEW.category_ids[1];
      END IF;
    END IF;
  ELSE
    NEW.category_ids := '{}';
  END IF;

  IF NEW.name = '' THEN
    RAISE EXCEPTION 'collection_name_required: give the collection a name';
  END IF;
  IF char_length(NEW.name) > 40 THEN
    RAISE EXCEPTION 'collection_name_too_long: at most 40 characters';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- The cap applies to the owner's own writes; service-role maintenance
    -- (auth.uid() IS NULL) is not limited.
    IF auth.uid() = NEW.user_id THEN
      SELECT count(*) INTO v_count FROM collections WHERE user_id = NEW.user_id;
      IF v_count >= 50 THEN
        RAISE EXCEPTION 'collection_limit: at most 50 collections';
      END IF;
    END IF;
  ELSE
    IF NEW.user_id <> OLD.user_id THEN
      RAISE EXCEPTION 'collection_owner_immutable: a collection cannot change owner';
    END IF;
    IF NEW.kind <> OLD.kind THEN
      RAISE EXCEPTION 'collection_kind_immutable: a collection cannot change kind';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a_collections_before_write ON public.collections;
CREATE TRIGGER a_collections_before_write
  BEFORE INSERT OR UPDATE ON public.collections
  FOR EACH ROW EXECUTE FUNCTION public.collections_before_write();

CREATE OR REPLACE FUNCTION public.collection_items_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_count integer;
BEGIN
  NEW.note := NULLIF(btrim(NEW.note), '');
  IF TG_OP = 'INSERT' THEN
    SELECT user_id INTO v_owner FROM collections WHERE id = NEW.collection_id;
    -- Caps apply to the owner's own writes only, so split_series_from (run
    -- by the host) and service-role maintenance are never blocked by them.
    IF auth.uid() = v_owner THEN
      SELECT count(*) INTO v_count FROM collection_items WHERE collection_id = NEW.collection_id;
      IF v_count >= 500 THEN
        RAISE EXCEPTION 'collection_items_limit: at most 500 events per collection';
      END IF;
    END IF;
  ELSIF NEW.collection_id <> OLD.collection_id OR NEW.event_id <> OLD.event_id THEN
    RAISE EXCEPTION 'collection_item_key_immutable: remove and re-add instead';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a_collection_items_before_write ON public.collection_items;
CREATE TRIGGER a_collection_items_before_write
  BEFORE INSERT OR UPDATE ON public.collection_items
  FOR EACH ROW EXECUTE FUNCTION public.collection_items_before_write();

-- Pinning or removing an event counts as editing the collection, so the
-- home screen's "recently updated" order follows the user's activity.
CREATE OR REPLACE FUNCTION public.collection_items_touch_collection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE collections SET updated_at = now()
   WHERE id = COALESCE(NEW.collection_id, OLD.collection_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS z_collection_items_touch ON public.collection_items;
CREATE TRIGGER z_collection_items_touch
  AFTER INSERT OR DELETE OR UPDATE ON public.collection_items
  FOR EACH ROW EXECUTE FUNCTION public.collection_items_touch_collection();

-- ---------------------------------------------------------------------------
-- 3. Row level security (owner only; the initplan form of auth.uid() as in
--    20261106160000)
-- ---------------------------------------------------------------------------

ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own collections" ON public.collections;
CREATE POLICY "Users can view their own collections" ON public.collections
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can create their own collections" ON public.collections;
CREATE POLICY "Users can create their own collections" ON public.collections
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id AND NOT user_is_banned((SELECT auth.uid())));

DROP POLICY IF EXISTS "Users can update their own collections" ON public.collections;
CREATE POLICY "Users can update their own collections" ON public.collections
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their own collections" ON public.collections;
CREATE POLICY "Users can delete their own collections" ON public.collections
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view items of their own collections" ON public.collection_items;
CREATE POLICY "Users can view items of their own collections" ON public.collection_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.collections c
    WHERE c.id = collection_id AND c.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Users can add items to their own collections" ON public.collection_items;
CREATE POLICY "Users can add items to their own collections" ON public.collection_items
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT user_is_banned((SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.collections c
      WHERE c.id = collection_id AND c.user_id = (SELECT auth.uid())
    )
    -- Only events the user could see in the app: a known uuid of a draft must
    -- not become readable through get_collection_events (defence in depth;
    -- saves has no such check, see the plan's review notes).
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id AND COALESCE(e.publish_state, 'published') = 'published'
    )
  );

DROP POLICY IF EXISTS "Users can update items of their own collections" ON public.collection_items;
CREATE POLICY "Users can update items of their own collections" ON public.collection_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.collections c
    WHERE c.id = collection_id AND c.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.collections c
    WHERE c.id = collection_id AND c.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Users can remove items from their own collections" ON public.collection_items;
CREATE POLICY "Users can remove items from their own collections" ON public.collection_items
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.collections c
    WHERE c.id = collection_id AND c.user_id = (SELECT auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- 4. Membership helper
-- ---------------------------------------------------------------------------

-- Every event in one of the caller's collections with how it got there.
-- sources (fixed order): pinned, going, requested, interested, saved.
-- Smart collections admit saves / RSVPs in their categories; in any
-- collection a pinned event also carries the owner's save / RSVP tags, so
-- the UI can show "Added · Going" and the per-date state of a pinned series.
-- added_at is the most recent of those relationships (what "recently added"
-- sorts on). Empty for a collection the caller does not own.
CREATE OR REPLACE FUNCTION public.collection_members(p_collection_id uuid)
RETURNS TABLE (event_id uuid, sources text[], added_at timestamptz, note text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH c AS (
    SELECT * FROM collections
    WHERE id = p_collection_id AND user_id = auth.uid()
  ),
  members AS (
    SELECT ci.event_id, 'pinned'::text AS source, ci.added_at, ci.note
    FROM collection_items ci JOIN c ON c.id = ci.collection_id
    UNION ALL
    SELECT s.event_id, 'saved', s.created_at, NULL
    FROM c
    JOIN saves s ON s.user_id = c.user_id
    JOIN events e ON e.id = s.event_id
    WHERE (c.kind = 'smart' AND e.category_id = ANY (c.category_ids))
       OR EXISTS (SELECT 1 FROM collection_items ci WHERE ci.collection_id = c.id AND ci.event_id = s.event_id)
    UNION ALL
    SELECT r.event_id, r.status, r.created_at, NULL
    FROM c
    JOIN rsvps r ON r.user_id = c.user_id
    JOIN events e ON e.id = r.event_id
    WHERE r.status IN ('going', 'interested', 'requested')
      AND ((c.kind = 'smart' AND e.category_id = ANY (c.category_ids))
        OR EXISTS (SELECT 1 FROM collection_items ci WHERE ci.collection_id = c.id AND ci.event_id = r.event_id))
  )
  SELECT
    m.event_id,
    array_agg(m.source ORDER BY CASE m.source
      WHEN 'pinned' THEN 0 WHEN 'going' THEN 1 WHEN 'requested' THEN 2
      WHEN 'interested' THEN 3 ELSE 4 END) AS sources,
    max(m.added_at) AS added_at,
    max(m.note) AS note
  FROM members m
  GROUP BY m.event_id;
$$;

REVOKE ALL ON FUNCTION public.collection_members(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.collection_members(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.collection_members(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. RPCs
-- ---------------------------------------------------------------------------

-- The caller's collections for the collections home: counts, the next
-- date among upcoming members and up to three cover images (soonest first).
CREATE OR REPLACE FUNCTION public.get_user_collections()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT COALESCE(
    json_agg(
      json_build_object(
        'id', c.id,
        'name', c.name,
        'kind', c.kind,
        'category_ids', c.category_ids,
        'icon_key', c.icon_key,
        'color', c.color,
        'sort_order', c.sort_order,
        'created_at', c.created_at,
        'updated_at', c.updated_at,
        'item_count', COALESCE(agg.item_count, 0),
        'upcoming_count', COALESCE(agg.upcoming_count, 0),
        'recurring_count', COALESCE(agg.recurring_count, 0),
        'next_start_datetime', agg.next_start,
        'cover_urls', COALESCE(agg.cover_urls, '{}'::text[])
      )
      ORDER BY c.sort_order, c.created_at
    ),
    '[]'::json
  ) INTO result
  FROM collections c
  LEFT JOIN LATERAL (
    SELECT
      count(*) AS item_count,
      count(*) FILTER (WHERE NOT x.ended) AS upcoming_count,
      count(*) FILTER (WHERE NOT x.ended AND COALESCE(e.is_recurring, false)) AS recurring_count,
      min(x.next_start) FILTER (WHERE NOT x.ended) AS next_start,
      (array_agg(x.cover ORDER BY x.ended, x.next_start) FILTER (WHERE x.cover IS NOT NULL))[1:3] AS cover_urls
    FROM collection_members(c.id) m
    JOIN events e ON e.id = m.event_id
    CROSS JOIN LATERAL (
      SELECT
        (e.status <> 'active'
          OR event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)) AS ended,
        event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern, e.timezone) AS next_start,
        COALESCE(
          e.cover_image_url,
          (SELECT ep.image_url FROM event_photos ep WHERE ep.event_id = e.id ORDER BY ep.sort_order ASC LIMIT 1)
        ) AS cover
    ) x
  ) agg ON true
  WHERE c.user_id = auth.uid();

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_collections() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_collections() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_collections() TO authenticated;

-- One collection's events in the shared list-row shape (as
-- get_user_saved_events) plus sources / added_at / note.
--   p_sort:   next   upcoming soonest-first, then ended most-recent-first (default)
--             rsvp   most "going" first, upcoming before ended
--             added  most recently added first
--             title  alphabetical
--   p_filter: all | upcoming | repeating | past | pinned | saved | going
--   p_category_ids: restrict to these categories (NULL = all)
-- Returns [] for a collection the caller does not own.
CREATE OR REPLACE FUNCTION public.get_collection_events(
  p_collection_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_sort text DEFAULT 'next',
  p_filter text DEFAULT 'all',
  p_category_ids uuid[] DEFAULT NULL
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
  v_sort text := COALESCE(p_sort, 'next');
  v_filter text := COALESCE(p_filter, 'all');
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::json;
  END IF;
  IF v_sort NOT IN ('next', 'rsvp', 'added', 'title') THEN
    RAISE EXCEPTION 'Invalid sort %, expected next, rsvp, added or title', v_sort;
  END IF;
  IF v_filter NOT IN ('all', 'upcoming', 'repeating', 'past', 'pinned', 'saved', 'going') THEN
    RAISE EXCEPTION 'Invalid filter %, expected all, upcoming, repeating, past, pinned, saved or going', v_filter;
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
        'timezone', sub.timezone,
        'status', sub.status,
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
        'sources', sub.sources,
        'added_at', sub.added_at,
        'note', sub.note
      )
      ORDER BY sub.ord_group, sub.ord_num, sub.ord_text, sub.ord_date, sub.id
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
      e.timezone,
      e.status,
      e.created_at, e.updated_at,
      b.name AS business_name,
      b.logo_url AS business_logo_url,
      c.label AS category_label,
      c.slug AS category_slug,
      COALESCE(rc.count, 0) AS rsvp_count,
      COALESCE(sc.count, 0) AS save_count,
      x.next_start AS next_start_datetime,
      x.ended AS has_ended,
      m.sources,
      m.added_at,
      m.note,
      -- Upcoming before ended for the date-based sorts; everything else flat.
      CASE WHEN v_sort IN ('next', 'rsvp') THEN x.ended::int ELSE 0 END AS ord_group,
      CASE v_sort
        WHEN 'rsvp'  THEN -COALESCE(rc.count, 0)
        WHEN 'added' THEN -extract(epoch FROM m.added_at)
        ELSE 0
      END AS ord_num,
      CASE WHEN v_sort = 'title' THEN lower(e.title) ELSE '' END AS ord_text,
      -- Shared date key, also the tie-break for the other sorts: upcoming
      -- soonest-first, ended most-recent-first.
      CASE WHEN x.ended THEN -extract(epoch FROM e.start_datetime)
           ELSE extract(epoch FROM x.next_start) END AS ord_date
    FROM collection_members(p_collection_id) m
    JOIN events e ON e.id = m.event_id
    JOIN businesses b ON b.id = e.business_id
    JOIN categories c ON c.id = e.category_id
    LEFT JOIN (
      SELECT event_id, COUNT(*) AS count FROM rsvps WHERE status = 'going' GROUP BY event_id
    ) rc ON rc.event_id = e.id
    LEFT JOIN (
      SELECT event_id, COUNT(*) AS count FROM saves GROUP BY event_id
    ) sc ON sc.event_id = e.id
    CROSS JOIN LATERAL (
      SELECT
        (e.status <> 'active'
          OR event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)) AS ended,
        event_next_occurrence(e.start_datetime, e.is_recurring, e.recurrence_pattern, e.timezone) AS next_start
    ) x
    WHERE (p_category_ids IS NULL OR e.category_id = ANY (p_category_ids))
      AND CASE v_filter
            WHEN 'upcoming'  THEN NOT x.ended
            WHEN 'repeating' THEN NOT x.ended AND COALESCE(e.is_recurring, false)
            WHEN 'past'      THEN x.ended
            WHEN 'pinned'    THEN 'pinned' = ANY (m.sources)
            WHEN 'saved'     THEN 'saved' = ANY (m.sources)
            WHEN 'going'     THEN 'going' = ANY (m.sources)
            ELSE true
          END
    ORDER BY ord_group, ord_num, ord_text, ord_date, e.id
    LIMIT safe_limit
    OFFSET safe_offset
  ) sub;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_collection_events(uuid, integer, integer, text, text, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_collection_events(uuid, integer, integer, text, text, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_collection_events(uuid, integer, integer, text, text, uuid[]) TO authenticated;

-- Which of the caller's collections contain one event, and how: pinned
-- (removable) and/or by_rule (a smart collection the event matches through
-- a save or RSVP). Drives the add-to-collection sheet and the detail badge.
CREATE OR REPLACE FUNCTION public.get_event_collection_membership(p_event_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT COALESCE(
    json_agg(
      json_build_object('collection_id', sub.id, 'pinned', sub.pinned, 'by_rule', sub.by_rule)
      ORDER BY sub.sort_order, sub.created_at
    ),
    '[]'::json
  ) INTO result
  FROM (
    SELECT c.id, c.sort_order, c.created_at,
      EXISTS (SELECT 1 FROM collection_items ci WHERE ci.collection_id = c.id AND ci.event_id = p_event_id) AS pinned,
      (c.kind = 'smart'
        AND EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id AND e.category_id = ANY (c.category_ids))
        AND (EXISTS (SELECT 1 FROM saves s WHERE s.user_id = c.user_id AND s.event_id = p_event_id)
          OR EXISTS (SELECT 1 FROM rsvps r WHERE r.user_id = c.user_id AND r.event_id = p_event_id
                       AND r.status IN ('going', 'interested', 'requested')))) AS by_rule
    FROM collections c
    WHERE c.user_id = auth.uid()
  ) sub
  WHERE sub.pinned OR sub.by_rule;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_event_collection_membership(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_event_collection_membership(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_event_collection_membership(uuid) TO authenticated;

-- Sets sort_order from the position in p_ids. Only the caller's own
-- collections are touched; ids that are not theirs are an error so a stale
-- client cannot silently reorder a partial list.
CREATE OR REPLACE FUNCTION public.reorder_collections(p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM unnest(p_ids)) <> (SELECT count(DISTINCT u) FROM unnest(p_ids) u) THEN
    RAISE EXCEPTION 'Duplicate collection ids';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_ids) u(id)
    WHERE NOT EXISTS (SELECT 1 FROM collections c WHERE c.id = u.id AND c.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'not_allowed: unknown collection';
  END IF;

  UPDATE collections c
     SET sort_order = x.ord
    FROM unnest(p_ids) WITH ORDINALITY AS x(id, ord)
   WHERE c.id = x.id AND c.user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_collections(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reorder_collections(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.reorder_collections(uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. split_series_from: also copy pinned collection items
--    (body of 20261109160000 plus the one INSERT marked "20261112100000")
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.split_series_from(p_event_id uuid, p_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
  v_tz text;
  v_end text;
  v_new_id uuid := gen_random_uuid();
  v_start_local timestamp;
  v_new_start timestamptz;
  v_duration interval;
  v_new_pattern jsonb;
  v_old_pattern jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = v_event.business_id;
  IF NOT (v_owner = auth.uid() OR is_admin_user()) THEN
    RAISE EXCEPTION 'not_allowed: only the event host can split a series';
  END IF;
  IF v_event.status <> 'active' THEN RAISE EXCEPTION 'event_not_active'; END IF;
  IF NOT COALESCE(v_event.is_recurring, false) OR v_event.recurrence_pattern IS NULL THEN
    RAISE EXCEPTION 'not_recurring: only repeating events can be split';
  END IF;

  v_tz := COALESCE(NULLIF(v_event.timezone, ''), 'UTC');
  v_start_local := v_event.start_datetime AT TIME ZONE v_tz;
  v_end := v_event.recurrence_pattern->>'endDate';
  IF p_date <= v_start_local::date THEN
    RAISE EXCEPTION 'invalid_occurrence: pick a date after the first one (edit the whole series instead)';
  END IF;
  IF p_date < (now() AT TIME ZONE v_tz)::date
     OR NOT event_recurrence_matches(v_start_local, v_event.recurrence_pattern, p_date)
     OR (v_end ~ '^\d{4}-\d{2}-\d{2}' AND p_date > left(v_end, 10)::date) THEN
    RAISE EXCEPTION 'invalid_occurrence: the series does not run on that date';
  END IF;

  v_new_start := (p_date + v_start_local::time) AT TIME ZONE v_tz;
  v_duration := v_event.end_datetime - v_event.start_datetime;
  v_new_pattern := v_event.recurrence_pattern;  -- keeps the original endDate (or none)
  v_old_pattern := jsonb_set(v_event.recurrence_pattern, '{endDate}', to_jsonb(to_char(p_date - 1, 'YYYY-MM-DD')));

  -- New series: copy every column, then override identity/timing/state.
  INSERT INTO events
  SELECT * FROM jsonb_populate_record(NULL::events,
    to_jsonb(v_event) || jsonb_build_object(
      'id', v_new_id,
      'start_datetime', v_new_start,
      'end_datetime', v_new_start + v_duration,
      'recurrence_pattern', v_new_pattern,
      'publish_state', 'draft',
      'created_at', now(),
      'updated_at', now()));

  IF v_event.publish_state = 'published' THEN
    PERFORM set_config('eventmap.allow_publish_change', 'true', true);
    UPDATE events SET publish_state = 'published' WHERE id = v_new_id;
    PERFORM set_config('eventmap.allow_publish_change', '', true);
  END IF;

  INSERT INTO rsvps (event_id, user_id, status)
  SELECT v_new_id, r.user_id, r.status FROM rsvps r
   WHERE r.event_id = p_event_id AND r.status IN ('going', 'interested')
  ON CONFLICT DO NOTHING;
  -- Copying RSVPs fires notify_business_on_rsvp ("X is going") to the
  -- host for every attendee; those are not news. now() is the transaction
  -- start, so this removes exactly the ones created here.
  DELETE FROM notifications
   WHERE event_id = v_new_id AND user_id = v_owner AND created_at >= now();
  INSERT INTO saves (event_id, user_id)
  SELECT v_new_id, s.user_id FROM saves s WHERE s.event_id = p_event_id
  ON CONFLICT DO NOTHING;
  -- 20261112100000: pinned collection items follow the event like saves do,
  -- so a list that held the series still holds both halves.
  INSERT INTO collection_items (collection_id, event_id, added_at, note)
  SELECT ci.collection_id, v_new_id, ci.added_at, ci.note
    FROM collection_items ci WHERE ci.event_id = p_event_id
  ON CONFLICT DO NOTHING;
  -- Links and photos are copied so the new series' page is complete
  -- (photos share the same stored image URLs).
  INSERT INTO event_links (event_id, label, url, sort_order)
  SELECT v_new_id, l.label, l.url, l.sort_order FROM event_links l WHERE l.event_id = p_event_id;
  INSERT INTO event_photos (event_id, image_url, sort_order)
  SELECT v_new_id, ph.image_url, ph.sort_order FROM event_photos ph WHERE ph.event_id = p_event_id;
  UPDATE event_occurrence_exceptions SET event_id = v_new_id
   WHERE event_id = p_event_id AND occurrence_date >= p_date;
  UPDATE rsvp_occurrences SET event_id = v_new_id
   WHERE event_id = p_event_id AND occurrence_date >= p_date;

  -- End the original the day before the split. Done AFTER moving the
  -- per-date rows above: the z_prune_orphaned_occurrence_rows trigger
  -- (20261109140000) removes rows past a series' end date, so shortening
  -- first would delete exactly the rows that belong to the new series.
  PERFORM set_config('eventmap.allow_reschedule', 'true', true);
  UPDATE events SET recurrence_pattern = v_old_pattern WHERE id = p_event_id;
  PERFORM set_config('eventmap.allow_reschedule', '', true);

  RETURN v_new_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.split_series_from(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.split_series_from(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Phase F (G-prep): batched membership + favourite-aware interest notice
-- ---------------------------------------------------------------------------

-- For a page of events: how many of the caller's collections hold each one
-- (pinned or by a smart rule) and which. Events in none are omitted.
CREATE OR REPLACE FUNCTION public.get_events_collection_membership(p_event_ids uuid[])
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  IF auth.uid() IS NULL OR p_event_ids IS NULL OR cardinality(p_event_ids) = 0 THEN
    RETURN '[]'::json;
  END IF;

  SELECT COALESCE(
    json_agg(json_build_object('event_id', sub.event_id, 'collection_ids', sub.collection_ids)),
    '[]'::json
  ) INTO result
  FROM (
    SELECT m.event_id, array_agg(DISTINCT m.collection_id ORDER BY m.collection_id) AS collection_ids
    FROM (
      SELECT ci.event_id, ci.collection_id
        FROM collection_items ci
        JOIN collections c ON c.id = ci.collection_id
       WHERE c.user_id = auth.uid() AND ci.event_id = ANY (p_event_ids)
      UNION
      SELECT e.id, c.id
        FROM collections c
        JOIN events e ON e.id = ANY (p_event_ids) AND e.category_id = ANY (c.category_ids)
       WHERE c.user_id = auth.uid() AND c.kind = 'smart'
         AND (EXISTS (SELECT 1 FROM saves s WHERE s.user_id = c.user_id AND s.event_id = e.id)
           OR EXISTS (SELECT 1 FROM rsvps r WHERE r.user_id = c.user_id AND r.event_id = e.id
                        AND r.status IN ('going', 'interested', 'requested')))
    ) m
    GROUP BY m.event_id
  ) sub;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_events_collection_membership(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_events_collection_membership(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_events_collection_membership(uuid[]) TO authenticated;

-- notify_interested_for_event: body of 20261109170000 plus, per recipient,
-- the single-category smart collection for the event's category (if any) as
-- data.collectionId and a body suffix. Routing on the client is unchanged
-- (the notification is about the event); the id lets the client offer the
-- collection as a secondary destination.
CREATE OR REPLACE FUNCTION public.notify_interested_for_event(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event events%ROWTYPE;
  v_owner uuid;
  v_label text;
  v_n integer := 0;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF NOT FOUND OR v_event.publish_state IS DISTINCT FROM 'published'
     OR v_event.status <> 'active' OR v_event.visibility IS DISTINCT FROM 'public' THEN
    RETURN 0;
  END IF;
  SELECT b.owner_id INTO v_owner FROM businesses b WHERE b.id = v_event.business_id;
  SELECT c.label INTO v_label FROM categories c WHERE c.id = v_event.category_id;

  WITH recipients AS (
    SELECT p.id, calculate_distance(p.lat, p.lng, v_event.lat, v_event.lng) AS km,
           -- 20261112100000: the recipient's favourite-type collection for this category
           (SELECT col.id FROM collections col
             WHERE col.user_id = p.id AND col.kind = 'smart'
               AND col.category_ids = ARRAY[v_event.category_id]
             LIMIT 1) AS collection_id
      FROM profiles p
     WHERE v_event.category_id = ANY (COALESCE(p.preferred_categories, '{}'))
       AND COALESCE((p.notification_preferences->>'interest_events')::boolean, false)
       AND p.lat IS NOT NULL AND p.lng IS NOT NULL
       AND p.lat BETWEEN v_event.lat - 0.25 AND v_event.lat + 0.25
       AND p.id IS DISTINCT FROM v_owner
       AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.user_id = p.id AND f.business_id = v_event.business_id)
       AND NOT EXISTS (SELECT 1 FROM banned_users bu WHERE bu.user_id = p.id)
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
          WHERE n.user_id = p.id AND n.type = 'interest_event' AND n.created_at > now() - interval '24 hours')
  ),
  ins AS (
    INSERT INTO notifications (user_id, type, title, body, event_id, data)
    SELECT r.id, 'interest_event',
           'New ' || COALESCE(v_label, 'event') || ' near you',
           '"' || COALESCE(v_event.title, 'An event') || '" was just posted '
             || CASE WHEN r.km < 1 THEN 'nearby' ELSE round(r.km::numeric, 0) || ' km away' END || '.'
             || CASE WHEN r.collection_id IS NOT NULL
                     THEN ' Save it and it joins your ' || COALESCE(v_label, 'favourite') || ' collection.'
                     ELSE '' END,
           v_event.id,
           jsonb_build_object('eventId', v_event.id, 'kind', 'interest_event', 'categoryId', v_event.category_id)
             || CASE WHEN r.collection_id IS NOT NULL
                     THEN jsonb_build_object('collectionId', r.collection_id) ELSE '{}'::jsonb END
      FROM recipients r
     WHERE r.km <= 25
     ORDER BY r.km
     LIMIT 500
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  RETURN v_n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.notify_interested_for_event(uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 8. Calendar source 'collections' (body of 20261104110000 plus the marked
--    lines)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_user_calendar(
  p_from timestamptz,
  p_to timestamptz,
  p_sources text[] DEFAULT NULL,
  p_limit integer DEFAULT 300
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 300), 1), 500);
  v_sources text[] := COALESCE(p_sources, ARRAY['going', 'requested', 'interested', 'saved', 'hosting']);
  v_rows json;
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;
  IF p_to - p_from > interval '400 days' THEN
    RAISE EXCEPTION 'range_too_long: at most 400 days';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_sources) s
    WHERE s IS NULL OR s NOT IN ('going', 'requested', 'interested', 'saved', 'hosting', 'collections')  -- 20261112100000
  ) THEN
    RAISE EXCEPTION 'invalid_source';
  END IF;

  WITH mine AS (
    -- RSVP statuses share their names with the sources.
    SELECT r.event_id, r.status AS source
    FROM rsvps r
    WHERE r.user_id = v_uid AND r.status = ANY (v_sources)
    UNION ALL
    SELECT s.event_id, 'saved'
    FROM saves s
    WHERE s.user_id = v_uid AND 'saved' = ANY (v_sources)
    UNION ALL
    SELECT e.id, 'hosting'
    FROM events e
    JOIN businesses b ON b.id = e.business_id
    WHERE b.owner_id = v_uid AND 'hosting' = ANY (v_sources)
    UNION ALL
    -- 20261112100000: every event in any of the caller's collections
    -- (pinned, or a save / RSVP matching a smart collection's categories).
    SELECT ci.event_id, 'collections'
    FROM collection_items ci
    JOIN collections c ON c.id = ci.collection_id
    WHERE c.user_id = v_uid AND 'collections' = ANY (v_sources)
    UNION ALL
    SELECT e.id, 'collections'
    FROM collections c
    JOIN events e ON e.category_id = ANY (c.category_ids)
    WHERE c.user_id = v_uid AND c.kind = 'smart' AND 'collections' = ANY (v_sources)
      AND (EXISTS (SELECT 1 FROM saves s WHERE s.user_id = v_uid AND s.event_id = e.id)
        OR EXISTS (SELECT 1 FROM rsvps r WHERE r.user_id = v_uid AND r.event_id = e.id
                     AND r.status IN ('going', 'interested', 'requested')))
  ),
  grouped AS (
    SELECT m.event_id, array_agg(DISTINCT m.source ORDER BY m.source) AS sources
    FROM mine m
    GROUP BY m.event_id
  ),
  hits AS (
    SELECT e.*, g.sources
    FROM grouped g
    JOIN events e ON e.id = g.event_id
    WHERE COALESCE(e.publish_state, 'published') = 'published'
      AND e.start_datetime <= p_to
      AND CASE
        WHEN COALESCE(e.is_recurring, false) AND e.recurrence_pattern IS NOT NULL THEN
          NOT (
            COALESCE(e.recurrence_pattern->>'endDate', '') ~ '^\d{4}-\d{2}-\d{2}'
            AND left(e.recurrence_pattern->>'endDate', 10)::date
                < (p_from AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'UTC'))::date
          )
        ELSE e.end_datetime >= p_from
      END
    ORDER BY e.start_datetime, e.id
    LIMIT v_limit + 1
  ),
  page AS (
    SELECT * FROM hits ORDER BY start_datetime, id LIMIT v_limit
  )
  SELECT
    COALESCE(json_agg(
      json_build_object(
        'id', p.id,
        'business_id', p.business_id,
        'title', p.title,
        'description', p.description,
        'category_id', p.category_id,
        'start_datetime', p.start_datetime,
        'end_datetime', p.end_datetime,
        'lat', p.lat,
        'lng', p.lng,
        'address', p.address,
        'cover_image_url', COALESCE(
          p.cover_image_url,
          (SELECT ep.image_url FROM event_photos ep WHERE ep.event_id = p.id ORDER BY ep.sort_order ASC LIMIT 1)
        ),
        'is_recurring', COALESCE(p.is_recurring, false),
        'recurrence_pattern', p.recurrence_pattern,
        'timezone', p.timezone,
        'status', p.status,
        'status_note', p.status_note,
        'visibility', p.visibility,
        'max_attendees', p.max_attendees,
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'business_name', b.name,
        'business_logo_url', b.logo_url,
        'category_label', c.label,
        'category_slug', c.slug,
        'sources', p.sources,
        'user_rsvp', (
          SELECT s FROM unnest(p.sources) s
          WHERE s IN ('going', 'requested', 'interested') LIMIT 1
        ),
        'next_start_datetime', event_next_occurrence(p.start_datetime, p.is_recurring, p.recurrence_pattern, p.timezone)
      )
      ORDER BY p.start_datetime, p.id
    ), '[]'::json),
    (SELECT count(*) FROM hits)
  INTO v_rows, v_count
  FROM page p
  JOIN businesses b ON b.id = p.business_id
  JOIN categories c ON c.id = p.category_id;

  RETURN json_build_object('rows', v_rows, 'truncated', v_count > v_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_calendar(timestamptz, timestamptz, text[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_calendar(timestamptz, timestamptz, text[], integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_calendar(timestamptz, timestamptz, text[], integer) TO authenticated;
