export type SocialHandles = {
  instagram?: string;
  facebook?: string;
};

export type NotificationPreferences = {
  /** "Still interested?" nudge the day before an event marked as interested. */
  interested_reminder?: boolean;
  new_follower?: boolean;
  new_event_from_followed?: boolean;
  event_update?: boolean;
  rsvp?: boolean;
  nearby_event?: boolean;
  /** Announcements sent by hosts of events you RSVP'd to (20261103130000). */
  host_announcement?: boolean;
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
  /** Onboarding answer; column from 20261110100000 (may be unapplied). */
  intent?: 'attend' | 'host' | 'both' | null;
  is_admin?: boolean;
  is_profile_private?: boolean;
  show_attendance_publicly?: boolean;
  show_future_events?: boolean;
  notification_preferences?: NotificationPreferences;
  event_reminder_enabled?: boolean;
  event_reminder_minutes?: number | null;
  created_at: string;
};

export type AttendeesPage = {
  total: number;
  items: PublicAttendee[];
  has_more: boolean;
};

export type PublicAttendee = {
  id: string;
  name: string;
  avatar_url: string | null;
  bio: string | null;
  /** When true, user chose to hide; shown as "Anonymous", not tappable */
  is_anonymous?: boolean;
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
  /** NULL for hosts without a street address (location_kind 'area' | 'none'). */
  address: string | null;
  lat: number | null;
  lng: number | null;
  logo_url: string | null;
  contact_email: string | null;
  google_reviews_url: string | null;
  social_handles: BusinessSocialHandles | null;
  verified: boolean;
  subscription_tier: SubscriptionTier;
  subscription_expires_at: string | null;
  events_created_this_month: number;
  last_reset_date: string;
  notifications_enabled?: boolean;
  /** Columns from 20261110110000 (may be unapplied: then undefined → treat as venue/fixed). */
  host_type?: HostType;
  location_kind?: HostLocationKind;
  host_terms_version?: number | null;
  host_terms_accepted_at?: string | null;
  onboarding_completed_at?: string | null;
  /** Columns from 20261110140000 (may be unapplied: then undefined → treat as good). */
  standing?: HostStanding;
  standing_reason?: string | null;
  standing_updated_at?: string | null;
  /** Set when the owner stopped hosting (20261110170000). */
  archived_at?: string | null;
  created_at: string;
};

export type HostStanding = 'good' | 'warning' | 'restricted';
export type VerificationStatus = 'pending' | 'needs_info' | 'approved' | 'rejected';
export type HostVerificationRequest = {
  id: string;
  business_id: string;
  status: VerificationStatus;
  evidence_url: string;
  note: string | null;
  reviewer_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type HostType = 'venue' | 'organiser' | 'individual';
export type HostLocationKind = 'fixed' | 'area' | 'none';

export type Category = {
  id: string;
  slug: string;
  label: string;
  /** Lucide icon name resolved by constants/categoryIconRegistry.ts. */
  icon_key: string;
  sort_order: number;
  created_at: string;
  /**
   * Added by 20261109100000_category_taxonomy. Optional (and undefined on a
   * database that has not applied it): utils/categoryPresentation falls back
   * to the bundled seed by slug.
   */
  color?: string | null;
  description?: string;
  synonyms?: string[];
  is_active?: boolean;
};

/** Single definition lives with the logic that interprets it. */
export type { RecurrencePattern } from '@/utils/recurrence';
import type { RecurrencePattern } from '@/utils/recurrence';

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
  /** 'active' | 'cancelled' (20261030106000). */
  status?: EventStatus;
  /** Going-capacity cap; null/undefined = unlimited (20261030108000). */
  max_attendees?: number | null;
  /** Host switch "Accepting RSVPs" off (20261103130000). */
  rsvp_closed?: boolean;
  /** 'approval' = the host reviews join requests (20261103170000). */
  rsvp_mode?: RsvpMode;
  /** 'off' | 'notify' | 'auto' (20261103130000); undefined = notify. */
  waitlist_mode?: WaitlistMode;
  /**
   * IANA zone the host scheduled in (20261103140000). null/undefined = legacy
   * event, rendered in the viewer's zone with no "your time" line.
   */
  timezone?: string | null;
  /** Phase 3 (20261103150000). Undefined while the migration is unapplied. */
  publish_state?: PublishState;
  visibility?: EventVisibility;
  ticket_url?: string | null;
  price_label?: string | null;
  age_restriction?: AgeRestriction;
  accessibility_notes?: string | null;
  what_to_bring?: string | null;
  /** Size preset used at creation (20261110120000); analytics only. */
  event_type?: EventPresetId | null;
  /** Host's note for a postponed event. */
  status_note?: string | null;
  created_at: string;
  updated_at: string;
};

/** 'postponed' added by 20261103150000: visible, RSVPs kept, joining closed. */
export type EventStatus = 'active' | 'cancelled' | 'postponed';
export type WaitlistMode = 'off' | 'notify' | 'auto';
export type PublishState = 'draft' | 'published';
export type EventVisibility = 'public' | 'unlisted';
export type AgeRestriction = 'none' | '18+' | '21+';

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
/** What a viewer's rsvps row can hold once approval mode exists (20261103170000). */
export type AttendeeRsvpStatus = RsvpStatus | 'requested';
export type RsvpMode = 'open' | 'approval';

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

export type EventChatMessage = {
  id: string;
  event_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
  /** Who removed it (sender, host or admin); null for automatic hides. */
  deleted_by: string | null;
  mentions: string[];
};

export type EventChatMessageWithSender = EventChatMessage & {
  sender: Pick<Profile, 'id' | 'name' | 'avatar_url'> | null;
  /** Display names for `mentions`, used to highlight @Name spans. */
  mention_names: Record<string, string>;
};

export type EventPresetId = 'casual' | 'class' | 'venue_show' | 'large';

export type RankedEvent = Omit<Event, 'updated_at'> & {
  updated_at?: string;
  distance_km: number;
  is_premium: boolean;
  rsvp_count: number;
  save_count: number;
  business_name: string;
  business_logo_url: string | null;
  category_label: string;
  category_slug: string;
  /** Next occurrence for recurring events; equals start_datetime otherwise. Only set by the attendance RPCs. */
  next_start_datetime?: string | null;
  /** Set by get_user_saved_events. */
  has_ended?: boolean;
  saved_at?: string;
  /** Viewer fields added by 20261030114000. */
  user_rsvp?: AttendeeRsvpStatus | null;
  user_saved?: boolean;
  /** Set by the attendance RPCs once 20261102100000 is applied. */
  status?: EventStatus;
};

export type EventDetails = {
  event: Event;
  business: Business;
  category: Category;
  links: EventLink[];
  photos: EventPhoto[];
  rsvp_count: number;
  save_count: number;
  user_rsvp: AttendeeRsvpStatus | null;
  user_saved: boolean;
  user_following_business: boolean;
  /**
   * Present once migration 20261102160000 is applied. `position` is the
   * viewer's 1-based place in line, or 0/null when not on the waitlist.
   */
  waitlist?: { count: number; position: number | null; notified_at: string | null };
};

export type { Database } from './supabase.generated';
