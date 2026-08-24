// Pedidos em Espera (On-Hold Orders) — tipos compartilhados.
// A tabela/RPCs ainda não estão nos tipos gerados do Supabase; as chamadas rpc()
// usam cast e estes tipos descrevem o shape de retorno.

export type HeldOrderStatus = "pending" | "confirmed";

/** Status que o AGENTE gerencia (3 estados). Distinto de `status` (legado, lido pelo manager). */
export type HeldOrderAgentStatus = "novo" | "em_andamento" | "concluido";

export const HELD_ORDER_AGENT_STATUS_LABEL: Record<HeldOrderAgentStatus, string> = {
  novo: "Novo",
  em_andamento: "Em Andamento",
  concluido: "Concluído",
};

/**
 * Tag de pendência: por que o pedido ainda não foi concluído. Opcional (null =
 * sem pendência) e sempre limpa ao concluir. Serve para o agente não esquecer
 * casos que dependem de terceiros.
 */
export type HeldOrderPendingTag =
  | "pedido_nao_encontrado"
  | "aguardando_cliente"
  | "aguardando_transportadora"
  | "outra";

export const HELD_ORDER_PENDING_TAG_LABEL: Record<HeldOrderPendingTag, string> = {
  pedido_nao_encontrado: "Pedido não encontrado",
  aguardando_cliente: "Aguardando cliente",
  aguardando_transportadora: "Aguardando transportadora",
  outra: "Outra pendência",
};

/** Texto de apoio exibido na seleção da tag, para o agente escolher certo. */
export const HELD_ORDER_PENDING_TAG_HINT: Record<HeldOrderPendingTag, string> = {
  pedido_nao_encontrado: "Não localizei o pedido do cliente",
  aguardando_cliente: "Cliente ainda não respondeu à confirmação de endereço",
  aguardando_transportadora: "Aguardando retorno da transportadora",
  outra: "Outra pendência operacional (detalhe na observação)",
};

export const HELD_ORDER_PENDING_TAGS = Object.keys(
  HELD_ORDER_PENDING_TAG_LABEL,
) as HeldOrderPendingTag[];

/**
 * Filtro de status da listagem do MANAGER (manager_list_held_orders.status_filter).
 * "aguardando" = pendente que ninguém começou; "em_andamento" = já em atendimento.
 */
export type ManagerHeldOrderStatusFilter = "all" | "aguardando" | "em_andamento" | "confirmed";

/**
 * Rótulos do filtro de status na visão da GESTORA — é este o vocabulário em que a
 * operação pede os relatórios ("todos os Aguardando atendimento", "todos os
 * Concluídos"), e não o `agent_status` cru.
 */
export const MANAGER_HELD_ORDER_STATUS_FILTER_LABEL: Record<ManagerHeldOrderStatusFilter, string> = {
  all: "Todos os status",
  aguardando: "Aguardando atendimento",
  em_andamento: "Em andamento",
  confirmed: "Concluído",
};

/** O agente já começou a tratar o pedido (e ainda não concluiu). */
export function heldOrderIsInProgress(
  o: Pick<ManagerHeldOrder, "agent_status" | "status">,
): boolean {
  return o.agent_status === "em_andamento" && o.status !== "confirmed";
}

/**
 * Em qual balde do filtro de status o pedido cai. Mesma regra do
 * `status_filter` do RPC, para o relatório usar o rótulo que a gestora escolheu.
 */
export function heldOrderStatusBucketLabel(
  o: Pick<ManagerHeldOrder, "agent_status" | "status">,
): string {
  if (o.status === "confirmed" || o.agent_status === "concluido") {
    return MANAGER_HELD_ORDER_STATUS_FILTER_LABEL.confirmed;
  }
  if (heldOrderIsInProgress(o)) return MANAGER_HELD_ORDER_STATUS_FILTER_LABEL.em_andamento;
  return MANAGER_HELD_ORDER_STATUS_FILTER_LABEL.aguardando;
}

/**
 * Texto do badge de status da tela da gestora — o mesmo que vai para a coluna
 * "Status" do relatório, para a planilha não contar uma história diferente da
 * tabela:
 *   linha repetida       -> "Repetido"
 *   concluído            -> "Confirmado"
 *   em atendimento       -> "Em andamento"
 *   nunca distribuído    -> "Novo"        (assign_count = 0)
 *   distribuído N vezes  -> "Pendente N"  (assign_count >= 1, sem início)
 */
