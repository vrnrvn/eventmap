-- Server-side aggregates for reviews and follower counts (perf review P1).
--
-- PENDING: prepared for a later maintenance window; not applied anywhere yet.
-- The client already calls these RPCs and falls back to its old queries when
-- they are missing (services/reviews.ts, services/social.ts), so this can be
-- applied whenever convenient.
--
-- 1) Review average: the client downloaded every rating row for a business
--    and averaged on the device — unbounded, and silently wrong past
--    PostgREST's max_rows (1000) for well-reviewed businesses.
--
-- 2) Follower counts: the client counted follows rows per business on the
--    device. Besides the same unbounded-download problem, the only follows
--    SELECT policy is "Users can view their own follows", so the count a
--    viewer computed was never more than their own row — i.e. the Following
--    screen's follower counts are 0/1 today. SECURITY DEFINER fixes the
--    correctness bug and the shape at once. Counts leak nothing: they are
--    displayed to every user already by design.

CREATE OR REPLACE FUNCTION public.get_business_review_summary(p_business_id uuid)
RETURNS TABLE (average numeric, review_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Same rounding as the old client computation (1 decimal, 0 when empty).
  SELECT COALESCE(round(avg(r.rating)::numeric, 1), 0) AS average,
         count(*) AS review_count
  FROM reviews r
  WHERE r.business_id = p_business_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_business_follower_counts(p_business_ids uuid[])
RETURNS TABLE (business_id uuid, follower_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Every requested id comes back (0 when no followers), capped defensively.
  SELECT ids.id AS business_id, count(f.user_id) AS follower_count
  FROM unnest(p_business_ids[1:200]) AS ids(id)
  LEFT JOIN follows f ON f.business_id = ids.id
  GROUP BY ids.id;
$function$;

GRANT EXECUTE ON FUNCTION public.get_business_review_summary(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_business_follower_counts(uuid[]) TO anon, authenticated;

-- (follows(business_id) is already indexed: idx_follows_business_id.)
