-- ISOLATED container only: bring the image's auth stub in line with what GoTrue installs.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_change_token_new text;
CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid, user_id uuid, provider_id text, identity_data jsonb, provider text,
  created_at timestamptz, updated_at timestamptz, UNIQUE (provider_id, provider));
