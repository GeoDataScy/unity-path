import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Params = {
  enabled: boolean;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  agentId?: string;
  /** Valor gravado em `services.platform`; `SEM_VALOR` = ticket sem plataforma. */
  platform?: string;
  /** Valor gravado em `services.product`; `SEM_VALOR` = ticket sem produto. */
  product?: string;
  /** Canal gravado na abertura do ticket (`services.channel`): "Email" ou "SMS". */
  channel?: string;
};

/** Opção dos filtros para ticket sem valor gravado (no histórico há plataforma NULL). */
export const SEM_VALOR = "__sem__";

/** Canais do filtro "Por canal" — valores exatos de `services.channel`. */
export const CANAIS = ["Email", "SMS"];

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
  /**
   * Plataformas e produtos que aparecem nos tickets do período (abertos ou
   * concluídos nele) para o agente filtrado. Não dependem dos próprios filtros:
   * escolher uma plataforma não esvazia a lista.
   */
  platforms: string[];
  products: string[];
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
export function useDashboardDailyTicketsQuery({ enabled, from, to, agentId, platform, product, channel }: Params) {
  return useQuery({
    queryKey: [
      "dashboard",
      "daily-tickets",
      {
        from,
        to,
        agentId: agentId ?? "all",
        platform: platform ?? "all",
        product: product ?? "all",
        channel: channel ?? "all",
      },
    ],
    enabled,
    queryFn: async (): Promise<DailyTickets> => {
      await requireSession();

      const { data, error } = await supabase.rpc("dashboard_daily_tickets", {
        from_date: from,
        to_date: to,
        agent_id: agentId || null,
        platform_filter: platform || null,
        product_filter: product || null,
        channel_filter: channel || null,
      });

      if (error) throw error;
      return data as unknown as DailyTickets;
    },
    // Trocar um filtro mantém o gráfico e as opções anteriores na tela até a
    // resposta chegar — senão os selects piscam vazios a cada escolha.
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
}
