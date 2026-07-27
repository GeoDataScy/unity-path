import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type AgentDailyMetrics = {
  my_count: number;
  leader_count: number;
  leader_name: string;
  leader_id: string | null;
  is_leader: boolean;
};

function saoPauloISODate(d = new Date()) {
  // en-CA formats as YYYY-MM-DD
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

async function requireSession() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) throw error;
  if (!session) throw new Error("Sessão inválida");
  return session;
}

export function useAgentDailyMetricsQuery(enabled: boolean) {
  const date = saoPauloISODate();

  return useQuery({
    queryKey: ["agent", "daily-metrics", { date }],
    enabled,
    queryFn: async (): Promise<AgentDailyMetrics> => {
      await requireSession();

      const { data, error } = await supabase.rpc("agent_daily_metrics", {
        target_date: date,
      });

      if (error) throw error;
      return data as AgentDailyMetrics;
    },
    refetchOnWindowFocus: true,
  });
}
