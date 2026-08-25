// Radar — estado do servidor (TanStack Query).
//
// Duas queries de propósitos bem diferentes:
//   * useMyRadarQuery      -> a tela: casos + contadores, numa única chamada
//   * useRadarBadgeQuery   -> o badge da sidebar: só os contadores, barato,
//                             porque a sidebar fica montada em toda a área do agente
//
// Toda mutação invalida as duas + a timeline do caso tocado. Sem polling: com
// `staleTime` de 30s do QueryClient e invalidação explícita, o número do badge
// acompanha as ações do próprio agente sem gerar tráfego de fundo (ver o
// incidente de sobrecarga de 24/07 registrado em App.tsx).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { toError } from "@/lib/supabaseError";
import type {
  MyRadarResult,
  RadarBadgeSummary,
  RadarEvent,
  RadarKind,
  RadarStatus,
} from "./types";

// As RPCs do Radar ainda não estão nos tipos gerados do Supabase.
const rpc = supabase.rpc.bind(supabase) as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

const RADAR_KEY = ["radar"] as const;
const RADAR_ITEMS_KEY = ["radar", "items"] as const;
const RADAR_BADGE_KEY = ["radar", "badge"] as const;
const RADAR_EVENTS_KEY = ["radar", "events"] as const;

const EMPTY_RESULT: MyRadarResult = {
  today: "",
  items: [],
  summary: { open: 0, overdue: 0, due_today: 0, due_week: 0, resolved: 0, cancelled: 0 },
};

/** Casos do agente logado + contadores já somados no banco. */
export function useMyRadarQuery(enabled: boolean) {
  return useQuery({
    queryKey: RADAR_ITEMS_KEY,
    enabled,
    queryFn: async (): Promise<MyRadarResult> => {
      const { data, error } = await rpc("my_radar_items");
      if (error) throw toError(error, "Não foi possível carregar o Radar.");
      return (data as MyRadarResult) ?? EMPTY_RESULT;
    },
  });
}

/** Contadores do badge da sidebar. */
export function useRadarBadgeQuery(enabled: boolean) {
  return useQuery({
    queryKey: RADAR_BADGE_KEY,
    enabled,
    queryFn: async (): Promise<RadarBadgeSummary> => {
      const { data, error } = await rpc("my_radar_summary");
      if (error) throw toError(error, "Não foi possível carregar o Radar.");
      return (data as RadarBadgeSummary) ?? { open: 0, overdue: 0, due_today: 0 };
    },
  });
}

/** Timeline de um caso — carregada só quando o detalhe abre. */
export function useRadarEventsQuery(itemId: string | null) {
  return useQuery({
    queryKey: [...RADAR_EVENTS_KEY, itemId],
    enabled: Boolean(itemId),
    queryFn: async (): Promise<RadarEvent[]> => {
      const { data, error } = await rpc("radar_item_events", { p_item_id: itemId });
      if (error) throw toError(error, "Não foi possível carregar o histórico do caso.");
      return (data as RadarEvent[]) ?? [];
    },
  });
}

export type RadarItemInput = {
  clientEmail: string;
  orderNumber: string;
  product: string;
  kind: RadarKind;
  actionNeeded: string;
  /** 'YYYY-MM-DD' — só usado na criação; depois muda registrando uma ação. */
  nextFollowUpDate: string;
  notes: string;
};

function useInvalidateRadar() {
  const qc = useQueryClient();
  return (itemId?: string) => {
    qc.invalidateQueries({ queryKey: RADAR_ITEMS_KEY });
    qc.invalidateQueries({ queryKey: RADAR_BADGE_KEY });
    if (itemId) qc.invalidateQueries({ queryKey: [...RADAR_EVENTS_KEY, itemId] });
  };
}

/** Abre um caso novo. O agente responsável e a data de criação saem do servidor. */
export function useCreateRadarItemMutation() {
  const invalidate = useInvalidateRadar();
  return useMutation({
    mutationFn: async (input: RadarItemInput): Promise<string> => {
      const { data, error } = await rpc("radar_create_item", {
        p_client_email: input.clientEmail,
        p_kind: input.kind,
        p_action_needed: input.actionNeeded,
        p_next_follow_up_date: input.nextFollowUpDate,
        p_order_number: input.orderNumber || null,
        p_product: input.product || null,
        p_notes: input.notes,
      });
      if (error) throw toError(error, "Não foi possível registrar o caso.");
      return data as string;
    },
    onSuccess: () => invalidate(),
  });
}

/** Corrige o cadastro do caso (não mexe em status nem na data). */
export function useUpdateRadarItemMutation() {
  const invalidate = useInvalidateRadar();
  return useMutation({
    mutationFn: async (params: { itemId: string; input: RadarItemInput }) => {
      const { error } = await rpc("radar_update_item", {
        p_item_id: params.itemId,
        p_client_email: params.input.clientEmail,
        p_kind: params.input.kind,
        p_action_needed: params.input.actionNeeded,
        p_order_number: params.input.orderNumber || null,
        p_product: params.input.product || null,
        p_notes: params.input.notes,
      });
      if (error) throw toError(error, "Não foi possível salvar as alterações.");
    },
    onSuccess: (_data, params) => invalidate(params.itemId),
  });
}

/**
 * Registra uma ação: grava o que foi feito, muda o status e (re)define a data do
 * próximo acompanhamento. `nextFollowUpDate` deve vir nulo quando o status fecha
 * o caso — o banco recusa a combinação errada.
 */
export function useRegisterRadarActionMutation() {
  const invalidate = useInvalidateRadar();
  return useMutation({
    mutationFn: async (params: {
      itemId: string;
      status: RadarStatus;
      action: string;
      nextFollowUpDate: string | null;
    }) => {
      const { error } = await rpc("radar_register_action", {
        p_item_id: params.itemId,
        p_status: params.status,
        p_action: params.action,
        p_next_follow_up_date: params.nextFollowUpDate,
      });
      if (error) throw toError(error, "Não foi possível registrar a ação.");
    },
    onSuccess: (_data, params) => invalidate(params.itemId),
  });
}

export function useDeleteRadarItemMutation() {
  const invalidate = useInvalidateRadar();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await rpc("radar_delete_item", { p_item_id: itemId });
      if (error) throw toError(error, "Não foi possível excluir o caso.");
    },
    onSuccess: () => invalidate(),
  });
}

export { RADAR_KEY };
