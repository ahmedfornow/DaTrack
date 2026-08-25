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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      attendance: {
        Row: {
          checked_in_at: string | null
          guided_trials: number
          id: number
          promoter_id: string
          shift: string
          status: string
          touch_point_id: number | null
          work_date: string
        }
        Insert: {
          checked_in_at?: string | null
          guided_trials?: number
          id?: number
          promoter_id: string
          shift?: string
          status?: string
          touch_point_id?: number | null
          work_date?: string
        }
        Update: {
          checked_in_at?: string | null
          guided_trials?: number
          id?: number
          promoter_id?: string
          shift?: string
          status?: string
          touch_point_id?: number | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_touch_point_id_fkey"
            columns: ["touch_point_id"]
            isOneToOne: false
            referencedRelation: "touch_points"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_items: {
        Row: {
          active: boolean | null
          created_by: string | null
          id: number
          sort_order: number | null
          title: string
        }
        Insert: {
          active?: boolean | null
          created_by?: string | null
          id?: number
          sort_order?: number | null
          title: string
        }
        Update: {
          active?: boolean | null
          created_by?: string | null
          id?: number
          sort_order?: number | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_responses: {
        Row: {
          checked: boolean | null
          id: number
          item_id: number
          promoter_id: string
          work_date: string
        }
        Insert: {
          checked?: boolean | null
          id?: number
          item_id: number
          promoter_id: string
          work_date?: string
        }
        Update: {
          checked?: boolean | null
          id?: number
          item_id?: number
          promoter_id?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_responses_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_responses_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      device_catalog: {
        Row: {
          active: boolean | null
          color: string
          device_type: string
          id: number
        }
        Insert: {
          active?: boolean | null
          color: string
          device_type: string
          id?: number
        }
        Update: {
          active?: boolean | null
          color?: string
          device_type?: string
          id?: number
        }
        Relationships: []
      }
      route_plans: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: number
          plan_date: string
          promoter_id: string
          shift: string | null
          status: string | null
          touch_point_id: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: number
          plan_date: string
          promoter_id: string
          shift?: string | null
          status?: string | null
          touch_point_id?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: number
          plan_date?: string
          promoter_id?: string
          shift?: string | null
          status?: string | null
          touch_point_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "route_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_plans_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_plans_touch_point_id_fkey"
            columns: ["touch_point_id"]
            isOneToOne: false
            referencedRelation: "touch_points"
            referencedColumns: ["id"]
          },
        ]
      }
      sell_operations: {
        Row: {
          attendance_id: number
          color: string
          created_at: string | null
          customer_type: string
          device_type: string
          id: number
          note: string | null
          promoter_id: string
          quantity: number
          sale_type: string
          work_date: string
        }
        Insert: {
          attendance_id: number
          color: string
          created_at?: string | null
          customer_type: string
          device_type: string
          id?: number
          note?: string | null
          promoter_id: string
          quantity?: number
          sale_type: string
          work_date?: string
        }
        Update: {
          attendance_id?: number
          color?: string
          created_at?: string | null
          customer_type?: string
          device_type?: string
          id?: number
          note?: string | null
          promoter_id?: string
          quantity?: number
          sale_type?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "sell_operations_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sell_operations_device_type_color_fkey"
            columns: ["device_type", "color"]
            isOneToOne: false
            referencedRelation: "device_catalog"
            referencedColumns: ["device_type", "color"]
          },
          {
            foreignKeyName: "sell_operations_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_catalog: {
        Row: {
          active: boolean | null
          category: string
          id: number
          item_name: string
          sort_order: number | null
        }
        Insert: {
          active?: boolean | null
          category?: string
          id?: number
          item_name: string
          sort_order?: number | null
        }
        Update: {
          active?: boolean | null
          category?: string
          id?: number
          item_name?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      stock_reports: {
        Row: {
          attendance_id: number
          id: number
          item_id: number
          promoter_id: string
          quantity: number
          reported_at: string | null
        }
        Insert: {
          attendance_id: number
          id?: number
          item_id: number
          promoter_id: string
          quantity: number
          reported_at?: string | null
        }
        Update: {
          attendance_id?: number
          id?: number
          item_id?: number
          promoter_id?: string
          quantity?: number
          reported_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_reports_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reports_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "stock_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reports_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sup_tasks: {
        Row: {
          created_at: string
          done: boolean
          due_date: string | null
          id: number
          kind: string
          owner_id: string
          title: string
          weekday: number | null
        }
        Insert: {
          created_at?: string
          done?: boolean
          due_date?: string | null
          id?: never
          kind?: string
          owner_id: string
          title: string
          weekday?: number | null
        }
        Update: {
          created_at?: string
          done?: boolean
          due_date?: string | null
          id?: never
          kind?: string
          owner_id?: string
          title?: string
          weekday?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sup_tasks_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_responses: {
        Row: {
          answer: string
          answered_at: string | null
          id: number
          promoter_id: string
          survey_id: number
        }
        Insert: {
          answer: string
          answered_at?: string | null
          id?: number
          promoter_id: string
          survey_id: number
        }
        Update: {
          answer?: string
          answered_at?: string | null
          id?: number
          promoter_id?: string
          survey_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "survey_responses_promoter_id_fkey"
            columns: ["promoter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      surveys: {
        Row: {
          active_date: string
          created_by: string | null
          id: number
          options: Json | null
          question: string
        }
        Insert: {
          active_date?: string
          created_by?: string | null
          id?: number
          options?: Json | null
          question: string
        }
        Update: {
          active_date?: string
          created_by?: string | null
          id?: number
          options?: Json | null
          question?: string
        }
        Relationships: [
          {
            foreignKeyName: "surveys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      targets: {
        Row: {
          daily_target: number
          gt_target: number
          id: number
          month: string
          shift: string
          touch_point_id: number
        }
        Insert: {
          daily_target?: number
          gt_target?: number
          id?: number
          month?: string
          shift: string
          touch_point_id: number
        }
        Update: {
          daily_target?: number
          gt_target?: number
          id?: number
          month?: string
          shift?: string
          touch_point_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "targets_touch_point_id_fkey"
            columns: ["touch_point_id"]
            isOneToOne: false
            referencedRelation: "touch_points"
            referencedColumns: ["id"]
          },
        ]
      }
      touch_points: {
        Row: {
          active: boolean | null
          city: string
          dual_shift: boolean | null
          id: number
          is_ds: boolean
          maps_url: string | null
          name: string
          shift_mode: string
          unicode: string | null
        }
        Insert: {
          active?: boolean | null
          city?: string
          dual_shift?: boolean | null
          id?: number
          is_ds?: boolean
          maps_url?: string | null
          name: string
          shift_mode?: string
          unicode?: string | null
        }
        Update: {
          active?: boolean | null
          city?: string
          dual_shift?: boolean | null
          id?: number
          is_ds?: boolean
          maps_url?: string | null
          name?: string
          shift_mode?: string
          unicode?: string | null
        }
        Relationships: []
      }
      users: {
        Row: {
          active: boolean | null
          city: string
          created_at: string | null
          full_name: string
          id: string
          last4_id: string
          login_no: string | null
          role: string
        }
        Insert: {
          active?: boolean | null
          city?: string
          created_at?: string | null
          full_name: string
          id: string
          last4_id: string
          login_no?: string | null
          role?: string
        }
        Update: {
          active?: boolean | null
          city?: string
          created_at?: string | null
          full_name?: string
          id?: string
          last4_id?: string
          login_no?: string | null
          role?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      my_role: { Args: never; Returns: string }
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
  public: {
    Enums: {},
  },
} as const
