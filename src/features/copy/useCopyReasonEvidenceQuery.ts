import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { CopyReasonEvidence } from "@/features/copy/types";

type Params = {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  /** Motivo selecionado; null fecha a query (drill-down desativado). */
  category: string | null;
  product?: string;
  platform?: string;
  channel?: string;
  maxRows?: number;
};

export function useCopyReasonEvidenceQuery({
  from,
  to,
  category,
  product = "all",
  platform = "all",
  channel = "all",
  maxRows = 25,
}: Params) {
  return useQuery({
    queryKey: ["copy", "reason-evidence", { from, to, category, product, platform, channel, maxRows }],
    enabled: Boolean(category),
    queryFn: async (): Promise<CopyReasonEvidence> => {
      const { data, error } = await supabase.rpc("copy_refund_reason_evidence", {
        from_date: from,
        to_date: to,
        reason_category: category as string,
        product_filter: product,
        platform_filter: platform,
        channel_filter: channel,
        max_rows: maxRows,
      });

      if (error) throw error;
      return data as unknown as CopyReasonEvidence;
    },
    staleTime: 5 * 60_000,
  });
}
