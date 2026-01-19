import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

async function requireSessionUserId(): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) throw error;
  if (!session?.user?.id) throw new Error("Sessão inválida");
  return session.user.id;
}

type Params = {
  enabled: boolean;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
};

async function fetchMyServicesCount(params: { userId: string; from?: string; to?: string }): Promise<number> {
  let q = supabase
    .from("services")
    .select("id", { count: "exact", head: true })
    .eq("user_id", params.userId);

  if (params.from) q = q.gte("service_date", params.from);
  if (params.to) q = q.lte("service_date", params.to);

  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export function useMyServicesCountQuery({ enabled, from, to }: Params) {
  return useQuery({
    queryKey: ["services", "me", "count", { from: from ?? "all", to: to ?? "all" }],
    enabled,
    queryFn: async () => {
      const userId = await requireSessionUserId();
      return fetchMyServicesCount({ userId, from, to });
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
