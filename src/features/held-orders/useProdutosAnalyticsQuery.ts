import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { ProdutosHeldOrdersAnalytics } from "./analytics";

// A RPC ainda não está nos tipos gerados do Supabase (mesmo padrão de
// useManagerHeldOrdersQuery).
const rpc = supabase.rpc.bind(supabase) as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export const PRODUTOS_ANALYTICS_KEY = ["produtos", "held-orders", "analytics"] as const;

/** Janelas oferecidas na tela. 90 dias é o padrão: pega um trimestre inteiro. */
export const JANELAS_DISPONIVEIS = [30, 90, 180] as const;
export type JanelaDias = (typeof JANELAS_DISPONIVEIS)[number];

export function useProdutosAnalyticsQuery(janelaDias: JanelaDias = 90) {
  return useQuery({
    queryKey: [...PRODUTOS_ANALYTICS_KEY, janelaDias],
    queryFn: async (): Promise<ProdutosHeldOrdersAnalytics> => {
      const { data, error } = await rpc("produtos_held_orders_analytics", {
        janela_dias: janelaDias,
      });
      if (error) throw error;
      return data as ProdutosHeldOrdersAnalytics;
    },
    // A fila muda por lote diário, não a cada minuto: manter fresco por 5 min
    // evita refetch à toa numa RPC que varre held_orders inteira.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
