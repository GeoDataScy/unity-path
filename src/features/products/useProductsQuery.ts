import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ProductItem = {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export function useProductsQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["products", "active"],
    enabled,
    queryFn: async (): Promise<ProductItem[]> => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, is_active, created_at, updated_at")
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (error) throw error;
      return (data ?? []) as ProductItem[];
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
