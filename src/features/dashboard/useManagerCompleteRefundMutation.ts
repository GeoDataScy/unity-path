import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/supabaseError";
import type { CompleteRefundValues } from "@/features/refunds/CompleteRefundDialog";
import { REFUND_ALERTS_QUERY_KEY } from "./useDashboardRefundAlertsQuery";
import type { RefundAlertsData } from "./useDashboardRefundAlertsQuery";

export type ManagerCompleteRefundInput = {
  refundId: string;
  agentId: string;
  values: CompleteRefundValues;
};

/**
 * Baixa de reembolso feita pela gestora na aba Alertas.
 *
 * A RLS de `refunds` só permite UPDATE ao dono do registro, então a escrita vai
 * pelo RPC `manager_complete_refund` (SECURITY DEFINER + auditoria).
 * O cache de alertas é atualizado de forma otimista para o badge do menu e o
 * card de notificação caírem no mesmo instante do clique.
 */
export function useManagerCompleteRefundMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ refundId, values }: ManagerCompleteRefundInput) => {
      const refundValue = Number(values.refund_value);
      if (!Number.isFinite(refundValue)) throw new Error("Valor do reembolso inválido");

      const { error } = await supabase.rpc("manager_complete_refund", {
        p_refund_id: refundId,
        p_completion_date: values.completion_date,
        p_refund_value: refundValue,
        p_refund_type: values.refund_type,
        p_reason: values.reason,
        p_items_returned: values.items_returned,
      });
      // O erro do supabase-js é objeto simples, não Error — normalizar aqui é o
      // que faz o motivo real chegar ao toast em vez do texto genérico.
      if (error) throw toError(error, "Não foi possível dar baixa no reembolso.");
    },

    onMutate: async ({ refundId, agentId }: ManagerCompleteRefundInput) => {
      await queryClient.cancelQueries({ queryKey: REFUND_ALERTS_QUERY_KEY });
      const previous = queryClient.getQueryData<RefundAlertsData>(REFUND_ALERTS_QUERY_KEY);

      queryClient.setQueryData<RefundAlertsData>(REFUND_ALERTS_QUERY_KEY, (current) => {
        if (!current) return current;

        const byAgent = current.by_agent
          .map((group) => {
            if (group.agent_id !== agentId) return group;
            const refunds = group.refunds.filter((r) => r.id !== refundId);
            return { ...group, refunds, overdue_count: refunds.length };
          })
          .filter((group) => group.refunds.length > 0);

        return {
          total_overdue: byAgent.reduce((sum, g) => sum + g.refunds.length, 0),
          agents_affected: byAgent.length,
          by_agent: byAgent,
        };
      });

      return { previous };
    },

    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(REFUND_ALERTS_QUERY_KEY, context.previous);
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: REFUND_ALERTS_QUERY_KEY });
      // Métricas/auditoria/motivos passam a contar este registro como concluído
      queryClient.invalidateQueries({ queryKey: ["dashboard", "refunds"] });
    },
  });
}
