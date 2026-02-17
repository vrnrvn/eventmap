export type SocialHandles = {
  instagram?: string;
  facebook?: string;
};

export type Profile = {
  id: string;
  name: string;
  avatar_url: string | null;
  bio: string | null;
  social_handles: SocialHandles | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  hobbies: string | null;
  has_completed_onboarding?: boolean;
  preferred_categories?: string[];
  is_admin?: boolean;
  is_profile_private?: boolean;
  show_attendance_publicly?: boolean;
  show_future_events?: boolean;
  created_at: string;
};

export type PublicAttendee = {
  id: string;
  name: string;
  avatar_url: string | null;
  bio: string | null;
};

export type SubscriptionTier = 'free' | 'premium';

export type BusinessSocialHandles = {
  instagram?: string;
  facebook?: string;
};

export type Business = {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  category: string;
  address: string;
  lat: number;
  lng: number;
  logo_url: string | null;
  contact_email: string | null;
  google_reviews_url: string | null;
  social_handles: BusinessSocialHandles | null;
  verified: boolean;
  subscription_tier: SubscriptionTier;
  subscription_expires_at: string | null;
  events_created_this_month: number;
  last_reset_date: string;
  created_at: string;
};

export type Category = {
  id: string;
  slug: string;
  label: string;
  icon_key: string;
  sort_order: number;
  created_at: string;
};

export type RecurrencePattern = {
  frequency: 'daily' | 'weekly' | 'monthly';
  interval: number;
  endDate?: string;
};

export type Event = {
  id: string;
  business_id: string;
  title: string;
  description: string;
  category_id: string;
  start_datetime: string;
  end_datetime: string;
  lat: number;
  lng: number;
  address: string;
  cover_image_url: string | null;
  is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern | null;
  created_at: string;
  updated_at: string;
};

export type EventLink = {
  id: string;
  event_id: string;
  label: string | null;
  url: string;
  sort_order: number;
  created_at: string;
};

export type BusinessLink = {
  id: string;
  business_id: string;
  label: string | null;
  url: string;
  sort_order: number;
  created_at: string;
};

export type BusinessPhoto = {
  id: string;
  business_id: string;
  image_url: string;
  sort_order: number;
  created_at: string;
};

export type EventPhoto = {
  id: string;
  event_id: string;
  image_url: string;
  sort_order: number;
  created_at: string;
};

export type RsvpStatus = 'going' | 'interested';

export type Rsvp = {
  id: string;
  user_id: string;
  event_id: string;
  status: RsvpStatus;
  created_at: string;
};

export type Save = {
  id: string;
  user_id: string;
  event_id: string;
  created_at: string;
};

export type Follow = {
  id: string;
  user_id: string;
  business_id: string;
  created_at: string;
};

export type Review = {
  id: string;
  user_id: string;
  business_id: string;
  rating: number;
  text: string | null;
  business_response: string | null;
  created_at: string;
  updated_at: string;
};

export type Notification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  event_id: string | null;
  business_id: string | null;
  read: boolean;
  created_at: string;
};

export type RankedEvent = Event & {
  distance_km: number;
  is_premium: boolean;
  rsvp_count: number;
  save_count: number;
  business_name: string;
  business_logo_url: string | null;
  category_label: string;
  category_slug: string;
};

export type EventDetails = {
  event: Event;
  business: Business;
  category: Category;
  links: EventLink[];
  photos: EventPhoto[];
  rsvp_count: number;
  save_count: number;
  user_rsvp: RsvpStatus | null;
  user_saved: boolean;
  user_following_business: boolean;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, 'created_at'>;
        Update: Partial<Omit<Profile, 'id' | 'created_at'>>;
      };
      businesses: {
        Row: Business;
        Insert: Omit<Business, 'id' | 'created_at' | 'events_created_this_month' | 'last_reset_date'>;
        Update: Partial<Omit<Business, 'id' | 'owner_id' | 'created_at'>>;
      };
      categories: {
        Row: Category;
        Insert: Omit<Category, 'id' | 'created_at'>;
        Update: Partial<Omit<Category, 'id' | 'created_at'>>;
      };
      events: {
        Row: Event;
        Insert: Omit<Event, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Event, 'id' | 'business_id' | 'created_at' | 'updated_at'>>;
      };
      event_links: {
        Row: EventLink;
        Insert: Omit<EventLink, 'id' | 'created_at'>;
        Update: Partial<Omit<EventLink, 'id' | 'event_id' | 'created_at'>>;
      };
      event_photos: {
        Row: EventPhoto;
        Insert: Omit<EventPhoto, 'id' | 'created_at'>;
        Update: Partial<Omit<EventPhoto, 'id' | 'event_id' | 'created_at'>>;
      };
      rsvps: {
        Row: Rsvp;
        Insert: Omit<Rsvp, 'id' | 'created_at'>;
        Update: Partial<Omit<Rsvp, 'id' | 'user_id' | 'event_id' | 'created_at'>>;
      };
      saves: {
        Row: Save;
        Insert: Omit<Save, 'id' | 'created_at'>;
        Update: never;
      };
      follows: {
        Row: Follow;
        Insert: Omit<Follow, 'id' | 'created_at'>;
        Update: never;
      };
    };
  };
};
