import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DashboardServiceRow = {
  id: string;
  client_email: string;
  service_date: string;
  product: string;
  created_at: string | null;
  user_id: string;
  profiles: {
    full_name: string | null;
  } | null;
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

type Params = {
  enabled: boolean;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  agentId?: string; // optional user_id filter
};

export function useDashboardServicesQuery({ enabled, from, to, agentId }: Params) {
  return useQuery({
    queryKey: ["dashboard", "services", { from, to, agentId: agentId ?? "all" }],
    enabled,
    queryFn: async (): Promise<DashboardServiceRow[]> => {
      await requireSession();

      let q = supabase
        .from("services")
        .select("id, client_email, service_date, product, created_at, user_id, profiles(full_name)")
        .gte("service_date", from)
        .lte("service_date", to)
        .order("service_date", { ascending: false });

      if (agentId) q = q.eq("user_id", agentId);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as DashboardServiceRow[];
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}
