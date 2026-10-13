import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

// A RPC ainda não está nos tipos gerados do Supabase.
const rpc = supabase.rpc.bind(supabase) as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type XmxGroupBy = "day" | "week" | "month";

type Taxas = { refund_rate: number | null; chargeback_rate: number | null };

export type XmxSistema = {
  kpis: {
    orders: number;
    gross_usd: number;
    ticket_usd: number | null;
    refunds: number;
    refunds_total: number;
    refunds_parcial: number;
    refunds_usd: number;
    refunds_with_amount: number;
    chargebacks: number;
    chargebacks_usd: number;
  } & Taxas;
  /** Uma linha por família de plataforma, da que mais vendeu para a que menos vendeu. */
  by_platform: ({ key: string; orders: number; gross_usd: number; refunds: number; chargebacks: number } & Taxas)[];
  /** 5 países principais + "Outros" (por último). */
  countries: ({ country: string; orders: number; gross_usd: number; refunds: number; chargebacks: number } & Taxas)[];
  /** bucket = YYYY-MM-DD do início do dia/semana/mês (horário de SP). */
  sales_series: { bucket: string; key: string; orders: number; gross_usd: number }[];
  refunds_series: { bucket: string; key: string; count: number }[];
  chargebacks_series: { bucket: string; key: string; count: number }[];
  /** Taxas por período de COMPRA: dos pedidos vendidos no período, quantos já viraram reembolso/chargeback. */
  rates_series: ({ bucket: string; orders: number } & Taxas)[];
  refund_reasons: { reason: string; count: number; pct: number }[];
  refunds_without_reason: number;
  refund_days: { bucket: string; count: number }[];
  refund_days_median: number | null;
  /** Famílias com dado, para o filtro (não dependem dele). */
  platforms: string[];
  group_by: XmxGroupBy;
  sync: { last_sync_at: string | null; last_status: string | null; ready: boolean | null } | null;
};

type Params = { from: string; to: string; groupBy: XmxGroupBy; platform: string };

/**
 * Página "Sistema XMX" (RPC `dashboard_xmx_sistema`): vendas, reembolsos e
 * chargebacks do banco de vendas da XMX. Os dados chegam por sincronização a
 * cada 15 min, então reler a cada 5 min basta.
 */
export function useXmxSistemaQuery({ from, to, groupBy, platform }: Params) {
  return useQuery({
    queryKey: ["dashboard", "xmx-sistema", { from, to, groupBy, platform }],
    queryFn: async (): Promise<XmxSistema> => {
      const { data, error } = await rpc("dashboard_xmx_sistema", {
        from_date: from,
        to_date: to,
        group_by: groupBy,
        platform_filter: platform,
      });
      if (error) throw error;
      return data as XmxSistema;
    },
    enabled: Boolean(from && to),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
}
