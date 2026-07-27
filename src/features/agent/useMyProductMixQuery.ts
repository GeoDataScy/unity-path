import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type ProductMixItem = {
  name: string;
  value: number;
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

export function useMyProductMixQuery(params: { enabled: boolean; from: string; to: string; topN?: number }) {
  const { enabled, from, to, topN = 10 } = params;

  return useQuery({
    queryKey: ["agent", "product-mix", { from, to, topN }],
    enabled,
    queryFn: async (): Promise<ProductMixItem[]> => {
      await requireSession();

      // NOTE: types.ts may not yet include this RPC, so we intentionally loosen typing here.
      const { data, error } = await (supabase as any).rpc("agent_product_mix", {
        from_date: from,
        to_date: to,
        top_n: topN,
      });

      if (error) throw error;
      return (data ?? []) as ProductMixItem[];
    },
    refetchOnWindowFocus: true,
  });
}
