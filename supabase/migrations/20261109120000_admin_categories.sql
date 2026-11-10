-- Admin management of event categories
-- (docs/CATEGORIES_AND_SERIES_PLAN.md §3.5, Phase C).
--
-- NOT applied to the shared local database by the author; validated on an
-- isolated scratch copy only. Apply after 20261109100000_category_taxonomy
-- (needs `is_active`). Then `npm run backend:types`.
--
-- Until this is applied the admin /categories page is read-only: RLS on
-- `categories` has no write policies, so admin updates affect 0 rows and
-- the RPCs below are missing (PGRST202). The page detects both and says so.
--
--  1. RLS: admins (profiles.is_admin via is_admin_user()) may INSERT and
--     UPDATE categories. No DELETE policy on purpose — events reference
--     categories with ON DELETE RESTRICT; retire with is_active = false.
--  2. Slug format CHECK (lower-case kebab), so a typo in the admin form
--     can't create an unroutable /category/<slug>.
--  3. admin_reorder_categories(uuid[]): one call sets sort_order from the
--     array position (1-based). Ids not in the array keep their order.
--  4. admin_category_stats(): per-category event counts (all / upcoming)
--     for the admin list, computed server-side instead of one count query
--     per category.

DROP POLICY IF EXISTS "Admins can insert categories" ON public.categories;
CREATE POLICY "Admins can insert categories"
  ON public.categories FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_user());

DROP POLICY IF EXISTS "Admins can update categories" ON public.categories;
CREATE POLICY "Admins can update categories"
  ON public.categories FOR UPDATE
  TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_slug_format;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

CREATE OR REPLACE FUNCTION public.admin_reorder_categories(p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM unnest(p_ids)) <> (SELECT count(DISTINCT x) FROM unnest(p_ids) x) THEN
    RAISE EXCEPTION 'Duplicate category id in reorder list';
  END IF;
  UPDATE categories c
     SET sort_order = x.ord
    FROM unnest(p_ids) WITH ORDINALITY AS x(id, ord)
   WHERE c.id = x.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_reorder_categories(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reorder_categories(uuid[]) TO authenticated;

-- NOTE: a function with this exact signature already exists on the shared
-- local database (seen on the scratch snapshot, defined in no migration in
-- this worktree). Same name, same output columns and same semantics here,
-- so applying this file on top of it is a no-op rather than a conflict.
CREATE OR REPLACE FUNCTION public.admin_category_stats()
RETURNS TABLE (category_id uuid, total_events bigint, upcoming_events bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
  SELECT c.id,
         count(e.id)::bigint,
         count(e.id) FILTER (
           WHERE e.status = 'active'
             AND NOT event_has_ended(e.end_datetime, e.is_recurring, e.recurrence_pattern, e.timezone)
         )::bigint
  FROM categories c
  LEFT JOIN events e ON e.category_id = c.id
  GROUP BY c.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_category_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_category_stats() TO authenticated;
