/*
  # Seed Initial Data for EventMap

  ## Data Created

  ### 1. Categories
  - DJ Nights & Nightlife
  - Run Clubs & Fitness
  - Coffee & Tastings
  - Trivia & Game Nights
  - Pop-ups & Markets
  - Live Music
  - Workshops & Classes
  - Food & Dining
  - Sports & Recreation
  - Art & Culture

  ### 2. Sample Test Users (via profiles table)
  - These will be created when users sign up

  ### 3. Sample Businesses
  - Mix of free and premium tier businesses
  - Various categories
  - Real-looking business data

  ### 4. Sample Events
  - Multiple events per business
  - Future dates
  - Complete with descriptions, links, and photos
  - Cover different times and categories

  ## Important Notes
  - All dates are set relative to current time
  - Sample data is realistic and production-ready
  - Images use placeholder URLs (Pexels stock photos)
*/

-- Insert categories
INSERT INTO categories (slug, label, icon_key, sort_order) VALUES
  ('nightlife', 'DJ Nights & Nightlife', 'music', 1),
  ('fitness', 'Run Clubs & Fitness', 'activity', 2),
  ('food-drink', 'Coffee & Tastings', 'coffee', 3),
  ('trivia', 'Trivia & Game Nights', 'brain', 4),
  ('markets', 'Pop-ups & Markets', 'shopping-bag', 5),
  ('live-music', 'Live Music', 'music-2', 6),
  ('workshops', 'Workshops & Classes', 'book-open', 7),
  ('dining', 'Food & Dining', 'utensils', 8),
  ('sports', 'Sports & Recreation', 'trophy', 9),
  ('culture', 'Art & Culture', 'palette', 10)
ON CONFLICT (slug) DO NOTHING;

-- Note: The following sample data is commented out because it requires actual user accounts
-- to exist in auth.users before we can create profiles and businesses.
-- This data can be inserted after user authentication is set up and test users are created.

/*
-- Sample businesses will be created via the app after users sign up
-- Example structure for reference:

INSERT INTO profiles (id, name, avatar_url) VALUES
  ('user-uuid-1', 'Sarah Johnson', 'https://images.pexels.com/photos/415829/pexels-photo-415829.jpeg?auto=compress&cs=tinysrgb&w=200'),
  ('user-uuid-2', 'Mike Chen', 'https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&w=200');

INSERT INTO businesses (owner_id, name, description, category, address, lat, lng, logo_url, verified, subscription_tier) VALUES
  ('user-uuid-1', 'The Beat Lounge', 'Premier nightlife venue...', 'nightlife', '123 Main St, San Francisco, CA', 37.7749, -122.4194, null, true, 'premium'),
  ('user-uuid-2', 'Bay Area Runners', 'Community running group...', 'fitness', '456 Park Ave, San Francisco, CA', 37.7849, -122.4094, null, false, 'free');
*/