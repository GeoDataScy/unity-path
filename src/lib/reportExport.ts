import * as XLSX from "xlsx";

import { supabase } from "@/integrations/supabase/client";
import { CONTACT_REASONS } from "@/features/services/contact-reasons";
import type { DashboardRefundReasonDetailRow } from "@/features/dashboard/useDashboardRefundReasonDetailQuery";

type SheetSpec = {
  name: string;
  title: string;
  columns: string[];
};

const SHEET_SPECS = {
  visaoGeral: {
    name: "Visão Geral",
    title: "Visão Geral da Operação",
    columns: ["Métrica", "Valor"],
  },
  porCanal: {
    name: "Atendimentos por Canal",
    title: "Total de atendimentos por canal",
    columns: ["Canal", "Quantidade"],
  },
  statusTickets: {
    name: "Status dos Tickets",
    title: "Tickets novos / em andamento / finalizados",
    columns: ["Status", "Quantidade"],
  },
  motivosContato: {
    name: "Motivos de Contato",
    title: "Motivos de contato por canal",
    columns: ["Canal", "Motivo", "Quantidade"],
  },
  reembolsosResumo: {
    name: "Reembolsos - Resumo",
    title: "Resumo de reembolsos",
    columns: ["Métrica", "Valor"],
  },
  rankingParcial: {
    name: "Ranking % Reembolso Parcial",
    title: "Ranking dos percentuais de reembolso parcial mais aceitos",
    columns: ["Percentual", "Quantidade", "% do total parcial"],
  },
  reembolsosProduto: {
    name: "Reembolsos por Produto",
    title: "Reembolsos por produto",
    columns: ["Produto", "Quantidade"],
  },
  reembolsosPlataforma: {
    name: "Reembolsos por Plataforma",
    title: "Reembolsos por plataforma",
    columns: ["Plataforma", "Quantidade"],
  },
  motivosReembolso: {
    name: "Motivos de Reembolso",
    title: "Motivos de reembolso por produto",
    columns: ["Produto", "Motivo", "Quantidade"],
  },
  valoresResumo: {
    name: "Valores - Resumo",
    title: "Valores financeiros de reembolsos",
    columns: ["Tipo", "Valor (R$)"],
  },
  valoresCanal: {
    name: "Valores por Canal",
    title: "Valor de reembolso por canal de atendimento",
    columns: ["Canal", "Valor (R$)"],
  },
  valoresProduto: {
    name: "Valores por Produto",
    title: "Valor de reembolso por produto",
    columns: ["Produto", "Valor (R$)"],
  },
} as const satisfies Record<string, SheetSpec>;

type NameValue = { name: string; value: number };

type DashboardMetricsResponse = {
  total_count: number;
  by_channel: NameValue[];
};

type StatusSummaryResponse = {
  novo: number;
  em_andamento: number;
  concluido: number;
};

type RefundMetricsResponse = {
  by_product: NameValue[];
  by_platform: NameValue[];
};

type ExportExtrasResponse = {
  contact_reasons_by_channel: Array<{ channel: string; reason_code: string; qty: number }>;
  refund_summary: {
    total_count: number;
    open_count: number;
    done_count: number;
    partial_count: number;
    full_count: number;
  };
  refund_partial_ranking: Array<{ refund_type: string; qty: number }>;
  refund_values_summary: {
    partial_value_sum: number;
    full_value_sum: number;
    total_value_sum: number;
  };
  refund_values_by_channel: Array<{ channel: string; value: number }>;
  refund_values_by_product: Array<{ product: string; value: number }>;
  refund_reasons_by_product: Array<{ product: string; reason: string; qty: number }>;
};

const EMPTY_PLACEHOLDER = "Sem registros no período";

function formatBrDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function formatBrCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function reasonLabel(code: string): string {
  if (code === "nao_informado") return "Não informado";
  return CONTACT_REASONS.find((r) => r.code === code)?.label ?? code;
}

function buildSheet(
  spec: SheetSpec,
  fromISO: string,
  toISO: string,
  dataRows: (string | number)[][] = [],
): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    [spec.title],
    [`Período: ${formatBrDate(fromISO)} até ${formatBrDate(toISO)}`],
    [],
    spec.columns,
    ...(dataRows.length > 0
      ? dataRows
      : [[EMPTY_PLACEHOLDER, ...spec.columns.slice(1).map(() => 0 as string | number)]]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);

  const colCount = spec.columns.length;
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, colCount - 1) } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(0, colCount - 1) } },
  ];

  ws["!cols"] = spec.columns.map(() => ({ wch: 28 }));

  return ws;
}

