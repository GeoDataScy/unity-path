import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Params = {
  enabled: boolean;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
};

export type ChannelAgentRow = {
  channel: string;
  agent_id: string;
  agent_name: string;
  new_tickets: number;
  done_count: number;
  interactions: number;
  total: number;
};

export type DashboardChannelDetail = {
  by_channel_agent: ChannelAgentRow[];
};

export function useDashboardChannelDetailQuery({ enabled, from, to }: Params) {
  return useQuery({
    queryKey: ["dashboard", "channel-detail", { from, to }],
    enabled,
    queryFn: async (): Promise<DashboardChannelDetail> => {
      const { data, error } = await supabase.rpc("dashboard_channel_detail", {
        p_from_date: from,
        p_to_date: to,
      });
      if (error) throw error;
      return data as DashboardChannelDetail;
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}
