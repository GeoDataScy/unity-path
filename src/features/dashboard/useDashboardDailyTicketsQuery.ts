import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Params = {
  enabled: boolean;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  agentId?: string;
};

export type DailyTicketsRow = {
  /** YYYY-MM-DD, dia de São Paulo. */
  day: string;
  /** Tickets ABERTOS no dia — follow-up não conta. */
  opened: number;
  /** Tickets fechados no dia, pela data do fechamento que vale hoje. */
  closed: number;
};

export type DailyTickets = {
  by_day: DailyTicketsRow[];
  total_opened: number;
  total_closed: number;
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

/**
 * Série diária de tickets abertos × concluídos (RPC `dashboard_daily_tickets`).
 * A regra inteira mora no banco — inclusive o preenchimento dos dias sem
 * movimento, para o gráfico não precisar adivinhar buraco de fim de semana.
 */
export function useDashboardDailyTicketsQuery({ enabled, from, to, agentId }: Params) {
  return useQuery({
    queryKey: ["dashboard", "daily-tickets", { from, to, agentId: agentId ?? "all" }],
    enabled,
    queryFn: async (): Promise<DailyTickets> => {
      await requireSession();

      const { data, error } = await supabase.rpc("dashboard_daily_tickets", {
        from_date: from,
        to_date: to,
        agent_id: agentId || null,
      });

      if (error) throw error;
      return data as unknown as DailyTickets;
    },
    refetchOnWindowFocus: false,
  });
}
