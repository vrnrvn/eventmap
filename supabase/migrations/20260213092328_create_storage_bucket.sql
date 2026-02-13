/*
  # Create Storage Bucket for Event Images

  ## Storage Configuration

  ### Bucket: event-images
  - Public access for reading
  - Authenticated users can upload
  - File size limit: 5MB
  - Allowed MIME types: image/jpeg, image/png, image/webp
  - Used for event cover photos and gallery images

  ## Security
  - Upload policy: Authenticated users only
  - Read policy: Public (for event discovery)
  - Delete policy: Event owners only (enforced in app logic)

  ## Important Notes
  - Images are publicly accessible via URL
  - File naming convention: {event_id}/{uuid}.{ext}
  - Old images should be cleaned up when events are deleted
*/

-- Insert the storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-images',
  'event-images',
  true,
  5242880, -- 5MB in bytes
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Create storage policies

-- Allow public to view images
CREATE POLICY "Public can view event images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'event-images');

-- Allow authenticated users to upload images
CREATE POLICY "Authenticated users can upload event images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'event-images'
  AND (storage.foldername(name))[1] IS NOT NULL
);

-- Allow users to update their own event images
CREATE POLICY "Users can update their event images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'event-images')
WITH CHECK (bucket_id = 'event-images');

-- Allow users to delete their own event images
CREATE POLICY "Users can delete their event images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'event-images');