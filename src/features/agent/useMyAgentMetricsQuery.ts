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
  /** Total / dias de CALENDÁRIO do período. Legado — prefira `my_rate`. */
  avg_daily: number;
  best_day: string | null;
  best_day_count: number;
  trend_pct: number;
  trend_label: "Evoluindo" | "Estável" | "Regredindo" | string;
  /** false quando não há dias trabalhados suficientes nas duas metades — a UI esconde a tendência. */
  trend_reliable: boolean;
  by_day: AgentMetricsByDayItem[];
  by_channel: AgentMetricsItem[];
  by_platform: AgentMetricsItem[];
  by_product: AgentMetricsItem[];

  // ── Ritmo (comparação justa) ───────────────────────────────────────────────
  /** Dias de calendário do período. */
  period_days: number;
  /** Dias em que o agente registrou pelo menos 1 interação. */
  active_days: number;
  /** Dias de calendário que ainda restam no período (contando hoje). 0 se já acabou. */
  days_remaining: number;
  /** total / active_days — interações por dia TRABALHADO. */
  my_rate: number;
  /** Mediana do ritmo dos OUTROS agentes. Robusta a outlier, ao contrário da média. */
  team_median_rate: number;
  /** Mediana do total dos OUTROS agentes. */
  team_median_total: number;
  /** Quantos agentes tiveram atividade no período (inclui o próprio). */
  team_size: number;
  /** Ritmo do líder (que é definido por volume total, não por ritmo). */
  team_leader_rate: number;
  /** Quantos a mais por dia trabalhado para alcançar a mediana. 0 se já está igual ou acima. */
  gap_per_day: number;
  /** Quantos % o ritmo da mediana está acima do seu. 0 se já está igual ou acima. */
  gap_to_median_pct: number;
  /** true quando o ritmo próprio está abaixo de 80% da mediana do time. */
  is_below_team_rate: boolean;

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
    refetchOnWindowFocus: true,
  });
}
