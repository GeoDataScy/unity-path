import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ServiceItem = {
  id: string;
  client_email: string;
  service_date: string;
  product: string;
  platform: string | null;
  channel: string | null;
  status: string;
  created_at: string | null;
  has_tracking_code: boolean;
  contact_reason: string | null;
  user_id: string;
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

export function useMyServicesQuery(enabled: boolean, isSupervisor = false) {
  return useQuery({
    queryKey: ["services", "me", isSupervisor ? "supervisor" : "self"],
    enabled,
    queryFn: async (): Promise<ServiceItem[]> => {
      const userId = await requireSessionUserId();
      const PAGE = 1000;
      const all: ServiceItem[] = [];
      let from = 0;
      while (true) {
        let query = supabase
          .from("services")
          .select("id, client_email, service_date, product, platform, channel, status, created_at, has_tracking_code, contact_reason, user_id")
          .order("created_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (!isSupervisor) {
          query = query.eq("user_id", userId);
        }
        const { data, error } = await query;
        if (error) throw error;
        const rows = (data ?? []) as ServiceItem[];
        all.push(...rows);
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      return all;
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
