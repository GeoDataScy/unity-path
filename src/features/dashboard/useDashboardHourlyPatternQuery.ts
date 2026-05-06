import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type HourlyByDowHour = { dow: number; hour: number; count: number };

export type HourlyPattern = {
  by_dow_hour: HourlyByDowHour[];
  total: number;
  active_days: number;
  peak: {
    hour: number | null;
    count: number;
    dow: number | null;
    dow_name: string | null;
  };
  shift: {
    start_hour: number | null;
    end_hour: number | null;
  };
  shifts_share: {
    morning: number;
    afternoon: number;
    evening: number;
    night: number;
  };
  goal_hit: {
    hour: number | null;
    days_hit: number;
    total_active_days: number;
    threshold: number;
  };
};

async function requireSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session) throw new Error("Sessão inválida");
}

export function useDashboardHourlyPatternQuery(params: {
  enabled: boolean;
  from: string;
  to: string;
  agentId?: string;
}) {
  const { enabled, from, to, agentId } = params;
  return useQuery({
    queryKey: ["dashboard", "hourly-pattern", { from, to, agentId: agentId ?? "all" }],
    enabled,
    queryFn: async (): Promise<HourlyPattern> => {
      await requireSession();
      const { data, error } = await supabase.rpc("dashboard_hourly_pattern", {
        from_date: from,
        to_date: to,
        agent_id: agentId ?? null,
      });
      if (error) throw error;
      return data as HourlyPattern;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
