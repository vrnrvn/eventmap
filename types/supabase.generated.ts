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
          address: string
          category: string
          contact_email: string | null
          created_at: string
          description: string
          events_created_this_month: number
          google_reviews_url: string | null
          id: string
          last_reset_date: string
          lat: number
          lng: number
          logo_url: string | null
          name: string
          notifications_enabled: boolean | null
          owner_id: string
          social_handles: Json | null
          subscription_expires_at: string | null
          subscription_tier: string
          verified: boolean
        }
        Insert: {
          address: string
          category: string
          contact_email?: string | null
          created_at?: string
          description?: string
          events_created_this_month?: number
          google_reviews_url?: string | null
          id?: string
          last_reset_date?: string
          lat: number
          lng: number
          logo_url?: string | null
          name: string
          notifications_enabled?: boolean | null
          owner_id: string
          social_handles?: Json | null
          subscription_expires_at?: string | null
          subscription_tier?: string
          verified?: boolean
        }
        Update: {
          address?: string
          category?: string
          contact_email?: string | null
          created_at?: string
          description?: string
          events_created_this_month?: number
          google_reviews_url?: string | null
          id?: string
          last_reset_date?: string
          lat?: number
          lng?: number
          logo_url?: string | null
          name?: string
          notifications_enabled?: boolean | null
          owner_id?: string
          social_handles?: Json | null
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
      event_chat_messages: {
        Row: {
          body: string
          created_at: string
          deleted_at: string | null
          event_id: string
          id: string
          sender_id: string
        }
        Insert: {
          body: string
          created_at?: string
          deleted_at?: string | null
          event_id: string
          id?: string
          sender_id: string
        }
        Update: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          event_id?: string
          id?: string
          sender_id?: string
        }
        Relationships: [
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
          reminder_minutes: number
          sent_at: string
          user_id: string
        }
        Insert: {
          event_id: string
          reminder_minutes: number
          sent_at?: string
          user_id: string
        }
        Update: {
          event_id?: string
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
      events: {
        Row: {
          address: string
          business_id: string
          category_id: string
          cover_image_url: string | null
          created_at: string
          description: string
          end_datetime: string
          id: string
          is_recurring: boolean
          lat: number
          lng: number
          recurrence_pattern: Json | null
          start_datetime: string
          title: string
          updated_at: string
        }
        Insert: {
          address: string
          business_id: string
          category_id: string
          cover_image_url?: string | null
          created_at?: string
          description?: string
          end_datetime: string
          id?: string
          is_recurring?: boolean
          lat: number
          lng: number
          recurrence_pattern?: Json | null
          start_datetime: string
          title: string
          updated_at?: string
        }
        Update: {
          address?: string
          business_id?: string
          category_id?: string
          cover_image_url?: string | null
          created_at?: string
          description?: string
          end_datetime?: string
          id?: string
          is_recurring?: boolean
          lat?: number
          lng?: number
          recurrence_pattern?: Json | null
          start_datetime?: string
          title?: string
          updated_at?: string
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
      admin_ban_user: {
        Args: { p_reason?: string; p_user_id: string }
        Returns: undefined
      }
      admin_reset_business_event_limit: {
        Args: { p_business_id: string }
        Returns: undefined
      }
      admin_set_business_premium: {
        Args: { p_business_id: string; p_is_premium: boolean }
        Returns: undefined
      }
      admin_unban_user: { Args: { p_user_id: string }; Returns: undefined }
      calculate_distance: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
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
          p_recurrence_pattern?: Json
          p_start_datetime: string
          p_title: string
        }
        Returns: string
      }
      deactivate_push_token: { Args: { p_token: string }; Returns: undefined }
      ensure_profile_exists: {
        Args: { p_name?: string; p_user_id: string }
        Returns: undefined
      }
      get_business_analytics: {
        Args: { business_uuid: string; days?: number }
        Returns: Json
      }
      get_event_attendees_public: {
        Args: { event_uuid: string }
        Returns: Json
      }
      get_event_details: { Args: { event_uuid: string }; Returns: Json }
      get_ranked_events: {
        Args: {
          category_ids?: string[]
          end_date?: string
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
          id: string
          is_premium: boolean
          is_recurring: boolean
          lat: number
          lng: number
          recurrence_pattern: Json
          rsvp_count: number
          save_count: number
          start_datetime: string
          title: string
        }[]
      }
      get_user_business: {
        Args: never
        Returns: {
          address: string
          category: string
          contact_email: string
          created_at: string
          description: string
          events_created_this_month: number
          google_reviews_url: string
          id: string
          last_reset_date: string
          lat: number
          lng: number
          logo_url: string
          name: string
          owner_id: string
          social_handles: Json
          subscription_expires_at: string
          subscription_tier: string
          verified: boolean
        }[]
      }
      get_user_upcoming_events: {
        Args: { user_id_param: string }
        Returns: Json
      }
      is_admin_user: { Args: never; Returns: boolean }
      reset_monthly_event_counter: {
        Args: { business_uuid: string }
        Returns: undefined
      }
      send_event_reminders: { Args: never; Returns: undefined }
      send_promotional_notification: {
        Args: { p_promotion_id: string }
        Returns: number
      }
      track_event_view: { Args: { event_uuid: string }; Returns: undefined }
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

