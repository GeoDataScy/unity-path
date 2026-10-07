import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { parseSlaRelatorio, type SlaRelatorio } from "./types";

/** Relatório de mês fechado. Antes do 3º dia útil vem `disponivel: false`. */
export function useSlaRelatorioQuery(params: { enabled: boolean; month: string; userId?: string }) {
  const { enabled, month, userId } = params;
  return useQuery({
    queryKey: ["sla", "relatorio", { month, userId: userId ?? null }],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SlaRelatorio> => {
      const { data, error } = await supabase.rpc("sla_relatorio_mensal", {
        p_month: month,
        ...(userId ? { p_user_id: userId } : {}),
      });
      if (error) throw error;
      return parseSlaRelatorio(data);
    },
  });
}
