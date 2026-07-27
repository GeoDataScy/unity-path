import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TransferNotification = {
  role: "inbox" | "response";
  transfer_id: string;
  service_id: string;
  client_email: string;
  product: string;
  service_status: string;
  transfer_status: "pending" | "accepted" | "declined" | "cancelled";
  message: string | null;
  response_note: string | null;
  other_agent_id: string;
  other_agent_name: string | null;
  created_at: string;
  responded_at: string | null;
};

export function useTransferNotificationsQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["transfer_notifications"],
    enabled,
    queryFn: async (): Promise<TransferNotification[]> => {
      const { data, error } = await supabase.rpc("my_transfer_notifications");
      if (error) throw error;
      return (data ?? []) as TransferNotification[];
    },
    // Polling: refresh every 30s + on window focus, so the bell stays current
    // without paying for Supabase Realtime in v1.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}