async function fetchReportData(fromISO: string, toISO: string, agentId?: string) {
  const normalizedAgentId = agentId && agentId !== "all" ? agentId : null;

  const [metricsRes, statusRes, refundMetricsRes, extrasRes] = await Promise.all([
    supabase.rpc("dashboard_metrics", {
      from_date: fromISO,
      to_date: toISO,
      agent_id: normalizedAgentId,
    }),
    supabase.rpc("dashboard_status_summary", {
      from_date: fromISO,
      to_date: toISO,
      agent_id: normalizedAgentId ?? undefined,
    }),
    supabase.rpc("dashboard_refund_metrics", {
      from_date: fromISO,
      to_date: toISO,
      agent_id: normalizedAgentId,
      status_filter: "all",
      refund_type_filter: "all",
      product_filter: "all",
    }),
    supabase.rpc("dashboard_export_extras", {
      from_date: fromISO,
      to_date: toISO,
      agent_id: normalizedAgentId,
    }),
  ]);

  if (metricsRes.error) throw metricsRes.error;
  if (statusRes.error) throw statusRes.error;
  if (refundMetricsRes.error) throw refundMetricsRes.error;
  if (extrasRes.error) throw extrasRes.error;

  return {
    metrics: metricsRes.data as unknown as DashboardMetricsResponse,
    status: statusRes.data as unknown as StatusSummaryResponse,
    refundMetrics: refundMetricsRes.data as unknown as RefundMetricsResponse,
    extras: extrasRes.data as unknown as ExportExtrasResponse,
  };
}

