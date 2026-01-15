import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ServiceItem = {
  id: string;
  client_email: string;
  service_date: string;
  product: string;
  created_at: string | null;
};

async function requireSessionUserId(): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) throw error;
  if (!session?.user?.id) throw new Error("Sessão inválida");
  return session.user.id;
}

export function useMyServicesQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["services", "me"],
    enabled,
    queryFn: async (): Promise<ServiceItem[]> => {
      // RLS already restricts visibility, but we still filter explicitly.
      const userId = await requireSessionUserId();

      const { data, error } = await supabase
        .from("services")
        .select("id, client_email, service_date, product, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as ServiceItem[];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
