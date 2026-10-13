import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

// Ajuste 6 do Jurídico: a exportação completa (com e-mail e order ID) é só para
// quem tem role manager (can_export_full_client_data() no banco). A trava de
// verdade está no banco; aqui só decide se o botão aparece habilitado. Qualquer
// erro (inclusive a função ainda não existir no banco) conta como "sem permissão".
export function useCanExportFullClientData(enabled = true) {
  return useQuery({
    queryKey: ["can-export-full-client-data"],
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("can_export_full_client_data");
      if (error) return false;
      return Boolean(data);
    },
  });
}

export const FULL_EXPORT_UNAVAILABLE = "Indisponível no perfil de prestador";
