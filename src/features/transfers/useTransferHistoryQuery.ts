import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TransferHistoryItem = {
  role: "sent" | "received";
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

export function useTransferHistoryQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["transfer_history"],
    enabled,
    queryFn: async (): Promise<TransferHistoryItem[]> => {
      const { data, error } = await supabase.rpc("my_transfer_history");
      if (error) throw error;
      return (data ?? []) as TransferHistoryItem[];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
