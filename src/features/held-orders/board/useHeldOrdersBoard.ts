// Pedidos em Espera — consultas da tela da gestora (/dashboard/pedidos-espera).
//
// A lista vem paginada e filtrada do banco (manager_held_orders_page) e os
// números da equipe vêm de uma consulta leve (manager_held_orders_team). As duas
// se atualizam sozinhas a cada minuto: é isso que faz os números dos agentes
// andarem sem a gestora recarregar a página. A aba antiga baixava o histórico
// inteiro (~4 MB) uma única vez.
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { HeldOrderAgentStatus, ManagerHeldOrder } from "../types";

// As RPCs de pedidos em espera ainda não estão nos tipos gerados do Supabase.
const rpc = supabase.rpc.bind(supabase) as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

/**
 * Onde o pedido está, do ponto de vista da gestora. Cada pedido cai em um só:
 * sem agente → novo → em andamento → inativo | concluído.
 */
export type HeldOrderBucket = "sem_agente" | "novo" | "andamento" | "inativo" | "concluido";

export const HELD_ORDER_BUCKETS: HeldOrderBucket[] = ["sem_agente", "novo", "andamento", "inativo", "concluido"];

export const HELD_ORDER_BUCKET_LABEL: Record<HeldOrderBucket, string> = {
  sem_agente: "Sem agente",
  novo: "Novo",
  andamento: "Em andamento",
  inativo: "Inativo",
  concluido: "Concluído",
};

/** Cor do ponto de cada status (tokens do design system). */
export const HELD_ORDER_BUCKET_DOT: Record<HeldOrderBucket, string> = {
  sem_agente: "bg-ink-tertiary",
  novo: "bg-info",
  andamento: "bg-status-in-progress",
  inativo: "bg-warning",
  concluido: "bg-success",
};

/** Por qual data o período filtra. */
export type HeldOrderDateField = "entrada" | "pedido";

export type HeldOrdersBoardFilters = {
  status: HeldOrderBucket | null;
  agentId: string | null;
  search: string;
  product: string | null;
  dateField: HeldOrderDateField;
  /** YYYY-MM-DD (já validadas) ou null. */
  from: string | null;
  to: string | null;
};

export type HeldOrdersBoardRow = ManagerHeldOrder & {
  bucket: HeldOrderBucket;
  /** Mesma chave de cliente do banco (held_order_client_key). */
  client_key: string;
};

export type HeldOrdersBoardPage = {
  /** Pedidos com todos os filtros (inclusive o status). */
  total: number;
  /** Quantos pedidos em cada status, com todos os filtros menos o status. */
  counts: Record<HeldOrderBucket, number>;
  /** Pedidos ainda em aberto que o período deixou de fora. */
  open_outside_period: number;
  products: { code: string; count: number }[];
  rows: HeldOrdersBoardRow[];
};

export type HeldOrdersTeamAgent = {
  agent_id: string;
  full_name: string | null;
  is_active: boolean;
  fila: number;
  andamento: number;
  inativo: number;
  /** Concluídos + inativados hoje (meta de Pedidos em Espera). */
  done_today: number;
  last_event_at: string | null;
};

export type HeldOrdersTeam = {
  goal: number;
  agents: HeldOrdersTeamAgent[];
  today: {
    imported: number;
    started: number;
    done: number;
    concluded: number;
    inactive_alerts: number;
  };
};

export type HeldOrderSelectable = { id: string; client_key: string };

/** Prefixo das chaves da tela da gestora. Importar/distribuir já invalidam ele. */
export const HELD_ORDERS_BOARD_KEY = ["dashboard", "held-orders"] as const;

// Cadência das telas da gestora: 1 minuto, e na volta de foco. O intervalo só
// corre com a aba visível (refetchIntervalInBackground é false por padrão).
const REFRESH_MS = 60_000;

function pageArgs(f: HeldOrdersBoardFilters, limit: number | null, offset: number, idsOnly = false) {
  return {
    p_status: f.status,
    p_agent_id: f.agentId,
    p_search: f.search.trim() || null,
    p_product: f.product,
    p_date_field: f.dateField,
    p_from: f.from,
    p_to: f.to,
    p_limit: limit,
    p_offset: offset,
    p_ids_only: idsOnly,
  };
}

const EMPTY_COUNTS: Record<HeldOrderBucket, number> = {
  sem_agente: 0,
  novo: 0,
  andamento: 0,
  inativo: 0,
  concluido: 0,
};

function normalizePage(data: unknown): HeldOrdersBoardPage {
  const raw = (data ?? {}) as Partial<HeldOrdersBoardPage>;
  return {
    total: Number(raw.total ?? 0),
    counts: { ...EMPTY_COUNTS, ...(raw.counts ?? {}) },
    open_outside_period: Number(raw.open_outside_period ?? 0),
    products: Array.isArray(raw.products) ? raw.products : [],
    rows: Array.isArray(raw.rows) ? raw.rows : [],
  };
}

export function useHeldOrdersBoardPage(filters: HeldOrdersBoardFilters, page: number, pageSize: number) {
  return useQuery({
    queryKey: [...HELD_ORDERS_BOARD_KEY, "board", filters, page, pageSize],
    queryFn: async () => {
      const { data, error } = await rpc(
        "manager_held_orders_page",
        pageArgs(filters, pageSize, (page - 1) * pageSize),
      );
      if (error) throw error;
      return normalizePage(data);
    },
    // Troca de página/filtro mantém a tabela anterior na tela até a nova chegar.
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useHeldOrdersTeam() {
  return useQuery({
    queryKey: [...HELD_ORDERS_BOARD_KEY, "team"],
    queryFn: async (): Promise<HeldOrdersTeam> => {
      const { data, error } = await rpc("manager_held_orders_team");
      if (error) throw error;
      const raw = (data ?? {}) as Partial<HeldOrdersTeam>;
      return {
        goal: Number(raw.goal ?? 30),
        agents: Array.isArray(raw.agents) ? raw.agents : [],
        today: {
          imported: 0,
          started: 0,
          done: 0,
          concluded: 0,
          inactive_alerts: 0,
          ...(raw.today ?? {}),
        },
      };
    },
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

/** Todos os pedidos do filtro, sem paginar — para a planilha. */
export async function fetchAllHeldOrdersForExport(filters: HeldOrdersBoardFilters): Promise<HeldOrdersBoardRow[]> {
  const { data, error } = await rpc("manager_held_orders_page", pageArgs(filters, null, 0));
  if (error) throw error;
  return normalizePage(data).rows;
}

/** Os primeiros N pedidos distribuíveis do filtro (null = todos), na ordem da lista. */
export async function fetchSelectableHeldOrders(
  filters: HeldOrdersBoardFilters,
  limit: number | null,
): Promise<HeldOrderSelectable[]> {
  const { data, error } = await rpc("manager_held_orders_page", pageArgs(filters, limit, 0, true));
  if (error) throw error;
  return Array.isArray(data) ? (data as HeldOrderSelectable[]) : [];
}

/** O agente consegue atuar no pedido (não está encerrado). */
export function heldOrderIsOpen(o: { agent_status: HeldOrderAgentStatus }): boolean {
  return o.agent_status !== "concluido";
}
