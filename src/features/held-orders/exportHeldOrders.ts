// Exportação em Excel da lista de Pedidos em Espera (On Holds) da tela da gestora.
//
// A função NÃO consulta o banco: recebe as linhas que a tabela já está exibindo,
// depois de aplicados os filtros da tela (status, produto, agente, busca e a
// opção de mostrar linhas repetidas). É essa a garantia de que a planilha contém
// exatamente os registros que a gestora está vendo — pedir os dados de novo aqui
// abriria espaço para o relatório divergir da tela.
import * as XLSX from "xlsx";

import { managerStatusLabel, productLabel } from "./format";
import { HELD_ORDER_PENDING_TAG_LABEL, type ManagerHeldOrder } from "./types";

// Aceita 'YYYY-MM-DD' ou timestamp ISO completo; devolve dd/MM/yyyy.
function formatBrDate(value: string | null): string {
  if (!value) return "";
  const [y, m, d] = value.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : value;
}

// Timestamps "naive" (sem timezone) são tratados como UTC e convertidos para
// São Paulo — mesmo tratamento das outras exportações do sistema.
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

/** Remove acentos e caracteres inválidos para nome de arquivo. */
function safeFileSegment(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export type HeldOrdersExportFilters = {
  /** Rótulo do status escolhido na tela (ex.: "Confirmados", "Todos status"). */
  status: string;
  /** Rótulo do produto escolhido (ex.: "LSD123", "Devolução", "Todos os produtos"). */
  product: string;
  /** Rótulo do agente escolhido (ex.: "Maria", "Sem agente", "Todos agentes"). */
  agent: string;
  /** Termo da busca textual; vazio quando não há busca. */
  search: string;
  /** Se a lista está incluindo as linhas repetidas consolidadas. */
  includingDuplicates: boolean;
};

export type HeldOrdersExportParams = {
  rows: ManagerHeldOrder[];
  filters: HeldOrdersExportFilters;
};

const COLUMNS = [
  "Pedido",
  "Pedidos mesclados",
  "Produto (loja)",
  "RMA",
  "Motivo",
  "Data do pedido",
  "Idade",
  "Cliente",
  "E-mail",
  "Itens",
  "Endereço",
  "Cidade",
  "Estado",
  "CEP",
  "País",
  "Agente",
  "Status",
  "Pendência",
  "Vezes distribuído",
  "Linha repetida",
  "Concluído em",
  "Itens reestocados",
  "Itens danificados",
  "Comentários",
  "Importado em",
  "Arquivo de origem",
  "ID do pedido",
];

const COLUMN_WIDTHS = [
  16, 18, 16, 14, 30, 14, 10, 26, 30, 40, 34, 18, 10, 12, 10, 22, 14, 24, 16, 14, 18, 24, 24, 40, 18,
  34, 38,
];

/** Linha da planilha para um pedido — mesma leitura que a tela faz dos campos. */
function sheetRow(o: ManagerHeldOrder): (string | number)[] {
  return [
    o.order_number ?? "",
    o.merged_orders ?? "",
    productLabel(o.dyna_code),
    o.rma ?? "",
    o.reason ?? "",
    formatBrDate(o.order_date),
    o.age ?? "",
    o.customer_name ?? "",
    o.email ?? "",
    o.items ?? "",
    [o.street1, o.street2, o.street3]
      .map((p) => (p ?? "").trim())
      .filter(Boolean)
      .join(", "),
    o.city ?? "",
    o.state ?? "",
    o.postal_code ?? "",
    o.country ?? "",
    o.assigned_to_name ?? "",
    managerStatusLabel(o),
    o.pending_tag ? HELD_ORDER_PENDING_TAG_LABEL[o.pending_tag] : "",
    o.assign_count ?? 0,
    o.duplicate_of ? "Sim" : "",
    formatBrDateTime(o.confirmed_at),
    o.restocked_items ?? "",
    o.damaged_items ?? "",
    o.comments ?? "",
    formatBrDateTime(o.imported_at),
    o.source_file ?? "",
    o.id,
  ];
}

/**
 * Gera o .xlsx com as linhas recebidas e devolve quantos pedidos foram para a
 * planilha. O cabeçalho registra os filtros aplicados, para o arquivo continuar
 * legível depois de baixado e compartilhado.
 */
export function exportHeldOrders({ rows, filters }: HeldOrdersExportParams): number {
  const dataRows = rows.map(sheetRow);

  const filtersLine = [
    `Status: ${filters.status}`,
    `Produto: ${filters.product}`,
    `Agente: ${filters.agent}`,
    ...(filters.search.trim() ? [`Busca: "${filters.search.trim()}"`] : []),
    ...(filters.includingDuplicates ? ["Incluindo linhas repetidas"] : []),
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
    ["Pedidos em Espera"],
    [`Filtros — ${filtersLine}`],
    [`Total de pedidos: ${rows.length}`],
    [`Gerado em: ${generatedAt}`],
    [],
    COLUMNS,
    ...(dataRows.length > 0
      ? dataRows
      : [["Nenhum pedido com os filtros aplicados", ...COLUMNS.slice(1).map(() => "")]]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  ws["!merges"] = [0, 1, 2, 3].map((r) => ({ s: { r, c: 0 }, e: { r, c: COLUMNS.length - 1 } }));
  ws["!cols"] = COLUMN_WIDTHS.map((wch) => ({ wch }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Pedidos em Espera");

  const segments = [
    "pedidos-em-espera",
    safeFileSegment(filters.status),
    safeFileSegment(filters.product),
    safeFileSegment(filters.agent),
  ].filter(Boolean);
  XLSX.writeFile(wb, `${segments.join("_")}_${new Date().toISOString().slice(0, 10)}.xlsx`);

  return rows.length;
}