export async function exportManagerReport(
  fromISO: string,
  toISO: string,
  agentId?: string,
): Promise<void> {
  const { metrics, status, refundMetrics, extras } = await fetchReportData(fromISO, toISO, agentId);

  const wb = XLSX.utils.book_new();

  const appendSheet = (spec: SheetSpec, rows: (string | number)[][]) =>
    XLSX.utils.book_append_sheet(wb, buildSheet(spec, fromISO, toISO, rows), spec.name);

  // 1) Visão Geral
  const totalAtendimentos = metrics.total_count ?? 0;
  const byChannel = metrics.by_channel ?? [];
  const novos = status.novo ?? 0;
  const emAndamento = status.em_andamento ?? 0;
  const concluidos = status.concluido ?? 0;

  appendSheet(SHEET_SPECS.visaoGeral, [
    ["Total de atendimentos realizados pelo time", totalAtendimentos],
    ["Tickets novos", novos],
    ["Tickets em andamento", emAndamento],
    ["Tickets finalizados", concluidos],
  ]);

  // 2) Atendimentos por Canal
  appendSheet(
    SHEET_SPECS.porCanal,
    byChannel.map((c) => [c.name ?? "Não informado", c.value ?? 0]),
  );

  // 3) Status dos Tickets
  appendSheet(SHEET_SPECS.statusTickets, [
    ["Novos", novos],
    ["Em andamento", emAndamento],
    ["Finalizados", concluidos],
  ]);

  // 4) Motivos de Contato (canal × motivo)
  appendSheet(
    SHEET_SPECS.motivosContato,
    (extras.contact_reasons_by_channel ?? []).map((row) => [
      row.channel,
      reasonLabel(row.reason_code),
      row.qty,
    ]),
  );

  // 5) Reembolsos - Resumo
  const rs = extras.refund_summary;
  const totalRefunds = rs?.total_count ?? 0;
  const partialCount = rs?.partial_count ?? 0;
  const fullCount = rs?.full_count ?? 0;
  const doneCount = rs?.done_count ?? 0;
  const partialPctOfDone = doneCount > 0 ? (partialCount / doneCount) * 100 : 0;

  appendSheet(SHEET_SPECS.reembolsosResumo, [
    ["Total de reembolsos (período)", totalRefunds],
    ["Reembolsos em aberto", rs?.open_count ?? 0],
    ["Reembolsos concluídos", doneCount],
    ["Reembolsos parciais (<100%)", partialCount],
    ["Reembolsos totais (100%)", fullCount],
    ["% Parciais sobre concluídos", `${partialPctOfDone.toFixed(1)}%`],
  ]);

  // 6) Ranking % Reembolso Parcial
  const ranking = extras.refund_partial_ranking ?? [];
  const totalPartialForRanking = ranking.reduce((sum, x) => sum + (x.qty ?? 0), 0);
  appendSheet(
    SHEET_SPECS.rankingParcial,
    ranking.map((row) => {
      const pct = totalPartialForRanking > 0 ? (row.qty / totalPartialForRanking) * 100 : 0;
      return [row.refund_type, row.qty, `${pct.toFixed(1)}%`];
    }),
  );

  // 7) Reembolsos por Produto
  appendSheet(
    SHEET_SPECS.reembolsosProduto,
    (refundMetrics.by_product ?? []).map((row) => [row.name ?? "Não informado", row.value ?? 0]),
  );

  // 8) Reembolsos por Plataforma
  appendSheet(
    SHEET_SPECS.reembolsosPlataforma,
    (refundMetrics.by_platform ?? []).map((row) => [row.name ?? "Não informado", row.value ?? 0]),
  );

  // 9) Motivos de Reembolso (produto × motivo)
  appendSheet(
    SHEET_SPECS.motivosReembolso,
    (extras.refund_reasons_by_product ?? []).map((row) => [row.product, row.reason, row.qty]),
  );

  // 10) Valores - Resumo
  const vs = extras.refund_values_summary;
  appendSheet(SHEET_SPECS.valoresResumo, [
    ["Total geral de reembolsos", formatBrCurrency(vs?.total_value_sum ?? 0)],
    ["Total de reembolsos parciais (<100%)", formatBrCurrency(vs?.partial_value_sum ?? 0)],
    ["Total de reembolsos totais (100%)", formatBrCurrency(vs?.full_value_sum ?? 0)],
  ]);

  // 11) Valores por Canal
  appendSheet(
    SHEET_SPECS.valoresCanal,
    (extras.refund_values_by_channel ?? []).map((row) => [row.channel, formatBrCurrency(row.value ?? 0)]),
  );

  // 12) Valores por Produto
  appendSheet(
    SHEET_SPECS.valoresProduto,
    (extras.refund_values_by_product ?? []).map((row) => [row.product, formatBrCurrency(row.value ?? 0)]),
  );

  const fileName = `relatorio-suporte_${fromISO}_a_${toISO}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

// ── Relatório do drill-down de "Motivos de reembolso" ───────────────────────────

type RefundReasonDetailResponse = {
  total_count: number;
  rows: DashboardRefundReasonDetailRow[];
};

// Aceita 'YYYY-MM-DD' ou timestamp ISO completo; devolve dd/MM/yyyy.
function formatBrDateLoose(value: string | null): string {
  if (!value) return "";
  const [y, m, d] = value.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : value;
}

// Remove caracteres inválidos para nome de arquivo (ex.: "/" em "Indicação médica / efeitos colaterais").
function safeFileSegment(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export type RefundReasonExportParams = {
  reasonCategory: string;
  fromISO: string;
  toISO: string;
  agentId?: string;
  status?: "all" | "open" | "done";
  refundType?: string;
  product?: string;
};

// Busca TODAS as linhas da categoria (paginando o RPC, máx. 200/página) e gera o .xlsx
// com exatamente as colunas mostradas na tabela do modal.
export async function exportRefundReasonDetail(params: RefundReasonExportParams): Promise<number> {
  const { reasonCategory, fromISO, toISO, agentId, status = "all", refundType = "all", product = "all" } = params;

  const pageSize = 200;
  let offset = 0;
  let total = Infinity;
  const all: DashboardRefundReasonDetailRow[] = [];

  while (offset < total) {
    const { data, error } = await supabase.rpc("dashboard_refund_reason_detail", {
      from_date: fromISO,
      to_date: toISO,
      reason_category: reasonCategory,
      agent_id: agentId && agentId !== "all" ? agentId : null,
      status_filter: status,
      refund_type_filter: refundType,
      product_filter: product,
      page_size: pageSize,
      page_offset: offset,
    });

    if (error) throw error;

    const res = data as unknown as RefundReasonDetailResponse;
    total = res.total_count ?? 0;
    const rows = res.rows ?? [];
    all.push(...rows);
    if (rows.length === 0) break;
    offset += rows.length;
  }

  const columns = [
    "Solicitação",
    "Conclusão",
    "Agente",
    "E-mail",
    "Produto",
    "Loja",
    "Pedido",
    "Canal",
    "Tipo",
    "Valor (R$)",
    "Motivo original",
  ];

  const dataRows: (string | number)[][] = all.map((r) => [
    formatBrDateLoose(r.request_date),
    r.completion_date ? formatBrDateLoose(r.completion_date) : "Em aberto",
    r.profiles?.full_name ?? "—",
    r.customer_email ?? "",
    r.product ?? "—",
    r.sales_platform ?? "",
    r.order_id ?? "",
    r.channel ?? "—",
    r.refund_type ?? "—",
    r.refund_value ?? "",
    r.original_reason ?? "—",
  ]);

  const sheetRows: (string | number)[][] = [
    [`Motivos de reembolso — ${reasonCategory}`],
    [`Período: ${formatBrDate(fromISO)} até ${formatBrDate(toISO)}`],
    [`Total de reembolsos: ${all.length}`],
    [],
    columns,
    ...(dataRows.length > 0 ? dataRows : [[EMPTY_PLACEHOLDER, ...columns.slice(1).map(() => "")]]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: columns.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: columns.length - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: columns.length - 1 } },
  ];
  ws["!cols"] = [
    { wch: 12 }, // Solicitação
    { wch: 12 }, // Conclusão
    { wch: 22 }, // Agente
    { wch: 30 }, // E-mail
    { wch: 20 }, // Produto
    { wch: 16 }, // Loja
    { wch: 18 }, // Pedido
    { wch: 14 }, // Canal
    { wch: 10 }, // Tipo
    { wch: 12 }, // Valor
    { wch: 40 }, // Motivo original
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Reembolsos");

  const fileName = `reembolsos_${safeFileSegment(reasonCategory)}_${fromISO}_a_${toISO}.xlsx`;
  XLSX.writeFile(wb, fileName);

  return all.length;
}
