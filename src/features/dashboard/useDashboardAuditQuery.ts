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

export type DashboardAuditRow = {
  id: string;
  service_date: string;
  client_email: string;
  product: string;
  platform: string | null;
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
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}
