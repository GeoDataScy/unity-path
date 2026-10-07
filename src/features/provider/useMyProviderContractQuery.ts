import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type ProviderContract = {
  razao_social: string | null;
  cnpj: string | null;
  contrato_numero: string | null;
  pacote_nome: string | null;
  capacidade_dia_util: number;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
};

/** Sem linha em provider_contracts o contrato vale a capacidade padrão. */
export const CAPACIDADE_PADRAO = 100;

/**
 * Contrato do próprio prestador (provider_contracts). A RLS só devolve a linha
 * de quem está logado; sem linha, volta null e a tela mostra os placeholders.
 */
export function useMyProviderContractQuery(userId: string | null) {
  return useQuery({
    queryKey: ["provider", "contract", "me", userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ProviderContract | null> => {
      const { data, error } = await supabase
        .from("provider_contracts")
        .select("razao_social, cnpj, contrato_numero, pacote_nome, capacidade_dia_util, vigencia_inicio, vigencia_fim")
        .eq("user_id", userId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
