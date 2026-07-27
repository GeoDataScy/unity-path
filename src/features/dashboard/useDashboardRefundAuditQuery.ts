import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Params = {
  enabled: boolean;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  agentId?: string;
  status?: "all" | "open" | "done";
  refundType?: string; // 'all' | 'null' | specific type
  product?: string; // 'all' | 'null' | specific product
  page: number; // 1-based
  pageSize: number;
  refetchIntervalMs?: number;
};

export type DashboardRefundAuditRow = {
  id: string;
  created_at: string;
  user_id: string;
  customer_email: string;
  request_date: string;
  completion_date: string | null;
  sales_platform: string;
  order_id: string;
  refund_type: string | null;
  reason: string | null;
  items_returned: boolean;
  product: string | null;
  channel: string | null;
  profiles: { full_name: string | null } | null;
};

export type DashboardRefundAuditResult = {
  total_count: number;
  rows: DashboardRefundAuditRow[];
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

export function useDashboardRefundAuditQuery({
  enabled,
  from,
  to,
  agentId,
  status = "all",
  refundType = "all",
  product = "all",
  page,
  pageSize,
  refetchIntervalMs = 15_000,
}: Params) {
  const pageOffset = Math.max(0, (page - 1) * pageSize);

  return useQuery({
    queryKey: [
      "dashboard",
      "refunds",
      "audit",
      { from, to, agentId: agentId ?? "all", status, refundType, product, page, pageSize },
    ],
    enabled,
    queryFn: async (): Promise<DashboardRefundAuditResult> => {
      await requireSession();

      const { data, error } = await supabase.rpc("dashboard_refund_audit", {
        from_date: from,
        to_date: to,
        agent_id: agentId || null,
        status_filter: status,
        refund_type_filter: refundType,
        product_filter: product,
        page_size: pageSize,
        page_offset: pageOffset,
      });

      if (error) throw error;
      return data as DashboardRefundAuditResult;
    },
    refetchOnWindowFocus: false,
    refetchInterval: refetchIntervalMs,
  });
}
