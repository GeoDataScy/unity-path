import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type ManagerUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  support_channel: string | null;
  is_active: boolean;
  is_available: boolean;
  deactivated_at: string | null;
  deactivated_by: string | null;
  deactivated_by_email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  banned_until: string | null;
  auth_deleted_at: string | null;
  auth_account_deleted: boolean;
  last_seen_at: string | null;
  is_online: boolean;
  last_logout_at: string | null;
  open_tickets_count: number;
  authorized_open_count: number;
};

const USERS_QUERY_KEY = ["dashboard", "users"] as const;

export function useManagerUsersQuery(enabled: boolean = true) {
  return useQuery({
    queryKey: USERS_QUERY_KEY,
    enabled,
    queryFn: async (): Promise<ManagerUser[]> => {
      const { data, error } = await supabase.rpc("manager_list_users");
      if (error) throw error;
      return (data as unknown as ManagerUser[]) ?? [];
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
  });
}

export function useSetUserActiveMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, active }: { userId: string; active: boolean }) => {
      const { error } = await supabase.rpc("manager_set_user_active", {
        p_target_user_id: userId,
        p_active: active,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: USERS_QUERY_KEY });
    },
  });
}

export function useSetAgentAvailabilityMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, available }: { userId: string; available: boolean }) => {
      const { error } = await supabase.rpc("manager_set_agent_availability", {
        p_target_user_id: userId,
        p_available: available,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: USERS_QUERY_KEY });
    },
  });
}

export function useDeleteAuthUserMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, confirmEmail }: { userId: string; confirmEmail: string }) => {
      const { error } = await supabase.rpc("manager_delete_auth_user", {
        p_target_user_id: userId,
        p_confirm_email: confirmEmail,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: USERS_QUERY_KEY });
    },
  });
}
