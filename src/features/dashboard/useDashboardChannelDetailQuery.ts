import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Params = {
  enabled: boolean;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  /** id do agente selecionado no cabeçalho da gestora; "all" ou undefined = time inteiro */
  agentId?: string;
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

export function useDashboardChannelDetailQuery({ enabled, from, to, agentId }: Params) {
  // Mesma normalização usada pelo relatório em Excel (reportExport.ts) — é o que
  // garante que a tela e a aba "Canal — Detalhamento" leiam o mesmo recorte.
  const normalizedAgentId = agentId && agentId !== "all" ? agentId : null;

  return useQuery({
    queryKey: ["dashboard", "channel-detail", { from, to, agentId: normalizedAgentId }],
    enabled,
    queryFn: async (): Promise<DashboardChannelDetail> => {
      const { data, error } = await supabase.rpc("dashboard_channel_detail", {
        p_from_date: from,
        p_to_date: to,
        p_agent_id: normalizedAgentId,
      });
      if (error) throw error;
      return data as DashboardChannelDetail;
    },
    refetchOnWindowFocus: false,
  });
}
