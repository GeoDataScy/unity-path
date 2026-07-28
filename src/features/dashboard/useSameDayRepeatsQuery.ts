import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Uma interação marcada: qual ticket, quem registrou e quanto tempo depois da anterior. */
export interface SameDayRepeatDetail {
  service_id: string;
  client_email: string;
  product: string | null;
  agent_name: string;
  recorded_at: string;
  previous_at: string | null;
  hours_apart: number | null;
  observation: string | null;
}

export interface SameDayRepeatByAgent {
  agent_id: string;
  agent_name: string;
  /** Quantas interações do agente furaram a regra das 18h no período. */
  repeat_count: number;
  /** Total de interações do agente no período (denominador justo). */
  total_count: number;
  /** repeat_count / total_count, já arredondado no banco. */
  pct: number;
}

export interface SameDayRepeatsData {
  /**
   * Interações além da primeira no mesmo ticket no mesmo dia (SP).
   * É este número que infla a contagem diária do gestor: 2 eventos para
   * 1 atendimento no mesmo dia.
   */
  same_day_extra: number;
  /**
   * Subconjunto que furou a regra das 18h (a que a UI diz aplicar). Menor que
   * same_day_extra porque um follow-up às 19h no mesmo dia é permitido pela
   * regra, mas ainda conta 2x no número do dia.
   */
  rule_violations: number;
  by_agent: SameDayRepeatByAgent[];
  detail: SameDayRepeatDetail[];
}

const EMPTY: SameDayRepeatsData = {
  same_day_extra: 0,
  rule_violations: 0,
  by_agent: [],
  detail: [],
};

export function useSameDayRepeatsQuery(params: {
  enabled?: boolean;
  fromISO: string;
  toISO: string;
  agentId?: string;
}) {
  const { enabled = true, fromISO, toISO, agentId } = params;

  return useQuery({
    queryKey: ["dashboard", "same-day-repeats", { fromISO, toISO, agentId: agentId ?? "all" }],
    enabled: enabled && Boolean(fromISO) && Boolean(toISO),
    queryFn: async (): Promise<SameDayRepeatsData> => {
      const { data, error } = await supabase.rpc("dashboard_same_day_repeats", {
        from_date: fromISO,
        to_date: toISO,
        agent_id: agentId && agentId !== "all" ? agentId : null,
      });
      if (error) throw error;
      const r = data as unknown as Partial<SameDayRepeatsData> | null;
      if (!r) return EMPTY;
      return {
        same_day_extra: r.same_day_extra ?? 0,
        rule_violations: r.rule_violations ?? 0,
        by_agent: r.by_agent ?? [],
        detail: r.detail ?? [],
      };
    },
  });
}
