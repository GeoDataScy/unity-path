import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { RefundItem } from "@/features/refunds/types";

type RefundRpcRow = Omit<RefundItem, "refunded_value"> & {
  refunded_value: number | string | null;
};

export function useMyRefundsQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["refunds", "me"],
    enabled,
    queryFn: async (): Promise<RefundItem[]> => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return [];

      // Busca via RPC para já trazer refunded_value calculado no backend
      const { data, error } = await supabase.rpc("my_refunds_with_refunded_value");

      if (error) throw error;

      const rows = (data ?? []) as RefundRpcRow[];
      return rows.map((r) => ({
        ...r,
        refunded_value:
          r.refunded_value === null
            ? null
            : typeof r.refunded_value === "string"
              ? Number(r.refunded_value)
              : r.refunded_value,
      }));
    },
  });
}
