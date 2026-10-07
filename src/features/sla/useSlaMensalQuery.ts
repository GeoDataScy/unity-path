import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { parseSlaMensal, type SlaMensal } from "./types";

/** Mês em curso (ou qualquer mês) do próprio prestador. `month` = YYYY-MM-01. */
export function useSlaMensalQuery(params: { enabled: boolean; month: string; userId?: string }) {
  const { enabled, month, userId } = params;
  return useQuery({
    queryKey: ["sla", "mensal", { month, userId: userId ?? null }],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<SlaMensal> => {
      const { data, error } = await supabase.rpc("sla_mensal", {
        p_month: month,
        ...(userId ? { p_user_id: userId } : {}),
      });
      if (error) throw error;
      return parseSlaMensal(data);
    },
  });
}
