// HAND-EDITED 2026-11-10 (host onboarding Stages 1–2): businesses host columns,
// nullable location, profiles.intent, get_user_business SETOF, and
// host_terms_current_version from the unapplied migrations 20261110100000 and
// 20261110110000; events.event_type (20261110120000) and
// get_host_onboarding_status (20261110130000); standing, verification
// requests and their RPCs (20261110140000); archived_at + archive/reopen
// (20261110170000). Regenerate with `npm run backend:types` once they are applied.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_banners: {
        Row: {
          content: string | null
          created_at: string
          ends_at: string | null
          id: string
          image_url: string | null
          is_active: boolean
          link_url: string | null
          placement: string
          sort_order: number
          starts_at: string | null
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          link_url?: string | null
          placement?: string
          sort_order?: number
          starts_at?: string | null
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          content?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          link_url?: string | null
          placement?: string
          sort_order?: number
          starts_at?: string | null
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      banned_users: {
        Row: {
          banned_at: string
          banned_by: string
          id: string
          reason: string | null
          user_id: string
        }
        Insert: {
          banned_at?: string
          banned_by: string
          id?: string
          reason?: string | null
          user_id: string
        }
        Update: {
          banned_at?: string
          banned_by?: string
          id?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "banned_users_banned_by_fkey"
            columns: ["banned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banned_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      business_links: {
        Row: {
          business_id: string
          created_at: string
          id: string
          label: string | null
          sort_order: number
          url: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          label?: string | null
          sort_order?: number
          url: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          label?: string | null
          sort_order?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_links_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_photos: {
        Row: {
          business_id: string
          created_at: string
          id: string
          image_url: string
          sort_order: number
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          image_url: string
          sort_order?: number
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          image_url?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "business_photos_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          address: string | null
          archived_at: string | null
          category: string
          contact_email: string | null
          created_at: string
          description: string
          events_created_this_month: number
          google_reviews_url: string | null
          host_terms_accepted_at: string | null
          host_terms_version: number | null
          host_type: string
          id: string
          last_reset_date: string
          location_kind: string
          lat: number | null
          lng: number | null
          logo_url: string | null
          name: string
          notifications_enabled: boolean | null
          onboarding_completed_at: string | null
          owner_id: string
          social_handles: Json | null
          standing: string
          standing_reason: string | null
          standing_updated_at: string | null
          subscription_expires_at: string | null
          subscription_tier: string
          verified: boolean
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          category: string
          contact_email?: string | null
          created_at?: string
          description?: string
          events_created_this_month?: number
          google_reviews_url?: string | null
          host_terms_accepted_at?: string | null
          host_terms_version?: number | null
          host_type?: string
          id?: string
          last_reset_date?: string
          location_kind?: string
          lat?: number | null
          lng?: number | null
          logo_url?: string | null
          name: string
          notifications_enabled?: boolean | null
          onboarding_completed_at?: string | null
          owner_id: string
          social_handles?: Json | null
          standing?: string
          standing_reason?: string | null
          standing_updated_at?: string | null
          subscription_expires_at?: string | null
          subscription_tier?: string
          verified?: boolean
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          category?: string
          contact_email?: string | null
          created_at?: string
          description?: string
          events_created_this_month?: number
          google_reviews_url?: string | null
          host_terms_accepted_at?: string | null
          host_terms_version?: number | null
          host_type?: string
          id?: string
          last_reset_date?: string
          location_kind?: string
          lat?: number | null
          lng?: number | null
          logo_url?: string | null
          name?: string
          notifications_enabled?: boolean | null
          onboarding_completed_at?: string | null
          owner_id?: string
          social_handles?: Json | null
          standing?: string
          standing_reason?: string | null
          standing_updated_at?: string | null
          subscription_expires_at?: string | null
          subscription_tier?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "businesses_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          icon_key: string
          id: string
          label: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          icon_key: string
          id?: string
          label: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          icon_key?: string
          id?: string
          label?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      complaints: {
        Row: {
          created_at: string
          id: string
          reason: string | null
          reporter_id: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason?: string | null
          reporter_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string | null
          reporter_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "complaints_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complaints_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_bans: {
        Row: {
          banned_by: string | null
          created_at: string
          event_id: string
          reason: string | null
          user_id: string
        }
        Insert: {
          banned_by?: string | null
          created_at?: string
          event_id: string
          reason?: string | null
          user_id: string
        }
        Update: {
          banned_by?: string | null
          created_at?: string
          event_id?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_bans_banned_by_fkey"
            columns: ["banned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_bans_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_bans_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_chat_blocks: {
        Row: {
          blocked_by: string
          created_at: string
          event_id: string
          expires_at: string | null
          reason: string | null
          user_id: string
        }
        Insert: {
          blocked_by: string
          created_at?: string
          event_id: string
          expires_at?: string | null
          reason?: string | null
          user_id: string
        }
        Update: {
          blocked_by?: string
          created_at?: string
          event_id?: string
          expires_at?: string | null
          reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_chat_blocks_blocked_by_fkey"
            columns: ["blocked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_chat_blocks_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_chat_blocks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_chat_messages: {
        Row: {
          body: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          event_id: string
          id: string
          mentions: string[]
          sender_id: string
        }
        Insert: {
          body: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          event_id: string
          id?: string
          mentions?: string[]
          sender_id: string
        }
        Update: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          event_id?: string
          id?: string
          mentions?: string[]
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_chat_messages_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_chat_messages_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_chat_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_chat_moderation_actions: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          event_id: string
          id: string
          message_id: string | null
          reason: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          event_id: string
          id?: string
          message_id?: string | null
          reason?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          event_id?: string
          id?: string
          message_id?: string | null
          reason?: string | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_chat_moderation_actions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_chat_moderation_actions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_chat_moderation_actions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "event_chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_chat_moderation_actions_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_chat_reads: {
        Row: {
          event_id: string
          last_read_at: string
          muted: boolean
          user_id: string
        }
        Insert: {
          event_id: string
          last_read_at?: string
          muted?: boolean
          user_id: string
        }
        Update: {
          event_id?: string
          last_read_at?: string
          muted?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_chat_reads_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_chat_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_chat_removed_bodies: {
        Row: {
          body: string
          message_id: string
          removed_at: string
        }
        Insert: {
          body: string
          message_id: string
          removed_at?: string
        }
        Update: {
          body?: string
          message_id?: string
          removed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_chat_removed_bodies_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "event_chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      event_chat_settings: {
        Row: {
          chat_mode: string
          event_id: string
          locked: boolean
          open_policy: string
          pinned_message_id: string | null
          slow_mode_seconds: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          chat_mode?: string
          event_id: string
          locked?: boolean
          open_policy?: string
          pinned_message_id?: string | null
          slow_mode_seconds?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          chat_mode?: string
          event_id?: string
          locked?: boolean
          open_policy?: string
          pinned_message_id?: string | null
          slow_mode_seconds?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_chat_settings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_chat_settings_pinned_message_id_fkey"
            columns: ["pinned_message_id"]
            isOneToOne: false
            referencedRelation: "event_chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_chat_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_interactions: {
        Row: {
          created_at: string
          day: string
          event_id: string
          id: string
          kind: string
          viewer_id: string | null
        }
        Insert: {
          created_at?: string
          day?: string
          event_id: string
          id?: string
          kind: string
          viewer_id?: string | null
        }
        Update: {
          created_at?: string
          day?: string
          event_id?: string
          id?: string
          kind?: string
          viewer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_interactions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_interactions_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_links: {
        Row: {
          created_at: string
          event_id: string
          id: string
          label: string | null
          sort_order: number
          url: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          label?: string | null
          sort_order?: number
          url: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          label?: string | null
          sort_order?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_photos: {
        Row: {
          created_at: string
          event_id: string
          id: string
          image_url: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          image_url: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          image_url?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_photos_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_reminder_sent: {
        Row: {
          event_id: string
          kind: string
          reminder_minutes: number
          sent_at: string
          user_id: string
        }
        Insert: {
          event_id: string
          kind?: string
          reminder_minutes: number
          sent_at?: string
          user_id: string
        }
        Update: {
          event_id?: string
          kind?: string
          reminder_minutes?: number
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_reminder_sent_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_rsvp_counts: {
        Row: {
          event_id: string
          going_count: number
          interested_count: number
          updated_at: string
        }
        Insert: {
          event_id: string
          going_count?: number
          interested_count?: number
          updated_at?: string
        }
        Update: {
          event_id?: string
          going_count?: number
          interested_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_rsvp_counts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_views: {
        Row: {
          event_id: string
          id: string
          view_date: string
          viewed_at: string
          viewer_id: string | null
        }
        Insert: {
          event_id: string
          id?: string
          view_date?: string
          viewed_at?: string
          viewer_id?: string | null
        }
        Update: {
          event_id?: string
          id?: string
          view_date?: string
          viewed_at?: string
          viewer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_views_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_waitlist: {
        Row: {
          created_at: string
          event_id: string
          notified_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          notified_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          notified_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_waitlist_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_waitlist_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          accessibility_notes: string | null
          address: string
          age_restriction: string
          business_id: string
          category_id: string
          cover_image_url: string | null
          created_at: string
          description: string
          end_datetime: string
          event_type: string | null
          id: string
          is_recurring: boolean
          lat: number
          lng: number
          max_attendees: number | null
          price_label: string | null
          publish_state: string
          recurrence_pattern: Json | null
          rsvp_closed: boolean
          rsvp_mode: string
          start_datetime: string
          status: string
          status_note: string | null
          ticket_url: string | null
          timezone: string | null
          title: string
          updated_at: string
          visibility: string
          waitlist_mode: string
          what_to_bring: string | null
        }
        Insert: {
          accessibility_notes?: string | null
          address: string
          age_restriction?: string
          business_id: string
          category_id: string
          cover_image_url?: string | null
          created_at?: string
          description?: string
          end_datetime: string
          event_type?: string | null
          id?: string
          is_recurring?: boolean
          lat: number
          lng: number
          max_attendees?: number | null
          price_label?: string | null
          publish_state?: string
          recurrence_pattern?: Json | null
          rsvp_closed?: boolean
          rsvp_mode?: string
          start_datetime: string
          status?: string
          status_note?: string | null
          ticket_url?: string | null
          timezone?: string | null
          title: string
          updated_at?: string
          visibility?: string
          waitlist_mode?: string
          what_to_bring?: string | null
        }
        Update: {
          accessibility_notes?: string | null
          address?: string
          age_restriction?: string
          business_id?: string
          category_id?: string
          cover_image_url?: string | null
          created_at?: string
          description?: string
          end_datetime?: string
          event_type?: string | null
          id?: string
          is_recurring?: boolean
          lat?: number
          lng?: number
          max_attendees?: number | null
          price_label?: string | null
          publish_state?: string
          recurrence_pattern?: Json | null
          rsvp_closed?: boolean
          rsvp_mode?: string
          start_datetime?: string
          status?: string
          status_note?: string | null
          ticket_url?: string | null
          timezone?: string | null
          title?: string
          updated_at?: string
          visibility?: string
          waitlist_mode?: string
          what_to_bring?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      follows: {
        Row: {
          business_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follows_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      host_announcements: {
        Row: {
          audience: string
          body: string
          created_at: string
          created_by: string | null
          event_id: string
          id: string
          recipients: number
        }
        Insert: {
          audience: string
          body: string
          created_at?: string
          created_by?: string | null
          event_id: string
          id?: string
          recipients?: number
        }
        Update: {
          audience?: string
          body?: string
          created_at?: string
          created_by?: string | null
          event_id?: string
          id?: string
          recipients?: number
        }
        Relationships: [
          {
            foreignKeyName: "host_announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "host_announcements_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      host_verification_requests: {
        Row: {
          business_id: string
          created_at: string
          evidence_url: string
          id: string
          note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_note: string | null
          status: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          evidence_url: string
          id?: string
          note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          evidence_url?: string
          id?: string
          note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          business_id: string | null
          created_at: string
          data: Json | null
          event_id: string | null
          id: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          business_id?: string | null
          created_at?: string
          data?: Json | null
          event_id?: string | null
          id?: string
          read?: boolean
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          business_id?: string | null
          created_at?: string
          data?: Json | null
          event_id?: string | null
          id?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          city: string | null
          created_at: string
          event_reminder_enabled: boolean | null
          event_reminder_minutes: number | null
          has_completed_onboarding: boolean | null
          hobbies: string | null
          id: string
          intent: string | null
          is_admin: boolean
          is_profile_private: boolean | null
          lat: number | null
          lng: number | null
          name: string
          notification_preferences: Json | null
          preferred_categories: string[] | null
          show_attendance_publicly: boolean | null
          show_future_events: boolean | null
          social_handles: Json | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          created_at?: string
          event_reminder_enabled?: boolean | null
          event_reminder_minutes?: number | null
          has_completed_onboarding?: boolean | null
          hobbies?: string | null
          id: string
          intent?: string | null
          is_admin?: boolean
          is_profile_private?: boolean | null
          lat?: number | null
          lng?: number | null
          name: string
          notification_preferences?: Json | null
          preferred_categories?: string[] | null
          show_attendance_publicly?: boolean | null
          show_future_events?: boolean | null
          social_handles?: Json | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          created_at?: string
          event_reminder_enabled?: boolean | null
          event_reminder_minutes?: number | null
          has_completed_onboarding?: boolean | null
          hobbies?: string | null
          id?: string
          intent?: string | null
          is_admin?: boolean
          is_profile_private?: boolean | null
          lat?: number | null
          lng?: number | null
          name?: string
          notification_preferences?: Json | null
          preferred_categories?: string[] | null
          show_attendance_publicly?: boolean | null
          show_future_events?: boolean | null
          social_handles?: Json | null
        }
        Relationships: []
      }
      promotional_notifications: {
        Row: {
          body: string
          business_id: string | null
          created_at: string
          created_by: string | null
          event_id: string | null
          id: string
          is_active: boolean
          link_url: string | null
          promotion_type: string
          target_cities: string[] | null
          target_lat: number | null
          target_lng: number | null
          target_radius_km: number | null
          title: string
        }
        Insert: {
          body: string
          business_id?: string | null
          created_at?: string
          created_by?: string | null
          event_id?: string | null
          id?: string
          is_active?: boolean
          link_url?: string | null
          promotion_type?: string
          target_cities?: string[] | null
          target_lat?: number | null
          target_lng?: number | null
          target_radius_km?: number | null
          title: string
        }
        Update: {
          body?: string
          business_id?: string | null
          created_at?: string
          created_by?: string | null
          event_id?: string | null
          id?: string
          is_active?: boolean
          link_url?: string | null
          promotion_type?: string
          target_cities?: string[] | null
          target_lat?: number | null
          target_lng?: number | null
          target_radius_km?: number | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotional_notifications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotional_notifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_requests: {
        Row: {
          amount_cents: number
          business_id: string | null
          created_at: string
          id: string
          processed_at: string | null
          processed_by: string | null
          reason: string | null
          status: string
          stripe_refund_id: string | null
          user_id: string
        }
        Insert: {
          amount_cents: number
          business_id?: string | null
          created_at?: string
          id?: string
          processed_at?: string | null
          processed_by?: string | null
          reason?: string | null
          status?: string
          stripe_refund_id?: string | null
          user_id: string
        }
        Update: {
          amount_cents?: number
          business_id?: string | null
          created_at?: string
          id?: string
          processed_at?: string | null
          processed_by?: string | null
          reason?: string | null
          status?: string
          stripe_refund_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_requests_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          business_id: string
          business_response: string | null
          created_at: string
          id: string
          rating: number
          text: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          business_id: string
          business_response?: string | null
          created_at?: string
          id?: string
          rating: number
          text?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          business_id?: string
          business_response?: string | null
          created_at?: string
          id?: string
          rating?: number
          text?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rsvp_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          event_id: string
          from_status: string | null
          id: number
          to_status: string
          user_id: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          event_id: string
          from_status?: string | null
          id?: never
          to_status: string
          user_id?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          event_id?: string
          from_status?: string | null
          id?: never
          to_status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rsvp_history_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rsvp_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rsvps: {
        Row: {
          created_at: string
          event_id: string
          id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          status: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rsvps_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rsvps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saves: {
        Row: {
          created_at: string
          event_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saves_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saves_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_push_tokens: {
        Row: {
          app_ownership: string | null
          created_at: string
          device_id: string | null
          id: string
          is_active: boolean
          last_seen_at: string
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_ownership?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string
          platform?: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app_ownership?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_premium_simulation: {
        Args: { p_business_id: string; p_interval: string }
        Returns: undefined
      }
      admin_ban_user: {
        Args: { p_reason?: string; p_user_id: string }
        Returns: undefined
      }
      admin_count_pending_chat_reports: { Args: never; Returns: number }
      admin_dismiss_chat_reports: {
        Args: { p_message_id: string }
        Returns: number
      }
      admin_get_chat_moderation_log: {
        Args: { p_limit?: number }
        Returns: {
          action: string
          actor_id: string
          actor_name: string
          created_at: string
          event_id: string
          event_title: string
          id: string
          message_body: string
          message_id: string
          reason: string
          target_user_id: string
          target_user_name: string
        }[]
      }
      admin_get_chat_report_details: {
        Args: { p_message_id: string }
        Returns: Json
      }
      admin_get_chat_reports: {
        Args: { p_status?: string }
        Returns: {
          body: string
          deleted_at: string
          event_id: string
          event_title: string
          first_reported_at: string
          last_reported_at: string
          message_created_at: string
          message_id: string
          reasons: string[]
          report_count: number
          report_status: string
          sender_banned: boolean
          sender_blocked: boolean
          sender_id: string
          sender_name: string
        }[]
      }
      admin_reset_business_event_limit: {
        Args: { p_business_id: string }
        Returns: undefined
      }
      admin_resolve_chat_reports: {
        Args: { p_message_id: string }
        Returns: number
      }
      admin_restore_chat_message: {
        Args: { p_message_id: string }
        Returns: boolean
      }
      admin_set_business_premium: {
        Args: { p_business_id: string; p_is_premium: boolean }
        Returns: undefined
      }
      admin_set_business_verified: {
        Args: { p_business_id: string; p_verified: boolean }
        Returns: undefined
      }
      archive_business: { Args: never; Returns: number }
      admin_review_verification: {
        Args: { p_decision: string; p_note?: string; p_request_id: string }
        Returns: undefined
      }
      admin_set_host_standing: {
        Args: { p_business_id: string; p_reason?: string; p_standing: string }
        Returns: undefined
      }
      admin_unban_user: { Args: { p_user_id: string }; Returns: undefined }
      block_event_chat_user: {
        Args: {
          p_duration_minutes?: number
          p_event_id: string
          p_reason?: string
          p_user_id: string
        }
        Returns: undefined
      }
      business_has_premium: {
        Args: { business_uuid: string }
        Returns: boolean
      }
      calculate_distance: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      can_view_user_events: { Args: { target_user: string }; Returns: boolean }
      cancel_event: { Args: { p_event_id: string }; Returns: undefined }
      cancel_premium_simulation: {
        Args: { p_business_id: string }
        Returns: undefined
      }
      chat_viewer_going_event_ids: { Args: never; Returns: string[] }
      chat_viewer_hosted_event_ids: { Args: never; Returns: string[] }
      check_event_creation_limit: {
        Args: { business_uuid: string }
        Returns: boolean
      }
      create_event_with_limit_check: {
        Args: {
          p_address: string
          p_business_id: string
          p_category_id: string
          p_cover_image_url?: string
          p_description: string
          p_end_datetime: string
          p_is_recurring?: boolean
          p_lat: number
          p_lng: number
          p_max_attendees?: number
          p_publish_state?: string
          p_recurrence_pattern?: Json
          p_start_datetime: string
          p_timezone?: string
          p_title: string
        }
        Returns: string
      }
      deactivate_push_token: { Args: { p_token: string }; Returns: undefined }
      delete_event_chat_message: {
        Args: { p_message_id: string }
        Returns: boolean
      }
      delete_own_account: { Args: never; Returns: undefined }
      dismiss_event_chat_reports: {
        Args: { p_message_id: string }
        Returns: number
      }
      duplicate_event: { Args: { p_event_id: string }; Returns: string }
      ensure_profile_exists: {
        Args: { p_name?: string; p_user_id: string }
        Returns: undefined
      }
      event_allows_rsvp_changes: {
        Args: { p_event_id: string }
        Returns: boolean
      }
      event_has_ended:
        | {
            Args: {
              p_end_datetime: string
              p_is_recurring: boolean
              p_recurrence_pattern: Json
            }
            Returns: boolean
          }
        | {
            Args: {
              p_end_datetime: string
              p_is_recurring: boolean
              p_recurrence_pattern: Json
              p_timezone: string
            }
            Returns: boolean
          }
      event_is_open_for_rsvp: { Args: { p_event_id: string }; Returns: boolean }
      event_next_occurrence:
        | {
            Args: {
              p_is_recurring: boolean
              p_recurrence_pattern: Json
              p_start_datetime: string
            }
            Returns: string
          }
        | {
            Args: {
              p_is_recurring: boolean
              p_recurrence_pattern: Json
              p_start_datetime: string
              p_timezone: string
            }
            Returns: string
          }
      event_requires_approval: {
        Args: { p_event_id: string }
        Returns: boolean
      }
      event_rsvps_closed: { Args: { p_event_id: string }; Returns: boolean }
      get_business_analytics: {
        Args: { business_uuid: string; days?: number }
        Returns: Json
      }
      get_business_follower_counts: {
        Args: { p_business_ids: string[] }
        Returns: {
          business_id: string
          follower_count: number
        }[]
      }
      get_business_review_summary: {
        Args: { p_business_id: string }
        Returns: {
          average: number
          review_count: number
        }[]
      }
      get_event_attendees_page: {
        Args: {
          event_uuid: string
          p_limit?: number
          p_offset?: number
          p_search?: string
        }
        Returns: Json
      }
      get_event_attendees_public: {
        Args: { event_uuid: string }
        Returns: Json
      }
      get_event_chat_messages: {
        Args: {
          event_uuid: string
          p_before_created_at?: string
          p_before_id?: string
          p_limit?: number
        }
        Returns: {
          body: string
          created_at: string
          deleted_at: string
          deleted_by: string
          event_id: string
          id: string
          mentions: string[]
          sender_id: string
        }[]
      }
      get_event_chat_messages_since: {
        Args: { event_uuid: string; p_limit?: number; p_since: string }
        Returns: {
          body: string
          created_at: string
          deleted_at: string
          deleted_by: string
          event_id: string
          id: string
          mentions: string[]
          sender_id: string
        }[]
      }
      get_event_chat_post_status: {
        Args: { event_uuid: string }
        Returns: {
          block_expires_at: string
          can_post: boolean
          can_read: boolean
          chat_mode: string
          is_admin: boolean
          is_banned: boolean
          is_blocked: boolean
          is_host: boolean
          last_post_at: string
          last_read_at: string
          locked: boolean
          muted: boolean
          open_policy: string
          pinned_message_id: string
          slow_mode_seconds: number
        }[]
      }
      get_event_chat_reported_messages: {
        Args: { event_uuid: string }
        Returns: {
          body: string
          created_at: string
          deleted_at: string
          last_reported_at: string
          message_id: string
          reasons: string[]
          report_count: number
          sender_id: string
          sender_name: string
        }[]
      }
      get_event_chat_unread_counts: {
        Args: { p_event_ids?: string[] }
        Returns: {
          event_id: string
          latest_message_at: string
          unread_count: number
        }[]
      }
      get_event_details: { Args: { event_uuid: string }; Returns: Json }
      get_event_host_attendees_page: {
        Args: {
          p_event_id: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: string
        }
        Returns: Json
      }
      get_event_host_overview: { Args: { p_event_id: string }; Returns: Json }
      get_event_insights: {
        Args: { p_days?: number; p_event_id: string }
        Returns: Json
      }
      get_host_events_counts: { Args: { p_event_ids: string[] }; Returns: Json }
      get_host_onboarding_status: { Args: never; Returns: Json }
      get_profiles_display: { Args: { user_ids: string[] }; Returns: Json }
      get_public_profile: { Args: { user_id_param: string }; Returns: Json }
      get_ranked_events: {
        Args: {
          category_ids?: string[]
          end_date?: string
          p_offset?: number
          radius_km?: number
          result_limit?: number
          search_query?: string
          start_date?: string
          user_lat: number
          user_lng: number
        }
        Returns: {
          address: string
          business_id: string
          business_logo_url: string
          business_name: string
          category_id: string
          category_label: string
          category_slug: string
          cover_image_url: string
          created_at: string
          description: string
          distance_km: number
          end_datetime: string
          has_ended: boolean
          id: string
          is_premium: boolean
          is_recurring: boolean
          lat: number
          lng: number
          max_attendees: number
          next_start_datetime: string
          recurrence_pattern: Json
          rsvp_count: number
          save_count: number
          start_datetime: string
          title: string
          user_rsvp: string
          user_saved: boolean
        }[]
      }
      get_user_attendance_counts: {
        Args: { user_id_param: string }
        Returns: Json
      }
      get_user_business: {
        Args: never
        Returns: Database["public"]["Tables"]["businesses"]["Row"][]
      }
      get_user_calendar: {
        Args: {
          p_from: string
          p_limit?: number
          p_sources?: string[]
          p_to: string
        }
        Returns: Json
      }
      get_user_going_events: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_scope?: string
          user_id_param: string
        }
        Returns: Json
      }
      get_user_past_event_count: {
        Args: { user_id_param: string }
        Returns: number
      }
      get_user_past_events: {
        Args: {
          result_limit?: number
          result_offset?: number
          user_id_param: string
        }
        Returns: Json
      }
      get_user_saved_events: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json
      }
      get_user_upcoming_events: {
        Args: { user_id_param: string }
        Returns: Json
      }
      handle_event_seats_freed: {
        Args: { p_event_id: string }
        Returns: number
      }
      host_display_name: {
        Args: { p_name: string; p_private: boolean }
        Returns: string
      }
      host_promote_from_waitlist: {
        Args: { p_event_id: string; p_user_id: string }
        Returns: undefined
      }
      host_remove_attendee: {
        Args: {
          p_ban?: boolean
          p_event_id: string
          p_reason?: string
          p_user_id: string
        }
        Returns: undefined
      }
      host_review_rsvp: {
        Args: { p_decision: string; p_event_id: string; p_user_id: string }
        Returns: undefined
      }
      host_set_event_capacity: {
        Args: { p_event_id: string; p_max_attendees: number }
        Returns: undefined
      }
      host_set_event_settings: {
        Args: {
          p_event_id: string
          p_rsvp_closed?: boolean
          p_rsvp_mode?: string
          p_waitlist_mode?: string
        }
        Returns: Json
      }
      host_terms_current_version: { Args: never; Returns: number }
      host_unban_attendee: {
        Args: { p_event_id: string; p_user_id: string }
        Returns: undefined
      }
      is_admin_user: { Args: never; Returns: boolean }
      is_valid_time_zone: { Args: { p_tz: string }; Returns: boolean }
      join_event_waitlist: { Args: { p_event_id: string }; Returns: number }
      join_event_with_capacity: {
        Args: { p_event_id: string; p_status: string }
        Returns: string
      }
      leave_event_waitlist: { Args: { p_event_id: string }; Returns: undefined }
      mark_event_chat_read: { Args: { p_event_id: string }; Returns: undefined }
      notify_event_waitlist_free_seats: {
        Args: { p_event_id: string }
        Returns: number
      }
      notify_followers_about_event: {
        Args: { p_event_id: string }
        Returns: number
      }
      notify_followers_for_event: {
        Args: { p_event_id: string }
        Returns: number
      }
      postpone_event: {
        Args: { p_event_id: string; p_note?: string }
        Returns: Json
      }
      publish_event: { Args: { p_event_id: string }; Returns: Json }
      refresh_event_rsvp_counts: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      reopen_business: { Args: never; Returns: undefined }
      reschedule_event: {
        Args: {
          p_address?: string
          p_end_datetime: string
          p_event_id: string
          p_lat?: number
          p_lng?: number
          p_note?: string
          p_start_datetime: string
        }
        Returns: Json
      }
      reset_monthly_event_counter: {
        Args: { business_uuid: string }
        Returns: undefined
      }
      restore_event_chat_message: {
        Args: { p_message_id: string }
        Returns: boolean
      }
      send_event_announcement: {
        Args: { p_audience?: string; p_body: string; p_event_id: string }
        Returns: Json
      }
      send_event_reminders: { Args: never; Returns: undefined }
      send_promotional_notification: {
        Args: { p_promotion_id: string }
        Returns: number
      }
      submit_verification_request: {
        Args: { p_evidence_url: string; p_note?: string }
        Returns: string
      }
      set_event_chat_mode: {
        Args: {
          p_chat_mode?: string
          p_event_id: string
          p_open_policy?: string
        }
        Returns: Json
      }
      set_event_chat_muted: {
        Args: { p_event_id: string; p_muted: boolean }
        Returns: undefined
      }
      set_event_chat_pin: {
        Args: { p_event_id: string; p_message_id?: string }
        Returns: undefined
      }
      set_event_chat_settings: {
        Args: {
          p_event_id: string
          p_locked?: boolean
          p_slow_mode_seconds?: number
        }
        Returns: undefined
      }
      stash_removed_chat_body: {
        Args: { p_message_id: string }
        Returns: undefined
      }
      track_event_interaction: {
        Args: { p_event_id: string; p_kind: string }
        Returns: undefined
      }
      track_event_view: { Args: { event_uuid: string }; Returns: undefined }
      unblock_event_chat_user: {
        Args: { p_event_id: string; p_user_id: string }
        Returns: undefined
      }
      unreferenced_owned_images: {
        Args: { p_urls: string[] }
        Returns: string[]
      }
      upsert_push_token:
        | {
            Args: { p_device_id?: string; p_platform?: string; p_token: string }
            Returns: undefined
          }
        | {
            Args: {
              p_app_ownership?: string
              p_device_id?: string
              p_platform?: string
              p_token: string
            }
            Returns: undefined
          }
      user_can_access_event_chat: {
        Args: { event_uuid: string }
        Returns: boolean
      }
      user_can_review_business: {
        Args: { p_business_id: string }
        Returns: boolean
      }
      user_is_banned: { Args: { p_user_id: string }; Returns: boolean }
      user_is_banned_from_event: {
        Args: { p_event_id: string; p_user_id: string }
        Returns: boolean
      }
      user_is_blocked_from_event_chat: {
        Args: { event_uuid: string; p_user_id: string }
        Returns: boolean
      }
      user_is_event_host: { Args: { event_uuid: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

