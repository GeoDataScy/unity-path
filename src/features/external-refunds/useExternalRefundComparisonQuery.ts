import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type {
  DivergenceFilter,
  ExternalRefundComparison,
  ImportExternalRefundsInput,
  ImportExternalRefundsResult,
} from "./types";

// As RPCs do comparativo ainda não estão nos tipos gerados do Supabase.
const rpc = supabase.rpc.bind(supabase) as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export const EXTERNAL_REFUNDS_KEY = ["dashboard", "external-refunds"] as const;

/**
 * Plataforma do export importado. O arquivo externo é da Cartpanda, então o
 * lado interno é restrito a refunds.sales_platform = Cartpanda — sem isso o
 * interno (que registra todas as plataformas) infla a diferença.
 */
export const EXTERNAL_PLATFORM = "Cartpanda";

type Params = {
  enabled?: boolean;
  /** YYYY-MM-DD */
  from: string;
  /** YYYY-MM-DD */
  to: string;
  product: string; // 'all' | nome do produto
  divergenceFilter: DivergenceFilter;
  page: number; // 1-based
  pageSize: number;
};

async function requireSession() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session) throw new Error("Sessão inválida");
  return session;
}

/**
 * Números do comparativo interno × loja. Os dados só mudam quando a gestora
 * importa um arquivo, então não há polling: a mutation de import invalida a chave.
 */
export function useExternalRefundComparisonQuery({
  enabled = true,
  from,
  to,
  product,
  divergenceFilter,
  page,
  pageSize,
}: Params) {
  return useQuery({
    queryKey: [
      ...EXTERNAL_REFUNDS_KEY,
      "comparison",
      { from, to, product, divergenceFilter, page, pageSize, platform: EXTERNAL_PLATFORM },
    ],
    enabled,
    queryFn: async (): Promise<ExternalRefundComparison> => {
      await requireSession();
      const { data, error } = await rpc("dashboard_external_refund_comparison", {
        from_date: from,
        to_date: to,
        product_filter: product === "all" ? null : product,
        divergence_filter: divergenceFilter,
        page_size: pageSize,
        page_offset: (page - 1) * pageSize,
        platform_filter: EXTERNAL_PLATFORM,
      });
      if (error) throw error;
      return data as ExternalRefundComparison;
    },
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useDeleteExternalRefundsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { product: string; monthRef?: string }): Promise<{ deleted: number }> => {
      const { data, error } = await rpc("manager_delete_external_refunds", {
        p_product: input.product,
        p_month_ref: input.monthRef ?? null,
      });
      if (error) throw error;
      return data as { deleted: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: EXTERNAL_REFUNDS_KEY });
    },
  });
}

export function useImportExternalRefundsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ImportExternalRefundsInput): Promise<ImportExternalRefundsResult> => {
      const { data, error } = await rpc("manager_import_external_refunds", {
        p_product: input.product,
        p_month_ref: input.monthRef,
        p_source_file: input.sourceFile,
        p_rows: input.rows,
      });
      if (error) throw error;
      return data as ImportExternalRefundsResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: EXTERNAL_REFUNDS_KEY });
    },
  });
}
