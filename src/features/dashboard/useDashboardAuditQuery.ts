import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Params = {
  enabled: boolean;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  agentId?: string;
  page: number; // 1-based
  pageSize: number;
};

// Uma linha por interação — mesmo universo de dashboard_metrics
// (abertura do ticket + cada follow-up). Ver migration 20260904120000.
export type DashboardAuditRow = {
  id: string;
  kind: "service" | "follow_up";
  service_id: string;
  event_at: string; // timestamptz ISO
  day: string; // YYYY-MM-DD em America/Sao_Paulo (mesmo bucket do gráfico por dia)
  user_id: string;
  client_email: string;
  product: string;
  platform: string | null;
  channel: string | null;
  status: string | null;
  follow_up_number: number | null;
  profiles: { full_name: string | null } | null;
};

export type DashboardAuditResult = {
  total_count: number;
  rows: DashboardAuditRow[];
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

export function useDashboardAuditQuery({ enabled, from, to, agentId, page, pageSize }: Params) {
  const pageOffset = Math.max(0, (page - 1) * pageSize);

  return useQuery({
    queryKey: ["dashboard", "audit", { from, to, agentId: agentId ?? "all", page, pageSize }],
    enabled,
    queryFn: async (): Promise<DashboardAuditResult> => {
      await requireSession();

      const { data, error } = await supabase.rpc("dashboard_audit", {
        from_date: from,
        to_date: to,
        agent_id: agentId || null,
        page_size: pageSize,
        page_offset: pageOffset,
      });

      if (error) throw error;
      return data as DashboardAuditResult;
    },
    refetchOnWindowFocus: false,
  });
}
