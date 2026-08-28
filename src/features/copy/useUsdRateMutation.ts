import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

// `app_settings` ainda não está nos tipos gerados do Supabase — mesma saída da
// Base de Suporte: cliente sem schema tipado só para esta gravação.
const db = supabase as unknown as SupabaseClient;

/**
 * Grava a cotação usada para converter os valores da tela do copy em dólar.
 * Só a gestora passa na RLS; o `select().single()` existe para o UPDATE barrado
 * por policy virar erro visível em vez de sucesso com zero linhas.
 */
export function useUsdRateMutation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (rate: number) => {
      const { data, error } = await db
        .from("app_settings")
        .update({ value: String(rate) })
        .eq("key", "usd_brl_rate")
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    // A cotação entra em todo valor da tela: invalida a analítica inteira.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copy"] }),
  });
}
