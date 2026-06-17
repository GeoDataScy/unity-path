// Pedidos em Espera (On-Hold Orders) — tipos compartilhados.
// A tabela/RPCs ainda não estão nos tipos gerados do Supabase; as chamadas rpc()
// usam cast e estes tipos descrevem o shape de retorno.

export type HeldOrderStatus = "pending" | "confirmed";

/** Pedido como retornado para o AGENTE (my_held_orders). */
export type MyHeldOrder = {
  id: string;
  dyna_code: string;
  order_number: string;
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
  status: HeldOrderStatus;
  confirmed_at: string | null;
};

/** Pedido como retornado para o MANAGER (manager_list_held_orders.rows). */
export type ManagerHeldOrder = MyHeldOrder & {
  source_file: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  imported_at: string | null;
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
  dyna_code: string;
  order_number: string;
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
  source_file?: string;
};
