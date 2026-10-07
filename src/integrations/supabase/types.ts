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
    PostgrestVersion: "14.5"
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
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
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
      agent_notes: {
        Row: {
          body: string
          created_at: string
          done: boolean
          done_at: string | null
          id: string
          kind: string
          note_date: string
          pinned: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          done?: boolean
          done_at?: string | null
          id?: string
          kind?: string
          note_date?: string
          pinned?: boolean
          updated_at?: string
          user_id?: string
        }
        Update: {
          body?: string
          created_at?: string
          done?: boolean
          done_at?: string | null
          id?: string
          kind?: string
          note_date?: string
          pinned?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      business_holidays: {
        Row: {
          day: string
          name: string
        }
        Insert: {
          day: string
          name: string
        }
        Update: {
          day?: string
          name?: string
        }
        Relationships: []
      }
      claude_skills_leads: {
        Row: {
          created_at: string
          email: string
          id: string
          lang: string
          source_url: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          lang?: string
          source_url?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          lang?: string
          source_url?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      external_refunds: {
        Row: {
          address: string | null
          address2: string | null
          city: string | null
          full_name: string | null
          id: number
          imported_at: string
          imported_by: string | null
          mobile_no: string | null
          month_ref: string
          order_date: string
          order_name: string
          order_number: string | null
          payment_status: string
          platform: string
          product: string
          product_count: number
          product_id: number | null
          product_name: string
          province: string | null
          raw_date: string | null
          refund_amount: number
          shipping_method: string | null
          source_file: string
          status: string | null
          tracking_code: string | null
          variant_id: number
          variant_name: string | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          address2?: string | null
          city?: string | null
          full_name?: string | null
          id?: never
          imported_at?: string
          imported_by?: string | null
          mobile_no?: string | null
          month_ref: string
          order_date: string
          order_name: string
          order_number?: string | null
          payment_status: string
          platform?: string
          product: string
          product_count?: number
          product_id?: number | null
          product_name: string
          province?: string | null
          raw_date?: string | null
          refund_amount?: number
          shipping_method?: string | null
          source_file: string
          status?: string | null
          tracking_code?: string | null
          variant_id?: number
          variant_name?: string | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          address2?: string | null
          city?: string | null
          full_name?: string | null
          id?: never
          imported_at?: string
          imported_by?: string | null
          mobile_no?: string | null
          month_ref?: string
          order_date?: string
          order_name?: string
          order_number?: string | null
          payment_status?: string
          platform?: string
          product?: string
          product_count?: number
          product_id?: number | null
          product_name?: string
          province?: string | null
          raw_date?: string | null
          refund_amount?: number
          shipping_method?: string | null
          source_file?: string
          status?: string | null
          tracking_code?: string | null
          variant_id?: number
          variant_name?: string | null
          zip?: string | null
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
          pending_tag: string | null
          recorded_at: string
          status: string
          user_id: string
        }
        Insert: {
          id?: string
          note?: string | null
          order_id: string
          pending_tag?: string | null
          recorded_at?: string
          status: string
          user_id: string
        }
        Update: {
          id?: string
          note?: string | null
          order_id?: string
          pending_tag?: string | null
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
            referencedRelation: "lya_agentes"
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
      held_order_inactive_alerts: {
        Row: {
          agent_id: string | null
          days_since_contact: number
          decision: string | null
          event_id: string
          id: string
          last_contact_at: string
          marked_at: string
          order_id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
        }
        Insert: {
          agent_id?: string | null
          days_since_contact: number
          decision?: string | null
          event_id: string
          id?: string
          last_contact_at: string
          marked_at?: string
          order_id: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Update: {
          agent_id?: string | null
          days_since_contact?: number
          decision?: string | null
          event_id?: string
          id?: string
          last_contact_at?: string
          marked_at?: string
          order_id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "held_order_inactive_alerts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "held_order_inactive_alerts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "held_order_inactive_alerts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "held_order_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "held_order_inactive_alerts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "held_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "held_order_inactive_alerts_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "held_order_inactive_alerts_reviewed_by_fkey"
            columns: ["reviewed_by"]
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
          duplicate_of: string | null
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
          pending_tag: string | null
          postal_code: string | null
          reason: string | null
          restocked_items: string | null
          return_date: string | null
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
          duplicate_of?: string | null
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
          pending_tag?: string | null
          postal_code?: string | null
          reason?: string | null
          restocked_items?: string | null
          return_date?: string | null
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
          duplicate_of?: string | null
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
          pending_tag?: string | null
          postal_code?: string | null
          reason?: string | null
          restocked_items?: string | null
          return_date?: string | null
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
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "lya_agentes"
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
            foreignKeyName: "held_orders_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "held_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "held_orders_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "lya_agentes"
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
      late_hunter_order_events: {
        Row: {
          ambiente: string
          evento: string
          id: number
          ocorrido_em: string
          order_id: number
          referencia: string
        }
        Insert: {
          ambiente: string
          evento: string
          id?: never
          ocorrido_em?: string
          order_id: number
          referencia: string
        }
        Update: {
          ambiente?: string
          evento?: string
          id?: never
          ocorrido_em?: string
          order_id?: number
          referencia?: string
        }
        Relationships: [
          {
            foreignKeyName: "late_hunter_order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "late_hunter_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      late_hunter_orders: {
        Row: {
          ambiente: string
          atualizado_em: string
          cliente_email: string
          cliente_nome: string
          criado_em: string
          data_pedido: string
          dias_em_espera: number | null
          encerrado_em: string | null
          encerrado_referencia: string | null
          endereco: Json | null
          id: number
          itens: string | null
          loja: string
          loja_nome: string | null
          motivo: string
          motivo_encerramento: string | null
          motivos: string[]
          pais: string | null
          pedido: string
          primeira_referencia: string
          situacao: string
          ultima_referencia: string
          vezes_reaberto: number
        }
        Insert: {
          ambiente: string
          atualizado_em?: string
          cliente_email: string
          cliente_nome: string
          criado_em?: string
          data_pedido: string
          dias_em_espera?: number | null
          encerrado_em?: string | null
          encerrado_referencia?: string | null
          endereco?: Json | null
          id?: never
          itens?: string | null
          loja: string
          loja_nome?: string | null
          motivo: string
          motivo_encerramento?: string | null
          motivos?: string[]
          pais?: string | null
          pedido: string
          primeira_referencia: string
          situacao?: string
          ultima_referencia: string
          vezes_reaberto?: number
        }
        Update: {
          ambiente?: string
          atualizado_em?: string
          cliente_email?: string
          cliente_nome?: string
          criado_em?: string
          data_pedido?: string
          dias_em_espera?: number | null
          encerrado_em?: string | null
          encerrado_referencia?: string | null
          endereco?: Json | null
          id?: never
          itens?: string | null
          loja?: string
          loja_nome?: string | null
          motivo?: string
          motivo_encerramento?: string | null
          motivos?: string[]
          pais?: string | null
          pedido?: string
          primeira_referencia?: string
          situacao?: string
          ultima_referencia?: string
          vezes_reaberto?: number
        }
        Relationships: []
      }
      late_hunter_syncs: {
        Row: {
          abertos_apos: number
          ambiente: string
          atualizados: number
          completo: boolean
          criados: number
          encerrados: number
          encerramento: string
          fonte: string
          gerado_em: string | null
          id: number
          inalterados: number
          pagina: number
          reabertos: number
          recebido_em: string
          recebidos: number
          referencia: string
          rejeitados: Json
          total_paginas: number
        }
        Insert: {
          abertos_apos?: number
          ambiente: string
          atualizados?: number
          completo: boolean
          criados?: number
          encerrados?: number
          encerramento: string
          fonte: string
          gerado_em?: string | null
          id?: never
          inalterados?: number
          pagina?: number
          reabertos?: number
          recebido_em?: string
          recebidos?: number
          referencia: string
          rejeitados?: Json
          total_paginas?: number
        }
        Update: {
          abertos_apos?: number
          ambiente?: string
          atualizados?: number
          completo?: boolean
          criados?: number
          encerrados?: number
          encerramento?: string
          fonte?: string
          gerado_em?: string | null
          id?: never
          inalterados?: number
          pagina?: number
          reabertos?: number
          recebido_em?: string
          recebidos?: number
          referencia?: string
          rejeitados?: Json
          total_paginas?: number
        }
        Relationships: []
      }
      lya_chat_messages: {
        Row: {
          charts: Json
          chat_id: string
          content: string
          created_at: string
          id: number
          memorias: Json
          ordem: number
          revisao: Json | null
          role: string
          tools: Json
        }
        Insert: {
          charts?: Json
          chat_id: string
          content?: string
          created_at?: string
          id?: number
          memorias?: Json
          ordem: number
          revisao?: Json | null
          role: string
          tools?: Json
        }
        Update: {
          charts?: Json
          chat_id?: string
          content?: string
          created_at?: string
          id?: number
          memorias?: Json
          ordem?: number
          revisao?: Json | null
          role?: string
          tools?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lya_chat_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "lya_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      lya_chats: {
        Row: {
          created_at: string
          id: string
          titulo: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id: string
          titulo?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          titulo?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lya_chats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lya_chats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lya_file_rows: {
        Row: {
          data: Json
          file_id: string
          linha: number
        }
        Insert: {
          data?: Json
          file_id: string
          linha: number
        }
        Update: {
          data?: Json
          file_id?: string
          linha?: number
        }
        Relationships: [
          {
            foreignKeyName: "lya_file_rows_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "lya_files"
            referencedColumns: ["id"]
          },
        ]
      }
      lya_files: {
        Row: {
          arquivo: string
          bytes: number
          colunas: Json
          conteudo: string
          created_at: string
          erro: string | null
          id: string
          nome: string
          resumo: string
          status: string
          tags: Json
          tipo: string
          total_linhas: number
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          arquivo: string
          bytes?: number
          colunas?: Json
          conteudo?: string
          created_at?: string
          erro?: string | null
          id?: string
          nome: string
          resumo?: string
          status?: string
          tags?: Json
          tipo: string
          total_linhas?: number
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          arquivo?: string
          bytes?: number
          colunas?: Json
          conteudo?: string
          created_at?: string
          erro?: string | null
          id?: string
          nome?: string
          resumo?: string
          status?: string
          tags?: Json
          tipo?: string
          total_linhas?: number
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lya_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lya_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lya_memories: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          description: string
          file_id: string | null
          id: number
          name: string
          origem: string
          seed: boolean
          tags: Json
          type: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body?: string
          created_at?: string
          description?: string
          file_id?: string | null
          id?: number
          name: string
          origem?: string
          seed?: boolean
          tags?: Json
          type?: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          description?: string
          file_id?: string | null
          id?: number
          name?: string
          origem?: string
          seed?: boolean
          tags?: Json
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lya_memories_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lya_memories_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lya_memories_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "lya_files"
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
          can_access_analytics: boolean
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
          can_access_analytics?: boolean
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
          can_access_analytics?: boolean
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
      provider_contracts: {
        Row: {
          capacidade_dia_util: number
          cnpj: string | null
          contrato_numero: string | null
          pacote_nome: string | null
          razao_social: string | null
          updated_at: string
          updated_by: string | null
          user_id: string
          vigencia_fim: string | null
          vigencia_inicio: string | null
        }
        Insert: {
          capacidade_dia_util?: number
          cnpj?: string | null
          contrato_numero?: string | null
          pacote_nome?: string | null
          razao_social?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id: string
          vigencia_fim?: string | null
          vigencia_inicio?: string | null
        }
        Update: {
          capacidade_dia_util?: number
          cnpj?: string | null
          contrato_numero?: string | null
          pacote_nome?: string | null
          razao_social?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string
          vigencia_fim?: string | null
          vigencia_inicio?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_contracts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_contracts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_events: {
        Row: {
          action: string
          id: string
          item_id: string
          next_follow_up_date: string | null
          recorded_at: string
          status: string
          user_id: string
        }
        Insert: {
          action?: string
          id?: string
          item_id: string
          next_follow_up_date?: string | null
          recorded_at?: string
          status: string
          user_id: string
        }
        Update: {
          action?: string
          id?: string
          item_id?: string
          next_follow_up_date?: string | null
          recorded_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "radar_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "radar_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_items: {
        Row: {
          action_needed: string
          client_email: string
          closed_at: string | null
          created_at: string
          id: string
          kind: string
          next_follow_up_date: string | null
          notes: string
          order_number: string | null
          product: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action_needed: string
          client_email: string
          closed_at?: string | null
          created_at?: string
          id?: string
          kind: string
          next_follow_up_date?: string | null
          notes?: string
          order_number?: string | null
          product?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action_needed?: string
          client_email?: string
          closed_at?: string | null
          created_at?: string
          id?: string
          kind?: string
          next_follow_up_date?: string | null
          notes?: string
          order_number?: string | null
          product?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "radar_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_manager_completions: {
        Row: {
          completed_by: string
          completion_date: string
          created_at: string
          days_overdue: number | null
          id: string
          items_returned: boolean
          reason: string | null
          refund_id: string
          refund_owner_id: string
          refund_type: string | null
          refund_value: number | null
        }
        Insert: {
          completed_by: string
          completion_date: string
          created_at?: string
          days_overdue?: number | null
          id?: string
          items_returned?: boolean
          reason?: string | null
          refund_id: string
          refund_owner_id: string
          refund_type?: string | null
          refund_value?: number | null
        }
        Update: {
          completed_by?: string
          completion_date?: string
          created_at?: string
          days_overdue?: number | null
          id?: string
          items_returned?: boolean
          reason?: string | null
          refund_id?: string
          refund_owner_id?: string
          refund_type?: string | null
          refund_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "refund_manager_completions_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id"]
          },
        ]
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
          authorized_at: string | null
          channel: string | null
          completed_at: string | null
          completion_date: string | null
          created_at: string
          created_from_service: boolean
          customer_email: string
          id: string
          items_returned: boolean
          order_id: string
          picked_up_at: string | null
          picked_up_by: string | null
          product: string | null
          reason: string | null
          refund_type: string | null
          refund_value: number | null
          request_date: string
          sales_platform: string
          service_id: string | null
          user_id: string
        }
        Insert: {
          authorized_at?: string | null
          channel?: string | null
          completed_at?: string | null
          completion_date?: string | null
          created_at?: string
          created_from_service?: boolean
          customer_email: string
          id?: string
          items_returned?: boolean
          order_id: string
          picked_up_at?: string | null
          picked_up_by?: string | null
          product?: string | null
          reason?: string | null
          refund_type?: string | null
          refund_value?: number | null
          request_date: string
          sales_platform: string
          service_id?: string | null
          user_id: string
        }
        Update: {
          authorized_at?: string | null
          channel?: string | null
          completed_at?: string | null
          completion_date?: string | null
          created_at?: string
          created_from_service?: boolean
          customer_email?: string
          id?: string
          items_returned?: boolean
          order_id?: string
          picked_up_at?: string | null
          picked_up_by?: string | null
          product?: string | null
          reason?: string | null
          refund_type?: string | null
          refund_value?: number | null
          request_date?: string
          sales_platform?: string
          service_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_picked_up_by_fkey"
            columns: ["picked_up_by"]
            isOneToOne: false
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_picked_up_by_fkey"
            columns: ["picked_up_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
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
          is_same_day_repeat: boolean
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
          is_same_day_repeat?: boolean
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
          is_same_day_repeat?: boolean
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
          contact_reason_note: string | null
          created_at: string | null
          current_owner_id: string
          has_tracking_code: boolean
          id: string
          order_id: string | null
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
          contact_reason_note?: string | null
          created_at?: string | null
          current_owner_id: string
          has_tracking_code?: boolean
          id?: string
          order_id?: string | null
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
          contact_reason_note?: string | null
          created_at?: string | null
          current_owner_id?: string
          has_tracking_code?: boolean
          id?: string
          order_id?: string | null
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
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "lya_agentes"
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
            referencedRelation: "lya_agentes"
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
      sla_aderencia_mensal: {
        Row: {
          lancado_em: string
          lancado_por: string | null
          mes: string
          pct: number
          user_id: string
        }
        Insert: {
          lancado_em?: string
          lancado_por?: string | null
          mes: string
          pct: number
          user_id: string
        }
        Update: {
          lancado_em?: string
          lancado_por?: string | null
          mes?: string
          pct?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sla_aderencia_mensal_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_aderencia_mensal_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sla_cobertura_propostas: {
        Row: {
          aceita_em: string
          aceita_por: string | null
          dia: string
          multiplicador: number
          user_id: string
        }
        Insert: {
          aceita_em?: string
          aceita_por?: string | null
          dia: string
          multiplicador?: number
          user_id: string
        }
        Update: {
          aceita_em?: string
          aceita_por?: string | null
          dia?: string
          multiplicador?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sla_cobertura_propostas_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_cobertura_propostas_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_products: {
        Row: {
          ativo: boolean
          bonus_tipo: string | null
          bonus_url: string | null
          created_at: string
          estrutura: string
          funcao: string | null
          id: string
          links: Json
          nicho: string | null
          nome: string
          plataforma: string | null
          sms_number: string | null
          sort_order: number
          updated_at: string
          updated_by: string | null
          url: string | null
        }
        Insert: {
          ativo?: boolean
          bonus_tipo?: string | null
          bonus_url?: string | null
          created_at?: string
          estrutura: string
          funcao?: string | null
          id?: string
          links?: Json
          nicho?: string | null
          nome: string
          plataforma?: string | null
          sms_number?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          url?: string | null
        }
        Update: {
          ativo?: boolean
          bonus_tipo?: string | null
          bonus_url?: string | null
          created_at?: string
          estrutura?: string
          funcao?: string | null
          id?: string
          links?: Json
          nicho?: string | null
          nome?: string
          plataforma?: string | null
          sms_number?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_products_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_products_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_sms_brands: {
        Row: {
          ativo: boolean
          created_at: string
          estrutura: string
          id: string
          nome: string
          sistema: string
          sms_number: string | null
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          estrutura: string
          id?: string
          nome: string
          sistema: string
          sms_number?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          estrutura?: string
          id?: string
          nome?: string
          sistema?: string
          sms_number?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_sms_brands_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_sms_brands_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_sms_replies: {
        Row: {
          ativo: boolean
          categoria: string
          created_at: string
          id: string
          sort_order: number
          texto_en: string
          texto_pt: string
          titulo: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ativo?: boolean
          categoria: string
          created_at?: string
          id?: string
          sort_order?: number
          texto_en: string
          texto_pt: string
          titulo: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ativo?: boolean
          categoria?: string
          created_at?: string
          id?: string
          sort_order?: number
          texto_en?: string
          texto_pt?: string
          titulo?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_sms_replies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_sms_replies_updated_by_fkey"
            columns: ["updated_by"]
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
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "lya_agentes"
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
            referencedRelation: "lya_agentes"
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
            referencedRelation: "lya_agentes"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "lya_agentes"
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
            referencedRelation: "lya_agentes"
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
      lya_agentes: {
        Row: {
          created_at: string | null
          full_name: string | null
          id: string | null
          is_active: boolean | null
          is_available: boolean | null
          role: string | null
          support_channel: string | null
        }
        Insert: {
          created_at?: string | null
          full_name?: string | null
          id?: string | null
          is_active?: boolean | null
          is_available?: boolean | null
          role?: never
          support_channel?: string | null
        }
        Update: {
          created_at?: string | null
          full_name?: string | null
          id?: string | null
          is_active?: boolean | null
          is_available?: boolean | null
          role?: never
          support_channel?: string | null
        }
        Relationships: []
      }
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
      _sla_mes: { Args: { p_month: string; p_user: string }; Returns: Json }
      _sla_resolve_user: { Args: { p_user_id: string }; Returns: string }
      add_business_hours: { Args: { a: string; h: number }; Returns: string }
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
      business_days_in_month: { Args: { p_month: string }; Returns: number }
      business_hours_between: {
        Args: { a: string; b: string }
        Returns: number
      }
      business_start: { Args: { p_at: string }; Returns: string }
      can_claim_tickets: { Args: never; Returns: boolean }
      can_read_refund_analytics: { Args: never; Returns: boolean }
      can_view_all_tickets: { Args: never; Returns: boolean }
      can_view_support_analytics: { Args: never; Returns: boolean }
      claim_ticket: {
        Args: { p_service_id: string }
        Returns: {
          channel: string
          client_email: string
          contact_reason: string
          contact_reason_note: string
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
      copy_refund_reason_analytics: {
        Args: {
          channel_filter?: string
          from_date: string
          platform_filter?: string
          product_filter?: string
          to_date: string
        }
        Returns: Json
      }
      copy_refund_reason_evidence: {
        Args: {
          channel_filter?: string
          from_date: string
          max_rows?: number
          platform_filter?: string
          product_filter?: string
          reason_category: string
          to_date: string
        }
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
        Args: { p_agent_id?: string; p_from_date?: string; p_to_date?: string }
        Returns: Json
      }
      dashboard_contact_reason_notes: {
        Args: { agent_id?: string; from_date: string; to_date: string }
        Returns: Json
      }
      dashboard_daily_tickets: {
        Args: {
          agent_id?: string
          channel_filter?: string
          from_date: string
          platform_filter?: string
          product_filter?: string
          to_date: string
        }
        Returns: Json
      }
      dashboard_export_extras: {
        Args: { agent_id?: string; from_date: string; to_date: string }
        Returns: Json
      }
      dashboard_external_refund_comparison: {
        Args: {
          divergence_filter?: string
          from_date: string
          page_offset?: number
          page_size?: number
          platform_filter?: string
          product_filter?: string
          to_date: string
        }
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
      dashboard_same_day_repeats: {
        Args: { agent_id?: string; from_date: string; to_date: string }
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
      held_order_client_key: {
        Args: { p_customer_name: string; p_email: string; p_id: string }
        Returns: string
      }
      held_order_events_for: { Args: { p_order_id: string }; Returns: Json }
      held_order_products: { Args: { p_items: string }; Returns: string[] }
      held_orders_client_conflicts: {
        Args: { p_keys: string[] }
        Returns: string[]
      }
      is_business_day: { Args: { p_day: string }; Returns: boolean }
      is_copy_team: { Args: never; Returns: boolean }
      is_manager: { Args: never; Returns: boolean }
      is_produtos_team: { Args: never; Returns: boolean }
      late_hunter_list: {
        Args: {
          p_ambiente?: string
          p_busca?: string
          p_data_ate?: string
          p_data_de?: string
          p_dias_max?: number
          p_dias_min?: number
          p_limite?: number
          p_lojas?: string[]
          p_motivos?: string[]
          p_offset?: number
          p_ordem?: string
          p_paises?: string[]
          p_reabertos?: boolean
          p_situacao?: string
        }
        Returns: Json
      }
      late_hunter_order_history: { Args: { p_order_id: number }; Returns: Json }
      late_hunter_overview: { Args: { p_ambiente?: string }; Returns: Json }
      late_hunter_split_motivos: {
        Args: { p_motivo: string }
        Returns: string[]
      }
      late_hunter_sync: {
        Args: { p_ambiente: string; p_lote: Json }
        Returns: Json
      }
      late_hunter_valid_date: { Args: { p: string }; Returns: boolean }
      lya_atualizar_arquivo: {
        Args: {
          p_file_id: string
          p_nome?: string
          p_resumo?: string
          p_tags?: Json
        }
        Returns: Json
      }
      lya_criar_arquivo: {
        Args: {
          p_arquivo: string
          p_bytes?: number
          p_conteudo?: string
          p_nome: string
          p_tipo: string
        }
        Returns: string
      }
      lya_delete_chat: { Args: { p_chat_id: string }; Returns: number }
      lya_delete_file: { Args: { p_file_id: string }; Returns: number }
      lya_delete_memory: { Args: { p_name: string }; Returns: number }
      lya_delete_seed_memories: { Args: never; Returns: number }
      lya_exec_sql: { Args: { p_limit?: number; p_sql: string }; Returns: Json }
      lya_finalizar_arquivo: {
        Args: {
          p_colunas?: Json
          p_erro?: string
          p_file_id: string
          p_resumo?: string
          p_tags?: Json
          p_total?: number
        }
        Returns: Json
      }
      lya_get_chat: { Args: { p_chat_id: string }; Returns: Json }
      lya_get_file: {
        Args: { p_amostra?: number; p_file_id: string }
        Returns: Json
      }
      lya_inserir_linhas: {
        Args: { p_file_id: string; p_linhas: Json; p_offset?: number }
        Returns: number
      }
      lya_list_chats: { Args: never; Returns: Json }
      lya_list_files: { Args: never; Returns: Json }
      lya_list_memories: {
        Args: never
        Returns: {
          author_id: string | null
          body: string
          created_at: string
          description: string
          file_id: string | null
          id: number
          name: string
          origem: string
          seed: boolean
          tags: Json
          type: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "lya_memories"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      lya_recall_memories: {
        Args: { p_limit?: number; p_query: string }
        Returns: Json
      }
      lya_save_chat: {
        Args: { p_chat_id: string; p_mensagens?: Json }
        Returns: Json
      }
      lya_sistema_nos: { Args: never; Returns: Json }
      lya_slugify: { Args: { p_text: string }; Returns: string }
      lya_upsert_memory: {
        Args: {
          p_body?: string
          p_description: string
          p_file_id?: string
          p_name: string
          p_origem?: string
          p_tags?: Json
          p_type?: string
        }
        Returns: {
          author_id: string | null
          body: string
          created_at: string
          description: string
          file_id: string | null
          id: number
          name: string
          origem: string
          seed: boolean
          tags: Json
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "lya_memories"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
      manager_delete_external_refunds: {
        Args: { p_month_ref?: string; p_platform?: string; p_product: string }
        Returns: Json
      }
      manager_distribute_held_orders: {
        Args: { p_agent_ids: string[]; p_order_ids: string[] }
        Returns: Json
      }
      manager_held_orders_page: {
        Args: {
          p_agent_id?: string
          p_date_field?: string
          p_from?: string
          p_ids_only?: boolean
          p_limit?: number
          p_offset?: number
          p_product?: string
          p_search?: string
          p_status?: string
          p_to?: string
        }
        Returns: Json
      }
      manager_held_orders_team: { Args: never; Returns: Json }
      manager_import_external_refunds: {
        Args: {
          p_month_ref: string
          p_platform?: string
          p_product: string
          p_rows: Json
          p_source_file: string
        }
        Returns: Json
      }
      manager_import_held_orders: { Args: { p_rows: Json }; Returns: Json }
      manager_inactive_alerts: { Args: never; Returns: Json }
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
      manager_review_inactive_alert: {
        Args: { p_alert_id: string; p_decision: string; p_note?: string }
        Returns: undefined
      }
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
      my_held_orders: {
        Args: { p_concluded_days?: number; p_status?: string }
        Returns: Json
      }
      my_held_orders_daily_metrics: { Args: never; Returns: Json }
      my_overdue_queue_items: {
        Args: never
        Returns: {
          caso_id: string
          prazo_horas: number
          rotulo_tipo: string
          tipo: string
          vencido_ha_horas: number
        }[]
      }
      my_radar_items: { Args: never; Returns: Json }
      my_radar_summary: { Args: never; Returns: Json }
      my_recent_services: {
        Args: { p_days_back?: number }
        Returns: {
          channel: string
          client_email: string
          contact_reason: string
          contact_reason_note: string
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
          picked_up_at: string
          product: string
          reason: string
          refund_type: string
          refund_value: number
          refunded_value: number
          request_date: string
          sales_platform: string
          service_id: string
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
      normalize_order_number: { Args: { p: string }; Returns: string }
      pick_up_refund: { Args: { p_refund_id: string }; Returns: undefined }
      provider_capacity_per_business_day: {
        Args: { p_user_id: string }
        Returns: number
      }
      radar_create_item: {
        Args: {
          p_action_needed: string
          p_client_email: string
          p_kind: string
          p_next_follow_up_date: string
          p_notes?: string
          p_order_number?: string
          p_product?: string
        }
        Returns: string
      }
      radar_delete_item: { Args: { p_item_id: string }; Returns: undefined }
      radar_is_closed: { Args: { p_status: string }; Returns: boolean }
      radar_item_events: { Args: { p_item_id: string }; Returns: Json }
      radar_register_action: {
        Args: {
          p_action: string
          p_item_id: string
          p_next_follow_up_date?: string
          p_status: string
        }
        Returns: undefined
      }
      radar_today: { Args: never; Returns: string }
      radar_update_item: {
        Args: {
          p_action_needed: string
          p_client_email: string
          p_item_id: string
          p_kind: string
          p_notes?: string
          p_order_number?: string
          p_product?: string
        }
        Returns: undefined
      }
      record_auth_event: {
        Args: {
          p_event_type: string
          p_metadata?: Json
          p_target_user_id?: string
        }
        Returns: undefined
      }
      redact_free_text: { Args: { p_value: string }; Returns: string }
      refresh_agent_daily_service_count: {
        Args: { p_day: string; p_user_id: string }
        Returns: undefined
      }
      refund_refunded_value: {
        Args: { p_refund_type: string; p_refund_value: number }
        Returns: number
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
        Args: {
          p_note?: string
          p_order_id: string
          p_pending_tag?: string
          p_status: string
        }
        Returns: undefined
      }
      sla_mensal: {
        Args: { p_month: string; p_user_id?: string }
        Returns: Json
      }
      sla_relatorio_mensal: {
        Args: { p_month: string; p_user_id?: string }
        Returns: Json
      }
      text_to_date_safe: { Args: { p_value: string }; Returns: string }
    }
    Enums: {
      app_role: "agent" | "manager" | "copy_grup" | "produto"
      AppRole: "agent" | "manager" | "copy_grup" | "produto"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["agent", "manager", "copy_grup", "produto"],
      AppRole: ["agent", "manager", "copy_grup", "produto"],
    },
  },
} as const
