/*
  # EventMap Initial Database Schema

  ## Overview
  Complete schema for EventMap - a map-first local events platform with business profiles,
  event management, subscriptions, and social features.

  ## New Tables

  ### 1. profiles
  - `id` (uuid, primary key) - References auth.users
  - `name` (text) - User's display name
  - `avatar_url` (text, nullable) - Profile photo URL
  - `created_at` (timestamptz) - Account creation timestamp

  ### 2. businesses
  - `id` (uuid, primary key) - Business identifier
  - `owner_id` (uuid, unique) - References profiles(id) - MVP: one business per user
  - `name` (text) - Business name
  - `description` (text) - Business description
  - `category` (text) - Business category (e.g., "restaurant", "fitness")
  - `address` (text) - Full address
  - `lat` (float8) - Latitude for map display
  - `lng` (float8) - Longitude for map display
  - `logo_url` (text, nullable) - Business logo
  - `verified` (boolean) - Verification badge status
  - `subscription_tier` (text) - Subscription level: 'free' or 'premium'
  - `subscription_expires_at` (timestamptz, nullable) - Subscription expiration date
  - `events_created_this_month` (integer) - Counter for monthly event limit
  - `last_reset_date` (date) - Last time the counter was reset
  - `created_at` (timestamptz) - Business creation timestamp

  ### 3. categories
  - `id` (uuid, primary key) - Category identifier
  - `slug` (text, unique) - URL-friendly identifier
  - `label` (text) - Display name
  - `icon_key` (text) - Icon identifier for UI
  - `sort_order` (integer) - Display order
  - `created_at` (timestamptz) - Creation timestamp

  ### 4. events
  - `id` (uuid, primary key) - Event identifier
  - `business_id` (uuid) - References businesses(id)
  - `title` (text) - Event name
  - `description` (text) - Full event description
  - `category_id` (uuid) - References categories(id)
  - `start_datetime` (timestamptz) - Event start time
  - `end_datetime` (timestamptz) - Event end time
  - `lat` (float8) - Event latitude
  - `lng` (float8) - Event longitude
  - `address` (text) - Event location address
  - `cover_image_url` (text, nullable) - Main event photo
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 5. event_links
  - `id` (uuid, primary key) - Link identifier
  - `event_id` (uuid) - References events(id)
  - `label` (text, nullable) - Optional link label (e.g., "Tickets", "Instagram")
  - `url` (text) - The actual URL
  - `sort_order` (integer) - Display order
  - `created_at` (timestamptz) - Creation timestamp

  ### 6. event_photos
  - `id` (uuid, primary key) - Photo identifier
  - `event_id` (uuid) - References events(id)
  - `image_url` (text) - Photo URL in storage
  - `sort_order` (integer) - Display order in gallery
  - `created_at` (timestamptz) - Upload timestamp

  ### 7. rsvps
  - `id` (uuid, primary key) - RSVP identifier
  - `user_id` (uuid) - References profiles(id)
  - `event_id` (uuid) - References events(id)
  - `status` (text) - RSVP status: 'going' or 'interested'
  - `created_at` (timestamptz) - RSVP timestamp
  - Unique constraint on (user_id, event_id)

  ### 8. saves
  - `id` (uuid, primary key) - Save identifier
  - `user_id` (uuid) - References profiles(id)
  - `event_id` (uuid) - References events(id)
  - `created_at` (timestamptz) - Save timestamp
  - Unique constraint on (user_id, event_id)

  ### 9. follows
  - `id` (uuid, primary key) - Follow identifier
  - `user_id` (uuid) - References profiles(id)
  - `business_id` (uuid) - References businesses(id)
  - `created_at` (timestamptz) - Follow timestamp
  - Unique constraint on (user_id, business_id)

  ## Indexes
  - Geographic indexes for location-based queries
  - Business and event lookups
  - User relationship queries
  - Category filtering

  ## Security
  - RLS will be enabled in a separate migration
  - All tables will have appropriate row-level security policies
*/

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  avatar_url text,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create businesses table
CREATE TABLE IF NOT EXISTS businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text DEFAULT '' NOT NULL,
  category text NOT NULL,
  address text NOT NULL,
  lat float8 NOT NULL,
  lng float8 NOT NULL,
  logo_url text,
  verified boolean DEFAULT false NOT NULL,
  subscription_tier text DEFAULT 'free' NOT NULL CHECK (subscription_tier IN ('free', 'premium')),
  subscription_expires_at timestamptz,
  events_created_this_month integer DEFAULT 0 NOT NULL,
  last_reset_date date DEFAULT CURRENT_DATE NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create categories table
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  label text NOT NULL,
  icon_key text NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create events table
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text DEFAULT '' NOT NULL,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  start_datetime timestamptz NOT NULL,
  end_datetime timestamptz NOT NULL,
  lat float8 NOT NULL,
  lng float8 NOT NULL,
  address text NOT NULL,
  cover_image_url text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT valid_date_range CHECK (end_datetime > start_datetime)
);

-- Create event_links table
CREATE TABLE IF NOT EXISTS event_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label text,
  url text NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create event_photos table
CREATE TABLE IF NOT EXISTS event_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create rsvps table
CREATE TABLE IF NOT EXISTS rsvps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('going', 'interested')),
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, event_id)
);

-- Create saves table
CREATE TABLE IF NOT EXISTS saves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, event_id)
);

-- Create follows table
CREATE TABLE IF NOT EXISTS follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, business_id)
);

-- Create indexes for performance

-- Event queries
CREATE INDEX IF NOT EXISTS idx_events_business_id ON events(business_id);
CREATE INDEX IF NOT EXISTS idx_events_category_id ON events(category_id);
CREATE INDEX IF NOT EXISTS idx_events_start_datetime ON events(start_datetime);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_lat_lng ON events(lat, lng);

-- Business queries
CREATE INDEX IF NOT EXISTS idx_businesses_owner_id ON businesses(owner_id);
CREATE INDEX IF NOT EXISTS idx_businesses_subscription_tier ON businesses(subscription_tier);
CREATE INDEX IF NOT EXISTS idx_businesses_lat_lng ON businesses(lat, lng);

-- Relationship queries
CREATE INDEX IF NOT EXISTS idx_rsvps_user_id ON rsvps(user_id);
CREATE INDEX IF NOT EXISTS idx_rsvps_event_id ON rsvps(event_id);
CREATE INDEX IF NOT EXISTS idx_saves_user_id ON saves(user_id);
CREATE INDEX IF NOT EXISTS idx_saves_event_id ON saves(event_id);
CREATE INDEX IF NOT EXISTS idx_follows_user_id ON follows(user_id);
CREATE INDEX IF NOT EXISTS idx_follows_business_id ON follows(business_id);

-- Event associations
CREATE INDEX IF NOT EXISTS idx_event_links_event_id ON event_links(event_id);
CREATE INDEX IF NOT EXISTS idx_event_photos_event_id ON event_photos(event_id);

-- Category queries
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON categories(sort_order);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to events table
DROP TRIGGER IF EXISTS update_events_updated_at ON events;
CREATE TRIGGER update_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();