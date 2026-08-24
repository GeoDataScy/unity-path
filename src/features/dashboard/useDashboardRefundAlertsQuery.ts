import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OverdueRefund {
  id: string;
  customer_email: string;
  request_date: string;
  sales_platform: string;
  order_id: string;
  product: string | null;
  channel: string | null;
  days_overdue: number;
}

export interface AgentOverdueGroup {
  agent_id: string;
  agent_name: string;
  overdue_count: number;
  refunds: OverdueRefund[];
}

export interface RefundAlertsData {
  total_overdue: number;
  agents_affected: number;
  by_agent: AgentOverdueGroup[];
}

export const REFUND_ALERTS_QUERY_KEY = ["dashboard", "refund-alerts"] as const;

// manager_refund_alerts é guardada por is_manager() no banco. Quem entra na área
// de analytics sem ser gestora (time de copy) não deve nem chamar: daria erro a
// cada 60 s no polling. Daí o `enabled`.
export function useDashboardRefundAlertsQuery(enabled = true) {
  return useQuery({
    queryKey: REFUND_ALERTS_QUERY_KEY,
    enabled,
    queryFn: async (): Promise<RefundAlertsData> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return { total_overdue: 0, agents_affected: 0, by_agent: [] };

      const { data, error } = await supabase.rpc("manager_refund_alerts");
      if (error) throw error;
      const result = data as unknown as RefundAlertsData;
      return {
        total_overdue: result.total_overdue ?? 0,
        agents_affected: result.agents_affected ?? 0,
        by_agent: result.by_agent ?? [],
      };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
