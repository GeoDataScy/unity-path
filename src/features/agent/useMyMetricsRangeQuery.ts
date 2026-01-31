import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type AgentMetricsRangeByDayItem = {
  day: string; // YYYY-MM-DD
  value: number;
};

export type AgentMetricsRange = {
  from_date: string; // YYYY-MM-DD
  to_date: string; // YYYY-MM-DD
  days: number;
  total_count: number;
  avg_daily: number;
  best_day: string | null; // YYYY-MM-DD
  best_day_count: number;
  trend_pct: number;
  trend_label: "Evoluindo" | "Estável" | "Regredindo" | string;
  by_day: AgentMetricsRangeByDayItem[];
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

export function useMyMetricsRangeQuery(params: { enabled: boolean; from: string; to: string }) {
  const { enabled, from, to } = params;

  return useQuery({
    queryKey: ["agent", "metrics-range", { from, to }],
    enabled,
    queryFn: async (): Promise<AgentMetricsRange> => {
      await requireSession();

      // NOTE: types.ts may not yet include this RPC, so we intentionally loosen typing here.
      const { data, error } = await (supabase as any).rpc("agent_metrics_range", {
        from_date: from,
        to_date: to,
      });

      if (error) throw error;
      return data as AgentMetricsRange;
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
