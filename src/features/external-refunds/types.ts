// Comparativo de reembolsos: base interna (refunds) × export das lojas
// (tabela external_refunds). Tipos espelham o jsonb das RPCs
// manager_import_external_refunds e dashboard_external_refund_comparison
// (supabase/migrations/20260911120000_reembolsos_externos_comparativo.sql).

/** Uma linha do CSV "orders_export" já normalizada para o RPC de import. */
export type ExternalRefundImportRow = {
  /** YYYY-MM-DD (o arquivo vem como YYYY/DD/MM). */
  order_date: string;
  /** '#1896' como vem da loja. */
  order_name: string;
  address?: string;
  address2?: string;
  zip?: string;
  city?: string;
  province?: string;
  product_count?: string;
  product_id?: string;
  variant_id?: string;
  full_name?: string;
  mobile_no?: string;
  shipping_method?: string;
  status?: string;
  refund_amount?: string;
  payment_status?: string;
  tracking_code?: string;
  product_name?: string;
  variant_name?: string;
  /** Valor original da coluna Date, para auditoria. */
  raw_date?: string;
};

/** Plataformas de venda com export de reembolso. Mesmas grafias de refunds.sales_platform. */
export const EXTERNAL_PLATFORMS = ["Cartpanda", "Buygoods", "PagAmerican"] as const;
export type ExternalPlatform = (typeof EXTERNAL_PLATFORMS)[number];
export const DEFAULT_PLATFORM: ExternalPlatform = "Cartpanda";

export type ImportExternalRefundsInput = {
  platform: ExternalPlatform;
  product: string;
  /** Primeiro dia do mês do arquivo, YYYY-MM-DD. */
  monthRef: string;
  sourceFile: string;
  rows: ExternalRefundImportRow[];
};

export type ImportExternalRefundsResult = {
  total: number;
  valid: number;
  inserted: number;
  updated: number;
  skipped: number;
  skipped_samples: Array<{ order_name: string | null; order_date: string | null; payment_status: string | null }>;
  orders: number;
};

export type ExternalRefundKind = "ambos" | "externo" | "interno";
export type DivergenceFilter = "all" | ExternalRefundKind | "tipo";

export type ComparisonSummary = {
  from_date: string;
  to_date: string;
  product_filter: string | null;
  platform_filter: string | null;
  internal_count: number;
  internal_only: number;
  internal_without_order: number;
  external_count: number;
  external_only: number;
  matched_count: number;
  external_full: number;
  external_partial: number;
  external_amount: number;
  /** total - interno, com piso em 0. */
  external_diff: number;
  /** interno / total. null quando não há total importado no período. */
  internal_pct: number | null;
  /** 100 - internal_pct, com piso em 0. Soma 100 com internal_pct por construção. */
  external_pct: number | null;
  /** interno maior que o total importado: o período precisa ser reimportado. */
  inconsistent: boolean;
  type_mismatch_count: number;
};

export type ComparisonProductRow = {
  product: string;
  internal_count: number;
  internal_only: number;
  internal_open: number;
  internal_without_order: number;
  external_count: number;
  external_only: number;
  matched_count: number;
  external_full: number;
  external_partial: number;
  external_amount: number;
  external_diff: number;
  internal_pct: number | null;
  external_pct: number | null;
  inconsistent: boolean;
};

export type ComparisonProductMonthRow = ComparisonProductRow & {
  /** YYYY-MM */
  month: string;
};

export type ComparisonImportBatch = {
  platform: string;
  product: string;
  month_ref: string;
  source_file: string;
  rows: number;
  orders: number;
  imported_at: string;
};

export type DivergenceRow = {
  kind: ExternalRefundKind;
  product: string;
  order_number: string | null;
  order_name: string | null;
  internal_order_id: string | null;
  external_date: string | null;
  internal_request_date: string | null;
  internal_completion_date: string | null;
  payment_status: string | null;
  external_status: string | null;
  refund_amount: number | null;
  refund_type: string | null;
  refund_value: number | null;
  sales_platform: string | null;
  channel: string | null;
  customer_name: string | null;
  customer_email: string | null;
  agent_name: string | null;
  type_mismatch: boolean;
};

export type ExternalRefundComparison = {
  summary: ComparisonSummary;
  products: Array<{ product: string; external_orders: number }>;
  imports: ComparisonImportBatch[];
  by_product_month: ComparisonProductMonthRow[];
  by_product: ComparisonProductRow[];
  divergences: { total_count: number; rows: DivergenceRow[] };
};

export const KIND_LABEL: Record<ExternalRefundKind, string> = {
  ambos: "Nos dois",
  externo: "Só externo",
  interno: "Só interno",
};

const MONTH_NAMES = [
  "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez",
];

/** '2026-07' ou '2026-07-01' → 'jul/2026'. */
export function fmtMonth(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})/.exec(value);
  if (!m) return value;
  const idx = Number(m[2]) - 1;
  return `${MONTH_NAMES[idx] ?? m[2]}/${m[1]}`;
}

export function fmtInt(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString("pt-BR");
}

export function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "—";
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

/** Valores dos reembolsos externos vêm em dólar. */
export function fmtUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `US$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' sem passar por Date (evita fuso). */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}
