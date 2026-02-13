/*
  # Enable Row Level Security and Policies

  ## Security Model

  ### 1. Profiles
  - Public: Read all profiles
  - Users: Insert their own profile on signup
  - Users: Update their own profile

  ### 2. Businesses
  - Public: Read all businesses
  - Authenticated: Create business (one per user)
  - Owners: Update/delete their own business

  ### 3. Categories
  - Public: Read all categories
  - Admin only: Modify categories (enforced at application level)

  ### 4. Events
  - Public: Read upcoming events
  - Business owners: Create events for their business
  - Business owners: Update/delete their own events

  ### 5. Event Links & Photos
  - Public: Read links and photos for visible events
  - Event owners: Manage links and photos for their events

  ### 6. RSVPs, Saves, Follows
  - Users: Read their own records
  - Users: Create/delete their own records
  - Public: Read aggregated counts only

  ## Important Notes
  - All tables have RLS enabled
  - Default deny: no access unless explicitly granted
  - Public read for discovery features
  - Owner-based write access
*/

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

-- ============================================
-- PROFILES POLICIES
-- ============================================

CREATE POLICY "Anyone can view profiles"
  ON profiles
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Users can insert their own profile"
  ON profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ============================================
-- BUSINESSES POLICIES
-- ============================================

CREATE POLICY "Anyone can view businesses"
  ON businesses
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Authenticated users can create business"
  ON businesses
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = owner_id
    AND NOT EXISTS (
      SELECT 1 FROM businesses WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "Business owners can update their business"
  ON businesses
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Business owners can delete their business"
  ON businesses
  FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_id);

-- ============================================
-- CATEGORIES POLICIES
-- ============================================

CREATE POLICY "Anyone can view categories"
  ON categories
  FOR SELECT
  TO public
  USING (true);

-- Note: Insert/Update/Delete for categories restricted to service role only
-- No user-level policies for modifications

-- ============================================
-- EVENTS POLICIES
-- ============================================

CREATE POLICY "Anyone can view upcoming events"
  ON events
  FOR SELECT
  TO public
  USING (end_datetime > now());

CREATE POLICY "Business owners can create events"
  ON events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = business_id
      AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Business owners can update their events"
  ON events
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = events.business_id
      AND businesses.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = events.business_id
      AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Business owners can delete their events"
  ON events
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = events.business_id
      AND businesses.owner_id = auth.uid()
    )
  );

-- ============================================
-- EVENT LINKS POLICIES
-- ============================================

CREATE POLICY "Anyone can view event links"
  ON event_links
  FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_links.event_id
      AND events.end_datetime > now()
    )
  );

CREATE POLICY "Event owners can insert links"
  ON event_links
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events
      JOIN businesses ON businesses.id = events.business_id
      WHERE events.id = event_links.event_id
      AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Event owners can update links"
  ON event_links
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events
      JOIN businesses ON businesses.id = events.business_id
      WHERE events.id = event_links.event_id
      AND businesses.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events
      JOIN businesses ON businesses.id = events.business_id
      WHERE events.id = event_links.event_id
      AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Event owners can delete links"
  ON event_links
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events
      JOIN businesses ON businesses.id = events.business_id
      WHERE events.id = event_links.event_id
      AND businesses.owner_id = auth.uid()
    )
  );

-- ============================================
-- EVENT PHOTOS POLICIES
-- ============================================

CREATE POLICY "Anyone can view event photos"
  ON event_photos
  FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_photos.event_id
      AND events.end_datetime > now()
    )
  );

CREATE POLICY "Event owners can insert photos"
  ON event_photos
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events
      JOIN businesses ON businesses.id = events.business_id
      WHERE events.id = event_photos.event_id
      AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Event owners can update photos"
  ON event_photos
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events
      JOIN businesses ON businesses.id = events.business_id
      WHERE events.id = event_photos.event_id
      AND businesses.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events
      JOIN businesses ON businesses.id = events.business_id
      WHERE events.id = event_photos.event_id
      AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Event owners can delete photos"
  ON event_photos
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events
      JOIN businesses ON businesses.id = events.business_id
      WHERE events.id = event_photos.event_id
      AND businesses.owner_id = auth.uid()
    )
  );

-- ============================================
-- RSVPS POLICIES
-- ============================================

CREATE POLICY "Users can view their own RSVPs"
  ON rsvps
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own RSVPs"
  ON rsvps
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own RSVPs"
  ON rsvps
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own RSVPs"
  ON rsvps
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================
-- SAVES POLICIES
-- ============================================

CREATE POLICY "Users can view their own saves"
  ON saves
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own saves"
  ON saves
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own saves"
  ON saves
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================
-- FOLLOWS POLICIES
-- ============================================

CREATE POLICY "Users can view their own follows"
  ON follows
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own follows"
  ON follows
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own follows"
  ON follows
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);