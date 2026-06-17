import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { HeldOrdersDailyMetrics, MyHeldOrder } from "./types";

// As RPCs de pedidos em espera ainda não estão nos tipos gerados do Supabase.
const rpc = supabase.rpc.bind(supabase) as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

const MY_HELD_ORDERS_KEY = ["held-orders", "mine"] as const;
const MY_HELD_METRICS_KEY = ["held-orders", "mine", "metrics"] as const;

export function useMyHeldOrdersQuery(enabled: boolean, status: "pending" | "confirmed" | "all" = "pending") {
  return useQuery({
    queryKey: [...MY_HELD_ORDERS_KEY, status],
    enabled,
    queryFn: async (): Promise<MyHeldOrder[]> => {
      const { data, error } = await rpc("my_held_orders", { p_status: status });
      if (error) throw error;
      return (data as MyHeldOrder[]) ?? [];
    },
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}

export function useMyHeldOrdersMetricsQuery(enabled: boolean) {
  return useQuery({
    queryKey: MY_HELD_METRICS_KEY,
    enabled,
    queryFn: async (): Promise<HeldOrdersDailyMetrics> => {
      const { data, error } = await rpc("my_held_orders_daily_metrics");
      if (error) throw error;
      return (data as HeldOrdersDailyMetrics) ?? { confirmed_today: 0, pending: 0, goal: 30 };
    },
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}

export function useConfirmHeldOrderMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await rpc("confirm_held_order", { p_order_id: orderId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MY_HELD_ORDERS_KEY });
      qc.invalidateQueries({ queryKey: MY_HELD_METRICS_KEY });
    },
  });
}
