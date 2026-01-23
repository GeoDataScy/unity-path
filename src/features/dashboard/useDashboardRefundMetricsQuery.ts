import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Params = {
  enabled: boolean;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  agentId?: string;
  status?: "all" | "open" | "done";
  refundType?: string; // 'all' | 'null' | specific type
  refetchIntervalMs?: number;
};

export type DashboardRefundMetrics = {
  total_count: number;
  open_count: number;
  done_count: number;
  by_agent: Array<{ name: string; value: number; user_id: string }>;
  by_status: Array<{ name: string; value: number }>;
  by_refund_type: Array<{ name: string; value: number }>;
};

async function requireSession() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) throw error;
  if (!session) throw new Error("Sessão inválida");
  return session;
}

export function useDashboardRefundMetricsQuery({
  enabled,
  from,
  to,
  agentId,
  status = "all",
  refundType = "all",
  refetchIntervalMs = 15_000,
}: Params) {
  return useQuery({
    queryKey: [
      "dashboard",
      "refunds",
      "metrics",
      { from, to, agentId: agentId ?? "all", status, refundType },
    ],
    enabled,
    queryFn: async (): Promise<DashboardRefundMetrics> => {
      await requireSession();

      const { data, error } = await supabase.rpc("dashboard_refund_metrics", {
        from_date: from,
        to_date: to,
        agent_id: agentId || null,
        status_filter: status,
        refund_type_filter: refundType,
      });

      if (error) throw error;
      return data as DashboardRefundMetrics;
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: refetchIntervalMs,
  });
}
