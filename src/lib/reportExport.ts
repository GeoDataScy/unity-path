import * as XLSX from "xlsx";

import { supabase } from "@/integrations/supabase/client";
import { formatContactReason } from "@/features/services/contact-reasons";
import type { DashboardRefundReasonDetailRow } from "@/features/dashboard/useDashboardRefundReasonDetailQuery";
import type {
  ChannelEfficiencyRow,
  ChannelEfficiencyTotal,
} from "@/features/dashboard/useDashboardRefundMetricsQuery";

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
    title: "Total de atendimentos por canal (abertura de ticket + cada interação)",
    columns: ["Canal", "Quantidade"],
  },
  canalDetalhamento: {
    name: "Canal — Detalhamento",
    title: "Atendimentos por Canal — Detalhamento (canal × agente)",
    columns: [
      "Canal",
      "Agente",
      "Tickets Novos",
      "Interações",
      "Concluídos",
      "Total",
      "% Conclusão",
    ],
  },
  statusTickets: {
    name: "Status dos Tickets",
    title: "Status atual dos tickets tocados no período (abertos ou com interação)",
    columns: ["Status", "Quantidade"],
  },
  motivosContato: {
    name: "Motivos de Contato",
    title: "Motivos de contato por canal (só aberturas de ticket — 1 motivo por ticket)",
    columns: ["Canal", "Motivo", "Quantidade"],
  },
  motivosDescritos: {
    name: "Motivos descritos",
    title: 'Casos descritos pelo agente (motivos "Outro" e "Reclamação VSL")',
    columns: ["Data", "Motivo", "Canal", "Produto", "E-mail do Cliente", "Descrição", "Agente"],
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
  eficienciaCanal: {
    name: "Eficiência por Canal",
    title: "Eficiência por canal (reembolsos concluídos no período)",
    columns: [
      "Canal",
      "Concluídos",
      "Parciais (<100%)",
      "% dos parciais",
      "Integrais (100%)",
      "% dos integrais",
      "Taxa conv. parcial",
      "Taxa conv. integral",
    ],
  },
  motivosReembolso: {
    name: "Motivos de Reembolso",
    title: "Motivos de reembolso por produto",
    columns: ["Produto", "Motivo", "Quantidade"],
  },
  valoresResumo: {
    name: "Valores - Resumo",
    title: "Valores financeiros de reembolsos",
    columns: ["Tipo", "Valor (US$)"],
  },
  valoresCanal: {
    name: "Valores por Canal",
    title: "Valor de reembolso por canal de atendimento",
    columns: ["Canal", "Valor (US$)"],
  },
  valoresProduto: {
    name: "Valores por Produto",
    title: "Valor de reembolso por produto",
    columns: ["Produto", "Valor (US$)"],
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
  by_channel_efficiency: ChannelEfficiencyRow[];
  channel_efficiency_total: ChannelEfficiencyTotal | null;
};

// Mesma linha devolvida por dashboard_channel_detail e consumida pelo modal
// "Atendimentos por Canal — Detalhamento" (ChannelDetailModal.tsx).
type ChannelAgentRow = {
  channel: string;
  agent_id: string;
  agent_name: string;
  new_tickets: number;
  done_count: number;
  interactions: number;
  total: number;
};

type ChannelDetailResponse = {
  by_channel_agent: ChannelAgentRow[];
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

// Um registro por ticket aberto com motivo descrito ("Outro" ou "Reclamação
// VSL") — o texto livre que o agregado por código (contact_reasons_by_channel)
// não consegue mostrar.
type ContactReasonNoteRow = {
  service_day: string;
  channel: string;
  product: string;
  client_email: string;
  reason: string;
  note: string;
  agent_name: string;
};

const EMPTY_PLACEHOLDER = "Sem registros no período";

function formatBrDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function formatPct(value: number | null | undefined): string {
  return `${(value ?? 0).toFixed(1)}%`;
}

function formatBrCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function reasonLabel(code: string, note?: string | null): string {
  return formatContactReason(code, note);
}

function buildSheet(
  spec: SheetSpec,
  fromISO: string,
  toISO: string,
  dataRows: (string | number)[][] = [],
  agentLabel = "Todos os agentes",
): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    [spec.title],
    [`Período: ${formatBrDate(fromISO)} até ${formatBrDate(toISO)} — Agente: ${agentLabel}`],
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

  const [metricsRes, statusRes, refundMetricsRes, extrasRes, channelDetailRes, reasonNotesRes] = await Promise.all([
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
    // Mesma RPC que alimenta o modal da tela — é o que garante que a aba
    // "Canal — Detalhamento" reproduza exatamente os números vistos lá.
    supabase.rpc("dashboard_channel_detail", {
      p_from_date: fromISO,
      p_to_date: toISO,
      p_agent_id: normalizedAgentId,
    }),
    supabase.rpc("dashboard_contact_reason_notes", {
      from_date: fromISO,
      to_date: toISO,
      agent_id: normalizedAgentId,
    }),
  ]);

  if (metricsRes.error) throw metricsRes.error;
  if (statusRes.error) throw statusRes.error;
  if (refundMetricsRes.error) throw refundMetricsRes.error;
  if (extrasRes.error) throw extrasRes.error;
  if (channelDetailRes.error) throw channelDetailRes.error;
  if (reasonNotesRes.error) throw reasonNotesRes.error;

  return {
    metrics: metricsRes.data as unknown as DashboardMetricsResponse,
    status: statusRes.data as unknown as StatusSummaryResponse,
    refundMetrics: refundMetricsRes.data as unknown as RefundMetricsResponse,
    extras: extrasRes.data as unknown as ExportExtrasResponse,
    channelDetail: channelDetailRes.data as unknown as ChannelDetailResponse,
    reasonNotes: (reasonNotesRes.data ?? []) as unknown as ContactReasonNoteRow[],
  };
}

export async function exportManagerReport(
  fromISO: string,
  toISO: string,
  agentId?: string,
  agentName?: string,
): Promise<void> {
  const { metrics, status, refundMetrics, extras, channelDetail, reasonNotes } =
    await fetchReportData(fromISO, toISO, agentId);

  const agentLabel = agentId && agentId !== "all" ? (agentName ?? agentId) : "Todos os agentes";

  const wb = XLSX.utils.book_new();

  const appendSheet = (spec: SheetSpec, rows: (string | number)[][]) =>
    XLSX.utils.book_append_sheet(wb, buildSheet(spec, fromISO, toISO, rows, agentLabel), spec.name);

  // 1) Visão Geral
  const totalAtendimentos = metrics.total_count ?? 0;
  const byChannel = metrics.by_channel ?? [];
  const novos = status.novo ?? 0;
  const emAndamento = status.em_andamento ?? 0;
  const concluidos = status.concluido ?? 0;

  // Reconciliação com a tela: "Total de atendimentos" conta EVENTOS (abertura de
  // ticket + cada interação), enquanto o bloco de status conta TICKETS. Sem essa
  // quebra explícita a gestora somava "Tickets novos" do Excel e não fechava com
  // a coluna "Tickets Novos" do modal — são recortes diferentes.
  const ticketsAbertos = (channelDetail?.by_channel_agent ?? []).reduce(
    (s, r) => s + (r.new_tickets ?? 0),
    0,
  );
  const interacoesPeriodo = (channelDetail?.by_channel_agent ?? []).reduce(
    (s, r) => s + (r.interactions ?? 0),
    0,
  );

  appendSheet(SHEET_SPECS.visaoGeral, [
    ["Total de atendimentos realizados pelo time", totalAtendimentos],
    ["↳ Tickets abertos no período", ticketsAbertos],
    ["↳ Interações (follow-ups) no período", interacoesPeriodo],
    ["Tickets tocados no período (abertos ou com interação)", novos + emAndamento + concluidos],
    ["↳ Novos (nenhuma interação registrada)", novos],
    ["↳ Em andamento", emAndamento],
    ["↳ Finalizados", concluidos],
  ]);

  // 2) Atendimentos por Canal
  appendSheet(
    SHEET_SPECS.porCanal,
    byChannel.map((c) => [c.name ?? "Não informado", c.value ?? 0]),
  );

  // 2b) Canal — Detalhamento (canal × agente)
  // Espelha linha a linha a tabela do modal ChannelDetailModal: uma linha de
  // total por canal (canais ordenados por Total desc) seguida das linhas de
  // cada agente daquele canal (também por Total desc). As fórmulas de
  // % Conclusão são as mesmas do componente — done/new, arredondado.
  const channelRows = channelDetail?.by_channel_agent ?? [];
  const channelNames = Array.from(new Set(channelRows.map((r) => r.channel)));

  const channelTotals = channelNames
    .map((ch) => {
      const chRows = channelRows.filter((r) => r.channel === ch);
      const newT = chRows.reduce((s, r) => s + r.new_tickets, 0);
      const inter = chRows.reduce((s, r) => s + r.interactions, 0);
      const done = chRows.reduce((s, r) => s + r.done_count, 0);
      const total = chRows.reduce((s, r) => s + r.total, 0);
      const rate = newT > 0 ? Math.round((done / newT) * 100) : 0;
      return { channel: ch, new_tickets: newT, interactions: inter, done_count: done, total, rate };
    })
    .sort((a, b) => b.total - a.total);

  const channelDetailRows: (string | number)[][] = [];
  for (const ct of channelTotals) {
    channelDetailRows.push([
      ct.channel,
      "TOTAL DO CANAL",
      ct.new_tickets,
      ct.interactions,
      ct.done_count,
      ct.total,
      ct.new_tickets > 0 ? `${ct.rate}%` : "—",
    ]);
    channelRows
      .filter((r) => r.channel === ct.channel)
      .sort((a, b) => b.total - a.total)
      .forEach((r) => {
        channelDetailRows.push([
          ct.channel,
          r.agent_name,
          r.new_tickets,
          r.interactions,
          r.done_count,
          r.total,
          r.new_tickets > 0 ? `${Math.round((r.done_count / r.new_tickets) * 100)}%` : "—",
        ]);
      });
  }

  if (channelDetailRows.length > 0) {
    const grandNew = channelTotals.reduce((s, c) => s + c.new_tickets, 0);
    const grandInter = channelTotals.reduce((s, c) => s + c.interactions, 0);
    const grandDone = channelTotals.reduce((s, c) => s + c.done_count, 0);
    const grandTotal = channelTotals.reduce((s, c) => s + c.total, 0);
    channelDetailRows.push([
      "TOTAL NO PERÍODO",
      `${channelTotals.length} canal(is)`,
      grandNew,
      grandInter,
      grandDone,
      grandTotal,
      grandNew > 0 ? `${Math.round((grandDone / grandNew) * 100)}%` : "—",
    ]);
  }

  appendSheet(SHEET_SPECS.canalDetalhamento, channelDetailRows);

  // 3) Status dos Tickets
  // Universo: tickets abertos no período OU que receberam alguma interação nele,
  // classificados pelo estado ATUAL (último follow-up). Não é o mesmo recorte da
  // coluna "Tickets Novos" do detalhamento por canal — lá só entram tickets
  // ABERTOS no período.
  appendSheet(SHEET_SPECS.statusTickets, [
    ["Novos (nenhuma interação registrada)", novos],
    ["Em andamento", emAndamento],
    ["Finalizados", concluidos],
    ["Total de tickets tocados no período", novos + emAndamento + concluidos],
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

  // 4b) Motivos descritos (texto livre)
  // A aba acima conta 'outro' e 'reclamacao_vsl' como baldes fechados; aqui a
  // gestora lê o que de fato aconteceu em cada ticket — qual caso excepcional
  // apareceu e qual promessa do anúncio o cliente cobrou.
  appendSheet(
    SHEET_SPECS.motivosDescritos,
    (reasonNotes ?? []).map((row) => [
      row.service_day ? formatBrDate(row.service_day) : "—",
      reasonLabel(row.reason ?? "nao_informado"),
      row.channel ?? "—",
      row.product ?? "—",
      row.client_email ?? "",
      row.note ?? "",
      row.agent_name ?? "—",
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

  // 8b) Eficiência por Canal — mesma leitura do card da aba Reembolsos
  const effRows = refundMetrics.by_channel_efficiency ?? [];
  const effTotal = refundMetrics.channel_efficiency_total;
  appendSheet(SHEET_SPECS.eficienciaCanal, [
    ...effRows.map((row) => [
      row.channel,
      row.total_done ?? 0,
      row.partial_count ?? 0,
      formatPct(row.partial_share),
      row.full_count ?? 0,
      formatPct(row.full_share),
      formatPct(row.partial_rate),
      formatPct(row.full_rate),
    ]),
    ...(effTotal
      ? [[
          "Todos os canais",
          effTotal.total_done ?? 0,
          effTotal.partial_count ?? 0,
          formatPct(effTotal.partial_count > 0 ? 100 : 0),
          effTotal.full_count ?? 0,
          formatPct(effTotal.full_count > 0 ? 100 : 0),
          formatPct(effTotal.partial_rate),
          formatPct(effTotal.full_rate),
        ]]
      : []),
  ]);

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
    "Valor (US$)",
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

// ── Relatório de atendimentos do agente ─────────────────────────────────────────

type ExportTicketRow = {
  id: string;
  client_email: string;
  service_date: string;
  product: string;
  platform: string | null;
  channel: string | null;
  status: string;
  created_at: string | null;
  has_tracking_code: boolean;
  contact_reason: string | null;
  contact_reason_note: string | null;
  user_id: string;
  current_owner_id: string;
  creator_name: string | null;
  owner_name: string | null;
  follow_up_count: number;
  last_interaction_at: string | null;
  last_follow_up_status: string | null;
};

type ExportFollowUpRow = {
  service_id: string;
  client_email: string;
  follow_up_number: number;
  status: string;
  observation: string | null;
  recorded_at: string;
  user_id: string;
  agent_name: string | null;
};

type ExportAgentServicesResponse = {
  tickets: ExportTicketRow[];
  follow_ups: ExportFollowUpRow[];
};

// Trata timestamps "naive" (sem timezone, ex.: "2026-03-18T19:14:02.436") como
// UTC, depois converte para São Paulo — mesmo tratamento da tela de atendimentos.
function formatBrDateTimeSP(value: string | null | undefined): string {
  if (!value) return "";
  const ts = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const dt = new Date(ts);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function serviceDateBr(value: string | null | undefined): string {
  if (!value) return "";
  const datePart = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? formatBrDate(datePart) : value;
}

function ticketStatusLabel(t: ExportTicketRow): string {
  if ((t.follow_up_count ?? 0) === 0) {
    return t.status === "concluido" ? "Concluído" : "Novo";
  }
  return t.last_follow_up_status === "concluido" ? "Concluído" : "Em Andamento";
}

function followUpStatusLabel(status: string): string {
  if (status === "concluido") return "Concluído";
  if (status === "em_andamento") return "Em andamento";
  return status;
}

export type AgentServicesExportParams = {
  fromISO: string;
  toISO: string;
};

// Gera o .xlsx com os atendimentos do agente no período (respeita a mesma regra
// de visibilidade da tela). Aba 1: um ticket por linha, com todos os campos.
// Aba 2: histórico completo de interações (abertura + follow-ups) por ticket.
// Retorna o total de tickets exportados.
export async function exportAgentServices(params: AgentServicesExportParams): Promise<number> {
  const { fromISO, toISO } = params;

  const { data, error } = await supabase.rpc("export_agent_services", {
    p_from: fromISO,
    p_to: toISO,
  });
  if (error) throw error;

  const res = (data ?? { tickets: [], follow_ups: [] }) as unknown as ExportAgentServicesResponse;
  const tickets = res.tickets ?? [];
  const followUps = res.follow_ups ?? [];

  const wb = XLSX.utils.book_new();

  // ── Aba 1: Atendimentos ───────────────────────────────────────────────────
  const ticketColumns = [
    "Data de abertura",
    "Hora",
    "E-mail do Cliente",
    "Produto",
    "Plataforma",
    "Canal",
    "Motivo de contato",
    "Cód. Rastreio",
    "Status",
    "Nº de interações",
    "Última interação",
    "Agente (criador)",
    "Dono atual",
    "ID do ticket",
  ];

  const ticketDataRows: (string | number)[][] = tickets.map((t) => [
    serviceDateBr(t.service_date),
    formatBrDateTimeSP(t.created_at).slice(11) || "—",
    t.client_email ?? "",
    t.product ?? "",
    t.platform ?? "—",
    t.channel ?? "—",
    reasonLabel(t.contact_reason ?? "nao_informado", t.contact_reason_note),
    t.has_tracking_code ? "Sim" : "Não",
    ticketStatusLabel(t),
    (t.follow_up_count ?? 0) + 1,
    t.last_interaction_at ? formatBrDateTimeSP(t.last_interaction_at) : "—",
    t.creator_name ?? "—",
    t.owner_name ?? "—",
    t.id,
  ]);

  const ticketSheetRows: (string | number)[][] = [
    ["Meus Atendimentos"],
    [`Período: ${formatBrDate(fromISO)} até ${formatBrDate(toISO)}`],
    [`Total de atendimentos: ${tickets.length}`],
    [],
    ticketColumns,
    ...(ticketDataRows.length > 0
      ? ticketDataRows
      : [[EMPTY_PLACEHOLDER, ...ticketColumns.slice(1).map(() => "")]]),
  ];

  const wsTickets = XLSX.utils.aoa_to_sheet(ticketSheetRows);
  wsTickets["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: ticketColumns.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: ticketColumns.length - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: ticketColumns.length - 1 } },
  ];
  wsTickets["!cols"] = [
    { wch: 14 }, // Data de abertura
    { wch: 8 }, // Hora
    { wch: 30 }, // E-mail
    { wch: 18 }, // Produto
    { wch: 14 }, // Plataforma
    { wch: 12 }, // Canal
    { wch: 24 }, // Motivo
    { wch: 12 }, // Cód. Rastreio
    { wch: 14 }, // Status
    { wch: 14 }, // Nº interações
    { wch: 18 }, // Última interação
    { wch: 22 }, // Agente criador
    { wch: 22 }, // Dono atual
    { wch: 38 }, // ID
  ];
  XLSX.utils.book_append_sheet(wb, wsTickets, "Atendimentos");

  // ── Aba 2: Histórico de Interações ────────────────────────────────────────
  // Reconstrói o histórico completo por ticket: a abertura conta como interação
  // #1 e cada follow-up soma +1 (mesma semântica da tela do agente).
  const followUpsByTicket = new Map<string, ExportFollowUpRow[]>();
  for (const f of followUps) {
    const list = followUpsByTicket.get(f.service_id);
    if (list) list.push(f);
    else followUpsByTicket.set(f.service_id, [f]);
  }

  const historyColumns = [
    "E-mail do Cliente",
    "Interação nº",
    "Data / Hora",
    "Status",
    "Observação",
    "Registrado por",
  ];

  const historyDataRows: (string | number)[][] = [];
  for (const t of tickets) {
    // Interação #1 = abertura do ticket
    historyDataRows.push([
      t.client_email ?? "",
      1,
      formatBrDateTimeSP(t.created_at ?? t.service_date),
      "Abertura",
      reasonLabel(t.contact_reason ?? "nao_informado", t.contact_reason_note),
      t.creator_name ?? "—",
    ]);
    const fus = (followUpsByTicket.get(t.id) ?? [])
      .slice()
      .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
    fus.forEach((f, idx) => {
      historyDataRows.push([
        t.client_email ?? "",
        idx + 2,
        formatBrDateTimeSP(f.recorded_at),
        followUpStatusLabel(f.status),
        f.observation ?? "",
        f.agent_name ?? "—",
      ]);
    });
  }

  const historySheetRows: (string | number)[][] = [
    ["Histórico de Interações"],
    [`Período: ${formatBrDate(fromISO)} até ${formatBrDate(toISO)}`],
    [`Total de interações: ${historyDataRows.length}`],
    [],
    historyColumns,
    ...(historyDataRows.length > 0
      ? historyDataRows
      : [[EMPTY_PLACEHOLDER, ...historyColumns.slice(1).map(() => "")]]),
  ];

  const wsHistory = XLSX.utils.aoa_to_sheet(historySheetRows);
  wsHistory["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: historyColumns.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: historyColumns.length - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: historyColumns.length - 1 } },
  ];
  wsHistory["!cols"] = [
    { wch: 30 }, // E-mail
    { wch: 12 }, // Interação nº
    { wch: 18 }, // Data / Hora
    { wch: 14 }, // Status
    { wch: 50 }, // Observação
    { wch: 22 }, // Registrado por
  ];
  XLSX.utils.book_append_sheet(wb, wsHistory, "Histórico de Interações");

  const fileName = `meus-atendimentos_${fromISO}_a_${toISO}.xlsx`;
  XLSX.writeFile(wb, fileName);

  return tickets.length;
}
