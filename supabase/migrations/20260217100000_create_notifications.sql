-- Notifications table for user alerts (new events from followed businesses, etc.)
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  business_id uuid REFERENCES businesses(id) ON DELETE SET NULL,
  read boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications (mark read)"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own notifications"
  ON notifications FOR DELETE
  USING (user_id = auth.uid());

-- Trigger: when a new event is created, notify all users who follow that business
CREATE OR REPLACE FUNCTION notify_followers_on_new_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notifications (user_id, type, title, body, event_id, business_id)
  SELECT
    f.user_id,
    'new_event_from_followed',
    b.name || ' posted a new event',
    NEW.title,
    NEW.id,
    NEW.business_id
  FROM follows f
  JOIN businesses b ON b.id = NEW.business_id
  WHERE f.business_id = NEW.business_id
    AND f.user_id != b.owner_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_notify_followers_on_new_event
  AFTER INSERT ON events
  FOR EACH ROW
  EXECUTE FUNCTION notify_followers_on_new_event();

-- Allow business owners to view followers of their business
CREATE POLICY "Business owners can view followers of their business"
  ON follows
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = follows.business_id
        AND businesses.owner_id = auth.uid()
    )
  );
