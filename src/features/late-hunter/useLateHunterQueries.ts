import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type {
  LateHunterAmbiente,
  LateHunterEvento,
  LateHunterFiltros,
  LateHunterListResult,
  LateHunterOverview,
} from "./types";

// As RPCs do Late Hunter ainda não estão nos tipos gerados do Supabase.
const rpc = supabase.rpc.bind(supabase) as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

const KEY = ["produtos", "late-hunter"] as const;

// Chega um lote a cada varredura do Late Hunter (7x por dia, de 3 em 3 h).
// Reler a cada 5 min com a aba em foco basta para quem deixa a tela aberta ver
// a varredura entrar.
const REFRESH_MS = 5 * 60_000;

export function useLateHunterOverviewQuery(ambiente: LateHunterAmbiente) {
  return useQuery({
    queryKey: [...KEY, "overview", ambiente],
    queryFn: async (): Promise<LateHunterOverview> => {
      const { data, error } = await rpc("late_hunter_overview", { p_ambiente: ambiente });
      if (error) throw error;
      return data as LateHunterOverview;
    },
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

/** Parâmetros da RPC a partir dos filtros da tela. */
export function listArgs(
  ambiente: LateHunterAmbiente,
  filtros: LateHunterFiltros,
  limite: number,
  offset: number,
): Record<string, unknown> {
  return {
    p_ambiente: ambiente,
    p_situacao: filtros.situacao,
    p_motivos: filtros.motivos.length ? filtros.motivos : null,
    p_lojas: filtros.lojas.length ? filtros.lojas : null,
    p_paises: filtros.paises.length ? filtros.paises : null,
    p_dias_min: filtros.diasMin,
    p_dias_max: filtros.diasMax,
    p_data_de: filtros.dataDe,
    p_data_ate: filtros.dataAte,
    p_reabertos: filtros.reabertos,
    p_busca: filtros.busca.trim() || null,
    p_ordem: filtros.ordem,
    p_limite: limite,
    p_offset: offset,
  };
}

export async function fetchLateHunterList(args: Record<string, unknown>): Promise<LateHunterListResult> {
  const { data, error } = await rpc("late_hunter_list", args);
  if (error) throw error;
  return (data as LateHunterListResult) ?? { total: 0, rows: [] };
}

export function useLateHunterListQuery(
  ambiente: LateHunterAmbiente,
  filtros: LateHunterFiltros,
  pagina: number,
  porPagina: number,
) {
  const args = listArgs(ambiente, filtros, porPagina, (pagina - 1) * porPagina);
  return useQuery({
    queryKey: [...KEY, "list", args],
    queryFn: () => fetchLateHunterList(args),
    // Trocar de página/filtro não pisca a tabela vazia enquanto a próxima chega.
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useLateHunterHistoryQuery(orderId: number | null) {
  return useQuery({
    queryKey: [...KEY, "history", orderId],
    enabled: orderId != null,
    queryFn: async (): Promise<LateHunterEvento[]> => {
      const { data, error } = await rpc("late_hunter_order_history", { p_order_id: orderId });
      if (error) throw error;
      return (data as LateHunterEvento[]) ?? [];
    },
  });
}
