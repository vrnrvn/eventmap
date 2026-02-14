-- Add hobbies for user event preferences
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hobbies text;

-- Add contact email for businesses
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS contact_email text;
