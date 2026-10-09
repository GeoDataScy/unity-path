import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

// A RPC ainda não está nos tipos gerados do Supabase.
const rpc = supabase.rpc.bind(supabase) as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type XmxGroupBy = "day" | "week" | "month";

export type XmxRefunds = {
  /** Uma entrada por família de plataforma, da maior para a menor. */
  distribution: { key: string; count: number; total: number; parcial: number; pct: number }[];
  /** bucket = YYYY-MM-DD do início do dia/semana/mês (horário de SP). */
  series: { bucket: string; key: string; count: number }[];
  total: number;
  kinds: { total: number; parcial: number };
  /** Famílias com reembolso no período, para o filtro (não dependem dele). */
  platforms: string[];
  group_by: XmxGroupBy;
  last_sync_at: string | null;
  last_status: string | null;
  backfill_done: boolean | null;
};

type Params = { from: string; to: string; groupBy: XmxGroupBy; platform: string };

/**
 * Reembolsos do sistema de vendas da XMX (RPC `dashboard_xmx_refunds`). Os dados
 * chegam por sincronização a cada 15 min, então reler a cada 5 min basta.
 */
export function useXmxRefundsQuery({ from, to, groupBy, platform }: Params) {
  return useQuery({
    queryKey: ["dashboard", "xmx-refunds", { from, to, groupBy, platform }],
    queryFn: async (): Promise<XmxRefunds> => {
      const { data, error } = await rpc("dashboard_xmx_refunds", {
        from_date: from,
        to_date: to,
        group_by: groupBy,
        platform_filter: platform,
      });
      if (error) throw error;
      return data as XmxRefunds;
    },
    enabled: Boolean(from && to),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}
