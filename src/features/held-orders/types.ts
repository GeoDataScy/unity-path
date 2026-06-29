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

/** Uma entrada do histórico (timeline) de um pedido. */
export type HeldOrderEvent = {
  id: string;
  status: HeldOrderAgentStatus;
  note: string;
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
};

/** Resultado da distribuição em lote (manager_distribute_held_orders). */
export type DistributeHeldOrdersResult = {
  moved: number;
  by_agent: { agent_id: string; full_name: string | null; count: number }[];
};

export type HeldOrderAgentSummary = {
  agent_id: string;
  full_name: string | null;
  pending: number;
  confirmed: number;
};

export type ManagerHeldOrdersResult = {
  total: number;
  rows: ManagerHeldOrder[];
  summary_by_agent: HeldOrderAgentSummary[];
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
