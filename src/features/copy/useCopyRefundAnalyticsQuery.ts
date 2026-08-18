import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { CopyRefundAnalytics } from "@/features/copy/types";

type Params = {
  enabled?: boolean;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  product?: string; // 'all' | nome
  platform?: string; // 'all' | nome
  channel?: string; // 'all' | nome
};

export function useCopyRefundAnalyticsQuery({
  enabled = true,
  from,
  to,
  product = "all",
  platform = "all",
  channel = "all",
}: Params) {
  return useQuery({
    queryKey: ["copy", "refund-analytics", { from, to, product, platform, channel }],
    enabled,
    queryFn: async (): Promise<CopyRefundAnalytics> => {
      const { data, error } = await supabase.rpc("copy_refund_reason_analytics", {
        from_date: from,
        to_date: to,
        product_filter: product,
        platform_filter: platform,
        channel_filter: channel,
      });

      if (error) throw error;
      return data as unknown as CopyRefundAnalytics;
    },
    // Motivo só muda quando alguém dá baixa em reembolso — não é tela de tempo
    // real. Sem refetchInterval de propósito: o banco é instância pequena.
    staleTime: 5 * 60_000,
  });
}
