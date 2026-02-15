-- Business photos (venue/place/gym images)
CREATE TABLE IF NOT EXISTS business_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_business_photos_business_id ON business_photos(business_id);

ALTER TABLE business_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view business photos"
  ON business_photos FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Business owners can manage their photos"
  ON business_photos FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = business_photos.business_id
        AND businesses.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = business_photos.business_id
        AND businesses.owner_id = auth.uid()
    )
  );
