-- Add business profile fields for Google Reviews URL and social handles
-- google_reviews_url: optional direct link to business Google Reviews page
-- social_handles: { "instagram": "...", "facebook": "..." }

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS google_reviews_url text,
  ADD COLUMN IF NOT EXISTS social_handles jsonb DEFAULT '{}';

-- Update get_user_business to return new columns (and contact_email if missing)
-- Must DROP first because PostgreSQL does not allow changing return type with CREATE OR REPLACE
DROP FUNCTION IF EXISTS get_user_business();

CREATE FUNCTION get_user_business()
RETURNS TABLE (
  id uuid,
  owner_id uuid,
  name text,
  description text,
  category text,
  address text,
  lat float8,
  lng float8,
  logo_url text,
  contact_email text,
  google_reviews_url text,
  social_handles jsonb,
  verified boolean,
  subscription_tier text,
  subscription_expires_at timestamptz,
  events_created_this_month integer,
  last_reset_date date,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.id,
    b.owner_id,
    b.name,
    b.description,
    b.category,
    b.address,
    b.lat,
    b.lng,
    b.logo_url,
    b.contact_email,
    b.google_reviews_url,
    COALESCE(b.social_handles, '{}'::jsonb),
    b.verified,
    b.subscription_tier,
    b.subscription_expires_at,
    b.events_created_this_month,
    b.last_reset_date,
    b.created_at
  FROM businesses b
  WHERE b.owner_id = auth.uid();
END;
$$;
