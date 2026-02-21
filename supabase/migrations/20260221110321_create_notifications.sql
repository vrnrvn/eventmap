/*
  # Create Notifications Table

  1. New Tables
    - `notifications`
      - `id` (uuid, primary key) - Unique notification identifier
      - `user_id` (uuid, not null) - References auth.users, cascades on delete
      - `type` (text, not null) - Notification type (e.g., 'rsvp', 'follow', 'event_update')
      - `title` (text, not null) - Notification title
      - `body` (text, not null) - Notification body text
      - `event_id` (uuid, nullable) - Optional reference to related event
      - `read` (boolean, not null, default false) - Whether notification has been read
      - `created_at` (timestamptz, not null, default now()) - Timestamp of notification creation

  2. Indexes
    - `(user_id, created_at desc)` - Efficient querying of user notifications by date
    - `(user_id, read)` - Efficient filtering of unread notifications

  3. Security
    - Enable RLS on `notifications` table
    - Add SELECT policy: users can only read their own notifications
    - Add UPDATE policy: users can only update their own notifications
    - Add DELETE policy: users can only delete their own notifications
*/

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  event_id uuid NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications(user_id, read);

-- Enable Row Level Security
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- SELECT policy: users can only read their own notifications
CREATE POLICY "Users can read own notifications"
  ON notifications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- UPDATE policy: users can only update their own notifications
CREATE POLICY "Users can update own notifications"
  ON notifications
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE policy: users can only delete their own notifications
CREATE POLICY "Users can delete own notifications"
  ON notifications
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
