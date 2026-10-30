-- Storage policy fix (HIGH).
--
-- The event-images (20260213092328) and avatars (20260215110000) buckets let
-- ANY authenticated user UPDATE/DELETE ANY object (policies only checked
-- bucket_id), so one user could overwrite or wipe other users' images.
--
-- New model: write access (INSERT/UPDATE/DELETE) requires the object's first
-- path folder to equal auth.uid()::text. Public SELECT stays unchanged.
--
--   avatars:      services/profiles.ts already uploads to `${uid}/avatar.ext`.
--   event-images: services/events.ts now uploads to `${uid}/{folder}/{name}`
--                 (works under both the old and the new policies, so the
--                 client change is safe to ship before this is applied).
--
-- Legacy objects under the old `events/...`-style paths stay publicly
-- readable; no client code updates or deletes storage objects today, so
-- making them immutable to end users is a non-breaking tightening.

-- -----------------------------
-- event-images
-- -----------------------------
DROP POLICY IF EXISTS "Authenticated users can upload event images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their event images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their event images" ON storage.objects;
-- New names too, so the migration is re-runnable (idempotency, consistent
-- with the rest of the 20261030 set).
DROP POLICY IF EXISTS "Users can upload event images to their folder" ON storage.objects;
DROP POLICY IF EXISTS "Users can update event images in their folder" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete event images in their folder" ON storage.objects;

CREATE POLICY "Users can upload event images to their folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'event-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can update event images in their folder"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'event-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'event-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete event images in their folder"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'event-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- -----------------------------
-- avatars
-- -----------------------------
DROP POLICY IF EXISTS "Users can upload avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can update avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;

CREATE POLICY "Users can upload their own avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can update their own avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete their own avatar"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
