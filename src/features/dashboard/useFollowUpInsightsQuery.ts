import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FollowUpKpi {
  total_services: number;
  open_count: number;
  in_progress_count: number;
  done_count: number;
  total_interactions: number;
}

export interface AgentBreakdown {
  agent_id: string;
  agent_name: string;
  total_tickets: number;
  open_count: number;
  in_progress_count: number;
  done_count: number;
  total_interactions: number;
  avg_interactions_to_close: number;
  completion_rate: number;
}

export interface RecentFollowUp {
  id: string;
  service_id: string;
  follow_up_number: number;
  status: string;
  recorded_at: string;
  observation: string;
  created_at: string;
  client_email: string;
  product: string;
  platform: string;
  channel: string;
  agent_name: string;
}

export interface InsightEntry {
  agent_id: string;
  agent_name: string;
}

export interface TopPerformer extends InsightEntry {
  done: number;
  total: number;
  rate: number;
}

export interface MostOpen extends InsightEntry {
  open_count: number;
}

export interface MostProductive extends InsightEntry {
  interaction_count: number;
}

export interface FollowUpInsights {
  top_performer: TopPerformer | null;
  most_open: MostOpen | null;
  most_productive: MostProductive | null;
}

export interface FollowUpDetailData {
  kpi: FollowUpKpi;
  by_agent: AgentBreakdown[];
  recent_follow_ups: RecentFollowUp[];
  insights: FollowUpInsights;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useFollowUpInsightsQuery(fromISO: string, toISO: string) {
  return useQuery({
    queryKey: ["follow-up-insights", fromISO, toISO],
    queryFn: async (): Promise<FollowUpDetailData> => {
      const { data, error } = await supabase.rpc("dashboard_follow_up_detail", {
        p_from_date: fromISO,
        p_to_date: toISO,
      });

      if (error) throw error;

      const result = data as unknown as FollowUpDetailData;

      return {
        kpi: result.kpi ?? {
          total_services: 0,
          open_count: 0,
          in_progress_count: 0,
          done_count: 0,
          total_interactions: 0,
        },
        by_agent: result.by_agent ?? [],
        recent_follow_ups: result.recent_follow_ups ?? [],
        insights: result.insights ?? {
          top_performer: null,
          most_open: null,
          most_productive: null,
        },
      };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
