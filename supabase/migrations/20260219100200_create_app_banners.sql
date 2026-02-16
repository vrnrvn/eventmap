-- App banners for headers, banners, and ads
CREATE TABLE IF NOT EXISTS app_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('header', 'banner', 'ad')),
  title text NOT NULL,
  content text DEFAULT '',
  image_url text,
  link_url text,
  placement text NOT NULL DEFAULT 'discover',
  is_active boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_banners_placement ON app_banners(placement);
CREATE INDEX IF NOT EXISTS idx_app_banners_active ON app_banners(is_active);
CREATE INDEX IF NOT EXISTS idx_app_banners_sort ON app_banners(sort_order);

CREATE TRIGGER set_app_banners_updated_at
  BEFORE UPDATE ON app_banners
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE app_banners ENABLE ROW LEVEL SECURITY;
