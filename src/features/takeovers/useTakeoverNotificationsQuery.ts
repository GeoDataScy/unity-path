import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TakeoverNotification = {
  request_id: string;
  service_id: string;
  client_email: string;
  product: string;
  service_status: string;
  requester_id: string;
  requester_name: string | null;
  owner_id: string | null;
  owner_name: string | null;
  note: string | null;
  created_at: string;
};

export const TAKEOVER_NOTIFICATIONS_KEY = ["takeover_notifications"] as const;

/**
 * Fila de pedidos de tomada de ticket aguardando aprovação da gestora.
 *
 * A RPC manager_takeover_notifications só retorna linhas para quem tem
 * can_approve_takeovers = true (hoje, apenas a Jessica). Para os demais
 * gestores a lista vem vazia — por isso o sino é montado apenas quando o
 * layout já sabe que o usuário é aprovador.
 */
export function useTakeoverNotificationsQuery(enabled: boolean) {
  return useQuery({
    queryKey: TAKEOVER_NOTIFICATIONS_KEY,
    enabled,
    queryFn: async (): Promise<TakeoverNotification[]> => {
      const { data, error } = await supabase.rpc("manager_takeover_notifications");
      if (error) throw error;
      return (data ?? []) as TakeoverNotification[];
    },
    // Mesma cadência do sino dos agentes: 30s + no foco, sem Realtime.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}
