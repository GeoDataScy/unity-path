import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/** Aderência à Base de Suporte lançada pela gestora (apuração da Imperium). */
export function useSlaAderenciaQuery(params: { enabled: boolean; month: string; userId: string | null }) {
  const { enabled, month, userId } = params;
  return useQuery({
    queryKey: ["sla", "aderencia", { month, userId }],
    enabled: enabled && Boolean(userId),
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await supabase
        .from("sla_aderencia_mensal")
        .select("pct")
        .eq("user_id", userId as string)
        .eq("mes", month)
        .maybeSingle();
      if (error) throw error;
      return data ? Number(data.pct) : null;
    },
  });
}
