-- Add is_admin column to profiles for admin access control
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false NOT NULL;