export function heldOrderManagerStatusLabel(
  o: Pick<ManagerHeldOrder, "agent_status" | "status" | "assign_count" | "duplicate_of">,
): string {
  if (o.duplicate_of) return "Repetido";
  if (o.agent_status === "concluido" || o.status === "confirmed") return "Confirmado";
  if (heldOrderIsInProgress(o)) return "Em andamento";
  if ((o.assign_count ?? 0) === 0) return "Novo";
  return `Pendente ${o.assign_count}`;
}

/** Uma entrada do histórico (timeline) de um pedido. */
export type HeldOrderEvent = {
  id: string;
  status: HeldOrderAgentStatus;
  note: string;
  pending_tag: HeldOrderPendingTag | null;
  recorded_at: string;
  user_name: string | null;
};

/** Pedido como retornado para o AGENTE (my_held_orders). */
export type MyHeldOrder = {
  id: string;
  dyna_code: string;
  order_number: string | null;
  merged_orders: string | null;
  reason: string | null;
  order_date: string | null;
  email: string | null;
  customer_name: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  street1: string | null;
  street2: string | null;
  street3: string | null;
  age: string | null;
  items: string | null;
  // Campos do formato de devoluções (Returned Shipments); nulos para On Holds.
  rma: string | null;
  restocked_items: string | null;
  damaged_items: string | null;
  comments: string | null;
  status: HeldOrderStatus;
  agent_status: HeldOrderAgentStatus;
  pending_tag: HeldOrderPendingTag | null;
  confirmed_at: string | null;
  event_count: number;
};

/** Pedido como retornado para o MANAGER (manager_list_held_orders.rows). */
export type ManagerHeldOrder = MyHeldOrder & {
  source_file: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  imported_at: string | null;
  /** Quantas vezes o pedido já foi distribuído. 0 = "Novo"; N>=1 = "Pendente N". */
  assign_count: number;
  /**
   * Linha repetida do mesmo pedido (aponta para a linha mantida). Só existe em
   * dados anteriores a 05/08/2026: hoje a repetição é barrada no import. Fica na
   * listagem da gestora para auditoria, mas fora da caixa e da carga do agente.
   */
  duplicate_of: string | null;
};

/** Resultado da distribuição em lote (manager_distribute_held_orders). */
export type DistributeHeldOrdersResult = {
  moved: number;
  by_agent: { agent_id: string; full_name: string | null; count: number }[];
  /** Pedidos que foram para o agente que já atendia aquele cliente, em vez do round-robin. */
  kept_with_owner: number;
  /** Pedidos fora da seleção movidos para manter o cliente com um único agente. */
  pulled_siblings: number;
};

export type HeldOrderAgentSummary = {
  agent_id: string;
  full_name: string | null;
  /** Tudo que ainda não foi concluído (inclui os em andamento). */
  pending: number;
  /** Subconjunto de `pending` que o agente já começou a tratar. */
  in_progress: number;
  confirmed: number;
};

export type ManagerHeldOrdersResult = {
  total: number;
  /** Quantas das linhas listadas são repetição consolidada de outro pedido. */
  duplicates: number;
  rows: ManagerHeldOrder[];
  /** Carga real por agente — já exclui as linhas repetidas. */
  summary_by_agent: HeldOrderAgentSummary[];
};

/**
 * Resultado do import (manager_import_held_orders). Repetição de pedido que já
 * está em aberto não entra, e a gestora precisa VER isso — foi o silêncio da
 * dedupe antiga que causou o problema de 23/06/2026.
 */
export type ImportHeldOrdersResult = {
  total: number;
  inserted: number;
  /** Linhas ignoradas por já haver aquele pedido em aberto (ou repetidas no lote). */
  duplicates: number;
  /** Linhas sem nenhum dado aproveitável. */
  empty_rows: number;
  /** Amostra (até 20) dos números de pedido ignorados. */
  duplicate_orders: string[];
  /** duplicates + empty_rows. Mantido para o bundle antigo ainda cacheado. */
  skipped: number;
};

export type HeldOrdersDailyMetrics = {
  confirmed_today: number;
  pending: number;
  goal: number;
};

/** Uma linha do CSV já normalizada para o RPC de import. */
export type HeldOrderImportRow = {
  dyna_code?: string;
  order_number?: string;
  merged_orders?: string;
  reason?: string;
  order_date?: string;
  email?: string;
  name?: string;
  city?: string;
  street1?: string;
  street2?: string;
  street3?: string;
  state?: string;
  country?: string;
  postal_code?: string;
  age?: string;
  items?: string;
  rma?: string;
  restocked_items?: string;
  damaged_items?: string;
  comments?: string;
  source_file?: string;
};
