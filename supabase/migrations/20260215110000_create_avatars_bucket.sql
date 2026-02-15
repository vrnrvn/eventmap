INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg','image/jpg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public can view avatars" ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'avatars');
CREATE POLICY "Users can upload avatars" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars');
CREATE POLICY "Users can update avatars" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars') WITH CHECK (bucket_id = 'avatars');
CREATE POLICY "Users can delete avatars" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars');
