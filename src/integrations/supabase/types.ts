export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      agent_daily_service_counts: {
        Row: {
          day: string
          service_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          day: string
          service_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          day?: string
          service_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_daily_service_counts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_heartbeats: {
        Row: {
          last_seen_at: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          last_seen_at?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      auth_events: {
        Row: {
          actor_id: string | null
          event_type: string
          id: number
          metadata: Json | null
          occurred_at: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          event_type: string
          id?: number
          metadata?: Json | null
          occurred_at?: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          event_type?: string
          id?: number
          metadata?: Json | null
          occurred_at?: string
          user_id?: string
        }
        Relationships: []
      }
      goals: {
        Row: {
          created_at: string
          id: string
          month: string
          target_value: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          month: string
          target_value: number
          updated_at: string
        }
        Update: {
          created_at?: string
          id?: string
          month?: string
          target_value?: number
          updated_at?: string
        }
        Relationships: []
      }
      held_order_events: {
        Row: {
          id: string
          note: string | null
          order_id: string
          recorded_at: string
          status: string
          user_id: string
        }
        Insert: {
          id?: string
          note?: string | null
          order_id: string
          recorded_at?: string
          status: string
          user_id: string
        }
        Update: {
          id?: string
          note?: string | null
          order_id?: string
          recorded_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "held_order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "held_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "held_order_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      held_orders: {
        Row: {
          age: string | null
          agent_status: string
          assign_count: number
          assigned_to: string | null
          city: string | null
          comments: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          country: string | null
          customer_name: string | null
          damaged_items: string | null
          dyna_code: string
          email: string | null
          id: string
          import_key: string | null
          imported_at: string
          imported_by: string | null
          items: string | null
          merged_orders: string | null
          order_date: string | null
          order_number: string | null
          postal_code: string | null
          reason: string | null
          restocked_items: string | null
          rma: string | null
          source_file: string | null
          state: string | null
          status: string
          street1: string | null
          street2: string | null
          street3: string | null
        }
        Insert: {
          age?: string | null
          agent_status?: string
          assign_count?: number
          assigned_to?: string | null
          city?: string | null
          comments?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          country?: string | null
          customer_name?: string | null
          damaged_items?: string | null
          dyna_code: string
          email?: string | null
          id?: string
          import_key?: string | null
          imported_at?: string
          imported_by?: string | null
          items?: string | null
          merged_orders?: string | null
          order_date?: string | null
          order_number?: string | null
          postal_code?: string | null
          reason?: string | null
          restocked_items?: string | null
          rma?: string | null
          source_file?: string | null
          state?: string | null
          status?: string
          street1?: string | null
          street2?: string | null
          street3?: string | null
        }
        Update: {
          age?: string | null
          agent_status?: string
          assign_count?: number
          assigned_to?: string | null
          city?: string | null
          comments?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          country?: string | null
          customer_name?: string | null
          damaged_items?: string | null
          dyna_code?: string
          email?: string | null
          id?: string
          import_key?: string | null
          imported_at?: string
          imported_by?: string | null
          items?: string | null
          merged_orders?: string | null
          order_date?: string | null
          order_number?: string | null
          postal_code?: string | null
          reason?: string | null
          restocked_items?: string | null
          rma?: string | null
          source_file?: string | null
          state?: string | null
          status?: string
          street1?: string | null
          street2?: string | null
          street3?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "held_orders_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "held_orders_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "held_orders_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          is_active?: boolean
          name: string
          updated_at: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          can_approve_takeovers: boolean
          can_claim_tickets: boolean
          can_register_duplicate_emails: boolean
          can_view_all_tickets: boolean
          created_at: string | null
          deactivated_at: string | null
          deactivated_by: string | null
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          is_available: boolean
          role: Database["public"]["Enums"]["AppRole"]
          support_channel: string
        }
        Insert: {
          can_approve_takeovers?: boolean
          can_claim_tickets?: boolean
          can_register_duplicate_emails?: boolean
          can_view_all_tickets?: boolean
          created_at?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          email: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          is_available?: boolean
          role?: Database["public"]["Enums"]["AppRole"]
          support_channel?: string
        }
        Update: {
          can_approve_takeovers?: boolean
          can_claim_tickets?: boolean
          can_register_duplicate_emails?: boolean
          can_view_all_tickets?: boolean
          created_at?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          is_available?: boolean
          role?: Database["public"]["Enums"]["AppRole"]
          support_channel?: string
        }
        Relationships: []
      }
      refund_reason_classifications: {
        Row: {
          category: string
          classification_method: string
          classified_at: string
          original_reason: string | null
          refund_id: string
          updated_at: string
        }
        Insert: {
          category: string
          classification_method?: string
          classified_at?: string
          original_reason?: string | null
          refund_id: string
          updated_at?: string
        }
        Update: {
          category?: string
          classification_method?: string
          classified_at?: string
          original_reason?: string | null
          refund_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_reason_classifications_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: true
            referencedRelation: "refunds"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          channel: string | null
          completion_date: string | null
          created_at: string
          customer_email: string
          id: string
          items_returned: boolean
          order_id: string
          product: string | null
          reason: string | null
          refund_type: string | null
          refund_value: number | null
          request_date: string
          sales_platform: string
          user_id: string
        }
        Insert: {
          channel?: string | null
          completion_date?: string | null
          created_at?: string
          customer_email: string
          id?: string
          items_returned?: boolean
          order_id: string
          product?: string | null
          reason?: string | null
          refund_type?: string | null
          refund_value?: number | null
          request_date: string
          sales_platform: string
          user_id: string
        }
        Update: {
          channel?: string | null
          completion_date?: string | null
          created_at?: string
          customer_email?: string
          id?: string
          items_returned?: boolean
          order_id?: string
          product?: string | null
          reason?: string | null
          refund_type?: string | null
          refund_value?: number | null
          request_date?: string
          sales_platform?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_date_corrections: {
        Row: {
          corrected_at: string
          corrected_by: string
          id: string
          new_date: string
          previous_date: string
          reason: string
          service_id: string
        }
        Insert: {
          corrected_at?: string
          corrected_by: string
          id?: string
          new_date: string
          previous_date: string
          reason: string
          service_id: string
        }
        Update: {
          corrected_at?: string
          corrected_by?: string
          id?: string
          new_date?: string
          previous_date?: string
          reason?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_date_corrections_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      service_follow_ups: {
        Row: {
          created_at: string
          follow_up_number: number
          id: string
          observation: string | null
          recorded_at: string
          service_id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          follow_up_number?: number
          id?: string
          observation?: string | null
          recorded_at?: string
          service_id: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          follow_up_number?: number
          id?: string
          observation?: string | null
          recorded_at?: string
          service_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_follow_ups_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          channel: string | null
          client_email: string
          contact_reason: string | null
          created_at: string | null
          current_owner_id: string
          has_tracking_code: boolean
          id: string
          platform: string | null
          product: string
          service_date: string
          status: string
          takeover_approved_at: string | null
          takeover_approved_by: string | null
          user_id: string
        }
        Insert: {
          channel?: string | null
          client_email: string
          contact_reason?: string | null
          created_at?: string | null
          // NOT NULL na base, mas preenchido por trigger no INSERT — opcional aqui.
          current_owner_id?: string
          has_tracking_code?: boolean
          id?: string
          platform?: string | null
          product: string
          service_date: string
          status?: string
          takeover_approved_at?: string | null
          takeover_approved_by?: string | null
          user_id: string
        }
        Update: {
          channel?: string | null
          client_email?: string
          contact_reason?: string | null
          created_at?: string | null
          current_owner_id?: string
          has_tracking_code?: boolean
          id?: string
          platform?: string | null
          product?: string
          service_date?: string
          status?: string
          takeover_approved_at?: string | null
          takeover_approved_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_current_owner_id_fkey"
            columns: ["current_owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_takeover_approved_by_fkey"
            columns: ["takeover_approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_takeover_requests: {
        Row: {
          created_at: string
          id: string
          note: string | null
          owner_id: string | null
          requester_id: string
          responded_at: string | null
          responded_by: string | null
          service_id: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          owner_id?: string | null
          requester_id: string
          responded_at?: string | null
          responded_by?: string | null
          service_id: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          owner_id?: string | null
          requester_id?: string
          responded_at?: string | null
          responded_by?: string | null
          service_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_takeover_requests_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_takeover_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_takeover_requests_responded_by_fkey"
            columns: ["responded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_takeover_requests_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_transfers: {
        Row: {
          assigned_by_manager_id: string | null
          created_at: string
          from_user_id: string
          id: string
          message: string | null
          recipient_seen_at: string | null
          requester_seen_at: string | null
          responded_at: string | null
          response_note: string | null
          service_id: string
          status: string
          to_user_id: string
        }
        Insert: {
          assigned_by_manager_id?: string | null
          created_at?: string
          from_user_id: string
          id?: string
          message?: string | null
          recipient_seen_at?: string | null
          requester_seen_at?: string | null
          responded_at?: string | null
          response_note?: string | null
          service_id: string
          status?: string
          to_user_id: string
        }
        Update: {
          assigned_by_manager_id?: string | null
          created_at?: string
          from_user_id?: string
          id?: string
          message?: string | null
          recipient_seen_at?: string | null
          requester_seen_at?: string | null
          responded_at?: string | null
          response_note?: string | null
          service_id?: string
          status?: string
          to_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_transfers_assigned_by_manager_id_fkey"
            columns: ["assigned_by_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_transfers_from_user_id_fkey"
            columns: ["from_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_transfers_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_transfers_to_user_id_fkey"
            columns: ["to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      training_video_views: {
        Row: {
          completed: boolean
          created_at: string
          id: string
          last_watched_at: string
          user_id: string
          video_id: string
          watched_seconds: number
        }
        Insert: {
          completed?: boolean
          created_at?: string
          id?: string
          last_watched_at?: string
          user_id: string
          video_id: string
          watched_seconds?: number
        }
        Update: {
          completed?: boolean
          created_at?: string
          id?: string
          last_watched_at?: string
          user_id?: string
          video_id?: string
          watched_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "training_video_views_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "training_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      training_videos: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          duration_seconds: number | null
          id: string
          is_published: boolean
          section: string
          thumbnail_url: string | null
          title: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          duration_seconds?: number | null
          id?: string
          is_published?: boolean
          section: string
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          duration_seconds?: number | null
          id?: string
          is_published?: boolean
          section?: string
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["AppRole"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["AppRole"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["AppRole"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _interaction_events: {
        Args: { agent_id?: string; from_date: string; to_date: string }
        Returns: {
          channel: string
          day: string
          kind: string
          platform: string
          product: string
          service_id: string
          user_id: string
        }[]
      }
      agent_daily_metrics: { Args: { target_date?: string }; Returns: Json }
      agent_heartbeat: { Args: { p_user_agent?: string }; Returns: undefined }
      agent_metrics_range: {
        Args: { from_date: string; to_date: string }
        Returns: Json
      }
      agent_my_metrics: {
        Args: { from_date: string; to_date: string }
        Returns: Json
      }
      agent_product_mix: {
        Args: { from_date: string; to_date: string; top_n?: number }
        Returns: Json
      }
      approve_ticket_takeover: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      can_claim_tickets: { Args: never; Returns: boolean }
      can_view_all_tickets: { Args: never; Returns: boolean }
      claim_ticket: {
        Args: { p_service_id: string }
        Returns: {
          channel: string
          client_email: string
          contact_reason: string
          created_at: string
          current_owner_id: string
          has_tracking_code: boolean
          id: string
          platform: string
          product: string
          service_date: string
          status: string
          user_id: string
        }[]
      }
      classify_refund_reason: { Args: { p_reason: string }; Returns: string }
      confirm_held_order: { Args: { p_order_id: string }; Returns: undefined }
      create_refund:
        | {
            Args: {
              p_customer_email: string
              p_order_id: string
              p_product?: string
              p_request_date: string
              p_sales_platform: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_channel?: string
              p_customer_email: string
              p_order_id: string
              p_product?: string
              p_request_date: string
              p_sales_platform: string
            }
            Returns: undefined
          }
      dashboard_audit: {
        Args: {
          agent_id?: string
          from_date: string
          page_offset?: number
          page_size?: number
          to_date: string
        }
        Returns: Json
      }
      dashboard_channel_detail: {
        Args: { p_from_date?: string; p_to_date?: string }
        Returns: Json
      }
      dashboard_export_extras: {
        Args: { agent_id?: string; from_date: string; to_date: string }
        Returns: Json
      }
      dashboard_follow_up_detail: {
        Args: { p_from_date?: string; p_to_date?: string }
        Returns: Json
      }
      dashboard_hourly_pattern: {
        Args: { agent_id?: string; from_date: string; to_date: string }
        Returns: Json
      }
      dashboard_metrics: {
        Args: { agent_id?: string; from_date: string; to_date: string }
        Returns: Json
      }
      dashboard_refund_audit: {
        Args: {
          agent_id?: string
          from_date: string
          page_offset?: number
          page_size?: number
          product_filter?: string
          refund_type_filter?: string
          status_filter?: string
          to_date: string
        }
        Returns: Json
      }
      dashboard_refund_metrics: {
        Args: {
          agent_id?: string
          from_date: string
          product_filter?: string
          refund_type_filter?: string
          status_filter?: string
          to_date: string
        }
        Returns: Json
      }
      dashboard_refund_reason_detail: {
        Args: {
          agent_id?: string
          from_date: string
          page_offset?: number
          page_size?: number
          product_filter?: string
          reason_category: string
          refund_type_filter?: string
          status_filter?: string
          to_date: string
        }
        Returns: Json
      }
      dashboard_status_summary: {
        Args: { agent_id?: string; from_date: string; to_date: string }
        Returns: Json
      }
      export_agent_services: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      find_ticket_by_email: {
        Args: { p_email: string }
        Returns: {
          agent_name: string
          channel: string
          client_email: string
          created_at: string
          current_owner_id: string
          current_owner_is_available: boolean
          current_owner_name: string
          id: string
          platform: string
          product: string
          service_date: string
          status: string
          user_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["AppRole"]
          _user_id: string
        }
        Returns: boolean
      }
      held_order_events_for: { Args: { p_order_id: string }; Returns: Json }
      is_manager: { Args: never; Returns: boolean }
      manager_assign_held_orders: {
        Args: { p_agent_id: string; p_order_ids: string[] }
        Returns: number
      }
      manager_complete_refund: {
        Args: {
          p_completion_date: string
          p_items_returned?: boolean
          p_reason: string
          p_refund_id: string
          p_refund_type: string
          p_refund_value: number
        }
        Returns: Json
      }
      manager_correct_service_date: {
        Args: { p_new_date: string; p_reason: string; p_service_id: string }
        Returns: Json
      }
      manager_delete_auth_user: {
        Args: { p_confirm_email: string; p_target_user_id: string }
        Returns: undefined
      }
      manager_distribute_held_orders: {
        Args: { p_agent_ids: string[]; p_order_ids: string[] }
        Returns: Json
      }
      manager_import_held_orders: { Args: { p_rows: Json }; Returns: Json }
      manager_list_held_orders: {
        Args: {
          agent_id?: string
          from_date?: string
          status_filter?: string
          to_date?: string
        }
        Returns: Json
      }
      manager_list_open_tickets_by_agent: {
        Args: { p_agent_id: string }
        Returns: Json
      }
      manager_list_users: { Args: never; Returns: Json }
      manager_reassign_tickets: { Args: { p_assignments: Json }; Returns: Json }
      manager_refund_alerts: { Args: never; Returns: Json }
      manager_set_agent_availability: {
        Args: { p_available: boolean; p_target_user_id: string }
        Returns: undefined
      }
      manager_set_user_active: {
        Args: { p_active: boolean; p_target_user_id: string }
        Returns: undefined
      }
      manager_takeover_notifications: {
        Args: never
        Returns: {
          client_email: string
          created_at: string
          note: string
          owner_id: string
          owner_name: string
          product: string
          request_id: string
          requester_id: string
          requester_name: string
          service_id: string
          service_status: string
        }[]
      }
      me_status: { Args: never; Returns: Json }
      my_follow_ups: { Args: never; Returns: Json }
      my_held_orders: { Args: { p_status?: string }; Returns: Json }
      my_held_orders_daily_metrics: { Args: never; Returns: Json }
      my_recent_services: {
        Args: { p_days_back?: number }
        Returns: {
          channel: string
          client_email: string
          contact_reason: string
          created_at: string
          current_owner_id: string
          has_tracking_code: boolean
          id: string
          platform: string
          product: string
          service_date: string
          status: string
          user_id: string
        }[]
      }
      my_refunds_with_refunded_value: {
        Args: never
        Returns: {
          channel: string
          completion_date: string
          created_at: string
          customer_email: string
          id: string
          items_returned: boolean
          order_id: string
          product: string
          reason: string
          refund_type: string
          refund_value: number
          refunded_value: number
          request_date: string
          sales_platform: string
          user_id: string
        }[]
      }
      my_transfer_history: {
        Args: never
        Returns: {
          assigned_by_manager_id: string
          client_email: string
          created_at: string
          has_tracking_code: boolean
          message: string
          other_agent_id: string
          other_agent_name: string
          product: string
          responded_at: string
          response_note: string
          role: string
          service_date: string
          service_id: string
          service_status: string
          transfer_id: string
          transfer_status: string
        }[]
      }
      my_transfer_notifications: {
        Args: never
        Returns: {
          client_email: string
          created_at: string
          message: string
          other_agent_id: string
          other_agent_name: string
          product: string
          responded_at: string
          response_note: string
          role: string
          service_id: string
          service_status: string
          transfer_id: string
          transfer_status: string
        }[]
      }
      record_auth_event: {
        Args: {
          p_event_type: string
          p_metadata?: Json
          p_target_user_id?: string
        }
        Returns: undefined
      }
      refresh_agent_daily_service_count: {
        Args: { p_day: string; p_user_id: string }
        Returns: undefined
      }
      reject_ticket_takeover: {
        Args: { p_note?: string; p_request_id: string }
        Returns: undefined
      }
      request_ticket_takeover: {
        Args: { p_note?: string; p_service_id: string }
        Returns: string
      }
      set_held_order_status: {
        Args: { p_note?: string; p_order_id: string; p_status: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "agent" | "manager"
      AppRole: "agent" | "manager"
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
  public: {
    Enums: {
      app_role: ["agent", "manager"],
      AppRole: ["agent", "manager"],
    },
  },
} as const
