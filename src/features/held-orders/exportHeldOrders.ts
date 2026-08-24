// Relatório em Excel da lista de Pedidos em Espera (On Holds) da tela da gestora.
//
// Fica na própria feature (e não em `src/lib/reportExport.ts`) porque este
// relatório não busca nada no banco: ele recebe as linhas que a tabela já está
// exibindo, depois de todos os filtros da tela. É essa a garantia de que a
// planilha contém exatamente os registros que a gestora está vendo.
import * as XLSX from "xlsx";

import { heldOrderStoreLabel, parseAddress, parseItems } from "./format";
import {
  HELD_ORDER_PENDING_TAG_LABEL,
  heldOrderManagerStatusLabel,
  heldOrderStatusBucketLabel,
  type ManagerHeldOrder,
} from "./types";

// Aceita 'YYYY-MM-DD' ou timestamp ISO completo; devolve dd/MM/yyyy.
function formatBrDate(value: string | null): string {
  if (!value) return "";
  const [y, m, d] = value.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : value;
}

// Timestamps "naive" (sem timezone) são tratados como UTC e convertidos para
// São Paulo — mesmo tratamento das demais exportações do sistema.
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

// Data de hoje em São Paulo no formato YYYY-MM-DD — o gestor abre o arquivo no
// mesmo dia em que gerou, e antes das 21h em SP o UTC já é o dia seguinte.
function todayInSaoPaulo(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

// Remove acentos e caracteres inválidos para nome de arquivo.
function safeFileSegment(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/**
 * Rótulos dos filtros ativos na tela, na ordem em que aparecem nela. `value` é
 * `null` quando o filtro está em "todos" — nesse caso ele não entra no nome do
 * arquivo, mas continua descrito no cabeçalho da planilha.
 */
export type HeldOrdersExportFilters = {
  /** Status escolhido (ex.: "Concluído"); null = todos. */
  status: string | null;
  /** Loja escolhida (ex.: "LSD123", "Devolução"); null = todas. */
  store: string | null;
  /** Produto escolhido (ex.: "NRVEBLND"); null = todos. */
  product: string | null;
  /** Agente escolhido (ex.: "Maria", "Sem agente"); null = todos. */
  agent: string | null;
  /** Termo da busca textual; vazio quando não há busca. */
  search: string;
  /** A tela está mostrando também as linhas repetidas. */
  includesDuplicates: boolean;
};

export type HeldOrdersExportParams = {
  /** As linhas que a tabela está exibindo, na mesma ordem. */
  rows: ManagerHeldOrder[];
  filters: HeldOrdersExportFilters;
};

const COLUMNS = [
  "Pedido",
  "Pedidos mesclados",
  "Loja",
  "Produtos",
  "Itens (arquivo)",
  "RMA",
  "Motivo",
  "Data do pedido",
  "Idade",
  "Cliente",
  "E-mail",
  "Endereço",
  "Cidade",
  "Estado",
  "CEP",
  "País",
  "Agente",
  "Situação",
  "Status",
  "Pendência",
  "Distribuições",
  "Concluído em",
  "Itens reestocados",
  "Itens danificados",
  "Comentários",
  "Importado em",
  "Arquivo de origem",
  "ID do pedido",
];

const COLUMN_WIDTHS = [
  18, // Pedido
  18, // Pedidos mesclados
  14, // Loja
  30, // Produtos
  40, // Itens (arquivo)
  14, // RMA
  34, // Motivo
  14, // Data do pedido
  10, // Idade
  26, // Cliente
  30, // E-mail
  40, // Endereço
  18, // Cidade
  10, // Estado
  12, // CEP
  12, // País
  22, // Agente
  22, // Situação
  14, // Status
  24, // Pendência
  14, // Distribuições
  18, // Concluído em
  24, // Itens reestocados
  24, // Itens danificados
  40, // Comentários
  18, // Importado em
  36, // Arquivo de origem
  38, // ID do pedido
];

/** "6294-NRVEBLND-114 x 2, 127-MVIT-277 x 1" -> "NRVEBLND x2, MVIT x1". */
function productsLabel(items: string | null): string {
  return parseItems(items)
    .map((i) => `${i.product} x${i.qty}`)
    .join(", ");
}

// Gera o .xlsx com as linhas recebidas (já filtradas pela tela) e devolve
// quantos pedidos foram para a planilha.
export function exportHeldOrders({ rows, filters }: HeldOrdersExportParams): number {
  const dataRows: (string | number)[][] = rows.map((o) => [
    o.order_number ?? "",
    o.merged_orders ?? "",
    heldOrderStoreLabel(o.dyna_code),
    productsLabel(o.items),
    o.items ?? "",
    o.rma ?? "",
    o.reason ?? "",
    formatBrDate(o.order_date),
    o.age ?? "",
    o.customer_name ?? "",
    o.email ?? "",
    parseAddress(o).oneLine,
    o.city ?? "",
    o.state ?? "",
    o.postal_code ?? "",
    o.country ?? "",
    o.assigned_to_name ?? "",
    heldOrderStatusBucketLabel(o),
    heldOrderManagerStatusLabel(o),
    o.pending_tag ? HELD_ORDER_PENDING_TAG_LABEL[o.pending_tag] : "",
    o.assign_count ?? 0,
    formatBrDateTime(o.confirmed_at),
    o.restocked_items ?? "",
    o.damaged_items ?? "",
    o.comments ?? "",
    formatBrDateTime(o.imported_at),
    o.source_file ?? "",
    o.id,
  ]);

  const filtersLine = [
    `Status: ${filters.status ?? "todos"}`,
    `Loja: ${filters.store ?? "todas"}`,
    `Produto: ${filters.product ?? "todos"}`,
    `Agente: ${filters.agent ?? "todos"}`,
    ...(filters.search.trim() ? [`Busca: "${filters.search.trim()}"`] : []),
    ...(filters.includesDuplicates ? ["Inclui linhas repetidas"] : []),
  ].join("  |  ");

  const generatedAt = formatBrDateTime(new Date().toISOString());

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
  ws["!merges"] = [0, 1, 2, 3].map((r) => ({
    s: { r, c: 0 },
    e: { r, c: COLUMNS.length - 1 },
  }));
  ws["!cols"] = COLUMN_WIDTHS.map((wch) => ({ wch }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Pedidos em Espera");

  // Só os filtros ativos entram no nome do arquivo — assim "todos os concluídos"
  // sai como `pedidos-em-espera_concluido_2026-08-24.xlsx` em vez de arrastar
  // "todas-as-lojas_todos-os-produtos_todos-os-agentes".
  const segments = ["pedidos-em-espera", filters.status, filters.store, filters.product, filters.agent]
    .filter((s): s is string => Boolean(s))
    .map(safeFileSegment)
    .filter(Boolean);
  XLSX.writeFile(wb, `${segments.join("_")}_${todayInSaoPaulo()}.xlsx`);

  return rows.length;
}
