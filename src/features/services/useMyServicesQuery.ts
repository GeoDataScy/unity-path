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
  contact_reason_note: string | null;
  user_id: string;
  current_owner_id: string;
};

// Janela default para "Meus Atendimentos Recentes". 30 dias é o cap operacional
// — carregar tudo em agentes ativos travava a UI. A janela considera tanto a
// data de criação do ticket quanto a última interação, garantindo que tickets
// antigos redistribuídos pelo gestor apareçam ao receber novo follow-up.
const DEFAULT_DAYS_BACK = 30;

export function useMyServicesQuery(enabled: boolean, _canViewAllTickets = false, daysBack = DEFAULT_DAYS_BACK) {
  return useQuery({
    queryKey: ["services", "me", daysBack],
    enabled,
    queryFn: async (): Promise<ServiceItem[]> => {
      // canViewAllTickets é resolvido server-side pela RPC (lê profiles.role
      // e profiles.can_view_all_tickets do JWT), então o segundo parâmetro
      // do hook fica apenas como marcador legado para callers existentes.
      const { data, error } = await supabase.rpc("my_recent_services", {
        p_days_back: daysBack,
      });
      if (error) throw error;
      return (data ?? []) as ServiceItem[];
    },
    // staleTime > 0 evita re-buscar a lista inteira a cada foco da janela: o
    // refetchOnWindowFocus só dispara quando os dados estão "velhos" (>30s).
    // Mutações (novo atendimento/follow-up) invalidam a query e refazem na hora,
    // então a frescura em ações do próprio agente é preservada.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
