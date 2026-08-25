// Radar — exportação em Excel dos casos do agente.
//
// Recebe as linhas que a TELA já está mostrando (depois de busca e filtros): é
// essa a garantia de que a planilha contém exatamente o que o agente vê. Mesmo
// contrato de exportHeldOrders.ts.
//
// A planilha traz as colunas exatamente na ordem em que a operação pediu os
// campos do registro, com "Prazo" logo depois da data do próximo acompanhamento
// porque é a leitura que interessa numa reunião ("3 atrasados, 2 para hoje").
import * as XLSX from "xlsx";

import { dueLabel, formatBrDate } from "./nextFollowUp";
import { radarKindLabel, radarStatusLabel, type MyRadarItem } from "./types";

function formatBrDateTime(value: string | null): string {
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

function safeFileSegment(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

const COLUMNS = [
  "E-mail",
  "Número do pedido",
  "Produto",
  "Tipo de acompanhamento",
  "Ação necessária",
  "Data de criação",
  "Data do próximo acompanhamento",
  "Prazo",
  "Status",
  "Observações",
  "Agente responsável",
  "Última ação registrada",
  "Registrada em",
  "Registros no histórico",
  "Fechado em",
];

const COLUMN_WIDTHS = [30, 18, 18, 30, 44, 18, 24, 16, 20, 40, 22, 44, 18, 12, 18];

export type RadarExportFilters = {
  /** Rótulo do recorte de prazo ("Atrasados", "Todos"...). */
  bucket: string;
  /** Rótulo do tipo de acompanhamento ("Todos os tipos", "RMA"...). */
  kind: string;
  /** Rótulo do status ("Todos os status", "Aberto"...). */
  status: string;
  /** Termo da busca textual; vazio quando não há busca. */
  search: string;
};

export type RadarExportParams = {
  rows: MyRadarItem[];
  /** 'hoje' do servidor — o "Prazo" da planilha usa a mesma referência da tela. */
  today: string;
  agentName: string;
  filters: RadarExportFilters;
};

/** Gera o .xlsx e devolve quantos casos foram para a planilha. */
export function exportRadar({ rows, today, agentName, filters }: RadarExportParams): number {
  const dataRows: (string | number)[][] = rows.map((r) => [
    r.client_email,
    r.order_number ?? "",
    r.product ?? "",
    radarKindLabel(r.kind),
    r.action_needed,
    formatBrDateTime(r.created_at),
    formatBrDate(r.next_follow_up_date),
    r.next_follow_up_date ? dueLabel(r.next_follow_up_date, today) : "",
    radarStatusLabel(r.status),
    r.notes ?? "",
    r.agent_name ?? agentName,
    r.last_action ?? "",
    formatBrDateTime(r.last_action_at),
    r.event_count,
    formatBrDateTime(r.closed_at),
  ]);

  const filtersLine = [
    `Prazo: ${filters.bucket}`,
    `Tipo: ${filters.kind}`,
    `Status: ${filters.status}`,
    ...(filters.search.trim() ? [`Busca: "${filters.search.trim()}"`] : []),
  ].join("  |  ");

  const generatedAt = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const sheetRows: (string | number)[][] = [
    [`Radar — acompanhamentos de ${agentName || "agente"}`],
    [`Filtros — ${filtersLine}`],
    [`Total de casos: ${rows.length}`],
    [`Gerado em: ${generatedAt}`],
    [],
    COLUMNS,
    ...(dataRows.length > 0
      ? dataRows
      : [["Nenhum caso com os filtros aplicados", ...COLUMNS.slice(1).map(() => "")]]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  ws["!merges"] = [0, 1, 2, 3].map((r) => ({
    s: { r, c: 0 },
    e: { r, c: COLUMNS.length - 1 },
  }));
  ws["!cols"] = COLUMN_WIDTHS.map((wch) => ({ wch }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Radar");

  const segments = [
    "radar",
    safeFileSegment(agentName),
    safeFileSegment(filters.bucket),
    safeFileSegment(filters.kind),
  ].filter(Boolean);
  XLSX.writeFile(wb, `${segments.join("_")}_${new Date().toISOString().slice(0, 10)}.xlsx`);

  return rows.length;
}
