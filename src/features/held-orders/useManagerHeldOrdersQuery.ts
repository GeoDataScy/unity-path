import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type {
  DistributeHeldOrdersResult,
  HeldOrderImportRow,
  ImportHeldOrdersResult,
  ManagerHeldOrdersResult,
} from "./types";

// As RPCs de pedidos em espera ainda não estão nos tipos gerados do Supabase.
const rpc = supabase.rpc.bind(supabase) as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

const MANAGER_HELD_ORDERS_KEY = ["dashboard", "held-orders"] as const;

type ListParams = {
  enabled?: boolean;
  agentId?: string | null;
  statusFilter?: "all" | "pending" | "confirmed";
};

export function useManagerHeldOrdersQuery({ enabled = true, agentId = null, statusFilter = "all" }: ListParams) {
  return useQuery({
    queryKey: [...MANAGER_HELD_ORDERS_KEY, { agentId, statusFilter }],
    enabled,
    queryFn: async (): Promise<ManagerHeldOrdersResult> => {
      const { data, error } = await rpc("manager_list_held_orders", {
        from_date: null,
        to_date: null,
        agent_id: agentId,
        status_filter: statusFilter,
      });
      if (error) throw error;
      return (
        (data as ManagerHeldOrdersResult) ?? { total: 0, duplicates: 0, rows: [], summary_by_agent: [] }
      );
    },
    refetchOnWindowFocus: false,
  });
}

export function useImportHeldOrdersMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: HeldOrderImportRow[]): Promise<ImportHeldOrdersResult> => {
      const { data, error } = await rpc("manager_import_held_orders", { p_rows: rows });
      if (error) throw error;
      return (
        (data as ImportHeldOrdersResult) ?? {
          total: 0,
          inserted: 0,
          duplicates: 0,
          empty_rows: 0,
          duplicate_orders: [],
          skipped: 0,
        }
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MANAGER_HELD_ORDERS_KEY });
    },
  });
}

export function useAssignHeldOrdersMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderIds, agentId }: { orderIds: string[]; agentId: string }): Promise<number> => {
      const { data, error } = await rpc("manager_assign_held_orders", {
        p_order_ids: orderIds,
        p_agent_id: agentId,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MANAGER_HELD_ORDERS_KEY });
    },
  });
}

/** Distribuição em lote round-robin entre vários agentes. */
export function useDistributeHeldOrdersMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderIds,
      agentIds,
    }: {
      orderIds: string[];
      agentIds: string[];
    }): Promise<DistributeHeldOrdersResult> => {
      const { data, error } = await rpc("manager_distribute_held_orders", {
        p_order_ids: orderIds,
        p_agent_ids: agentIds,
      });
      if (error) throw error;
      return (data as DistributeHeldOrdersResult) ?? { moved: 0, by_agent: [] };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MANAGER_HELD_ORDERS_KEY });
    },
  });
}
