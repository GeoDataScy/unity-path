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
  current_owner_id: string;
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

// Janela default para a tabela "Meus Atendimentos Recentes". Agentes ativos
// acumulam milhares de tickets — carregar tudo a cada refetch trava a UI por
// vários segundos. 30 dias cobre 99% do dia-a-dia; busca por e-mail mais antigo
// usa a RPC find_ticket_by_email no momento do registro.
const DEFAULT_DAYS_BACK = 30;

function cutoffDateISO(daysBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export function useMyServicesQuery(enabled: boolean, canViewAllTickets = false, daysBack = DEFAULT_DAYS_BACK) {
  const cutoff = cutoffDateISO(daysBack);

  return useQuery({
    queryKey: ["services", "me", canViewAllTickets ? "all" : "self", cutoff],
    enabled,
    queryFn: async (): Promise<ServiceItem[]> => {
      const userId = await requireSessionUserId();
      const PAGE = 1000;
      const all: ServiceItem[] = [];
      let from = 0;
      while (true) {
        let query = supabase
          .from("services")
          .select("id, client_email, service_date, product, platform, channel, status, created_at, has_tracking_code, contact_reason, user_id, current_owner_id")
          // service_date é text mas armazena ISO "YYYY-MM-DD..." — comparação lexicográfica funciona.
          .gte("service_date", cutoff)
          .order("created_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (!canViewAllTickets) {
          // current_owner_id = quem está atendendo agora (muda quando manager redistribui).
          // user_id = criador imutável, preservado para crédito histórico em métricas.
          query = query.eq("current_owner_id", userId);
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
