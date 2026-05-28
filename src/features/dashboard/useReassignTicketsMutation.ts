import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type ReassignPair = {
  service_id: string;
  to_user_id: string;
};

export type ReassignResult = {
  moved: number;
  skipped: number;
  skipped_reasons: { service_id: string; reason: string }[];
};

export function useReassignTicketsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assignments: ReassignPair[]): Promise<ReassignResult> => {
      const { data, error } = await supabase.rpc("manager_reassign_tickets", {
        p_assignments: assignments,
      });
      if (error) throw error;
      return data as unknown as ReassignResult;
    },
    onSuccess: () => {
      // Manager-side cache: contagem em "Usuários" e listas de tickets em aberto.
      qc.invalidateQueries({ queryKey: ["dashboard", "users"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "open-tickets-by-agent"] });
      // Agent-side cache: a próxima vez que um agente abrir a app, "Meus Atendimentos"
      // e o histórico de transferências precisam refletir o movimento.
      qc.invalidateQueries({ queryKey: ["services", "me"] });
      qc.invalidateQueries({ queryKey: ["transfer_history"] });
      qc.invalidateQueries({ queryKey: ["transfer_notifications"] });
    },
  });
}
