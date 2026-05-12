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
          created_at: string | null
          email: string
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["AppRole"]
          support_channel: string
        }
        Insert: {
          created_at?: string | null
          email: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["AppRole"]
          support_channel?: string
        }
        Update: {
          created_at?: string | null
          email?: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["AppRole"]
          support_channel?: string
        }
        Relationships: []
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
          has_tracking_code: boolean
          id: string
          platform: string | null
          product: string
          service_date: string
          status: string
          user_id: string
        }
        Insert: {
          channel?: string | null
          client_email: string
          contact_reason?: string | null
          created_at?: string | null
          has_tracking_code?: boolean
          id?: string
          platform?: string | null
          product: string
          service_date: string
          status?: string
          user_id: string
        }
        Update: {
          channel?: string | null
          client_email?: string
          contact_reason?: string | null
          created_at?: string | null
          has_tracking_code?: boolean
          id?: string
          platform?: string | null
          product?: string
          service_date?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_user_id_fkey"
            columns: ["user_id"]
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
      agent_daily_metrics: { Args: { target_date?: string }; Returns: Json }
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
      dashboard_status_summary: {
        Args: { agent_id?: string; from_date: string; to_date: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["AppRole"]
          _user_id: string
        }
        Returns: boolean
      }
      is_manager: { Args: never; Returns: boolean }
      manager_refund_alerts: { Args: never; Returns: Json }
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
      refresh_agent_daily_service_count: {
        Args: { p_day: string; p_user_id: string }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["agent", "manager"],
      AppRole: ["agent", "manager"],
    },
  },
} as const
