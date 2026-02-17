-- Add profile fields for privacy-first social features
-- bio: user's "About Me" text
-- social_handles: { "instagram": "...", "facebook": "..." }
-- is_profile_private: if true, user is invisible in search and lists
-- show_attendance_publicly: if false, user counts in rsvp_count but not in attendees list
-- show_future_events: if false, hides "My Calendar" section on profile from others

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS social_handles jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_profile_private boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_attendance_publicly boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_future_events boolean DEFAULT true;
