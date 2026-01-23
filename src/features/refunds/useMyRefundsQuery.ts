import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { RefundItem } from "@/features/refunds/types";

export function useMyRefundsQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["refunds", "me"],
    enabled,
    queryFn: async (): Promise<RefundItem[]> => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return [];

      const { data, error } = await supabase
        .from("refunds")
        .select(
          "id, created_at, user_id, customer_email, request_date, completion_date, reason, items_returned, sales_platform, order_id, refund_type",
        )
        .eq("user_id", session.user.id)
        .order("request_date", { ascending: false });

      if (error) throw error;
      return (data ?? []) as RefundItem[];
    },
  });
}
