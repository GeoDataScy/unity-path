import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AgentMetricsByDayItem = {
  day: string;       // YYYY-MM-DD
  value: number;     // total (services + follow-ups)
  services: number;
  followups: number;
};

export type AgentMetricsItem = {
  name: string;
  value: number;
};

export type AgentMyMetrics = {
  /** DISTINCT services with activity in range (matches Atendimentos.tsx). */
  total_count: number;
  /** Legacy alias kept for backward compatibility — equals total_count. */
  total_interactions: number;
  new_services: number;
  follow_ups: number;
  avg_daily: number;
  best_day: string | null;
  best_day_count: number;
  trend_pct: number;
  trend_label: "Evoluindo" | "Estável" | "Regredindo" | string;
  by_day: AgentMetricsByDayItem[];
  by_channel: AgentMetricsItem[];
  by_platform: AgentMetricsItem[];
  by_product: AgentMetricsItem[];
  // Team comparison
  /** Average total across OTHER agents (excludes the current agent). */
  team_average: number;
  team_leader_name: string;
  team_leader_count: number;
  is_leader: boolean;
  /** How many % the team average is ABOVE own count. 0 if own >= avg. */
  gap_to_avg_pct: number;
  /** True when own_total > 0 and own < team_average * 0.8. */
  is_below_team_avg_20pct: boolean;
  // Legacy benchmark fields (point to leader, kept for back-compat)
  benchmark_name: string;
  benchmark_count: number;
  // Refunds
  refunds_open: number;
  refunds_done: number;
  refunds_total_value: number;
};

export function useMyAgentMetricsQuery(params: { enabled: boolean; from: string; to: string }) {
  const { enabled, from, to } = params;

  return useQuery({
    queryKey: ["agent", "my-metrics", { from, to }],
    enabled,
    queryFn: async (): Promise<AgentMyMetrics> => {
      const { data, error } = await (supabase as any).rpc("agent_my_metrics", {
        from_date: from,
        to_date: to,
      });
      if (error) throw error;
      return data as AgentMyMetrics;
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
