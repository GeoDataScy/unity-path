import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type OpenTicketRow = {
  service_id: string;
  client_email: string;
  product: string;
  platform: string | null;
  channel: string | null;
  service_date: string;
  has_tracking_code: boolean;
  contact_reason: string | null;
  effective_status: string;
  last_followup_at: string | null;
  follow_up_count: number;
  creator_id: string;
  creator_name: string | null;
  creator_email: string | null;
};

export function useOpenTicketsByAgentQuery(agentId: string | null, enabled: boolean = true) {
  return useQuery({
    queryKey: ["dashboard", "open-tickets-by-agent", agentId],
    enabled: enabled && Boolean(agentId),
    queryFn: async (): Promise<OpenTicketRow[]> => {
      if (!agentId) return [];
      const { data, error } = await supabase.rpc("manager_list_open_tickets_by_agent", {
        p_agent_id: agentId,
      });
      if (error) throw error;
      return (data as unknown as OpenTicketRow[]) ?? [];
    },
    refetchOnWindowFocus: false,
  });
}
