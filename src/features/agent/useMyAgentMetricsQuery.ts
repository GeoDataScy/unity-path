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
  /** false quando não há dias trabalhados suficientes nas duas metades — a UI esconde a tendência. */
  trend_reliable: boolean;
  by_day: AgentMetricsByDayItem[];
  by_channel: AgentMetricsItem[];
  by_platform: AgentMetricsItem[];
  by_product: AgentMetricsItem[];

  // ── Ritmo ─────────────────────────────────────────────────────────────────
  /** Dias de calendário do período. */
  period_days: number;
  /** Dias em que o agente registrou pelo menos 1 interação. */
  active_days: number;
  /** total / active_days — interações por dia TRABALHADO. */
  my_rate: number;

  // ── Referência da operação (item 3 do documento jurídico) ─────────────────
  // Sem líder, posição, nome de outro prestador ou "quanto falta": só a mediana
  // anônima do volume de todos os prestadores ativos no período.
  /** Mediana do volume no período. 0 quando há menos de 4 prestadores (não seria anônima). */
  team_median_total: number;
  /** Quantos prestadores tiveram atividade no período (inclui o próprio). */
  team_size: number;
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
