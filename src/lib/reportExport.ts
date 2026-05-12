import * as XLSX from "xlsx";

import { supabase } from "@/integrations/supabase/client";

type SheetSpec = {
  name: string;
  title: string;
  columns: string[];
};

// Sheets populated from the database. Keep keys in sync with `populateSheets`.
const POPULATED_SHEETS: Record<"visaoGeral" | "porCanal" | "statusTickets", SheetSpec> = {
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
};

// Sheets that remain as template (no data yet — populated in future iterations).
const TEMPLATE_SHEETS: SheetSpec[] = [
  {
    name: "Motivos de Contato",
    title: "Motivos de contato por canal",
    columns: ["Canal", "Motivo", "Quantidade"],
  },
  {
    name: "Reembolsos - Resumo",
    title: "Resumo de reembolsos",
    columns: ["Métrica", "Valor"],
  },
  {
    name: "Ranking % Reembolso Parcial",
    title: "Ranking dos percentuais de reembolso parcial mais aceitos",
    columns: ["Percentual", "Quantidade", "% do total"],
  },
  {
    name: "Reembolsos por Produto",
    title: "Reembolsos por produto",
    columns: ["Produto", "Quantidade"],
  },
  {
    name: "Reembolsos por Plataforma",
    title: "Reembolsos por plataforma",
    columns: ["Plataforma", "Quantidade"],
  },
  {
    name: "Motivos de Reembolso",
    title: "Motivos de reembolso por produto",
    columns: ["Produto", "Motivo", "Quantidade"],
  },
  {
    name: "Valores - Resumo",
    title: "Valores financeiros de reembolsos",
    columns: ["Tipo", "Valor (R$)"],
  },
  {
    name: "Valores por Canal",
    title: "Valor de reembolso por canal de atendimento",
    columns: ["Canal", "Valor (R$)"],
  },
  {
    name: "Valores por Produto",
    title: "Valor de reembolso por produto",
    columns: ["Produto", "Valor (R$)"],
  },
];

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

function formatBrDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function buildSheet(spec: SheetSpec, fromISO: string, toISO: string, dataRows: (string | number)[][] = []): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    [spec.title],
    [`Período: ${formatBrDate(fromISO)} até ${formatBrDate(toISO)}`],
    [],
    spec.columns,
    ...dataRows,
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

  const [metricsRes, statusRes] = await Promise.all([
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
  ]);

  if (metricsRes.error) throw metricsRes.error;
  if (statusRes.error) throw statusRes.error;

  const metrics = metricsRes.data as unknown as DashboardMetricsResponse;
  const status = statusRes.data as unknown as StatusSummaryResponse;

  return { metrics, status };
}

export async function exportManagerReport(
  fromISO: string,
  toISO: string,
  agentId?: string,
): Promise<void> {
  const { metrics, status } = await fetchReportData(fromISO, toISO, agentId);

  const wb = XLSX.utils.book_new();

  // 1) Visão Geral da Operação
  const totalAtendimentos = metrics.total_count ?? 0;
  const byChannel = metrics.by_channel ?? [];
  const novos = status.novo ?? 0;
  const emAndamento = status.em_andamento ?? 0;
  const concluidos = status.concluido ?? 0;

  const visaoGeralRows: (string | number)[][] = [
    ["Total de atendimentos realizados pelo time", totalAtendimentos],
    ["Tickets novos", novos],
    ["Tickets em andamento", emAndamento],
    ["Tickets finalizados", concluidos],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    buildSheet(POPULATED_SHEETS.visaoGeral, fromISO, toISO, visaoGeralRows),
    POPULATED_SHEETS.visaoGeral.name,
  );

  // 2) Atendimentos por Canal
  const porCanalRows: (string | number)[][] = byChannel.length > 0
    ? byChannel.map((c) => [c.name ?? "Não informado", c.value ?? 0])
    : [["Sem registros no período", 0]];
  XLSX.utils.book_append_sheet(
    wb,
    buildSheet(POPULATED_SHEETS.porCanal, fromISO, toISO, porCanalRows),
    POPULATED_SHEETS.porCanal.name,
  );

  // 3) Status dos Tickets
  const statusRows: (string | number)[][] = [
    ["Novos", novos],
    ["Em andamento", emAndamento],
    ["Finalizados", concluidos],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    buildSheet(POPULATED_SHEETS.statusTickets, fromISO, toISO, statusRows),
    POPULATED_SHEETS.statusTickets.name,
  );

  // 4..N) Sheets que ainda serão populadas em iterações futuras — mantemos o
  // template (título + período + cabeçalho) para o gestor enxergar a estrutura.
  for (const spec of TEMPLATE_SHEETS) {
    XLSX.utils.book_append_sheet(wb, buildSheet(spec, fromISO, toISO), spec.name);
  }

  const fileName = `relatorio-suporte_${fromISO}_a_${toISO}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
