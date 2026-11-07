-- Reference check for event-images cleanup (2026-11-06).
--
-- PENDING: prepared for a later maintenance window; not applied anywhere yet.
-- The client (services/storageCleanup.ts) already calls this and does
-- NOTHING while it is missing, so uploads keep accumulating exactly as today
-- until this is applied.
--
-- Why the check must live in the database: one storage file can back several
-- rows — duplicate_event copies event_photos rows (same image_url), and a
-- cover can point at a photo. The client can't count references itself: the
-- event_photos SELECT policy hides photos of ENDED events even from their
-- owner, so a client-side check would miss a past event's copy and delete a
-- file it still shows.
--
-- Returns the subset of p_urls that (a) live in the CALLER's own folder of
-- the event-images bucket (the only files their storage policy lets them
-- remove; also avoids revealing anything about other users' files) and
-- (b) are referenced by no row in any table that stores these URLs.

CREATE OR REPLACE FUNCTION public.unreferenced_owned_images(p_urls text[])
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT u
  FROM unnest(p_urls[1:50]) AS t(u)
  WHERE auth.uid() IS NOT NULL
    AND substring(u FROM '/event-images/([^/?#]+)/') = auth.uid()::text
    AND NOT EXISTS (SELECT 1 FROM events e WHERE e.cover_image_url = u)
    AND NOT EXISTS (SELECT 1 FROM event_photos p WHERE p.image_url = u)
    AND NOT EXISTS (SELECT 1 FROM businesses b WHERE b.logo_url = u)
    AND NOT EXISTS (SELECT 1 FROM business_photos bp WHERE bp.image_url = u)
    AND NOT EXISTS (SELECT 1 FROM app_banners ab WHERE ab.image_url = u);
$function$;

REVOKE ALL ON FUNCTION public.unreferenced_owned_images(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unreferenced_owned_images(text[]) TO authenticated;

-- The lookups above are equality probes on URL columns that have no index;
-- these are small tables per owner, and the function runs only after a
-- delete/replace, so no index is added (revisit if event_photos grows large).
