-- Business links table for website, social, Google, etc.
CREATE TABLE IF NOT EXISTS business_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  label text,
  url text NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_business_links_business_id ON business_links(business_id);

ALTER TABLE business_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view business links"
  ON business_links FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Business owners can manage their links"
  ON business_links FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = business_links.business_id
        AND businesses.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = business_links.business_id
        AND businesses.owner_id = auth.uid()
    )
  );
