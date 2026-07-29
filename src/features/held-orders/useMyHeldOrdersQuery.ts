import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type {
  HeldOrderAgentStatus,
  HeldOrderEvent,
  HeldOrdersDailyMetrics,
  HeldOrderPendingTag,
  MyHeldOrder,
} from "./types";

// As RPCs de pedidos em espera ainda não estão nos tipos gerados do Supabase.
const rpc = supabase.rpc.bind(supabase) as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

const MY_HELD_ORDERS_KEY = ["held-orders", "mine"] as const;
const MY_HELD_METRICS_KEY = ["held-orders", "mine", "metrics"] as const;
const HELD_ORDER_EVENTS_KEY = ["held-orders", "events"] as const;

export function useMyHeldOrdersQuery(
  enabled: boolean,
  status: HeldOrderAgentStatus | "all" = "all",
) {
  return useQuery({
    queryKey: [...MY_HELD_ORDERS_KEY, status],
    enabled,
    queryFn: async (): Promise<MyHeldOrder[]> => {
      const { data, error } = await rpc("my_held_orders", { p_status: status });
      if (error) throw error;
      return (data as MyHeldOrder[]) ?? [];
    },
    refetchOnWindowFocus: false,
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
  });
}

/** Histórico (timeline) de um pedido específico — buscado ao abrir o diálogo. */
export function useHeldOrderEventsQuery(orderId: string | null) {
  return useQuery({
    queryKey: [...HELD_ORDER_EVENTS_KEY, orderId],
    enabled: Boolean(orderId),
    queryFn: async (): Promise<HeldOrderEvent[]> => {
      const { data, error } = await rpc("held_order_events_for", { p_order_id: orderId });
      if (error) throw error;
      return (data as HeldOrderEvent[]) ?? [];
    },
    refetchOnWindowFocus: false,
  });
}

/** Muda o status do pedido e registra uma entrada no histórico. */
export function useSetHeldOrderStatusMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      orderId: string;
      status: HeldOrderAgentStatus;
      note: string;
      /** null = sem pendência. O valor enviado sempre sobrescreve a tag atual. */
      pendingTag: HeldOrderPendingTag | null;
    }) => {
      const { error } = await rpc("set_held_order_status", {
        p_order_id: params.orderId,
        p_status: params.status,
        p_note: params.note,
        p_pending_tag: params.pendingTag,
      });
      if (error) throw error;
    },
    onSuccess: (_data, params) => {
      qc.invalidateQueries({ queryKey: MY_HELD_ORDERS_KEY });
      qc.invalidateQueries({ queryKey: MY_HELD_METRICS_KEY });
      qc.invalidateQueries({ queryKey: [...HELD_ORDER_EVENTS_KEY, params.orderId] });
    },
  });
}
