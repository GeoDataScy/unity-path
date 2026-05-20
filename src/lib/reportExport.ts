import * as XLSX from "xlsx";

import { supabase } from "@/integrations/supabase/client";
import { CONTACT_REASONS } from "@/features/services/contact-reasons";

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
